<script setup lang="ts">
import type { StepperItem } from '@nuxt/ui'
import { RUN_STAGES } from '#shared/pipeline'
import type { RunEvent, RunResponse } from '#shared/runs'
import type { RunStage } from '#shared/types'

const props = defineProps<{ run: RunResponse['run'], events: RunEvent[] }>()

// Eleven stages shown as eight (storyboard frame 00b plus the reader's render + figures).
// Runs from before Sprint 4 logged stub stages; those render as "stub" so they don't read as real work.
const GROUPS: { title: string, stages: RunStage[] }[] = [
  { title: 'Fetch', stages: ['fetch'] },
  { title: 'Chunk', stages: ['chunk'] },
  { title: 'Outline + extract', stages: ['outline', 'extract'] },
  { title: 'Resolve', stages: ['resolve'] },
  { title: 'Critique', stages: ['critique'] },
  { title: 'Annotate + classify', stages: ['annotate', 'classify'] },
  { title: 'Render + figures', stages: ['render', 'figures'] },
  { title: 'Finalize', stages: ['finalize'] }
]

const n = (key: string) => {
  const v = props.run.progress[key]
  return typeof v === 'number' ? v : undefined
}
const kb = (bytes?: number) => bytes === undefined ? '' : `${Math.round(bytes / 1024)} KB`
const secs = (ms: number) => ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)}s`

const finished = computed(() => {
  const map = new Map<string, number>()
  for (const e of props.events) {
    const m = /^(\w+) finished$/.exec(e.message)
    if (m && typeof e.data?.ms === 'number') {
      map.set(m[1]!, e.data.ms)
    }
  }
  return map
})

const stubbed = computed(() => new Set(props.events
  .map(e => /^(\w+): stub \(not implemented yet\)$/.exec(e.message)?.[1])
  .filter(Boolean) as string[]))

const stageIndex = computed(() => props.run.stage ? RUN_STAGES.indexOf(props.run.stage) : -1)
const stageDone = (s: RunStage) => props.run.status === 'complete' || props.run.status === 'structure_partial'
  || RUN_STAGES.indexOf(s) < stageIndex.value
  || finished.value.has(s)

function counters(s: RunStage): string | null {
  if (s === 'fetch' && n('files') !== undefined) {
    return `${n('files')} files · ${kb(n('bytes'))}`
  }
  if (s === 'chunk' && n('statements') !== undefined) {
    return `${n('sections')} sections · ${n('statements')} statements · ${n('refs')} refs`
  }
  if (s === 'outline' && props.run.structureMethod === 'agent' && props.run.progress.agent_sandbox) {
    // Method B: live `agent · turn N · <last tool>` while it runs, turns + cost once collected.
    if (n('agent_turns') !== undefined) {
      return `agent · ${n('agent_turns')} turns · $${(n('agent_cost_usd') ?? 0).toFixed(2)} · ${n('claims') ?? 0} claims${props.run.progress.structure_partial ? ' (partial)' : ''}`
    }
    const tool = props.run.progress.agent_last_tool
    return `agent · turn ${n('agent_turn') ?? 0}${typeof tool === 'string' ? ` · ${tool}` : ' · booting'}`
  }
  if (s === 'outline' && n('claims') !== undefined) {
    return `${n('claims')} claims`
  }
  if (s === 'extract' && n('statements_extracted') !== undefined) {
    return `${(n('statements_extracted') ?? 0) + (n('claims_extracted') ?? 0)} nodes`
  }
  if (s === 'resolve' && n('refs_mechanical') !== undefined) {
    return `${n('refs_mechanical')} \\ref · ${n('refs_inferred') ?? 0} inferred edges`
  }
  if (s === 'critique' && n('critique_findings') !== undefined) {
    return `${n('critique_findings')} findings · ${n('critique_applied') ?? 0} applied · ${n('review_items') ?? 0} for review`
  }
  if (s === 'annotate' && n('annotate_total') !== undefined) {
    return `annotated ${n('annotated') ?? 0}/${n('annotate_total')}`
  }
  if (s === 'classify' && n('classify_total') !== undefined) {
    return `classified ${n('classified') ?? 0}/${n('classify_total')}${n('novel') !== undefined ? ` · ${n('novel')} novel` : ''}`
  }
  if (s === 'render' && typeof props.run.progress.render_status === 'string') {
    const st = props.run.progress.render_status
    return `${st === 'compiled' ? `typeset · ${n('render_pages') ?? 0} pp` : st === 'arxiv_pdf' ? 'arXiv PDF (did not compile)' : 'unavailable'} · ${n('figures_rasterized') ?? 0}/${n('figures_found') ?? 0} figures`
  }
  if (s === 'figures' && n('figures_described') !== undefined) {
    return `${n('figures_described')} described`
  }
  if (s === 'finalize' && n('digest_nodes') !== undefined) {
    return `digest · ${n('digest_nodes')} nodes`
  }
  return null
}

type GroupState = 'done' | 'stub' | 'active' | 'review' | 'failed' | 'stopped' | 'pending'

const groups = computed(() => GROUPS.map((g) => {
  const done = g.stages.every(stageDone)
  const current = props.run.stage !== null && g.stages.includes(props.run.stage)
  let state: GroupState = 'pending'
  // Runs finished before the reader existed never rendered.
  const neverRendered = g.stages.includes('render') && props.run.progress.render_status === undefined && !finished.value.has('render')
  if (done && (g.stages.every(st => stubbed.value.has(st)) || neverRendered)) {
    state = 'stub'
  } else if (done) {
    state = 'done'
  } else if (current) {
    state = props.run.status === 'failed' ? 'failed' : props.run.status === 'cancelled' ? 'stopped' : props.run.status === 'waiting_review' ? 'review' : 'active'
  }
  const ms = g.stages.reduce((sum, s) => sum + (finished.value.get(s) ?? 0), 0)
  const parts = g.stages.map(counters).filter(Boolean) as string[]
  let description = parts.join(' · ')
  if (state === 'done') {
    description = [description || 'done', ms ? secs(ms) : null].filter(Boolean).join(' · ')
  } else if (state === 'stub') {
    description = neverRendered ? 'not run (older run)' : 'stub (older run)'
  } else if (state === 'active') {
    description = description || (props.run.status === 'queued' ? 'queued' : 'running…')
  } else if (state === 'review') {
    description = `waiting for review · ${n('review_items') ?? 0} item${n('review_items') === 1 ? '' : 's'}`
  } else if (state === 'failed') {
    description = 'failed'
  } else if (state === 'stopped') {
    description = 'cancelled'
  } else {
    description = g.title === 'Critique' ? 'may pause for review' : '—'
  }
  return { ...g, state, description }
}))

const ICONS: Record<GroupState, string | undefined> = {
  done: 'i-lucide-check',
  stub: 'i-lucide-minus',
  active: 'i-lucide-loader-circle',
  review: 'i-lucide-hand',
  failed: 'i-lucide-x',
  stopped: 'i-lucide-square',
  pending: undefined
}

const items = computed<StepperItem[]>(() => groups.value.map((g, i) => ({
  value: i,
  title: g.title,
  description: g.description,
  icon: ICONS[g.state],
  ui: {
    icon: g.state === 'active' ? 'animate-spin' : undefined,
    indicator: g.state === 'failed' ? 'bg-error text-inverted' : g.state === 'stopped' || g.state === 'review' ? 'bg-warning text-inverted' : g.state === 'pending' || g.state === 'stub' ? 'bg-elevated text-muted' : undefined
  }
})))

// The stepper's active step is the furthest group that has started.
const current = computed(() => {
  let last = 0
  groups.value.forEach((g, i) => {
    if (g.state !== 'pending') {
      last = i
    }
  })
  return last
})
</script>

<template>
  <UStepper
    :model-value="current"
    :items="items"
    orientation="vertical"
    size="sm"
    disabled
    class="w-full"
    :ui="{ description: 'text-xs' }"
  />
</template>
