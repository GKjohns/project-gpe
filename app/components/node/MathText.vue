<script setup lang="ts">
const props = defineProps<{
  text: string
  /** Defaults to the digest's \newcommand map when rendered under provideDigest. */
  macros?: Record<string, string>
}>()

const ctx = injectDigest()

// Display math first so `$$` isn't read as two empty inline spans.
const MATH = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\begin\{(equation\*?|align\*?|gather\*?|multline\*?)\}([\s\S]+?)\\end\{\3\}|\$((?:\\\$|[^$])+?)\$|\\\(([\s\S]+?)\\\)/g

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Light LaTeX-to-HTML for the prose between math spans; anything unrecognized is left as text.
// \ref-family commands are cut out first and rendered as RefLink components (see app/utils/refs.ts).
function renderProse(s: string) {
  return escapeHtml(s)
    .replace(/\\(?:emph|textit)\{([^{}]*)\}/g, '<em>$1</em>')
    .replace(/\\textbf\{([^{}]*)\}/g, '<strong>$1</strong>')
    .replace(/\\texttt\{([^{}]*)\}/g, '<code>$1</code>')
    .replace(CITE_RE, (_, opts: string, keys: string) => `<span class="text-dimmed" title="citation">${citeText(opts, keys)}</span>`)
    .replace(/\\label\{[^{}]*\}/g, '')
    .replace(/~/g, '&nbsp;')
    .replace(/``|''/g, '"')
    .replace(/\\([%&#_$])/g, '$1')
}

type Segment = { html: string } | { labels: string, cmd: string, prefixed: boolean }

function proseSegments(s: string, out: Segment[]) {
  let last = 0
  for (const m of s.matchAll(REF_RE)) {
    out.push({ html: renderProse(s.slice(last, m.index)) })
    out.push({ labels: m[2]!, cmd: m[1]!, prefixed: isPrefixed(s.slice(0, m.index)) })
    last = m.index + m[0].length
  }
  out.push({ html: renderProse(s.slice(last)) })
}

const segments = computed(() => {
  const digest = ctx?.digest.value
  const macros = props.macros ?? digest?.macros
  const out: Segment[] = []
  let last = 0
  for (const m of props.text.matchAll(MATH)) {
    proseSegments(props.text.slice(last, m.index), out)
    const display = m[1] !== undefined || m[2] !== undefined || m[4] !== undefined
    let tex = m[1] ?? m[2] ?? m[5] ?? m[6] ?? ''
    if (m[4] !== undefined) {
      // KaTeX needs an aligned wrapper for & / \\ outside its own environments.
      const env = (m[3] ?? '').replace('*', '')
      const wrap = env === 'align' ? 'aligned' : env === 'equation' ? '' : 'gathered'
      tex = wrap ? `\\begin{${wrap}}${m[4]}\\end{${wrap}}` : m[4]
    }
    out.push({ html: renderTex(texWithRefs(tex, digest), display, macros) })
    last = m.index + m[0].length
  }
  proseSegments(props.text.slice(last), out)
  return out.filter(seg => !('html' in seg) || seg.html)
})
</script>

<template>
  <!-- KaTeX output; the prose between math spans is escaped in renderProse. -->
  <div
    data-math-text
    class="leading-relaxed"
  >
    <template
      v-for="(seg, i) in segments"
      :key="i"
    >
      <!-- eslint-disable vue/no-v-html -->
      <span
        v-if="'html' in seg"
        v-html="seg.html"
      />
      <!-- eslint-enable vue/no-v-html -->
      <NodeRefLink
        v-else
        :labels="seg.labels"
        :cmd="seg.cmd"
        :prefixed="seg.prefixed"
      />
    </template>
  </div>
</template>
