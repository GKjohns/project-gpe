<script setup lang="ts">
const props = defineProps<{
  id: string
  /** Inferred (prose) dependency: dashed outline; the hover card says so. */
  inferred?: boolean
}>()

const { index } = useDigestContext()
const { linkTo } = useSelection()
const node = computed(() => index.value.byId.get(props.id))
</script>

<template>
  <NodeHoverCard
    v-if="node"
    :id="node.id"
    :inferred="inferred"
    trigger-class="inline-flex max-w-full"
  >
    <UButton
      :to="linkTo(node.id)"
      size="xs"
      color="neutral"
      variant="outline"
      :class="['max-w-full', inferred && 'border-dashed ring-0 border border-default']"
      :data-node-chip="node.id"
      :aria-label="`${node.name}${inferred ? ' (inferred dependency)' : ''}`"
    >
      <span class="font-mono text-[10px] uppercase text-dimmed">{{ KIND_SHORT[node.kind] }}</span>
      <span class="truncate">{{ node.name }}</span>
    </UButton>
  </NodeHoverCard>
  <UBadge
    v-else
    color="neutral"
    variant="soft"
    size="sm"
    class="font-mono text-muted"
  >
    {{ id }}
  </UBadge>
</template>
