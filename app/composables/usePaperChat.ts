import type { InjectionKey, Ref } from 'vue'
import type { UIMessage } from 'ai'
import { DefaultChatTransport } from 'ai'
import { useChat } from '@ai-sdk/vue'
import type { ChatTurnMetadata } from '#shared/api'

export type PaperChatMessage = UIMessage<ChatTurnMetadata>

/**
 * One conversation per paper page. It lives in the page (keyed by paper), not in the panel, so the xl panel
 * and the narrow-screen slideover show the same thread and closing either keeps it.
 */
export function createPaperChat(slug: MaybeRefOrGetter<string>, opts: { open: () => void, onCite?: () => void }) {
  const toast = useToast()
  const input = ref('')
  const chat = useChat<PaperChatMessage>(() => ({
    id: `paper-${toValue(slug)}`,
    transport: new DefaultChatTransport({ api: `/api/papers/${toValue(slug)}/chat` }),
    onError: (error) => {
      // The route maps provider errors to one calm sentence; anything else is a network/HTTP failure.
      toast.add({ title: 'Chat error', description: chatErrorMessage(error), color: 'error', icon: 'i-lucide-circle-alert' })
    }
  }))

  /** Opens the chat with `text` in the prompt (not sent), e.g. "Ask about this node". */
  function ask(text: string) {
    input.value = text
    opts.open()
  }

  return { ...chat, input, ask, onCite: opts.onCite ?? (() => {}) }
}

export type PaperChat = ReturnType<typeof createPaperChat> & { input: Ref<string> }

const CHAT_KEY: InjectionKey<PaperChat> = Symbol('paper-chat')

export function providePaperChat(chat: PaperChat) {
  provide(CHAT_KEY, chat)
}

/** The page's chat, or null outside a paper page (e.g. NodePage rendered elsewhere). */
export function injectPaperChat(): PaperChat | null {
  return inject(CHAT_KEY, null)
}
