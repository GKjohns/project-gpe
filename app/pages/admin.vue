<script setup lang="ts">
// Parent of every /admin page: Nuxt runs this middleware and merges this meta for each child route.
definePageMeta({ layout: 'admin', middleware: 'operator' })
</script>

<template>
  <NuxtPage />
</template>
