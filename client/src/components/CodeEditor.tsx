import { useEffect, useRef } from 'react'
import { autocompletion } from '@codemirror/autocomplete'
import { EditorState } from '@codemirror/state'
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers
} from '@codemirror/view'
import { defaultKeymap, indentWithTab } from '@codemirror/commands'
import { oneDark } from '@codemirror/theme-one-dark'
import { yCollab } from 'y-codemirror.next'
import * as Y from 'yjs'
import { getAwareness } from '../collab'
import { typstLanguage } from '../typst-lang'
import { typstCompletions } from '../typst-completions'

export function CodeEditor({ ytext }: { ytext: Y.Text }) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return
    const undoManager = new Y.UndoManager(ytext)
    const view = new EditorView({
      state: EditorState.create({
        doc: ytext.toString(),
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          drawSelection(),
          EditorView.lineWrapping,
          oneDark,
          typstLanguage,
          autocompletion({ override: [typstCompletions] }),
          yCollab(ytext, getAwareness(), { undoManager }),
          keymap.of([...defaultKeymap, indentWithTab])
        ]
      }),
      parent: containerRef.current
    })
    return () => {
      view.destroy()
    }
  }, [ytext])

  return <div className="editor-container" ref={containerRef} />
}
