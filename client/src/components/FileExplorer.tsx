import { useMemo, useState } from 'react'
import type { UserIdentity } from '../collab'

interface FileExplorerProps {
  paths: string[]
  active: string | null
  onOpen: (path: string) => void
  onCreate: (path: string) => void
  onDelete: (path: string) => void
  onRename: (path: string, next: string) => void
  peers: UserIdentity[]
  self: UserIdentity
  status: string
  roomName: string
}

interface TreeNode {
  name: string
  path: string
  isFile: boolean
  children: Map<string, TreeNode>
}

function buildTree(paths: string[]): TreeNode {
  const root: TreeNode = { name: '', path: '', isFile: false, children: new Map() }
  for (const path of paths) {
    const parts = path.split('/')
    let node = root
    parts.forEach((part, index) => {
      const isFile = index === parts.length - 1
      const nodePath = parts.slice(0, index + 1).join('/')
      let child = node.children.get(part)
      if (!child) {
        child = { name: part, path: nodePath, isFile, children: new Map() }
        node.children.set(part, child)
      }
      node = child
    })
  }
  return root
}

function sortNodes(nodes: Map<string, TreeNode>): TreeNode[] {
  return Array.from(nodes.values()).sort((a, b) => {
    if (a.isFile !== b.isFile) return a.isFile ? 1 : -1
    return a.name.localeCompare(b.name)
  })
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
  if (node.isFile) {
    const isActive = node.path === active
    return (
      <div
        className={`file-row${isActive ? ' active' : ''}`}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        onClick={() => onOpen(node.path)}
      >
        <span className="file-icon">P</span>
        <span className="file-name" title={node.path}>
          {node.name}
        </span>
        <span className="file-actions">
          <button
            className="icon-btn"
            title="Rename"
            onClick={event => {
              event.stopPropagation()
              const next = window.prompt('New name', node.path)
              if (next && next !== node.path) onRename(node.path, next)
            }}
          >
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
    )
  }

  return (
    <div>
      <div className="folder-row" style={{ paddingLeft: `${8 + depth * 14}px` }}>
        <span className="folder-icon">▸</span>
        <span className="folder-name">{node.name}</span>
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
  paths,
  active,
  onOpen,
  onCreate,
  onDelete,
  onRename,
  peers,
  self,
  status,
  roomName
}: FileExplorerProps) {
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const tree = useMemo(() => buildTree(paths), [paths])

  const submit = () => {
    const name = newName.trim()
    if (name) onCreate(name.replace(/^\/+/, ''))
    setNewName('')
    setCreating(false)
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
        <button className="icon-btn" title="New file" onClick={() => setCreating(true)}>
          +
        </button>
      </div>

      <div className="file-list">
        {paths.length === 0 && <div className="empty-hint">No files yet</div>}
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
        {creating && (
          <div className="new-file-row">
            <input
              autoFocus
              className="new-file-input"
              placeholder="path/to/file.typ"
              value={newName}
              onChange={event => setNewName(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') submit()
                if (event.key === 'Escape') {
                  setCreating(false)
                  setNewName('')
                }
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
