import type { FigureKind, PaperDigest, PaperFigure } from '#shared/types'

export const FIGURE_KIND_LABEL: Record<FigureKind, string> = {
  plot: 'plot',
  commutative_diagram: 'commutative diagram',
  graph: 'graph',
  diagram: 'diagram',
  schematic: 'schematic',
  illustration: 'illustration',
  table: 'table',
  photo: 'photo',
  other: 'figure'
}

/** Figures the vision pass (or a \ref from the node's own text) tied to a node. */
export function figuresForNode(digest: PaperDigest | null | undefined, nodeId: string): PaperFigure[] {
  return (digest?.figures ?? []).filter(f => f.node_ids.includes(nodeId))
}
