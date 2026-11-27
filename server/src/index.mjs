import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'
import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { createAuth } from './auth.mjs'

const HOST = process.env.HOST ?? '127.0.0.1'
const PORT = Number(process.env.PORT ?? 1234)
const DATA_DIR = process.env.DATA_DIR ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '../../.data')
const STATIC_DIR = process.env.STATIC_DIR ?? ''
const SAVE_DELAY_MS = 1000
const PING_INTERVAL_MS = 30_000

const MESSAGE_SYNC = 0
const MESSAGE_AWARENESS = 1

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.otf': 'font/otf',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
}

fs.mkdirSync(DATA_DIR, { recursive: true })

const auth = await createAuth()

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

function serveStatic(res, urlPath) {
  const relative = urlPath.replace(/^\/+/, '') || 'index.html'
  const file = path.join(STATIC_DIR, path.normalize(relative).replace(/^(\.\.[/\\])+/, ''))
  if (!file.startsWith(STATIC_DIR)) {
    res.writeHead(403)
    res.end()
    return
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      fs.readFile(path.join(STATIC_DIR, 'index.html'), (err2, index) => {
        if (err2) {
          res.writeHead(404)
          res.end()
          return
        }
        res.writeHead(200, { 'Content-Type': MIME_TYPES['.html'] })
        res.end(index)
      })
      return
    }
    res.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(file)] ?? 'application/octet-stream' })
    res.end(data)
  })
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (url.pathname === '/me') {
    auth
      .authenticate(req)
      .then(identity => {
        res.setHeader('Cache-Control', 'no-store')
        if (!identity) {
          sendJson(res, 401, { error: 'unauthenticated' })
          return
        }
        sendJson(res, 200, { user: identity })
      })
      .catch(() => sendJson(res, 500, { error: 'auth check failed' }))
    return
  }
  if (STATIC_DIR) {
    serveStatic(res, url.pathname)
    return
  }
  res.writeHead(200, { 'Content-Type': 'text/plain' })
  res.end('pretty-web collaboration server\n')
})

const rooms = new Map()

function roomPath(name) {
  const safe = name.replace(/[^a-zA-Z0-9_-]/g, '_')
  return path.join(DATA_DIR, `${safe}.ydoc`)
}

function loadRoom(name) {
  let room = rooms.get(name)
  if (room) return room

  const doc = new Y.Doc()
  const file = roomPath(name)
  try {
    Y.applyUpdate(doc, new Uint8Array(fs.readFileSync(file)))
    console.log(`[room ${name}] restored from ${file}`)
  } catch {
    console.log(`[room ${name}] created`)
  }

  const awareness = new awarenessProtocol.Awareness(doc)
  awareness.setLocalState(null)

  room = {
    doc,
    awareness,
    conns: new Map(),
    dirty: false,
    saveTimer: null
  }
  rooms.set(name, room)

  doc.on('update', (update, origin) => {
    room.dirty = true
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, MESSAGE_SYNC)
    syncProtocol.writeUpdate(encoder, update)
    broadcast(room, encoding.toUint8Array(encoder), origin)
    scheduleSave(room, name)
  })

  awareness.on('update', ({ added, updated, removed }, origin) => {
    const changed = added.concat(updated, removed)
    if (changed.length === 0) return
    if (origin && room.conns.has(origin)) {
      const controlled = room.conns.get(origin)
      for (const id of added) controlled.add(id)
    }
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS)
    encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(awareness, changed))
    broadcast(room, encoding.toUint8Array(encoder), origin)
  })

  return room
}

function scheduleSave(room, name) {
  if (room.saveTimer) return
  room.saveTimer = setTimeout(() => {
    room.saveTimer = null
    if (!room.dirty) return
    room.dirty = false
    const snapshot = Y.encodeStateAsUpdate(room.doc)
    const target = roomPath(name)
    const tmp = target + '.tmp'
    fs.writeFile(tmp, snapshot, err => {
      if (err) {
        console.error(`[room ${name}] save failed:`, err.message)
        return
      }
      fs.rename(tmp, target, () => {})
    })
  }, SAVE_DELAY_MS)
}

function broadcast(room, data, exclude) {
  for (const [conn] of room.conns) {
    if (conn !== exclude && conn.readyState === 1) conn.send(data)
  }
}

function send(conn, data) {
  if (conn.readyState === 1) conn.send(data, {}, () => {})
}

function closeConn(room, name, conn) {
  const controlledIds = room.conns.get(conn)
  room.conns.delete(conn)
  if (controlledIds && controlledIds.size > 0) {
    awarenessProtocol.removeAwarenessStates(room.awareness, Array.from(controlledIds), null)
  }
  if (room.conns.size === 0) scheduleSave(room, name)
}

const wss = new WebSocketServer({ noServer: true })

wss.on('connection', (conn, req) => {
  req.setSocketKeepAlive?.(true, PING_INTERVAL_MS)
  const roomName = decodeURIComponent((req.url ?? '/default').split('?')[0].replace(/^\//, '')) || 'default'
  const room = loadRoom(roomName)

  conn.binaryType = 'arraybuffer'
  room.conns.set(conn, new Set())
  conn.on('message', (data, isBinary) => {
    if (!isBinary) return
    const msg = new Uint8Array(data)
    const decoder = decoding.createDecoder(msg)
    const type = decoding.readVarUint(decoder)
    switch (type) {
      case MESSAGE_SYNC: {
        const encoder = encoding.createEncoder()
        encoding.writeVarUint(encoder, MESSAGE_SYNC)
        syncProtocol.readSyncMessage(decoder, encoder, room.doc, conn)
        if (encoding.length(encoder) > 1) send(conn, encoding.toUint8Array(encoder))
        break
      }
      case MESSAGE_AWARENESS: {
        const update = decoding.readVarUint8Array(decoder)
        awarenessProtocol.applyAwarenessUpdate(room.awareness, update, conn)
        break
      }
      default:
        console.warn(`[room ${roomName}] unknown message type ${type}`)
    }
  })

  conn.on('close', () => closeConn(room, roomName, conn))
  conn.on('error', () => closeConn(room, roomName, conn))

  const reply = encoding.createEncoder()
  encoding.writeVarUint(reply, MESSAGE_SYNC)
  syncProtocol.writeSyncStep1(reply, room.doc)
  send(conn, encoding.toUint8Array(reply))

  const states = room.awareness.getStates()
  if (states.size > 0) {
    const awEncoder = encoding.createEncoder()
    encoding.writeVarUint(awEncoder, MESSAGE_AWARENESS)
    encoding.writeVarUint8Array(awEncoder, awarenessProtocol.encodeAwarenessUpdate(room.awareness, Array.from(states.keys())))
    send(conn, encoding.toUint8Array(awEncoder))
  }
})

server.on('upgrade', async (req, socket, head) => {
  let identity = null
  try {
    identity = await auth.authenticate(req)
  } catch (err) {
    console.error('auth check failed:', err.message)
  }
  if (!identity) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
    socket.destroy()
    return
  }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req))
})

server.listen(PORT, HOST, () => {
  console.log(`pretty-web collaboration server listening on http://${HOST}:${PORT}`)
  console.log(`room snapshots stored in ${DATA_DIR}`)
  if (STATIC_DIR) console.log(`serving static client from ${STATIC_DIR}`)
})
