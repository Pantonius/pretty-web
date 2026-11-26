import { useEffect, useState } from 'react'
import { exportPdf, compileProject, type CompileOutcome } from '../compiler'
import { files } from '../collab'

type Status = 'booting' | 'compiling' | 'ready' | 'error'

function snapshotProject(): { path: string; text: string }[] {
  const project: { path: string; text: string }[] = []
  files.forEach((text, path) => {
    project.push({ path, text: text.toString() })
  })
  return project
}

export function Preview({ activePath }: { activePath: string | null }) {
  const [outcome, setOutcome] = useState<CompileOutcome | null>(null)
  const [status, setStatus] = useState<Status>('booting')
  const [engineError, setEngineError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const run = async () => {
      try {
        const project = snapshotProject()
        const main = files.has('main.typ') ? 'main.typ' : (activePath ?? project[0]?.path ?? '')
        const result = await compileProject(project, main)
        if (cancelled) return
        setOutcome(result)
        setStatus(result.ok ? 'ready' : 'error')
        setEngineError(null)
      } catch (err) {
        if (cancelled) return
        setOutcome(null)
        setEngineError(err instanceof Error ? err.message : String(err))
        setStatus('error')
      }
    }

    const schedule = () => {
      clearTimeout(timer)
      timer = setTimeout(run, 500)
    }

    schedule()
    files.observeDeep(schedule)
    return () => {
      cancelled = true
      clearTimeout(timer)
      files.unobserveDeep(schedule)
    }
  }, [activePath])

  const downloadPdf = async () => {
    const project = snapshotProject()
    const main = files.has('main.typ') ? 'main.typ' : (activePath ?? project[0]?.path ?? '')
    try {
      const blob = await exportPdf(project, main)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = (main.replace(/\.typ$/, '') || 'document') + '.pdf'
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setEngineError(err instanceof Error ? err.message : String(err))
      setStatus('error')
    }
  }

  const errors = outcome?.diagnostics.filter(d => d.severity === 'error') ?? []
  const warnings = outcome?.diagnostics.filter(d => d.severity === 'warning') ?? []

  return (
    <section className="preview-pane">
      <div className="pane-header">
        <span className="pane-title">Preview</span>
        <span className={`compile-badge ${status}`}>
          {status === 'booting' && 'loading engine…'}
          {status === 'compiling' && 'compiling…'}
          {status === 'ready' &&
            `ok${warnings.length > 0 ? ` · ${warnings.length} warning${warnings.length > 1 ? 's' : ''}` : ''}`}
          {status === 'error' && `${errors.length || 1} error${errors.length !== 1 ? 's' : ''}`}
        </span>
        <button className="ghost-btn" onClick={downloadPdf} disabled={status !== 'ready'}>
          Download PDF
        </button>
      </div>

      <div className="preview-scroll">
        {engineError && <div className="engine-error">{engineError}</div>}
        {outcome && outcome.pages.length > 0 && (
          <div className="pages">
            {outcome.pages.map((svg, index) => (
              <div className="page" key={index} dangerouslySetInnerHTML={{ __html: svg }} />
            ))}
          </div>
        )}
        {(!outcome || outcome.pages.length === 0) && !engineError && (
          <div className="empty-preview">
            {status === 'booting' ? 'Starting the Typst engine…' : 'Nothing to preview yet'}
          </div>
        )}
      </div>

      {(errors.length > 0 || warnings.length > 0) && (
        <div className="diagnostics">
          {[...errors, ...warnings].map((diag, index) => (
            <pre className={`diag ${diag.severity}`} key={index}>
              {diag.formatted || diag.message}
              {diag.hints.map((hint, hintIndex) => (
                <span key={hintIndex}>{`\n= hint: ${hint}`}</span>
              ))}
            </pre>
          ))}
        </div>
      )}
    </section>
  )
}
