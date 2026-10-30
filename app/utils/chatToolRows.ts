// One compact row per chat tool call ("Read lem:greedy-hashes", "Searched “sqrt log n” · 6 hits"). Pure, for MessageContent.
import type { AncestorsOutput, ReadNodeOutput, SearchPaperOutput, TraceOutput, ViewFigureOutput } from '#shared/api'

export type ToolRowState = 'running' | 'done' | 'error' | 'stopped'

export interface ToolRow {
  icon: string
  text: string
  suffix?: string
  state: ToolRowState
  /** Short lines for the collapsible details, when there is anything worth showing. */
  details: string[]
}

interface ToolPartLike { state: string, input?: unknown, output?: unknown, errorText?: string }

const ICONS: Record<string, string> = {
  read_node: 'i-lucide-file-text',
  search_paper: 'i-lucide-search',
  trace: 'i-lucide-route',
  ancestors: 'i-lucide-git-fork',
  view_figure: 'i-lucide-image'
}

const str = (v: unknown) => typeof v === 'string' ? v : ''

/** `live`: the turn is still streaming. A call left unfinished by Stop renders as stopped, not as a spinner forever. */
export function toolRow(name: string, part: ToolPartLike, live = true): ToolRow {
  const row = baseRow(name, part)
  return row.state === 'running' && !live ? { ...row, state: 'stopped', suffix: 'stopped' } : row
}

function baseRow(name: string, part: ToolPartLike): ToolRow {
  const state: ToolRowState = part.state === 'output-error' || part.state === 'output-denied'
    ? 'error'
    : part.state === 'output-available' ? 'done' : 'running'
  const input = (part.input ?? {}) as Record<string, unknown>
  const icon = ICONS[name] ?? 'i-lucide-wrench'
  const running = state === 'running'
  const err = state === 'error' ? (part.errorText ?? 'failed') : undefined

  if (name === 'read_node') {
    const out = state === 'done' ? part.output as ReadNodeOutput : undefined
    const what = out?.label ?? out?.id ?? str(input.id)
    return {
      icon,
      text: `${running ? 'Reading' : state === 'error' ? 'Couldn\'t read' : 'Read'} ${what}`.trim(),
      suffix: err ?? (out?.proof ? out.proof.location : out?.proof_note ? 'statement only' : undefined),
      state,
      details: out ? [out.name, ...(out.truncated ? [out.truncated] : [])] : []
    }
  }
  if (name === 'search_paper') {
    const out = state === 'done' ? part.output as SearchPaperOutput : undefined
    const n = out?.total ?? 0
    return {
      icon,
      text: `${running ? 'Searching' : 'Searched'} “${str(input.query)}”`,
      suffix: err ?? (out ? `${n} hit${n === 1 ? '' : 's'}` : undefined),
      state,
      details: out?.hits.map(h => `${h.file}:${h.line}${h.section ? ` · ${h.section}` : ''}${h.node ? ` · ${h.node}` : ''}`) ?? []
    }
  }
  if (name === 'trace') {
    const out = state === 'done' ? part.output as TraceOutput : undefined
    return {
      icon,
      text: `${running ? 'Tracing' : 'Traced'} ${str(input.from)} → ${str(input.to)}`,
      suffix: err ?? (out ? (out.found ? `${out.steps} step${out.steps === 1 ? '' : 's'}` : 'no path') : undefined),
      state,
      details: out?.paths.map(p => p.nodes.map(x => x.id).join(' → ')) ?? []
    }
  }
  if (name === 'ancestors') {
    const out = state === 'done' ? part.output as AncestorsOutput : undefined
    const dir = input.direction === 'supports' ? 'what rests on' : 'what supports'
    return {
      icon,
      text: `${running ? 'Collecting' : 'Collected'} ${dir} ${str(input.id)}`,
      suffix: err ?? (out ? `${out.total} node${out.total === 1 ? '' : 's'}` : undefined),
      state,
      details: out?.levels.map(l => `${l.depth}: ${l.nodes.map(x => x.id).join(', ')}`) ?? []
    }
  }
  if (name === 'view_figure') {
    const out = state === 'done' ? part.output as ViewFigureOutput : undefined
    const raw = str(input.ref).trim()
    const what = out ? (out.number ? `Figure ${out.number}` : out.cite) : /^\d/.test(raw) ? `Figure ${raw}` : raw
    return {
      icon,
      text: `${running ? 'Viewing' : state === 'error' ? 'Couldn\'t view' : 'Viewed'} ${what}`.trim(),
      suffix: err ?? (out?.page ? `p. ${out.page}` : undefined),
      state,
      details: out ? [`${out.kind} · ${out.section}`, ...(out.supports.length ? [`supports ${out.supports.map(n => n.id).join(', ')}`] : [])] : []
    }
  }
  return { icon, text: name, suffix: err, state, details: [] }
}
