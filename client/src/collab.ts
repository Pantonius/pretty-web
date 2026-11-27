import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { IndexeddbPersistence } from 'y-indexeddb'
import type { Awareness } from 'y-protocols/awareness'

export interface UserIdentity {
  name: string
  color: string
}

export const ydoc = new Y.Doc()
export const files = ydoc.getMap<Y.Text>('files')
export const assets = ydoc.getMap<Uint8Array>('assets')
export const folders = ydoc.getMap<number>('folders')

export type EntryKind = 'text' | 'asset' | 'folder'

export interface Entry {
  path: string
  kind: EntryKind
}

const TEXT_EXTENSIONS = new Set([
  'typ',
  'txt',
  'csv',
  'tsv',
  'json',
  'md',
  'bib',
  'toml',
  'yaml',
  'yml',
  'html',
  'css',
  'js',
  'xml'
])

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp', 'ico'])

export function extensionOf(path: string): string {
  const name = path.split('/').pop() ?? ''
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase()
}

export function isTextPath(path: string): boolean {
  return TEXT_EXTENSIONS.has(extensionOf(path))
}

export function isImagePath(path: string): boolean {
  return IMAGE_EXTENSIONS.has(extensionOf(path))
}

export function normalizePath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .split('/')
    .map(part => part.trim())
    .filter(part => part.length > 0 && part !== '.' && part !== '..')
    .join('/')
}

export function listEntries(): Entry[] {
  const entries = new Map<string, EntryKind>()
  for (const path of files.keys()) entries.set(path, 'text')
  for (const path of assets.keys()) if (!entries.has(path)) entries.set(path, 'asset')
  for (const path of folders.keys()) if (!entries.has(path)) entries.set(path, 'folder')
  return Array.from(entries, ([path, kind]) => ({ path, kind })).sort((a, b) =>
    a.path.localeCompare(b.path)
  )
}

export const roomName =
  new URLSearchParams(window.location.search).get('room') ?? 'default'

export const collabUrl =
  import.meta.env.VITE_COLLAB_URL ||
  `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/collab`

export const idbPersistence = new IndexeddbPersistence(
  `pretty-web:${roomName}`,
  ydoc
)

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

export function randomUser(): UserIdentity {
  return {
    name: `${pick(ADJECTIVES)} ${pick(ANIMALS)}`,
    color: pick(COLORS)
  }
}

export function colorFor(name: string): string {
  const hash = Array.from(name).reduce((acc, char) => (acc * 31 + char.charCodeAt(0)) | 0, 7)
  return COLORS[Math.abs(hash) % COLORS.length]
}

let provider: WebsocketProvider | null = null
let awareness: Awareness | null = null

export function getProvider(): WebsocketProvider {
  if (!provider) throw new Error('Collaboration not initialized yet')
  return provider
}

export function tryGetProvider(): WebsocketProvider | null {
  return provider
}

export function getAwareness(): Awareness {
  if (!awareness) throw new Error('Collaboration not initialized yet')
  return awareness
}

export function tryGetAwareness(): Awareness | null {
  return awareness
}

export function initCollab(options: { token?: string } = {}): WebsocketProvider {
  if (provider) return provider
  provider = new WebsocketProvider(
    collabUrl,
    roomName,
    ydoc,
    options.token ? { params: { token: options.token } } : {}
  )
  awareness = provider.awareness
  return provider
}

export function setLocalUser(user: UserIdentity): void {
  if (!awareness) return
  awareness.setLocalStateField('user', user)
}

export function updateCollabToken(token: string): void {
  if (provider) provider.params = { token }
}
