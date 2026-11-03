<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { useDebounceFn } from '@vueuse/core'
import type { DisciplinesResponse, FamiliesQuery, FamiliesResponse, FamilySummary } from '#shared/catalog'

// Catalog (storyboard frame 02). Every filter lives in the query string, so a reload or a shared link reproduces the view.
const PAGE = 50
const site = { 'x-gpe-site': '1' }
const route = useRoute()
const router = useRouter()

const str = (v: unknown) => typeof v === 'string' && v ? v : undefined
const SORTS = [
  { label: 'Featured first', value: 'flagship' },
  { label: 'Family number', value: 'number' },
  { label: 'Title', value: 'title' },
  { label: 'Most papers', value: 'members' }
] as const
type Sort = FamiliesQuery['sort']

const filters = computed(() => ({
  q: str(route.query.q),
  discipline: str(route.query.discipline),
  digested: route.query.digested === '1' ? '1' as const : undefined,
  lean: route.query.lean === '1' ? '1' as const : undefined,
  sort: SORTS.some(s => s.value === route.query.sort) ? route.query.sort as Sort : undefined
}))

function setQuery(patch: Record<string, string | undefined>) {
  const merged = { ...route.query, ...patch, focus: undefined }
  router.replace({ query: Object.fromEntries(Object.entries(merged).filter(([, v]) => v !== undefined && v !== '')) })
}

// Lazy: a client navigation shows the page at once and skeletons fill in; SSR still renders the data.
const { data: catalog } = useFetch<DisciplinesResponse>('/api/v1/disciplines', { key: 'catalog-disciplines', headers: site, lazy: true })
const { data, status } = useFetch<FamiliesResponse>('/api/v1/families', { key: 'catalog-families', query: computed(() => ({ ...filters.value, limit: PAGE })), headers: site, lazy: true })

// Load more appends pages after the first; any filter change starts over.
const more = ref<FamilySummary[]>([])
const loadingMore = ref(false)
watch(filters, () => {
  more.value = []
})
const rows = computed(() => [...data.value?.families ?? [], ...more.value])
const total = computed(() => data.value?.total ?? 0)
const loadingRows = computed(() => !rows.value.length && (status.value === 'idle' || status.value === 'pending'))

async function loadMore() {
  loadingMore.value = true
  try {
    const res = await $fetch<FamiliesResponse>('/api/v1/families', { query: { ...filters.value, limit: PAGE, offset: rows.value.length }, headers: site })
    more.value.push(...res.families)
  } finally {
    loadingMore.value = false
  }
}

// Search box: local text, debounced into ?q=.
const search = ref(filters.value.q ?? '')
const pushSearch = useDebounceFn((v: string) => setQuery({ q: v.trim() || undefined }), 250)
watch(search, v => pushSearch(v))
watch(() => filters.value.q, (q) => {
  if ((q ?? '') !== search.value.trim()) {
    search.value = q ?? ''
  }
})

const disciplineItems = computed(() => [
  { label: 'All disciplines', value: 'all' },
  ...(catalog.value?.disciplines ?? []).map(d => ({ label: d.name, value: d.slug }))
])
const discipline = computed({
  get: () => filters.value.discipline ?? 'all',
  set: v => setQuery({ discipline: v === 'all' ? undefined : v })
})
const digested = computed({
  get: () => !!filters.value.digested,
  set: v => setQuery({ digested: v ? '1' : undefined })
})
const lean = computed({
  get: () => !!filters.value.lean,
  set: v => setQuery({ lean: v ? '1' : undefined })
})
const sort = computed({
  get: () => filters.value.sort ?? 'flagship',
  set: v => setQuery({ sort: v === 'flagship' ? undefined : v })
})
const filtered = computed(() => !!(filters.value.q || filters.value.discipline || filters.value.digested || filters.value.lean))
function clearFilters() {
  search.value = ''
  setQuery({ q: undefined, discipline: undefined, digested: undefined, lean: undefined })
}

const stats = computed(() => catalog.value?.stats)
const status_ = (f: FamilySummary) => f.digested.length
  ? { label: 'Digested', color: 'success' as const }
  : f.hasLean ? { label: 'Lean', color: 'info' as const } : { label: 'Not yet', color: 'neutral' as const }

const columns: TableColumn<FamilySummary>[] = [
  { accessorKey: 'code', header: '#', meta: { class: { th: 'w-14', td: 'font-mono text-muted align-top' } } },
  { id: 'result', header: 'Result', meta: { class: { td: 'whitespace-normal min-w-0 align-top' } } },
  { accessorKey: 'discipline', header: 'Discipline', meta: { class: { th: 'w-48', td: 'whitespace-normal text-muted align-top' } } },
  { accessorKey: 'members', header: 'Papers', meta: { class: { th: 'w-16 text-right', td: 'text-right tabular-nums text-muted align-top' } } },
  { id: 'status', header: 'Status', meta: { class: { th: 'w-24', td: 'align-top' } } },
  { id: 'action', meta: { class: { th: 'w-28', td: 'text-right align-top' } } }
]

function open(f: FamilySummary) {
  return navigateTo(`/papers/${f.code}`)
}

useSeoMeta({
  title: 'Papers',
  description: () => `All ${stats.value?.families ?? 373} result families from openai/math: ${stats.value?.manuscripts ?? 721} machine-written papers across ${stats.value?.disciplines ?? 17} disciplines, searchable, with abstracts and PDF links.`,
  ogTitle: 'Papers · GPE'
})
</script>

<template>
  <UContainer>
    <!-- eslint-disable vue/no-v-html -- inlineMathHtml escapes the prose; only KaTeX markup is raw. -->
    <UPageHeader
      title="Papers"
      :ui="{ title: 'font-serif font-semibold', root: 'border-none pb-4' }"
    >
      <template #description>
        <span v-if="stats">
          {{ stats.families }} results · {{ stats.manuscripts }} papers · {{ stats.disciplines }} disciplines ·
          <span class="text-primary">{{ stats.digested }} digested</span>
        </span>
        <USkeleton
          v-else
          class="h-6 w-96 max-w-full"
        />
      </template>
    </UPageHeader>

    <div class="flex flex-col gap-3 pb-4 lg:flex-row lg:flex-wrap lg:items-center">
      <UInput
        v-model="search"
        icon="i-lucide-search"
        placeholder="Search titles and results…"
        :autofocus="route.query.focus === '1'"
        class="w-full lg:w-80"
        aria-label="Search titles and results"
      />
      <div class="flex flex-wrap items-center gap-x-4 gap-y-3">
        <USelectMenu
          v-model="discipline"
          :items="disciplineItems"
          value-key="value"
          :search-input="{ placeholder: 'Filter disciplines…' }"
          class="w-56"
          aria-label="Discipline"
        />
        <USwitch
          v-model="digested"
          label="Digested"
        />
        <USwitch
          v-model="lean"
          label="Has Lean"
        />
      </div>
      <div class="flex items-center gap-2 lg:ms-auto">
        <span class="text-sm text-muted">Sort</span>
        <USelectMenu
          v-model="sort"
          :items="[...SORTS]"
          value-key="value"
          :search-input="false"
          class="w-44"
          aria-label="Sort"
        />
      </div>
    </div>

    <p class="pb-2 text-sm text-dimmed">
      <template v-if="loadingRows">
        Loading…
      </template>
      <template v-else>
        Showing {{ rows.length }} of {{ total }}<template v-if="filtered">
          matching
        </template>
      </template>
    </p>

    <div
      v-if="loadingRows"
      class="flex flex-col gap-2 pb-10"
    >
      <USkeleton
        v-for="n in 10"
        :key="n"
        class="h-16 rounded-md"
      />
    </div>

    <UEmpty
      v-else-if="!rows.length"
      icon="i-lucide-search-x"
      title="No families match"
      description="Try a broader search or clear the filters."
      :actions="[{ label: 'Clear filters', icon: 'i-lucide-x', color: 'neutral', variant: 'outline', onClick: clearFilters }]"
      class="my-12"
    />

    <template v-else>
      <!-- md and up: a dense table. Below md: stacked rows instead of a horizontal scroll. -->
      <UTable
        :data="rows"
        :columns="columns"
        class="hidden md:block"
        :ui="{ tr: 'cursor-pointer', td: 'py-3' }"
        @select="(_e, row) => open(row.original)"
      >
        <template #result-cell="{ row }">
          <NuxtLink
            :to="`/papers/${row.original.code}`"
            class="font-medium text-highlighted hover:underline underline-offset-2"
            @click.stop
          >
            <span v-html="inlineMathHtml(row.original.title)" />
          </NuxtLink>
          <UBadge
            v-if="row.original.flagship && !row.original.digested.length"
            label="featured"
            color="primary"
            variant="subtle"
            size="sm"
            class="ms-2 align-middle"
          />
          <p
            class="mt-0.5 line-clamp-1 text-sm text-muted"
            v-html="inlineMathHtml(indexProse(row.original.description))"
          />
        </template>
        <template #status-cell="{ row }">
          <UBadge
            :label="status_(row.original).label"
            :color="status_(row.original).color"
            variant="subtle"
          />
        </template>
        <template #action-cell="{ row }">
          <UButton
            v-if="row.original.digested[0]"
            :to="`/${row.original.digested[0].slug}`"
            label="Open map"
            icon="i-lucide-map"
            size="sm"
            @click.stop
          />
        </template>
      </UTable>

      <ul class="divide-y divide-default border-y border-default md:hidden">
        <li
          v-for="f in rows"
          :key="f.number"
          class="py-3"
        >
          <NuxtLink
            :to="`/papers/${f.code}`"
            class="block"
          >
            <div class="flex items-center gap-2 text-xs text-muted">
              <span class="font-mono">{{ f.code }}</span>
              <span>·</span>
              <span class="truncate">{{ f.discipline }}</span>
              <span>·</span>
              <span class="shrink-0">{{ f.members }} {{ f.members === 1 ? 'paper' : 'papers' }}</span>
            </div>
            <div
              class="mt-1 font-medium text-highlighted"
              v-html="inlineMathHtml(f.title)"
            />
            <p
              class="mt-0.5 line-clamp-2 text-sm text-muted"
              v-html="inlineMathHtml(indexProse(f.description))"
            />
          </NuxtLink>
          <div class="mt-2 flex items-center gap-2">
            <UBadge
              :label="status_(f).label"
              :color="status_(f).color"
              variant="subtle"
              size="sm"
            />
            <UBadge
              v-if="f.flagship && !f.digested.length"
              label="featured"
              color="primary"
              variant="subtle"
              size="sm"
            />
            <UButton
              v-if="f.digested[0]"
              :to="`/${f.digested[0].slug}`"
              label="Open map"
              icon="i-lucide-map"
              size="xs"
              class="ms-auto"
            />
          </div>
        </li>
      </ul>

      <div
        v-if="rows.length < total"
        class="flex justify-center py-6"
      >
        <UButton
          label="Load more"
          color="neutral"
          variant="outline"
          :loading="loadingMore"
          @click="loadMore"
        />
      </div>
      <div
        v-else
        class="h-10"
      />
    </template>
  </UContainer>
</template>
