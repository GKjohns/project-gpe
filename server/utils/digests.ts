// Loading a paper's digest and figure images, shared by the chat route and the MCP endpoint.
import { eq } from 'drizzle-orm'
import type { PaperDigest } from '#shared/types'
import { useDb } from '../db'
import { papers } from '../db/schema'
import { toyDigest } from '../fixtures/toy-digest'
import { blobStore } from './blobs'
import type { FigureImageLoader } from './chatTools'

export async function loadDigest(slug: string): Promise<PaperDigest | null> {
  const db = await useDb()
  const [row] = await db.select({ digest: papers.digest }).from(papers).where(eq(papers.slug, slug))
  if (row) {
    return row.digest ?? null
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
