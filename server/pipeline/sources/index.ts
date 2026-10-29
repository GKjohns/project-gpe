import type { PaperSourceInput } from '#shared/schemas'
import { fetchArxiv, parseArxivId } from './arxiv'
import { fetchGithub } from './github'
import type { SourceFile } from './main'

export * from './main'

// The form previews a source and then submits it; keep the download for a few minutes so fetch doesn't repeat it.
const cache = new Map<string, { at: number, files: Promise<SourceFile[]> }>()
const TTL_MS = 10 * 60 * 1000

export function sourceRef(source: Exclude<PaperSourceInput, { kind: 'upload' }>): string {
  return source.kind === 'github' ? source.url.trim() : parseArxivId(source.id)
}

/** Downloads a remote source (GitHub directory or arXiv e-print). Uploads are stored by POST /api/papers instead. */
export function fetchRemoteSource(kind: 'github' | 'arxiv', ref: string): Promise<SourceFile[]> {
  const key = `${kind}:${ref}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) {
    return hit.files
  }
  const files = kind === 'github' ? fetchGithub(ref) : fetchArxiv(ref)
  cache.set(key, { at: Date.now(), files })
  files.catch(() => cache.delete(key))
  return files
}
