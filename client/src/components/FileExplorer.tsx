import { useMemo, useRef, useState } from 'react'
import type { Entry, EntryKind, UserIdentity } from '../collab'

interface FileExplorerProps {
  entries: Entry[]
  active: string | null
  onOpen: (path: string) => void
  onCreateFile: (path: string) => void
  onCreateFolder: (path: string) => void
  onDelete: (path: string) => void
  onRename: (path: string, next: string) => void
  onUpload: (fileList: FileList, targetDir: string) => void
  peers: UserIdentity[]
  self: UserIdentity
  status: string
  roomName: string
}

interface TreeNode {
  name: string
  path: string
  kind: EntryKind
  children: Map<string, TreeNode>
}

function buildTree(entries: Entry[]): TreeNode {
  const root: TreeNode = { name: '', path: '', kind: 'folder', children: new Map() }
  for (const entry of entries) {
    const parts = entry.path.split('/')
    let node = root
    parts.forEach((part, index) => {
      const kind = index === parts.length - 1 ? entry.kind : 'folder'
      const nodePath = parts.slice(0, index + 1).join('/')
      let child = node.children.get(part)
      if (!child) {
        child = { name: part, path: nodePath, kind, children: new Map() }
        node.children.set(part, child)
      }
      node = child
    })
  }
  return root
}

function sortNodes(nodes: Map<string, TreeNode>): TreeNode[] {
  return Array.from(nodes.values()).sort((a, b) => {
    if ((a.kind === 'folder') !== (b.kind === 'folder')) return a.kind === 'folder' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

function iconFor(node: TreeNode): string {
  if (node.kind === 'folder') return '▸'
  if (node.kind === 'asset') return '▣'
  return node.path.endsWith('.typ') ? 'P' : '≡'
}

function TreeItem({
  node,
  depth,
  active,
  onOpen,
  onDelete,
  onRename
}: {
  node: TreeNode
  depth: number
  active: string | null
  onOpen: (path: string) => void
  onDelete: (path: string) => void
  onRename: (path: string, next: string) => void
}) {
  const isFolder = node.kind === 'folder'
  const isActive = !isFolder && node.path === active
  const rename = (event: React.MouseEvent) => {
    event.stopPropagation()
    const next = window.prompt('New name', node.path)
    if (next && next !== node.path) onRename(node.path, next)
  }
  return (
    <div>
      <div
        className={`${isFolder ? 'folder-row' : 'file-row'}${isActive ? ' active' : ''}`}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        onClick={() => {
          if (isFolder) return
          onOpen(node.path)
        }}
      >
        <span className={isFolder ? 'folder-icon' : 'file-icon'}>{iconFor(node)}</span>
        <span className={isFolder ? 'folder-name' : 'file-name'} title={node.path}>
          {node.name}
        </span>
        <span className="file-actions">
          <button className="icon-btn" title="Rename" onClick={rename}>
            ✎
          </button>
          <button
            className="icon-btn danger"
            title="Delete"
            onClick={event => {
              event.stopPropagation()
              if (window.confirm(`Delete ${node.path}?`)) onDelete(node.path)
            }}
          >
            ×
          </button>
        </span>
      </div>
      {sortNodes(node.children).map(child => (
        <TreeItem
          key={child.path}
          node={child}
          depth={depth + 1}
          active={active}
          onOpen={onOpen}
          onDelete={onDelete}
          onRename={onRename}
        />
      ))}
    </div>
  )
}

export function FileExplorer({
  entries,
  active,
  onOpen,
  onCreateFile,
  onCreateFolder,
  onDelete,
  onRename,
  onUpload,
  peers,
  self,
  status,
  roomName
}: FileExplorerProps) {
  const [newName, setNewName] = useState('')
  const [createMode, setCreateMode] = useState<'file' | 'folder' | null>(null)
  const [dropping, setDropping] = useState(false)
  const uploadInput = useRef<HTMLInputElement>(null)
  const tree = useMemo(() => buildTree(entries), [entries])

  const cancel = () => {
    setCreateMode(null)
    setNewName('')
  }

  const submit = () => {
    const name = newName.trim().replace(/^\/+|\/+$/g, '')
    if (!name) {
      cancel()
      return
    }
    if (createMode === 'folder') onCreateFolder(name)
    else onCreateFile(name)
    cancel()
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="brand">
          <span className="brand-mark">P</span>
          <span className="brand-name">pretty-web</span>
        </div>
        <div className={`status-dot ${status}`} title={`Connection: ${status}`} />
      </div>

      <div className="room-label" title="Share this URL to collaborate in this room">
        room: <strong>{roomName}</strong>
      </div>

      <div className="section-title">
        <span>Files</span>
        <span className="section-actions">
          <button className="icon-btn" title="New file or folder" onClick={() => setCreateMode('file')}>
            +
          </button>
          <button
            className="icon-btn"
            title="Upload files (or drop them on the file list)"
            onClick={() => uploadInput.current?.click()}
          >
            ⇪
          </button>
        </span>
      </div>

      <input
        ref={uploadInput}
        type="file"
        multiple
        hidden
        onChange={event => {
          if (event.target.files && event.target.files.length > 0) onUpload(event.target.files, '')
          event.target.value = ''
        }}
      />

      <div
        className={`file-list${dropping ? ' dropping' : ''}`}
        onDragOver={event => {
          event.preventDefault()
          setDropping(true)
        }}
        onDragLeave={() => setDropping(false)}
        onDrop={event => {
          event.preventDefault()
          setDropping(false)
          if (event.dataTransfer.files.length > 0) onUpload(event.dataTransfer.files, '')
        }}
      >
        {entries.length === 0 && <div className="empty-hint">No files yet</div>}
        {sortNodes(tree.children).map(node => (
          <TreeItem
            key={node.path}
            node={node}
            depth={0}
            active={active}
            onOpen={onOpen}
            onDelete={onDelete}
            onRename={onRename}
          />
        ))}
        {createMode && (
          <div className="new-file-row">
            <div className="create-toggle">
              <button
                className={createMode === 'file' ? 'toggle-btn on' : 'toggle-btn'}
                onClick={() => setCreateMode('file')}
              >
                File
              </button>
              <button
                className={createMode === 'folder' ? 'toggle-btn on' : 'toggle-btn'}
                onClick={() => setCreateMode('folder')}
              >
                Folder
              </button>
            </div>
            <input
              autoFocus
              className="new-file-input"
              placeholder={createMode === 'folder' ? 'assets/images' : 'path/to/file.typ'}
              value={newName}
              onChange={event => setNewName(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') submit()
                if (event.key === 'Escape') cancel()
              }}
              onBlur={submit}
            />
          </div>
        )}
      </div>

      <div className="presence">
        <div className="presence-row">
          <span className="avatar" style={{ background: self.color }}>
            {self.name.slice(0, 1)}
          </span>
          <span className="presence-name">
            {self.name} <span className="you-tag">(you)</span>
          </span>
        </div>
        {peers.map(peer => (
          <div className="presence-row" key={`${peer.color}-${peer.name}`}>
            <span className="avatar" style={{ background: peer.color }}>
              {peer.name.slice(0, 1)}
            </span>
            <span className="presence-name">{peer.name}</span>
          </div>
        ))}
        {peers.length === 0 && <div className="presence-empty">Nobody else here</div>}
      </div>
    </aside>
  )
}
