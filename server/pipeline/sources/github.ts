// GitHub directory → source files. Listing goes through the REST API (rate-limited: 60/h unauthenticated,
// GITHUB_TOKEN raises it); file bodies come from download_url on raw.githubusercontent.com, which isn't.
import { posix } from 'node:path'
import { isAsset, isTextSource, MAX_ASSET_BYTES, SourceError } from './main'
import type { SourceFile } from './main'

export interface GithubTarget { owner: string, repo: string, ref?: string, path: string }

/** github.com/<owner>/<repo>[/tree|blob/<ref>/<path>]; a blob URL means its directory. */
export function parseGithubUrl(url: string): GithubTarget {
  let u: URL
  try {
    u = new URL(url.trim())
  } catch {
    throw new SourceError('That is not a URL')
  }
  if (u.hostname !== 'github.com' && u.hostname !== 'www.github.com') {
    throw new SourceError('Expected a github.com URL')
  }
  const [owner, repo, kind, ref, ...rest] = u.pathname.split('/').filter(Boolean).map(decodeURIComponent)
  if (!owner || !repo) {
    throw new SourceError('Expected github.com/<owner>/<repo>/tree/<ref>/<path>')
  }
  const name = repo.replace(/\.git$/, '')
  if (!kind) {
    return { owner, repo: name, path: '' }
  }
  if ((kind !== 'tree' && kind !== 'blob') || !ref) {
    throw new SourceError('Expected github.com/<owner>/<repo>/tree/<ref>/<path>')
  }
  const path = rest.join('/')
  return { owner, repo: name, ref, path: kind === 'blob' ? posix.dirname(path).replace(/^\.$/, '') : path }
}

interface ContentEntry { type: 'file' | 'dir' | 'symlink' | 'submodule', name: string, path: string, size: number, download_url: string | null }

const MAX_FILES = 200
const MAX_ASSET_FILES = 200
const MAX_DEPTH = 3

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Accept': 'application/vnd.github+json', 'User-Agent': 'gpe-ingest' }
  if (process.env.GITHUB_TOKEN) {
    h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  }
  return h
}

async function list(t: GithubTarget, path: string): Promise<ContentEntry[]> {
  const qs = t.ref ? `?ref=${encodeURIComponent(t.ref)}` : ''
  const res = await fetch(`https://api.github.com/repos/${t.owner}/${t.repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}${qs}`, { headers: headers() })
  if (res.status === 404) {
    throw new SourceError(`GitHub: ${t.owner}/${t.repo}/${path || '(root)'} not found${t.ref ? ` at ${t.ref}` : ''}`, 404)
  }
  if (res.status === 403 || res.status === 429) {
    throw new SourceError('GitHub API rate limit hit; set GITHUB_TOKEN to raise it', 429)
  }
  if (!res.ok) {
    throw new SourceError(`GitHub API error ${res.status}`, 502)
  }
  const body = await res.json() as ContentEntry | ContentEntry[]
  return Array.isArray(body) ? body : [body]
}

/**
 * Every .tex/.bib/.sty/.cls/.bbl under the directory (up to 3 levels deep), paths relative to it, plus the assets a
 * compile needs (figures' images, TikZ inputs, data tables; see ASSET_EXTS) as bytes.
 */
export async function fetchGithub(url: string): Promise<SourceFile[]> {
  const t = parseGithubUrl(url)
  const wanted: ContentEntry[] = []
  const assets: ContentEntry[] = []
  const walk = async (path: string, depth: number) => {
    for (const e of await list(t, path)) {
      if (e.type === 'dir' && depth < MAX_DEPTH) {
        await walk(e.path, depth + 1)
      } else if (e.type === 'file' && isTextSource(e.name) && e.download_url) {
        wanted.push(e)
      } else if (e.type === 'file' && isAsset(e.name) && e.download_url && assets.length < MAX_ASSET_FILES) {
        assets.push(e)
      }
    }
  }
  await walk(t.path, 0)
  if (!wanted.length) {
    throw new SourceError('No .tex files in that GitHub directory')
  }
  if (wanted.length > MAX_FILES) {
    throw new SourceError(`That directory has ${wanted.length} source files; the limit is ${MAX_FILES}`)
  }
  const prefix = t.path ? `${t.path}/` : ''
  const rel = (p: string) => p.startsWith(prefix) ? p.slice(prefix.length) : p
  const auth = process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : undefined
  const text = Promise.all(wanted.map(async (e) => {
    const res = await fetch(e.download_url!, { headers: auth })
    if (!res.ok) {
      throw new SourceError(`GitHub: could not download ${e.path} (${res.status})`, 502)
    }
    return { path: rel(e.path), content: (await res.text()).replaceAll('\0', '') }
  }))
  // Assets are best effort: a missing image costs a figure, not the run.
  const bin = Promise.all(assets.filter(e => e.size <= MAX_ASSET_BYTES).map(async (e): Promise<SourceFile | null> => {
    const res = await fetch(e.download_url!, { headers: auth }).catch(() => null)
    return res?.ok ? { path: rel(e.path), content: '', data: new Uint8Array(await res.arrayBuffer()) } : null
  }))
  return [...await text, ...(await bin).filter((f): f is SourceFile => f !== null)]
}
