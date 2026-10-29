// Pure viewport math for the zoomable graph (ProofGraph.vue drives d3-zoom with these). A view maps world
// (layout) coordinates to screen: screen = world * k + (x, y), the same shape as d3's ZoomTransform.

export interface View { x: number, y: number, k: number }
export interface Box { x: number, y: number, w: number, h: number }

export const ZOOM_MAX = 2.5
/** Below this the role line hides; below LOD_LABEL a card shows only its label, large. */
export const LOD_COMPACT = 0.6
export const LOD_LABEL = 0.32

export type Lod = 'full' | 'compact' | 'label'

export function lodFor(k: number): Lod {
  return k < LOD_LABEL ? 'label' : k < LOD_COMPACT ? 'compact' : 'full'
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Smallest box holding every rect; null for none. */
export function boundsOf(rects: Iterable<Box>): Box | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const r of rects) {
    x0 = Math.min(x0, r.x)
    y0 = Math.min(y0, r.y)
    x1 = Math.max(x1, r.x + r.w)
    y1 = Math.max(y1, r.y + r.h)
  }
  return Number.isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null
}

/** The view that shows `box` whole and centered in a vw × vh viewport, with `pad` screen px around it. */
export function fitView(box: Box, vw: number, vh: number, opts: { pad?: number, minK?: number, maxK?: number } = {}): View {
  const pad = opts.pad ?? 24
  const k = clamp(Math.min((vw - 2 * pad) / Math.max(box.w, 1), (vh - 2 * pad) / Math.max(box.h, 1)), opts.minK ?? 0.02, opts.maxK ?? 1)
  return centerView({ x: box.x + box.w / 2, y: box.y + box.h / 2 }, k, vw, vh)
}

/** The view at zoom `k` with world point `p` in the middle of the viewport. */
export function centerView(p: { x: number, y: number }, k: number, vw: number, vh: number): View {
  return { x: vw / 2 - p.x * k, y: vh / 2 - p.y * k, k }
}

/** The world rectangle a view shows in a vw × vh viewport (the minimap's viewport frame). */
export function visibleWorld(v: View, vw: number, vh: number): Box {
  return { x: -v.x / v.k, y: -v.y / v.k, w: vw / v.k, h: vh / v.k }
}

/** Zoom level to land on when the selection changes: keep the user's zoom unless it is too far out to read. */
export function focusZoom(k: number): number {
  return k < LOD_COMPACT ? 0.9 : k
}

/**
 * Keeps at least `keep` screen px of a W × H drawing inside the viewport, so a fling can't lose the graph.
 * Only the translation moves; the zoom stays.
 */
export function constrainView(v: View, W: number, H: number, vw: number, vh: number, keep = 80): View {
  const axis = (t: number, size: number, port: number) => {
    const k = Math.min(keep, size * v.k / 2, port / 2)
    const lo = k - size * v.k // drawing's far edge at least `k` into the viewport
    const hi = port - k
    return clamp(t, lo, hi)
  }
  return { x: axis(v.x, W, vw), y: axis(v.y, H, vh), k: v.k }
}

/** ProofGraph's zoom/pan per paper (and mode/claims, since the layout differs), for this tab only: not in the URL. */
export const savedGraphViews = new Map<string, View>()
