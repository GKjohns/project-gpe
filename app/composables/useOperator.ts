/**
 * Whether this browser may use the operator controls (ingest, re-run, cancel, review, corpus).
 * One cached GET /api/session per page load; `refreshOperator()` after signing in or out.
 */
export function useOperator() {
  const { data, refresh } = useFetch<{ operator: boolean, auth: 'token' | 'open' | 'closed' }>('/api/session', {
    key: 'operator-session',
    headers: useRequestHeaders(['cookie']),
    default: () => ({ operator: false, auth: 'token' as const }),
    dedupe: 'defer'
  })
  return {
    operator: computed(() => data.value.operator),
    auth: computed(() => data.value.auth),
    refreshOperator: refresh
  }
}

/** `/login?next=<here>`, for the "Sign in" links that stand in for operator controls. */
export function loginHref(next: string) {
  return { path: '/login', query: { next } }
}
