// GET /api/papers — the public list: papers with `public` set and a digest, plus their openai/math family. No runs,
// costs or progress (the operator library is GET /api/admin/papers).
import type { PublicPaperItem } from '#shared/api'
import { listPublicPaperItems } from '../utils/agentApi'

export default defineEventHandler((): Promise<PublicPaperItem[]> => listPublicPaperItems())
