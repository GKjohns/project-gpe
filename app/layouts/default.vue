<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

// Public shell. The one deviation from stock UHeader: pages with `headerOverlay` meta (the landing) get a fixed header
// that sits transparent over the hero and turns into the usual blurred bar once the page scrolls.
const route = useRoute()
const scrolled = useScrolled()
const overlay = computed(() => !!route.meta.headerOverlay)
const menuOpen = ref(false)
// The mobile menu reuses the header's title and toggle on a plain background, so it never gets the white overlay colors.
const clear = computed(() => overlay.value && !scrolled.value && !menuOpen.value)

const nav = computed<NavigationMenuItem[]>(() => [
  { label: 'Papers', to: '/papers', active: route.path.startsWith('/papers') },
  { label: 'Disciplines', to: '/#disciplines', active: false }
])

const headerUi = computed(() => ({
  root: [
    'transition-colors duration-200',
    overlay.value && 'fixed inset-x-0 top-0',
    clear.value && 'bg-transparent backdrop-blur-none border-transparent'
  ].filter(Boolean).join(' '),
  title: clear.value ? '*:text-white!' : '',
  toggle: clear.value ? 'text-white hover:bg-white/10' : ''
}))

const navUi = computed(() => clear.value
  ? { link: 'text-white/85 hover:text-white hover:before:bg-white/10 data-active:text-white' }
  : {})

const iconClass = computed(() => clear.value ? 'text-white hover:bg-white/10 hover:text-white' : '')

const year = new Date().getFullYear()
</script>

<template>
  <div>
    <UHeader
      v-model:open="menuOpen"
      title="GPE"
      :ui="headerUi"
      :toggle="{ class: iconClass }"
    >
      <template #title>
        <AppLogo />
      </template>

      <UNavigationMenu
        :items="nav"
        :ui="navUi"
      />

      <template #right>
        <UButton
          to="/papers?focus=1"
          icon="i-lucide-search"
          aria-label="Search papers"
          title="Search papers"
          color="neutral"
          variant="ghost"
          :class="iconClass"
        />
        <UColorModeButton :class="iconClass" />
        <UButton
          to="https://github.com/openai/math"
          target="_blank"
          icon="i-simple-icons-github"
          aria-label="openai/math on GitHub"
          color="neutral"
          variant="ghost"
          :class="iconClass"
        />
      </template>

      <template #body>
        <UNavigationMenu
          :items="nav"
          orientation="vertical"
          class="-mx-2.5"
        />
      </template>
    </UHeader>

    <UMain>
      <slot />
    </UMain>

    <UFooter :ui="{ left: 'text-sm text-muted', right: 'text-sm text-muted' }">
      <template #left>
        <p class="max-w-2xl text-pretty">
          <span class="font-semibold text-highlighted">GPE</span> · Papers from
          <ULink
            to="https://github.com/openai/math"
            target="_blank"
            class="text-default hover:text-highlighted underline-offset-2 hover:underline"
          >github.com/openai/math</ULink>
          (Apache-2.0). Digests are model-generated and may be wrong; the PDF is the source of truth. © {{ year }}
        </p>
      </template>

      <template #right>
        <p class="flex flex-wrap items-center gap-x-1.5">
          <span>For agents:</span>
          <ULink
            to="/llms.txt"
            external
            class="text-default hover:text-highlighted"
          >/llms.txt</ULink>
          <span>·</span>
          <ULink
            to="/api/v1/papers"
            external
            class="text-default hover:text-highlighted"
          >/api/v1</ULink>
          <span>·</span>
          <ULink
            to="/llms.txt"
            external
            class="text-default hover:text-highlighted"
          >MCP</ULink>
          <span>·</span>
          <ULink
            to="/admin"
            class="text-dimmed hover:text-muted"
          >operator</ULink>
        </p>
      </template>
    </UFooter>
  </div>
</template>
