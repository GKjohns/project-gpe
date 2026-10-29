// Runs inside the Vercel Sandbox (copied to /vercel/sandbox/agent/agent.mjs per run; the SDK is in the snapshot).
// Drives the Claude Agent SDK over /vercel/sandbox/paper and leaves three files for the app to read:
//   trace.jsonl  one JSON line per notable event (tool use, validator output, result), with a running cost estimate
//   outline.json written by the agent itself, as TASK.md asks
//   done.json    the SDK's result: subtype, turns, cost, usage
// Each trace line is also POSTed to $CALLBACK_URL when the app is reachable (prod or a tunnel); polling is the fallback.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { query } from '@anthropic-ai/claude-agent-sdk'

const PAPER = '/vercel/sandbox/paper'
const env = process.env
const MODEL = env.AGENT_MODEL
const MAX_TURNS = Number(env.AGENT_MAX_TURNS || 200)
const MAX_BUDGET = Number(env.AGENT_MAX_BUDGET_USD || 5)
const PRICE_IN = Number(env.AGENT_PRICE_IN || 0) // USD per million input tokens
const PRICE_OUT = Number(env.AGENT_PRICE_OUT || 0)
const CALLBACK_URL = env.CALLBACK_URL || ''
const CALLBACK_TOKEN = env.CALLBACK_TOKEN || ''

const t0 = Date.now()
let seq = 0
let turn = 0
let calls = 0
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
const ZERO = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
// The API call in flight. Through the gateway, message_start can carry zero input usage and the real counts arrive
// in message_delta (cumulative per call), so each field keeps the max seen across both events.
let call = { ...ZERO }
const pending = []

// Running estimate from streamed usage; the SDK's own total arrives only in the final result.
function costEstimate() {
  const t = { input: usage.input + call.input, output: usage.output + call.output, cacheRead: usage.cacheRead + call.cacheRead, cacheWrite: usage.cacheWrite + call.cacheWrite }
  const inputUnits = t.input + t.cacheRead * 0.1 + t.cacheWrite * 1.25
  return (inputUnits * PRICE_IN + t.output * PRICE_OUT) / 1e6
}

function seeUsage(u = {}) {
  call = {
    input: Math.max(call.input, u.input_tokens ?? 0),
    output: Math.max(call.output, u.output_tokens ?? 0),
    cacheRead: Math.max(call.cacheRead, u.cache_read_input_tokens ?? 0),
    cacheWrite: Math.max(call.cacheWrite, u.cache_creation_input_tokens ?? 0)
  }
}

function post(body) {
  if (!CALLBACK_URL) {
    return Promise.resolve()
  }
  return fetch(CALLBACK_URL, {
    method: 'POST',
    headers: { 'authorization': `Bearer ${CALLBACK_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000)
  }).catch(() => {})
}

function trace(kind, fields = {}) {
  const entry = {
    seq: ++seq,
    ts: new Date().toISOString(),
    turn,
    kind,
    ...fields,
    calls,
    cost_usd: Math.round(costEstimate() * 1e6) / 1e6,
    tokens_in: usage.input + usage.cacheRead + usage.cacheWrite + call.input + call.cacheRead + call.cacheWrite,
    tokens_out: usage.output + call.output
  }
  appendFileSync(`${PAPER}/trace.jsonl`, JSON.stringify(entry) + '\n')
  const message = kind === 'tool' ? `${entry.tool} ${entry.summary ?? ''}`.trim() : `${kind}${entry.summary ? ` ${entry.summary}` : ''}`
  pending.push(post({ message, data: entry }))
}

const clip = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}
const rel = p => String(p ?? '').replace(`${PAPER}/`, '')
// The agent often prefixes commands with `cd <workdir>;`, which is noise in a one-line trace.
const bare = c => String(c ?? '').replace(new RegExp(`^cd ${PAPER}/?\\s*(;|&&)\\s*`), '')

function summarize(name, input = {}) {
  switch (name) {
    case 'Read': {
      const from = input.offset ?? 1
      return `${rel(input.file_path)}${input.limit ? `:${from}-${from + input.limit - 1}` : input.offset ? `:${from}-` : ''}`
    }
    case 'Grep':
      return `/${clip(input.pattern, 60)}/${input.path ? ` in ${rel(input.path)}` : ''}${input.glob ? ` (${input.glob})` : ''}`
    case 'Glob':
      return clip(input.pattern, 80)
    case 'Bash':
      return clip(bare(input.command), 140)
    case 'Write':
      return `${rel(input.file_path)} (${String(input.content ?? '').length} chars)`
    case 'Edit':
      return rel(input.file_path)
    default:
      return clip(JSON.stringify(input), 100)
  }
}

const task = readFileSync(`${PAPER}/TASK.md`, 'utf8')
const abort = new AbortController()
const toolNames = new Map() // tool_use_id → { name, command }
let result = null

trace('start', { summary: `${MODEL} · maxTurns ${MAX_TURNS} · budget $${MAX_BUDGET}` })

try {
  const q = query({
    prompt: `${task}\n\nThe files are in ${PAPER} (your working directory). Begin.`,
    options: {
      model: MODEL,
      cwd: PAPER,
      maxTurns: MAX_TURNS,
      maxBudgetUsd: MAX_BUDGET,
      tools: ['Read', 'Grep', 'Glob', 'Bash', 'Write', 'Edit'],
      allowedTools: ['Read', 'Grep', 'Glob', 'Bash', 'Write', 'Edit'],
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      settingSources: [],
      persistSession: false,
      includePartialMessages: true,
      abortController: abort,
      env: {
        ...env,
        ANTHROPIC_BASE_URL: env.GATEWAY_BASE_URL || 'https://ai-gateway.vercel.sh/claude-code',
        // The real key is injected by the sandbox network policy on requests to the gateway; it never enters the VM.
        ANTHROPIC_AUTH_TOKEN: env.ANTHROPIC_AUTH_TOKEN || 'injected-by-network-policy',
        ANTHROPIC_API_KEY: '',
        ANTHROPIC_SMALL_FAST_MODEL: env.AGENT_SMALL_MODEL || 'claude-haiku-5-5',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: env.AGENT_SMALL_MODEL || 'claude-haiku-5-5',
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        DISABLE_AUTOUPDATER: '1'
      },
      stderr: d => process.stderr.write(d)
    }
  })

  for await (const m of q) {
    if (m.type === 'stream_event') {
      const ev = m.event
      if (ev.type === 'message_start') {
        calls++
        turn++
        call = { ...ZERO }
        seeUsage(ev.message?.usage)
      } else if (ev.type === 'message_delta') {
        seeUsage(ev.usage)
      } else if (ev.type === 'message_stop') {
        for (const k of Object.keys(usage)) {
          usage[k] += call[k]
        }
        call = { ...ZERO }
        if (costEstimate() > MAX_BUDGET * 1.1) {
          trace('error', { summary: `running estimate $${costEstimate().toFixed(2)} passed the $${MAX_BUDGET} cap; stopping` })
          abort.abort()
        }
      }
    } else if (m.type === 'assistant') {
      for (const c of m.message?.content ?? []) {
        if (c.type === 'tool_use') {
          toolNames.set(c.id, { name: c.name, command: c.input?.command })
          trace('tool', { tool: c.name, summary: summarize(c.name, c.input) })
        } else if (c.type === 'text' && c.text?.trim()) {
          trace('text', { summary: clip(c.text, 200) })
        }
      }
    } else if (m.type === 'user') {
      // Surface the validator's verdict: it is the agent's own progress signal.
      const content = Array.isArray(m.message?.content) ? m.message.content : []
      for (const c of content) {
        const t = c.type === 'tool_result' ? toolNames.get(c.tool_use_id) : null
        if (t?.name === 'Bash' && /node\s+(\.\/)?validate_outline/.test(t.command ?? '')) {
          const text = Array.isArray(c.content) ? c.content.map(x => x.text ?? '').join('\n') : String(c.content ?? '')
          const head = text.split('\n').find(l => /^(OK|FAIL)/.test(l)) ?? text.split('\n')[0]
          trace('validate', { summary: clip(head, 200) })
        }
      }
    } else if (m.type === 'result') {
      result = m
    }
  }
} catch (err) {
  trace('error', { summary: clip(err instanceof Error ? err.message : String(err), 300) })
}

const done = {
  subtype: result?.subtype ?? (abort.signal.aborted ? 'error_max_budget_usd' : 'error_during_execution'),
  is_error: result?.is_error ?? true,
  num_turns: result?.num_turns ?? turn,
  calls,
  total_cost_usd: result?.total_cost_usd || costEstimate(),
  cost_source: result?.total_cost_usd ? 'sdk' : 'estimate',
  usage: {
    tokens_in: usage.input + usage.cacheRead + usage.cacheWrite,
    tokens_out: usage.output,
    tokens_cached: usage.cacheRead
  },
  model_usage: result?.modelUsage ?? null,
  duration_ms: Date.now() - t0,
  errors: result?.errors ?? [],
  final_text: clip(result?.result, 600),
  outline_written: existsSync(`${PAPER}/outline.json`)
}
writeFileSync(`${PAPER}/done.json`, JSON.stringify(done, null, 2))
trace('result', { summary: `${done.subtype} · ${done.num_turns} turns · $${done.total_cost_usd.toFixed(2)}${done.outline_written ? '' : ' · no outline.json'}` })

let outline = null
try {
  outline = JSON.parse(readFileSync(`${PAPER}/outline.json`, 'utf8'))
} catch {
  // Missing or malformed: the app reads the file itself and decides what is partial.
}
await Promise.allSettled(pending)
await post({ finished: true, outline, data: done })
