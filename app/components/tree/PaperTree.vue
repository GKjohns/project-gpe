<script setup lang="ts">
import type { TreeItem } from '@nuxt/ui'
import type { PaperSection, ProofNode } from '#shared/types'

interface PaperTreeItem extends TreeItem {
  value: string
  section?: PaperSection
  node?: ProofNode
  count?: number
  children?: PaperTreeItem[]
}

const { digest, index } = useDigestContext()
const { selectedId, select } = useSelection()

const secKey = (id: string) => `sec:${id}`

// Level-1 sections always show; a level-2 subsection shows only when it holds statements itself;
// everything else folds into its nearest shown ancestor. Sections with nothing in them are hidden.
const model = computed(() => {
  const d = digest.value
  const items: PaperTreeItem[] = []
  const parentKeyOf: Record<string, string | undefined> = {}
  if (!d) {
    return { items, parentKeyOf }
  }
  const { sectionById, children } = index.value
  const statements = d.nodes.filter(n => !n.parent_id)
  const direct = new Map<string, ProofNode[]>()
  for (const n of statements) {
    const list = direct.get(n.paper_ref.section) ?? []
    list.push(n)
    direct.set(n.paper_ref.section, list)
  }
  const shown = (s: PaperSection) => s.level === 1 || !s.parent_id || (s.level === 2 && (direct.get(s.id)?.length ?? 0) > 0)
  const shownAncestor = (s: PaperSection | undefined): PaperSection | undefined => {
    let cur = s
    while (cur && !shown(cur)) {
      cur = cur.parent_id ? sectionById.get(cur.parent_id) : undefined
    }
    return cur
  }

  const sections = [...d.sections].sort((a, b) => a.order - b.order)
  const secItems = new Map<string, PaperTreeItem>()
  for (const s of sections.filter(shown)) {
    secItems.set(s.id, { value: secKey(s.id), label: sectionLabel(s.id, s.title), section: s, children: [], count: 0 })
  }
  // Nest shown subsections under their shown parent.
  for (const s of sections.filter(shown)) {
    const item = secItems.get(s.id)!
    const parent = s.parent_id ? shownAncestor(sectionById.get(s.parent_id)) : undefined
    if (parent && secItems.has(parent.id)) {
      secItems.get(parent.id)!.children!.push(item)
      parentKeyOf[item.value] = secKey(parent.id)
    } else {
      items.push(item)
    }
  }
  const sorted = [...statements].sort((a, b) => a.paper_ref.file === b.paper_ref.file ? a.paper_ref.line - b.paper_ref.line : 0)
  for (const n of sorted) {
    const home = shownAncestor(sectionById.get(n.paper_ref.section))
    const secItem = home ? secItems.get(home.id) : undefined
    const claimItems: PaperTreeItem[] = (children[n.id] ?? []).map(c => ({ value: c.id, label: c.name, node: c }))
    const item: PaperTreeItem = { value: n.id, label: n.name, node: n, children: claimItems.length ? claimItems : undefined }
    for (const c of claimItems) {
      parentKeyOf[c.value] = n.id
    }
    if (secItem) {
      secItem.children!.push(item)
      parentKeyOf[n.id] = secItem.value
    } else {
      items.push(item)
    }
  }
  // Counts include subsections; empty sections drop out.
  const count = (it: PaperTreeItem): number => (it.children ?? []).reduce((sum, c) => sum + (c.section ? count(c) : 1 + (c.children?.length ?? 0)), 0)
  const prune = (list: PaperTreeItem[]): PaperTreeItem[] => list.filter((it) => {
    if (!it.section) {
      return true
    }
    it.children = prune(it.children ?? [])
    it.count = count(it)
    return it.count > 0
  })
  return { items: prune(items), parentKeyOf }
})

const itemByKey = computed(() => {
  const map = new Map<string, PaperTreeItem>()
  const walk = (list: PaperTreeItem[]) => list.forEach((it) => {
    map.set(it.value, it)
    walk(it.children ?? [])
  })
  walk(model.value.items)
  return map
})

const selectedItem = computed(() => itemByKey.value.get(selectedId.value))

const expanded = ref<string[]>([])

function ancestorsOf(key: string) {
  const out: string[] = []
  let cur = model.value.parentKeyOf[key]
  while (cur) {
    out.push(cur)
    cur = model.value.parentKeyOf[cur]
  }
  return out
}

// Reveal the selection (and its claims) on every route change; the first section opens by default.
watch([selectedId, model], ([id], [prevId]) => {
  const add = new Set(expanded.value)
  if (!prevId) {
    const first = model.value.items[0]
    if (first?.section) {
      add.add(first.value)
    }
  }
  for (const k of ancestorsOf(id)) {
    add.add(k)
  }
  if (itemByKey.value.get(id)?.children?.length) {
    add.add(id)
  }
  expanded.value = [...add]
}, { immediate: true })

function expandAll(open: boolean) {
  expanded.value = open ? [...itemByKey.value.values()].filter(it => it.children?.length).map(it => it.value) : []
}

defineExpose({ expandAll })

function onSelect(e: { preventDefault: () => void }, item: PaperTreeItem) {
  // Sections only toggle; statements and claims navigate.
  if (!item.node) {
    e.preventDefault()
    return
  }
  select(item.node.id)
}

function onToggle(e: { preventDefault: () => void, detail: { originalEvent: Event } }, item: PaperTreeItem) {
  // Clicking an unselected statement selects it (the watcher expands it); only a second click collapses.
  if (item.node && item.node.id !== selectedId.value && e.detail.originalEvent.type === 'click') {
    e.preventDefault()
  }
}

// Keep the selected row in view when the route changes (deep links into long papers).
const root = useTemplateRef<HTMLElement>('root')
watch(selectedId, async () => {
  await nextTick()
  root.value?.querySelector('[data-selected]')?.scrollIntoView({ block: 'nearest' })
})
</script>

<template>
  <div ref="root">
    <UTree
      v-model:expanded="expanded"
      :items="model.items"
      :model-value="selectedItem"
      :get-key="(i: PaperTreeItem) => i.value"
      size="sm"
      color="primary"
      :ui="{ linkLabel: 'truncate' }"
      @select="onSelect"
      @toggle="onToggle"
    >
      <template #item-leading="{ item }">
        <UIcon
          v-if="item.node"
          :name="KIND_ICON[item.node.kind]"
          class="size-3.5 shrink-0"
          :class="item.node.kind === 'claim' ? 'text-dimmed' : item.node.kind === 'theorem' || item.node.kind === 'corollary' ? 'text-primary' : 'text-muted'"
        />
        <UIcon
          v-else
          name="i-lucide-hash"
          class="size-3.5 shrink-0 text-dimmed"
        />
      </template>
      <template #item-label="{ item }">
        <!-- Light card after a longer delay, so sweeping the pointer down the tree doesn't flash cards.
             No tap-to-open: a tap on a row must keep selecting it. -->
        <NodeHoverCard
          v-if="item.node"
          :id="item.node.id"
          compact
          :open-delay="700"
          :touch="false"
          side="right"
          trigger-class="block min-w-0 truncate"
        >
          <span :class="item.node.kind === 'claim' && 'text-muted'">{{ item.label }}</span>
        </NodeHoverCard>
        <span
          v-else
          class="font-medium"
          :title="item.label"
        >{{ item.label }}</span>
      </template>
      <template #item-trailing="{ item, ui }">
        <span
          v-if="item.section"
          class="text-xs text-dimmed tabular-nums"
        >{{ item.count }}</span>
        <UBadge
          v-if="item.node?.classification === 'novel'"
          size="sm"
          color="primary"
          variant="soft"
          label="novel"
          class="px-1 py-0 text-[10px]"
        />
        <span
          v-if="item.node && maxSeverity(item.node)"
          class="size-1.5 shrink-0 rounded-full"
          :class="{ 'bg-error': maxSeverity(item.node) === 'high', 'bg-warning': maxSeverity(item.node) === 'warn', 'bg-info': maxSeverity(item.node) === 'info' }"
          :title="`${item.node.friction.length} friction`"
        />
        <UIcon
          v-if="item.children?.length"
          name="i-lucide-chevron-down"
          :class="ui.linkTrailingIcon()"
        />
      </template>
    </UTree>
  </div>
</template>
