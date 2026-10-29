<script setup lang="ts">
const props = defineProps<{
  id: string
  /** Inferred (prose) dependency: dashed outline + tooltip. */
  inferred?: boolean
}>()

const { index } = useDigestContext()
const { linkTo } = useSelection()
const node = computed(() => index.value.byId.get(props.id))
</script>

<template>
  <UTooltip
    v-if="node"
    :text="inferred ? `${node.name} · inferred from prose, no \\ref` : node.name"
  >
    <UButton
      :to="linkTo(node.id)"
      size="xs"
      color="neutral"
      variant="outline"
      :class="['max-w-full', inferred && 'border-dashed ring-0 border border-default']"
      :data-node-chip="node.id"
    >
      <span class="font-mono text-[10px] uppercase text-dimmed">{{ KIND_SHORT[node.kind] }}</span>
      <span class="truncate">{{ node.name }}</span>
    </UButton>
  </UTooltip>
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
