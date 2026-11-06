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

const footerColumns: { title: string, links: { label: string, to: string, target?: string, external?: boolean }[] }[] = [
  { title: 'Browse', links: [{ label: 'Papers', to: '/papers' }, { label: 'Disciplines', to: '/#disciplines' }] },
  { title: 'Source', links: [{ label: 'GitHub', to: 'https://github.com/openai/math', target: '_blank' }] },
  { title: 'For agents', links: [{ label: '/llms.txt', to: '/llms.txt', external: true }, { label: '/api/v1', to: '/api/v1/papers', external: true }, { label: 'MCP', to: '/llms.txt', external: true }] }
]
</script>

<template>
  <div>
    <UHeader
      v-model:open="menuOpen"
      title="Proofmap"
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

    <footer class="bg-[#14100b] text-white">
      <div class="relative h-40 overflow-hidden sm:h-56 lg:h-72">
        <img
          src="/landing/footer-night.webp"
          srcset="/landing/footer-night-960.webp 960w, /landing/footer-night.webp 1536w"
          sizes="100vw"
          loading="lazy"
          alt=""
          class="size-full object-cover object-[30%_72%]"
        >
        <div class="absolute inset-x-0 bottom-0 h-1/3 bg-linear-to-t from-[#14100b] to-transparent" />
      </div>

      <UContainer class="py-10">
        <div class="grid grid-cols-2 gap-8 sm:grid-cols-4">
          <p class="col-span-2 font-serif text-3xl font-semibold tracking-tight sm:col-span-1">
            Proofmap
          </p>
          <div
            v-for="column in footerColumns"
            :key="column.title"
          >
            <p class="text-sm font-semibold">
              {{ column.title }}
            </p>
            <ul class="mt-3 space-y-2 text-sm">
              <li
                v-for="link in column.links"
                :key="link.label"
              >
                <ULink
                  :to="link.to"
                  :target="link.target"
                  :external="link.external"
                  class="text-white/75 hover:text-white"
                >
                  {{ link.label }}
                </ULink>
              </li>
            </ul>
          </div>
        </div>

        <div class="mt-10 flex flex-col gap-3 border-t border-white/15 pt-6 text-sm text-white/70 lg:flex-row lg:items-start lg:justify-between lg:gap-10">
          <p class="max-w-3xl text-pretty">
            Papers from
            <ULink
              to="https://github.com/openai/math"
              target="_blank"
              class="text-white/90 underline-offset-2 hover:text-white hover:underline"
            >github.com/openai/math</ULink>
            (Apache-2.0). Digests are model-generated and may be wrong; the PDF is the source of truth.
          </p>
          <p class="flex shrink-0 items-center gap-x-1.5">
            <span>© {{ year }}</span>
            <span>·</span>
            <ULink
              to="/admin"
              class="text-white/70 hover:text-white"
            >operator</ULink>
          </p>
        </div>
      </UContainer>
    </footer>
  </div>
</template>
