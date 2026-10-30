<script setup lang="ts">
import type { PaperListItem } from '#shared/api'
import type { RunStatus } from '#shared/types'

useSeoMeta({ title: 'Papers' })

const { operator } = useOperator()

const { data: papers, refresh } = await useFetch<PaperListItem[]>('/api/papers', { key: 'papers', default: () => [] })

const ACTIVE: RunStatus[] = ['queued', 'running', 'waiting_review']
const anyActive = computed(() => (papers.value ?? []).some(p => p.run && ACTIVE.includes(p.run.status)))

// Re-poll while any card is mid-run.
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

function linkFor(p: PaperListItem) {
  return p.counts ? `/${p.slug}` : `/papers/${p.slug}/run`
}

function sourceText(p: PaperListItem) {
  if (p.sourceKind === 'arxiv') {
    return `arXiv ${p.sourceRef}`
  }
  if (p.sourceKind === 'github') {
    const m = p.sourceRef.match(/github\.com\/([^/]+\/[^/]+)/)
    return m ? m[1] : 'GitHub'
  }
  return p.sourceRef || 'upload'
}

function formatMs(ms: number) {
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

function formatDate(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''
}
</script>

<template>
  <UContainer class="pb-16">
    <UPageHeader
      title="Project GPE"
      description="Graphical Proof Explorer. A browsable map of each proof: paper structure, dependency edges, plain-English explanations, and a chat that cites nodes."
      :links="[
        { label: 'Corpus', to: '/corpus', color: 'neutral', variant: 'outline', icon: 'i-lucide-library' },
        ...(operator ? [{ label: 'New paper', to: '/papers/new', icon: 'i-lucide-plus', color: 'primary' as const, variant: 'solid' as const }] : [])
      ]"
    />

    <UPageGrid class="mt-8">
      <UPageCard
        v-for="p in papers"
        :key="p.slug"
        :to="linkFor(p)"
        variant="outline"
        :ui="{ container: 'gap-y-3', title: 'text-base text-pretty', description: 'text-sm' }"
      >
        <template #header>
          <div class="flex flex-wrap gap-1.5">
            <UBadge
              v-if="p.tier"
              color="neutral"
              variant="outline"
              size="sm"
              :label="p.tier"
            />
            <UBadge
              :color="state(p).color"
              variant="subtle"
              size="sm"
              :icon="state(p).icon"
              :label="state(p).label"
              :ui="{ leadingIcon: p.run?.status === 'running' ? 'animate-spin' : '' }"
            />
            <UBadge
              color="neutral"
              variant="soft"
              size="sm"
              label="Lean: not aligned"
            />
          </div>
        </template>
        <template #title>
          {{ p.title }}
        </template>
        <template #description>
          <span class="text-muted">
            {{ [p.authors.join(', '), sourceText(p), formatDate(p.createdAt)].filter(Boolean).join(' · ') }}
          </span>
        </template>
        <template #footer>
          <div class="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
            <template v-if="p.counts">
              <span><b class="text-highlighted">{{ p.counts.nodes }}</b> nodes</span>
              <span><b class="text-highlighted">{{ p.counts.sections }}</b> sections</span>
              <span><b class="text-highlighted">{{ p.counts.novel }}</b> novel</span>
              <span><b class="text-highlighted">{{ p.counts.friction }}</b> friction</span>
            </template>
            <span
              v-if="p.run?.metrics?.calls"
              class="text-dimmed"
            >{{ formatMs(p.run.metrics.wallclock_ms) }} · ${{ p.run.metrics.cost_usd.toFixed(2) }} · {{ p.run.metrics.calls }} calls</span>
            <!-- A re-run that only redid finalize has no spend of its own; its parents carry the cost. -->
            <span
              v-else-if="p.run?.metrics"
              class="text-dimmed"
            >re-run · earlier stages reused</span>
            <span
              v-else-if="p.run && !p.counts"
              class="text-dimmed"
            >{{ p.run.profile }} · {{ p.run.structureMethod }} · ${{ p.run.costUsd.toFixed(2) }} so far</span>
          </div>
        </template>
      </UPageCard>

      <UPageCard
        v-if="operator"
        to="/papers/new"
        variant="ghost"
        icon="i-lucide-plus"
        title="New paper"
        description="Paste a GitHub directory or arXiv id, or upload .tex files."
        class="border border-dashed border-accented"
      />
    </UPageGrid>
  </UContainer>
</template>
