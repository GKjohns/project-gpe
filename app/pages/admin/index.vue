<script setup lang="ts">
// Admin papers table (frame 08): every paper, public or not, with its latest run, family and Public switch.
import type { TableColumn } from '@nuxt/ui'
import type { PaperListItem } from '#shared/api'
import type { RunStatus } from '#shared/types'

definePageMeta({ title: 'Papers' })
useSeoMeta({ title: 'Admin · Papers' })

const toast = useToast()
const { syncing, syncCatalog } = useCatalogSync()

const { data: papers, refresh } = await useFetch<PaperListItem[]>('/api/admin/papers', { key: 'admin-papers', default: () => [] })

// Public papers first (what readers see), then newest first as the API returns them.
const rows = computed(() => [...papers.value].sort((a, b) => Number(b.public) - Number(a.public)))

const ACTIVE: RunStatus[] = ['queued', 'running', 'waiting_review']
const anyActive = computed(() => (papers.value ?? []).some(p => p.run && ACTIVE.includes(p.run.status)))

// Re-poll while any row is mid-run.
let timer: ReturnType<typeof setInterval> | undefined
watch(anyActive, (active) => {
  clearInterval(timer)
  timer = active ? setInterval(() => refresh(), 3000) : undefined
}, { immediate: import.meta.client })
onBeforeUnmount(() => clearInterval(timer))

type BadgeColor = 'primary' | 'success' | 'info' | 'warning' | 'error' | 'neutral'

function state(p: PaperListItem): { label: string, color: BadgeColor, icon?: string } {
  const r = p.run
  if (!r) {
    return p.counts ? { label: 'digested', color: 'success', icon: 'i-lucide-check' } : { label: 'not run', color: 'neutral' }
  }
  switch (r.status) {
    case 'complete':
      // Runs from before Sprint 4 completed without writing a digest.
      return p.counts ? { label: 'digested', color: 'success', icon: 'i-lucide-check' } : { label: 'complete · no digest', color: 'neutral', icon: 'i-lucide-minus' }
    case 'structure_partial':
      return { label: 'digested · partial structure', color: 'warning', icon: 'i-lucide-check' }
    case 'running':
      return { label: runningLabel(r), color: 'info', icon: 'i-lucide-loader-circle' }
    case 'queued':
      return { label: 'queued', color: 'neutral', icon: 'i-lucide-clock' }
    case 'waiting_review':
      return { label: 'waiting for review', color: 'warning', icon: 'i-lucide-hand' }
    case 'failed':
      return { label: r.error === 'budget' ? 'failed · budget' : r.stage ? `failed · ${r.stage}` : 'failed', color: 'error', icon: 'i-lucide-x' }
    case 'cancelled':
      return { label: 'cancelled', color: 'neutral', icon: 'i-lucide-ban' }
  }
}

// "annotate 40/89" while a fan-out stage runs, else the stage name.
function runningLabel(r: NonNullable<PaperListItem['run']>) {
  const pr = r.progress
  if (r.stage === 'annotate' && pr.annotate_total) {
    return `running · annotate ${pr.annotated ?? 0}/${pr.annotate_total}`
  }
  if (r.stage === 'classify' && pr.classify_total) {
    return `running · classify ${pr.classified ?? 0}/${pr.classify_total}`
  }
  return r.stage ? `running · ${r.stage}` : 'running'
}

function formatMs(ms: number) {
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

function costText(p: PaperListItem) {
  const r = p.run
  if (r?.metrics?.calls) {
    return `$${r.metrics.cost_usd.toFixed(2)} · ${formatMs(r.metrics.wallclock_ms)}`
  }
  // A re-run that only redid finalize has no spend of its own; its parents carry the cost.
  if (r?.metrics) {
    return 're-run · stages reused'
  }
  return r ? `$${r.costUsd.toFixed(2)} so far` : '—'
}

// Optimistic flip; on failure the toast says why and the refresh puts the switch back.
const flipping = ref(new Set<string>())
async function setPublic(p: PaperListItem, value: boolean) {
  flipping.value.add(p.slug)
  p.public = value
  try {
    await $fetch(`/api/papers/${p.slug}/public`, { method: 'POST', body: { public: value } })
  } catch (err) {
    toast.add({ title: `Could not change ${p.slug}`, description: (err as { statusMessage?: string }).statusMessage, color: 'error', icon: 'i-lucide-circle-alert' })
  } finally {
    flipping.value.delete(p.slug)
    await refresh()
  }
}

const columns: TableColumn<PaperListItem>[] = [
  { id: 'paper', header: 'Paper' },
  { id: 'family', header: 'Family' },
  { id: 'tier', header: 'Tier' },
  { id: 'state', header: 'State' },
  { id: 'nodes', header: 'Nodes' },
  { id: 'cost', header: 'Cost · wallclock' },
  { id: 'public', header: 'Public' },
  { id: 'actions' }
]
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <p class="text-sm text-muted">
        {{ papers.length }} papers · {{ papers.filter(p => p.public).length }} public
      </p>
      <div class="flex flex-wrap gap-2">
        <UButton
          label="Sync catalog"
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="outline"
          :loading="syncing"
          @click="syncCatalog()"
        />
        <UButton
          label="New paper"
          icon="i-lucide-plus"
          to="/admin/papers/new"
        />
      </div>
    </div>

    <UTable
      :data="rows"
      :columns="columns"
      :get-row-id="(p: PaperListItem) => p.slug"
      class="rounded-md border border-default"
      :ui="{ td: 'py-2.5 px-3 text-sm', th: 'px-3' }"
    >
      <template #paper-cell="{ row: { original: p } }">
        <div class="min-w-56 max-w-md whitespace-normal">
          <div class="font-medium text-highlighted text-pretty">
            {{ p.title }}
          </div>
          <div class="font-mono text-xs text-dimmed">
            {{ p.slug }}<span v-if="p.fixture"> · fixture</span>
          </div>
        </div>
      </template>
      <template #family-cell="{ row: { original: p } }">
        <ULink
          v-if="p.family"
          :to="`/papers/${p.family.code}`"
          class="font-mono"
        >
          {{ p.family.code }}
        </ULink>
        <span
          v-else
          class="text-dimmed"
        >—</span>
      </template>
      <template #tier-cell="{ row: { original: p } }">
        <UBadge
          v-if="p.tier"
          color="neutral"
          variant="outline"
          size="sm"
          :label="p.tier"
        />
      </template>
      <template #state-cell="{ row: { original: p } }">
        <UBadge
          :color="state(p).color"
          variant="subtle"
          size="sm"
          :icon="state(p).icon"
          :label="state(p).label"
          :ui="{ leadingIcon: p.run?.status === 'running' ? 'animate-spin' : '' }"
        />
      </template>
      <template #nodes-cell="{ row: { original: p } }">
        <span v-if="p.counts">{{ p.counts.nodes }}</span>
        <span
          v-else
          class="text-dimmed"
        >—</span>
      </template>
      <template #cost-cell="{ row: { original: p } }">
        <span class="text-muted whitespace-nowrap">{{ costText(p) }}</span>
      </template>
      <template #public-cell="{ row: { original: p } }">
        <USwitch
          :model-value="p.public"
          :disabled="p.fixture || flipping.has(p.slug)"
          :aria-label="`Public: ${p.slug}`"
          @update:model-value="(v: boolean) => setPublic(p, v)"
        />
      </template>
      <template #actions-cell="{ row: { original: p } }">
        <div class="flex justify-end gap-1">
          <UButton
            v-if="p.counts"
            :to="`/${p.slug}`"
            label="Open"
            size="xs"
            color="neutral"
            variant="ghost"
          />
          <UButton
            v-if="!p.fixture"
            :to="`/admin/papers/${p.slug}/run`"
            label="Run"
            size="xs"
            color="neutral"
            variant="ghost"
          />
        </div>
      </template>
    </UTable>
  </div>
</template>
