<script setup lang="ts">
// The graph's no-pan layout: the selection in the middle, what it feeds into above (one hop), and what it rests on
// below as an outline that unfolds level by level. A node reached twice is drawn once; later hits link back to it,
// so the DAG reads as a tree. Clicking a node's text recenters on it; the chevron only unfolds.
import type { ProofNode } from '#shared/types'
import { graphEdges, graphNodes } from '~/utils/graph'
import type { GraphEdge } from '~/utils/graph'

const props = defineProps<{
  nodes: ProofNode[]
  selectedId: string
  showClaims: boolean
}>()

const emit = defineEmits<{ select: [id: string] }>()

const { index, digest } = useDigestContext()

const shown = computed(() => graphNodes(props.nodes, props.showClaims))
const byId = computed(() => new Map(shown.value.map(n => [n.id, n])))
const adjacency = computed(() => {
  const out = new Map<string, GraphEdge[]>()
  const inc = new Map<string, GraphEdge[]>()
  for (const e of graphEdges(shown.value)) {
    (out.get(e.from) ?? out.set(e.from, []).get(e.from)!).push(e);
    (inc.get(e.to) ?? inc.set(e.to, []).get(e.to)!).push(e)
  }
  return { out, inc }
})

// Same rule as buildGraph: a hidden claim focuses its parent.
const anchor = computed(() => {
  if (byId.value.has(props.selectedId)) {
    return props.selectedId
  }
  const parent = index.value.byId.get(props.selectedId)?.parent_id
  return parent && byId.value.has(parent) ? parent : null
})

const anchorNode = computed(() => anchor.value ? byId.value.get(anchor.value) : undefined)
const usedBy = computed(() => (anchor.value ? adjacency.value.inc.get(anchor.value) ?? [] : []).map(e => byId.value.get(e.from)!))

// --- outline below the selection --------------------------------------------------
// Each center keeps its own unfolded outline, so stepping back (trail, Used by, browser back) restores it.
const open = ref(new Set<string>())
const openBy = new Map<string, Set<string>>()
// The previous center, marked wherever it shows up now, so a recenter never leaves the reader lost.
const cameFrom = ref<string | null>(null)
const scroller = useTemplateRef<HTMLElement>('scroller')
watch(anchor, (id, prev) => {
  if (prev) {
    openBy.set(prev, open.value)
  }
  cameFrom.value = prev ?? null
  open.value = (id && openBy.get(id)) || new Set()
  scroller.value?.scrollTo({ top: 0 })
})

interface Row { key: string, n: ProofNode, depth: number, edge: GraphEdge, kids: number, dup: boolean, isOpen: boolean }

const rows = computed<Row[]>(() => {
  const a = anchor.value
  if (!a) {
    return []
  }
  const out: Row[] = []
  const seen = new Set([a])
  const walk = (id: string, depth: number, path: string) => {
    for (const e of adjacency.value.out.get(id) ?? []) {
      const n = byId.value.get(e.to)!
      const dup = seen.has(e.to)
      seen.add(e.to)
      const kids = adjacency.value.out.get(e.to)?.length ?? 0
      const isOpen = !dup && kids > 0 && open.value.has(e.to)
      const key = `${path}/${e.to}`
      out.push({ key, n, depth, edge: e, kids, dup, isOpen })
      if (isOpen) {
        walk(e.to, depth + 1, key)
      }
    }
  }
  walk(a, 0, a)
  return out
})

/** Everything the selection rests on, transitively (the outline fully unfolded). */
const totalBelow = computed(() => {
  const a = anchor.value
  if (!a) {
    return 0
  }
  const seen = new Set<string>()
  const stack = [a]
  while (stack.length) {
    for (const e of adjacency.value.out.get(stack.pop()!) ?? []) {
      if (e.to !== a && !seen.has(e.to)) {
        seen.add(e.to)
        stack.push(e.to)
      }
    }
  }
  return seen.size
})

function toggle(id: string) {
  const next = new Set(open.value)
  if (next.has(id)) {
    next.delete(id)
  } else {
    next.add(id)
  }
  open.value = next
}

function expandAll(on: boolean) {
  open.value = on ? new Set(shown.value.map(n => n.id)) : new Set()
}
const allOpen = computed(() => rows.value.length > 0 && rows.value.every(r => r.dup || !r.kids || r.isOpen))

// A "shown above" row flashes the first occurrence instead of recentering.
const flash = ref<string | null>(null)
const list = useTemplateRef<HTMLElement>('list')
function jumpTo(id: string) {
  const el = list.value?.querySelector<HTMLElement>(`[data-lens-row="${id}"]`)
  el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  flash.value = id
  setTimeout(() => {
    if (flash.value === id) {
      flash.value = null
    }
  }, 1200)
}

// --- the path walked to get here ----------------------------------------------------
const trail = ref<string[]>([])
watch(anchor, (id) => {
  if (!id) {
    return
  }
  const i = trail.value.indexOf(id)
  trail.value = i >= 0 ? trail.value.slice(0, i + 1) : [...trail.value, id].slice(-6)
}, { immediate: true })

// --- card text ----------------------------------------------------------------------
function label(n: ProofNode) {
  if (n.kind === 'claim') {
    const parent = n.parent_id ? index.value.byId.get(n.parent_id) : undefined
    return `claim · ${parent?.paper_ref.label ?? n.parent_id ?? ''}`
  }
  return n.paper_ref.label ?? `${KIND_SHORT[n.kind]} ${n.id}`
}
const textCache = computed(() => {
  const macros = digest.value?.macros
  const m = new Map<string, { head: string, role?: string }>()
  for (const n of shown.value) {
    const { head, role } = cardText(n)
    m.set(n.id, { head: inlineMathHtml(head, macros), role: role ? inlineMathHtml(role, macros) : undefined })
  }
  return m
})
const head = (n: ProofNode) => textCache.value.get(n.id)?.head ?? ''
const role = (n: ProofNode) => textCache.value.get(n.id)?.role
const SEVERITY_VAR = { high: 'var(--ui-error)', warn: 'var(--ui-warning)', info: 'var(--ui-info)' } as const
</script>

<template>
  <div
    ref="scroller"
    class="h-full min-h-0 overflow-y-auto bg-elevated/40"
  >
    <div
      v-if="anchorNode"
      class="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6 sm:px-6"
    >
      <!-- Path walked so far; any step goes back. -->
      <nav
        v-if="trail.length > 1"
        class="flex flex-wrap items-center gap-1 text-xs text-muted"
        aria-label="Path"
      >
        <template
          v-for="(id, i) in trail"
          :key="id"
        >
          <UIcon
            v-if="i"
            name="i-lucide-chevron-right"
            class="size-3 text-dimmed"
          />
          <button
            v-if="i < trail.length - 1"
            type="button"
            class="font-mono hover:text-highlighted"
            @click="emit('select', id)"
          >
            {{ byId.get(id) ? label(byId.get(id)!) : id }}
          </button>
          <span
            v-else
            class="font-mono text-highlighted"
          >{{ label(anchorNode) }}</span>
        </template>
      </nav>

      <!-- Used by: one hop up. -->
      <section>
        <h3 class="mb-2 flex items-center gap-1.5 text-xs text-muted">
          <UIcon
            name="i-lucide-arrow-up"
            class="size-3.5"
          />
          Used by
          <span class="text-dimmed">{{ usedBy.length }}</span>
        </h3>
        <div
          v-if="usedBy.length"
          class="grid gap-2 sm:grid-cols-2"
        >
          <button
            v-for="n in usedBy"
            :key="n.id"
            type="button"
            class="group/focus flex min-w-0 flex-col gap-0.5 rounded-md border bg-default px-2.5 py-2 text-left transition-colors hover:border-accented"
            :class="n.id === cameFrom ? 'border-primary/50' : 'border-default'"
            :title="`Focus on ${n.name}`"
            @click="emit('select', n.id)"
          >
            <span class="flex items-center gap-1.5 text-[10px] text-dimmed">
              <span class="truncate font-mono">{{ label(n) }}</span>
              <span
                v-if="n.id === cameFrom"
                class="flex shrink-0 items-center gap-0.5 text-primary"
              ><UIcon
                name="i-lucide-undo-2"
                class="size-3"
              />came from</span>
              <UIcon
                name="i-lucide-crosshair"
                class="ms-auto size-3 shrink-0 opacity-0 transition-opacity group-hover/focus:opacity-100"
              />
            </span>
            <!-- KaTeX output; prose is escaped in inlineMathHtml. -->
            <!-- eslint-disable vue/no-v-html -->
            <span
              class="line-clamp-2 text-[13px] leading-snug font-medium text-highlighted"
              v-html="head(n)"
            />
            <!-- eslint-enable vue/no-v-html -->
          </button>
        </div>
        <p
          v-else
          class="text-xs text-dimmed"
        >
          Nothing in the paper builds on this. It's a top-level result.
        </p>
      </section>

      <!-- The selection. -->
      <section
        class="rounded-lg border-2 border-primary bg-default px-4 py-3"
        aria-current="true"
      >
        <div class="flex items-center gap-2 text-[11px] text-dimmed">
          <UIcon
            :name="KIND_ICON[anchorNode.kind]"
            class="size-3.5"
          />
          <span class="font-mono">{{ label(anchorNode) }}</span>
          <span
            v-if="maxSeverity(anchorNode)"
            class="size-1.5 rounded-full"
            :style="{ background: SEVERITY_VAR[maxSeverity(anchorNode)!] }"
          />
          <UBadge
            v-if="anchorNode.classification === 'novel'"
            label="novel"
            color="primary"
            variant="subtle"
            size="sm"
            class="ms-auto"
          />
        </div>
        <!-- eslint-disable vue/no-v-html -->
        <p
          class="mt-1.5 text-base leading-snug font-semibold text-pretty text-highlighted"
          v-html="head(anchorNode)"
        />
        <p
          v-if="role(anchorNode)"
          class="mt-1 text-sm text-pretty text-muted"
          v-html="role(anchorNode)"
        />
        <!-- eslint-enable vue/no-v-html -->
      </section>

      <!-- Rests on: the outline. -->
      <section>
        <div class="mb-2 flex items-center gap-1.5 text-xs text-muted">
          <UIcon
            name="i-lucide-arrow-down"
            class="size-3.5"
          />
          <h3>Rests on</h3>
          <span class="text-dimmed">{{ adjacency.out.get(anchorNode.id)?.length ?? 0 }} directly · {{ totalBelow }} in all</span>
          <UButton
            v-if="rows.some(r => r.kids && !r.dup)"
            :label="allOpen ? 'Collapse all' : 'Expand all'"
            :icon="allOpen ? 'i-lucide-chevrons-down-up' : 'i-lucide-chevrons-up-down'"
            color="neutral"
            variant="ghost"
            size="xs"
            class="ms-auto"
            @click="expandAll(!allOpen)"
          />
        </div>
        <div
          v-if="rows.length"
          ref="list"
          class="rounded-md border border-default bg-default py-1"
        >
          <div
            v-for="r in rows"
            :key="r.key"
            :data-lens-row="r.dup ? undefined : r.n.id"
            class="group flex items-start gap-1 py-1 pe-3 transition-colors"
            :class="flash === r.n.id && !r.dup ? 'bg-primary/10' : r.n.id === cameFrom && !r.dup ? 'bg-primary/5 hover:bg-elevated' : 'hover:bg-elevated'"
            :style="{ paddingInlineStart: `${8 + r.depth * 20}px` }"
          >
            <UButton
              v-if="r.kids && !r.dup"
              :icon="r.isOpen ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
              color="neutral"
              variant="ghost"
              size="xs"
              class="mt-px shrink-0"
              :aria-label="r.isOpen ? 'Collapse' : 'Expand'"
              :aria-expanded="r.isOpen"
              @click="toggle(r.n.id)"
            />
            <span
              v-else
              class="size-6 shrink-0"
            />
            <button
              v-if="r.dup"
              type="button"
              class="flex min-w-0 flex-1 items-baseline gap-2 py-1 text-left text-dimmed hover:text-muted"
              :title="r.n.id === anchor ? 'This is the selection itself' : `Shown above: ${r.n.name}`"
              @click="jumpTo(r.n.id)"
            >
              <span class="shrink-0 font-mono text-[11px]">{{ label(r.n) }}</span>
              <span class="truncate text-xs">{{ r.n.id === anchor ? 'the selection' : 'shown above' }}</span>
              <UIcon
                name="i-lucide-corner-left-up"
                class="size-3 shrink-0 self-center"
              />
            </button>
            <button
              v-else
              type="button"
              class="group/focus flex min-w-0 flex-1 flex-col gap-0.5 py-1 text-left"
              :title="`Focus on ${r.n.name}`"
              @click="emit('select', r.n.id)"
            >
              <span class="flex items-center gap-1.5 text-[11px] text-dimmed">
                <span class="truncate font-mono">{{ label(r.n) }}</span>
                <span
                  v-if="maxSeverity(r.n)"
                  class="size-1.5 shrink-0 rounded-full"
                  :style="{ background: SEVERITY_VAR[maxSeverity(r.n)!] }"
                />
                <UBadge
                  v-if="r.n.classification === 'novel'"
                  label="novel"
                  color="primary"
                  variant="subtle"
                  size="sm"
                  class="px-1 py-0 text-[9px] leading-[14px]"
                />
                <span
                  v-if="r.edge.inferred"
                  class="text-[10px]"
                  title="Dependency inferred from the prose, not a \ref"
                >inferred</span>
                <span
                  v-if="r.n.id === cameFrom"
                  class="flex shrink-0 items-center gap-0.5 text-[10px] text-primary"
                ><UIcon
                  name="i-lucide-undo-2"
                  class="size-3"
                />came from</span>
                <span
                  v-if="r.kids && !r.isOpen"
                  class="ms-auto shrink-0 text-[10px] group-hover/focus:hidden"
                >{{ r.kids }} below</span>
                <span class="ms-auto hidden shrink-0 items-center gap-0.5 text-[10px] text-muted group-hover/focus:flex"><UIcon
                  name="i-lucide-crosshair"
                  class="size-3"
                />Focus</span>
              </span>
              <!-- eslint-disable vue/no-v-html -->
              <span
                class="text-[13px] leading-snug text-pretty text-highlighted group-hover/focus:underline"
                v-html="head(r.n)"
              />
              <!-- eslint-enable vue/no-v-html -->
            </button>
          </div>
        </div>
        <p
          v-else
          class="text-xs text-dimmed"
        >
          Nothing below. This is a leaf of the proof.
        </p>
      </section>
    </div>
    <p
      v-else
      class="p-6 text-sm text-muted"
    >
      Select a statement to see what it rests on.
    </p>
  </div>
</template>
