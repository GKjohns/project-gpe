<script setup lang="ts">
// One chat message: assistant text through Comark (math + citation chips), user text plain with chips for
// `[[id]]`. No tools or reasoning in this chat (single step, sendReasoning off), so text parts are all there is.
import type { UIMessage } from 'ai'
import { isTextUIPart } from 'ai'
import { isPartStreaming } from '@nuxt/ui/utils/ai'

const props = defineProps<{ message: UIMessage }>()

// Adjacent text parts merge so a citation split across parts still parses.
const texts = computed(() => {
  const out: { text: string, streaming: boolean }[] = []
  for (const part of props.message.parts) {
    if (!isTextUIPart(part)) {
      continue
    }
    const prev = out[out.length - 1]
    if (prev) {
      prev.text += part.text
      prev.streaming = isPartStreaming(part)
    } else {
      out.push({ text: part.text, streaming: isPartStreaming(part) })
    }
  }
  return out
})
</script>

<template>
  <template
    v-for="(t, i) in texts"
    :key="`${message.id}-${i}`"
  >
    <ChatComark
      v-if="message.role === 'assistant'"
      :value="toChatMarkdown(t.text, t.streaming)"
      :streaming="t.streaming"
    />
    <p
      v-else
      class="whitespace-pre-wrap"
    >
      <template
        v-for="(run, j) in splitCitations(t.text)"
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
