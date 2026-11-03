<script setup lang="ts">
useHead({
  meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1' }],
  link: [{ rel: 'icon', href: '/favicon.ico' }],
  htmlAttrs: { lang: 'en' }
})

const title = 'GPE'
const fullTitle = 'GPE · OpenAI\'s math papers, made readable'
const description = 'Browse OpenAI\'s 721 machine-written math papers. Each digested paper becomes a proof map with plain-English steps, the PDF alongside, and a chat that cites the map.'
// Crawlers need an absolute og:image; appUrl is the public origin (NUXT_PUBLIC_APP_URL in prod).
const ogImage = `${useRuntimeConfig().public.appUrl.replace(/\/$/, '')}/landing/hero.webp`

useSeoMeta({
  title,
  titleTemplate: t => t && t !== title ? `${t} · GPE` : fullTitle,
  description,
  ogTitle: fullTitle,
  ogDescription: description,
  ogImage,
  ogType: 'website',
  twitterCard: 'summary_large_image'
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
