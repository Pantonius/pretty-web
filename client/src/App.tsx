import { useCallback, useEffect, useState } from 'react'
import * as Y from 'yjs'
import {
  colorFor,
  files,
  getAwareness,
  getProvider,
  idbPersistence,
  initCollab,
  randomUser,
  roomName,
  setLocalUser,
  tryGetProvider,
  updateCollabToken,
  ydoc,
  type UserIdentity
} from './collab'
import {
  fetchProxyIdentity,
  getAccessToken,
  handleAuthCallback,
  hasAuthCodeCallback,
  isAuthenticated,
  login,
  logout,
  readAuthConfig,
  type AuthConfig,
  type UserProfile
} from './auth'
import { SAMPLE_INTRO, SAMPLE_MAIN } from './sample'
import { FileExplorer } from './components/FileExplorer'
import { CodeEditor } from './components/CodeEditor'
import { Preview } from './components/Preview'

const authConfig: AuthConfig = readAuthConfig()

function usePeers(): UserIdentity[] {
  const [peers, setPeers] = useState<UserIdentity[]>([])
  useEffect(() => {
    const awareness = getAwareness()
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
  const provider = getProvider()
  const [status, setStatus] = useState(
    provider.wsconnected ? 'connected' : provider.wsconnecting ? 'connecting' : 'disconnected'
  )
  useEffect(() => {
    const onStatus = ({ status }: { status: string }) => setStatus(status)
    provider.on('status', onStatus)
    return () => {
      provider.off('status', onStatus)
    }
  }, [provider])
  return status
}

function clearSessionAndReload() {
  logout(authConfig).finally(() => {
    window.location.reload()
  })
}

function Workspace({ self }: { self: UserIdentity }) {
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
    let cancelled = false
    const seed = () => {
      if (cancelled || files.size > 0) return
      ydoc.transact(() => {
        files.set('main.typ', new Y.Text(SAMPLE_MAIN))
        files.set('sections/intro.typ', new Y.Text(SAMPLE_INTRO))
      })
    }
    const syncedOrTimeout = (timeoutMs: number) =>
      new Promise<void>(resolve => {
        const provider = tryGetProvider()
        if (!provider || provider.synced) {
          resolve()
          return
        }
        const onSync = (synced: boolean) => {
          if (!synced) return
          clearTimeout(timer)
          resolve()
        }
        const timer = setTimeout(resolve, timeoutMs)
        provider.on('sync', onSync)
      })
    const idbDone = new Promise<void>(resolve => {
      idbPersistence.on('synced', () => resolve())
      setTimeout(resolve, 1500)
    })
    Promise.all([idbDone, syncedOrTimeout(5000)]).then(seed)
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (active !== null && files.has(active)) return
    setActive(files.has('main.typ') ? 'main.typ' : (paths[0] ?? null))
  }, [paths, active])

  useEffect(() => {
    if (authConfig.mode !== 'oidc') return
    const provider = getProvider()
    const refresh = () => {
      getAccessToken(authConfig)
        .then(updateCollabToken)
        .catch(() => {
          clearSessionAndReload()
        })
    }
    const onClosed = () => refresh()
    provider.on('connection-close', onClosed)
    provider.on('connection-error', onClosed)
    return () => {
      provider.off('connection-close', onClosed)
      provider.off('connection-error', onClosed)
    }
  }, [])

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
        self={self}
        status={status}
        roomName={roomName}
      />
      <main className="workspace">
        <section className="editor-pane">
          <div className="pane-header">
            <span className="pane-title">{active ?? 'No file open'}</span>
            <span className="pane-hint">
              editing together with {peers.length + 1} peer{peers.length !== 0 ? 's' : ''}
            </span>
            {authConfig.mode === 'oidc' && (
              <button className="ghost-btn" onClick={clearSessionAndReload}>
                Sign out
              </button>
            )}
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

function LoginScreen({ error }: { error?: string }) {
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="brand">
          <span className="brand-mark">P</span>
          <span className="brand-name">pretty-web</span>
        </div>
        <p>Sign in to start editing.</p>
        {error && <div className="auth-error">{error}</div>}
        <button className="primary-btn" onClick={() => login(authConfig)}>
          Sign in with authentik
        </button>
      </div>
    </div>
  )
}

function claimsFromStoredIdToken(): Record<string, unknown> {
  const raw = sessionStorage.getItem('pretty-web.tokens')
  if (!raw) throw new Error('Not authenticated')
  const tokens = JSON.parse(raw) as { idToken?: string }
  if (!tokens.idToken) throw new Error('No id_token stored')
  const payload = tokens.idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
  return JSON.parse(decodeURIComponent(atob(payload).split('').map(char => `%${`00${char.charCodeAt(0).toString(16)}`.slice(-2)}`).join('')))
}

function useOidcSession(): {
  state: 'loading' | 'login' | 'ready'
  profile: UserProfile | null
  error?: string
} {
  const [state, setState] = useState<'loading' | 'login' | 'ready'>('loading')
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [error, setError] = useState<string | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        if (hasAuthCodeCallback()) {
          const next = await handleAuthCallback(authConfig)
          if (cancelled) return
          setProfile(next)
          setState('ready')
          return
        }
        if (!isAuthenticated()) {
          if (!cancelled) setState('login')
          return
        }
        const claims = claimsFromStoredIdToken()
        if (cancelled) return
        setProfile({
          sub: String(claims.sub ?? 'user'),
          name: String(claims.preferred_username ?? claims.name ?? claims.email ?? 'user'),
          email: claims.email ? String(claims.email) : undefined
        })
        setState('ready')
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          setState('login')
        }
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [])

  return { state, profile, error }
}

export default function App() {
  if (authConfig.mode === 'proxy') return <ProxyApp />
  if (authConfig.mode === 'oidc') return <OidcApp />
  return <AnonymousApp />
}

function AnonymousApp() {
  const [self] = useState<UserIdentity>(() => randomUser())
  useEffect(() => {
    initCollab()
    setLocalUser(self)
  }, [self])
  return <Workspace self={self} />
}

function ProxyApp() {
  const [error, setError] = useState<string | null>(null)
  const [self, setSelf] = useState<UserIdentity | null>(null)

  useEffect(() => {
    let cancelled = false
    initCollab()
    fetchProxyIdentity()
      .then(profile => {
        if (cancelled) return
        const user = { name: profile.name, color: colorFor(profile.name) }
        setLocalUser(user)
        setSelf(user)
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (error) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <div className="brand">
            <span className="brand-mark">P</span>
            <span className="brand-name">pretty-web</span>
          </div>
          <div className="auth-error">{error}</div>
        </div>
      </div>
    )
  }
  if (!self) {
    return <div className="auth-screen">Checking your authentik session…</div>
  }
  return <Workspace self={self} />
}

function OidcApp() {
  const { state, profile, error } = useOidcSession()
  const [self, setSelf] = useState<UserIdentity | null>(null)

  useEffect(() => {
    if (state !== 'ready' || !profile) return
    getAccessToken(authConfig)
      .then(token => {
        initCollab({ token })
        const user = { name: profile.name, color: colorFor(profile.name) }
        setLocalUser(user)
        setSelf(user)
      })
      .catch(() => clearSessionAndReload())
  }, [state, profile])

  if (state === 'login') return <LoginScreen error={error} />
  if (state !== 'ready' || !self) {
    return <div className="auth-screen">Checking your session…</div>
  }
  return <Workspace self={self} />
}
