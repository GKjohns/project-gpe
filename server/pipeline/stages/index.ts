import type { RunStage } from '#shared/types'
import { annotateStage } from './annotate'
import { chunkStage } from './chunk'
import { classifyStage } from './classify'
import { critiqueStage } from './critique'
import { extractStage } from './extract'
import { fetchStage } from './fetch'
import { finalizeStage } from './finalize'
import { outlineStage } from './outline'
import { resolveStage } from './resolve'
import type { StageFn } from './stub'

export type { StageFn }

export const STAGES: Record<RunStage, StageFn> = {
  fetch: fetchStage,
  chunk: chunkStage,
  outline: outlineStage,
  extract: extractStage,
  resolve: resolveStage,
  critique: critiqueStage,
  annotate: annotateStage,
  classify: classifyStage,
  finalize: finalizeStage
}
