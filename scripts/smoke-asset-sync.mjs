import { spawn } from 'node:child_process'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'

const PORT = 1237
const server = spawn('node', ['src/index.mjs'], {
  cwd: new URL('../server', import.meta.url),
  env: { ...process.env, PORT: String(PORT), DATA_DIR: '/tmp/pretty-assets-data' },
  stdio: ['ignore', 'pipe', 'pipe']
})
server.stdout.on('data', data => process.stdout.write(`[server] ${data}`))
server.stderr.on('data', data => process.stderr.write(`[server] ${data}`))

await new Promise(resolve => {
  server.stdout.on('data', data => {
    if (String(data).includes('listening')) resolve()
  })
  setTimeout(resolve, 3000)
})

const docA = new Y.Doc()
const docB = new Y.Doc()
const providerA = new WebsocketProvider(`ws://127.0.0.1:${PORT}`, 'assets-room', docA)
const providerB = new WebsocketProvider(`ws://127.0.0.1:${PORT}`, 'assets-room', docB)

const waitSync = provider =>
  new Promise(resolve => {
    if (provider.synced) resolve()
    else provider.on('sync', () => resolve())
    setTimeout(resolve, 5000)
  })
await Promise.all([waitSync(providerA), waitSync(providerB)])

const filesA = docA.getMap('files')
const assetsA = docA.getMap('assets')
const foldersA = docA.getMap('folders')
docA.transact(() => {
  filesA.set('notes.csv', new Y.Text('x,y\n1,2\n'))
  assetsA.set('img.png', new Uint8Array([137, 80, 78, 71, 1, 2, 3]))
  foldersA.set('sections', 1)
})

await new Promise(resolve => setTimeout(resolve, 1000))

const assetsB = docB.getMap('assets')
const filesB = docB.getMap('files')
const foldersB = docB.getMap('folders')
const png = assetsB.get('img.png')
console.log('B files:', Array.from(filesB.keys()))
console.log('B assets:', Array.from(assetsB.keys()), 'png bytes match:', png && png.length === 7 && png[0] === 137)
console.log('B folders:', Array.from(foldersB.keys()))

const ok =
  filesB.get('notes.csv')?.toString() === 'x,y\n1,2\n' &&
  png instanceof Uint8Array &&
  png.length === 7 &&
  png[0] === 137 &&
  foldersB.has('sections')

providerA.destroy()
providerB.destroy()
docA.destroy()
docB.destroy()
server.kill()
console.log(ok ? 'ASSET SYNC PASSED' : 'ASSET SYNC FAILED')
process.exit(ok ? 0 : 1)
