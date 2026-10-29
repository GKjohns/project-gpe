import type { LocationQuery, RouteLocationRaw } from 'vue-router'

/** Selected node id ↔ `/[paper]/[node]`. Query (`view`, `mode`, `claims`) is carried across selections. */
export function useSelection() {
  const route = useRoute()
  const router = useRouter()
  const paperSlug = computed(() => String(route.params.paper ?? ''))
  const selectedId = computed(() => String(route.params.node ?? ''))

  function linkTo(id: string, query: LocationQuery = route.query): RouteLocationRaw {
    return { path: `/${paperSlug.value}/${id}`, query }
  }

  /** Pushes by default so browser back walks the selection history; pass `replace` for programmatic moves. */
  function select(id: string, opts: { replace?: boolean } = {}) {
    if (id === selectedId.value) {
      return
    }
    return opts.replace ? router.replace(linkTo(id)) : router.push(linkTo(id))
  }

  /** Updates one query param in place (view toggles shouldn't add history entries). */
  function setQuery(key: string, value: string | undefined) {
    const query = Object.fromEntries(Object.entries(route.query).filter(([k]) => k !== key))
    if (value !== undefined) {
      query[key] = value
    }
    return router.replace({ path: route.path, query })
  }

  return { paperSlug, selectedId, select, linkTo, setQuery }
}
