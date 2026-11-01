import { useWindowScroll } from '@vueuse/core'

/** True once the window has scrolled past `threshold` px; always false during SSR (no window). */
export function useScrolled(threshold = 24) {
  const { y } = useWindowScroll()
  return computed(() => y.value > threshold)
}
