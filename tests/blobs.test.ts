import type { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { blobStore, sha256 } from '../server/utils/blobs'
import { loadAssets, loadSourceText, storeSources } from '../server/utils/sourceStore'
import { setSupabase } from '../server/utils/supabase'
import { createFakeSupabase } from './helpers/fakeSupabase'

let fake: ReturnType<typeof createFakeSupabase>
const paperId = '00000000-0000-4000-8000-0000000000b1'

beforeEach(() => {
  fake = createFakeSupabase()
  setSupabase(fake.client)
  vi.stubGlobal('fetch', fake.fetchStub())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function readAll(stream: Readable): Promise<Uint8Array> {
  const parts: Buffer[] = []
  for await (const chunk of stream) {
    parts.push(Buffer.from(chunk as Uint8Array))
  }
  return new Uint8Array(Buffer.concat(parts))
}

describe('blobStore on Storage', () => {
  const bytes = new Uint8Array(Array.from({ length: 64 }, (_, i) => i))

  it('stores bytes once: one object, one meta row, same sha on a second put', async () => {
    const sha = await blobStore.put(bytes, 'application/pdf')
    expect(sha).toBe(sha256(bytes))
    expect(await blobStore.put(bytes, 'application/pdf')).toBe(sha)
    expect(fake.objects.size).toBe(1)
    expect(fake.tables.blobs).toHaveLength(1)
    expect(await blobStore.meta(sha)).toEqual({ contentType: 'application/pdf', size: 64 })
    expect((await blobStore.get(sha))!.data).toEqual(bytes)
  })

  it('treats an object that exists without a meta row as stored, then writes the row', async () => {
    const sha = sha256(bytes)
    fake.objects.set(`blobs/${sha}`, { bytes, contentType: 'application/pdf' })
    expect(await blobStore.put(bytes, 'application/pdf')).toBe(sha)
    expect(await blobStore.meta(sha)).toEqual({ contentType: 'application/pdf', size: 64 })
  })

  it('streams a byte range through the signed URL, and the whole object without one', async () => {
    const sha = await blobStore.put(bytes, 'application/pdf')
    expect(await readAll(await blobStore.stream(sha, { start: 10, end: 19 }))).toEqual(bytes.slice(10, 20))
    expect(await readAll(await blobStore.stream(sha))).toEqual(bytes)
  })

  it('meta and get are null for an unknown sha', async () => {
    expect(await blobStore.meta('0'.repeat(64))).toBeNull()
    expect(await blobStore.get('0'.repeat(64))).toBeNull()
  })
})

describe('sourceStore', () => {
  it('replaces a paper\'s sources and assets (insert new, then delete old) and leaves other papers alone', async () => {
    fake.tables.sources = [{ id: 'other', paper_id: 'someone-else', path: 'o.tex', content: 'o', bytes: 1 }]
    await storeSources(paperId, [{ path: 'b.tex', content: 'old' }, { path: 'fig.png', content: '', data: new Uint8Array([1, 2]) }])
    await storeSources(paperId, [{ path: 'b.tex', content: 'new b' }, { path: 'a.tex', content: 'new a' }, { path: 'fig.png', content: '', data: new Uint8Array([3]) }])
    expect(await loadSourceText(paperId)).toEqual([{ path: 'a.tex', content: 'new a' }, { path: 'b.tex', content: 'new b' }])
    expect(fake.tables.sources!.filter(r => r.paper_id === 'someone-else')).toHaveLength(1)
    const assets = await loadAssets(paperId)
    expect(assets.map(a => [a.path, [...a.data!]])).toEqual([['fig.png', [3]]])
  })
})
