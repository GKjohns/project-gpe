// Pages that are only operator controls (the new-paper form) send everyone else to /login first.
export default defineNuxtRouteMiddleware(async (to) => {
  const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined
  const session = await $fetch<{ operator: boolean }>('/api/session', { headers }).catch(() => ({ operator: false }))
  if (!session.operator) {
    return navigateTo({ path: '/login', query: { next: to.fullPath } })
  }
})
