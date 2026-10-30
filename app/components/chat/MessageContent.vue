<script setup lang="ts">
// One chat message, parts in order: assistant text through Comark (math + citation chips), user text plain with chips
// for `[[id]]`, and one compact muted row per tool call (spinner while running, error state, collapsible details).
// Reasoning is off (sendReasoning: false); step-start parts carry nothing to show.
import type { UIMessage } from 'ai'
import { getToolName, isTextUIPart, isToolUIPart } from 'ai'
import { isPartStreaming } from '@nuxt/ui/utils/ai'

const props = defineProps<{ message: UIMessage }>()

const chat = injectPaperChat()
// Only the last message of a turn in flight can have a running tool call.
const live = computed(() => !!chat && (chat.status.value === 'streaming' || chat.status.value === 'submitted')
  && chat.messages.value.at(-1)?.id === props.message.id)

type Block
  = | { kind: 'text', text: string, streaming: boolean }
    | { kind: 'tool', id: string, row: ToolRow }

// Adjacent text parts merge so a citation split across parts still parses; a tool call starts a new block.
const blocks = computed(() => {
  const out: Block[] = []
  for (const part of props.message.parts) {
    if (isTextUIPart(part)) {
      const prev = out[out.length - 1]
      if (prev?.kind === 'text') {
        prev.text += part.text
        prev.streaming = isPartStreaming(part)
      } else {
        out.push({ kind: 'text', text: part.text, streaming: isPartStreaming(part) })
      }
    } else if (isToolUIPart(part)) {
      out.push({ kind: 'tool', id: part.toolCallId, row: toolRow(getToolName(part), part, live.value) })
    }
  }
  return out.filter(b => b.kind === 'tool' || b.text.trim())
})
</script>

<template>
  <template
    v-for="(b, i) in blocks"
    :key="b.kind === 'tool' ? b.id : `${message.id}-${i}`"
  >
    <UChatTool
      v-if="b.kind === 'tool'"
      :text="b.row.text"
      :suffix="b.row.suffix"
      :icon="b.row.state === 'error' ? 'i-lucide-circle-alert' : b.row.state === 'stopped' ? 'i-lucide-circle-slash' : b.row.icon"
      :loading="b.row.state === 'running'"
      :streaming="b.row.state === 'running'"
      chevron="leading"
      :ui="{
        root: 'my-1',
        trigger: 'text-xs',
        leadingIcon: b.row.state === 'error' ? 'text-error' : '',
        body: 'pt-1 text-xs font-mono'
      }"
      :data-chat-tool="b.row.state"
    >
      <template v-if="b.row.details.length">
        <div
          v-for="(d, j) in b.row.details"
          :key="j"
          class="truncate"
        >
          {{ d }}
        </div>
      </template>
    </UChatTool>
    <ChatComark
      v-else-if="message.role === 'assistant'"
      :value="toChatMarkdown(b.text, b.streaming)"
      :streaming="b.streaming"
    />
    <p
      v-else
      class="whitespace-pre-wrap"
    >
      <template
        v-for="(run, j) in splitCitations(b.text)"
        :key="j"
      >
        <ChatNodeLink
          v-if="run.id"
          :id="run.id"
        />
        <template v-else>
          {{ run.text }}
        </template>
      </template>
    </p>
  </template>
</template>
