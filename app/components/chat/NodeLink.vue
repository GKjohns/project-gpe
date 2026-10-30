<script setup lang="ts">
// Inline citation chip for `[[node-id]]` in chat; selecting keeps the query, so it drives Node and Graph view alike.
const props = defineProps<{ id: string }>()

const ctx = injectDigest()
const chat = injectPaperChat()
const { select, selectedId } = useSelection()
const node = computed(() => ctx?.index.value.byId.get(props.id))

function open() {
  select(props.id)
  chat?.onCite()
}
</script>

<template>
  <NodeHoverCard
    v-if="node"
    :id="node.id"
    side="left"
    trigger-class="inline-flex max-w-full align-middle"
  >
    <UButton
      size="xs"
      color="neutral"
      :variant="selectedId === node.id ? 'soft' : 'outline'"
      class="mx-0.5 inline-flex max-w-full align-middle"
      :data-node-link="node.id"
      @click="open"
    >
      <span class="font-mono text-[10px] text-dimmed uppercase">{{ KIND_SHORT[node.kind] }}</span>
      <span class="truncate">{{ node.name }}</span>
    </UButton>
  </NodeHoverCard>
  <!-- An id the digest doesn't have: shown raw and muted, never clickable. -->
  <UBadge
    v-else
    color="neutral"
    variant="soft"
    size="sm"
    class="mx-0.5 align-middle font-mono text-dimmed"
    :data-node-link-unknown="id"
  >
    {{ id }}
  </UBadge>
</template>
