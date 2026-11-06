<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

// Operator pages: a sidebar of admin tools and one panel. Kept out of search engines entirely.
useSeoMeta({ robots: 'noindex, nofollow' })

const route = useRoute()
const { auth, refreshOperator } = useOperator()
const { syncing, syncCatalog } = useCatalogSync()

const nav = computed<NavigationMenuItem[]>(() => [
  { label: 'Papers', icon: 'i-lucide-files', to: '/admin', exact: true },
  { label: 'New paper', icon: 'i-lucide-plus', to: '/admin/papers/new' },
  { label: 'Corpus', icon: 'i-lucide-library', to: '/admin/corpus' },
  { label: 'Sync catalog', icon: 'i-lucide-refresh-cw', disabled: syncing.value, onSelect: () => syncCatalog() }
])

async function signOut() {
  await $fetch('/api/session/logout', { method: 'POST' })
  await refreshOperator()
  await navigateTo('/')
}
</script>

<template>
  <UDashboardGroup
    unit="rem"
    storage-key="proofmap-admin"
  >
    <UDashboardSidebar
      collapsible
      :ui="{ footer: 'border-t border-default' }"
    >
      <template #header="{ collapsed }">
        <NuxtLink
          to="/admin"
          class="flex items-center gap-2"
        >
          <AppLogo />
          <UBadge
            v-if="!collapsed"
            label="admin"
            color="warning"
            variant="subtle"
            size="sm"
          />
        </NuxtLink>
      </template>

      <template #default="{ collapsed }">
        <UNavigationMenu
          :items="nav"
          :collapsed="collapsed"
          orientation="vertical"
        />
      </template>

      <template #footer="{ collapsed }">
        <div
          class="flex w-full gap-1"
          :class="collapsed ? 'flex-col items-center' : 'items-center'"
        >
          <UButton
            to="/"
            icon="i-lucide-external-link"
            :label="collapsed ? undefined : 'View site'"
            color="neutral"
            variant="ghost"
            :class="!collapsed && 'flex-1'"
          />
          <UButton
            v-if="auth === 'token'"
            icon="i-lucide-log-out"
            aria-label="Sign out"
            title="Sign out"
            color="neutral"
            variant="ghost"
            @click="signOut"
          />
          <UColorModeButton />
        </div>
      </template>
    </UDashboardSidebar>

    <UDashboardPanel id="admin">
      <template #header>
        <UDashboardNavbar :title="String(route.meta.title ?? 'Admin')">
          <template #leading>
            <UDashboardSidebarCollapse />
          </template>
        </UDashboardNavbar>
      </template>

      <template #body>
        <slot />
      </template>
    </UDashboardPanel>
  </UDashboardGroup>
</template>
