<script setup lang="ts">
// The node hover card's contents, ordered for a mathematician: what it is, the exact statement, what it says,
// why it's here, what it rests on and feeds, how it's classified, and exactly where it comes from.
import type { ProofNode } from '#shared/types'

const props = defineProps<{
  node: ProofNode
  /** The tree's light card: header, headline, a short statement and one provenance line. */
  compact?: boolean
  /** Reached through an inferred edge (a dashed Uses chip). */
  inferred?: boolean
}>()

const emit = defineEmits<{ done: [] }>()

provideInHoverCard()

const { paper, digest, index } = useDigestContext()
const chat = injectPaperChat()
const route = useRoute()
const { linkTo } = useSelection()

const lookup = computed<CardLookup>(() => ({ digest: digest.value, byId: index.value.byId, children: index.value.children, sectionOf: index.value.sectionOf }))
const title = computed(() => nodeTitle(props.node, lookup.value))
const parent = computed(() => props.node.parent_id ? index.value.byId.get(props.node.parent_id) : undefined)
const prov = computed(() => nodeProvenance(props.node, lookup.value))
const url = computed(() => sourceUrl(paper.value, props.node.paper_ref))
const severity = computed(() => maxSeverity(props.node))

const DEP_LIMIT = 4
const showAllUses = ref(false)
const showAllUsedBy = ref(false)
const uses = computed(() => usesOf(props.node))
const usedBy = computed(() => usedByOf(props.node, index.value.usedBy[props.node.id] ?? [], index.value.byId))
const usesShown = computed(() => takeSome(uses.value, showAllUses.value ? Infinity : DEP_LIMIT))
const usedByShown = computed(() => takeSome(usedBy.value, showAllUsedBy.value ? Infinity : DEP_LIMIT))
const depRows = computed(() => [
  { key: 'uses', label: 'Uses', list: usesShown.value, toggle: () => (showAllUses.value = true), none: 'nothing else in the paper' },
  { key: 'usedby', label: 'Used by', list: usedByShown.value, toggle: () => (showAllUsedBy.value = true), none: 'nothing in the paper' }
])
const anyInferred = computed(() => [...usesShown.value.shown, ...usedByShown.value.shown].some(d => d.inferred))

function depText(id: string) {
  const n = index.value.byId.get(id)
  return n ? nodeShortRef(n, lookup.value) : id
}
function depName(id: string) {
  return index.value.byId.get(id)?.name ?? id
}

// Long statements clamp; "show more" opens them in place (the card itself scrolls).
const statementEl = useTemplateRef<HTMLElement>('statementEl')
const statementOpen = ref(false)
const statementOverflows = ref(false)
onMounted(() => nextTick(() => {
  const el = statementEl.value
  statementOverflows.value = !!el && el.scrollHeight > el.clientHeight + 4
}))
const citeOpen = ref(false)

function go(query: Record<string, string | undefined>) {
  const q = Object.fromEntries(Object.entries({ ...route.query, ...query }).filter(([, v]) => v !== undefined)) as Record<string, string>
  emit('done')
  chat?.onCite()
  return navigateTo(linkTo(props.node.id, q))
}
function openNode() {
  return go({ view: undefined })
}
function showInGraph() {
  return go({ view: 'graph' })
}
function ask() {
  emit('done')
  chat?.ask(`Explain [[${props.node.id}]] and what it's used for.`)
}
function followDep() {
  emit('done')
  chat?.onCite()
}
</script>

<template>
  <div
    class="flex flex-col text-sm"
    :class="compact ? 'gap-2 p-3' : 'gap-3 p-3.5'"
    data-node-card
    :data-node-card-id="node.id"
  >
    <!-- 1. Header -->
    <header class="flex flex-col gap-1">
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <UIcon
          :name="KIND_ICON[node.kind]"
          class="size-3.5 shrink-0 text-muted"
        />
        <span class="font-semibold text-highlighted">{{ title }}</span>
        <template v-if="node.paper_ref.label">
          <span class="text-dimmed">·</span>
          <code class="min-w-0 truncate text-[11px] text-muted">{{ node.paper_ref.label }}</code>
        </template>
        <span class="ms-auto flex flex-wrap items-center gap-1">
          <UBadge
            :color="CLASS_COLOR[node.classification]"
            variant="subtle"
            size="sm"
            :label="node.classification"
          />
          <UBadge
            v-if="node.friction.length && severity"
            :color="SEVERITY_COLOR[severity]"
            variant="soft"
            size="sm"
            icon="i-lucide-triangle-alert"
            :label="`${node.friction.length} friction`"
          />
        </span>
      </div>
      <div class="font-medium text-pretty text-highlighted">
        {{ node.name }}
      </div>
      <div
        v-if="parent"
        class="text-xs text-muted"
      >
        Claim inside the proof of
        <NuxtLink
          :to="linkTo(parent.id)"
          class="text-primary hover:underline"
          @click="followDep"
        >{{ nodeShortRef(parent, lookup) }}</NuxtLink>
        <span class="text-dimmed"> · {{ parent.name }}</span>
      </div>
      <div
        v-if="inferred"
        class="text-xs text-muted"
      >
        <UIcon
          name="i-lucide-sparkles"
          class="size-3 align-[-1px] text-dimmed"
        />
        Reached by an inferred edge: the model read this dependency from the prose; the source has no \ref to it.
      </div>
    </header>

    <!-- In the tree's light card, the headline stands in for the prose sections. -->
    <div
      v-if="compact && node.headline"
      class="flex flex-col gap-0.5"
    >
      <NodeMathText
        :text="node.headline"
        class="text-toned"
      />
      <NodeMathText
        v-if="node.role"
        :text="node.role"
        class="text-xs text-muted"
      />
    </div>

    <!-- 2. Exact statement -->
    <section>
      <div class="relative">
        <div
          ref="statementEl"
          class="overflow-x-auto overflow-y-hidden rounded-md border border-default bg-elevated/50 px-3 py-2 text-default"
          :class="statementOpen ? '' : compact ? 'max-h-24' : 'max-h-44'"
          data-node-card-statement
        >
          <NodeMathText :text="node.statement_paper" />
        </div>
        <div
          v-if="statementOverflows && !statementOpen"
          class="pointer-events-none absolute inset-x-px bottom-px h-8 rounded-b-md bg-gradient-to-t from-elevated to-transparent"
        />
      </div>
      <UButton
        v-if="statementOverflows && !compact"
        :label="statementOpen ? 'Show less' : 'Show full statement'"
        :trailing-icon="statementOpen ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
        color="neutral"
        variant="link"
        size="xs"
        class="px-0"
        data-node-card-more
        @click="statementOpen = !statementOpen"
      />
    </section>

    <template v-if="!compact">
      <!-- 3. Plain terms, then why it's here -->
      <section
        v-if="node.statement_plain"
        class="flex flex-col gap-0.5"
      >
        <h3 class="text-[10.5px] font-semibold tracking-wider text-dimmed uppercase">
          In plain terms
        </h3>
        <NodeMathText
          :text="node.statement_plain"
          class="text-default"
        />
      </section>
      <section
        v-if="node.headline || node.explanation"
        class="flex flex-col gap-0.5"
      >
        <h3 class="text-[10.5px] font-semibold tracking-wider text-dimmed uppercase">
          Why it's here
        </h3>
        <div
          v-if="node.headline"
          class="font-medium text-toned"
        >
          <NodeMathText :text="node.headline" />
          <NodeMathText
            v-if="node.role"
            :text="`Role: ${node.role}`"
            class="text-xs font-normal text-muted"
          />
        </div>
        <NodeMathText
          v-if="node.explanation"
          :text="node.explanation"
          class="text-muted"
        />
      </section>

      <!-- 4. Dependencies at a glance -->
      <section class="flex flex-col gap-1 text-xs">
        <div
          v-for="row in depRows"
          :key="row.key"
          class="leading-relaxed"
          :data-node-card-deps="row.key"
        >
          <span class="text-dimmed">{{ row.label }}: </span>
          <template v-if="row.list.shown.length">
            <template
              v-for="(d, i) in row.list.shown"
              :key="d.id"
            >
              <span
                v-if="i > 0"
                class="text-dimmed"
              >, </span><NuxtLink
                :to="linkTo(d.id)"
                :title="`${depName(d.id)}${d.inferred ? ' · inferred from prose, no \\ref' : ''}`"
                class="whitespace-nowrap text-primary underline-offset-2 hover:underline"
                :class="d.inferred && 'underline decoration-dashed decoration-primary/50'"
                @click="followDep"
              >{{ depText(d.id) }}</NuxtLink><span
                v-if="d.inferred"
                class="text-dimmed"
              >&thinsp;(inferred)</span>
            </template>
            <button
              v-if="row.list.more"
              type="button"
              class="ms-1 text-muted hover:text-default"
              @click="row.toggle"
            >
              (+{{ row.list.more }} more)
            </button>
          </template>
          <span
            v-else
            class="text-dimmed"
          >{{ row.none }}</span>
        </div>
        <div
          v-if="anyInferred"
          class="text-[11px] text-dimmed"
        >
          Inferred: the model read the edge from prose; no \ref in the source.
        </div>
      </section>

      <!-- 5. Classification with its citation -->
      <section
        v-if="node.classification_cite"
        class="text-xs"
      >
        <button
          type="button"
          class="block w-full text-left"
          :class="citeOpen ? '' : 'line-clamp-3'"
          :title="citeOpen ? undefined : 'Show all'"
          data-node-card-cite
          @click="citeOpen = !citeOpen"
        >
          <span class="font-medium text-default">{{ capitalize(node.classification) }}</span><span class="text-dimmed"> — </span><NodeMathText
            :text="node.classification_cite"
            class="inline text-muted"
          />
        </button>
      </section>
    </template>

    <!-- 6. Provenance -->
    <section
      class="flex flex-col gap-1"
      :class="compact ? '' : 'border-t border-default pt-2.5'"
    >
      <h3
        v-if="!compact"
        class="text-[10.5px] font-semibold tracking-wider text-dimmed uppercase"
      >
        Provenance
      </h3>
      <NodeProvenance
        :section="prov.section"
        :page="prov.page"
        :file="prov.file"
        :lines="prov.lines"
        :label="prov.label"
        :origin="prov.origin"
        :url="url"
        :compact="compact"
      />
    </section>

    <!-- 7. Actions -->
    <footer
      v-if="!compact"
      class="flex flex-wrap gap-1.5"
    >
      <UButton
        label="Open node"
        icon="i-lucide-file-text"
        size="xs"
        color="primary"
        variant="soft"
        data-node-card-open
        @click="openNode"
      />
      <UButton
        label="Show in graph"
        icon="i-lucide-git-fork"
        size="xs"
        color="neutral"
        variant="outline"
        data-node-card-graph
        @click="showInGraph"
      />
      <UButton
        v-if="chat"
        label="Ask about this"
        icon="i-lucide-message-circle-question"
        size="xs"
        color="neutral"
        variant="outline"
        data-node-card-ask
        @click="ask"
      />
    </footer>
  </div>
</template>
