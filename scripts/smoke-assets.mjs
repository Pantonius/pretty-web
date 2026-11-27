import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createTypstCompiler } from 'typst-wasm'
import { createWorkerThread } from 'typst-wasm/worker/node'

const require_ = createRequire(import.meta.url)
const pkgDir = new URL('../node_modules/typst-wasm/dist/', import.meta.url)

const workerUrl = new URL('worker/worker-thread.js', pkgDir)
const core1 = readFileSync(new URL('engine/engine.core.wasm', pkgDir))
const core2 = readFileSync(new URL('engine/engine.core2.wasm', pkgDir))
const core3 = readFileSync(new URL('engine/engine.core3.wasm', pkgDir))
const font = readFileSync(
  new URL('../node_modules/@typst-wasm/fonts/dist/files/LibertinusSerif-Regular.otf', import.meta.url)
)

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

const compiler = await createTypstCompiler({
  backend: 'worker',
  worker: () => createWorkerThread(workerUrl),
  coreModules: {
    'engine.core.wasm': WebAssembly.compile(core1),
    'engine.core2.wasm': WebAssembly.compile(core2),
    'engine.core3.wasm': WebAssembly.compile(core3)
  }
})
await compiler.addFonts(new Uint8Array(font))

const MAIN = [
  '#set page(width: 10cm, height: 5cm, margin: 1cm)',
  '#image("assets/img.png")',
  '',
  '#table(columns: 2, ..csv("data/data.csv").flatten())'
].join('\n')
const CSV = 'a,b\n1,2\n3,4\n'

async function run(label, addCsv) {
  await compiler.addSource('main.typ', MAIN)
  await addCsv()
  await compiler.addFile('assets/img.png', new Uint8Array(PNG_1X1))
  let result
  try {
    result = await compiler.compile({ format: 'svg', main: 'main.typ' })
  } catch (err) {
    console.log(`${label}: threw ${err.constructor.name}: ${err.message}`)
    if (err.diagnostics) for (const diag of err.diagnostics) console.log(`  - ${diag.formatted || diag.message}`)
    return
  }
  const errors = result.diagnostics.filter(d => d.severity === 'error')
  console.log(`${label}: pages=${result.pages.length} errors=${errors.length}`)
  for (const diag of errors) console.log(`  - ${diag.message}`)
  const deps = result.dependencies.map(dep => `${dep.kind}:${dep.path}`)
  console.log(`  deps: ${deps.join(', ')}`)
}

await run('csv via addSource (text)', () => compiler.addSource('data/data.csv', CSV))
await run('csv via addFile (bytes)', () =>
  compiler.addFile('data/data.csv', new Uint8Array(Buffer.from(CSV)))
)

console.log('listFiles:', await compiler.listFiles())
await compiler.dispose()
console.log('smoke-assets OK')
