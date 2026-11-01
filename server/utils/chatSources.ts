// Loads what the chat tools read (stored LaTeX + the digest run's chunk/outline spans). Called lazily, once per request.
import type { Outline, Skeleton } from '#shared/pipeline'
import type { PaperDigest } from '#shared/types'
import { buildChatSources } from './chatTools'
import type { ChatSources } from './chatTools'
import { stageOutputs } from './stageOutputs'
import { must, useSupabase } from './supabase'

export async function loadChatSources(slug: string, digest: PaperDigest): Promise<ChatSources | null> {
  const supa = useSupabase()
  const paper = must(await supa.from('papers').select('id').eq('slug', slug).maybeSingle())
  if (!paper) {
    return null
  }
  // A paper's sources are a few dozen files at most (order is rebuilt by buildChatSources).
  const files = must(await supa.from('sources').select('path, content').eq('paper_id', paper.id).order('path'))
  if (!files.length) {
    return null
  }
  const [skeleton, outline] = await Promise.all([
    stageOutputs.get<Skeleton>(digest.run_id, 'chunk'),
    stageOutputs.get<Outline>(digest.run_id, 'outline')
  ])
  return buildChatSources(files, skeleton, outline)
}
