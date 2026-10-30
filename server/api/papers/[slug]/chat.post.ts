/**
 * POST /api/papers/:slug/chat — the `useChat` transport for one paper (Sprint 7).
 *
 * No persistence: the whole digest rides in the instructions (gateway caching makes every turn after the first,
 * and every tool step, a cache read). Up to 4 tool rounds (read_node, search_paper, trace, ancestors, view_figure — which also hands the model the figure PNG; the paper's
 * sources load lazily, once, only when a tool needs them), then a forced answer. History is pruned once (old tool
 * calls dropped) and capped at CHAT_HISTORY_CHARS; provider errors reach the reader as one calm sentence.
 * Closing the request (Stop, tab close) aborts upstream.
 *
 * Public, but bounded for non-operators (server/utils/chatLimits.ts): turns per IP per hour and a daily spend
 * ceiling, both in memory per instance. A limited turn is a 429 before any model call; the client turns it into a sentence.
 */
import type { UIMessage } from 'ai'
import { convertToModelMessages, createUIMessageStreamResponse, isStepCount, pruneMessages, streamText, toUIMessageStream } from 'ai'
import { z } from 'zod'
import type { ChatTurnMetadata } from '#shared/api'
import { estimateCost, MODELS } from '../../../utils/aiModels'
import { CHAT_UNAVAILABLE, chatInstructions, citedIds, trimHistory } from '../../../utils/chat'
import { CHAT_RATE_LIMITED, chatLimiter } from '../../../utils/chatLimits'
import { loadChatSources } from '../../../utils/chatSources'
import type { ChatSources } from '../../../utils/chatTools'
import { chatTools } from '../../../utils/chatTools'
import { loadDigest, loadFigureImage } from '../../../utils/digests'
import { isOperator } from '../../../utils/operator'

/** isStepCount(CHAT_STEPS): at most CHAT_STEPS - 1 tool rounds, and the last step must answer. */
const CHAT_STEPS = 5

const bodySchema = z.object({
  id: z.string().optional(),
  messages: z.array(z.custom<UIMessage>(m => typeof m === 'object' && m !== null && 'role' in m && 'parts' in m)).min(1).max(200),
  trigger: z.string().optional(),
  messageId: z.string().optional()
})

function gatewayCost(meta: unknown): number | null {
  const raw = (meta as { gateway?: { cost?: unknown } } | undefined)?.gateway?.cost
  const n = typeof raw === 'string' ? Number.parseFloat(raw) : typeof raw === 'number' ? raw : Number.NaN
  return Number.isFinite(n) ? n : null
}

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') ?? ''
  const body = await readValidatedBody(event, bodySchema.parse)
  const digest = await loadDigest(slug)
  if (!digest) {
    throw createError({ statusCode: 404, statusMessage: `No digest for "${slug}"` })
  }

  // Operators chat freely; everyone else is admitted by the limiter, and their turns' cost counts toward the day.
  const limiter = (await isOperator(event)) ? null : chatLimiter()
  if (limiter) {
    // On Vercel x-forwarded-for is set by the edge (a client-sent value is overwritten), so its first hop is the client.
    const ip = getRequestIP(event, { xForwardedFor: true }) ?? 'unknown'
    const admitted = limiter.admit(ip)
    if (!admitted.ok) {
      console.info(`[chat ${slug}] limited (${admitted.reason}) ${ip} · today $${limiter.spend.spent().toFixed(2)}`)
      if (admitted.retryAfterMs) {
        setResponseHeader(event, 'retry-after', Math.ceil(admitted.retryAfterMs / 1000))
      }
      throw createError({
        statusCode: 429,
        statusMessage: admitted.reason === 'rate' ? CHAT_RATE_LIMITED : CHAT_UNAVAILABLE,
        data: { reason: admitted.reason }
      })
    }
  }
  let recorded = false
  const recordSpend = (usd: number) => {
    if (limiter && !recorded) {
      recorded = true
      limiter.record(usd)
    }
  }

  const model = MODELS.chat
  const modelMessages = trimHistory(pruneMessages({
    messages: await convertToModelMessages(body.messages.map(({ id: _id, ...m }) => m)),
    reasoning: 'before-last-message',
    // Earlier turns' tool calls/results are spent; their answers stay. Keeps history (and cost) flat.
    toolCalls: 'before-last-message',
    emptyMessages: 'remove'
  }))

  // Stop button / tab close → the request closes → stop paying for tokens nobody reads.
  const abortController = new AbortController()
  event.node.res.on('close', () => abortController.abort())

  const known = new Set(digest.nodes.map(n => n.id))
  const t0 = Date.now()
  // Summed over steps: each tool round is its own gateway call.
  const stepCosts: (number | null)[] = []

  let sources: Promise<ChatSources | null> | null = null
  const getSources = () => sources ??= loadChatSources(slug, digest).catch((err) => {
    console.warn(`[chat ${slug}] sources unavailable:`, (err as Error).message)
    return null
  })

  const result = streamText({
    model,
    instructions: chatInstructions(digest),
    messages: modelMessages,
    tools: chatTools(digest, getSources, loadFigureImage),
    stopWhen: isStepCount(CHAT_STEPS),
    // Last step answers. toolChoice (not activeTools) so the tool list, and with it the cached prefix, stays the same.
    prepareStep: ({ stepNumber }) => stepNumber >= CHAT_STEPS - 1 ? { toolChoice: 'none' } : undefined,
    abortSignal: abortController.signal,
    providerOptions: { gateway: { caching: 'auto' } },
    onFinish: ({ steps, totalUsage }) => {
      const text = steps.map(s => s.text).join('\n')
      const unknown = citedIds(text).filter(id => !known.has(id))
      const tools = steps.flatMap(s => s.toolCalls.map(c => c.toolName))
      const costs = steps.map(s => gatewayCost(s.providerMetadata))
      const cost = costs.every(c => c !== null) ? `$${costs.reduce((a, c) => a + c!, 0).toFixed(4)} gateway` : 'cost n/a'
      console.info(`[chat ${slug}] ${steps.length} steps${tools.length ? ` (${tools.join(', ')})` : ''} · ${totalUsage.inputTokens ?? 0} in (${totalUsage.inputTokenDetails?.cacheReadTokens ?? 0} cached) · ${totalUsage.outputTokens ?? 0} out · ${cost} · ${Date.now() - t0} ms${unknown.length ? ` · unknown ids: ${unknown.join(', ')}` : ''}`)
    },
    onAbort: ({ steps }) => {
      // An aborted turn still spent its finished steps (the step in flight is not reported; the Firewall rule covers that).
      recordSpend(steps.reduce((a, st) => a + (gatewayCost(st.providerMetadata) ?? 0), 0))
      console.info(`[chat ${slug}] aborted by client`)
    }
  })

  const stream = toUIMessageStream({
    stream: result.stream,
    originalMessages: body.messages,
    sendReasoning: false,
    // Per-turn usage rides on the finish part so the operator can see what a turn cost.
    messageMetadata: ({ part }): ChatTurnMetadata | undefined => {
      if (part.type === 'finish-step') {
        stepCosts.push(gatewayCost(part.providerMetadata))
      }
      if (part.type !== 'finish') {
        return undefined
      }
      const reportedCost = stepCosts.length && stepCosts.every(c => c !== null) ? stepCosts.reduce<number>((a, c) => a + c!, 0) : null
      const tokens = {
        input: part.totalUsage.inputTokens ?? 0,
        output: part.totalUsage.outputTokens ?? 0,
        cacheRead: part.totalUsage.inputTokenDetails?.cacheReadTokens ?? 0,
        cacheWrite: part.totalUsage.inputTokenDetails?.cacheWriteTokens ?? 0
      }
      const costUsd = reportedCost ?? estimateCost(tokens, model)
      recordSpend(costUsd)
      return {
        model,
        tokensIn: tokens.input,
        tokensOut: tokens.output,
        tokensCached: tokens.cacheRead,
        costUsd,
        costSource: reportedCost === null ? 'price_table' : 'gateway',
        ms: Date.now() - t0
      }
    },
    // Provider text (credit balance, rate limits, model ids) never reaches the reader.
    onError: (error) => {
      console.error(`[chat ${slug}]`, error)
      return CHAT_UNAVAILABLE
    }
  })

  return createUIMessageStreamResponse({ stream })
})
