import { useEffect, useState } from 'react'
import { isImagePath } from '../collab'
import type { ProjectAsset } from '../compiler'

function mimeFor(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const types: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    avif: 'image/avif',
    bmp: 'image/bmp',
    ico: 'image/x-icon',
    pdf: 'application/pdf',
    json: 'application/json'
  }
  return types[ext] ?? 'application/octet-stream'
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function AssetViewer({ asset }: { asset: ProjectAsset }) {
  const [url, setUrl] = useState<string | null>(null)
  const isImage = isImagePath(asset.path)

  useEffect(() => {
    if (!isImage) return
    const objectUrl = URL.createObjectURL(new Blob([asset.bytes as BlobPart], { type: mimeFor(asset.path) }))
    setUrl(objectUrl)
    return () => {
      URL.revokeObjectURL(objectUrl)
    }
  }, [asset.path, asset.bytes, isImage])

  const download = () => {
    const anchor = document.createElement('a')
    anchor.href = URL.createObjectURL(new Blob([asset.bytes as BlobPart], { type: mimeFor(asset.path) }))
    anchor.download = asset.path.split('/').pop() ?? 'file'
    anchor.click()
    URL.revokeObjectURL(anchor.href)
  }

  return (
    <div className="asset-view">
      {isImage && url ? (
        <img className="asset-image" src={url} alt={asset.path} />
      ) : (
        <div className="asset-info">
          <div className="asset-kind">binary asset</div>
          <div className="asset-size">{formatSize(asset.bytes.byteLength)}</div>
        </div>
      )}
      <button className="ghost-btn" onClick={download}>
        Download
      </button>
    </div>
  )
}
