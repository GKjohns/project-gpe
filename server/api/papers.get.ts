// GET /api/papers — the public list: papers with `public` set and a digest, plus their openai/math family. No runs,
// costs or progress (the operator library is GET /api/admin/papers).
import type { PublicPaperItem } from '#shared/api'
import { listPublicPaperItems } from '../utils/agentApi'

export default defineEventHandler(async (event): Promise<PublicPaperItem[]> => {
  const items = await listPublicPaperItems()
  // Set after the load so a failed request is never cached. 60 s matches the public-flag TTL.
  setResponseHeader(event, 'cache-control', 'public, max-age=60')
  return items
})
