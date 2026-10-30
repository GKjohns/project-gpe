// arXiv e-print → source files. The e-print is a gzipped tarball, or a gzipped single .tex for one-file papers.
import { Readable } from 'node:stream'
import { gunzipSync } from 'fflate'
import tar from 'tar-stream'
import { isAsset, isTextSource, SourceError } from './main'
import type { SourceFile } from './main'

const ID_RE = /^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?$/

/** Accepts a bare id, `arXiv:` prefix, or an abs/pdf/e-print URL. */
export function parseArxivId(input: string): string {
  const s = input.trim()
    .replace(/^arxiv:/i, '')
    .replace(/^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf|e-print)\//, '')
    .replace(/\.pdf$/, '')
  if (!ID_RE.test(s)) {
    throw new SourceError(`"${input}" is not an arXiv id (e.g. 1907.00847)`)
  }
  return s
}

const decoder = new TextDecoder('utf-8')
const text = (bytes: Uint8Array) => decoder.decode(bytes).replaceAll('\0', '')

async function untar(bytes: Uint8Array): Promise<SourceFile[]> {
  const files: SourceFile[] = []
  const extract = tar.extract()
  await new Promise<void>((resolve, reject) => {
    extract.on('entry', (header, stream, next) => {
      const chunks: Buffer[] = []
      stream.on('data', (c: unknown) => chunks.push(c as Buffer))
      stream.on('end', () => {
        const path = header.name.replace(/^\.\//, '')
        if (header.type === 'file' && isTextSource(path)) {
          files.push({ path, content: text(Buffer.concat(chunks)) })
        } else if (header.type === 'file' && isAsset(path)) {
          files.push({ path, content: '', data: new Uint8Array(Buffer.concat(chunks)) })
        }
        next()
      })
      stream.on('error', reject)
    })
    extract.on('finish', resolve)
    extract.on('error', reject)
    Readable.from([Buffer.from(bytes)]).pipe(extract)
  })
  return files
}

const isTar = (b: Uint8Array) => b.length > 262 && decoder.decode(b.subarray(257, 262)) === 'ustar'

/** arXiv asks bulk clients to identify themselves; set ARXIV_CONTACT_EMAIL to add a contact address. */
function arxivUserAgent(): string {
  const email = process.env.ARXIV_CONTACT_EMAIL?.trim()
  return email ? `gpe-ingest (mailto:${email})` : 'gpe-ingest'
}

export async function fetchArxiv(input: string): Promise<SourceFile[]> {
  const id = parseArxivId(input)
  const res = await fetch(`https://arxiv.org/e-print/${id}`, { headers: { 'User-Agent': arxivUserAgent() } })
  if (res.status === 404) {
    throw new SourceError(`arXiv ${id} not found`, 404)
  }
  if (!res.ok) {
    throw new SourceError(`arXiv e-print fetch failed (${res.status})`, 502)
  }
  let bytes: Uint8Array = new Uint8Array(await res.arrayBuffer())
  if (bytes[0] === 0x1F && bytes[1] === 0x8B) {
    bytes = gunzipSync(bytes)
  }
  if (decoder.decode(bytes.subarray(0, 5)) === '%PDF-') {
    throw new SourceError(`arXiv ${id} has no LaTeX source (PDF only)`, 422)
  }
  const files = isTar(bytes) ? await untar(bytes) : [{ path: `${id.replace('/', '_')}.tex`, content: text(bytes) }]
  if (!files.some(f => !f.data && f.path.toLowerCase().endsWith('.tex'))) {
    throw new SourceError(`arXiv ${id}: no .tex files in the e-print`, 422)
  }
  return files
}
