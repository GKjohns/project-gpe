<script setup lang="ts">
import type { ProofNode } from '#shared/types'

const props = defineProps<{
  node: ProofNode
  /** Graph view's right-hand card: drops Uses/Used by, Sources and Friction details. */
  compact?: boolean
}>()

const { paper, index } = useDigestContext()
const chat = injectPaperChat()

const section = computed(() => index.value.sectionOf[props.node.id])
const sectionText = computed(() => {
  const s = section.value
  const label = s ? sectionLabel(s.id, s.title) : sectionLabel(props.node.paper_ref.section, props.node.paper_ref.sectionTitle)
  return props.node.paper_ref.page ? `${label}, p. ${props.node.paper_ref.page}` : label
})
const uses = computed(() => [
  ...props.node.deps_paper.map(id => ({ id, inferred: false })),
  ...props.node.deps_inferred.filter(id => !props.node.deps_paper.includes(id)).map(id => ({ id, inferred: true }))
])
const usedBy = computed(() => index.value.usedBy[props.node.id] ?? [])
const claims = computed(() => index.value.children[props.node.id] ?? [])
const frictionKinds = computed(() => [...new Map(props.node.friction.map(f => [f.kind, f])).values()])

const nodeSourceUrl = computed(() => sourceUrl(paper.value, props.node.paper_ref))
</script>

<template>
  <article
    class="flex flex-col gap-6"
    :class="compact ? 'text-sm' : ''"
  >
    <header class="flex flex-col gap-2">
      <div class="flex flex-wrap gap-1.5">
        <UBadge
          color="neutral"
          variant="outline"
          :icon="KIND_ICON[node.kind]"
          :label="node.kind"
        />
        <UBadge
          :color="CLASS_COLOR[node.classification]"
          variant="subtle"
          :label="node.classification"
        />
        <UBadge
          v-for="f in frictionKinds"
          :key="f.kind"
          :color="SEVERITY_COLOR[f.severity]"
          variant="soft"
          icon="i-lucide-triangle-alert"
          :label="f.kind"
        />
      </div>
      <h1
        class="font-semibold text-highlighted text-pretty"
        :class="compact ? 'text-lg' : 'text-2xl'"
      >
        {{ node.name }}
      </h1>
      <!-- Graph card text: what it proves, and its role for the results that use it. -->
      <div
        v-if="node.headline"
        data-node-headline
        class="-mt-1 flex flex-col gap-0.5"
      >
        <NodeMathText
          :text="node.headline"
          class="text-sm text-toned"
        />
        <NodeMathText
          v-if="node.role"
          :text="node.role"
          class="text-xs text-muted"
        />
      </div>
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
        <span>{{ capitalize(node.kind) }}</span>
        <template v-if="node.paper_ref.label">
          <span class="text-dimmed">·</span>
          <code class="text-xs">{{ node.paper_ref.label }}</code>
        </template>
        <span class="text-dimmed">·</span>
        <span>{{ sectionText }}</span>
        <template v-if="node.parent_id">
          <span class="text-dimmed">·</span>
          <span class="inline-flex items-center gap-1">inside <NodeChip :id="node.parent_id" /></span>
        </template>
      </div>
      <div v-if="chat">
        <UButton
          icon="i-lucide-message-circle-question"
          label="Ask about this node"
          color="neutral"
          variant="outline"
          size="xs"
          data-ask-node
          @click="chat.ask(`Explain [[${node.id}]] and what it's used for.`)"
        />
      </div>
    </header>

    <section>
      <h2 class="mb-2 text-[11px] font-semibold tracking-wider text-dimmed uppercase">
        Statement (paper)
      </h2>
      <div class="rounded-md border border-default bg-elevated/50 px-4 py-3 text-default">
        <NodeMathText :text="node.statement_paper" />
      </div>
    </section>

    <section>
      <h2 class="mb-2 text-[11px] font-semibold tracking-wider text-dimmed uppercase">
        In plain English
      </h2>
      <!-- Annotate writes inline $…$ math in the prose fields. -->
      <NodeMathText
        v-if="node.statement_plain"
        :text="node.statement_plain"
      />
      <p
        v-else
        class="text-dimmed"
      >
        —
      </p>
    </section>

    <section>
      <h2 class="mb-2 text-[11px] font-semibold tracking-wider text-dimmed uppercase">
        Why it's here
      </h2>
      <NodeMathText
        v-if="node.explanation"
        :text="node.explanation"
      />
      <p
        v-else
        class="text-dimmed"
      >
        —
      </p>
      <div
        v-if="node.classification_cite"
        class="mt-1.5 text-xs text-muted"
      >
        Classified <b>{{ node.classification }}</b>: <NodeMathText
          :text="node.classification_cite"
          class="inline"
        />
      </div>
    </section>

    <div
      v-if="!compact"
      class="grid gap-6 sm:grid-cols-2"
    >
      <section>
        <h2 class="mb-2 text-[11px] font-semibold tracking-wider text-dimmed uppercase">
          Uses
        </h2>
        <div
          v-if="uses.length"
          class="flex flex-wrap gap-1.5"
        >
          <NodeChip
            v-for="u in uses"
            :id="u.id"
            :key="u.id"
            :inferred="u.inferred"
          />
        </div>
        <p
          v-else
          class="text-sm text-dimmed"
        >
          Nothing else in the paper
        </p>
      </section>
      <section>
        <h2 class="mb-2 text-[11px] font-semibold tracking-wider text-dimmed uppercase">
          Used by
        </h2>
        <div
          v-if="usedBy.length"
          class="flex flex-wrap gap-1.5"
        >
          <NodeChip
            v-for="id in usedBy"
            :id="id"
            :key="id"
          />
        </div>
        <p
          v-else
          class="text-sm text-dimmed"
        >
          Nothing in the paper
        </p>
      </section>
    </div>

    <section v-if="claims.length">
      <h2 class="mb-2 text-[11px] font-semibold tracking-wider text-dimmed uppercase">
        Inside the proof
      </h2>
      <div class="flex flex-wrap gap-1.5">
        <NodeChip
          v-for="c in claims"
          :id="c.id"
          :key="c.id"
        />
      </div>
    </section>

    <section v-if="!compact">
      <h2 class="mb-2 text-[11px] font-semibold tracking-wider text-dimmed uppercase">
        Sources
      </h2>
      <div class="grid gap-3 sm:grid-cols-2">
        <UCard
          variant="outline"
          :ui="{ header: 'px-4 py-2.5 sm:px-4', body: 'px-4 py-3 sm:px-4 sm:py-3' }"
        >
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon
                name="i-lucide-file-text"
                class="size-4 text-muted"
              />
              <span class="text-sm font-medium">Paper</span>
              <UButton
                v-if="nodeSourceUrl"
                :to="nodeSourceUrl"
                target="_blank"
                size="xs"
                color="neutral"
                variant="soft"
                trailing-icon="i-lucide-external-link"
                label="Open"
                class="ms-auto"
              />
            </div>
          </template>
          <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt class="text-muted">
              Section
            </dt>
            <dd>{{ section ? sectionLabel(section.id, section.title) : node.paper_ref.section }}</dd>
            <dt class="text-muted">
              Page
            </dt>
            <dd>{{ node.paper_ref.page ?? '—' }}</dd>
            <dt class="text-muted">
              Label
            </dt>
            <dd><code class="text-xs">{{ node.paper_ref.label ?? '—' }}</code></dd>
            <dt class="text-muted">
              Line
            </dt>
            <dd class="truncate">
              <code class="text-xs">{{ node.paper_ref.file }}:{{ node.paper_ref.line }}</code>
            </dd>
          </dl>
        </UCard>
        <UCard
          variant="outline"
          :ui="{ header: 'px-4 py-2.5 sm:px-4', body: 'px-4 py-3 sm:px-4 sm:py-3' }"
        >
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon
                name="i-lucide-sigma"
                class="size-4 text-muted"
              />
              <span class="text-sm font-medium">Lean</span>
              <UBadge
                color="neutral"
                variant="soft"
                size="sm"
                :label="node.lean_ref ? 'aligned' : 'not aligned'"
                class="ms-auto"
              />
            </div>
          </template>
          <dl
            v-if="node.lean_ref"
            class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm"
          >
            <dt class="text-muted">
              Decl
            </dt>
            <dd><code class="text-xs">{{ node.lean_ref.decl }}</code></dd>
            <dt class="text-muted">
              File
            </dt>
            <dd><code class="text-xs">{{ node.lean_ref.file }}</code></dd>
          </dl>
          <p
            v-else
            class="text-sm text-muted"
          >
            Phase 2 aligns this node to a Lean declaration.
          </p>
        </UCard>
      </div>
    </section>

    <section v-if="!compact && node.friction.length">
      <h2 class="mb-2 text-[11px] font-semibold tracking-wider text-dimmed uppercase">
        Friction
      </h2>
      <ul class="flex flex-col gap-2">
        <li
          v-for="(f, i) in node.friction"
          :key="i"
          class="flex items-start gap-3 text-sm"
        >
          <UBadge
            :color="SEVERITY_COLOR[f.severity]"
            variant="subtle"
            size="sm"
            :label="f.severity"
            class="mt-0.5"
          />
          <div>
            <div class="font-medium font-mono text-xs">
              {{ f.kind }}
            </div>
            <NodeMathText
              :text="f.note"
              class="text-muted"
            />
          </div>
        </li>
      </ul>
    </section>
  </article>
</template>
