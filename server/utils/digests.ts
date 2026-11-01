// Loading a paper's digest and figure images, shared by the chat route and the MCP endpoint.
import type { PaperDigest } from '#shared/types'
import { toyDigest } from '../fixtures/toy-digest'
import { blobStore } from './blobs'
import type { FigureImageLoader } from './chatTools'
import { must, useSupabase } from './supabase'

export async function loadDigest(slug: string): Promise<PaperDigest | null> {
  const row = must(await useSupabase().from('papers').select('digest').eq('slug', slug).maybeSingle())
  if (row) {
    return (row.digest as unknown as PaperDigest | null) ?? null
  }
  // Same fallback as GET /api/papers/toy.
  return import.meta.dev && slug === 'toy' ? toyDigest : null
}

/** Figure PNGs live in the blob table (`/api/blobs/<sha>`); anything else, or anything large, stays text-only. */
const FIGURE_IMAGE_BYTES = 3_000_000
export const loadFigureImage: FigureImageLoader = async (figure) => {
  const sha = /^\/api\/blobs\/([0-9a-f]{64})$/.exec(figure.image_url ?? '')?.[1]
  const blob = sha ? await blobStore.get(sha) : null
  return blob && blob.contentType.startsWith('image/') && blob.data.byteLength <= FIGURE_IMAGE_BYTES
    ? { data: blob.data, mediaType: blob.contentType }
    : null
}
