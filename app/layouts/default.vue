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
