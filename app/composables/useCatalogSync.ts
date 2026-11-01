/** "Sync catalog" for the admin sidebar and papers table: POST /api/admin/catalog/sync, then a toast with its counts. */
export function useCatalogSync() {
  const toast = useToast()
  const syncing = useState('catalog-syncing', () => false)

  async function syncCatalog() {
    if (syncing.value) {
      return
    }
    syncing.value = true
    try {
      const r = await $fetch<{ sha: string, families: number, manuscripts: number, written: { families: number, manuscripts: number } }>('/api/admin/catalog/sync', { method: 'POST' })
      toast.add({
        title: `Catalog synced · ${r.families} families, ${r.manuscripts} manuscripts`,
        description: `openai/math @ ${r.sha.slice(0, 7)} · ${r.written.families + r.written.manuscripts} rows changed`,
        color: 'success',
        icon: 'i-lucide-refresh-cw'
      })
    } catch (err) {
      const e = err as { statusMessage?: string, data?: { data?: { problems?: string[] } } }
      toast.add({
        title: 'Catalog sync failed',
        description: e.data?.data?.problems?.slice(0, 3).join(' · ') ?? e.statusMessage ?? 'Could not sync',
        color: 'error',
        icon: 'i-lucide-circle-alert'
      })
    } finally {
      syncing.value = false
    }
  }

  return { syncing, syncCatalog }
}
