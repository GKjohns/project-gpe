<script setup lang="ts">
import { z } from 'zod'
import type { FormSubmitEvent, SelectMenuItem, TabsItem } from '@nuxt/ui'
import { slugSchema } from '#shared/schemas'
import type { Profile, StructureMethod } from '#shared/types'

useSeoMeta({ title: 'New paper' })

type SourceKind = 'github' | 'arxiv' | 'upload'
// defaultProfile / defaultMethod come from the server (aiModels.ts) for GitHub/arXiv; uploads are summarized here without them.
interface Preview { files: { path: string, bytes: number }[], mainFile: string, estTokens: number, estPages: number, defaultProfile?: Profile, defaultMethod?: StructureMethod }

const state = reactive({
  title: '',
  slug: '',
  sourceKind: 'github' as SourceKind,
  githubUrl: '',
  arxivId: '',
  files: [] as File[],
  profile: 'standard' as Profile,
  method: 'pipeline' as StructureMethod,
  budgetUsd: 15
})

const schema = z.object({
  title: z.string().min(1, 'Give the paper a title').max(300),
  slug: slugSchema,
  sourceKind: z.enum(['github', 'arxiv', 'upload']),
  githubUrl: z.string(),
  arxivId: z.string(),
  files: z.array(z.any()),
  profile: z.enum(['careful', 'standard', 'quick']),
  method: z.enum(['pipeline', 'agent']),
  budgetUsd: z.number().positive('Budget must be positive').max(500)
}).superRefine((v, ctx) => {
  if (v.sourceKind === 'github' && !/^https:\/\/github\.com\/[^/]+\/[^/]+/.test(v.githubUrl.trim())) {
    ctx.addIssue({ code: 'custom', path: ['githubUrl'], message: 'Paste a github.com/<owner>/<repo>/tree/<ref>/<dir> URL' })
  }
  if (v.sourceKind === 'arxiv' && !v.arxivId.trim()) {
    ctx.addIssue({ code: 'custom', path: ['arxivId'], message: 'Enter an arXiv id, e.g. 1907.00847' })
  }
  if (v.sourceKind === 'upload' && !v.files.length) {
    ctx.addIssue({ code: 'custom', path: ['files'], message: 'Add .tex files or a .zip' })
  }
})
type Schema = z.output<typeof schema>

// Slug follows the title until edited by hand.
const slugTouched = ref(false)
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
watch(() => state.title, (t) => {
  if (!slugTouched.value) {
    state.slug = slugify(t)
  }
})

const sourceTabs: TabsItem[] = [
  { label: 'GitHub directory', icon: 'i-simple-icons-github', value: 'github', slot: 'github' as const },
  { label: 'arXiv', icon: 'i-lucide-library', value: 'arxiv', slot: 'arxiv' as const },
  { label: 'Upload .tex / .zip', icon: 'i-lucide-upload', value: 'upload', slot: 'upload' as const }
]
const methodTabs: TabsItem[] = [
  { label: 'Pipeline', value: 'pipeline' },
  { label: 'Agent (sandbox)', value: 'agent' }
]
const profileItems: SelectMenuItem[] = [
  { label: 'Careful', value: 'careful', description: 'Strong reasoning for structure, standard for prose' },
  { label: 'Standard', value: 'standard', description: 'Balanced; the default under 30 pages' },
  { label: 'Quick', value: 'quick', description: 'Cheap models; for tier-1 re-runs' }
]

// --- source preview: lists the files and drives the profile default + estimate line ---
const preview = ref<Preview | null>(null)
const previewError = ref('')
const previewing = ref(false)
const profileTouched = ref(false)
const methodTouched = ref(false)
let previewTimer: ReturnType<typeof setTimeout> | undefined
let previewSeq = 0

function remoteSource() {
  if (state.sourceKind === 'github' && /^https:\/\/github\.com\/[^/]+\/[^/]+/.test(state.githubUrl.trim())) {
    return { kind: 'github' as const, url: state.githubUrl.trim() }
  }
  if (state.sourceKind === 'arxiv' && state.arxivId.trim().length >= 5) {
    return { kind: 'arxiv' as const, id: state.arxivId.trim() }
  }
  return null
}

async function runPreview() {
  const seq = ++previewSeq
  previewError.value = ''
  if (state.sourceKind === 'upload') {
    // Uploads are summarized here: no server round trip for files the browser already has.
    const files = state.files.map(f => ({ path: f.name, bytes: f.size }))
    const bytes = files.reduce((n, f) => n + f.bytes, 0)
    const tex = files.filter(f => f.path.endsWith('.tex'))
    preview.value = files.length
      ? { files, mainFile: tex.length === 1 ? tex[0]!.path : '', estTokens: Math.round(bytes / 3.1), estPages: Math.max(1, Math.round(bytes / 3000)) }
      : null
    return
  }
  const source = remoteSource()
  if (!source) {
    preview.value = null
    return
  }
  previewing.value = true
  try {
    const res = await $fetch<Preview>('/api/papers/preview', { method: 'POST', body: { source } })
    if (seq === previewSeq) {
      preview.value = res
    }
  } catch (err) {
    if (seq === previewSeq) {
      preview.value = null
      previewError.value = errorMessage(err)
    }
  } finally {
    if (seq === previewSeq) {
      previewing.value = false
    }
  }
}

watch(() => [state.sourceKind, state.githubUrl, state.arxivId, state.files], () => {
  clearTimeout(previewTimer)
  previewTimer = setTimeout(runPreview, 500)
}, { deep: true })

watch(preview, (p) => {
  if (p && !profileTouched.value) {
    state.profile = p.defaultProfile ?? (p.estPages > 30 || p.estTokens > 100_000 ? 'careful' : 'standard')
  }
  if (p?.defaultMethod && !methodTouched.value) {
    state.method = p.defaultMethod
  }
})

const kb = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`

const previewLine = computed(() => {
  const p = preview.value
  if (!p) {
    return ''
  }
  const tex = p.files.filter(f => f.path.endsWith('.tex'))
  const main = p.files.find(f => f.path === p.mainFile)
  const others = p.files.length - tex.length
  return [
    `Found ${tex.length} .tex file${tex.length === 1 ? '' : 's'}${others ? ` (+${others} other)` : ''}`,
    main ? `main: ${main.path} (${kb(main.bytes)})` : null,
    `~${Math.round(p.estTokens / 1000)}k tokens`,
    `~${p.estPages} pages`
  ].filter(Boolean).join(' · ')
})

// Measured on the Sprint 8 corpus (whole-run $ per 1k source tokens): careful 0.041–0.054 (ETH, logspace, intmult,
// unit-distance, PFR), standard 0.012–0.041 (the four simple/intermediate papers). Quick is still a guess.
const USD_PER_KTOK: Record<Profile, number> = { careful: 0.045, standard: 0.03, quick: 0.006 }
const estimateLine = computed(() => {
  const p = preview.value
  if (!p) {
    return 'The estimate appears once the source is found.'
  }
  const usd = (p.estTokens / 1000) * USD_PER_KTOK[state.profile]
  const minutes = Math.round(2 + p.estPages / 15)
  return `Estimated: ~${minutes} min, ~$${usd < 1 ? usd.toFixed(2) : usd.toFixed(0)} at ${state.profile} for a ~${p.estPages}-page source.`
})

// --- submit ---
const toast = useToast()
const submitting = ref(false)
const form = useTemplateRef('form')

function errorMessage(err: unknown): string {
  const e = err as { data?: { statusMessage?: string, message?: string }, statusMessage?: string, message?: string }
  return e.data?.statusMessage ?? e.data?.message ?? e.statusMessage ?? e.message ?? 'Something went wrong'
}

async function onSubmit(event: FormSubmitEvent<Schema>) {
  const v = event.data
  const payload = {
    title: v.title.trim(),
    slug: v.slug,
    source: v.sourceKind === 'github'
      ? { kind: 'github', url: v.githubUrl.trim() }
      : v.sourceKind === 'arxiv' ? { kind: 'arxiv', id: v.arxivId.trim() } : { kind: 'upload' },
    profile: v.profile,
    method: v.method,
    budgetUsd: v.budgetUsd
  }
  let body: FormData | typeof payload = payload
  if (v.sourceKind === 'upload') {
    const fd = new FormData()
    fd.append('payload', JSON.stringify(payload))
    for (const f of state.files) {
      fd.append('files', f, f.name)
    }
    body = fd
  }
  submitting.value = true
  try {
    const res = await $fetch<{ runId: string, slug: string }>('/api/papers', { method: 'POST', body })
    await navigateTo(`/papers/${res.slug}/run?run=${res.runId}`)
  } catch (err) {
    const message = errorMessage(err)
    if (/slug/i.test(message)) {
      form.value?.setErrors([{ name: 'slug', message }])
    }
    toast.add({ title: 'Could not start the digest', description: message, color: 'error', icon: 'i-lucide-circle-alert' })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UContainer class="py-10 max-w-3xl">
    <div class="mb-8">
      <UBreadcrumb
        :items="[{ label: 'GPE', to: '/' }, { label: 'New paper' }]"
        class="mb-3"
      />
      <h1 class="text-2xl font-semibold text-highlighted">
        New paper
      </h1>
      <p class="mt-1 text-muted">
        Give GPE a LaTeX source. It produces the map in a few minutes; you can watch it go.
      </p>
    </div>

    <UForm
      ref="form"
      :schema="schema"
      :state="state"
      class="space-y-6"
      @submit="onSubmit"
    >
      <div class="grid gap-4 sm:grid-cols-[1fr_14rem]">
        <UFormField
          label="Title"
          name="title"
          required
        >
          <UInput
            v-model="state.title"
            placeholder="The Exponential Time Hypothesis is False"
            class="w-full"
          />
        </UFormField>
        <UFormField
          label="Slug (URL)"
          name="slug"
          required
        >
          <UInput
            v-model="state.slug"
            placeholder="eth"
            class="w-full"
            @update:model-value="slugTouched = true"
          />
        </UFormField>
      </div>

      <UFormField
        label="Source"
        name="sourceKind"
      >
        <UTabs
          v-model="state.sourceKind"
          :items="sourceTabs"
          variant="link"
          class="w-full"
          :ui="{ content: 'pt-4' }"
        >
          <template #github>
            <UFormField
              name="githubUrl"
              help="Every .tex, .bib, .sty and .cls in the directory is pulled through the GitHub API."
            >
              <UInput
                v-model="state.githubUrl"
                placeholder="https://github.com/openai/math/tree/main/preprints/…/build"
                icon="i-simple-icons-github"
                class="w-full"
              />
            </UFormField>
          </template>
          <template #arxiv>
            <UFormField
              name="arxivId"
              help="Fetches arxiv.org/e-print/<id> and unpacks the tarball server-side."
            >
              <UInput
                v-model="state.arxivId"
                placeholder="1907.00847"
                icon="i-lucide-library"
                class="w-full"
              />
            </UFormField>
          </template>
          <template #upload>
            <UFormField name="files">
              <UFileUpload
                v-model="state.files"
                multiple
                accept=".tex,.bib,.sty,.cls,.bbl,.zip"
                label="Drop .tex files or a .zip here, or click to choose"
                description="Up to 4 MB per request (serverless body limit); use a URL for bigger sources."
                layout="list"
                class="w-full min-h-36"
              />
            </UFormField>
          </template>
        </UTabs>
        <div class="mt-3 min-h-5 text-sm">
          <span
            v-if="previewing"
            class="flex items-center gap-1.5 text-muted"
          >
            <UIcon
              name="i-lucide-loader-circle"
              class="size-4 animate-spin"
            /> Looking at the source…
          </span>
          <span
            v-else-if="previewError"
            class="flex items-center gap-1.5 text-error"
          >
            <UIcon
              name="i-lucide-circle-alert"
              class="size-4"
            /> {{ previewError }}
          </span>
          <span
            v-else-if="preview"
            class="flex items-center gap-1.5 text-muted"
          >
            <UIcon
              name="i-lucide-file-check"
              class="size-4 text-success"
            /> {{ previewLine }}
          </span>
        </div>
      </UFormField>

      <div class="grid gap-4 sm:grid-cols-2">
        <UFormField
          label="Model profile"
          name="profile"
          help="Careful is the default for long papers; Quick for tier-1 re-runs."
        >
          <USelectMenu
            v-model="state.profile"
            :items="profileItems"
            value-key="value"
            :search-input="false"
            class="w-full"
            @update:model-value="profileTouched = true"
          />
        </UFormField>
        <UFormField
          label="Budget (USD)"
          name="budgetUsd"
          help="The run stops at a step boundary once spend passes this."
        >
          <UInputNumber
            v-model="state.budgetUsd"
            :min="1"
            :max="500"
            :step="5"
            :format-options="{ style: 'currency', currency: 'USD', maximumFractionDigits: 0 }"
            class="w-full"
          />
        </UFormField>
      </div>

      <UFormField
        label="Structure method"
        name="method"
        :help="state.method === 'agent'
          ? 'Agent: a Claude Agent SDK agent in a Vercel Sandbox reads the source with tools, writes and validates the outline; up to 200 turns and 60% of the budget. Slower, variable cost.'
          : 'Pipeline: fixed rules, one whole-paper outline call, known cost.'"
      >
        <UTabs
          v-model="state.method"
          :items="methodTabs"
          :content="false"
          size="sm"
          class="w-full sm:w-96"
          @update:model-value="methodTouched = true"
        />
      </UFormField>

      <UFormField
        label="Lean repo"
        name="lean"
        help="Lean alignment is Phase 2; the field is here so the shape is."
      >
        <UInput
          disabled
          placeholder="https://github.com/openai/math/tree/main/lean · target decl …"
          icon="i-lucide-sigma"
          class="w-full"
        >
          <template #trailing>
            <UBadge
              label="Phase 2"
              size="sm"
              color="neutral"
              variant="subtle"
            />
          </template>
        </UInput>
      </UFormField>

      <USeparator />

      <div class="flex flex-wrap items-center gap-4">
        <UButton
          type="submit"
          size="lg"
          icon="i-lucide-play"
          label="Start digest"
          :loading="submitting"
        />
        <p class="text-sm text-muted">
          {{ estimateLine }}
        </p>
      </div>
    </UForm>
  </UContainer>
</template>
