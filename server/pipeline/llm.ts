// Every pipeline model call goes through here: one place for caching, schema retry, usage and cost.
import { generateText, NoObjectGeneratedError, Output } from 'ai'
import type { LanguageModelUsage, ProviderMetadata } from 'ai'
import type { z } from 'zod'
import type { RunStage } from '#shared/types'
import { estimateCost } from '../utils/aiModels'
import { addCost, appendEvent, bumpProgress } from '../utils/runs'

export type Reasoning = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

export interface CallObjectOptions<T> {
  model: string // bare 'provider/model'; resolves through the AI Gateway
  schema: z.ZodType<T>
  instructions: string
  prompt: string
  reasoning?: Reasoning
  cache?: boolean // gateway caching: 'auto' — use when the prompt starts with a big shared prefix
  // Additive to the contract: where usage is recorded. Omit both for a call outside a run.
  runId?: string
  stage?: RunStage
}

export interface CallUsage {
  model: string
  tokens_in: number
  tokens_out: number
  tokens_cached: number
  cost_usd: number
  cost_source: 'gateway' | 'price_table'
  ms: number
  retried: boolean
}

function gatewayCost(meta: ProviderMetadata | undefined): number | null {
  const raw = (meta?.gateway as Record<string, unknown> | undefined)?.cost
  const n = typeof raw === 'string' ? Number.parseFloat(raw) : typeof raw === 'number' ? raw : Number.NaN
  return Number.isFinite(n) ? n : null
}

function tally(model: string, usage: LanguageModelUsage | undefined, meta: ProviderMetadata | undefined) {
  const tokens = {
    input: usage?.inputTokens ?? 0,
    output: usage?.outputTokens ?? 0,
    cacheRead: usage?.inputTokenDetails?.cacheReadTokens ?? 0,
    cacheWrite: usage?.inputTokenDetails?.cacheWriteTokens ?? 0
  }
  const reported = gatewayCost(meta)
  return {
    tokens,
    cost: reported ?? estimateCost(tokens, model),
    source: (reported === null ? 'price_table' : 'gateway') as CallUsage['cost_source']
  }
}

export async function callObject<T>(opts: CallObjectOptions<T>): Promise<{ object: T, usage: CallUsage }> {
  const t0 = Date.now()
  const totals = { input: 0, output: 0, cached: 0, cost: 0 }
  let source: CallUsage['cost_source'] = 'gateway'

  const add = (t: ReturnType<typeof tally>) => {
    totals.input += t.tokens.input
    totals.output += t.tokens.output
    totals.cached += t.tokens.cacheRead
    totals.cost += t.cost
    if (t.source === 'price_table') {
      source = 'price_table'
    }
  }

  const attempt = async (prompt: string) => {
    try {
      const result = await generateText({
        model: opts.model,
        instructions: opts.instructions,
        prompt,
        output: Output.object({ schema: opts.schema }),
        ...(opts.reasoning ? { reasoning: opts.reasoning } : {}),
        ...(opts.cache ? { providerOptions: { gateway: { caching: 'auto' } } } : {})
      })
      const t = tally(opts.model, result.totalUsage, result.providerMetadata)
      add(t)
      return result.output as T
    } catch (err) {
      // A failed parse still cost tokens.
      if (NoObjectGeneratedError.isInstance(err)) {
        add(tally(opts.model, err.usage, undefined))
      }
      throw err
    }
  }

  let retried = false
  let object: T
  try {
    try {
      object = await attempt(opts.prompt)
    } catch (err) {
      if (!NoObjectGeneratedError.isInstance(err)) {
        throw err
      }
      retried = true
      if (opts.runId) {
        await bumpProgress(opts.runId, 'schema_retries')
      }
      const why = err.cause instanceof Error ? err.cause.message : err.message
      object = await attempt(`${opts.prompt}\n\n---\nYour previous answer did not match the required schema:\n${why}\nReturn only output that matches the schema.`)
    }
  } finally {
    // Record spend even when the call ultimately fails, so the budget check sees it.
    if (opts.runId && (totals.input || totals.output)) {
      await addCost(opts.runId, totals.cost)
      await bumpProgress(opts.runId, 'calls')
      await appendEvent(opts.runId, opts.stage ?? 'run', 'info', `model call ${opts.model}`, {
        model: opts.model,
        tokens_in: totals.input,
        tokens_out: totals.output,
        tokens_cached: totals.cached,
        cost_usd: totals.cost,
        cost_source: source,
        retried,
        ms: Date.now() - t0
      })
    }
  }

  return {
    object,
    usage: {
      model: opts.model,
      tokens_in: totals.input,
      tokens_out: totals.output,
      tokens_cached: totals.cached,
      cost_usd: totals.cost,
      cost_source: source,
      ms: Date.now() - t0,
      retried
    }
  }
}
