<script setup lang="ts">
import type { BreadcrumbItem } from '@nuxt/ui'
import { familyCode } from '#shared/catalog'
import type { DisciplinesResponse, FamilyDetail, FamilyDigest } from '#shared/catalog'
import type { PaperResponse } from '#shared/api'

// Family page (storyboard frames 03 digested, 07 not yet). /papers/49 → 301 /papers/049; unknown → 404.
const site = { 'x-proofmap-site': '1' }
const route = useRoute()
const raw = String(route.params.code)
if (!/^\d{1,3}$/.test(raw)) {
  throw createError({ statusCode: 404, statusMessage: 'Family not found', fatal: true })
}
const code = familyCode(Number(raw))
if (code !== raw) {
  await navigateTo({ path: `/papers/${code}`, query: route.query }, { redirectCode: 301, replace: true })
}

const [{ data: family, error }, { data: catalog }] = await Promise.all([
  useFetch<FamilyDetail>(`/api/v1/families/${code}`, { key: `family-${code}`, headers: site }),
  useFetch<DisciplinesResponse>('/api/v1/disciplines', { key: 'catalog-disciplines', headers: site })
])
if (error.value || !family.value) {
  throw createError({ statusCode: 404, statusMessage: 'Family not found', fatal: true })
}
const f = computed(() => family.value!)
const digest = computed<FamilyDigest | undefined>(() => f.value.digested[0])
const stats = computed(() => catalog.value?.stats)
const leanUrl = computed(() => leanDocUrl(f.value.description))

const crumbs = computed<BreadcrumbItem[]>(() => [
  { label: 'Papers', to: '/papers' },
  { label: f.value.discipline, to: { path: '/papers', query: { discipline: f.value.disciplineSlug } } },
  { label: f.value.code }
])

const mailto = computed(() => `mailto:kyle@monumentlabs.io?subject=${encodeURIComponent(`Map request: family ${f.value.code} — ${indexProse(f.value.title)}`)}`)

// Ask hands off to the explorer with the question prefilled (?ask=, not sent). The main theorem's id is only in the
// digest, so it's fetched on submit rather than on every page view.
const question = ref('')
const asking = ref(false)
async function ask() {
  const d = digest.value
  const text = question.value.trim()
  if (!d || !text) {
    return
  }
  asking.value = true
  try {
    const res = await $fetch<PaperResponse>(`/api/papers/${d.slug}`)
    const root = res.digest?.root_ids[0] ?? res.digest?.nodes[0]?.id
    await navigateTo(root ? { path: `/${d.slug}/${root}`, query: { ask: text } } : `/${d.slug}`)
  } finally {
    asking.value = false
  }
}

const leanPct = computed(() => stats.value ? Math.round(100 * stats.value.lean / stats.value.families) : undefined)

useSeoMeta({
  title: () => `${f.value.code} · ${plainMath(indexProse(f.value.title))}`,
  description: () => plainMath(indexProse(f.value.description)).slice(0, 300),
  ogTitle: () => `Family ${f.value.code}: ${plainMath(indexProse(f.value.title))} · Proofmap`
})
</script>

<template>
  <UContainer>
    <!-- eslint-disable vue/no-v-html -- inlineMathHtml escapes the prose; only KaTeX markup is raw. -->
    <!-- The rail must also show on phones (UPageAside is lg-only), after the manuscripts. -->
    <UPage :ui="{ root: 'lg:grid-cols-12', center: 'lg:col-span-9', right: 'lg:col-span-3 order-last pb-12 lg:pb-0' }">
      <UPageHeader :ui="{ title: 'font-serif font-semibold', description: 'text-base sm:text-lg' }">
        <template #headline>
          <div class="flex flex-col gap-3">
            <UBreadcrumb
              :items="crumbs"
              :ui="{ item: 'min-w-0', link: 'text-sm' }"
            />
            <div class="flex flex-wrap items-center gap-2 font-normal">
              <span class="font-mono text-sm text-muted">Family {{ f.code }}</span>
              <UBadge
                :label="f.discipline"
                color="neutral"
                variant="subtle"
              />
              <UBadge
                v-if="f.hasLean"
                label="Lean"
                icon="i-lucide-check"
                color="info"
                variant="subtle"
              />
              <UBadge
                v-else
                label="No Lean"
                color="neutral"
                variant="outline"
              />
              <UBadge
                v-if="digest"
                label="Digested"
                color="success"
                variant="subtle"
              />
              <UBadge
                v-else
                label="Not yet digested"
                color="neutral"
                variant="outline"
              />
              <UBadge
                v-if="f.flagship && !digest"
                label="featured"
                color="primary"
                variant="subtle"
              />
            </div>
          </div>
        </template>
        <template #title>
          <span v-html="inlineMathHtml(indexProse(f.title))" />
        </template>
        <template #description>
          <NodeMathText :text="indexProse(f.description)" />
        </template>
      </UPageHeader>

      <UPageBody>
        <h2 class="mb-4 text-sm font-semibold text-highlighted">
          Manuscripts in this family · {{ f.manuscripts.length }}
        </h2>
        <div class="flex flex-col gap-4">
          <UCard
            v-for="m in f.manuscripts"
            :key="m.dir"
            :ui="{ body: 'p-4 sm:p-5' }"
          >
            <h3
              class="font-semibold text-highlighted text-pretty"
              v-html="inlineMathHtml(m.title)"
            />
            <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
              <span v-if="m.publishedOn">{{ formatDay(m.publishedOn) }}</span>
              <template v-if="m.digest?.pages">
                <span>·</span><span>{{ m.digest.pages }} pp</span>
              </template>
              <span>·</span>
              <span class="font-mono text-xs">{{ m.pdfUrl.split('/').pop() }}</span>
              <UBadge
                v-if="m.digest"
                label="Digested"
                color="success"
                variant="subtle"
                size="sm"
              />
              <UBadge
                v-if="m.hasLean"
                label="Lean"
                color="info"
                variant="subtle"
                size="sm"
              />
            </div>

            <!-- The trigger is the abstract itself: clamped to three lines while closed, whole when open. -->
            <UCollapsible class="mt-3">
              <template #default="{ open }">
                <div
                  role="button"
                  tabindex="0"
                  class="group block w-full cursor-pointer text-left"
                  :aria-label="open ? 'Collapse abstract' : 'Expand abstract'"
                  @keydown.enter.space.prevent="($event.currentTarget as HTMLElement).click()"
                >
                  <div
                    class="text-sm text-default"
                    :class="open ? '' : 'line-clamp-3'"
                  >
                    <NodeMathText :text="indexProse(m.abstract)" />
                  </div>
                  <span class="mt-1 inline-flex items-center gap-1 text-xs text-dimmed group-hover:text-muted">
                    <UIcon
                      :name="open ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                      class="size-3.5"
                    />
                    {{ open ? 'Show less' : 'Full abstract' }}
                  </span>
                </div>
              </template>
            </UCollapsible>

            <div class="mt-4 flex flex-wrap items-center gap-2">
              <UButton
                v-if="m.digest"
                :to="`/${m.digest.slug}`"
                label="Read the map"
                icon="i-lucide-map"
                size="sm"
              />
              <UButton
                :to="m.pdfUrl"
                target="_blank"
                label="PDF on GitHub"
                trailing-icon="i-lucide-external-link"
                color="neutral"
                variant="outline"
                size="sm"
              />
              <UButton
                :to="m.sourceUrl"
                target="_blank"
                label="LaTeX source"
                trailing-icon="i-lucide-external-link"
                color="neutral"
                variant="ghost"
                size="sm"
              />
            </div>
          </UCard>

          <p
            v-if="f.reasoningTrace"
            class="text-sm text-muted"
          >
            OpenAI also released the model's reasoning trace for this result:
            <ULink
              :to="f.reasoningTrace"
              target="_blank"
              class="text-primary hover:underline"
            >reasoning trace (PDF)</ULink>.
          </p>
        </div>
      </UPageBody>

      <template #right>
        <aside class="lg:sticky lg:top-(--ui-header-height) lg:max-h-[calc(100vh-var(--ui-header-height))] lg:overflow-y-auto lg:py-8">
          <div class="flex flex-col gap-4">
            <template v-if="digest">
              <UCard :ui="{ header: 'p-4 sm:px-4', body: 'p-4 sm:p-4' }">
                <template #header>
                  <h3 class="text-sm font-semibold text-highlighted">
                    Digest
                  </h3>
                </template>
                <dl class="flex flex-col gap-2 text-sm">
                  <div class="flex justify-between">
                    <dt class="text-muted">
                      Statements mapped
                    </dt><dd class="tabular-nums">
                      {{ digest.counts.nodes }}
                    </dd>
                  </div>
                  <div class="flex justify-between">
                    <dt class="text-muted">
                      Sections
                    </dt><dd class="tabular-nums">
                      {{ digest.counts.sections }}
                    </dd>
                  </div>
                  <div class="flex justify-between">
                    <dt class="text-muted">
                      Novel steps
                    </dt><dd>
                      <UBadge
                        :label="String(digest.counts.novel)"
                        color="primary"
                        variant="subtle"
                        size="sm"
                      />
                    </dd>
                  </div>
                  <div class="flex justify-between">
                    <dt class="text-muted">
                      Friction flags
                    </dt><dd class="tabular-nums">
                      {{ digest.counts.friction }}
                    </dd>
                  </div>
                  <div
                    v-if="digest.pages"
                    class="flex justify-between"
                  >
                    <dt class="text-muted">
                      Pages
                    </dt><dd class="tabular-nums">
                      {{ digest.pages }}
                    </dd>
                  </div>
                </dl>
                <UButton
                  :to="`/${digest.slug}`"
                  label="Open the overview"
                  trailing-icon="i-lucide-arrow-right"
                  block
                  class="mt-4"
                />
              </UCard>

              <UCard :ui="{ header: 'p-4 sm:px-4', body: 'p-4 sm:p-4' }">
                <template #header>
                  <h3 class="flex items-center gap-1.5 text-sm font-semibold text-highlighted">
                    <UIcon
                      name="i-lucide-message-circle"
                      class="size-4"
                    />
                    Ask this paper
                  </h3>
                </template>
                <UChatPrompt
                  v-model="question"
                  placeholder="Where does the main bound come from?"
                  variant="subtle"
                  :rows="2"
                  :autofocus="false"
                  @submit="ask"
                >
                  <template #footer>
                    <span class="text-xs text-dimmed">Answers cite nodes</span>
                    <UChatPromptSubmit
                      :status="asking ? 'submitted' : 'ready'"
                      color="neutral"
                      size="sm"
                    />
                  </template>
                </UChatPrompt>
                <p class="mt-2 text-xs text-dimmed">
                  Opens the explorer with your question ready to send.
                </p>
              </UCard>
            </template>

            <UCard
              v-else
              variant="outline"
              :ui="{ root: 'border border-dashed border-accented ring-0', body: 'p-5 sm:p-5' }"
            >
              <UIcon
                name="i-lucide-map"
                class="mb-2 size-6 text-dimmed"
              />
              <h3 class="font-semibold text-highlighted">
                This paper hasn't been mapped yet
              </h3>
              <p class="mt-1 text-sm text-muted">
                {{ stats?.digested ?? 5 }} of {{ stats?.families ?? 373 }} families have a full digest so far. The abstract and PDF are here; the map, node pages and chat are not.
              </p>
              <UButton
                :to="mailto"
                external
                label="Request a map"
                icon="i-lucide-mail"
                color="neutral"
                variant="outline"
                size="sm"
                class="mt-4"
              />
            </UCard>

            <UCard :ui="{ header: 'p-4 sm:px-4', body: 'p-4 sm:p-4' }">
              <template #header>
                <h3 class="text-sm font-semibold text-highlighted">
                  Lean
                </h3>
              </template>
              <p
                v-if="f.hasLean"
                class="text-sm text-muted"
              >
                Formalized in <code class="text-xs">openai/math/lean</code><template v-if="f.manuscripts.some(m => !m.hasLean)">
                  (not every manuscript)
                </template>.
                <ULink
                  v-if="leanUrl"
                  :to="leanUrl"
                  target="_blank"
                  class="mt-2 flex items-center gap-1 text-primary hover:underline"
                >
                  lean/docs/{{ f.code }}.md
                  <UIcon
                    name="i-lucide-external-link"
                    class="size-3.5"
                  />
                </ULink>
              </p>
              <p
                v-else
                class="text-sm text-muted"
              >
                No formalization for this family in <code class="text-xs">openai/math/lean</code>.
                <template v-if="stats">
                  {{ stats.lean }} of {{ stats.families }} families ({{ leanPct }}%) have one.
                </template>
              </p>
            </UCard>
          </div>
        </aside>
      </template>
    </UPage>
  </UContainer>
</template>
