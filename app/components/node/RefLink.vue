<script setup lang="ts">
import type { ResolvedRef } from '~/utils/refs'

// A \ref / \eqref / \cref in paper text: equations open a popover with the rendered equation, statements get the
// node hover card and select their node on click, sections select their first node, anything else is a muted humanized label. Never the raw label in monospace.
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
// Inside a node hover card refs stay plain: no card or equation popover on top of a card.
const inCard = useInHoverCard()

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
    section: s ? sectionLabel(s.id, s.title) : e.section === 'front' ? 'Front matter' : `§${e.section}`,
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
      v-if="r.kind === 'equation' && r.equation && !inCard"
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
          <div class="flex flex-col gap-1.5 border-t border-default pt-2">
            <div
              v-if="r.equation.number"
              class="text-xs font-semibold text-highlighted"
            >
              Equation ({{ r.equation.number }})
            </div>
            <NodeProvenance
              :section="equationSource(r)?.section"
              :file="r.equation.file"
              :lines="r.equation.line"
              :label="r.label"
              :url="equationSource(r)?.url"
            />
          </div>
        </div>
      </template>
    </UPopover><NodeHoverCard
      v-else-if="r.kind === 'statement'"
      :id="r.node.id"
    >
      <button
        type="button"
        :class="LINK"
        :data-ref-node="r.node.id"
        :aria-label="`${r.text}: ${r.node.name}`"
        @click="go(r.node.id)"
      >{{ r.text }}</button>
    </NodeHoverCard><UTooltip
      v-else-if="r.kind === 'section' && r.nodeId"
      :text="sectionLabel(r.section.id, r.section.title)"
    >
      <button
        type="button"
        :class="LINK"
        :data-ref-section="r.section.id"
        @click="go(r.nodeId)"
      >{{ r.text }}</button>
    </UTooltip><UPopover
      v-else-if="r.kind === 'figure' && !inCard"
      :content="{ side: 'top', align: 'center', collisionPadding: 12 }"
    >
      <button
        type="button"
        :class="LINK"
        :data-ref-figure="r.figure.id"
      >{{ r.text }}</button>
      <template #content>
        <!-- Figure refs: the rasterized figure, its caption and the vision model's description. -->
        <div
          class="max-h-[min(34rem,80vh)] w-[min(26rem,calc(100vw-2rem))] overflow-y-auto p-3"
          data-ref-popover
        >
          <FigureCard
            :figure="r.figure"
            compact
          />
        </div>
      </template>
    </UPopover><span
      v-else
      :class="r.kind === 'unknown' || r.kind === 'equation' || r.kind === 'figure' ? 'text-muted' : ''"
      :title="r.label"
      :data-ref-unresolved="r.label"
    >{{ r.text }}</span></template>
  </span>
</template>
