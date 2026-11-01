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
  /** Tab label visibility; the explorer's panel is narrow, so it shows labels later. */
  labelClass?: string
}>(), { family: null, active: null, nodeId: undefined, crumbs: () => [], logo: false, labelClass: 'hidden md:inline' })

const route = useRoute()

const hideNarrow = { item: 'hidden md:flex', separator: 'hidden md:flex' }
const items = computed<BreadcrumbItem[]>(() => [
  { label: 'Papers', to: '/papers', ui: { ...hideNarrow, item: 'hidden md:flex shrink-0' } },
  // The family is context, not the destination: its title gets the least room.
  ...(props.family ? [{ label: `${props.family.code} · ${props.family.title}`, to: `/papers/${props.family.code}`, ui: { ...hideNarrow, linkLabel: 'truncate max-w-24 lg:max-w-36 2xl:max-w-48' } }] : []),
  // The paper crumb is the current page on the overview; elsewhere it leads back to it.
  { label: props.title, ...(props.active === 'overview' && !props.crumbs.length ? {} : { to: `/${props.slug}` }) },
  ...props.crumbs
])

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
    :ui="{ title: 'min-w-0', left: 'min-w-0', right: 'gap-1.5 shrink-0' }"
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
        :ui="{ root: 'min-w-0', list: 'min-w-0 flex-nowrap', item: 'min-w-0', link: 'min-w-0', linkLabel: 'truncate max-w-32 md:max-w-44 xl:max-w-56' }"
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
