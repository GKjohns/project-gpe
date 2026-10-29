<script setup lang="ts">
// "Ask the paper": the page's conversation (createPaperChat) rendered with Nuxt UI's chat components.
import type { UIMessage } from 'ai'
import { useClipboard } from '@vueuse/core'

const chat = injectPaperChat()
if (!chat) {
  throw new Error('ChatPanel needs a providePaperChat() ancestor')
}
const { messages, status, error, input, sendMessage, stop, regenerate } = chat

const SUGGESTIONS = [
  'What does the main theorem say, and what are the main steps of its proof?',
  'Where does the main bound\'s exponent come from?',
  'Which results here are novel, and which are standard tools?'
]

// UChatPrompt renders error.message verbatim; give it the calm sentence, never the raw response body.
const promptError = computed(() => error.value ? new Error(chatErrorMessage(error.value)) : undefined)

const busy = computed(() => status.value === 'submitted' || status.value === 'streaming')

const { copy } = useClipboard({ legacy: true })
// Under each answer: copy, and regenerate (also the way back after Stop, when the submit button is plain Send again).
const assistantActions = computed(() => busy.value
  ? []
  : [
      { label: 'Copy', icon: 'i-lucide-copy', onClick: (_: MouseEvent, m: UIMessage) => copy(m.parts.map(p => p.type === 'text' ? p.text : '').join('')) },
      { label: 'Regenerate', icon: 'i-lucide-rotate-cw', onClick: (_: MouseEvent, m: UIMessage) => regenerate({ messageId: m.id }) }
    ])

function send(text: string) {
  const t = text.trim()
  if (!t || busy.value) {
    return
  }
  sendMessage({ text: t })
  input.value = ''
}
</script>

<template>
  <div class="flex min-h-full flex-col gap-4">
    <UEmpty
      v-if="!messages.length"
      icon="i-lucide-messages-square"
      title="Ask about the proof"
      description="Answers come from this paper's digest and cite nodes as chips that open them."
      variant="naked"
      class="flex-1"
    >
      <template #actions>
        <div class="flex w-full flex-col gap-2">
          <UButton
            v-for="q in SUGGESTIONS"
            :key="q"
            :label="q"
            color="neutral"
            variant="outline"
            size="sm"
            block
            class="justify-start text-left"
            :ui="{ label: 'whitespace-normal' }"
            data-suggestion
            @click="send(q)"
          />
        </div>
      </template>
    </UEmpty>

    <UChatMessages
      v-else
      :messages="messages"
      :status="status"
      should-auto-scroll
      :user="{ ui: { content: 'text-sm' } }"
      :assistant="{ ui: { content: 'text-sm' }, actions: assistantActions }"
      class="flex-1"
    >
      <template #indicator>
        <UChatShimmer
          text="Reading the digest…"
          class="text-sm"
        />
      </template>
      <template #content="{ message }">
        <ChatMessageContent :message="message" />
      </template>
    </UChatMessages>

    <UChatPrompt
      v-model="input"
      :error="promptError"
      placeholder="Ask about this paper…"
      variant="subtle"
      :rows="1"
      class="sticky bottom-0 z-10"
      @submit="send(input)"
    >
      <template #footer>
        <span class="text-xs text-dimmed">Answers come only from the digest</span>
        <UChatPromptSubmit
          :status="status"
          color="neutral"
          size="sm"
          @stop="stop()"
          @reload="regenerate()"
        />
      </template>
    </UChatPrompt>
  </div>
</template>
