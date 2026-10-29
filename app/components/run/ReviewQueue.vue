<script setup lang="ts">
import type { RunResponse } from '#shared/runs'

const props = defineProps<{ runId: string, items: RunResponse['reviewItems'] }>()
const emit = defineEmits<{ decided: [] }>()
const toast = useToast()

const KIND: Record<string, string> = {
  add_edge: 'Add an edge',
  remove_edge: 'Remove an inferred edge',
  merge: 'Merge claims',
  split: 'Split a claim',
  drop: 'Drop a claim',
  reparent: 'Move a claim'
}

// What the fix would do, in words, from its target list.
function summary(item: RunResponse['reviewItems'][number]) {
  const t = item.payload.target
  switch (item.payload.kind) {
    case 'add_edge': return `${t[0]} would use ${t[1]}`
    case 'remove_edge': return `${t[0]} would no longer use ${t[1]}`
    case 'merge': return `${t.slice(1).join(', ')} fold into ${t[0]}`
    case 'split': return `${t[0]} is split (recorded as friction; re-run the outline to apply)`
    case 'drop': return `${t[0]} is removed; its dependencies pass to its users`
    case 'reparent': return `${t[0]} moves under ${t[1]}`
    default: return t.join(', ')
  }
}

const busy = ref<string | null>(null)
async function decide(itemId: string, decision: 'accept' | 'reject') {
  busy.value = itemId + decision
  try {
    await $fetch(`/api/runs/${props.runId}/review`, { method: 'POST', body: { itemId, decision } })
    emit('decided')
  } catch (err) {
    toast.add({ title: 'Could not record the decision', description: (err as { statusMessage?: string }).statusMessage, color: 'error' })
  } finally {
    busy.value = null
  }
}
</script>

<template>
  <UCard
    :ui="{ header: 'py-3', body: 'p-0 sm:p-0' }"
    class="ring-warning/40"
  >
    <template #header>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <UIcon
            name="i-lucide-hand"
            class="size-4 text-warning"
          />
          <span class="text-sm font-medium text-highlighted">Review · {{ items.length }} {{ items.length === 1 ? 'fix needs' : 'fixes need' }} a decision</span>
        </div>
        <span class="text-xs text-muted">Below 85% confidence the critique asks first. The run resumes after the last decision.</span>
      </div>
    </template>

    <ul class="divide-y divide-default">
      <li
        v-for="item in items"
        :key="item.id"
        class="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5"
      >
        <div class="min-w-0 space-y-2">
          <div class="flex flex-wrap items-center gap-2">
            <UBadge
              :label="KIND[item.payload.kind] ?? item.payload.kind"
              color="warning"
              variant="subtle"
            />
            <span class="text-xs text-muted tabular-nums">confidence {{ Math.round(item.payload.confidence * 100) }}%</span>
          </div>
          <p class="text-sm font-medium text-highlighted">
            {{ summary(item) }}
          </p>
          <p class="text-sm text-toned">
            {{ item.payload.note }}
          </p>
          <ul
            v-if="item.payload.nodes?.length"
            class="space-y-1 text-xs text-muted"
          >
            <li
              v-for="n in item.payload.nodes"
              :key="n.id"
              class="flex flex-wrap gap-x-2"
            >
              <code class="text-default">{{ n.id }}</code>
              <span>{{ n.kind }} · {{ n.name }}</span>
              <span class="text-dimmed">{{ n.ref }}</span>
            </li>
          </ul>
        </div>
        <div class="flex shrink-0 gap-2">
          <UButton
            label="Accept"
            icon="i-lucide-check"
            color="primary"
            :loading="busy === item.id + 'accept'"
            :disabled="!!busy"
            @click="decide(item.id, 'accept')"
          />
          <UButton
            label="Reject"
            icon="i-lucide-x"
            color="neutral"
            variant="outline"
            :loading="busy === item.id + 'reject'"
            :disabled="!!busy"
            @click="decide(item.id, 'reject')"
          />
        </div>
      </li>
    </ul>
  </UCard>
</template>
