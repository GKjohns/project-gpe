import type { InjectionKey } from 'vue'

const IN_CARD: InjectionKey<boolean> = Symbol('in-hover-card')

/** Marks everything below as inside a node hover card, so refs there render as plain links (no card in a card). */
export function provideInHoverCard() {
  provide(IN_CARD, true)
}

export function useInHoverCard() {
  return inject(IN_CARD, false)
}

/** Touch: the first tap on a trigger opens its card instead of following the link; the card's buttons navigate. */
export function useTouchTapGuard(enabled: () => boolean) {
  let touch = false
  function onPointerdown(e: PointerEvent) {
    touch = e.pointerType === 'touch'
  }
  function onClick(e: MouseEvent) {
    if (touch && enabled()) {
      e.preventDefault()
      e.stopPropagation()
    }
    touch = false
  }
  return { onPointerdown, onClick }
}
