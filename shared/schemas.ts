// Zod mirrors of the stage payloads in shared/pipeline.ts plus the model-output and request shapes.
import { z } from 'zod'
import type { CritiqueResult, Outline } from './pipeline'

const span = z.object({
  file: z.string(),
  startLine: z.number().int().nonnegative(),
  endLine: z.number().int().nonnegative()
})

export const outlineSchema = z.object({
  method: z.enum(['pipeline', 'agent']),
  claims: z.array(z.object({
    id: z.string().min(1),
    parentLabel: z.string().min(1),
    nameHint: z.string(),
    span,
    restsOn: z.array(z.string()),
    confidence: z.number().min(0).max(1)
  })),
  flags: z.array(z.object({
    kind: z.enum(['unused_statement', 'ref_to_nonstatement', 'suspect_span', 'possible_restatement', 'other']),
    label: z.string().optional(),
    note: z.string()
  })),
  stats: z.object({
    calls: z.number(),
    tokens_in: z.number(),
    tokens_out: z.number(),
    cost_usd: z.number(),
    wallclock_ms: z.number(),
    turns: z.number().optional()
  })
}) satisfies z.ZodType<Outline>

// What the outline model returns; method and stats are filled in by the stage, not the model.
export const outlineModelSchema = outlineSchema.pick({ claims: true, flags: true })

export const critiqueSchema = z.object({
  fixes: z.array(z.object({
    kind: z.enum(['merge', 'split', 'drop', 'reparent', 'add_edge', 'remove_edge']),
    target: z.array(z.string()),
    note: z.string(),
    confidence: z.number().min(0).max(1)
  })),
  ok: z.boolean()
}) satisfies z.ZodType<CritiqueResult>

// extract: one call per outlined claim.
export const extractClaimSchema = z.object({
  statement_paper: z.string().min(1),
  kind: z.literal('claim')
})

// resolve: prose dependencies the \ref graph misses.
export const inferredDepsSchema = z.object({
  deps: z.array(z.object({
    id: z.string(),
    reason: z.string()
  }))
})

// annotate: one call per node, deps already explained.
export const annotateSchema = z.object({
  name: z.string().min(1),
  statement_plain: z.string().min(1),
  explanation: z.string().min(1)
})

// annotate's graph-labels pass: one call per paper, every node's card headline + role.
export const graphLabelsSchema = z.object({
  labels: z.array(z.object({
    id: z.string(),
    headline: z.string().min(1),
    role: z.string()
  }))
})

// classify: novel must justify why nothing prior covers it.
export const classifySchema = z.object({
  classification: z.enum(['standard', 'routine', 'novel', 'unknown']),
  classification_cite: z.string().optional()
})

export const RESERVED_SLUGS = ['papers', 'corpus', 'api', 'toy'] as const

export const slugSchema = z.string()
  .regex(/^[a-z0-9-]{2,40}$/, 'Use 2–40 lowercase letters, digits or dashes')
  .refine(s => !(RESERVED_SLUGS as readonly string[]).includes(s), 'That slug is reserved')

export const paperSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('github'), url: z.string().url() }),
  z.object({ kind: z.literal('arxiv'), id: z.string().min(1) }),
  z.object({ kind: z.literal('upload') })
])

export const createPaperSchema = z.object({
  title: z.string().min(1).max(300),
  slug: slugSchema,
  source: paperSourceSchema,
  profile: z.enum(['careful', 'standard', 'quick']),
  method: z.enum(['pipeline', 'agent']),
  budgetUsd: z.number().positive().max(500)
})

export type CreatePaperBody = z.infer<typeof createPaperSchema>
export type PaperSourceInput = z.infer<typeof paperSourceSchema>
