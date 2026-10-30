<script setup lang="ts">
// Operator sign-in: the OPERATOR_TOKEN goes to /api/session/login, which sets the session cookie.
useSeoMeta({ title: 'Sign in', robots: 'noindex' })

const route = useRoute()
const { operator, auth, refreshOperator } = useOperator()

// Only same-site paths; anything else lands on the library.
const next = computed(() => {
  const n = typeof route.query.next === 'string' ? route.query.next : '/'
  return n.startsWith('/') && !n.startsWith('//') ? n : '/'
})

const token = ref('')
const submitting = ref(false)
const error = ref('')

async function signIn() {
  submitting.value = true
  error.value = ''
  try {
    await $fetch('/api/session/login', { method: 'POST', body: { token: token.value } })
    await refreshOperator()
    await navigateTo(next.value)
  } catch (err) {
    error.value = (err as { statusMessage?: string }).statusMessage ?? 'Could not sign in'
  } finally {
    submitting.value = false
  }
}

async function signOut() {
  await $fetch('/api/session/logout', { method: 'POST' })
  await refreshOperator()
}
</script>

<template>
  <UContainer class="py-16 max-w-md">
    <UCard>
      <template #header>
        <h1 class="text-lg font-semibold text-highlighted">
          Operator sign-in
        </h1>
        <p class="mt-1 text-sm text-muted">
          Adding papers, re-runs, reviews and corpus ingests are for the operator. Reading, the map and the chat are open to everyone.
        </p>
      </template>

      <UAlert
        v-if="auth === 'open'"
        color="neutral"
        variant="subtle"
        icon="i-lucide-info"
        title="Operator auth is off"
        description="No OPERATOR_TOKEN is set in this dev server, so every control is already open."
      />
      <UAlert
        v-else-if="auth === 'closed'"
        color="warning"
        variant="subtle"
        icon="i-lucide-lock"
        title="Not configured"
        description="This deployment has no OPERATOR_TOKEN, so operator controls are disabled."
      />
      <div
        v-else-if="operator"
        class="flex items-center justify-between gap-4"
      >
        <p class="text-sm text-default">
          You are signed in as the operator.
        </p>
        <div class="flex gap-2">
          <UButton
            color="neutral"
            variant="outline"
            label="Sign out"
            @click="signOut"
          />
          <UButton
            :to="next"
            label="Continue"
          />
        </div>
      </div>
      <form
        v-else
        class="flex flex-col gap-4"
        @submit.prevent="signIn"
      >
        <UFormField
          label="Operator token"
          :error="error || undefined"
        >
          <UInput
            v-model="token"
            type="password"
            autocomplete="current-password"
            class="w-full"
            autofocus
          />
        </UFormField>
        <UButton
          type="submit"
          label="Sign in"
          icon="i-lucide-log-in"
          :loading="submitting"
          :disabled="!token"
          block
        />
      </form>
    </UCard>
  </UContainer>
</template>
