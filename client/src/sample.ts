export const SAMPLE_MAIN = `= Hello, pretty-web!

This is a *collaborative* Typst editor, compiled entirely in your browser.
Open this URL in a second tab (or send it to a friend) to edit together in real time.

== What can it do?

- Real-time collaborative editing with shared cursors
- A file explorer for multi-file projects
- A live preview that recompiles as you type
- PDF export of the finished document

#figure(
  table(
    columns: (auto, auto),
    [Component], [Powered by],
    [Editing], [CodeMirror + Yjs],
    [Typesetting], [Typst via WebAssembly],
  ),
  caption: [The pieces under the hood],
)

Some math, because we can:

$ integral_0^oo e^(-x^2) dif x = sqrt(pi) / 2 $

#include "sections/intro.typ"
`

export const SAMPLE_INTRO = `= Introduction

Typst documents are written in plain text, so they work beautifully with
version control and collaborative editing.

Try changing this sentence and watch the preview update on the right.`
