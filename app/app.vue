<script setup lang="ts">
useHead({
  meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1' }],
  link: [{ rel: 'icon', href: '/favicon.ico' }],
  htmlAttrs: { lang: 'en' }
})

const title = 'Project GPE'
const description = 'Project GPE (Graphical Proof Explorer): a browsable map of a math proof — paper + Lean, side by side.'

useSeoMeta({
  title,
  titleTemplate: t => t && t !== title ? `${t} · GPE` : 'Project GPE · Graphical Proof Explorer',
  description,
  ogTitle: title,
  ogDescription: description
})
</script>

<template>
  <UApp>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
