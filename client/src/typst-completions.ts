import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import { assets, files } from './collab'

interface FunctionDoc {
  label: string
  info: string
}

const FUNCTIONS: FunctionDoc[] = [
  { label: 'heading', info: 'Section heading: #heading(level: 1)[...]' },
  { label: 'list', info: 'Bulleted list' },
  { label: 'enum', info: 'Numbered list' },
  { label: 'terms', info: 'Definition list of terms' },
  { label: 'table', info: 'Table: #table(columns: 2)[..][..]' },
  { label: 'figure', info: 'Captioned figure: #figure(image("x.png"), caption: [...])' },
  { label: 'quote', info: 'Block or inline quotation' },
  { label: 'emph', info: 'Emphasized (italic) text' },
  { label: 'strong', info: 'Strong (bold) text' },
  { label: 'raw', info: 'Raw text or code block' },
  { label: 'underline', info: 'Underlined text' },
  { label: 'overline', info: 'Overlined text' },
  { label: 'strike', info: 'Struck-through text' },
  { label: 'highlight', info: 'Highlighted text' },
  { label: 'sub', info: 'Subscript' },
  { label: 'super', info: 'Superscript' },
  { label: 'smallcaps', info: 'Small capitals' },
  { label: 'upper', info: 'Uppercase text' },
  { label: 'lower', info: 'Lowercase text' },
  { label: 'linebreak', info: 'Force a line break' },
  { label: 'parbreak', info: 'Insert a paragraph break' },
  { label: 'par', info: 'Paragraph styling and spacing' },
  { label: 'text', info: 'Text styling: font, size, fill' },
  { label: 'page', info: 'Page styling: size, margins, numbering' },
  { label: 'align', info: 'Align content: #align(center)[...]' },
  { label: 'v', info: 'Vertical spacing' },
  { label: 'h', info: 'Horizontal spacing' },
  { label: 'box', info: 'Inline-sized container' },
  { label: 'block', info: 'Block-level container' },
  { label: 'stack', info: 'Stack content vertically or horizontally' },
  { label: 'grid', info: 'Grid of cells: #grid(columns: (auto, 1fr), ..)' },
  { label: 'columns', info: 'Split content into columns' },
  { label: 'colbreak', info: 'Force a column break' },
  { label: 'place', info: 'Position content absolutely on the page' },
  { label: 'move', info: 'Move content without affecting layout' },
  { label: 'scale', info: 'Scale content' },
  { label: 'rotate', info: 'Rotate content' },
  { label: 'hide', info: 'Hide content while keeping its layout space' },
  { label: 'outline', info: 'Table of contents: #outline()' },
  { label: 'footnote', info: 'Footnote: #footnote[...]' },
  { label: 'numbering', info: 'Apply a numbering pattern: #numbering("1.a", 2, 3)' },
  { label: 'counter', info: 'Access counters: #counter(page).display("1 / 1")' },
  { label: 'state', info: 'Managed document state' },
  { label: 'locate', info: 'Access the location of content in the document' },
  { label: 'context', info: 'Context expression for introspection: #context counter(page).get()' },
  { label: 'metadata', info: 'Invisible document metadata' },
  { label: 'ref', info: 'Reference: @label or #ref(<label>)' },
  { label: 'link', info: 'Hyperlink: #link("https://...")[text]' },
  { label: 'image', info: 'Image: #image("assets/photo.png", width: 60%)' },
  { label: 'line', info: 'Straight line' },
  { label: 'rect', info: 'Rectangle' },
  { label: 'square', info: 'Square' },
  { label: 'circle', info: 'Circle' },
  { label: 'ellipse', info: 'Ellipse' },
  { label: 'polygon', info: 'Polygon' },
  { label: 'curve', info: 'Bézier path' },
  { label: 'path', info: 'Path of straight segments' },
  { label: 'date', info: 'Date value' },
  { label: 'duration', info: 'Duration value' },
  { label: 'datetime', info: 'Date and time value' },
  { label: 'today', info: "Today's date: #today.display()" },
  { label: 'csv', info: 'Read a CSV file: #csv("data.csv")' },
  { label: 'json', info: 'Read a JSON file: #json("data.json")' },
  { label: 'yaml', info: 'Read a YAML file' },
  { label: 'toml', info: 'Read a TOML file' },
  { label: 'xml', info: 'Read an XML file' },
  { label: 'cbor', info: 'Read a CBOR file' },
  { label: 'read', info: 'Read a file as text: #read("notes.txt")' },
  { label: 'let', info: 'Define a variable: #let x = 5' },
  { label: 'set', info: 'Set style rules: #set text(size: 11pt)' },
  { label: 'show', info: 'Show rules: #show heading: set block(below: 1em)' },
  { label: 'if', info: 'Conditional: #if x > 0 [pos] else [neg]' },
  { label: 'for', info: 'Loop: #for x in range(3) [x]' },
  { label: 'while', info: 'While loop' },
  { label: 'return', info: 'Return from a function' },
  { label: 'import', info: 'Import from another file: #import "lib.typ": helper' },
  { label: 'include', info: 'Include another file: #include "sections/intro.typ"' },
  { label: 'eval', info: 'Evaluate a string as Typst code' },
  { label: 'break', info: 'Break out of a loop' },
  { label: 'continue', info: 'Continue with the next loop iteration' },
  { label: 'calc.abs', info: 'Absolute value' },
  { label: 'calc.ceil', info: 'Round up' },
  { label: 'calc.floor', info: 'Round down' },
  { label: 'calc.round', info: 'Round to nearest' },
  { label: 'calc.max', info: 'Maximum of values' },
  { label: 'calc.min', info: 'Minimum of values' },
  { label: 'calc.pow', info: 'Exponentiation: calc.pow(2, 10)' },
  { label: 'calc.sqrt', info: 'Square root' },
  { label: 'calc.rem', info: 'Remainder' },
  { label: 'calc.sin', info: 'Sine (radians)' },
  { label: 'calc.cos', info: 'Cosine (radians)' },
  { label: 'calc.tan', info: 'Tangent (radians)' },
  { label: 'calc.e', info: "Euler's number" },
  { label: 'calc.pi', info: 'The constant π' }
]

const SNIPPETS: Completion[] = [
  {
    label: 'set-page',
    type: 'keyword',
    detail: 'snippet',
    apply: '#set page(paper: "a4", margin: 2.5cm, numbering: "1")'
  },
  {
    label: 'set-text',
    type: 'keyword',
    detail: 'snippet',
    apply: '#set text(size: 11pt, lang: "en")'
  },
  {
    label: 'set-heading',
    type: 'keyword',
    detail: 'snippet',
    apply: '#set heading(numbering: "1.1")'
  },
  {
    label: 'show-heading',
    type: 'keyword',
    detail: 'snippet',
    apply: '#show heading.where(level: 1): it => block(above: 1.4em, below: 1em, it)'
  },
  {
    label: 'figure-image',
    type: 'keyword',
    detail: 'snippet',
    apply: '#figure(image("${path}"), caption: [${caption}])'
  },
  {
    label: 'table',
    type: 'keyword',
    detail: 'snippet',
    apply: '#table(\n  columns: (${n}),\n  ${cells},\n)'
  },
  {
    label: 'function',
    type: 'keyword',
    detail: 'snippet',
    apply: '#let ${name}(${args}) = {\n  ${body}\n}'
  }
]

function functionCompletions(): Completion[] {
  return [
    ...FUNCTIONS.map(entry => ({
      label: entry.label,
      type: 'function',
      detail: 'typst',
      info: entry.info
    })),
    ...SNIPPETS
  ]
}

function projectPathCompletions(): Completion[] {
  const options: Completion[] = []
  files.forEach((_text, path) => {
    options.push({ label: path, type: 'file', detail: 'file' })
  })
  assets.forEach((_bytes, path) => {
    options.push({ label: path, type: 'file', detail: 'asset' })
  })
  return options.sort((a, b) => a.label.localeCompare(b.label))
}

function labelCompletions(): Completion[] {
  const labels = new Set<string>()
  files.forEach(text => {
    for (const match of text.toString().matchAll(/<([a-zA-Z0-9_-]+)>/g)) {
      labels.add(match[1])
    }
  })
  return Array.from(labels, label => ({ label, type: 'constant', detail: 'label' })).sort((a, b) =>
    a.label.localeCompare(b.label)
  )
}

export function typstCompletions(context: CompletionContext): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos)
  const before = line.text.slice(0, context.pos - line.from)

  const labelMatch = before.match(/@([a-zA-Z0-9_-]*)$/)
  if (labelMatch) {
    const options = labelCompletions()
    if (options.length === 0) return null
    return {
      from: context.pos - labelMatch[1].length,
      options,
      validFor: /^[a-zA-Z0-9_-]*$/
    }
  }

  const pathCall = before.match(/(?:#(?:image|csv|json|yaml|toml|xml|cbor|read)\(\s*|#include\s+)"/)
  if (pathCall) {
    const typed = before.match(/[^"]*$/)
    const fragment = typed ? typed[0] : ''
    if (!/[)\]]/.test(fragment)) {
      return {
        from: context.pos - fragment.length,
        options: projectPathCompletions(),
        validFor: /^[^"]*$/
      }
    }
  }

  const codeMatch = before.match(/#([a-zA-Z_.]*)$/)
  if (codeMatch) {
    return {
      from: context.pos - codeMatch[1].length,
      options: functionCompletions(),
      validFor: /^[a-zA-Z_.]*$/
    }
  }

  return null
}
