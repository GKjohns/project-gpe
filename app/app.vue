<script setup lang="ts">
useHead({
  meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1' }],
  link: [{ rel: 'icon', href: '/favicon.ico' }],
  htmlAttrs: { lang: 'en' }
})

const title = 'Proofmap'
const fullTitle = 'Proofmap · OpenAI\'s math papers, made readable'
const description = 'Browse OpenAI\'s 721 machine-written math papers. Each digested paper becomes a proof map with plain-English steps, the PDF alongside, and a chat that cites the map.'
// Crawlers need absolute URLs; appUrl is the public origin (NUXT_PUBLIC_APP_URL in prod).
// og.jpg is the 1200×630 share card (docs/20261106_proofmap/og_card.py renders it); JPEG because some unfurlers skip WebP.
const origin = useRuntimeConfig().public.appUrl.replace(/\/$/, '')
const route = useRoute()
const pageUrl = computed(() => `${origin}${route.path === '/' ? '' : route.path}`)
const ogImageAlt = 'Proofmap: follow the proof. Step-by-step maps of OpenAI\'s math papers, in plain English.'

useHead({ link: [{ rel: 'canonical', href: pageUrl }] })
useSeoMeta({
  title,
  titleTemplate: t => t && t !== title ? `${t} · Proofmap` : fullTitle,
  description,
  ogSiteName: 'Proofmap',
  ogTitle: fullTitle,
  ogDescription: description,
  ogUrl: pageUrl,
  ogImage: `${origin}/og.jpg`,
  ogImageWidth: 1200,
  ogImageHeight: 630,
  ogImageAlt,
  ogType: 'website',
  twitterCard: 'summary_large_image',
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
