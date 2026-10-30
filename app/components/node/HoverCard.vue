<script setup lang="ts">
// Wraps any node reference (ref link, chip, chat citation, tree row) in the shared hover card. Hover or keyboard
// focus opens it after a short delay; the close delay lets the pointer move into the card, which is interactive.
// Touch: the first tap opens the card (the card's buttons navigate). Inside a card, refs render bare.
const props = withDefaults(defineProps<{
  id: string
  compact?: boolean
  /** Reached through an inferred edge. */
  inferred?: boolean
  openDelay?: number
  /** Open on tap (and swallow that tap). Off where a tap must keep navigating (tree rows). */
  touch?: boolean
  side?: 'top' | 'bottom' | 'left' | 'right'
  /** Class on the inline wrapper that anchors the card (e.g. 'inline-flex max-w-full' around a chip). */
  triggerClass?: string
}>(), { openDelay: 250, touch: true, side: 'top', triggerClass: undefined })

const ctx = injectDigest()
const nested = useInHoverCard()
const node = computed(() => ctx?.index.value.byId.get(props.id))
const open = ref(false)
const guard = useTouchTapGuard(() => props.touch)
</script>

<template>
  <slot v-if="nested || !node" />
  <UPopover
    v-else
    v-model:open="open"
    mode="hover"
    :open-delay="openDelay"
    :close-delay="150"
    :enable-touch="touch"
    :content="{ side, align: 'start', sideOffset: 6, collisionPadding: 12 }"
    :ui="{ content: compact ? 'w-[min(22rem,calc(100vw-2rem))]' : 'w-[min(30rem,calc(100vw-2rem))] max-h-[min(34rem,var(--reka-hover-card-content-available-height,70vh))] overflow-y-auto overscroll-contain' }"
  >
    <span
      :class="triggerClass"
      data-node-card-trigger
      @pointerdown.capture="guard.onPointerdown"
      @click.capture="guard.onClick"
    ><slot /></span>
    <template #content>
      <NodeHoverCardBody
        v-if="node"
        :node="node"
        :compact="compact"
        :inferred="inferred"
        @done="open = false"
      />
    </template>
  </UPopover>
</template>
