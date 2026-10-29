<script setup lang="ts">
// Friction report (frame 04): every `friction` item on every node, ranked by severity. Deliberately plain.
import type { TableColumn, TabsItem } from '@nuxt/ui'
import type { Friction, FrictionKind } from '#shared/types'

definePageMeta({ layout: 'dashboard' })

const route = useRoute()
const slug = computed(() => String(route.params.paper ?? ''))
const { paper, digest, index, error, ready } = useDigest(slug)
provideDigest({ paper, digest, index })
await ready

if (error.value) {
  throw createError({ statusCode: error.value.statusCode ?? 404, statusMessage: error.value.statusMessage ?? 'Paper not found', fatal: true })
}
if (paper.value && !digest.value) {
  await navigateTo(`/papers/${slug.value}/run`, { replace: true })
}

useSeoMeta({ title: () => `Friction · ${digest.value?.title ?? slug.value}` })

interface Row {
  key: string
  severity: Friction['severity']
  kind: FrictionKind
  nodeId: string
  note: string
  source?: string
  where: string
}

const rows = computed<Row[]>(() => {
  const out: Row[] = []
  for (const n of digest.value?.nodes ?? []) {
    n.friction.forEach((f, i) => {
      out.push({
        key: `${n.id}-${i}`,
        severity: f.severity,
        kind: f.kind,
        nodeId: n.id,
        note: f.note,
        source: sourceUrl(paper.value, n.paper_ref),
        where: `${n.paper_ref.file}:${n.paper_ref.line}`
      })
    })
  }
  return out.sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity))
})

const bySeverity = computed(() => Object.fromEntries(SEVERITY_ORDER.map(s => [s, rows.value.filter(r => r.severity === s).length])) as Record<Friction['severity'], number>)

// Local, not in the query: node chips carry the query along, and ?severity means nothing on a node page.
const severity = ref<string | number>('all')
const tabs = computed<TabsItem[]>(() => [
  { label: 'All', value: 'all', badge: { label: String(rows.value.length), color: 'neutral', variant: 'subtle' } },
  ...SEVERITY_ORDER.map(s => ({ label: capitalize(s), value: s, badge: { label: String(bySeverity.value[s]), color: SEVERITY_COLOR[s], variant: 'subtle' as const } }))
])
const visible = computed(() => severity.value === 'all' ? rows.value : rows.value.filter(r => r.severity === severity.value))

const stats = computed(() => {
  const nodes = digest.value?.nodes ?? []
  return [
    { label: 'paper statements', value: nodes.filter(n => n.kind !== 'claim').length, icon: 'i-lucide-file-text' },
    { label: 'Lean declarations (Phase 2)', value: '—', icon: 'i-lucide-sigma' },
    { label: 'aligned pairs', value: '—', icon: 'i-lucide-link-2' },
    { label: 'friction items', value: rows.value.length, icon: 'i-lucide-triangle-alert' }
  ]
})

const summary = computed(() => [`${rows.value.length} items`, ...SEVERITY_ORDER.filter(s => bySeverity.value[s]).map(s => `${bySeverity.value[s]} ${s}`)].join(' · '))

const columns: TableColumn<Row>[] = [
  { accessorKey: 'severity', header: 'Severity' },
  { accessorKey: 'kind', header: 'Kind' },
  { accessorKey: 'nodeId', header: 'Node' },
  { accessorKey: 'note', header: 'Note' },
  { accessorKey: 'where', header: 'Source' }
]
</script>

<template>
  <UDashboardPanel id="friction">
    <template #header>
      <UDashboardNavbar :ui="{ title: 'min-w-0' }">
        <template #title>
          <UBreadcrumb
            :items="[
              { label: digest?.title ?? slug, icon: 'i-lucide-book-open', to: `/${slug}` },
              { label: 'Friction report' }
            ]"
            :ui="{ linkLabel: 'truncate max-w-48 md:max-w-80' }"
          />
        </template>
        <template #right>
          <UButton
            :to="`/${slug}`"
            icon="i-lucide-arrow-left"
            label="Back to the map"
            color="neutral"
            variant="ghost"
            size="sm"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <div>
          <h1 class="text-2xl font-semibold text-highlighted">
            Friction report
          </h1>
          <p class="mt-1 text-sm text-muted">
            Where the sources disagree or the structure was guessed, ranked. {{ summary }}. In v1 these are paper-internal; Lean-vs-paper rows arrive in Phase 2.
          </p>
        </div>

        <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <UCard
            v-for="s in stats"
            :key="s.label"
            variant="subtle"
            :ui="{ body: 'p-4 sm:p-4' }"
          >
            <div class="flex items-center gap-2 text-xs text-muted">
              <UIcon
                :name="s.icon"
                class="size-4"
              />
              {{ s.label }}
            </div>
            <div class="mt-1 text-2xl font-semibold text-highlighted tabular-nums">
              {{ s.value }}
            </div>
          </UCard>
        </div>

        <UTabs
          v-model="severity"
          :items="tabs"
          :content="false"
          size="sm"
          color="neutral"
          class="w-full sm:w-auto sm:self-start"
        />

        <UTable
          :data="visible"
          :columns="columns"
          :get-row-id="(r: Row) => r.key"
          class="rounded-md border border-default"
          :ui="{ td: 'align-top whitespace-normal', th: 'whitespace-nowrap' }"
        >
          <template #severity-cell="{ row }">
            <UBadge
              :color="SEVERITY_COLOR[row.original.severity]"
              variant="subtle"
              :label="row.original.severity"
            />
          </template>
          <template #kind-cell="{ row }">
            <code class="text-xs">{{ row.original.kind }}</code>
          </template>
          <template #nodeId-cell="{ row }">
            <div class="max-w-56">
              <NodeChip :id="row.original.nodeId" />
            </div>
          </template>
          <template #note-cell="{ row }">
            <NodeMathText
              :text="row.original.note"
              class="min-w-64 text-sm text-default"
            />
          </template>
          <template #where-cell="{ row }">
            <UButton
              v-if="row.original.source"
              :to="row.original.source"
              target="_blank"
              size="xs"
              color="neutral"
              variant="ghost"
              trailing-icon="i-lucide-external-link"
              :label="row.original.where"
              class="font-mono"
            />
            <code
              v-else
              class="text-xs text-muted"
            >{{ row.original.where }}</code>
          </template>
          <template #empty>
            <UEmpty
              icon="i-lucide-check"
              :title="rows.length ? 'Nothing at this severity' : 'No friction recorded'"
              variant="naked"
            />
          </template>
        </UTable>
      </div>
    </template>
  </UDashboardPanel>
</template>
