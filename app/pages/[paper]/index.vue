<script setup lang="ts">
// `/[paper]`: the paper overview (storyboard frame 04): what it proves, the main theorem, where the new idea lives,
// the proof's shape, and three doors into the explorer. Not yet digested → the run page (operator) or 404.
definePageMeta({ layout: 'dashboard' })

const route = useRoute()
const slug = String(route.params.paper)
const { paper, digest, catalog, index, error, ready } = useDigest(slug)
const { operator, ready: operatorReady } = useOperator()
provideDigest({ paper, digest, index })
await ready

if (error.value) {
  throw createError({ statusCode: error.value.statusCode ?? 404, statusMessage: error.value.statusMessage ?? 'Paper not found', fatal: true })
}
if (paper.value && !digest.value) {
  await operatorReady
  if (!operator.value) {
    throw createError({ statusCode: 404, statusMessage: 'Paper not found', fatal: true })
  }
  await navigateTo(`/admin/papers/${slug}/run`, { replace: true, redirectCode: 302 })
}

const main = computed(() => {
  const d = digest.value
  return d ? index.value.byId.get(d.root_ids[0] ?? '') ?? d.nodes[0] : undefined
})
const rootId = computed(() => main.value?.id ?? '')
const lookup = computed(() => ({ digest: digest.value, children: index.value.children, byId: index.value.byId }))

// "What this paper proves": the summary, else the manuscript abstract, else the main theorem in plain English.
const proves = computed(() => {
  const s = digest.value?.summary
  if (s) {
    return { text: s.proves, fallback: false }
  }
  const abstract = catalog.value?.manuscript.abstract
  return { text: abstract || main.value?.statement_plain || '', fallback: true }
})

const novel = computed(() => (digest.value?.nodes ?? []).filter(n => n.classification === 'novel' && n.id !== rootId.value && n.kind !== 'remark'))

const novelTotal = computed(() => (digest.value?.nodes ?? []).filter(n => n.classification === 'novel').length)

const stats = computed(() => {
  const nodes = digest.value?.nodes ?? []
  return [
    { label: 'statements mapped', value: nodes.length },
    { label: 'sections', value: digest.value?.sections.length ?? 0 },
    { label: 'novel steps', value: novelTotal.value },
    { label: 'friction flags', value: nodes.reduce((sum, n) => sum + n.friction.length, 0) }
  ]
})

const published = computed(() => {
  const d = catalog.value?.manuscript.publishedOn
  return d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : undefined
})
const pages = computed(() => digest.value?.render?.pages)
const meta = computed(() => [pages.value ? `${pages.value} pp` : '', published.value ?? ''].filter(Boolean).join(' · '))

const explorer = (query: Record<string, string> = {}) => ({ path: `/${slug}/${rootId.value}`, query })
const doors = computed(() => [
  { title: 'Map', description: 'The proof as a tree and a dependency graph. Start at the top and click down.', icon: 'i-lucide-git-fork', to: explorer({ view: 'graph' }) },
  ...(digest.value?.render?.pdf_url ? [{ title: 'Read the paper', description: 'The PDF with the map beside it; every statement is linked.', icon: 'i-lucide-book-open-text', to: explorer({ view: 'paper', page: '1' }) }] : []),
  { title: 'Ask', description: 'Questions answered with citations to the map you can click.', icon: 'i-lucide-message-square', to: explorer({ ask: '' }) }
])

const headlineText = computed(() => (digest.value?.summary?.headline ?? '').replace(/\$/g, ''))
useSeoMeta({
  title: () => digest.value?.title ?? slug,
  description: () => headlineText.value || catalog.value?.family.description || undefined,
  ogTitle: () => digest.value?.title ?? slug,
  ogDescription: () => headlineText.value || undefined
})
</script>

<template>
  <UDashboardPanel
    id="overview"
    :ui="{ body: 'p-0 sm:p-0' }"
  >
    <template #header>
      <PaperNavbar
        :slug="slug"
        :title="digest?.title ?? slug"
        :family="catalog?.family"
        active="overview"
        :node-id="rootId"
        logo
      >
        <template #right>
          <UButton
            :to="explorer({ ask: '' })"
            icon="i-lucide-message-square"
            label="Ask"
            color="neutral"
            variant="ghost"
            size="sm"
            :ui="{ label: 'hidden sm:inline' }"
          />
        </template>
      </PaperNavbar>
    </template>

    <template #body>
      <div
        v-if="digest && main"
        class="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-6 sm:px-8 sm:py-8"
      >
        <UPageHeader
          :title="digest.title"
          :ui="{ root: 'border-none py-0', title: 'font-serif text-3xl sm:text-4xl font-semibold text-pretty', headline: 'flex flex-wrap items-center gap-2 mb-3' }"
        >
          <template #headline>
            <template v-if="catalog">
              <NuxtLink
                :to="`/papers/${catalog.family.code}`"
                class="font-mono text-sm text-muted hover:text-highlighted"
              >Family {{ catalog.family.code }}</NuxtLink>
              <UBadge
                :label="catalog.family.discipline"
                color="neutral"
                variant="subtle"
              />
              <UBadge
                v-if="catalog.manuscript.hasLean"
                label="Lean"
                icon="i-lucide-check"
                color="info"
                variant="subtle"
              />
            </template>
            <span
              v-if="meta"
              class="text-sm text-muted"
            >{{ meta }}</span>
          </template>
        </UPageHeader>

        <section data-proves>
          <h2 class="mb-2 text-xs font-semibold tracking-wider text-dimmed uppercase">
            What this paper proves
            <span
              v-if="proves.fallback"
              class="ms-1 font-normal tracking-normal normal-case"
            >· {{ catalog?.manuscript.abstract ? 'from the abstract' : 'the main theorem in plain English' }}</span>
          </h2>
          <NodeMathText
            :text="proves.text"
            class="text-base/7 text-default sm:text-lg/8"
          />
        </section>

        <section>
          <h2 class="mb-2 text-xs font-semibold tracking-wider text-dimmed uppercase">
            Main theorem
          </h2>
          <NuxtLink
            :to="`/${slug}/${main.id}`"
            class="block rounded-lg border border-primary/60 bg-primary/5 p-4 transition-colors hover:border-primary sm:p-5"
            data-main-theorem
          >
            <div class="mb-2 flex flex-wrap items-center gap-2">
              <UBadge
                :label="main.kind"
                :icon="KIND_ICON[main.kind]"
                color="neutral"
                variant="outline"
              />
              <UBadge
                :label="main.classification"
                :color="CLASS_COLOR[main.classification]"
                variant="subtle"
              />
              <span class="font-semibold text-highlighted">{{ main.name }}</span>
              <span class="ms-auto font-mono text-xs text-muted">
                {{ main.paper_ref.label ?? nodeTitle(main, lookup) }}<template v-if="main.paper_ref.page"> · p. {{ main.paper_ref.page }}</template>
              </span>
            </div>
            <NodeMathText
              :text="main.statement_plain"
              class="mb-3 block text-sm/6 text-default sm:text-base/7"
            />
            <div class="rounded-md border border-default bg-default px-4 py-3 text-sm text-default">
              <div class="mb-1 text-[11px] font-semibold tracking-wider text-dimmed uppercase">
                {{ nodeTitle(main, lookup) }} · as stated in the paper
              </div>
              <NodeMathText :text="main.statement_paper" />
            </div>
          </NuxtLink>
        </section>

        <div class="grid gap-8 md:grid-cols-[1fr_17rem]">
          <section>
            <h2 class="mb-2 text-xs font-semibold tracking-wider text-dimmed uppercase">
              Where the new idea lives · {{ novelTotal }} novel {{ novelTotal === 1 ? 'step' : 'steps' }}
              <span
                v-if="main.classification === 'novel'"
                class="font-normal tracking-normal normal-case"
              >(one is the main theorem)</span>
            </h2>
            <div
              v-if="novel.length"
              class="flex flex-col gap-2"
            >
              <UPageCard
                v-for="n in novel"
                :key="n.id"
                :to="`/${slug}/${n.id}`"
                variant="outline"
                :ui="{ container: 'p-3 sm:p-3 gap-y-1', wrapper: 'gap-1', title: 'text-sm', description: 'text-sm' }"
                data-novel
              >
                <template #title>
                  <span class="flex items-center gap-2">
                    <UBadge
                      :label="nodeShortRef(n, lookup) === n.name ? KIND_SHORT[n.kind] : nodeShortRef(n, lookup)"
                      color="primary"
                      variant="subtle"
                      size="sm"
                      class="shrink-0"
                    />
                    <span class="truncate">{{ n.name }}</span>
                  </span>
                </template>
                <template #description>
                  <NodeMathText
                    :text="n.headline ?? n.statement_plain"
                    class="line-clamp-2"
                  />
                </template>
              </UPageCard>
            </div>
            <p
              v-else
              class="text-sm text-muted"
            >
              The map marks no step besides the main theorem as novel.
            </p>
          </section>

          <section>
            <h2 class="mb-2 text-xs font-semibold tracking-wider text-dimmed uppercase">
              Shape of the proof
            </h2>
            <NuxtLink
              :to="explorer({ view: 'graph' })"
              class="block rounded-lg border border-default bg-elevated/40 p-3 transition-colors hover:border-primary"
              aria-label="Open the proof graph"
            >
              <GraphProofShape
                :nodes="digest.nodes"
                :root-id="rootId"
              />
              <p class="mt-2 flex items-center gap-3 text-xs text-muted">
                <span class="inline-flex items-center gap-1"><span class="size-2 rounded-full bg-primary" /> novel</span>
                <span class="inline-flex items-center gap-1"><span class="size-2 rounded-full border border-(--ui-text-dimmed)" /> other</span>
                <span class="ms-auto">Open the graph →</span>
              </p>
            </NuxtLink>
          </section>
        </div>

        <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div
            v-for="s in stats"
            :key="s.label"
            class="rounded-lg border border-default px-4 py-3"
          >
            <div class="text-2xl font-semibold text-highlighted tabular-nums">
              {{ s.value }}
            </div>
            <div class="text-xs text-muted">
              {{ s.label }}
            </div>
          </div>
        </div>

        <UPageGrid
          class="gap-3"
          :class="doors.length === 3 ? 'sm:grid-cols-2 lg:grid-cols-3' : 'sm:grid-cols-2 lg:grid-cols-2'"
        >
          <UPageCard
            v-for="d in doors"
            :key="d.title"
            :title="d.title"
            :description="d.description"
            :icon="d.icon"
            :to="d.to"
            variant="outline"
            :ui="{ leadingIcon: 'text-primary' }"
            data-door
          />
        </UPageGrid>
      </div>
    </template>
  </UDashboardPanel>
</template>
