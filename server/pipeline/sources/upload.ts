// Uploaded .tex files or one .zip → source files. Serverless request bodies cap out around 4.5 MB on Vercel.
import { unzipSync } from 'fflate'
import { isTextSource, SourceError } from './main'
import type { SourceFile } from './main'

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024

export interface UploadPart { filename?: string, data: Uint8Array }

const decoder = new TextDecoder('utf-8')
const text = (bytes: Uint8Array) => decoder.decode(bytes).replaceAll('\0', '')

export function filesFromUpload(parts: UploadPart[]): SourceFile[] {
  const named = parts.filter(p => p.filename)
  const total = named.reduce((n, p) => n + p.data.byteLength, 0)
  if (total > MAX_UPLOAD_BYTES) {
    throw new SourceError(`Upload is ${(total / 1024 / 1024).toFixed(1)} MB; the limit is 4 MB. Use a GitHub or arXiv source for bigger papers.`, 413)
  }
  const files: SourceFile[] = []
  for (const p of named) {
    const name = p.filename!.split(/[\\/]/).pop()!
    if (name.toLowerCase().endsWith('.zip')) {
      const entries = unzipSync(p.data, { filter: f => isTextSource(f.name) && !f.name.startsWith('__MACOSX/') })
      for (const [path, data] of Object.entries(entries)) {
        files.push({ path, content: text(data) })
      }
    } else if (isTextSource(name)) {
      files.push({ path: name, content: text(p.data) })
    }
  }
  if (!files.some(f => f.path.toLowerCase().endsWith('.tex'))) {
    throw new SourceError('Upload .tex files (or one .zip containing them)')
  }
  return files
}
