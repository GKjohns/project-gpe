/**
 * Stage `figures`: look at every rasterized figure with a vision model and record what it shows: its kind, a
 * faithful alt text, for charts the axes / series / trend and only the values legible in the image, which nodes it
 * supports, and a confidence. One call per figure (fan-out of 3), skip-if-present, cost through callObject.
 * Figures without an image keep their caption and get no model call.
 */
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import type { Skeleton } from '#shared/pipeline'
import type { FigureKind, PaperFigure, PaperSection, ProofNode } from '#shared/types'
import { useDb } from '../../db'
import { papers } from '../../db/schema'
import { PROFILES } from '../../utils/aiModels'
import { blobStore, blobUrl } from '../../utils/blobs'
import { appendEvent, patchProgress, setStage } from '../../utils/runs'
import { stageOutputs } from '../../utils/stageOutputs'
import { callObject } from '../llm'
import { mapLimit } from '../nodes'
import type { ClassifyOutput } from './classify'
import type { RenderFigure, RenderOutput } from './render'
import type { StageFn } from './stub'

export const FIGURE_KINDS = ['plot', 'commutative_diagram', 'graph', 'diagram', 'schematic', 'illustration', 'table', 'photo', 'other'] as const satisfies readonly FigureKind[]

export const figureVisionSchema = z.object({
  kind: z.enum(FIGURE_KINDS),
  readable_text: z.array(z.string()).describe('Every label, axis title, tick label, legend entry and annotation you can read in the image, verbatim; "unreadable" for any you can see but cannot read with certainty'),
  description: z.string().describe('Alt text: 2–5 sentences on what the figure shows, built only from what is visible'),
  data_summary: z.string().nullable().describe('Charts only (else null): axes (label, range from the tick labels), each series, the trend, and key values that are legible in the image. Write "unreadable" for any value you cannot read; never estimate a number from the caption or your own knowledge'),
  node_ids: z.array(z.string()).describe('Ids from the node list that this figure illustrates or supports; [] if none'),
  confidence: z.number().min(0).max(1).describe('How sure you are that the description is faithful to the image and the node links are right')
})
export type FigureVision = z.infer<typeof figureVisionSchema>

export const FIGURE_INSTRUCTIONS = `You describe one figure from a mathematics paper for a reader who cannot see it, from the image itself.

Rules:
- Describe only what is visible. Read labels, axis titles, tick labels and legend entries exactly as printed. If you can see text or a value but cannot read it with certainty, write "unreadable" for it. Never fill in a number from the caption, the surrounding text or what you expect; the caption and context are for knowing what the figure is about, not for its values.
- If LaTeX source of the figure is given (TikZ, pgfplots), it is authoritative for labels and coordinates; you may use it to read small labels, and say so if the image and source disagree.
- kind: plot (a chart of data or a function: line, bar, scatter, histogram), commutative_diagram (objects and arrows of a diagram chase), graph (vertices and edges: a network, tree, poset, automaton), diagram (a conceptual or flow diagram of boxes and arrows, a proof map), schematic (a geometric construction, a circuit, a configuration of points, intervals or regions), illustration (a picture that isn't any of these), table (a table rendered as an image), photo, other.
- description: 2–5 plain sentences. Say what is drawn and how it is arranged, then what it is meant to show. Use $…$ for math.
- data_summary: only for plots: the axes (label and range as the ticks show), each series (by legend name or appearance), the trend, and the key values you can actually read. null for every other kind.
- node_ids: choose only from the node list. Include a node when the figure illustrates its statement, its proof, or a construction it uses. Nodes whose text cites the figure are listed first; prefer them, but leave one out if the figure is not about it. [] when none fits.
- confidence: 0–1 for the whole answer; lower it when text was unreadable or the node links are a guess.`

function nodeLine(n: ProofNode, number?: string) {
  return `- ${n.id} · ${n.kind}${number ? ` ${number}` : ''} · ${n.name}${n.headline ? ` — ${n.headline}` : ''}`
}

export function figurePrompt(input: {
  title: string
  figure: RenderFigure
  section?: PaperSection
  nodes: ProofNode[]
  numbers: Map<string, string>
}): string {
  const f = input.figure
  const cited = f.cited_by.map(id => input.nodes.find(n => n.id === id)).filter((n): n is ProofNode => !!n)
  const rest = input.nodes.filter(n => !f.cited_by.includes(n.id))
  return [
    `Paper: ${input.title}`,
    `Figure ${f.number ?? '(unnumbered)'}${f.label ? ` (\\label{${f.label}})` : ''} in ${input.section ? `§${input.section.id} ${input.section.title}` : `section ${f.section}`}.`,
    `Caption (LaTeX): ${f.caption || '(none)'}`,
    ...(f.subcaptions.length ? [`Subcaptions: ${f.subcaptions.map((c, i) => `(${String.fromCharCode(97 + i)}) ${c}`).join(' ')}`] : []),
    f.tikz ? `LaTeX source of the figure (drawn in TeX):\n${f.body}` : `The figure includes: ${f.graphics.map(g => g.ref).join(', ') || '(no graphics files)'}`,
    `Text around the figure and where the paper refers to it:\n${f.context || '(none)'}`,
    cited.length ? `Nodes whose statement or proof cites or contains the figure:\n${cited.map(n => nodeLine(n, input.numbers.get(n.id))).join('\n')}` : 'No node cites the figure directly.',
    `All nodes:\n${rest.map(n => nodeLine(n, input.numbers.get(n.id))).join('\n')}`,
    'The figure image follows.'
  ].join('\n\n')
}

/** The model's answer, cleaned: node ids it made up are dropped, data_summary only for plots. */
export function cleanVision(v: FigureVision, nodeIds: Set<string>): FigureVision {
  return {
    ...v,
    node_ids: [...new Set(v.node_ids.filter(id => nodeIds.has(id)))],
    data_summary: v.kind === 'plot' ? v.data_summary : null,
    confidence: Math.max(0, Math.min(1, v.confidence))
  }
}

export function toPaperFigure(f: RenderFigure, vision: (FigureVision & { model: string }) | null): PaperFigure {
  return {
    id: f.id,
    ...(f.label ? { label: f.label } : {}),
    ...(f.number ? { number: f.number } : {}),
    caption: f.caption,
    section: f.section,
    file: f.file,
    line: f.line,
    ...(f.page ? { page: f.page } : {}),
    ...(f.rect ? { rect: f.rect } : {}),
    ...(f.image ? { image_url: blobUrl(f.image.sha), width: f.image.width, height: f.image.height, image_source: f.image.source } : {}),
    graphics: f.graphics.map(g => g.ref),
    tikz: f.tikz,
    kind: vision?.kind ?? (f.tikz ? 'diagram' : 'other'),
    description: vision?.description ?? '',
    ...(vision?.data_summary ? { data_summary: vision.data_summary } : {}),
    node_ids: vision?.node_ids ?? f.cited_by,
    confidence: vision?.confidence ?? 0,
    ...(vision ? { model: vision.model } : {})
  }
}

export interface FiguresOutput { figures: PaperFigure[], vision: Record<string, FigureVision & { model: string }> }

export const figuresStage: StageFn = async (ctx) => {
  await setStage(ctx.runId, 'figures')
  const reused = await stageOutputs.get<FiguresOutput>(ctx.runId, 'figures')
  if (reused) {
    await appendEvent(ctx.runId, 'figures', 'info', `figures · reused ${reused.figures.length} figures`)
    return reused.figures.length
  }
  const render = await stageOutputs.get<RenderOutput>(ctx.runId, 'render')
  const classified = await stageOutputs.get<ClassifyOutput>(ctx.runId, 'classify')
  const skeleton = await stageOutputs.get<Skeleton>(ctx.runId, 'chunk')
  if (!render || !classified || !skeleton) {
    await stageOutputs.put(ctx.runId, 'figures', { figures: [], vision: {} } satisfies FiguresOutput)
    await appendEvent(ctx.runId, 'figures', 'warn', 'figures · no render output; skipped')
    return 0
  }
  const nodes = classified.nodes
  const nodeIds = new Set(nodes.map(n => n.id))
  const numbers = new Map<string, string>()
  for (const s of skeleton.statements) {
    const n = nodes.find(x => x.paper_ref.label === s.label && !x.parent_id)
    if (n && s.number) {
      numbers.set(n.id, s.number)
    }
  }
  const sections = new Map(skeleton.sections.map(s => [s.id, s]))
  const model = PROFILES[ctx.profile].figures
  const withImage = render.figures.filter(f => f.image)
  const [paper] = await (await useDb()).select({ title: papers.title }).from(papers).where(eq(papers.id, ctx.paperId))
  const title = paper?.title ?? ''
  if (withImage.length) {
    await appendEvent(ctx.runId, 'figures', 'info', `figures · looking at ${withImage.length} figures with ${model}`)
  }

  const vision: FiguresOutput['vision'] = {}
  let failed = 0
  await mapLimit(withImage, 3, async (f) => {
    const blob = await blobStore.get(f.image!.sha)
    if (!blob) {
      return
    }
    try {
      const { object } = await callObject({
        model,
        schema: figureVisionSchema,
        instructions: FIGURE_INSTRUCTIONS,
        prompt: figurePrompt({ title, figure: f, section: sections.get(f.section), nodes, numbers }),
        images: [{ data: blob.data, mediaType: 'image/png' }],
        reasoning: 'medium',
        runId: ctx.runId,
        stage: 'figures'
      })
      vision[f.id] = { ...cleanVision(object, nodeIds), model }
    } catch (err) {
      failed++
      await appendEvent(ctx.runId, 'figures', 'warn', `figures · ${f.id} not described: ${(err as Error).message.slice(0, 200)}`)
    }
  })

  const figures = render.figures.map(f => toPaperFigure(f, vision[f.id] ?? null))
  await stageOutputs.put(ctx.runId, 'figures', { figures, vision } satisfies FiguresOutput)
  await patchProgress(ctx.runId, { figures_described: Object.keys(vision).length })
  await appendEvent(ctx.runId, 'figures', failed ? 'warn' : 'info',
    `figures · ${figures.length} figures · ${Object.keys(vision).length} described${failed ? ` · ${failed} failed` : ''} · kinds ${[...new Set(Object.values(vision).map(v => v.kind))].join(', ') || '—'}`)
  return figures.length
}
