<script setup lang="ts">
import type { RunEvent } from '#shared/runs'

const props = defineProps<{ events: RunEvent[], live?: boolean }>()

const scroller = useTemplateRef('scroller')
const time = (ts: string) => new Date(ts).toLocaleTimeString([], { hour12: false })

// Follow the tail unless the reader has scrolled up.
watch(() => props.events.length, async () => {
  const el = scroller.value
  if (!el) {
    return
  }
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48
  await nextTick()
  if (atBottom) {
    el.scrollTop = el.scrollHeight
  }
})
onMounted(() => {
  if (scroller.value) {
    scroller.value.scrollTop = scroller.value.scrollHeight
  }
})
</script>

<template>
  <div
    ref="scroller"
    class="max-h-[28rem] overflow-y-auto font-mono text-xs leading-relaxed"
  >
    <p
      v-if="!events.length"
      class="text-muted"
    >
      Waiting for the first event…
    </p>
    <div
      v-for="e in events"
      :key="e.id"
      class="flex gap-3 py-0.5"
      :class="e.level === 'error' ? 'text-error' : e.level === 'warn' ? 'text-warning' : 'text-default'"
    >
      <span class="shrink-0 text-dimmed tabular-nums">{{ time(e.ts) }}</span>
      <!-- Method B trace lines (data.trace): the agent's own tool calls, set off from pipeline events. -->
      <span
        v-if="e.data?.trace"
        class="min-w-0 break-words"
        :class="e.level === 'info' ? 'text-muted' : ''"
      ><UIcon
        name="i-lucide-terminal"
        class="mr-1 size-3 align-[-1px] text-primary"
      />{{ e.message }}</span>
      <span
        v-else
        class="min-w-0 break-words"
      >{{ e.message }}</span>
    </div>
    <div
      v-if="live"
      class="flex items-center gap-2 py-0.5 text-muted"
    >
      <UIcon
        name="i-lucide-loader-circle"
        class="size-3 animate-spin"
      />
      <span>live</span>
    </div>
  </div>
</template>
