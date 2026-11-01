// Content-addressed binary storage: bytes in the private Storage bucket `blobs` (object key = sha256), metadata in the
// `blobs` table so source_assets keeps its FK and meta() is one indexed read. PDFs ~1 MB, figure PNGs ~100 KB;
// /api/blobs/<sha> streams them with Range support through a short-lived signed URL.
import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import { BLOB_BUCKET, must, useSupabase } from './supabase'

export const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex')

const CACHE_SECONDS = '31536000'

/** Storage answers a second upload of the same key with "already exists" (statusCode 409); for us that's success. */
export function storageKeyExists(error: { message?: string, statusCode?: string, error?: string }) {
  return error.statusCode === '409' || error.error === 'Duplicate' || /already exists/i.test(error.message ?? '')
}

/** Stores bytes once; returns their sha. Object first, then the meta row, so a meta row always has bytes behind it. */
async function put(data: Uint8Array, contentType: string): Promise<string> {
  const sha = sha256(data)
  const supa = useSupabase()
  if (await meta(sha)) {
    return sha
  }
  const { error } = await supa.storage.from(BLOB_BUCKET).upload(sha, data, { contentType, upsert: false, cacheControl: CACHE_SECONDS })
  if (error && !storageKeyExists(error as never)) {
    must({ data: null, error })
  }
  must(await supa.from('blobs').upsert({ sha, content_type: contentType, size: data.byteLength }, { onConflict: 'sha', ignoreDuplicates: true }))
  return sha
}

async function meta(sha: string): Promise<{ contentType: string, size: number } | null> {
  const row = must(await useSupabase().from('blobs').select('content_type, size').eq('sha', sha).maybeSingle())
  return row ? { contentType: row.content_type, size: row.size } : null
}

async function get(sha: string): Promise<{ contentType: string, data: Uint8Array } | null> {
  const m = await meta(sha)
  if (!m) {
    return null
  }
  const blob = must(await useSupabase().storage.from(BLOB_BUCKET).download(sha))
  return { contentType: m.contentType, data: new Uint8Array(await blob.arrayBuffer()) }
}

/**
 * The object's bytes as a Node stream, optionally only start..end (inclusive), via a 60-s signed URL with the Range
 * header passed through, so a range request never loads the whole PDF into the function (Camera Shy's openArtifactRead).
 */
async function stream(sha: string, range?: { start: number, end: number }): Promise<Readable> {
  const { signedUrl } = must(await useSupabase().storage.from(BLOB_BUCKET).createSignedUrl(sha, 60))
  const res = await fetch(signedUrl, range ? { headers: { Range: `bytes=${range.start}-${range.end}` } } : undefined)
  if (!res.ok || !res.body) {
    throw new Error(`blob ${sha.slice(0, 12)}: storage answered ${res.status}`)
  }
  return Readable.fromWeb(res.body as WebReadableStream<Uint8Array>)
}

export const blobUrl = (sha: string) => `/api/blobs/${sha}`

// A namespace object so Nitro's auto-import doesn't put bare `get` / `put` in global scope.
export const blobStore = { put, get, meta, stream }
