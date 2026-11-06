<script setup lang="ts">
// The paper's top bar on the overview, the explorer and the friction page: Papers › family › paper › extra crumbs,
// and the Overview · Tree · Graph · Paper switcher. Tree/Graph/Paper are the explorer's ?view values (tree = none),
// so old deep links keep working.
import type { BreadcrumbItem, TabsItem } from '@nuxt/ui'

export type PaperTab = 'overview' | 'tree' | 'graph' | 'paper'

const props = withDefaults(defineProps<{
  slug: string
  title: string
  family?: { code: string, title: string } | null
  /** The highlighted tab; none on pages outside the switcher (friction). */
  active?: PaperTab | null
  /** Where Tree/Graph/Paper land: the selected node, else the main theorem. */
  nodeId?: string
  crumbs?: BreadcrumbItem[]
  /** Logo in the leading slot (pages with no sidebar). */
  logo?: boolean
  /** Tab label visibility, as a container query on the bar (`/nav`): the explorer's bar carries more buttons. */
  labelClass?: string
}>(), { family: null, active: null, nodeId: undefined, crumbs: () => [], logo: false, labelClass: 'hidden @min-[41rem]/nav:inline' })

const route = useRoute()

// The bar's width depends on the sidebar and the right panel, not the viewport, so crumbs answer to container queries
// on the crumb area (`/crumbs`, whatever the tabs and buttons leave). What yields first as it narrows:
// family → extra context (a node's parent) → Papers → paper. The current crumb stays until only a stub would fit,
// then the tabs have the bar to themselves (the page under it names the same thing).
const showFrom = (cls: string) => ({ item: cls, separator: cls })
const FAMILY = showFrom('hidden @min-[48rem]/crumbs:flex')
const CONTEXT = showFrom('hidden @min-[40rem]/crumbs:flex')
const ROOT = showFrom('hidden @min-[32rem]/crumbs:flex shrink-0')
const PAPER = showFrom('hidden @min-[22rem]/crumbs:flex')
const CURRENT = showFrom('hidden @min-[7rem]/crumbs:flex')

const items = computed<BreadcrumbItem[]>(() => {
  const list: BreadcrumbItem[] = [
    { label: 'Papers', to: '/papers', ui: ROOT },
    ...(props.family ? [{ label: `${props.family.code} · ${props.family.title}`, to: `/papers/${props.family.code}`, ui: { ...FAMILY, linkLabel: 'max-w-48' } }] : []),
    // The paper crumb is the current page on the overview; elsewhere it leads back to it.
    { label: props.title, ...(props.active === 'overview' && !props.crumbs.length ? {} : { to: `/${props.slug}` }), ui: { ...PAPER, linkLabel: 'max-w-56' } },
    ...props.crumbs.map(c => ({ ...c, ui: { ...CONTEXT, linkLabel: 'max-w-48', ...c.ui } }))
  ]
  const last = list.length - 1
  list[last] = { ...list[last], ui: { ...list[last]!.ui, ...CURRENT, linkLabel: undefined } }
  return list
})

const tabs: TabsItem[] = [
  { label: 'Overview', value: 'overview', icon: 'i-lucide-layout-panel-top' },
  { label: 'Tree', value: 'tree', icon: 'i-lucide-list-tree' },
  { label: 'Graph', value: 'graph', icon: 'i-lucide-git-fork' },
  { label: 'Paper', value: 'paper', icon: 'i-lucide-book-open-text' }
]

const tab = computed({
  get: () => props.active ?? undefined,
  set: (v: string | number | undefined) => {
    if (v === 'overview') {
      navigateTo(`/${props.slug}`)
      return
    }
    const path = `/${props.slug}/${props.nodeId ?? ''}`
    // Same explorer page: swap the view in place (no history entry), keeping the graph options in the query.
    const same = route.path === path
    const query = { ...(same ? route.query : {}), view: v === 'tree' ? undefined : String(v) }
    navigateTo({ path, query }, { replace: same })
  }
})
</script>

<template>
  <UDashboardNavbar
    :as="{ root: 'div', title: 'div' }"
    :toggle="!logo"
    :ui="{ root: '@container/nav', title: 'min-w-0 flex-1', left: 'min-w-0 flex-1', right: 'gap-1.5 shrink-0' }"
  >
    <template
      v-if="logo"
      #leading
    >
      <NuxtLink
        to="/"
        class="me-1 shrink-0"
        aria-label="Home"
      >
        <AppLogo />
      </NuxtLink>
    </template>
    <template #title>
      <UBreadcrumb
        :items="items"
        :ui="{ root: '@container/crumbs min-w-0 flex-1', list: 'min-w-0 flex-nowrap', item: 'min-w-0', link: 'min-w-0', linkLabel: 'truncate' }"
      />
    </template>
    <template #right>
      <slot name="right-start" />
      <UTabs
        v-model="tab"
        :items="tabs"
        :content="false"
        size="xs"
        color="neutral"
        :ui="{ label: labelClass }"
        data-paper-tabs
      />
      <slot name="right" />
    </template>
  </UDashboardNavbar>
</template>
