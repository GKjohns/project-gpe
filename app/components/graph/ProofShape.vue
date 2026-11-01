<script setup lang="ts">
// Static thumbnail of the proof's shape for the overview page: the graph view's layering (graphRanks) laid out by
// dagre with fixed dots, no labels, no zoom. Deliberately not a ProofGraph mode (that one is pan/zoom + cards).
import dagre from '@dagrejs/dagre'
import type { ProofNode } from '#shared/types'

const props = withDefaults(defineProps<{
  nodes: ProofNode[]
  /** The main theorem, ringed. */
  rootId?: string
  /** Tallest it may draw, in px; it keeps its aspect ratio below that. */
  maxHeight?: number
}>(), { maxHeight: 260 })

const DOT = 8

const layout = computed(() => {
  const nodes = graphNodes(props.nodes, false)
  const edges = graphEdges(nodes)
  const { ranks, back } = graphRanks(nodes, edges)
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'TB', ranker: 'none', ranksep: 36, nodesep: 4, marginx: DOT, marginy: DOT })
  g.setDefaultEdgeLabel(() => ({}))
  for (const n of nodes) {
    // dagre doubles minlen for edge labels, so preset ranks are doubled (as in ProofGraph).
    g.setNode(n.id, { width: DOT, height: DOT, rank: 2 * ranks.get(n.id)! })
  }
  const drawn = edges.filter(e => !back.has(e))
  for (const e of drawn) {
    g.setEdge(e.from, e.to)
  }
  dagre.layout(g)
  const dots = nodes.map((n) => {
    const p = g.node(n.id)
    return { id: n.id, x: p.x, y: p.y, novel: n.classification === 'novel', root: n.id === props.rootId }
  })
  const at = new Map(dots.map(d => [d.id, d]))
  const lines = drawn.map((e) => {
    const a = at.get(e.from)!
    const b = at.get(e.to)!
    return { key: `${e.from}>${e.to}`, x1: a.x, y1: a.y, x2: b.x, y2: b.y, inferred: e.inferred }
  })
  const { width = 0, height = 0 } = g.graph()
  return { dots, lines, width: Math.max(width, 1), height: Math.max(height, 1) }
})
</script>

<template>
  <svg
    :viewBox="`0 0 ${layout.width} ${layout.height}`"
    preserveAspectRatio="xMidYMid meet"
    role="img"
    :aria-label="`Proof shape: ${layout.dots.length} statements`"
    class="mx-auto block h-auto w-full"
    :style="{ maxHeight: `${maxHeight}px` }"
  >
    <g
      class="stroke-(--ui-border-accented)"
      stroke-width="0.8"
      fill="none"
    >
      <line
        v-for="l in layout.lines"
        :key="l.key"
        :x1="l.x1"
        :y1="l.y1"
        :x2="l.x2"
        :y2="l.y2"
        :stroke-dasharray="l.inferred ? '2 2' : undefined"
      />
    </g>
    <g>
      <circle
        v-for="d in layout.dots"
        :key="d.id"
        :cx="d.x"
        :cy="d.y"
        :r="d.root ? DOT / 2 + 0.5 : DOT / 2 - 0.5"
        :class="[
          d.novel || d.root ? 'fill-primary' : 'fill-(--ui-bg) stroke-(--ui-text-dimmed)',
          d.root ? 'stroke-primary' : ''
        ]"
        :stroke-width="d.root ? 0 : 1"
      />
      <circle
        v-for="d in layout.dots.filter(x => x.root)"
        :key="`ring-${d.id}`"
        :cx="d.x"
        :cy="d.y"
        :r="DOT / 2 + 3"
        fill="none"
        class="stroke-primary"
        stroke-width="1.2"
      />
    </g>
  </svg>
</template>
