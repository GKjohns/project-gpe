<script setup lang="ts">
const title = 'Proofmap'
const fullTitle = 'Proofmap · OpenAI\'s math papers, made readable'
// Count-free on purpose: the catalog syncs from openai/math, so a number here goes stale. Keep it under ~160 characters.
const description = 'Step-by-step proof maps of OpenAI\'s machine-written math papers: every theorem and lemma in plain English, linked to the typeset paper. Follow the proof.'
// Crawlers need absolute URLs; appUrl is the public origin (NUXT_PUBLIC_APP_URL in prod).
// og.jpg is the 1200×630 share card (docs/20261106_proofmap/og_card.py renders it); JPEG because some unfurlers skip WebP.
const origin = useRuntimeConfig().public.appUrl.replace(/\/$/, '')
const route = useRoute()
const pageUrl = computed(() => `${origin}${route.path === '/' ? '' : route.path}`)
const ogImageAlt = 'Proofmap: follow the proof. Step-by-step maps of OpenAI\'s math papers, in plain English.'

// Icons and manifest are rendered by docs/20261106_proofmap/brand_icons.py. Nuxt already emits charset and viewport.
useHead({
  htmlAttrs: { lang: 'en' },
  link: [
    { rel: 'canonical', href: pageUrl },
    { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
    { rel: 'icon', href: '/favicon.ico', sizes: '48x48' },
    { rel: 'icon', type: 'image/png', href: '/favicon-96x96.png', sizes: '96x96' },
    { rel: 'apple-touch-icon', href: '/apple-touch-icon.png', sizes: '180x180' },
    { rel: 'manifest', href: '/site.webmanifest' }
  ],
  meta: [
    { name: 'theme-color', content: '#ffffff', media: '(prefers-color-scheme: light)' },
    { name: 'theme-color', content: '#14100b', media: '(prefers-color-scheme: dark)' },
    { name: 'apple-mobile-web-app-title', content: title }
  ],
  script: [{
    key: 'ld-website',
    type: 'application/ld+json',
    innerHTML: JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      'name': title,
      'url': `${origin}/`,
      description,
      'inLanguage': 'en',
      'publisher': { '@type': 'Organization', 'name': 'Monument Labs', 'url': 'https://www.monumentlabs.io' }
    })
  }]
})

// Pages override title/description and the og:/twitter: pairs; these are the site-wide fallbacks.
useSeoMeta({
  title,
  titleTemplate: t => t && t !== title ? `${t} · Proofmap` : fullTitle,
  description,
  ogSiteName: 'Proofmap',
  ogLocale: 'en_US',
  ogTitle: fullTitle,
  ogDescription: description,
  ogUrl: pageUrl,
  ogImage: `${origin}/og.jpg`,
  ogImageType: 'image/jpeg',
  ogImageWidth: 1200,
  ogImageHeight: 630,
  ogImageAlt,
  ogType: 'website',
  twitterCard: 'summary_large_image',
  twitterTitle: fullTitle,
  twitterDescription: description,
  twitterImage: `${origin}/og.jpg`,
  twitterImageAlt: ogImageAlt
})
</script>

<template>
  <UApp>
    <NuxtLoadingIndicator
      color="var(--ui-primary)"
      :height="2"
    />
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
