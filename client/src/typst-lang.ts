import { StreamLanguage } from '@codemirror/language'
import type { StringStream } from '@codemirror/language'

interface TypstStreamState {
  inBlockComment: boolean
  inMath: boolean
}

function token(stream: StringStream, state: TypstStreamState): string | null {
  if (state.inBlockComment) {
    if (stream.skipTo('*/')) {
      stream.next()
      stream.next()
      state.inBlockComment = false
    } else {
      stream.skipToEnd()
    }
    return 'comment'
  }

  if (state.inMath) {
    if (stream.match('$')) {
      state.inMath = false
      return 'atom'
    }
    stream.next()
    return 'atom'
  }

  if (stream.match('//')) {
    stream.skipToEnd()
    return 'comment'
  }
  if (stream.match('/*')) {
    if (stream.skipTo('*/')) {
      stream.next()
      stream.next()
    } else {
      state.inBlockComment = true
    }
    return 'comment'
  }
  if (stream.match('$')) {
    state.inMath = true
    return 'atom'
  }
  if (stream.sol() && stream.match(/^=+ /)) {
    return 'heading'
  }
  if (stream.match(/#([A-Za-z_][\w.:-]*)?/)) {
    return 'keyword'
  }
  if (stream.match(/@([A-Za-z_][\w.-]*)/)) {
    return 'meta'
  }
  if (stream.match(/<[^>\n]+>/)) {
    return 'typeName'
  }
  if (stream.match(/"[^"\n]*"?/)) {
    return 'string'
  }
  if (stream.match(/\*[^*\n]+\*/)) {
    return 'strong'
  }
  if (stream.match(/_[^_\n]+_/)) {
    return 'emphasis'
  }
  if (stream.match(/-{3,}/)) {
    return 'contentSeparator'
  }
  stream.next()
  return null
}

export const typstLanguage = StreamLanguage.define<TypstStreamState>({
  token,
  startState: () => ({ inBlockComment: false, inMath: false })
})
