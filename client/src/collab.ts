import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'

export interface UserIdentity {
  name: string
  color: string
}

export const ydoc = new Y.Doc()
export const files = ydoc.getMap<Y.Text>('files')

export const roomName =
  new URLSearchParams(window.location.search).get('room') ?? 'default'

export const collabUrl =
  import.meta.env.VITE_COLLAB_URL ??
  `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/collab`

export const provider = new WebsocketProvider(collabUrl, roomName, ydoc)
export const awareness = provider.awareness

const ADJECTIVES = [
  'Swift',
  'Bright',
  'Calm',
  'Clever',
  'Bold',
  'Quiet',
  'Nimble',
  'Witty',
  'Lucid',
  'Brisk'
]
const ANIMALS = [
  'Otter',
  'Falcon',
  'Heron',
  'Lynx',
  'Ibex',
  'Marten',
  'Puffin',
  'Vole',
  'Kestrel',
  'Seal'
]
const COLORS = [
  '#e63946',
  '#f4a261',
  '#2a9d8f',
  '#4361ee',
  '#7209b7',
  '#f72585',
  '#4cc9f0',
  '#80ed99'
]

function pick<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)]
}

export const localUser: UserIdentity = {
  name: `${pick(ADJECTIVES)} ${pick(ANIMALS)}`,
  color: pick(COLORS)
}

awareness.setLocalStateField('user', localUser)
