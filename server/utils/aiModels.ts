/**
 * Single source of truth for which model each call site uses (a standard model registry, plus per-step profiles).
 *
 * Gateway-only: bare 'provider/model' strings resolve through the Vercel AI Gateway when
 * AI_GATEWAY_API_KEY is set. Every pipeline call goes through server/pipeline/llm.ts.
 * Server-side structured calls use `generateText + Output.object` with these strings.
 */
import type { Profile, StructureMethod } from '#shared/types'

export type ModelStep = 'outline' | 'extract' | 'resolve' | 'critique' | 'annotate' | 'classify' | 'agent'

export const PROFILES: Record<Profile, Record<ModelStep, string>> = {
  careful: {
    outline: 'anthropic/claude-opus-5.5',
    critique: 'anthropic/claude-opus-5.5',
    classify: 'anthropic/claude-opus-5.5',
    agent: 'anthropic/claude-opus-5.5',
    extract: 'anthropic/claude-sonnet-5.5',
    resolve: 'anthropic/claude-sonnet-5.5',
    annotate: 'anthropic/claude-sonnet-5.5'
  },
  standard: {
    outline: 'openai/gpt-6-sol',
    critique: 'openai/gpt-6-sol',
    classify: 'openai/gpt-6-sol',
    agent: 'anthropic/claude-sonnet-5.5',
    extract: 'anthropic/claude-sonnet-5.5',
    resolve: 'anthropic/claude-sonnet-5.5',
    annotate: 'anthropic/claude-sonnet-5.5'
  },
  quick: {
    outline: 'anthropic/claude-sonnet-5.5',
    critique: 'anthropic/claude-sonnet-5.5',
    classify: 'anthropic/claude-sonnet-5.5',
    agent: 'anthropic/claude-haiku-5.5',
    extract: 'anthropic/claude-haiku-5.5',
    resolve: 'anthropic/claude-haiku-5.5',
    annotate: 'anthropic/claude-haiku-5.5'
  }
}

/** Plan § Decisions: careful over 30 pages or 100k tokens, else standard; quick is manual. */
export function defaultProfileFor(sizeTokens: number, pages?: number): Profile {
  return sizeTokens > 100_000 || (pages ?? sizeTokens / 1000) > 30 ? 'careful' : 'standard'
}

/**
 * Sources at or above this size default to the agent method. Sprint 8's corpus (6k–134k tokens, plan § Corpus results)
 * found the two methods equivalent in structure and within ±8% in whole-run cost at every size, so the pipeline (no
 * sandbox, fixed cost) is the default for everything measured. Above 200k tokens the line-numbered whole-paper prompt
 * passes ~400k tokens and one outline call nears the Vercel step ceiling, while the agent reads only the long proofs;
 * that guard is untested (no corpus paper that large yet).
 */
export const AGENT_MIN_TOKENS = 200_000

export function defaultMethodFor(sizeTokens: number): StructureMethod {
  return sizeTokens >= AGENT_MIN_TOKENS ? 'agent' : 'pipeline'
}

export const MODELS = {
  chat: 'anthropic/claude-sonnet-5.5',
  titleGen: 'openai/gpt-6-luna'
} as const

/** Fallback USD per million tokens (Oct 29), used when the gateway doesn't report a cost. */
export const PRICES: Record<string, { input: number, output: number }> = {
  'anthropic/claude-opus-5.5': { input: 4, output: 20 },
  'anthropic/claude-sonnet-5.5': { input: 2, output: 10 },
  'anthropic/claude-haiku-5.5': { input: 0.1, output: 0.5 },
  'openai/gpt-6-sol': { input: 2, output: 10 },
  'openai/gpt-6-luna': { input: 0.1, output: 0.5 }
}

export interface TokenCounts {
  input: number // total input, cached included
  output: number
  cacheRead?: number
  cacheWrite?: number
}

// Cache reads bill at ~0.1x input and writes at ~1.25x on Anthropic; close enough for a fallback.
export function estimateCost(tokens: TokenCounts, model: string): number {
  const price = PRICES[model]
  if (!price) {
    return 0
  }
  const cacheRead = tokens.cacheRead ?? 0
  const cacheWrite = tokens.cacheWrite ?? 0
  const fresh = Math.max(0, tokens.input - cacheRead - cacheWrite)
  const inputUnits = fresh + cacheRead * 0.1 + cacheWrite * 1.25
  return (inputUnits * price.input + tokens.output * price.output) / 1_000_000
}
