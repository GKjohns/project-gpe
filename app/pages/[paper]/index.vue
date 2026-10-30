<script setup lang="ts">
// `/[paper]` → the paper reader at page 1 with the main theorem (root_ids[0]) selected; a paper that was never
// rendered lands on the main theorem's node page instead. Not yet digested → the run page.
const route = useRoute()
const slug = String(route.params.paper)
const { paper, digest, error, ready } = useDigest(slug)
await ready

if (error.value) {
  throw createError({ statusCode: error.value.statusCode ?? 404, statusMessage: error.value.statusMessage ?? 'Paper not found', fatal: true })
}
const target = digest.value?.root_ids[0] ?? digest.value?.nodes[0]?.id
if (target) {
  const query = digest.value?.render ? { view: 'paper', page: '1', ...route.query } : route.query
  await navigateTo({ path: `/${slug}/${target}`, query }, { replace: true, redirectCode: 302 })
} else if (paper.value) {
  await navigateTo(`/papers/${slug}/run`, { replace: true, redirectCode: 302 })
}
</script>

<template>
  <div />
</template>
