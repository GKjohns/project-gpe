<script setup lang="ts">
// Corpus (frame 06): the tiered test set from corpus/manifest.json, one row per entry × structure method,
// with the metrics each run's finalize computed. Ingest runs go through POST /api/corpus/:slug/ingest.
import type { TableColumn } from '@nuxt/ui'
import type { CorpusEntry, CorpusResponse, CorpusRow, CorpusRun } from '#shared/corpus'
import { goldenDiffCount } from '#shared/corpus'
import { ACTIVE_RUN_STATUSES } from '#shared/runs'
import type { Profile, StructureMethod } from '#shared/types'

useSeoMeta({ title: 'Corpus' })

const toast = useToast()
const { operator } = useOperator()
const { data, refresh } = await useFetch<CorpusResponse>('/api/corpus', { key: 'corpus' })

const METHODS: StructureMethod[] = ['pipeline', 'agent']

interface Row {
  key: string
  first: boolean
  row: CorpusRow
  entry: CorpusEntry
  method: StructureMethod
  run: CorpusRun | null
}

const rows = computed<Row[]>(() => (data.value?.rows ?? []).flatMap(row => row.entry.source.kind === 'none'
  ? [{ key: `${row.entry.slug}`, first: true, row, entry: row.entry, method: 'pipeline' as const, run: null }]
  : METHODS.map((method, i) => ({ key: `${row.entry.slug}-${method}`, first: i === 0, row, entry: row.entry, method, run: row.runs[method] }))))

const anyActive = computed(() => rows.value.some(r => r.run && ACTIVE_RUN_STATUSES.includes(r.run.status)))
let timer: ReturnType<typeof setInterval> | undefined
watch(anyActive, (active) => {
  clearInterval(timer)
  timer = active ? setInterval(() => refresh(), 3000) : undefined
}, { immediate: import.meta.client })
onBeforeUnmount(() => clearInterval(timer))

const counts = computed(() => {
  const real = rows.value.filter(r => r.entry.source.kind !== 'none')
  return {
    total: real.length,
    done: real.filter(r => r.run?.hasDigest && (r.run.status === 'complete' || r.run.status === 'structure_partial')).length,
    active: real.filter(r => r.run && ACTIVE_RUN_STATUSES.includes(r.run.status)).length
  }
})

// --- cells ---
type BadgeColor = 'primary' | 'success' | 'info' | 'warning' | 'error' | 'neutral'

function status(r: Row): { label: string, color: BadgeColor, icon?: string } {
  if (r.entry.source.kind === 'none') {
    return { label: 'no source', color: 'neutral' }
  }
  const run = r.run
  if (!run) {
    return { label: 'not run', color: 'neutral' }
  }
  switch (run.status) {
    case 'complete':
      return { label: 'digested', color: 'success', icon: 'i-lucide-check' }
    case 'structure_partial':
      return { label: 'partial structure', color: 'warning', icon: 'i-lucide-check' }
    case 'running':
      return { label: runningLabel(run), color: 'info', icon: 'i-lucide-loader-circle' }
    case 'queued':
      return { label: 'queued', color: 'neutral', icon: 'i-lucide-clock' }
    case 'waiting_review':
      return { label: 'waiting for review', color: 'warning', icon: 'i-lucide-hand' }
    case 'failed':
      return { label: run.error === 'budget' ? 'failed · budget' : run.stage ? `failed · ${run.stage}` : 'failed', color: 'error', icon: 'i-lucide-x' }
    case 'cancelled':
      return { label: 'cancelled', color: 'neutral', icon: 'i-lucide-ban' }
  }
}

function runningLabel(run: CorpusRun) {
  const p = run.progress
  if (run.stage === 'outline' && p.agent_turn) {
    return `agent · turn ${p.agent_turn}`
  }
  if (run.stage === 'annotate' && p.annotate_total) {
    return `annotate ${p.annotated ?? 0}/${p.annotate_total}`
  }
  if (run.stage === 'classify' && p.classify_total) {
    return `classify ${p.classified ?? 0}/${p.classify_total}`
  }
  return run.stage ?? 'running'
}

const done = (r: Row) => !!r.run?.metrics

function formatMs(ms: number) {
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

function leanLabel(e: CorpusEntry) {
  return { 'mathlib': 'Mathlib', 'openai-math': 'openai/math', 'blueprint': 'blueprint', 'none': '' }[e.lean.kind]
}

function sourceLabel(e: CorpusEntry) {
  if (e.source.kind === 'arxiv') {
    return `arXiv ${e.source.id}`
  }
  if (e.source.kind === 'github') {
    return e.source.url.includes('openai/math') ? 'openai/math' : 'GitHub'
  }
  return 'source needed'
}

function sourceHref(e: CorpusEntry) {
  if (e.source.kind === 'arxiv') {
    return `https://arxiv.org/abs/${e.source.id}`
  }
  return e.source.kind === 'github' ? e.source.url : undefined
}

function goldenCell(r: Row): { label: string, color: BadgeColor, title?: string } | null {
  if (!r.entry.golden) {
    return null
  }
  const d = r.run?.metrics?.golden_diff
  if (!d) {
    return r.run?.metrics ? { label: 'not computed', color: 'neutral', title: 'run finalized before goldens existed' } : null
  }
  const n = goldenDiffCount(d)
  const title = [
    d.missing.length ? `missing: ${d.missing.join(', ')}` : '',
    d.extra.length ? `extra: ${d.extra.join(', ')}` : '',
    d.dep_mismatches ? `${d.dep_mismatches} \\ref edge mismatches` : '',
    d.kind_mismatches ? `${d.kind_mismatches} kind mismatches` : ''
  ].filter(Boolean).join(' · ')
  return { label: `${n} diff${n === 1 ? '' : 's'}`, color: n ? 'warning' : 'success', title: title || 'matches the golden' }
}

const runHref = (r: Row) => r.run ? `/papers/${r.run.paperSlug}/run?run=${r.run.runId}` : undefined

const columns: TableColumn<Row>[] = [
  { id: 'paper', header: 'Paper' },
  { id: 'method', header: 'Method' },
  { id: 'status', header: 'Status' },
  { id: 'recall', header: 'Recall · claims' },
  { id: 'refs', header: 'Edges ref / inf.' },
  { id: 'critique', header: 'Critique · review' },
  { id: 'calls', header: 'Calls · turns · retries' },
  { id: 'cost', header: 'Cost · time' },
  { id: 'golden', header: 'Golden' },
  { id: 'actions', header: 'Actions' }
]

// --- ingest modal ---
const modalOpen = ref(false)
const submitting = ref(false)
const form = reactive({ slug: '', title: '', method: 'pipeline' as StructureMethod, profile: 'standard' as Profile, budgetUsd: 15 })
const methodItems = [
  { label: 'Pipeline', value: 'pipeline', description: 'One whole-paper outline call; fixed cost.' },
  { label: 'Agent (sandbox)', value: 'agent', description: 'Claude Agent SDK in a Vercel Sandbox; variable turns and cost.' }
]
const profileItems = [
  { label: 'Careful', value: 'careful' },
  { label: 'Standard', value: 'standard' },
  { label: 'Quick', value: 'quick' }
]

function openIngest(r: Row) {
  Object.assign(form, {
    slug: r.entry.slug,
    title: r.entry.title,
    method: r.method,
    profile: r.run?.profile ?? r.entry.profile ?? r.row.defaultProfile,
    budgetUsd: r.entry.tier === 'whopper' ? 25 : 15
  })
  modalOpen.value = true
}

const errorMessage = (err: unknown) => (err as { data?: { statusMessage?: string }, statusMessage?: string })?.data?.statusMessage
  ?? (err as { statusMessage?: string })?.statusMessage ?? 'Could not start the run'

async function ingest(slug: string, body: { method: StructureMethod, profile: Profile, budgetUsd: number }) {
  return await $fetch<{ runId: string, slug: string }>(`/api/corpus/${slug}/ingest`, { method: 'POST', body })
}

async function submitIngest() {
  submitting.value = true
  try {
    const res = await ingest(form.slug, { method: form.method, profile: form.profile, budgetUsd: form.budgetUsd })
    modalOpen.value = false
    toast.add({
      title: `Queued ${form.slug} · ${form.method}`,
      description: `${form.profile} · budget $${form.budgetUsd}`,
      color: 'success',
      actions: [{ label: 'Open run', to: `/papers/${res.slug}/run?run=${res.runId}` }]
    })
    await refresh()
  } catch (err) {
    toast.add({ title: 'Ingest failed', description: errorMessage(err), color: 'error' })
  } finally {
    submitting.value = false
  }
}

// "Run all pending": every simple-tier entry × method without a run, on its manifest profile.
// LocalRunner runs one at a time and Inngest serializes per paper, so posting them back to back is enough.
const pending = computed(() => rows.value.filter(r => r.entry.tier === 'simple' && r.entry.source.kind !== 'none' && !r.run))
const queueing = ref(false)
async function runAllPending() {
  queueing.value = true
  let ok = 0
  for (const r of pending.value) {
    try {
      await ingest(r.entry.slug, { method: r.method, profile: r.entry.profile, budgetUsd: 15 })
      ok++
    } catch (err) {
      toast.add({ title: `${r.entry.slug} · ${r.method}`, description: errorMessage(err), color: 'error' })
    }
  }
  queueing.value = false
  toast.add({ title: `Queued ${ok} run${ok === 1 ? '' : 's'}`, color: ok ? 'success' : 'neutral' })
  await refresh()
}
</script>

<template>
  <UContainer class="pb-16 max-w-[96rem]">
    <UPageHeader
      title="Corpus"
      description="The tiered test set from corpus/manifest.json. Each paper runs under both structure methods; the numbers decide the default."
      :ui="{ links: 'flex-wrap' }"
    >
      <template #links>
        <UButton
          to="/"
          color="neutral"
          variant="ghost"
          icon="i-lucide-arrow-left"
          label="Papers"
        />
        <UButton
          v-if="!operator"
          :to="loginHref('/corpus')"
          color="neutral"
          variant="outline"
          icon="i-lucide-log-in"
          label="Sign in to run"
        />
        <UButton
          v-else
          color="neutral"
          variant="outline"
          icon="i-lucide-list-start"
          :label="pending.length ? `Run all pending (${pending.length})` : 'Run all pending'"
          :disabled="!pending.length"
          :loading="queueing"
          @click="runAllPending"
        />
      </template>
    </UPageHeader>

    <div class="mt-6 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted">
      <span><b class="text-highlighted">{{ counts.done }}</b> / {{ counts.total }} paper × method runs digested</span>
      <span v-if="counts.active"><b class="text-highlighted">{{ counts.active }}</b> in progress</span>
      <span v-if="data">corpus spend <b class="text-highlighted">${{ data.spendUsd.toFixed(2) }}</b> (all runs on corpus papers)</span>
    </div>

    <UTable
      :data="rows"
      :columns="columns"
      :get-row-id="(r: Row) => r.key"
      class="mt-4 rounded-md border border-default"
      :ui="{ td: 'align-top py-2.5 px-3 text-sm', th: 'px-3 align-bottom' }"
    >
      <template #paper-cell="{ row: { original: r } }">
        <div
          v-if="r.first"
          class="min-w-48 max-w-64 whitespace-normal"
        >
          <div class="flex flex-wrap items-center gap-1.5">
            <UBadge
              :label="r.entry.tier"
              color="neutral"
              variant="outline"
              size="sm"
            />
            <span class="whitespace-nowrap text-xs text-dimmed">{{ r.entry.pages ? `${r.entry.pages} pp` : '? pp' }}</span>
            <UBadge
              :title="r.entry.lean.ref ?? 'no formalization known'"
              :label="r.entry.lean.kind === 'none' ? 'no Lean' : `Lean: ${leanLabel(r.entry)}`"
              :color="r.entry.lean.kind === 'none' ? 'neutral' : 'success'"
              variant="subtle"
              size="sm"
            />
          </div>
          <div class="mt-1 font-medium text-highlighted text-pretty">
            {{ r.entry.title }}
          </div>
          <div class="text-xs text-muted">
            {{ r.entry.authors.join(', ') }} ·
            <ULink
              v-if="sourceHref(r.entry)"
              :to="sourceHref(r.entry)"
              target="_blank"
              class="underline decoration-dotted"
            >{{ sourceLabel(r.entry) }}</ULink>
            <span v-else>{{ sourceLabel(r.entry) }}</span>
          </div>
        </div>
      </template>
      <template #method-cell="{ row: { original: r } }">
        <span
          v-if="r.entry.source.kind !== 'none'"
          class="inline-flex items-center gap-1 text-sm"
        >
          <UIcon :name="r.method === 'agent' ? 'i-lucide-bot' : 'i-lucide-workflow'" />
          {{ r.method }}
          <span
            v-if="r.run"
            class="text-xs text-dimmed"
          >· {{ r.run.profile }}</span>
        </span>
      </template>
      <template #status-cell="{ row: { original: r } }">
        <UBadge
          :color="status(r).color"
          variant="subtle"
          size="sm"
          :icon="status(r).icon"
          :label="status(r).label"
          :ui="{ leadingIcon: r.run?.status === 'running' ? 'animate-spin' : '' }"
        />
      </template>
      <template #recall-cell="{ row: { original: r } }">
        <span
          v-if="done(r)"
          :class="r.run!.metrics!.statements_extracted < r.run!.metrics!.statements_in_source ? 'text-error' : ''"
        >{{ r.run!.metrics!.statements_extracted }}/{{ r.run!.metrics!.statements_in_source }}<span class="text-muted"> · {{ r.run!.metrics!.claims }}</span></span>
        <span
          v-else
          class="text-dimmed"
        >—</span>
      </template>
      <template #refs-cell="{ row: { original: r } }">
        <span v-if="done(r)">{{ r.run!.metrics!.refs_mechanical }} / {{ r.run!.metrics!.refs_inferred }}</span>
        <span
          v-else
          class="text-dimmed"
        >—</span>
      </template>
      <template #critique-cell="{ row: { original: r } }">
        <span v-if="done(r)">{{ r.run!.metrics!.critique_findings }} · {{ r.run!.metrics!.review_items }}</span>
        <span
          v-else
          class="text-dimmed"
        >—</span>
      </template>
      <template #calls-cell="{ row: { original: r } }">
        <span
          v-if="done(r)"
          class="whitespace-nowrap"
        >{{ r.run!.metrics!.calls }}<span class="text-muted"> · {{ r.run!.turns ?? '–' }} · </span><span :class="r.run!.metrics!.schema_retries ? 'text-warning' : 'text-muted'">{{ r.run!.metrics!.schema_retries }}</span></span>
        <span
          v-else
          class="text-dimmed"
        >—</span>
      </template>
      <template #cost-cell="{ row: { original: r } }">
        <template v-if="r.run">
          <span
            class="whitespace-nowrap"
            :title="r.run.lineageCostUsd > r.run.costUsd + 0.005
              ? `$${r.run.lineageCostUsd.toFixed(2)} including the earlier runs this one reused`
              : 'spend of this run'"
          >
            ${{ r.run.costUsd.toFixed(2) }}<span
              v-if="r.run.lineageCostUsd > r.run.costUsd + 0.005"
              class="text-dimmed"
            >*</span>
            <span
              v-if="r.run.metrics"
              class="text-muted"
            > · {{ formatMs(r.run.metrics.wallclock_ms) }}</span>
          </span>
        </template>
        <span
          v-else
          class="text-dimmed"
        >—</span>
      </template>
      <template #golden-cell="{ row: { original: r } }">
        <UBadge
          v-if="goldenCell(r)"
          :title="goldenCell(r)!.title"
          :label="goldenCell(r)!.label"
          :color="goldenCell(r)!.color"
          variant="subtle"
          size="sm"
        />
        <span
          v-else
          class="text-xs text-dimmed"
        >{{ r.entry.golden ? '—' : 'n/a' }}</span>
      </template>
      <template #actions-cell="{ row: { original: r } }">
        <div
          v-if="r.entry.source.kind !== 'none'"
          class="flex gap-1"
        >
          <UButton
            v-if="r.run?.hasDigest && done(r)"
            :to="`/${r.run.paperSlug}`"
            size="xs"
            color="neutral"
            variant="ghost"
            label="Open"
          />
          <UButton
            v-if="r.run"
            :to="runHref(r)"
            size="xs"
            color="neutral"
            variant="ghost"
            label="Log"
          />
          <UButton
            v-if="operator && (!r.run || !ACTIVE_RUN_STATUSES.includes(r.run.status))"
            size="xs"
            :color="r.run ? 'neutral' : 'primary'"
            :variant="r.run ? 'outline' : 'soft'"
            :label="r.run ? 'Re-run' : 'Ingest'"
            @click="openIngest(r)"
          />
        </div>
        <span
          v-else
          class="text-dimmed"
        >—</span>
      </template>
    </UTable>

    <p class="mt-3 text-xs text-dimmed">
      One row per paper × structure method; the run shown is the newest in progress, else the newest that made model calls.
      Golden diffs count statements missing or extra against the hand-written list, plus <code>\ref</code> edge and kind mismatches.
      <span class="whitespace-nowrap">* re-run: the cost shown is this run's; hover for the lineage total.</span>
    </p>

    <UModal
      v-model:open="modalOpen"
      :title="`Ingest ${form.title}`"
      :description="`Corpus entry ${form.slug}. Same pipeline as the New paper form, with the manifest's source.`"
    >
      <template #body>
        <div class="flex flex-col gap-5">
          <UFormField label="Structure method">
            <URadioGroup
              v-model="form.method"
              :items="methodItems"
            />
          </UFormField>
          <UFormField
            label="Model profile"
            help="Careful: Opus for outline, critique and classify. Standard: GPT-6 Sol. Quick: Sonnet/Haiku."
          >
            <USelect
              v-model="form.profile"
              :items="profileItems"
              class="w-48"
            />
          </UFormField>
          <UFormField
            label="Budget (USD)"
            help="The run fails at the next step boundary once spend passes this."
          >
            <UInputNumber
              v-model="form.budgetUsd"
              :min="1"
              :max="500"
              class="w-40"
            />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            label="Cancel"
            @click="modalOpen = false"
          />
          <UButton
            label="Start run"
            icon="i-lucide-play"
            :loading="submitting"
            @click="submitIngest"
          />
        </div>
      </template>
    </UModal>
  </UContainer>
</template>
