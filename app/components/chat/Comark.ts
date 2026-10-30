// Streaming markdown for assistant answers: KaTeX math with the paper's macros, `[[node-id]]` citation chips,
// and the paper's own `\eqref{…}`/`\ref{…}` when the model quotes them (rendered by NodeRefLink).
import { defineComarkPlugin } from '@comark/nuxt/parse'
import math from '@comark/nuxt/plugins/math'
import ChatMath from './Math.vue'
import NodeLink from './NodeLink.vue'
import RefLink from '../node/RefLink.vue'

interface InlineState { src: string, pos: number, push: (type: string, tag: string, nesting: number) => { attrs: [string, string][] | null } }
interface InlineRuler { __rules__: { name: string }[], before: (name: string, rule: string, fn: (state: InlineState, silent: boolean) => boolean) => void }

/**
 * `[[id]]` → a self-closing `node-link` node. A markdown-it rule rather than rewriting to `:node-link{id}`:
 * Comark's inline component syntax needs whitespace before it, so "([[a]], [[b]])" would come out as text.
 * Registered first so the `[…]` span and link rules never see the brackets.
 */
const citations = defineComarkPlugin(() => ({
  name: 'citations',
  markdownItPlugins: [(md: { inline: { ruler: InlineRuler } }) => {
    const ruler = md.inline.ruler
    ruler.before(ruler.__rules__[0]!.name, 'node_citation', (state, silent) => {
      if (state.src.charCodeAt(state.pos) !== 0x5B || state.src.charCodeAt(state.pos + 1) !== 0x5B) {
        return false
      }
      const m = /^\[\[([^\]\s]+)\]\]/.exec(state.src.slice(state.pos))
      if (!m) {
        return false
      }
      if (!silent) {
        // Comark turns this token type into `[tag, attrs]` generically.
        state.push('mdc_block_shorthand', 'node-link', 0).attrs = [['id', m[1]!]]
      }
      state.pos += m[0].length
      return true
    })
  }] as never
}))

/** `\eqref{eq:x}` etc. outside math → a `paper-ref` node; inside `$…$` the math rule has already consumed it. */
const paperRefs = defineComarkPlugin(() => ({
  name: 'paper-refs',
  markdownItPlugins: [(md: { inline: { ruler: InlineRuler } }) => {
    const ruler = md.inline.ruler
    ruler.before(ruler.__rules__[0]!.name, 'paper_ref', (state, silent) => {
      if (state.src.charCodeAt(state.pos) !== 0x5C) {
        return false
      }
      const m = /^\\(eqref|ref|cref|Cref|autoref|nameref)\*?\{([^{}]+)\}/.exec(state.src.slice(state.pos))
      if (!m) {
        return false
      }
      if (!silent) {
        // 'false', not '': Vue casts an empty string to true for a boolean-typed prop.
        const prefixed = isPrefixed(state.src.slice(0, state.pos)) ? 'true' : 'false'
        state.push('mdc_block_shorthand', 'paper-ref', 0).attrs = [['labels', m[2]!], ['cmd', m[1]!], ['prefixed', prefixed]]
      }
      state.pos += m[0].length
      return true
    })
  }] as never
}))

export default defineMarkdownComponent({
  name: 'ChatComark',
  plugins: [math(), citations(), paperRefs()],
  components: {
    'math': ChatMath,
    'node-link': NodeLink,
    'paper-ref': RefLink
  },
  class: '*:first:mt-0 *:last:mb-0'
})
