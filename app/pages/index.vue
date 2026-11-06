<script setup lang="ts">
import type { DisciplinesResponse, FamiliesResponse } from '#shared/catalog'
import type { PublicPaperItem } from '#shared/api'
import { FLAGSHIP } from '#shared/flagship'

// Landing (storyboard frame 01). The header overlays the hero here; see app/layouts/default.vue.
definePageMeta({ headerOverlay: true })
useSeoMeta({ title: 'Proofmap' })

// Lazy: a client navigation shows the page at once and skeletons fill in; SSR still renders the data.
const site = { 'x-proofmap-site': '1' }
const { data: papers, status: papersStatus } = useFetch<PublicPaperItem[]>('/api/papers', { key: 'landing-papers', lazy: true })
const { data: catalog, status: catalogStatus } = useFetch<DisciplinesResponse>('/api/v1/disciplines', { key: 'landing-disciplines', headers: site, lazy: true })
const { data: digestedFamilies } = useFetch<FamiliesResponse>('/api/v1/families', { key: 'landing-digested', query: { digested: '1', limit: 50 }, headers: site, lazy: true })

const isLoading = (status: string) => status === 'idle' || status === 'pending'
const stats = computed(() => catalog.value?.stats)
const rank = (n?: number) => {
  const i = FLAGSHIP.findIndex(f => f.number === n)
  return i < 0 ? Infinity : i
}

// Only papers that belong to a catalog family (the dev toy doesn't), best flagship rank first.
const catalogued = computed(() => (papers.value ?? []).filter(p => p.family).sort((a, b) => rank(a.family?.number) - rank(b.family?.number)))
const featured = computed(() => catalogued.value.slice(0, 3).map((p) => {
  const fam = digestedFamilies.value?.families.find(f => f.number === p.family!.number)
  const digest = fam?.digested.find(d => d.slug === p.slug)
  return {
    ...p,
    line: p.headline ?? digest?.headline ?? (fam ? indexProse(fam.description) : undefined),
    pages: p.pages ?? digest?.pages
  }
}))

// Left-aligned section heads, as in the storyboard; the serif carries the display headings.
const sectionUi = {
  container: 'py-16 sm:py-20 lg:py-24 gap-8 sm:gap-10',
  title: 'font-serif font-semibold text-left',
  description: 'text-left text-pretty',
  body: 'mt-10',
  features: 'mt-2'
}

const steps = [
  {
    icon: 'i-lucide-network',
    title: 'The map',
    description: 'Every theorem, lemma and in-proof claim becomes a node; "uses" edges are drawn as a layered DAG with the main result on top. Click a node and its whole support lights up.'
  },
  {
    icon: 'i-lucide-file-text',
    title: 'The node',
    description: 'Each step has a name, the paper\'s statement, a plain-English version, why it is here, and a classification: novel, routine, or a known result with its citation.'
  },
  {
    icon: 'i-lucide-message-circle',
    title: 'Ask the paper',
    description: 'A chat that only knows the map. Every claim in an answer cites a node, and clicking the citation opens that step. It will not assert anything that is not in the map.'
  }
]
</script>

<template>
  <div>
    <!-- eslint-disable vue/no-v-html -- inlineMathHtml escapes the prose; only KaTeX markup is raw. -->
    <section class="relative isolate flex min-h-[92svh] items-center overflow-hidden bg-[#1d150e]">
      <img
        src="/landing/hero.webp"
        srcset="/landing/hero-960.webp 960w, /landing/hero.webp 1536w"
        sizes="100vw"
        fetchpriority="high"
        alt="Oil painting of a scholar at a desk with a compass and globe"
        class="absolute inset-0 -z-10 size-full object-cover object-[65%_50%]"
      >
      <div class="absolute inset-0 -z-10 bg-linear-to-r from-black/80 via-black/40 to-transparent" />
      <div class="absolute inset-0 -z-10 bg-linear-to-b from-black/40 via-transparent to-black/30 lg:from-black/30" />

      <UPageHero
        orientation="horizontal"
        class="w-full"
        :ui="{
          container: 'pt-[calc(var(--ui-header-height)+4rem)] pb-20 sm:pb-24 lg:py-32 lg:grid-cols-[minmax(0,40rem)_1fr]',
          wrapper: 'text-left',
          title: 'font-serif font-semibold text-white text-5xl sm:text-7xl leading-[1.02] tracking-tight text-left',
          description: 'text-white/80 text-lg sm:text-xl/8',
          links: 'gap-x-3'
        }"
      >
        <template #title>
          Follow the proof.
        </template>
        <template #description>
          Step-by-step maps of OpenAI's math papers, in plain English.
        </template>
        <template #links>
          <UButton
            to="/papers"
            label="Browse the papers"
            size="xl"
            color="neutral"
            variant="solid"
            class="bg-white text-black hover:bg-white/90"
          />
          <UButton
            to="/eth"
            label="Start with the ETH disproof"
            trailing-icon="i-lucide-arrow-right"
            size="xl"
            color="neutral"
            variant="outline"
            class="bg-transparent text-white ring-white/50 hover:bg-white/10"
          />
        </template>
      </UPageHero>
    </section>

    <UPageSection
      :ui="sectionUi"
    >
      <template #title>
        Featured digests
      </template>
      <template #description>
        <span class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <span>Fully mapped papers. Each one took a careful model pass; the rest of the catalog is read-only until it gets its turn.</span>
          <UButton
            :to="{ path: '/papers', query: { digested: '1' } }"
            :label="isLoading(papersStatus) ? 'All digested' : `All digested (${catalogued.length})`"
            trailing-icon="i-lucide-arrow-right"
            color="neutral"
            variant="outline"
            class="shrink-0 self-start sm:self-auto"
          />
        </span>
      </template>

      <UPageGrid>
        <template v-if="isLoading(papersStatus)">
          <USkeleton
            v-for="n in 3"
            :key="n"
            class="h-64 rounded-lg"
          />
        </template>
        <UPageCard
          v-for="p in featured"
          :key="p.slug"
          :to="`/${p.slug}`"
          variant="outline"
          :ui="{ container: 'gap-y-3' }"
        >
          <template #header>
            <div class="flex flex-wrap gap-1.5">
              <UBadge
                :label="p.family!.discipline"
                color="neutral"
                variant="subtle"
              />
              <UBadge
                v-if="p.hasLean"
                label="Lean"
                icon="i-lucide-check"
                color="info"
                variant="subtle"
              />
            </div>
          </template>
          <template #title>
            <span
              class="text-lg leading-snug"
              v-html="inlineMathHtml(p.title)"
            />
          </template>
          <template #description>
            <span class="block text-sm text-dimmed">Family {{ p.family!.code }}<template v-if="p.pages"> · {{ p.pages }} pp</template></span>
            <span
              v-if="p.line"
              class="mt-1.5 line-clamp-2 text-sm"
              v-html="inlineMathHtml(p.line)"
            />
          </template>
          <template #footer>
            <div class="flex gap-4 text-sm text-muted">
              <span><b class="font-semibold text-highlighted">{{ p.counts.nodes }}</b> nodes</span>
              <span><b class="font-semibold text-highlighted">{{ p.counts.novel }}</b> novel</span>
              <span><b class="font-semibold text-highlighted">{{ p.counts.sections }}</b> sections</span>
            </div>
          </template>
        </UPageCard>
      </UPageGrid>
    </UPageSection>

    <UPageSection
      title="How a paper reads here"
      description="The source PDFs are dense and unsigned. The explorer gives each one three handles."
      :features="steps"
      :ui="{ ...sectionUi, root: 'border-t border-default' }"
    />

    <UPageSection
      id="disciplines"
      :ui="{ ...sectionUi, root: 'bg-elevated/50 border-t border-default scroll-mt-(--ui-header-height)' }"
      title="Browse by discipline"
      :description="`${stats?.families ?? 373} result families. The count is families; the second number is how many are digested so far.`"
    >
      <UPageGrid class="lg:grid-cols-4 xl:grid-cols-4">
        <template v-if="isLoading(catalogStatus)">
          <USkeleton
            v-for="n in stats?.disciplines ?? 17"
            :key="n"
            class="h-20 rounded-lg"
          />
        </template>
        <UPageCard
          v-for="d in catalog?.disciplines ?? []"
          :key="d.slug"
          :to="{ path: '/papers', query: { discipline: d.slug } }"
          variant="outline"
          :ui="{ container: 'p-4 sm:p-4 gap-y-1', title: 'text-sm' }"
          :title="d.name"
        >
          <template #description>
            <span class="text-sm text-muted">
              {{ d.families }} families<template v-if="d.digested"> · <span class="text-primary">{{ d.digested }} digested</span></template>
            </span>
          </template>
        </UPageCard>
      </UPageGrid>
    </UPageSection>
  </div>
</template>
