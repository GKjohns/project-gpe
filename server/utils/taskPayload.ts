// `nuxt task run x --payload.k=v` delivers strings (or true for a bare flag); tasks accept both shapes.
export const payloadFlag = (v: unknown) => v === true || v === 'true' || v === '1'

export const payloadList = (v: unknown): string[] =>
  (Array.isArray(v) ? v.map(String) : typeof v === 'string' ? v.split(',') : []).map(s => s.trim()).filter(Boolean)
