<script setup lang="ts">
// Comark's `math` node, rendered with the paper's macros (Comark's own Math component has none).
const props = defineProps<{ content: string, class?: string }>()

const ctx = injectDigest()
const inline = computed(() => props.class?.includes('inline') ?? true)
const html = computed(() => renderTex(texWithRefs(props.content, ctx?.digest.value), !inline.value, ctx?.digest.value?.macros))
</script>

<template>
  <!-- eslint-disable vue/no-v-html -->
  <span
    v-if="inline"
    data-math-text
    v-html="html"
  />
  <div
    v-else
    data-math-text
    v-html="html"
  />
  <!-- eslint-enable vue/no-v-html -->
</template>
