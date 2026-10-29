import type { ModelMessage } from 'ai'
import { describe, expect, it } from 'vitest'
import { splitCitations, toChatMarkdown } from '../app/utils/chatText'
import { toyDigest } from '../server/fixtures/toy-digest'
import { chatInstructions, citedIds, serializeDigest, trimHistory } from '../server/utils/chat'

const user = (text: string): ModelMessage => ({ role: 'user', content: text })
const assistant = (text: string): ModelMessage => ({ role: 'assistant', content: [{ type: 'text', text }] })

describe('chat instructions', () => {
  it('serializes every node with its id, deps and used-by', () => {
    const s = serializeDigest(toyDigest)
    for (const n of toyDigest.nodes) {
      expect(s).toContain(`[${n.id} · ${n.kind}`)
    }
    expect(s).toContain('used by: ')
    expect(chatInstructions(toyDigest)).toContain('[[thm-main]]')
  })

  it('extracts cited ids once each', () => {
    expect(citedIds('see [[a]] and [[b-1]], again [[a]]; not [[ x ]]')).toEqual(['a', 'b-1'])
  })
})

describe('trimHistory', () => {
  it('keeps everything under the ceiling', () => {
    const msgs = [user('q1'), assistant('a1'), user('q2')]
    expect(trimHistory(msgs, 100)).toEqual(msgs)
  })

  it('drops the oldest turns at user boundaries and always keeps the last question', () => {
    const msgs = [user('x'.repeat(50)), assistant('y'.repeat(50)), user('q2'), assistant('a2'), user('q3')]
    const out = trimHistory(msgs, 20)
    expect(out[0]).toEqual(user('q2'))
    expect(trimHistory(msgs, 1)).toEqual([user('q3')])
  })
})

describe('chat markdown', () => {
  it('leaves complete citations for the Comark citations plugin', () => {
    expect(toChatMarkdown('By ([[lem-hash]], [[thm-main]]).', true)).toBe('By ([[lem-hash]], [[thm-main]]).')
  })

  it('keeps math that starts with a digit as math and converts \\(…\\)', () => {
    expect(toChatMarkdown('time $2^{n/\\sqrt{\\log n}}$ vs $n$')).toBe('time ${}2^{n/\\sqrt{\\log n}}$ vs $n$')
    expect(toChatMarkdown('\\(x^2\\)')).toBe('$x^2$')
  })

  it('hides a half-streamed citation only while streaming', () => {
    expect(toChatMarkdown('uses [[lem-sp', true)).toBe('uses ')
    expect(toChatMarkdown('uses [[lem-sp')).toBe('uses [[lem-sp')
  })

  it('splits user text around citations', () => {
    expect(splitCitations('Explain [[lem-hash]] please')).toEqual([{ text: 'Explain ' }, { id: 'lem-hash' }, { text: ' please' }])
  })
})
