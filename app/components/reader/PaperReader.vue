<script setup lang="ts">
import { breakpointsTailwind, useBreakpoints } from '@vueuse/core'
import type { DropdownMenuItem } from '@nuxt/ui'
import type { PaperAnchor, PaperFigure } from '#shared/types'
import type { EventBus, PDFFindController, PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import 'pdfjs-dist/web/pdf_viewer.css'

// The paper itself: the PDF typeset at ingest (TeX Live + SyncTeX, or arXiv's PDF as a fallback) in PDF.js, with
// each statement's SyncTeX boxes drawn as subtle overlays and margin markers. Clicking inside a statement or proof
// selects its node; selecting a node anywhere else scrolls here. PDF.js is client-only and loaded on mount.

const { paper, digest, index } = useDigestContext()
const { selectedId, select, setQuery } = useSelection()
const route = useRoute()
const narrow = useBreakpoints(breakpointsTailwind).smaller('md')

const render = computed(() => digest.value?.render)
const pdfUrl = computed(() => render.value?.pdf_url)
const anchors = computed<Record<string, PaperAnchor[]>>(() => render.value?.anchors ?? {})
const figures = computed(() => digest.value?.figures ?? [])
const exact = computed(() => render.value?.status === 'compiled' && render.value.synctex)

interface PageItem extends PaperAnchor { id: string }
const byPage = computed(() => {
  const map = new Map<number, PageItem[]>()
  for (const [id, list] of Object.entries(anchors.value)) {
    for (const a of list) {
      if (!a.approx) {
        (map.get(a.page) ?? map.set(a.page, []).get(a.page)!).push({ ...a, id })
      }
    }
  }
  return map
})

const container = useTemplateRef<HTMLDivElement>('container')
const viewerEl = useTemplateRef<HTMLDivElement>('viewerEl')
let viewer: PDFViewer | null = null
let bus: EventBus | null = null
let finder: PDFFindController | null = null
let doc: PDFDocumentProxy | null = null

const loading = ref(true)
const loadError = ref('')
const page = ref(1)
const pages = ref(0)
const scale = ref(1)
const query = ref('')
const matches = ref<{ current: number, total: number } | null>(null)
const showMarkers = ref(true)
const invert = ref(false)
const figureOpen = ref<PaperFigure | null>(null)
let fromPdf = false

const pageSize = (n: number) => {
  const view = viewer?.getPageView(n - 1)?.pdfPage?.view as number[] | undefined
  return view ? { w: view[2]! - view[0]!, h: view[3]! - view[1]! } : render.value?.page_size ?? { w: 612, h: 792 }
}

function nodeTitle(id: string) {
  const n = index.value.byId.get(id)
  if (!n) {
    return id
  }
  const number = n.paper_ref.label ? digest.value?.labels?.[n.paper_ref.label]?.number : undefined
  return `${capitalize(n.kind)}${number ? ` ${number}` : ''} · ${n.name}`
}

const pct = (v: number, of: number) => `${(v / of * 100).toFixed(3)}%`

/** (Re)draws one page's overlays: statement/proof boxes, a margin marker per statement, figure badges. */
function decorate(n: number) {
  const view = viewer?.getPageView(n - 1)
  const div = view?.div as HTMLDivElement | undefined
  if (!div) {
    return
  }
  div.querySelector(':scope > .gpe-layer')?.remove()
  const items = byPage.value.get(n) ?? []
  const figs = figures.value.filter(f => f.rect?.page === n)
  if (!items.length && !figs.length) {
    return
  }
  const { w, h } = pageSize(n)
  const layer = document.createElement('div')
  layer.className = 'gpe-layer'
  const place = (el: HTMLElement, r: { x: number, y: number, w: number, h: number }) => {
    el.style.left = pct(r.x, w)
    el.style.top = pct(r.y, h)
    el.style.width = pct(r.w, w)
    el.style.height = pct(r.h, h)
  }
  for (const it of items) {
    const box = document.createElement('div')
    box.className = `gpe-box part-${it.part}${it.id === selectedId.value ? ' is-selected' : ''}`
    box.dataset.node = it.id
    place(box, { x: it.x - 2, y: it.y - 1.5, w: it.w + 4, h: it.h + 3 })
    layer.appendChild(box)
  }
  // One marker per node and page, in the left margin beside its statement lines.
  const spans = new Map<string, { y0: number, y1: number, x: number, claim: boolean }>()
  for (const it of items.filter(i => i.part === 'statement')) {
    const s = spans.get(it.id)
    const claim = !!index.value.byId.get(it.id)?.parent_id
    spans.set(it.id, s ? { y0: Math.min(s.y0, it.y), y1: Math.max(s.y1, it.y + it.h), x: Math.min(s.x, it.x), claim } : { y0: it.y, y1: it.y + it.h, x: it.x, claim })
  }
  for (const [id, s] of spans) {
    const m = document.createElement('button')
    m.type = 'button'
    m.className = `gpe-marker${s.claim ? ' is-claim' : ''}${id === selectedId.value ? ' is-selected' : ''}`
    m.dataset.node = id
    m.title = nodeTitle(id)
    m.setAttribute('aria-label', `Select ${nodeTitle(id)}`)
    place(m, { x: Math.max(4, s.x - 16), y: s.y0 - 1, w: 4, h: Math.max(8, s.y1 - s.y0 + 2) })
    layer.appendChild(m)
  }
  for (const f of figs) {
    const r = f.rect!
    const box = document.createElement('div')
    box.className = 'gpe-fig'
    box.dataset.figure = f.id
    place(box, r)
    const badge = document.createElement('button')
    badge.type = 'button'
    badge.className = 'gpe-fig-badge'
    badge.dataset.figure = f.id
    badge.textContent = `${f.number ? `Figure ${f.number}` : 'Figure'}${f.description ? ' · described' : ''}`
    badge.title = f.description || f.caption
    box.appendChild(badge)
    layer.appendChild(box)
  }
  div.appendChild(layer)
}

function redrawAll() {
  for (let i = 1; i <= pages.value; i++) {
    if (viewer?.getPageView(i - 1)?.div?.querySelector('.gpe-layer') || byPage.value.has(i)) {
      decorate(i)
    }
  }
}

function markSelected(id: string) {
  viewerEl.value?.querySelectorAll('.gpe-box.is-selected, .gpe-marker.is-selected').forEach(el => el.classList.remove('is-selected'))
  if (id) {
    viewerEl.value?.querySelectorAll(`[data-node="${CSS.escape(id)}"]`).forEach(el => el.classList.add('is-selected'))
  }
}

function flash(selector: string) {
  const els = viewerEl.value?.querySelectorAll(selector)
  els?.forEach(el => el.classList.add('gpe-flash'))
  setTimeout(() => els?.forEach(el => el.classList.remove('gpe-flash')), 1400)
}

function scrollToRect(r: { page: number, x: number, y: number }) {
  const { h } = pageSize(r.page)
  viewer?.scrollPageIntoView({ pageNumber: r.page, destArray: [null, { name: 'XYZ' }, 0, h - Math.max(0, r.y - 36), null], allowNegativeOffset: true })
}

/** The node's first statement box (or its parent's, for an unanchored claim). */
function anchorOf(id: string): PaperAnchor | undefined {
  const list = anchors.value[id]
  const own = list?.find(a => a.part === 'statement') ?? list?.[0]
  if (own) {
    return own
  }
  const parent = index.value.byId.get(id)?.parent_id
  return parent ? anchorOf(parent) : undefined
}

function scrollToNode(id: string) {
  const a = anchorOf(id)
  if (!a || !viewer) {
    return false
  }
  if (a.approx) {
    viewer.currentPageNumber = a.page
  } else {
    scrollToRect(a)
    flash(`.gpe-box.part-statement[data-node="${CSS.escape(id)}"]`)
  }
  return true
}

function scrollToFigure(id: string) {
  const f = figures.value.find(x => x.id === id)
  if (!f || !viewer) {
    return
  }
  if (f.rect) {
    scrollToRect(f.rect)
    flash(`.gpe-fig[data-figure="${CSS.escape(id)}"]`)
  } else if (f.page) {
    viewer.currentPageNumber = f.page
  }
}

/** A click in a page (not a drag-selection, not a PDF link) selects the innermost node box under it. */
function onPageClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  const fig = target.closest<HTMLElement>('[data-figure]')
  if (fig?.classList.contains('gpe-fig-badge')) {
    figureOpen.value = figures.value.find(f => f.id === fig.dataset.figure) ?? null
    return
  }
  const marker = target.closest<HTMLElement>('.gpe-marker')
  if (marker?.dataset.node) {
    fromPdf = true
    void select(marker.dataset.node)
    return
  }
  if (target.closest('a, .annotationLayer section') || !(window.getSelection()?.isCollapsed ?? true)) {
    return
  }
  const pageDiv = target.closest<HTMLElement>('.page')
  const n = Number(pageDiv?.dataset.pageNumber)
  if (!pageDiv || !n) {
    return
  }
  const id = hitTest(pageDiv, n, e.clientX, e.clientY)
  if (id) {
    fromPdf = true
    void select(id)
  }
}

function hitTest(pageDiv: HTMLElement, n: number, cx: number, cy: number): string | undefined {
  const box = pageDiv.getBoundingClientRect()
  const { w, h } = pageSize(n)
  const x = (cx - box.left) / box.width * w
  const y = (cy - box.top) / box.height * h
  const hits = (byPage.value.get(n) ?? []).filter(a => x >= a.x - 3 && x <= a.x + a.w + 3 && y >= a.y - 2 && y <= a.y + a.h + 2)
  // A claim's box sits inside its parent's proof: statements beat proofs, smaller beats bigger.
  hits.sort((a, b) => (a.part === b.part ? 0 : a.part === 'statement' ? -1 : 1) || a.w * a.h - b.w * b.h)
  return hits[0]?.id
}

let hoverId = ''
let raf = 0
function onPageMove(e: MouseEvent) {
  if (raf) {
    return
  }
  raf = requestAnimationFrame(() => {
    raf = 0
    const pageDiv = (e.target as HTMLElement).closest<HTMLElement>('.page')
    const n = Number(pageDiv?.dataset.pageNumber)
    const id = pageDiv && n ? hitTest(pageDiv, n, e.clientX, e.clientY) ?? '' : ''
    if (id === hoverId) {
      return
    }
    viewerEl.value?.querySelectorAll('.gpe-box.is-hover').forEach(el => el.classList.remove('is-hover'))
    hoverId = id
    if (id) {
      viewerEl.value?.querySelectorAll(`.gpe-box[data-node="${CSS.escape(id)}"]`).forEach(el => el.classList.add('is-hover'))
    }
  })
}

// --- find, zoom, pages ---
function find(again = false, previous = false) {
  if (!bus) {
    return
  }
  if (!query.value.trim()) {
    matches.value = null
    bus.dispatch('find', { source: null, type: '', query: '', caseSensitive: false, entireWord: false, highlightAll: false, findPrevious: false, matchDiacritics: false })
    return
  }
  bus.dispatch('find', { source: null, type: again ? 'again' : '', query: query.value, caseSensitive: false, entireWord: false, highlightAll: true, findPrevious: previous, matchDiacritics: false })
}
let findTimer: ReturnType<typeof setTimeout> | undefined
watch(query, () => {
  clearTimeout(findTimer)
  findTimer = setTimeout(() => find(), 250)
})

function zoom(by: number) {
  if (viewer) {
    viewer.currentScale = Math.min(4, Math.max(0.4, Math.round((viewer.currentScale * by) * 100) / 100))
  }
}
function fitWidth() {
  if (viewer) {
    viewer.currentScaleValue = 'page-width'
  }
}
function goPage(n: number) {
  if (viewer && n >= 1 && n <= pages.value) {
    viewer.currentPageNumber = n
  }
}

const figureItems = computed<DropdownMenuItem[]>(() => figures.value.map(f => ({
  label: `${f.number ? `Figure ${f.number}` : 'Figure'}${f.page ? ` · p. ${f.page}` : ''}`,
  description: f.description ? FIGURE_KIND_LABEL[f.kind] : undefined,
  icon: f.tikz ? 'i-lucide-pen-tool' : 'i-lucide-image',
  onSelect: () => {
    scrollToFigure(f.id)
    figureOpen.value = f
  }
})))

// --- lifecycle ---
async function load(url: string) {
  loading.value = true
  loadError.value = ''
  try {
    const pdfjs = await import('pdfjs-dist')
    ;(globalThis as { pdfjsLib?: unknown }).pdfjsLib = pdfjs
    pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
    const lib = await import('pdfjs-dist/web/pdf_viewer.mjs')
    if (!container.value || !viewerEl.value) {
      return
    }
    viewerEl.value.classList.add('pdfViewer')
    bus = new lib.EventBus()
    const links = new lib.PDFLinkService({ eventBus: bus, externalLinkTarget: lib.LinkTarget.BLANK })
    finder = new lib.PDFFindController({ eventBus: bus, linkService: links })
    viewer = new lib.PDFViewer({ container: container.value, viewer: viewerEl.value, eventBus: bus, linkService: links, findController: finder })
    links.setViewer(viewer)
    bus.on('pagesinit', () => {
      viewer!.currentScaleValue = narrow.value ? 'page-width' : 'auto'
      initialPosition()
    })
    bus.on('pagechanging', (e: { pageNumber: number }) => {
      page.value = e.pageNumber
    })
    bus.on('scalechanging', (e: { scale: number }) => {
      scale.value = e.scale
    })
    bus.on('pagerendered', (e: { pageNumber: number }) => decorate(e.pageNumber))
    bus.on('updatefindmatchescount', (e: { matchesCount: { current: number, total: number } }) => {
      matches.value = e.matchesCount
    })
    bus.on('updatefindcontrolstate', (e: { matchesCount?: { current: number, total: number } }) => {
      if (e.matchesCount) {
        matches.value = e.matchesCount
      }
    })
    doc = await pdfjs.getDocument({ url, rangeChunkSize: 256 * 1024 }).promise
    pages.value = doc.numPages
    viewer.setDocument(doc)
    links.setDocument(doc)
  } catch (err) {
    loadError.value = (err as Error).message || 'Could not load the PDF'
  } finally {
    loading.value = false
  }
}

/** ?page=N (the paper's landing) wins; then ?figure=<id>; else the selected node, for deep links. */
function initialPosition() {
  const p = Number(route.query.page)
  if (p) {
    goPage(p)
    void setQuery('page', undefined)
  } else if (typeof route.query.figure === 'string') {
    scrollToFigure(route.query.figure)
    void setQuery('figure', undefined)
  } else if (selectedId.value) {
    scrollToNode(selectedId.value)
  }
}

watch(selectedId, (id) => {
  markSelected(id)
  if (!fromPdf && id) {
    scrollToNode(id)
  }
  fromPdf = false
})
watch(() => route.query.figure, (id) => {
  if (typeof id === 'string' && viewer && pages.value) {
    scrollToFigure(id)
    void setQuery('figure', undefined)
  }
})
watch([byPage, () => figures.value.length], () => redrawAll())

onMounted(() => {
  if (pdfUrl.value) {
    void load(pdfUrl.value)
  }
})
watch(pdfUrl, (url, old) => {
  if (url && url !== old) {
    void doc?.loadingTask.destroy()
    void load(url)
  }
})
onBeforeUnmount(() => {
  void doc?.loadingTask.destroy()
  viewer = null
  bus = null
})

const sourceLink = computed(() => sourceUrl(paper.value, { section: '', file: '', line: 1 }))
const runLink = computed(() => `/papers/${paper.value?.slug}/run`)
</script>

<template>
  <div
    class="flex h-full min-h-0 flex-col"
    data-paper-reader
  >
    <UEmpty
      v-if="!pdfUrl"
      icon="i-lucide-file-x"
      title="Rendered view unavailable"
      :description="render ? `This paper did not compile here${render.error ? `: ${render.error.split('\n')[0]}` : ''}, and there is no arXiv PDF to fall back to.` : 'This paper has not been rendered yet. Render it from the run page; the map, nodes and graph work without it.'"
      :actions="[
        ...(sourceLink ? [{ label: 'Open the source', icon: 'i-lucide-external-link', to: sourceLink, target: '_blank', color: 'neutral' as const, variant: 'outline' as const }] : []),
        { label: render ? 'Re-render' : 'Render paper', icon: 'i-lucide-printer', to: runLink, color: 'neutral' as const, variant: 'subtle' as const }
      ]"
      class="m-auto max-w-md"
      data-reader-unavailable
    />
    <template v-else>
      <!-- Toolbar: wraps on narrow screens. -->
      <div class="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-default px-2 py-1.5 sm:px-3">
        <div class="flex items-center gap-0.5">
          <UButton
            icon="i-lucide-chevron-up"
            color="neutral"
            variant="ghost"
            size="xs"
            aria-label="Previous page"
            :disabled="page <= 1"
            @click="goPage(page - 1)"
          />
          <span class="min-w-16 text-center text-xs text-muted tabular-nums">p. {{ page }} / {{ pages || '…' }}</span>
          <UButton
            icon="i-lucide-chevron-down"
            color="neutral"
            variant="ghost"
            size="xs"
            aria-label="Next page"
            :disabled="page >= pages"
            @click="goPage(page + 1)"
          />
        </div>
        <div class="flex items-center gap-0.5">
          <UButton
            icon="i-lucide-zoom-out"
            color="neutral"
            variant="ghost"
            size="xs"
            aria-label="Zoom out"
            @click="zoom(1 / 1.15)"
          />
          <button
            type="button"
            class="min-w-11 rounded-sm text-center text-xs text-muted tabular-nums hover:text-default"
            title="Fit to width"
            @click="fitWidth"
          >
            {{ Math.round(scale * 100) }}%
          </button>
          <UButton
            icon="i-lucide-zoom-in"
            color="neutral"
            variant="ghost"
            size="xs"
            aria-label="Zoom in"
            @click="zoom(1.15)"
          />
        </div>
        <UInput
          v-model="query"
          icon="i-lucide-search"
          placeholder="Find in paper"
          size="xs"
          class="w-36 sm:w-48"
          data-reader-find
          @keydown.enter.exact.prevent="find(true)"
          @keydown.shift.enter.prevent="find(true, true)"
        >
          <template
            v-if="query && matches"
            #trailing
          >
            <span class="text-[10px] text-muted tabular-nums">{{ matches.total ? `${matches.current}/${matches.total}` : '0' }}</span>
          </template>
        </UInput>
        <div class="ms-auto flex items-center gap-0.5">
          <UDropdownMenu
            v-if="figures.length"
            :items="figureItems"
            :content="{ align: 'end' }"
          >
            <UButton
              icon="i-lucide-images"
              color="neutral"
              variant="ghost"
              size="xs"
              :label="String(figures.length)"
              aria-label="Figures"
              data-reader-figures
            />
          </UDropdownMenu>
          <UTooltip
            v-if="exact"
            :text="showMarkers ? 'Hide statement markers' : 'Show statement markers'"
          >
            <UButton
              :icon="showMarkers ? 'i-lucide-eye' : 'i-lucide-eye-off'"
              color="neutral"
              variant="ghost"
              size="xs"
              aria-label="Toggle statement markers"
              @click="showMarkers = !showMarkers"
            />
          </UTooltip>
          <UTooltip :text="invert ? 'Paper colors' : 'Dark pages'">
            <UButton
              :icon="invert ? 'i-lucide-sun' : 'i-lucide-moon'"
              color="neutral"
              variant="ghost"
              size="xs"
              aria-label="Invert page colors"
              data-reader-invert
              @click="invert = !invert"
            />
          </UTooltip>
          <UTooltip text="Open the PDF">
            <UButton
              :to="pdfUrl"
              target="_blank"
              icon="i-lucide-download"
              color="neutral"
              variant="ghost"
              size="xs"
              aria-label="Open the PDF"
            />
          </UTooltip>
        </div>
      </div>
      <UAlert
        v-if="render?.status === 'arxiv_pdf'"
        color="neutral"
        variant="subtle"
        icon="i-lucide-info"
        title="Showing arXiv's PDF"
        description="The source did not compile here, so statements are located by page rather than boxed; the tree still jumps to them."
        class="shrink-0 rounded-none border-b border-default"
        :ui="{ title: 'text-xs', description: 'text-xs' }"
        data-reader-arxiv
      />
      <div class="relative min-h-0 flex-1 bg-muted">
        <div
          ref="container"
          class="absolute inset-0 overflow-auto"
          data-gpe-reader
          :data-invert="invert || undefined"
          :data-no-markers="!showMarkers || undefined"
          @click="onPageClick"
          @mousemove="onPageMove"
        >
          <!-- PDF.js's own stylesheet keys on the .pdfViewer class (added on mount). -->
          <div ref="viewerEl" />
        </div>
        <div
          v-if="loading || loadError"
          class="pointer-events-none absolute inset-0 flex items-center justify-center"
        >
          <UIcon
            v-if="loading"
            name="i-lucide-loader-circle"
            class="size-6 animate-spin text-muted"
          />
          <UAlert
            v-else
            color="error"
            variant="subtle"
            icon="i-lucide-circle-alert"
            title="Could not load the PDF"
            :description="loadError"
            class="pointer-events-auto max-w-sm"
          />
        </div>
      </div>
    </template>

    <UModal
      :open="!!figureOpen"
      :title="figureOpen?.number ? `Figure ${figureOpen.number}` : 'Figure'"
      :ui="{ content: 'sm:max-w-2xl' }"
      @update:open="(v: boolean) => { if (!v) figureOpen = null }"
    >
      <template #body>
        <FigureCard
          v-if="figureOpen"
          :figure="figureOpen"
          in-reader
        />
      </template>
    </UModal>
  </div>
</template>

<style>
/* Overlays live inside PDF.js's page divs (not Vue-rendered), so these styles are global. Positions are in % of
   the page, so zoom never needs a redraw; PDF.js re-renders pages on zoom and `pagerendered` re-adds the layer. */
[data-gpe-reader] .pdfViewer {
  padding-block: 0.75rem;
}
[data-gpe-reader] .pdfViewer .page {
  --page-border: 0 solid transparent;
  margin-bottom: 0.75rem;
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.12), 0 4px 16px rgb(0 0 0 / 0.06);
}
[data-invert] .page .canvasWrapper {
  filter: invert(0.9) hue-rotate(180deg);
}
.gpe-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 3;
}
.gpe-box {
  position: absolute;
  border-radius: 2px;
  transition: background-color 0.15s, box-shadow 0.15s;
}
.gpe-box.is-hover {
  background: color-mix(in oklab, var(--ui-primary) 7%, transparent);
}
.gpe-box.part-statement.is-selected {
  background: color-mix(in oklab, var(--ui-primary) 11%, transparent);
}
.gpe-box.part-proof.is-selected {
  background: color-mix(in oklab, var(--ui-primary) 4%, transparent);
}
.gpe-box.gpe-flash {
  animation: gpe-flash 1.4s ease-out;
}
@keyframes gpe-flash {
  0% { background: color-mix(in oklab, var(--ui-primary) 28%, transparent); }
  100% { background: color-mix(in oklab, var(--ui-primary) 11%, transparent); }
}
.gpe-marker {
  position: absolute;
  pointer-events: auto;
  cursor: pointer;
  border-radius: 2px;
  background: color-mix(in oklab, var(--ui-primary) 30%, transparent);
  transition: background-color 0.15s, transform 0.15s;
}
.gpe-marker.is-claim {
  background: color-mix(in oklab, var(--ui-primary) 16%, transparent);
}
/* A wider invisible hit area than the 4pt bar. */
.gpe-marker::before {
  content: "";
  position: absolute;
  inset: 0 -6px;
}
.gpe-marker:hover,
.gpe-marker.is-selected {
  background: var(--ui-primary);
}
[data-no-markers] .gpe-marker,
[data-no-markers] .gpe-box:not(.is-selected) {
  display: none;
}
.gpe-fig {
  position: absolute;
  border-radius: 3px;
  outline: 1px dashed transparent;
  transition: outline-color 0.15s;
}
.gpe-fig:hover,
.gpe-fig.gpe-flash {
  outline-color: color-mix(in oklab, var(--ui-primary) 45%, transparent);
}
.gpe-fig-badge {
  position: absolute;
  top: 2px;
  right: 2px;
  pointer-events: auto;
  cursor: pointer;
  font: 500 11px/1.4 var(--font-sans, system-ui, sans-serif);
  padding: 1px 6px;
  border-radius: 9999px;
  color: var(--ui-primary);
  background: color-mix(in oklab, white 85%, var(--ui-primary));
  opacity: 0.85;
}
.gpe-fig-badge:hover {
  opacity: 1;
}
</style>
