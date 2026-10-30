// Loads what the chat tools read (stored LaTeX + the digest run's chunk/outline spans). Called lazily, once per request.
import { eq } from 'drizzle-orm'
import type { Outline, Skeleton } from '#shared/pipeline'
import type { PaperDigest } from '#shared/types'
import { useDb } from '../db'
import { papers, sources } from '../db/schema'
import { buildChatSources } from './chatTools'
import type { ChatSources } from './chatTools'
import { stageOutputs } from './stageOutputs'

export async function loadChatSources(slug: string, digest: PaperDigest): Promise<ChatSources | null> {
  const db = await useDb()
  const [paper] = await db.select({ id: papers.id }).from(papers).where(eq(papers.slug, slug))
  if (!paper) {
    return null
  }
  const files = await db.select({ path: sources.path, content: sources.content }).from(sources).where(eq(sources.paperId, paper.id))
  if (!files.length) {
    return null
  }
  const [skeleton, outline] = await Promise.all([
    stageOutputs.get<Skeleton>(digest.run_id, 'chunk'),
    stageOutputs.get<Outline>(digest.run_id, 'outline')
  ])
  return buildChatSources(files, skeleton, outline)
}
