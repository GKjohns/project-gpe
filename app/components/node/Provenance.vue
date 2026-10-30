<script setup lang="ts">
// Where something lives in the paper's source: shared by the node hover card and the equation popover.
defineProps<{
  section?: string
  page?: number
  file: string
  /** "73" or "18–29". */
  lines: string | number
  label?: string
  /** How it entered the map (nodes only). */
  origin?: string
  url?: string
  /** One line, no origin: the tree's light card. */
  compact?: boolean
}>()
</script>

<template>
  <div
    v-if="compact"
    class="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted"
    data-provenance
  >
    <span v-if="section">{{ section }}</span>
    <template v-if="page">
      <span class="text-dimmed">·</span>
      <span>p. {{ page }}</span>
    </template>
    <span class="text-dimmed">·</span>
    <code class="truncate text-[11px]">{{ file }}:{{ lines }}</code>
  </div>
  <dl
    v-else
    class="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1 text-xs"
    data-provenance
  >
    <template v-if="section">
      <dt class="text-dimmed">
        Section
      </dt>
      <dd class="text-default">
        {{ section }}<template v-if="page">
          <span class="text-dimmed"> · </span>p. {{ page }}
        </template>
      </dd>
    </template>
    <dt class="text-dimmed">
      Source
    </dt>
    <dd class="flex min-w-0 flex-wrap items-baseline gap-x-2">
      <code class="truncate text-[11px] text-default">{{ file }}:{{ lines }}</code>
      <ULink
        v-if="url"
        :to="url"
        target="_blank"
        class="inline-flex items-center gap-1 text-primary"
        data-open-source
      >
        Open in source
        <UIcon
          name="i-lucide-external-link"
          class="size-3"
        />
      </ULink>
    </dd>
    <template v-if="label">
      <dt class="text-dimmed">
        Label
      </dt>
      <dd class="min-w-0">
        <code class="truncate text-[11px] text-default">{{ label }}</code>
      </dd>
    </template>
    <template v-if="origin">
      <dt class="text-dimmed">
        Origin
      </dt>
      <dd class="text-muted">
        {{ origin }}<slot name="origin" />
      </dd>
    </template>
  </dl>
</template>
