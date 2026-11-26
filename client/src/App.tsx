import { useCallback, useEffect, useState } from 'react'
import * as Y from 'yjs'
import { awareness, files, localUser, provider, roomName, ydoc, type UserIdentity } from './collab'
import { SAMPLE_INTRO, SAMPLE_MAIN } from './sample'
import { FileExplorer } from './components/FileExplorer'
import { CodeEditor } from './components/CodeEditor'
import { Preview } from './components/Preview'

function usePeers(): UserIdentity[] {
  const [peers, setPeers] = useState<UserIdentity[]>([])
  useEffect(() => {
    const update = () => {
      const list: UserIdentity[] = []
      awareness.getStates().forEach((state, id) => {
        const user = state.user as UserIdentity | undefined
        if (user && id !== awareness.clientID) list.push(user)
      })
      setPeers(list)
    }
    awareness.on('change', update)
    update()
    return () => {
      awareness.off('change', update)
    }
  }, [])
  return peers
}

function useConnectionStatus(): string {
  const [status, setStatus] = useState(
    provider.wsconnected ? 'connected' : provider.wsconnecting ? 'connecting' : 'disconnected'
  )
  useEffect(() => {
    const onStatus = ({ status }: { status: string }) => setStatus(status)
    provider.on('status', onStatus)
    return () => {
      provider.off('status', onStatus)
    }
  }, [])
  return status
}

export default function App() {
  const [paths, setPaths] = useState<string[]>([])
  const [active, setActive] = useState<string | null>(null)
  const peers = usePeers()
  const status = useConnectionStatus()

  useEffect(() => {
    const update = () => setPaths(Array.from(files.keys()).sort())
    update()
    files.observe(update)
    return () => {
      files.unobserve(update)
    }
  }, [])

  useEffect(() => {
    const seed = () => {
      if (files.size === 0) {
        ydoc.transact(() => {
          files.set('main.typ', new Y.Text(SAMPLE_MAIN))
          files.set('sections/intro.typ', new Y.Text(SAMPLE_INTRO))
        })
      }
    }
    if (provider.synced) {
      seed()
      return
    }
    const onSync = (synced: boolean) => {
      if (!synced) return
      seed()
      provider.off('sync', onSync)
    }
    provider.on('sync', onSync)
    return () => {
      provider.off('sync', onSync)
    }
  }, [])

  useEffect(() => {
    if (active !== null && files.has(active)) return
    setActive(files.has('main.typ') ? 'main.typ' : (paths[0] ?? null))
  }, [paths, active])

  const openFile = useCallback((path: string) => setActive(path), [])

  const createFile = useCallback((path: string) => {
    if (!path || files.has(path)) return
    ydoc.transact(() => {
      files.set(path, new Y.Text(''))
    })
    setActive(path)
  }, [])

  const deleteFile = useCallback(
    (path: string) => {
      ydoc.transact(() => {
        files.delete(path)
      })
      if (active === path) setActive(null)
    },
    [active]
  )

  const renameFile = useCallback(
    (path: string, next: string) => {
      const text = files.get(path)
      if (!text || files.has(next)) return
      ydoc.transact(() => {
        files.set(next, new Y.Text(text.toString()))
        files.delete(path)
      })
      if (active === path) setActive(next)
    },
    [active]
  )

  const activeText = active !== null ? files.get(active) : undefined

  return (
    <div className="app">
      <FileExplorer
        paths={paths}
        active={active}
        onOpen={openFile}
        onCreate={createFile}
        onDelete={deleteFile}
        onRename={renameFile}
        peers={peers}
        self={localUser}
        status={status}
        roomName={roomName}
      />
      <main className="workspace">
        <section className="editor-pane">
          <div className="pane-header">
            <span className="pane-title">{active ?? 'No file open'}</span>
            <span className="pane-hint">editing together with {peers.length + 1} peer{peers.length !== 0 ? 's' : ''}</span>
          </div>
          {activeText ? (
            <CodeEditor key={active} ytext={activeText} />
          ) : (
            <div className="empty-editor">Select or create a file to start editing</div>
          )}
        </section>
        <Preview activePath={active} />
      </main>
    </div>
  )
}
