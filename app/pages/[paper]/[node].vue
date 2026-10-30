<script setup lang="ts">
import { breakpointsTailwind, useBreakpoints, useClipboard } from '@vueuse/core'
import type { BreadcrumbItem, CommandPaletteGroup, CommandPaletteItem, TabsItem } from '@nuxt/ui'
import type { PaperListItem } from '#shared/api'
import type { GraphColorBy, GraphMode } from '~/utils/graph'

// Keyed by paper so moving between nodes keeps the sidebar, tree state and panel sizes mounted.
definePageMeta({ layout: 'dashboard', key: route => String(route.params.paper) })

const route = useRoute()
const toast = useToast()
const { paperSlug, selectedId, select, setQuery } = useSelection()

const { paper, digest, index, error, ready } = useDigest(paperSlug)
provideDigest({ paper, digest, index })
await ready

if (error.value) {
  throw createError({ statusCode: error.value.statusCode ?? 404, statusMessage: error.value.statusMessage ?? 'Paper not found', fatal: true })
}
if (paper.value && !digest.value) {
  // Not digested yet: the run page is the only useful view.
  await navigateTo(`/papers/${paperSlug.value}/run`, { replace: true })
}

const node = computed(() => index.value.byId.get(selectedId.value))
const section = computed(() => index.value.sectionOf[selectedId.value])

useSeoMeta({ title: () => node.value ? `${node.value.name} · ${digest.value?.title}` : (digest.value?.title ?? 'Paper') })

// --- paper switcher -------------------------------------------------------
const { data: library } = await useFetch<PaperListItem[]>('/api/papers', { key: 'papers', default: () => [] })
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
const breadcrumb = computed<BreadcrumbItem[]>(() => {
  const n = node.value
  // On narrow screens only the node name shows; the rest is in the sidebar.
  const hideNarrow = { item: 'hidden md:flex', separator: 'hidden md:flex' }
  const items: BreadcrumbItem[] = [{ label: digest.value?.title ?? paperSlug.value, icon: 'i-lucide-book-open', to: `/${paperSlug.value}`, ui: hideNarrow }]
  if (section.value) {
    items.push({ label: sectionLabel(section.value.id, section.value.title), ui: hideNarrow })
  }
  if (n?.parent_id) {
    const parent = index.value.byId.get(n.parent_id)
    if (parent) {
      items.push({ label: parent.name, to: `/${paperSlug.value}/${parent.id}`, ui: hideNarrow })
    }
  }
  if (n) {
    items.push({ label: n.name })
  }
  return items
})

const viewTabs: TabsItem[] = [
  { label: 'Paper', value: 'paper', icon: 'i-lucide-book-open-text' },
  { label: 'Node', value: 'tree', icon: 'i-lucide-file-text' },
  { label: 'Graph', value: 'graph', icon: 'i-lucide-git-fork' }
]
// `/[paper]` lands on ?view=paper (the reader); a bare node link stays the node page so old deep links keep working.
const view = computed({
  get: () => route.query.view === 'graph' ? 'graph' : route.query.view === 'paper' ? 'paper' : 'tree',
  set: (v: string | number) => setQuery('view', v === 'graph' || v === 'paper' ? String(v) : undefined)
})

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

// The tree collapses to its icon rail while the graph is up; the user can still expand it.
// Starts false so the sidebar syncs this ref to its cookie; on mount the view decides (a graph deep link
// renders the tree expanded on the server and collapses on hydration).
const sidebarCollapsed = ref(false)
watch(view, (v) => {
  sidebarCollapsed.value = v === 'graph'
})
onMounted(() => {
  sidebarCollapsed.value = view.value === 'graph'
})

const { copy } = useClipboard({ legacy: true })
async function share() {
  const url = `${window.location.origin}${route.fullPath}`
  await copy(url)
  toast.add({ title: 'Link copied', description: url, icon: 'i-lucide-link', color: 'success' })
}

// --- chat panel (Sprint 7 fills it) -----------------------------------------
// null = automatic: inline at xl and up (pure CSS, so SSR matches), hidden below. A click makes it explicit;
// below xl an explicit open shows a slideover instead.
const breakpoints = useBreakpoints(breakpointsTailwind)
const isXl = breakpoints.greaterOrEqual('xl')
const mounted = ref(false)
onMounted(() => {
  mounted.value = true
})
const chatPref = ref<boolean | null>(null)
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
function clearChat() {
  chat.stop()
  chatMessages.value = []
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
      v-model:collapsed="sidebarCollapsed"
      resizable
      collapsible
      :collapsed-size="4"
      :default-size="20"
      :min-size="15"
      :max-size="32"
      :ui="{ body: 'gap-2 px-2', footer: 'border-t border-default' }"
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
        <UIcon
          v-else
          name="i-lucide-book-open"
          class="mx-auto size-5 text-muted"
        />
      </template>

      <template #default="{ collapsed }">
        <UTooltip
          v-if="collapsed"
          text="Show the tree"
        >
          <UButton
            icon="i-lucide-panel-left-open"
            color="neutral"
            variant="ghost"
            square
            class="mx-auto"
            aria-label="Expand sidebar"
            @click="sidebarCollapsed = false"
          />
        </UTooltip>
        <div class="flex items-center gap-1">
          <UDashboardSearchButton
            :collapsed="collapsed"
            label="Find a node…"
            class="flex-1"
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
          <span :class="counts.friction ? 'text-warning' : ''">{{ counts.friction }} friction</span>
        </div>
      </template>
    </UDashboardSidebar>

    <UDashboardSearch
      :groups="searchGroups"
      :fuse="searchFuse"
      :color-mode="false"
      placeholder="Search nodes by name, label or id…"
    />

    <UDashboardPanel
      id="node"
      :ui="{ body: view !== 'tree' ? 'p-0 sm:p-0 gap-0 sm:gap-0 overflow-hidden' : 'lg:py-8' }"
    >
      <template #header>
        <UDashboardNavbar
          :as="{ root: 'div', title: 'div' }"
          :ui="{ title: 'min-w-0', left: 'min-w-0', right: 'gap-1.5' }"
        >
          <template #title>
            <UBreadcrumb
              :items="breadcrumb"
              :ui="{ root: 'min-w-0', list: 'min-w-0', item: 'min-w-0', linkLabel: 'truncate max-w-48 md:max-w-64' }"
            />
          </template>
          <template #right>
            <UTooltip
              v-if="counts.friction"
              text="Friction report"
            >
              <UButton
                :to="`/${paperSlug}/friction`"
                icon="i-lucide-triangle-alert"
                color="warning"
                variant="ghost"
                size="sm"
                :label="String(counts.friction)"
                aria-label="Friction report"
              />
            </UTooltip>
            <UTabs
              v-model="view"
              :items="viewTabs"
              :content="false"
              size="xs"
              color="neutral"
              :ui="{ label: 'hidden sm:inline' }"
            />
            <UTooltip text="Copy link to this node">
              <UButton
                icon="i-lucide-link"
                color="neutral"
                variant="ghost"
                size="sm"
                aria-label="Share"
                @click="share"
              >
                <span class="hidden sm:inline">Share</span>
              </UButton>
            </UTooltip>
            <UButton
              icon="i-lucide-message-square"
              color="neutral"
              :variant="chatOpen ? 'soft' : 'ghost'"
              size="sm"
              aria-label="Toggle chat"
              @click="toggleChat"
            >
              <span class="hidden sm:inline">Chat</span>
            </UButton>
          </template>
        </UDashboardNavbar>
        <!-- Graph controls get their own row so they can wrap on narrow screens. -->
        <UDashboardToolbar
          v-if="view === 'graph'"
          :ui="{ root: 'flex-wrap overflow-visible py-1.5 gap-y-1.5', left: 'flex-wrap gap-x-3 gap-y-1.5', right: 'ms-auto' }"
        >
          <template #left>
            <UTabs
              v-model="graphMode"
              :items="modeTabs"
              :content="false"
              size="xs"
              color="neutral"
            />
            <UCheckbox
              v-model="showClaims"
              label="claims"
              size="sm"
            />
            <UTabs
              v-model="colorBy"
              :items="colorTabs"
              :content="false"
              size="xs"
              color="neutral"
            />
          </template>
        </UDashboardToolbar>
      </template>

      <template #body>
        <div
          v-if="view === 'graph' && digest"
          class="flex h-full min-h-0 flex-col"
        >
          <UAlert
            v-if="graphTooBig && graphMode === 'focus'"
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

    <!-- Graph and paper views: the selected node's compact card on the right (chat replaces it when opened). -->
    <UDashboardPanel
      v-if="view !== 'tree' && node && !(chatPref === true && mounted && isXl)"
      id="graph-node"
      :ui="{ root: 'hidden lg:flex', handle: 'hidden lg:block', body: 'sm:p-5' }"
      resizable
      :default-size="22"
      :min-size="16"
      :max-size="36"
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

    <UDashboardPanel
      v-if="(view !== 'tree' ? chatPref === true : chatPref !== false) && !(mounted && !isXl)"
      id="chat"
      :ui="{ root: 'hidden xl:flex', handle: 'hidden xl:block' }"
      resizable
      :default-size="24"
      :min-size="18"
      :max-size="36"
    >
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
