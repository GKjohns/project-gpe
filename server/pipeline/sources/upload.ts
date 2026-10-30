// Uploaded .tex files or one .zip → source files (figures' images included). Vercel caps a function's request body
// at 4.5 MB, so a deployed upload stays under that; dev and self-hosted servers take bigger zips.
import { unzipSync } from 'fflate'
import { isAsset, isTextSource, SourceError } from './main'
import type { SourceFile } from './main'

export const MAX_UPLOAD_BYTES = process.env.VERCEL ? 4.4 * 1024 * 1024 : 32 * 1024 * 1024
const limitText = () => `${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024 * 10) / 10} MB`

export interface UploadPart { filename?: string, data: Uint8Array }

const decoder = new TextDecoder('utf-8')
const text = (bytes: Uint8Array) => decoder.decode(bytes).replaceAll('\0', '')

export function filesFromUpload(parts: UploadPart[]): SourceFile[] {
  const named = parts.filter(p => p.filename)
  const total = named.reduce((n, p) => n + p.data.byteLength, 0)
  if (total > MAX_UPLOAD_BYTES) {
    throw new SourceError(`Upload is ${(total / 1024 / 1024).toFixed(1)} MB; the limit is ${limitText()}. Use a GitHub or arXiv source for bigger papers.`, 413)
  }
  const files: SourceFile[] = []
  for (const p of named) {
    const name = p.filename!.split(/[\\/]/).pop()!
    if (name.toLowerCase().endsWith('.zip')) {
      const entries = unzipSync(p.data, { filter: f => !f.name.startsWith('__MACOSX/') && (isTextSource(f.name) || isAsset(f.name)) })
      for (const [path, data] of Object.entries(entries)) {
        files.push(isTextSource(path) ? { path, content: text(data) } : { path, content: '', data })
      }
    } else if (isTextSource(name)) {
      files.push({ path: name, content: text(p.data) })
    } else if (isAsset(name)) {
      files.push({ path: name, content: '', data: p.data })
    }
  }
  if (!files.some(f => !f.data && f.path.toLowerCase().endsWith('.tex'))) {
    throw new SourceError('Upload .tex files (or one .zip containing them)')
  }
  return files
}
