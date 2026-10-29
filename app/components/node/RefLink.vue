<script setup lang="ts">
import type { ResolvedRef } from '~/utils/refs'

// A \ref / \eqref / \cref in paper text: equations open a popover with the rendered equation, statements and
// sections select their node, anything else is a muted humanized label. Never the raw label in monospace.
const props = defineProps<{
  /** One label or several, comma-separated (\cref{a,b}). */
  labels: string
  cmd?: string
  /** The prose already names the kind ("Lemma~\ref{…}"); boolean or the string Comark attrs carry. */
  prefixed?: boolean | string
}>()

const ctx = injectDigest()
const chat = injectPaperChat()
const { select } = useSelection()

const refs = computed(() => {
  const prefixed = props.prefixed === true || (typeof props.prefixed === 'string' && props.prefixed !== '' && props.prefixed !== 'false')
  return splitLabels(props.labels).map(label => resolveRef(ctx?.digest.value, label, props.cmd ?? 'ref', prefixed))
})

function go(id: string) {
  select(id)
  chat?.onCite()
}

function equationHtml(latex: string) {
  return renderTex(latex, true, ctx?.digest.value?.macros)
}

function equationSource(r: ResolvedRef) {
  if (r.kind !== 'equation' || !r.equation) {
    return undefined
  }
  const e = r.equation
  const s = ctx?.index.value.sectionById.get(e.section)
  return {
    where: [s ? sectionLabel(s.id, s.title) : e.section === 'front' ? 'Front matter' : `§${e.section}`, `${e.file}:${e.line}`],
    url: sourceUrl(ctx?.paper.value, { section: e.section, file: e.file, line: e.line })
  }
}

const LINK = 'cursor-pointer whitespace-nowrap text-primary underline decoration-primary/40 decoration-dotted underline-offset-2 hover:decoration-solid focus-visible:outline-2 focus-visible:outline-primary rounded-xs'
</script>

<template>
  <span data-ref-link>
    <template
      v-for="(r, i) in refs"
      :key="r.label"
    ><template v-if="i > 0">, </template><UPopover
      v-if="r.kind === 'equation' && r.equation"
      :content="{ side: 'top', align: 'center', collisionPadding: 12 }"
    >
      <button
        type="button"
        :class="LINK"
        :data-ref-equation="r.label"
      >{{ r.text }}</button>
      <template #content>
        <div
          class="flex max-w-[min(36rem,calc(100vw-2rem))] flex-col gap-2 p-3"
          data-ref-popover
        >
          <!-- KaTeX output of the paper's own equation. -->
          <!-- eslint-disable vue/no-v-html -->
          <div
            data-math-text
            class="overflow-x-auto text-default"
            v-html="equationHtml(r.equation.latex)"
          />
          <!-- eslint-enable vue/no-v-html -->
          <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            <span
              v-if="r.equation.number"
              class="font-medium text-default"
            >({{ r.equation.number }})</span>
            <template
              v-for="(w, j) in equationSource(r)?.where"
              :key="j"
            >
              <span
                v-if="j > 0 || r.equation.number"
                class="text-dimmed"
              >·</span>
              <span :class="j === 1 ? 'font-mono' : ''">{{ w }}</span>
            </template>
            <ULink
              v-if="equationSource(r)?.url"
              :to="equationSource(r)?.url"
              target="_blank"
              class="ms-auto inline-flex items-center gap-1 text-primary"
            >
              Open in source
              <UIcon
                name="i-lucide-external-link"
                class="size-3"
              />
            </ULink>
          </div>
        </div>
      </template>
    </UPopover><UTooltip
      v-else-if="r.kind === 'statement'"
      :text="`${capitalize(r.node.kind)}${r.number ? ` ${r.number}` : ''} · ${r.node.name}`"
    >
      <button
        type="button"
        :class="LINK"
        :data-ref-node="r.node.id"
        @click="go(r.node.id)"
      >{{ r.text }}</button>
    </UTooltip><UTooltip
      v-else-if="r.kind === 'section' && r.nodeId"
      :text="sectionLabel(r.section.id, r.section.title)"
    >
      <button
        type="button"
        :class="LINK"
        :data-ref-section="r.section.id"
        @click="go(r.nodeId)"
      >{{ r.text }}</button>
    </UTooltip><span
      v-else
      :class="r.kind === 'unknown' || r.kind === 'equation' ? 'text-muted' : ''"
      :title="r.label"
      :data-ref-unresolved="r.label"
    >{{ r.text }}</span></template>
  </span>
</template>
