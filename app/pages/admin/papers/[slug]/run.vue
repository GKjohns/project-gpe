<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import { RUN_STAGES } from '#shared/pipeline'
import { ACTIVE_RUN_STATUSES } from '#shared/runs'
import type { RunResponse } from '#shared/runs'
import type { RunStatus } from '#shared/types'

const route = useRoute()
const slug = computed(() => String(route.params.slug))
const toast = useToast()
const { operator } = useOperator()

// ?run=<id> pins a run; otherwise the paper's latest.
const { data: paperData } = await useFetch<{ paper: { latestRunId: string | null, title: string } }>(() => `/api/papers/${slug.value}`, {
  immediate: !route.query.run
})
const runId = computed(() => (route.query.run as string | undefined) ?? paperData.value?.paper.latestRunId ?? null)

const { data, error, refresh } = await useFetch<RunResponse>(() => `/api/runs/${runId.value}`, {
  immediate: !!runId.value,
  watch: [runId]
})

const run = computed(() => data.value?.run)
const active = computed(() => !!run.value && ACTIVE_RUN_STATUSES.includes(run.value.status))
const title = computed(() => data.value?.paper?.title ?? paperData.value?.paper.title ?? slug.value)
useSeoMeta({ title: () => `Run · ${title.value}` })

// Poll every 2s while the run can still change.
const now = ref(Date.now())
let poll: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  poll = setInterval(() => {
    now.value = Date.now()
    if (active.value) {
      void refresh()
    }
  }, 2000)
})
onBeforeUnmount(() => clearInterval(poll))

const STATUS: Record<RunStatus, { label: string, color: 'primary' | 'neutral' | 'success' | 'error' | 'warning' }> = {
  queued: { label: 'Queued', color: 'neutral' },
  running: { label: 'Running', color: 'primary' },
  waiting_review: { label: 'Waiting for review', color: 'warning' },
  failed: { label: 'Failed', color: 'error' },
  cancelled: { label: 'Cancelled', color: 'warning' },
  complete: { label: 'Complete', color: 'success' },
  structure_partial: { label: 'Structure partial', color: 'warning' }
}

const duration = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}
const elapsed = computed(() => {
  if (!run.value) {
    return ''
  }
  const end = run.value.finishedAt ? new Date(run.value.finishedAt).getTime() : now.value
  return duration(end - new Date(run.value.startedAt).getTime())
})
const startedAgo = computed(() => {
  if (!run.value) {
    return ''
  }
  const mins = Math.round((now.value - new Date(run.value.startedAt).getTime()) / 60000)
  return mins < 1 ? 'Started just now' : `Started ${mins} min ago`
})

const num = (key: string) => {
  const v = run.value?.progress[key]
  return typeof v === 'number' ? v : undefined
}
const show = (v: number | undefined) => v === undefined ? '—' : String(v)

// --- actions ---
const cancelling = ref(false)
async function cancel() {
  if (!run.value) {
    return
  }
  cancelling.value = true
  try {
    await $fetch(`/api/runs/${run.value.id}/cancel`, { method: 'POST' })
    await refresh()
  } catch (err) {
    toast.add({ title: 'Could not cancel', description: (err as { statusMessage?: string }).statusMessage, color: 'error' })
  } finally {
    cancelling.value = false
  }
}

async function rerun(fromStage: string) {
  if (!run.value) {
    return
  }
  try {
    const res = await $fetch<{ runId: string }>(`/api/runs/${run.value.id}/retry`, { method: 'POST', body: { fromStage } })
    await navigateTo({ query: { run: res.runId } })
  } catch (err) {
    toast.add({ title: 'Could not re-run', description: (err as { statusMessage?: string }).statusMessage, color: 'error' })
  }
}

// Backfill for digests made before the graph's headline/role labels existed (or to redo them): one model call.
const relabeling = ref(false)
async function relabel() {
  relabeling.value = true
  try {
    const res = await $fetch<{ labeled: number, cost_usd: number, model: string }>(`/api/papers/${slug.value}/labels`, { method: 'POST' })
    toast.add({ title: 'Graph labels regenerated', description: `${res.labeled} nodes · $${res.cost_usd.toFixed(3)} · ${res.model}`, icon: 'i-lucide-tags', color: 'success' })
    clearNuxtData(`paper:${slug.value}`)
  } catch (err) {
    toast.add({ title: 'Could not regenerate labels', description: (err as { statusMessage?: string }).statusMessage, color: 'error' })
  } finally {
    relabeling.value = false
  }
}

const rerunItems = computed<DropdownMenuItem[]>(() => [
  { type: 'label', label: 'Re-run from stage (earlier outputs reused)' },
  ...RUN_STAGES.map(stage => ({ label: stage, icon: 'i-lucide-rotate-ccw', onSelect: () => rerun(stage) }))
])
</script>

<template>
  <UContainer class="py-8">
    <UBreadcrumb
      :items="[{ label: 'GPE', to: '/' }, { label: title }, { label: 'Run' }]"
      class="mb-4"
    />

    <UAlert
      v-if="!runId || error"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      :title="!runId ? `No run for “${slug}”` : 'Could not load the run'"
      :description="error?.statusMessage"
    />

    <template v-else-if="run">
      <div class="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <h1 class="truncate text-xl font-semibold text-highlighted">
              {{ active ? 'Digesting' : 'Run' }} · {{ title }}
            </h1>
            <UBadge
              :label="STATUS[run.status].label"
              :color="STATUS[run.status].color"
              variant="subtle"
            />
          </div>
          <p class="mt-1 text-sm text-muted">
            {{ startedAgo }} · {{ run.profile }} · {{ run.structureMethod }} · run {{ run.id.slice(0, 8) }}
            <template v-if="run.parentRunId">
              · re-run of {{ run.parentRunId.slice(0, 8) }}
            </template>
          </p>
        </div>
        <div class="flex items-center gap-2">
          <UButton
            v-if="!operator"
            :to="loginHref(route.fullPath)"
            label="Sign in to manage this run"
            icon="i-lucide-log-in"
            color="neutral"
            variant="ghost"
          />
          <template v-else>
            <UButton
              v-if="active"
              label="Cancel"
              icon="i-lucide-square"
              color="neutral"
              variant="outline"
              :loading="cancelling"
              @click="cancel"
            />
            <UDropdownMenu
              v-else
              :items="rerunItems"
            >
              <UButton
                label="Re-run from stage…"
                icon="i-lucide-rotate-ccw"
                color="neutral"
                variant="outline"
                trailing-icon="i-lucide-chevron-down"
              />
            </UDropdownMenu>
            <UTooltip
              v-if="(run.status === 'complete' || run.status === 'structure_partial') && data?.paper?.hasDigest"
              text="Rewrite each graph card's headline and role (one model call on the annotate model)"
            >
              <UButton
                label="Regenerate graph labels"
                icon="i-lucide-tags"
                color="neutral"
                variant="outline"
                :loading="relabeling"
                data-relabel
                @click="relabel"
              />
            </UTooltip>
            <UTooltip
              v-if="(run.status === 'complete' || run.status === 'structure_partial') && data?.paper?.hasDigest"
              text="Typeset the paper (TeX Live + SyncTeX in a sandbox) and describe its figures; reuses everything else from this run"
            >
              <UButton
                :label="run.progress.render_status ? 'Re-render' : 'Render paper'"
                icon="i-lucide-printer"
                color="neutral"
                variant="outline"
                data-render
                @click="rerun('render')"
              />
            </UTooltip>
          </template>
          <UButton
            v-if="(run.status === 'complete' || run.status === 'structure_partial') && data?.paper?.hasDigest"
            label="Open map"
            icon="i-lucide-map"
            :to="`/${slug}`"
          />
        </div>
      </div>

      <UAlert
        v-if="run.status === 'structure_partial' || (active && run.progress.structure_partial)"
        class="mb-6"
        color="warning"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        title="Structure partial"
        description="The agent outline ended early (turns, budget, time or an error); later stages ran on the claims it had written. See the outline flags in the log."
      />

      <UAlert
        v-if="run.status === 'failed' && run.error"
        class="mb-6"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        title="The run failed"
        :description="run.error === 'budget' ? 'Spend passed the budget; raise it and re-run from the failed stage.' : run.error"
      />

      <RunReviewQueue
        v-if="run.status === 'waiting_review' && data!.reviewItems.length"
        class="mb-6"
        :run-id="run.id"
        :items="data!.reviewItems"
        @decided="refresh()"
      />

      <div class="grid gap-6 lg:grid-cols-[18rem_1fr]">
        <UCard :ui="{ body: 'p-4 sm:p-5' }">
          <RunStepper
            :run="run"
            :events="data!.events"
          />
        </UCard>

        <UCard :ui="{ header: 'py-3', body: 'p-4 sm:p-5' }">
          <template #header>
            <div class="flex items-center justify-between">
              <span class="text-sm font-medium text-highlighted">Log</span>
              <span class="text-xs text-muted">last {{ data!.events.length }} events</span>
            </div>
          </template>
          <RunLog
            :events="data!.events"
            :live="active"
          />
        </UCard>
      </div>

      <div class="mt-6 grid gap-6 sm:grid-cols-2">
        <UCard :ui="{ body: 'p-4 sm:p-5' }">
          <p class="mb-3 text-sm font-medium text-highlighted">
            Spend
          </p>
          <dl class="grid grid-cols-3 gap-4 text-sm">
            <div>
              <dt class="text-muted">
                Cost so far
              </dt>
              <dd class="font-medium tabular-nums">
                ${{ run.costUsd.toFixed(2) }} <span class="text-muted">/ ${{ run.budgetUsd }}</span>
              </dd>
            </div>
            <div>
              <dt class="text-muted">
                Model calls
              </dt>
              <dd class="font-medium tabular-nums">
                {{ num('calls') ?? 0 }}
              </dd>
            </div>
            <div v-if="run.structureMethod === 'agent' && num('agent_turn') !== undefined">
              <dt class="text-muted">
                Agent
              </dt>
              <dd class="font-medium tabular-nums">
                {{ num('agent_turns') ?? num('agent_turn') }} turns <span class="text-muted">· ${{ (num('agent_cost_usd') ?? 0).toFixed(2) }}<template v-if="num('agent_wallclock_ms')"> · {{ duration(num('agent_wallclock_ms')!) }}</template></span>
              </dd>
            </div>
            <div>
              <dt class="text-muted">
                Elapsed
              </dt>
              <dd class="font-medium tabular-nums">
                {{ elapsed }}
              </dd>
            </div>
          </dl>
        </UCard>
        <UCard :ui="{ body: 'p-4 sm:p-5' }">
          <p class="mb-3 text-sm font-medium text-highlighted">
            Health
          </p>
          <dl class="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
            <div>
              <dt class="text-muted">
                Recall
              </dt>
              <dd class="font-medium tabular-nums">
                <template v-if="num('statements_in_source') !== undefined">
                  {{ num('statements_extracted') }}/{{ num('statements_in_source') }}
                  <span class="text-muted">statements</span>
                </template>
                <template v-else>
                  {{ show(num('statements')) }}
                  <span
                    v-if="num('labeled') !== undefined"
                    class="text-muted"
                  >({{ num('labeled') }} labeled)</span>
                </template>
              </dd>
            </div>
            <div>
              <dt class="text-muted">
                Claims
              </dt>
              <dd class="font-medium tabular-nums">
                {{ show(num('claims')) }}
                <span
                  v-if="num('extract_failed')"
                  class="text-warning"
                >({{ num('extract_failed') }} as span text)</span>
              </dd>
            </div>
            <div>
              <dt class="text-muted">
                Refs / unresolved
              </dt>
              <dd class="font-medium tabular-nums">
                {{ show(num('refs')) }} / {{ show(num('unresolved')) }}
              </dd>
            </div>
            <div>
              <dt class="text-muted">
                Edges: \ref / inferred
              </dt>
              <dd class="font-medium tabular-nums">
                {{ num('refs_mechanical') === undefined ? '—' : (num('refs_mechanical') ?? 0) + (num('claim_refs') ?? 0) }} / {{ show(num('refs_inferred')) }}
              </dd>
            </div>
            <div>
              <dt class="text-muted">
                Inferred-dep friction
              </dt>
              <dd class="font-medium tabular-nums">
                {{ show(num('refs_inferred')) }}
                <span
                  v-if="num('inferred_rejected')"
                  class="text-muted"
                >({{ num('inferred_rejected') }} rejected: cycle)</span>
              </dd>
            </div>
            <div>
              <dt class="text-muted">
                Schema retries
              </dt>
              <dd class="font-medium tabular-nums">
                {{ num('schema_retries') ?? 0 }}
              </dd>
            </div>
            <div>
              <dt class="text-muted">
                Critique
              </dt>
              <dd class="font-medium tabular-nums">
                <template v-if="num('critique_findings') !== undefined">
                  {{ num('critique_findings') }} <span class="text-muted">findings · {{ num('critique_applied') ?? 0 }} applied · {{ num('review_items') ?? 0 }} reviewed</span>
                </template>
                <template v-else>
                  —
                </template>
              </dd>
            </div>
            <div>
              <dt class="text-muted">
                Novel
              </dt>
              <dd class="font-medium tabular-nums">
                {{ show(num('novel')) }}
                <span
                  v-if="num('classify_downgraded')"
                  class="text-muted"
                >({{ num('classify_downgraded') }} downgraded)</span>
              </dd>
            </div>
          </dl>
        </UCard>
      </div>
    </template>
  </UContainer>
</template>
