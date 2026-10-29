<script setup lang="ts">
// The one custom component in v1: Nuxt UI has no graph primitive. dagre lays out a layered (Sugiyama) DAG;
// Vue renders it as an HTML layer (cards) over an SVG layer (edges) inside one transformed "world" div, and
// d3-zoom drives the transform (wheel/pinch zoom around the pointer, drag to pan, click-vs-drag, animations).
import dagre from '@dagrejs/dagre'
import { useElementSize } from '@vueuse/core'
import { select } from 'd3-selection'
import 'd3-transition'
import { zoom as d3zoom, zoomIdentity } from 'd3-zoom'
import type { ZoomBehavior } from 'd3-zoom'
import type { Classification, ProofNode } from '#shared/types'
import type { GraphColorBy, GraphEdge, GraphMode } from '~/utils/graph'
import type { Box, View } from '~/utils/viewport'

const props = defineProps<{
  nodes: ProofNode[]
  selectedId: string
  mode: GraphMode
  showClaims: boolean
  colorBy: GraphColorBy
  /** Remembers zoom/pan under this key (the paper slug) while the tab lives. */
  viewKey?: string
}>()

const emit = defineEmits<{ select: [id: string] }>()

const { index, digest } = useDigestContext()

const PAD = 24
const RANKSEP = 48

const model = computed(() => buildGraph(props.nodes, { selectedId: props.selectedId, mode: props.mode, showClaims: props.showClaims }))

const layout = computed(() => {
  // Layers come from graphRanks (most-supported results on top, leaves on the bottom); dagre only orders
  // within layers and routes edges. Paths run from a result down to what it uses; the arrowhead sits at the
  // top end, so arrows read "feeds into": supporting node → the result it helps prove (the way the logic flows).
  const { ranks, back } = graphRanks(model.value.nodes, model.value.edges)
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'TB', ranker: 'none', ranksep: RANKSEP, nodesep: 20, edgesep: 8, marginx: PAD, marginy: PAD })
  g.setDefaultEdgeLabel(() => ({}))
  const size = new Map(model.value.nodes.map(n => [n.id, cardSize(n)]))
  for (const n of model.value.nodes) {
    // dagre doubles every edge's minlen to make room for edge labels before ranking, so preset ranks are doubled too.
    const { w, h } = size.get(n.id)!
    g.setNode(n.id, { width: w, height: h, rank: 2 * ranks.get(n.id)! })
  }
  for (const e of model.value.edges) {
    if (!back.has(e)) {
      g.setEdge(e.from, e.to)
    }
  }
  dagre.layout(g)
  const pos = new Map<string, Box>()
  for (const n of model.value.nodes) {
    const p = g.node(n.id)
    const { w, h } = size.get(n.id)!
    pos.set(n.id, { x: p.x - w / 2, y: p.y - h / 2, w, h })
  }
  // Edges leave the bottom center of the user and enter the top center of what it uses. dagre clips to the card
  // outline, which on wide cards with a shallow edge exits through the side and runs across the row.
  // A cycle-closing edge has no dagre route; it goes straight between the two cards.
  const route = (e: GraphEdge) => {
    const a = pos.get(e.from)!, b = pos.get(e.to)!
    const down = b.y > a.y
    const start = { x: a.x + a.w / 2, y: down ? a.y + a.h : a.y }
    const end = { x: b.x + b.w / 2, y: down ? b.y : b.y + b.h }
    if (back.has(e)) {
      return [start, end]
    }
    // Inner points are dagre's dummy positions on long edges; a one-layer edge only has a midpoint, dropped so
    // the stubs below give it a clean S-curve. The stubs make every edge leave and arrive vertically.
    const inner = (g.edge(e.from, e.to)?.points ?? []).slice(1, -1)
    const k = RANKSEP / 2
    return [start, { x: start.x, y: start.y + k }, ...(inner.length > 1 ? inner : []), { x: end.x, y: end.y - k }, end]
  }
  const edges = model.value.edges.map(e => ({
    ...e,
    key: `${e.from}>${e.to}`,
    d: basisPath(route(e)),
    lit: edgeLit(model.value, e)
  }))
  // Lit edges draw last so they sit on top of the dimmed ones.
  edges.sort((a, b) => Number(a.lit) - Number(b.lit))
  const label = g.graph()
  const levels = new Set(model.value.nodes.map(n => ranks.get(n.id))).size
  return { pos, edges, width: Math.max(label.width ?? 0, CARD_W + 2 * PAD), height: Math.max(label.height ?? 0, 2 * PAD), levels }
})

// --- card text ----------------------------------------------------------------
const cards = computed(() => {
  const macros = digest.value?.macros
  return model.value.nodes.map((n) => {
    const { head, role } = cardText(n)
    return { n, head: inlineMathHtml(head, macros), role: role ? inlineMathHtml(role, macros) : undefined }
  })
})

// --- colors (CSS variables only, so dark mode follows the theme) ---------------
// Nuxt UI's chart colors, ordered so neighbouring sections contrast and primary (= focus) comes last.
const SECTION_CHART = [4, 6, 5, 2, 3, 1]
const sectionVar = (i: number) => `var(--ui-chart-${SECTION_CHART[i % SECTION_CHART.length]})`
// Top-level section of each node, in paper order, picks a chart color.
const sectionColor = computed(() => {
  const top = index.value.sectionById
  const roots = [...top.values()].filter(s => !s.parent_id).sort((a, b) => a.order - b.order)
  const rank = new Map(roots.map((s, i) => [s.id, i]))
  const rootOf = (id: string | undefined) => {
    let s = id ? top.get(id) : undefined
    while (s?.parent_id && top.get(s.parent_id)) {
      s = top.get(s.parent_id)
    }
    return s
  }
  return (nodeId: string) => {
    const r = rank.get(rootOf(index.value.sectionOf[nodeId]?.id)?.id ?? '')
    return r === undefined ? 'var(--ui-text-dimmed)' : sectionVar(r)
  }
})

const CLASS_STYLE: Record<Classification, { border: string, style: string, fill?: string }> = {
  novel: { border: 'var(--ui-primary)', style: 'solid', fill: 'color-mix(in oklab, var(--ui-primary) 12%, var(--ui-bg))' },
  routine: { border: 'var(--ui-border-accented)', style: 'solid' },
  standard: { border: 'var(--ui-text-dimmed)', style: 'dashed' },
  unknown: { border: 'var(--ui-warning)', style: 'dotted' }
}

// --- hover: a card's direct edges light up ------------------------------------
const hoverId = ref<string | null>(null)
const hoverEdges = computed(() => hoverId.value ? layout.value.edges.filter(e => e.from === hoverId.value || e.to === hoverId.value) : [])
const hoverNeighbors = computed(() => new Set(hoverEdges.value.flatMap(e => [e.from, e.to])))

function cardStyle(n: ProofNode) {
  const selected = n.id === props.selectedId
  let border: string, style: string, fill: string
  if (props.colorBy === 'cls') {
    const c = CLASS_STYLE[n.classification]
    border = c.border
    style = c.style
    fill = c.fill ?? 'var(--ui-bg)'
  } else {
    border = sectionColor.value(n.id)
    style = 'solid'
    fill = `color-mix(in oklab, ${border} 10%, var(--ui-bg))`
  }
  const p = layout.value.pos.get(n.id)!
  return {
    left: `${p.x}px`,
    top: `${p.y}px`,
    width: `${p.w}px`,
    height: `${p.h}px`,
    borderColor: selected ? 'var(--ui-primary)' : border,
    borderStyle: selected ? 'solid' : style,
    borderWidth: selected ? '2px' : '1.5px',
    background: fill,
    boxShadow: selected ? '0 0 0 3px color-mix(in oklab, var(--ui-primary) 25%, transparent)' : undefined,
    opacity: model.value.lit.has(n.id) ? 1 : hoverNeighbors.value.has(n.id) ? 0.8 : 0.28
  }
}

const SEVERITY_VAR = { high: 'var(--ui-error)', warn: 'var(--ui-warning)', info: 'var(--ui-info)' } as const

function topLine(n: ProofNode) {
  if (n.kind === 'claim') {
    const parent = n.parent_id ? index.value.byId.get(n.parent_id) : undefined
    return `claim · ${parent?.paper_ref.label ?? n.parent_id ?? ''}`
  }
  return n.paper_ref.label ?? `${KIND_SHORT[n.kind]} ${n.id}`
}

// --- legend + stats ---------------------------------------------------------
const legend = computed(() => {
  if (props.colorBy === 'cls') {
    return (['novel', 'routine', 'standard', 'unknown'] as Classification[])
      .filter(c => c !== 'unknown' || props.nodes.some(n => n.classification === 'unknown'))
      .map(c => ({ label: c, border: CLASS_STYLE[c].border, style: CLASS_STYLE[c].style, fill: CLASS_STYLE[c].fill ?? 'transparent' }))
  }
  return [...index.value.sectionById.values()]
    .filter(s => !s.parent_id)
    .sort((a, b) => a.order - b.order)
    .map((s, i) => {
      const color = sectionVar(i)
      return { label: sectionLabel(s.id, s.title), border: color, style: 'solid', fill: `color-mix(in oklab, ${color} 10%, transparent)` }
    })
})

const stats = computed(() => {
  const m = model.value
  const base = `${m.nodes.length} nodes · ${layout.value.levels} levels`
  return m.anchor ? `${base} · focus: ${m.down.size} below, ${m.up.size} above` : base
})

// --- viewport: d3-zoom drives `view`; everything else reads it ----------------
const viewport = useTemplateRef<HTMLDivElement>('viewport')
const { width: vw, height: vh } = useElementSize(viewport)
const view = shallowRef<View>({ x: 0, y: 0, k: 1 })
const lod = computed(() => lodFor(view.value.k))
// Edges keep a visible stroke when zoomed out.
const strokeScale = computed(() => Math.max(1, 0.7 / view.value.k))
const worldStyle = computed(() => ({
  'width': `${layout.value.width}px`,
  'height': `${layout.value.height}px`,
  'transform': `translate(${view.value.x}px, ${view.value.y}px) scale(${view.value.k})`,
  '--pg-sw': strokeScale.value
}))
const viewKey = computed(() => `${props.viewKey ?? ''}|${props.mode}|${props.showClaims ? 1 : 0}`)

const allBox = computed<Box>(() => ({ x: 0, y: 0, w: layout.value.width, h: layout.value.height }))
const fitAllK = computed(() => vw.value && vh.value ? fitView(allBox.value, vw.value, vh.value, { maxK: ZOOM_MAX }).k : 1)
const minK = computed(() => Math.min(0.2, fitAllK.value * 0.8))

let zb: ZoomBehavior<HTMLDivElement, unknown> | null = null
const reducedMotion = import.meta.client && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

function apply(v: View, ms = 0) {
  const el = viewport.value
  if (!el || !zb) {
    return
  }
  const t = zoomIdentity.translate(v.x, v.y).scale(v.k)
  if (ms && !reducedMotion) {
    select(el).transition().duration(ms).call(zb.transform, t)
  } else {
    select(el).interrupt().call(zb.transform, t)
  }
}

const anchorBox = computed(() => model.value.anchor ? layout.value.pos.get(model.value.anchor) : undefined)
const center = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 })

function fitAll(ms = 450) {
  apply(fitView(allBox.value, vw.value, vh.value, { maxK: 1, minK: minK.value }), ms)
}
/** The selection with everything it rests on and everything that rests on it: the chain of reasoning. */
function fitSelection(ms = 450) {
  const box = chainBox()
  if (!box) {
    return fitAll(ms)
  }
  apply(fitView(box, vw.value, vh.value, { maxK: 1.2, minK: minK.value }), ms)
}
function centerSelection(ms = 450, k = focusZoom(view.value.k)) {
  const b = anchorBox.value
  if (!b) {
    return fitAll(ms)
  }
  apply(centerView(center(b), k, vw.value, vh.value), ms)
}
function zoomBy(f: number) {
  if (viewport.value && zb) {
    select(viewport.value).transition().duration(reducedMotion ? 0 : 180).call(zb.scaleBy, f)
  }
}
function actualSize() {
  centerSelection(350, 1)
}

/** The selection's chain (it, what it rests on, what rests on it) as one box; null without a selection. */
function chainBox() {
  const m = model.value
  return m.anchor ? boundsOf([...m.lit].map(id => layout.value.pos.get(id)).filter((b): b is Box => !!b)) : null
}

/**
 * First view for this layout: the saved one; else the whole graph when it reads at ≥ 70%; else the selection's
 * chain when that reads at ≥ 60%; else the selection at 100%.
 */
function initialView() {
  const saved = savedGraphViews.get(viewKey.value)
  if (saved) {
    return apply(saved)
  }
  if (fitAllK.value >= 0.7 || !anchorBox.value) {
    return fitAll(0)
  }
  const chain = chainBox()
  const chainView = chain && fitView(chain, vw.value, vh.value, { maxK: 1 })
  if (chainView && chainView.k >= 0.6) {
    return apply(chainView)
  }
  centerSelection(0, 1)
}

let started = false
function start() {
  const el = viewport.value
  if (started || !el || !vw.value || !vh.value) {
    return
  }
  started = true
  zb = d3zoom<HTMLDivElement, unknown>()
    .scaleExtent([minK.value, ZOOM_MAX])
    .clickDistance(4)
    // Controls and the minimap handle their own pointer events; double-click on a card is not a zoom.
    .filter((e: Event & { ctrlKey?: boolean, button?: number }) => {
      const target = e.target as Element | null
      if (target?.closest('[data-pg-chrome]')) {
        return false
      }
      if (e.type === 'dblclick' && target?.closest('[data-pg-card]')) {
        return false
      }
      return (!e.ctrlKey || e.type === 'wheel') && !e.button
    })
    .constrain((t) => {
      const c = constrainView({ x: t.x, y: t.y, k: t.k }, layout.value.width, layout.value.height, vw.value, vh.value)
      return c.x === t.x && c.y === t.y ? t : zoomIdentity.translate(c.x, c.y).scale(c.k)
    })
    .on('zoom', (e) => {
      view.value = { x: e.transform.x, y: e.transform.y, k: e.transform.k }
    })
    .on('end', () => {
      savedGraphViews.set(viewKey.value, view.value)
    })
  select(el).call(zb)
  initialView()
}

onMounted(() => nextTick(start))
watch([vw, vh], () => start())
watch(minK, k => zb?.scaleExtent([k, ZOOM_MAX]))
onBeforeUnmount(() => {
  if (viewport.value) {
    select(viewport.value).interrupt().on('.zoom', null)
  }
})

// Selection moves: glide to it, keeping the zoom unless it's too far out to read.
watch(() => props.selectedId, () => {
  if (started) {
    nextTick(() => centerSelection())
  }
})
// A different layout (mode, claims): its own saved view, else glide to the selection.
watch(viewKey, () => {
  if (started) {
    nextTick(() => savedGraphViews.has(viewKey.value) ? apply(savedGraphViews.get(viewKey.value)!, 350) : centerSelection())
  }
})

// --- keyboard -----------------------------------------------------------------
const ARROWS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' } as const
function onKey(e: KeyboardEvent) {
  if (e.metaKey || e.ctrlKey || e.altKey) {
    return
  }
  const dir = ARROWS[e.key as keyof typeof ARROWS]
  if (dir) {
    e.preventDefault()
    const from = model.value.anchor
    const next = from ? stepTarget(dir, from, layout.value.pos, model.value.edges) : model.value.nodes[0]?.id
    if (next) {
      emit('select', next)
    }
    return
  }
  const actions: Record<string, () => void> = {
    '+': () => zoomBy(1.3),
    '=': () => zoomBy(1.3),
    '-': () => zoomBy(1 / 1.3),
    '_': () => zoomBy(1 / 1.3),
    '0': () => fitAll(),
    '1': () => actualSize(),
    'f': () => fitSelection(),
    'c': () => centerSelection()
  }
  const act = actions[e.key]
  if (act) {
    e.preventDefault()
    act()
  }
}

// --- minimap --------------------------------------------------------------------
const showMinimap = ref(true)
const MM_MAX_W = 200
const MM_MAX_H = 120
const mm = computed(() => {
  const s = Math.min(MM_MAX_W / layout.value.width, MM_MAX_H / layout.value.height)
  return { s, w: layout.value.width * s, h: layout.value.height * s }
})
// Only worth showing when the graph doesn't fit the viewport at the current zoom.
const minimapUseful = computed(() => layout.value.width * view.value.k > vw.value + 1 || layout.value.height * view.value.k > vh.value + 1)
const frame = computed(() => visibleWorld(view.value, vw.value, vh.value))
const minimapEl = useTemplateRef<SVGSVGElement>('minimapEl')
let mmDragging = false
function minimapAt(e: PointerEvent) {
  const r = minimapEl.value?.getBoundingClientRect()
  if (!r) {
    return
  }
  const p = { x: (e.clientX - r.left) / mm.value.s, y: (e.clientY - r.top) / mm.value.s }
  apply(centerView(p, view.value.k, vw.value, vh.value))
}
function mmDown(e: PointerEvent) {
  mmDragging = true;
  (e.currentTarget as Element).setPointerCapture(e.pointerId)
  minimapAt(e)
}
function mmMove(e: PointerEvent) {
  if (mmDragging) {
    minimapAt(e)
  }
}
function mmUp() {
  mmDragging = false
  savedGraphViews.set(viewKey.value, view.value)
}

const zoomPct = computed(() => `${Math.round(view.value.k * 100)}%`)
const KEYS_HELP = 'Wheel or pinch: zoom · drag: pan · ↑: a result it feeds into · ↓: what feeds into it · ← →: neighbour in the row · + − : zoom · 0: whole graph · 1: 100% · F: fit the selection\'s chain · C: center'
</script>

<template>
  <div
    data-proof-graph
    class="flex h-full min-h-0 flex-col"
  >
    <div
      ref="viewport"
      class="relative min-h-0 flex-1 cursor-grab overflow-hidden bg-elevated/40 outline-none select-none active:cursor-grabbing"
      tabindex="0"
      role="group"
      :aria-label="`Dependency graph: ${stats}. ${KEYS_HELP}`"
      aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight + - 0 1 F C"
      :data-lod="lod"
      @keydown="onKey"
    >
      <div
        data-pg-world
        class="absolute top-0 left-0 origin-top-left"
        :style="worldStyle"
      >
        <svg
          :width="layout.width"
          :height="layout.height"
          class="pointer-events-none absolute inset-0 overflow-visible"
          aria-hidden="true"
        >
          <defs>
            <marker
              id="pg-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path
                d="M0,0 L10,5 L0,10 z"
                fill="var(--ui-border-accented)"
              />
            </marker>
            <marker
              id="pg-arrow-lit"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path
                d="M0,0 L10,5 L0,10 z"
                fill="var(--ui-primary)"
              />
            </marker>
            <marker
              id="pg-arrow-hover"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path
                d="M0,0 L10,5 L0,10 z"
                fill="var(--ui-text-highlighted)"
              />
            </marker>
          </defs>

          <g fill="none">
            <path
              v-for="e in layout.edges"
              :key="e.key"
              :d="e.d"
              data-pg-edge
              :data-lit="e.lit || undefined"
              :stroke="e.lit ? 'var(--ui-primary)' : 'var(--ui-border-accented)'"
              :stroke-dasharray="e.contains ? '2 3' : e.inferred ? '5 4' : undefined"
              :opacity="e.lit || !model.anchor ? 0.95 : 0.5"
              :marker-start="e.lit ? 'url(#pg-arrow-lit)' : 'url(#pg-arrow)'"
            />
            <path
              v-for="e in hoverEdges"
              :key="`h:${e.key}`"
              :d="e.d"
              data-pg-edge
              data-hover
              stroke="var(--ui-text-highlighted)"
              :stroke-dasharray="e.contains ? '2 3' : e.inferred ? '5 4' : undefined"
              marker-start="url(#pg-arrow-hover)"
            />
          </g>
        </svg>

        <button
          v-for="c in cards"
          :key="c.n.id"
          type="button"
          data-pg-card
          :data-id="c.n.id"
          :data-claim="c.n.kind === 'claim' || undefined"
          class="absolute flex cursor-pointer flex-col justify-center gap-1 overflow-hidden rounded-md border px-2.5 py-2 text-left transition-opacity"
          :style="cardStyle(c.n)"
          :title="`${c.n.name} — ${c.n.paper_ref.label ?? c.n.id}`"
          :aria-pressed="c.n.id === selectedId"
          :aria-label="`${c.n.name}${c.n.headline ? `: ${c.n.headline}` : ''}`"
          @click="emit('select', c.n.id)"
          @mouseenter="hoverId = c.n.id"
          @mouseleave="hoverId = null"
        >
          <span
            v-if="lod === 'label'"
            class="line-clamp-2 font-mono text-[30px] leading-[34px] font-semibold break-all text-highlighted"
          >{{ topLine(c.n) }}</span>
          <template v-else>
            <span class="flex items-center gap-1 text-[10px] leading-none text-dimmed">
              <span class="truncate font-mono">{{ topLine(c.n) }}</span>
              <span
                v-if="maxSeverity(c.n)"
                class="size-1.5 shrink-0 rounded-full"
                :style="{ background: SEVERITY_VAR[maxSeverity(c.n)!] }"
              />
              <UBadge
                v-if="c.n.classification === 'novel'"
                label="novel"
                color="primary"
                variant="subtle"
                size="sm"
                class="ms-auto px-1 py-0 text-[9px] leading-[14px]"
              />
            </span>
            <!-- KaTeX output; prose is escaped in inlineMathHtml. -->
            <!-- eslint-disable vue/no-v-html -->
            <span
              data-pg-head
              class="text-[12px] leading-[15px] text-pretty break-words text-highlighted"
              :class="c.n.id === selectedId ? 'font-semibold' : 'font-medium'"
              v-html="c.head"
            />
            <span
              v-if="c.role && lod === 'full'"
              data-pg-role
              class="text-[11px] leading-[14px] text-pretty break-words text-muted"
              v-html="c.role"
            />
            <!-- eslint-enable vue/no-v-html -->
          </template>
        </button>
      </div>

      <!-- Controls: zoom, fit, minimap toggle. -->
      <div
        data-pg-chrome
        class="absolute bottom-2 left-2 flex flex-col overflow-hidden rounded-md border border-default bg-default/95 shadow-sm"
      >
        <UTooltip
          text="Zoom in (+)"
          :content="{ side: 'right' }"
        >
          <UButton
            icon="i-lucide-plus"
            color="neutral"
            variant="ghost"
            size="xs"
            square
            aria-label="Zoom in"
            @click="zoomBy(1.3)"
          />
        </UTooltip>
        <UTooltip
          text="Zoom out (−)"
          :content="{ side: 'right' }"
        >
          <UButton
            icon="i-lucide-minus"
            color="neutral"
            variant="ghost"
            size="xs"
            square
            aria-label="Zoom out"
            @click="zoomBy(1 / 1.3)"
          />
        </UTooltip>
        <UTooltip
          text="100% on the selection (1)"
          :content="{ side: 'right' }"
        >
          <UButton
            color="neutral"
            variant="ghost"
            size="xs"
            class="justify-center px-0 text-[10px] tabular-nums"
            aria-label="Actual size"
            data-pg-zoom
            @click="actualSize"
          >
            {{ zoomPct }}
          </UButton>
        </UTooltip>
        <USeparator />
        <UTooltip
          text="Whole graph (0)"
          :content="{ side: 'right' }"
        >
          <UButton
            icon="i-lucide-maximize"
            color="neutral"
            variant="ghost"
            size="xs"
            square
            aria-label="Fit whole graph"
            @click="fitAll()"
          />
        </UTooltip>
        <UTooltip
          text="Fit the selection's chain (F)"
          :content="{ side: 'right' }"
        >
          <UButton
            icon="i-lucide-scan-search"
            color="neutral"
            variant="ghost"
            size="xs"
            square
            aria-label="Fit selection"
            :disabled="!model.anchor"
            @click="fitSelection()"
          />
        </UTooltip>
        <UTooltip
          :text="showMinimap ? 'Hide minimap' : 'Show minimap'"
          :content="{ side: 'right' }"
        >
          <UButton
            icon="i-lucide-map"
            color="neutral"
            :variant="showMinimap ? 'soft' : 'ghost'"
            size="xs"
            square
            class="hidden sm:inline-flex"
            :aria-label="showMinimap ? 'Hide minimap' : 'Show minimap'"
            @click="showMinimap = !showMinimap"
          />
        </UTooltip>
        <UTooltip
          :text="KEYS_HELP"
          :content="{ side: 'right' }"
          :ui="{ content: 'h-auto max-w-64 whitespace-normal' }"
        >
          <UButton
            icon="i-lucide-keyboard"
            color="neutral"
            variant="ghost"
            size="xs"
            square
            class="hidden sm:inline-flex"
            aria-label="Keyboard shortcuts"
          />
        </UTooltip>
      </div>

      <!-- Minimap: where you are in the whole drawing; click or drag to move there. -->
      <div
        v-if="showMinimap && minimapUseful"
        data-pg-chrome
        data-pg-minimap
        class="absolute right-2 bottom-2 hidden rounded-md border border-default bg-default/90 p-1 shadow-sm sm:block"
      >
        <svg
          ref="minimapEl"
          :width="mm.w"
          :height="mm.h"
          :viewBox="`0 0 ${layout.width} ${layout.height}`"
          class="block cursor-pointer touch-none"
          role="img"
          aria-label="Minimap"
          @pointerdown="mmDown"
          @pointermove="mmMove"
          @pointerup="mmUp"
          @pointercancel="mmUp"
        >
          <rect
            v-for="n in model.nodes"
            :key="n.id"
            :x="layout.pos.get(n.id)!.x"
            :y="layout.pos.get(n.id)!.y"
            :width="layout.pos.get(n.id)!.w"
            :height="layout.pos.get(n.id)!.h"
            rx="12"
            :fill="n.id === model.anchor ? 'var(--ui-primary)' : model.lit.has(n.id) && model.anchor ? 'var(--ui-text-muted)' : 'var(--ui-border-accented)'"
          />
          <rect
            :x="frame.x"
            :y="frame.y"
            :width="frame.w"
            :height="frame.h"
            fill="color-mix(in oklab, var(--ui-primary) 8%, transparent)"
            stroke="var(--ui-primary)"
            stroke-width="2"
            vector-effect="non-scaling-stroke"
          />
        </svg>
      </div>
    </div>

    <div class="flex shrink-0 flex-wrap items-center gap-x-3.5 gap-y-1 border-t border-default px-4 py-1.5 text-[11.5px] text-muted">
      <span
        v-for="l in legend"
        :key="l.label"
        class="inline-flex items-center gap-1.5"
      >
        <span
          class="inline-block size-2.5 rounded-sm border-[1.5px]"
          :style="{ borderColor: l.border, borderStyle: l.style, background: l.fill }"
        />
        {{ l.label }}
      </span>
      <span class="inline-flex items-center gap-1.5">
        <svg
          width="8"
          height="14"
          aria-hidden="true"
        ><path
          d="M4,4 L4,14"
          stroke="var(--ui-text-muted)"
        /><path
          d="M1,6 L4,1 L7,6 z"
          fill="var(--ui-text-muted)"
        /></svg>
        feeds into
      </span>
      <span class="inline-flex items-center gap-1.5">
        <svg
          width="18"
          height="6"
          aria-hidden="true"
        ><path
          d="M0,3 L18,3"
          stroke="var(--ui-text-muted)"
          stroke-dasharray="5 4"
        /></svg>
        inferred
      </span>
      <span class="ms-auto tabular-nums">{{ stats }}</span>
    </div>
  </div>
</template>

<style>
/* Claims get an inner dashed ring so they read as "inside a proof". */
[data-proof-graph] [data-pg-card][data-claim] { outline: 1px dashed var(--ui-border-accented); outline-offset: -4px; }
[data-proof-graph] [data-pg-card]:focus-visible { outline: 2px solid var(--ui-primary); outline-offset: 2px; }
[data-proof-graph] [data-pg-edge] { stroke-width: calc(1.1px * var(--pg-sw, 1)); }
[data-proof-graph] [data-pg-edge][data-lit] { stroke-width: calc(1.6px * var(--pg-sw, 1)); }
[data-proof-graph] [data-pg-edge][data-hover] { stroke-width: calc(2.2px * var(--pg-sw, 1)); }
/* Inline KaTeX in a 12px card line: don't let it inflate the line box. */
[data-proof-graph] [data-pg-head] .katex, [data-proof-graph] [data-pg-role] .katex { font-size: 1.05em; line-height: 1; }
</style>
