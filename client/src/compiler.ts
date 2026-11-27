import {
  CompileError,
  createTypstCompiler,
  supportsJspiBackend,
  supportsWorkerBackend,
  type Diagnostic,
  type TypstCompiler
} from 'typst-wasm'
import { createWebWorker } from 'typst-wasm/worker/browser'
import workerUrl from 'typst-wasm/worker/web-worker?url'
import core1Url from 'typst-wasm/engine/engine.core.wasm?url'
import core2Url from 'typst-wasm/engine/engine.core2.wasm?url'
import core3Url from 'typst-wasm/engine/engine.core3.wasm?url'
import fontDejaVuBold from '@typst-wasm/fonts/DejaVuSansMono-Bold.ttf?url'
import fontDejaVuBoldOblique from '@typst-wasm/fonts/DejaVuSansMono-BoldOblique.ttf?url'
import fontDejaVuOblique from '@typst-wasm/fonts/DejaVuSansMono-Oblique.ttf?url'
import fontDejaVu from '@typst-wasm/fonts/DejaVuSansMono.ttf?url'
import fontLibertinusBold from '@typst-wasm/fonts/LibertinusSerif-Bold.otf?url'
import fontLibertinusBoldItalic from '@typst-wasm/fonts/LibertinusSerif-BoldItalic.otf?url'
import fontLibertinusItalic from '@typst-wasm/fonts/LibertinusSerif-Italic.otf?url'
import fontLibertinusRegular from '@typst-wasm/fonts/LibertinusSerif-Regular.otf?url'
import fontLibertinusSemibold from '@typst-wasm/fonts/LibertinusSerif-Semibold.otf?url'
import fontLibertinusSemiboldItalic from '@typst-wasm/fonts/LibertinusSerif-SemiboldItalic.otf?url'
import fontNewCMBold from '@typst-wasm/fonts/NewCM10-Bold.otf?url'
import fontNewCMBoldItalic from '@typst-wasm/fonts/NewCM10-BoldItalic.otf?url'
import fontNewCMItalic from '@typst-wasm/fonts/NewCM10-Italic.otf?url'
import fontNewCMRegular from '@typst-wasm/fonts/NewCM10-Regular.otf?url'
import fontNewCMMathBold from '@typst-wasm/fonts/NewCMMath-Bold.otf?url'
import fontNewCMMathBook from '@typst-wasm/fonts/NewCMMath-Book.otf?url'
import fontNewCMMathRegular from '@typst-wasm/fonts/NewCMMath-Regular.otf?url'

const FONT_URLS = [
  fontLibertinusRegular,
  fontLibertinusBold,
  fontLibertinusItalic,
  fontLibertinusBoldItalic,
  fontLibertinusSemibold,
  fontLibertinusSemiboldItalic,
  fontNewCMRegular,
  fontNewCMBold,
  fontNewCMItalic,
  fontNewCMBoldItalic,
  fontNewCMMathRegular,
  fontNewCMMathBook,
  fontNewCMMathBold,
  fontDejaVu,
  fontDejaVuBold,
  fontDejaVuOblique,
  fontDejaVuBoldOblique
]

let compilerPromise: Promise<TypstCompiler> | null = null
let lock: Promise<unknown> = Promise.resolve()

function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const next = lock.then(fn, fn)
  lock = next.catch(() => {})
  return next
}

async function createCompiler(): Promise<TypstCompiler> {
  const useJspi = supportsJspiBackend()
  const useWorker = !useJspi && supportsWorkerBackend()
  if (!useJspi && !useWorker) {
    throw new Error(
      'This browser cannot run the Typst engine (needs WebAssembly JSPI or module workers).'
    )
  }

  const compiler = await createTypstCompiler({
    backend: useJspi ? 'jspi' : 'worker',
    worker:
      useWorker ?
        () => createWebWorker(new URL(workerUrl, window.location.href))
      : undefined,
    coreModules: {
      'engine.core.wasm': WebAssembly.compileStreaming(fetch(core1Url)),
      'engine.core2.wasm': WebAssembly.compileStreaming(fetch(core2Url)),
      'engine.core3.wasm': WebAssembly.compileStreaming(fetch(core3Url))
    }
  })

  const fonts = await Promise.all(
    FONT_URLS.map(async url => new Uint8Array(await (await fetch(url)).arrayBuffer()))
  )
  await compiler.addFonts(...fonts)
  return compiler
}

export function getCompiler(): Promise<TypstCompiler> {
  compilerPromise ??= createCompiler()
  return compilerPromise
}

export interface ProjectFile {
  path: string
  text: string
}

export interface ProjectAsset {
  path: string
  bytes: Uint8Array
}

export interface CompileOutcome {
  ok: boolean
  pages: string[]
  diagnostics: Diagnostic[]
}

const addedAssets = new Map<string, Uint8Array>()

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false
  }
  return true
}

async function syncAssets(compiler: TypstCompiler, assets: ProjectAsset[]): Promise<void> {
  for (const asset of assets) {
    const previous = addedAssets.get(asset.path)
    if (previous && bytesEqual(previous, asset.bytes)) continue
    await compiler.addFile(asset.path, asset.bytes)
    addedAssets.set(asset.path, asset.bytes)
  }
  for (const path of Array.from(addedAssets.keys())) {
    if (!assets.some(asset => asset.path === path)) {
      await compiler.removeFile(path)
      addedAssets.delete(path)
    }
  }
}

function failureOutcome(message: string, diagnostics: Diagnostic[] = []): CompileOutcome {
  return {
    ok: false,
    pages: [],
    diagnostics:
      diagnostics.length > 0 ?
        diagnostics
      : [{
          message,
          severity: 'error',
          formatted: message,
          hints: [],
          trace: []
        }]
  }
}

export async function compileProject(
  project: ProjectFile[],
  assets: ProjectAsset[],
  main: string
): Promise<CompileOutcome> {
  return serialize(async () => {
    const compiler = await getCompiler()
    if (!project.some(file => file.path === main)) {
      return failureOutcome(`Entry file "${main}" not found.`)
    }

    const listed = new Set(await compiler.listFiles())
    for (const file of project) {
      await compiler.addSource(file.path, file.text)
      listed.delete(file.path)
    }
    for (const asset of assets) {
      listed.delete(asset.path)
    }
    await syncAssets(compiler, assets)
    for (const stale of listed) {
      await compiler.removeFile(stale)
    }

    try {
      const result = await compiler.compile({ format: 'svg', main })
      return {
        ok: true,
        pages: result.pages.map(page => page.output),
        diagnostics: result.diagnostics
      }
    } catch (err) {
      if (err instanceof CompileError) {
        return failureOutcome('Compilation failed.', err.diagnostics)
      }
      return failureOutcome(err instanceof Error ? err.message : String(err))
    }
  })
}

export async function exportPdf(
  project: ProjectFile[],
  assets: ProjectAsset[],
  main: string
): Promise<Blob> {
  return serialize(async () => {
    const compiler = await getCompiler()
    for (const file of project) {
      await compiler.addSource(file.path, file.text)
    }
    await syncAssets(compiler, assets)
    const result = await compiler.compile({ format: 'pdf', main })
    return new Blob([result.output as BlobPart], { type: 'application/pdf' })
  })
}
