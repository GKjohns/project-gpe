<script setup lang="ts">
import { breakpointsTailwind, useBreakpoints, useClipboard, useElementSize, useWindowSize, watchDebounced } from '@vueuse/core'
import type { BreadcrumbItem, CommandPaletteGroup, CommandPaletteItem, DropdownMenuItem, SplitterItem, TabsItem } from '@nuxt/ui'
import type { PaperTab } from '~/components/paper/PaperNavbar.vue'
import type { PublicPaperItem } from '#shared/api'
import type { GraphColorBy, GraphMode } from '~/utils/graph'

// Keyed by paper so moving between nodes keeps the sidebar, tree state and panel sizes mounted.
definePageMeta({ layout: 'dashboard', key: route => String(route.params.paper) })

const route = useRoute()
const toast = useToast()
const { paperSlug, selectedId, cardClosed, select, setQuery } = useSelection()

const { paper, digest, catalog, index, error, ready } = useDigest(paperSlug)
const { operator, ready: operatorReady } = useOperator()
provideDigest({ paper, digest, index })
await ready

if (error.value) {
  throw createError({ statusCode: error.value.statusCode ?? 404, statusMessage: error.value.statusMessage ?? 'Paper not found', fatal: true })
}
if (paper.value && !digest.value) {
  // Not digested yet: the operator's only useful view is the run page; for everyone else there is nothing here.
  await operatorReady
  if (!operator.value) {
    throw createError({ statusCode: 404, statusMessage: 'Paper not found', fatal: true })
  }
  await navigateTo(`/admin/papers/${paperSlug.value}/run`, { replace: true })
}

const node = computed(() => index.value.byId.get(selectedId.value))

// A node's link preview leads with its plain-English statement; the bare paper falls back to its headline.
const seoTitle = computed(() => node.value ? `${node.value.name} · ${digest.value?.title}` : (digest.value?.title ?? 'Paper'))
const seoDescription = computed(() => metaDescription(node.value?.statement_plain || digest.value?.summary?.headline || '') || undefined)
useSeoMeta({
  title: seoTitle,
  description: seoDescription,
  ogTitle: () => `${seoTitle.value} · Proofmap`,
  ogDescription: seoDescription,
  ogType: 'article',
  twitterTitle: () => `${seoTitle.value} · Proofmap`,
  twitterDescription: seoDescription
})

// --- paper switcher -------------------------------------------------------
const { data: library } = await useFetch<PublicPaperItem[]>('/api/papers', { key: 'papers', default: () => [] })
const paperItems = computed(() => (library.value ?? []).filter(p => p.counts).map(p => ({ label: p.title, value: p.slug })))
const paperModel = computed({
  get: () => paperSlug.value,
  set: (slug: string) => {
    if (slug && slug !== paperSlug.value) {
      navigateTo(`/${slug}`)
    }
  }
})

// --- tree + search --------------------------------------------------------
const tree = useTemplateRef<{ expandAll: (open: boolean) => void }>('tree')

const searchGroups = computed<CommandPaletteGroup<CommandPaletteItem>[]>(() => [{
  id: 'nodes',
  label: digest.value?.title ?? 'Nodes',
  items: (digest.value?.nodes ?? []).map((n) => {
    const s = index.value.sectionOf[n.id]
    return {
      id: n.id,
      label: n.name,
      suffix: n.paper_ref.label ?? n.id,
      description: s ? sectionLabel(s.id, s.title) : undefined,
      icon: KIND_ICON[n.kind],
      onSelect: () => select(n.id)
    }
  })
}])
const searchFuse = { fuseOptions: { keys: ['label', 'suffix', 'id', 'description'] } }

const counts = computed(() => {
  const nodes = digest.value?.nodes ?? []
  return {
    nodes: nodes.length,
    novel: nodes.filter(n => n.classification === 'novel').length,
    friction: nodes.reduce((sum, n) => sum + n.friction.length, 0)
  }
})

// --- navbar ---------------------------------------------------------------
// PaperNavbar's Papers › family › paper, then parent › node (the section is the tree's grouping).
const breadcrumb = computed<BreadcrumbItem[]>(() => {
  const n = node.value
  const items: BreadcrumbItem[] = []
  if (n?.parent_id) {
    const parent = index.value.byId.get(n.parent_id)
    if (parent) {
      items.push({ label: parent.name, to: `/${paperSlug.value}/${parent.id}` })
    }
  }
  if (n) {
    items.push({ label: n.name })
  }
  return items
})

// Overview · Tree · Graph · Paper live in PaperNavbar; a bare node link is the tree view, so old deep links work.
const view = computed({
  get: () => route.query.view === 'graph' ? 'graph' : route.query.view === 'paper' ? 'paper' : 'tree',
  set: (v: string | number) => setQuery('view', v === 'graph' || v === 'paper' ? String(v) : undefined)
})
const activeTab = computed<PaperTab>(() => view.value)

// --- graph view (Sprint 6) ----------------------------------------------------
// Route state lives in the query so a graph view is shareable: ?view=graph&mode=focus&claims=1&color=sec
const GRAPH_GUARD = 400
const graphSize = computed(() => (digest.value?.nodes ?? []).filter(n => n.kind !== 'remark' && n.kind !== 'claim').length)
const graphTooBig = computed(() => graphSize.value > GRAPH_GUARD)
const modeTabs: TabsItem[] = [
  { label: 'Whole paper', value: 'all' },
  { label: 'Focus', value: 'focus' }
]
const graphMode = computed<GraphMode>({
  // Over the guard, focus is the default and Whole paper needs an explicit ?mode=all.
  get: () => route.query.mode === 'focus' ? 'focus' : route.query.mode === 'all' ? 'all' : (graphTooBig.value ? 'focus' : 'all'),
  set: (v) => {
    const explicit = graphTooBig.value ? v : (v === 'focus' ? 'focus' : undefined)
    setQuery('mode', explicit)
  }
})
const showClaims = computed({
  get: () => route.query.claims === '1',
  set: (v: boolean | 'indeterminate') => setQuery('claims', v === true ? '1' : undefined)
})
const colorTabs: TabsItem[] = [
  { label: 'by class', value: 'cls' },
  { label: 'by section', value: 'sec' }
]
const colorBy = computed<GraphColorBy>({
  get: () => route.query.color === 'sec' ? 'sec' : 'cls',
  set: v => setQuery('color', v === 'sec' ? 'sec' : undefined)
})
// Map = the pan/zoom DAG; Lens = the selection with one hop up and an unfolding outline below (no panning).
const graphLayout = computed<'map' | 'lens'>({
  get: () => route.query.layout === 'lens' ? 'lens' : 'map',
  set: v => setQuery('layout', v === 'lens' ? 'lens' : undefined)
})

// --- tree sidebar + panel sizes --------------------------------------------------
// The tree gives way to its icon rail only when the main panel would otherwise drop below a comfortable width (the
// graph and the typeset paper need more room than prose), so on common laptop widths and up it never moves on a view
// switch. Once the user opens or closes it, that choice holds for the visit and the layout stops deciding.
const mounted = ref(false)
onMounted(() => {
  mounted.value = true
})
const COMFORT: Record<PaperTab, number> = { overview: 0, tree: 560, graph: 600, paper: 600 }
// The sidebar persists {size (rem), collapsed} in this cookie; the server writes the fitted state into it before the
// sidebar renders, so SSR matches what the client picks. The last viewport width lives in a cookie for that guess.
const sidebarStore = useCookie<{ size: number, collapsed: boolean }>('digest-dashboard-sidebar-tree', { default: () => ({ size: 20, collapsed: false }) })
const lastWidth = useCookie<number | null>('digest-vw', { default: () => null, maxAge: 60 * 60 * 24 * 365 })
const { width: windowWidth } = useWindowSize()
const layoutWidth = computed(() => mounted.value ? windowWidth.value : (lastWidth.value ?? 1440))
watchDebounced(windowWidth, (w) => {
  lastWidth.value = w
}, { debounce: 500, immediate: true })

// Right panel widths in px, kept in a cookie (the splitter's own auto-save stores percentages, so a card dragged
// wide on a big screen came back as a third of a laptop screen).
const splitSizes = useCookie<{ node: number, chat: number }>('digest-split', { default: () => ({ node: 352, chat: 384 }), maxAge: 60 * 60 * 24 * 365 })
const sideSize = reactive({ ...splitSizes.value })
watchDebounced(sideSize, (v) => {
  splitSizes.value = { ...v }
}, { debounce: 300, deep: true })

const chatPref = ref<boolean | null>(null)
const treePref = useState<boolean | null>('tree-collapsed-pref', () => null)
function treeWantsRail(width: number) {
  if (width < 1024) {
    return false // below lg the tree is a slideover
  }
  const chatWanted = view.value !== 'tree' ? chatPref.value === true : chatPref.value !== false
  const side = chatWanted && width >= 1280 ? sideSize.chat : (view.value !== 'tree' && node.value ? sideSize.node : 0)
  return width - (sidebarStore.value?.size ?? 20) * 16 - side < COMFORT[view.value]
}
const railWanted = computed(() => treePref.value ?? treeWantsRail(layoutWidth.value))
if (import.meta.server && sidebarStore.value?.collapsed !== railWanted.value) {
  sidebarStore.value = { ...sidebarStore.value, collapsed: railWanted.value }
}
// Starts false so the sidebar syncs this ref to its cookie; after mount it follows railWanted.
const sidebarCollapsed = ref(false)
onMounted(() => {
  sidebarCollapsed.value = railWanted.value
})
watch(railWanted, (v) => {
  if (mounted.value) {
    sidebarCollapsed.value = v
  }
})
function setTreeCollapsed(v: boolean) {
  treePref.value = v
  sidebarCollapsed.value = v
}
// The sidebar echoes our own changes back; a different value is the user's drag-to-collapse.
function onSidebarCollapsed(v: boolean) {
  if (mounted.value && v !== sidebarCollapsed.value) {
    setTreeCollapsed(v)
  }
}

const { copy } = useClipboard({ legacy: true })
async function share() {
  const url = `${window.location.origin}${route.fullPath}`
  await copy(url)
  toast.add({ title: 'Link copied', description: url, icon: 'i-lucide-link', color: 'success' })
}

// Occasional actions live behind one menu so the navbar stays quiet. On a narrow bar (under 28rem: 26rem inside its
// padding, the container query that hides the inline graph controls) the graph's layout and options fold in here too.
// The navbar spans the main panel (its components render fragments, so measure the panel's element).
const mainPanel = computed(() => mounted.value ? document.getElementById('digest-dashboard-panel-node') : null)
const { width: navbarWidth } = useElementSize(mainPanel, undefined, { box: 'border-box' })
const narrowBar = computed(() => navbarWidth.value > 0 && navbarWidth.value < 448)
const graphMenuItems = computed<DropdownMenuItem[]>(() => [
  { label: 'Map', icon: 'i-lucide-network', type: 'checkbox', checked: graphLayout.value === 'map', onUpdateChecked: () => { graphLayout.value = 'map' } },
  { label: 'Lens', icon: 'i-lucide-focus', type: 'checkbox', checked: graphLayout.value === 'lens', onUpdateChecked: () => { graphLayout.value = 'lens' } },
  ...(graphLayout.value === 'map'
    ? [
        { label: 'Focus on the selection', type: 'checkbox' as const, checked: graphMode.value === 'focus', onUpdateChecked: (v: boolean) => { graphMode.value = v ? 'focus' : 'all' } },
        { label: 'Color by section', type: 'checkbox' as const, checked: colorBy.value === 'sec', onUpdateChecked: (v: boolean) => { colorBy.value = v ? 'sec' : 'cls' } }
      ]
    : []),
  { label: 'Include claims', type: 'checkbox', checked: showClaims.value, onUpdateChecked: (v: boolean) => { showClaims.value = v } }
])
const moreItems = computed<DropdownMenuItem[][]>(() => [
  ...(view.value === 'graph' && narrowBar.value ? [graphMenuItems.value] : []),
  [
    { label: 'Copy link to this view', icon: 'i-lucide-link', onSelect: share },
    { label: 'Friction report', icon: 'i-lucide-triangle-alert', to: `/${paperSlug.value}/friction`, suffix: counts.value.friction ? String(counts.value.friction) : undefined }
  ]
])
// Tab labels outrank every crumb but the current node: they show once the node crumb keeps ~15rem beside them
// (the graph's bar carries three more buttons, so it needs more). Container queries measure inside the bar's padding.
const tabLabelClass = computed(() => view.value === 'graph' ? 'hidden @min-[45rem]/nav:inline' : 'hidden @min-[39rem]/nav:inline')

// --- chat panel (Sprint 7 fills it) -----------------------------------------
// null = automatic: inline at xl and up (pure CSS, so SSR matches), hidden below. A click makes it explicit;
// below xl an explicit open shows a slideover instead.
const breakpoints = useBreakpoints(breakpointsTailwind)
const isXl = breakpoints.greaterOrEqual('xl')
// In graph view the right panel is the node card unless chat was explicitly opened.
const chatOpen = computed(() => view.value !== 'tree' ? chatPref.value === true : (chatPref.value ?? (mounted.value && isXl.value)))
function toggleChat() {
  chatPref.value = !chatOpen.value
}
const chatSlideover = computed({
  get: () => mounted.value && !isXl.value && chatPref.value === true,
  set: (v: boolean) => {
    chatPref.value = v
  }
})

// One conversation per paper page, shared by the xl panel and the slideover (Sprint 7).
const chat = createPaperChat(paperSlug, {
  open: () => {
    chatPref.value = true
  },
  // Below xl the chat covers the page; a citation click closes it so the node is visible (the thread stays).
  onCite: () => {
    if (!isXl.value) {
      chatPref.value = false
    }
  }
})
providePaperChat(chat)
const chatMessages = chat.messages

// ?ask=<text> (the family page's Ask box, the overview's Ask door): open the chat with the question prefilled.
// Never sent automatically: a shared link shouldn't spend a model call.
onMounted(() => {
  const ask = route.query.ask
  if (ask !== undefined) {
    chatPref.value = true
    chat.input.value = String(Array.isArray(ask) ? ask[0] ?? '' : ask ?? '')
    setQuery('ask', undefined)
  }
})
function clearChat() {
  chat.stop()
  chatMessages.value = []
}

// --- right panel ----------------------------------------------------------------
// The main panel and the right panel (node card or chat) share a USplitter, so the divider between them drags.
// The card shows from lg, the chat from xl; before mount the breakpoint is CSS-only (see the item classes).
const isLg = breakpoints.greaterOrEqual('lg')
const side = computed<'node' | 'chat' | null>(() => {
  const chatWanted = view.value !== 'tree' ? chatPref.value === true : chatPref.value !== false
  if (chatWanted && !(mounted.value && !isXl.value)) {
    return 'chat'
  }
  if (view.value !== 'tree' && node.value && !cardClosed.value && !(mounted.value && !isLg.value)) {
    return 'node'
  }
  return null
})
// Before mount the splitter's inline sizes treat px as flex-grow weights (the side panel took nearly the whole width
// until hydration), so the side panel gets a fixed basis from --split-side until the splitter measures.
const preMount = computed(() => mounted.value ? '' : 'grow-0! basis-(--split-side)!')
const splitItems = computed<SplitterItem[]>(() => {
  const items: SplitterItem[] = [{ id: 'main', slot: 'main', order: 1, minSize: 30, class: 'min-w-0' }]
  if (side.value === 'node') {
    items.push({ id: 'side-node', slot: 'side-node', order: 2, sizeUnit: 'px', defaultSize: sideSize.node, minSize: 280, maxSize: 640, class: ['hidden lg:flex min-w-0', preMount.value] })
  } else if (side.value === 'chat') {
    items.push({ id: 'side-chat', slot: 'side-chat', order: 2, sizeUnit: 'px', defaultSize: sideSize.chat, minSize: 300, maxSize: 760, class: ['hidden xl:flex min-w-0', preMount.value] })
  }
  return items
})
function onSplitLayout(layout: number[]) {
  const px = layout[1]
  if (mounted.value && px && side.value) {
    sideSize[side.value] = Math.round(px)
  }
}

// Unknown node id in the URL: fall back to the main theorem.
watch(() => [digest.value, selectedId.value] as const, ([d, id]) => {
  if (d && id && !index.value.byId.has(id) && d.root_ids[0]) {
    toast.add({ title: `No node "${id}" in this paper`, color: 'warning', icon: 'i-lucide-circle-alert' })
    select(d.root_ids[0], { replace: true })
  }
}, { immediate: import.meta.client })
</script>

<template>
  <div class="contents">
    <!-- display:contents keeps the panels direct flex children of UDashboardGroup. -->
    <UDashboardSidebar
      id="tree"
      :collapsed="sidebarCollapsed"
      resizable
      collapsible
      :collapsed-size="4"
      :default-size="20"
      :min-size="15"
      :max-size="32"
      :ui="{ root: 'transition-[width] duration-200 ease-out data-[dragging=true]:transition-none', body: 'gap-2 px-2', footer: 'border-t border-default' }"
      @update:collapsed="onSidebarCollapsed"
    >
      <template #header="{ collapsed }">
        <USelectMenu
          v-if="!collapsed"
          v-model="paperModel"
          :items="paperItems"
          value-key="value"
          icon="i-lucide-book-open"
          :search-input="false"
          color="neutral"
          variant="ghost"
          class="w-full font-semibold"
          :ui="{ content: 'min-w-64' }"
        />
        <!-- Collapsed rail: every icon is the same square ghost button on one centered column. -->
        <div
          v-else
          class="flex w-full justify-center"
        >
          <UTooltip text="Show the tree">
            <UButton
              icon="i-lucide-book-open"
              color="neutral"
              variant="ghost"
              square
              aria-label="Show the tree"
              @click="setTreeCollapsed(false)"
            />
          </UTooltip>
        </div>
      </template>

      <template #default="{ collapsed }">
        <div
          v-if="collapsed"
          class="flex w-full justify-center"
        >
          <UTooltip text="Show the tree">
            <UButton
              icon="i-lucide-panel-left-open"
              color="neutral"
              variant="ghost"
              square
              aria-label="Expand sidebar"
              @click="setTreeCollapsed(false)"
            />
          </UTooltip>
        </div>
        <div
          class="flex items-center gap-1"
          :class="collapsed && 'justify-center'"
        >
          <UDashboardSearchButton
            :collapsed="collapsed"
            label="Find a node…"
            :class="!collapsed && 'flex-1'"
          />
          <template v-if="!collapsed">
            <UTooltip text="Expand all">
              <UButton
                icon="i-lucide-plus"
                color="neutral"
                variant="ghost"
                size="sm"
                aria-label="Expand all"
                @click="tree?.expandAll(true)"
              />
            </UTooltip>
            <UTooltip text="Collapse all">
              <UButton
                icon="i-lucide-minus"
                color="neutral"
                variant="ghost"
                size="sm"
                aria-label="Collapse all"
                @click="tree?.expandAll(false)"
              />
            </UTooltip>
            <UTooltip text="Hide the tree">
              <UButton
                icon="i-lucide-panel-left-close"
                color="neutral"
                variant="ghost"
                size="sm"
                aria-label="Collapse sidebar"
                class="hidden lg:inline-flex"
                @click="setTreeCollapsed(true)"
              />
            </UTooltip>
          </template>
        </div>
        <TreePaperTree
          v-if="!collapsed && digest"
          ref="tree"
        />
      </template>

      <template #footer="{ collapsed }">
        <div
          v-if="!collapsed"
          class="flex flex-wrap gap-x-2 text-xs text-muted"
        >
          <span>{{ counts.nodes }} nodes</span>
          <span>·</span>
          <span>{{ counts.novel }} novel</span>
          <span>·</span>
          <NuxtLink
            :to="`/${paperSlug}/friction`"
            class="hover:underline"
            :class="counts.friction ? 'text-warning' : ''"
          >{{ counts.friction }} friction</NuxtLink>
        </div>
      </template>
    </UDashboardSidebar>

    <UDashboardSearch
      :groups="searchGroups"
      :fuse="searchFuse"
      :color-mode="false"
      placeholder="Search nodes by name, label or id…"
    />

    <!-- Main panel + right panel share a splitter: the divider between them drags (layout saved per pairing). -->
    <USplitter
      id="paper-split"
      :items="splitItems"
      class="min-w-0 flex-1"
      :style="{ '--split-side': `${side === 'chat' ? sideSize.chat : sideSize.node}px` }"
      :ui="{ handle: [side === 'chat' ? 'hidden xl:block' : 'hidden lg:block', 'w-px bg-(--ui-border) transition-colors hover:bg-primary data-[resize-handle-state=drag]:bg-primary'] }"
      @layout="onSplitLayout"
    >
      <template #main>
        <UDashboardPanel
          id="node"
          :ui="{ body: view !== 'tree' ? 'p-0 sm:p-0 gap-0 sm:gap-0 overflow-hidden' : 'lg:py-8' }"
        >
          <template #header>
            <PaperNavbar
              :slug="paperSlug"
              :title="digest?.title ?? paperSlug"
              :family="catalog?.family"
              :active="activeTab"
              :node-id="selectedId"
              :crumbs="breadcrumb"
              :label-class="tabLabelClass"
            >
              <template #right-start>
                <!-- Under 28rem of bar these fold into the "more" menu (narrowBar). -->
                <div
                  v-if="view === 'graph'"
                  class="hidden items-center gap-1.5 @min-[26rem]/nav:flex"
                >
                  <UFieldGroup size="sm">
                    <UTooltip text="Map: the whole graph">
                      <UButton
                        icon="i-lucide-network"
                        color="neutral"
                        :variant="graphLayout === 'map' ? 'soft' : 'ghost'"
                        aria-label="Map layout"
                        :aria-pressed="graphLayout === 'map'"
                        @click="graphLayout = 'map'"
                      />
                    </UTooltip>
                    <UTooltip text="Lens: the selection and what it rests on">
                      <UButton
                        icon="i-lucide-focus"
                        color="neutral"
                        :variant="graphLayout === 'lens' ? 'soft' : 'ghost'"
                        aria-label="Lens layout"
                        :aria-pressed="graphLayout === 'lens'"
                        @click="graphLayout = 'lens'"
                      />
                    </UTooltip>
                  </UFieldGroup>
                  <!-- Graph options tuck into a popover instead of a second toolbar row. -->
                  <UPopover :content="{ align: 'end' }">
                    <UTooltip text="Graph options">
                      <UButton
                        icon="i-lucide-sliders-horizontal"
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        aria-label="Graph options"
                      />
                    </UTooltip>
                    <template #content>
                      <div class="flex w-56 flex-col gap-3 p-3 text-sm">
                        <div
                          v-if="graphLayout === 'map'"
                          class="flex flex-col gap-1.5"
                        >
                          <span class="text-xs text-muted">Show</span>
                          <UTabs
                            v-model="graphMode"
                            :items="modeTabs"
                            :content="false"
                            size="xs"
                            color="neutral"
                          />
                        </div>
                        <div
                          v-if="graphLayout === 'map'"
                          class="flex flex-col gap-1.5"
                        >
                          <span class="text-xs text-muted">Color</span>
                          <UTabs
                            v-model="colorBy"
                            :items="colorTabs"
                            :content="false"
                            size="xs"
                            color="neutral"
                          />
                        </div>
                        <UCheckbox
                          v-model="showClaims"
                          label="Include claims"
                          size="sm"
                        />
                      </div>
                    </template>
                  </UPopover>
                </div>
              </template>
              <template #right>
                <UTooltip :text="chatOpen ? 'Close chat' : 'Ask the paper'">
                  <UButton
                    icon="i-lucide-message-square"
                    color="neutral"
                    :variant="chatOpen ? 'soft' : 'ghost'"
                    size="sm"
                    aria-label="Toggle chat"
                    @click="toggleChat"
                  />
                </UTooltip>
                <UDropdownMenu
                  :items="moreItems"
                  :content="{ align: 'end' }"
                >
                  <UButton
                    icon="i-lucide-ellipsis"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    aria-label="More"
                  />
                </UDropdownMenu>
              </template>
            </PaperNavbar>
          </template>

          <template #body>
            <div
              v-if="view === 'graph' && digest"
              class="flex h-full min-h-0 flex-col"
            >
              <GraphProofLens
                v-if="graphLayout === 'lens'"
                :nodes="digest.nodes"
                :selected-id="selectedId"
                :show-claims="showClaims"
                class="min-h-0 flex-1"
                @select="select"
              />
              <UAlert
                v-else-if="graphTooBig && graphMode === 'focus'"
                color="warning"
                variant="subtle"
                icon="i-lucide-gauge"
                :title="`${graphSize} statements: showing the selection's focus`"
                description="The whole-paper layout may be slow at this size."
                :actions="[{ label: 'Whole paper', color: 'warning', variant: 'outline', onClick: () => { graphMode = 'all' } }]"
                orientation="horizontal"
                class="m-2 w-auto shrink-0"
              />
              <GraphProofGraph
                v-if="graphLayout === 'map'"
                :nodes="digest.nodes"
                :selected-id="selectedId"
                :mode="graphMode"
                :show-claims="showClaims"
                :color-by="colorBy"
                :view-key="paperSlug"
                class="min-h-0 flex-1"
                @select="select"
              />
              <!-- Below lg the node card panel is hidden; a strip names the selection and opens it. -->
              <div
                v-if="node"
                class="flex shrink-0 items-center gap-2 border-t border-default px-4 py-2 lg:hidden"
              >
                <UIcon
                  :name="KIND_ICON[node.kind]"
                  class="size-4 shrink-0 text-muted"
                />
                <span class="min-w-0 flex-1 truncate text-sm font-medium text-highlighted">{{ node.name }}</span>
                <UButton
                  label="Open"
                  trailing-icon="i-lucide-arrow-right"
                  color="neutral"
                  variant="outline"
                  size="xs"
                  @click="view = 'tree'"
                />
              </div>
            </div>
            <!-- Paper view: the typeset paper (PDF.js), statements linked to nodes via SyncTeX. -->
            <div
              v-else-if="view === 'paper' && digest"
              class="flex h-full min-h-0 flex-col"
            >
              <ReaderPaperReader class="min-h-0 flex-1" />
              <div
                v-if="node"
                class="flex shrink-0 items-center gap-2 border-t border-default px-4 py-2 lg:hidden"
              >
                <UIcon
                  :name="KIND_ICON[node.kind]"
                  class="size-4 shrink-0 text-muted"
                />
                <span class="min-w-0 flex-1 truncate text-sm font-medium text-highlighted">{{ node.name }}</span>
                <UButton
                  label="Open"
                  trailing-icon="i-lucide-arrow-right"
                  color="neutral"
                  variant="outline"
                  size="xs"
                  @click="view = 'tree'"
                />
              </div>
            </div>
            <div
              v-else-if="node"
              class="mx-auto w-full max-w-3xl"
            >
              <NodePage :node="node" />
            </div>
          </template>
        </UDashboardPanel>
      </template>

      <!-- Graph and paper views: the selected node's compact card on the right (chat replaces it when opened). -->
      <template #side-node>
        <UDashboardPanel
          v-if="node"
          id="graph-node"
          :ui="{ body: 'sm:p-5' }"
        >
          <template #header>
            <UDashboardNavbar
              title="Selected node"
              :toggle="false"
            >
              <template #right>
                <UButton
                  label="Open full page"
                  trailing-icon="i-lucide-arrow-right"
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  @click="view = 'tree'"
                />
                <UTooltip text="Close (select a node to reopen)">
                  <UButton
                    icon="i-lucide-x"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    aria-label="Close node card"
                    @click="cardClosed = true"
                  />
                </UTooltip>
              </template>
            </UDashboardNavbar>
          </template>
          <template #body>
            <NodePage
              :node="node"
              compact
            />
          </template>
        </UDashboardPanel>
      </template>

      <template #side-chat>
        <UDashboardPanel id="chat">
          <template #header>
            <UDashboardNavbar
              title="Ask the paper"
              icon="i-lucide-message-square"
              :toggle="false"
            >
              <template #right>
                <UTooltip
                  v-if="chatMessages.length"
                  text="New conversation"
                >
                  <UButton
                    icon="i-lucide-rotate-ccw"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    aria-label="New conversation"
                    @click="clearChat"
                  />
                </UTooltip>
                <UButton
                  icon="i-lucide-x"
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  aria-label="Close chat"
                  @click="toggleChat"
                />
              </template>
            </UDashboardNavbar>
          </template>
          <template #body>
            <ChatPanel />
          </template>
        </UDashboardPanel>
      </template>
    </USplitter>

    <!-- Below xl the chat lives here instead of the panel (the panel unmounts once the width is known). -->
    <USlideover
      v-model:open="chatSlideover"
      title="Ask the paper"
      side="right"
    >
      <template #body>
        <ChatPanel />
      </template>
    </USlideover>
  </div>
</template>
