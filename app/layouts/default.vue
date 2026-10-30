<script setup lang="ts">
const { operator, auth, refreshOperator } = useOperator()

async function signOut() {
  await $fetch('/api/session/logout', { method: 'POST' })
  await refreshOperator()
}
</script>

<template>
  <div>
    <UHeader>
      <template #left>
        <NuxtLink
          to="/"
          class="rounded-md p-1 -ms-1"
        >
          <AppLogo />
        </NuxtLink>
      </template>

      <template #right>
        <UButton
          v-if="operator && auth === 'token'"
          icon="i-lucide-log-out"
          aria-label="Sign out"
          title="Sign out (operator)"
          color="neutral"
          variant="ghost"
          @click="signOut"
        />
        <UColorModeButton />
        <UButton
          to="https://github.com/GKjohns/project-gpe"
          target="_blank"
          icon="i-simple-icons-github"
          aria-label="GitHub"
          color="neutral"
          variant="ghost"
        />
      </template>
    </UHeader>

    <UMain>
      <slot />
    </UMain>

    <UFooter>
      <template #left>
        <p class="text-sm text-muted">
          Project GPE · © {{ new Date().getFullYear() }}
        </p>
      </template>
    </UFooter>
  </div>
</template>
