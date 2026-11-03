// Footer image candidates. Run from the repo root: node --env-file=.env docs/20261103_footer/generate.mjs
import { writeFile } from 'node:fs/promises'
import { generateImage, generateText } from 'ai'

const dir = new URL('./', import.meta.url)

const style = 'Museum-quality oil painting on canvas in the manner of the Dutch Golden Age, visible brushwork, fine craquelure, deep umber, ochre and near-black palette. A very wide panoramic composition. The upper half of the canvas is calm, dark and nearly empty so that small light text can sit on it. Absolutely no text, letters, numerals, signature, watermark or frame.'

const concepts = {
  night: 'The same scholar\'s study at night, now empty: an oak desk seen from the side, scattered parchment covered in geometric diagrams, a brass compass, a stack of leather books, a brass globe, a quill in its inkwell and a single candle just burned down with a thread of smoke. Faint moonlight through a leaded window on the far right. No people.',
  stars: 'A vast old celestial chart painted as a night sky: deep blue-black heavens with fine gold stars joined by thin gold lines into branching networks, like constellations that also read as a diagram of connected steps, with faint engraved arcs and circles. Low along the bottom edge a dark silhouette of a Dutch town with a small observatory dome. No people.',
  horizon: 'A Dutch landscape at dusk in the manner of Ruisdael: an enormous darkening sky fills the canvas, with a low flat horizon along the bottom edge, a small windmill, a distant church spire, and a lone tiny surveyor with a tripod instrument on a dyke. The last amber light sits on the horizon.',
  still: 'A close, low view along a dark oak tabletop in the manner of a vanitas still life: brass dividers open across a sheet of parchment with hand-drawn circles and triangles, an hourglass, a snuffed candle, an open worn book, all lit from the left by warm light and arranged along the bottom third of the canvas, with deep black shadow above. No people.'
}

const jobs = Object.entries(concepts).flatMap(([name, scene]) => {
  const prompt = `${scene} ${style}`
  return [
    {
      file: `${name}-gpt-image-2`,
      run: async () => (await generateImage({
        model: 'openai/gpt-image-2',
        prompt,
        size: '1536x1024',
        providerOptions: { openai: { quality: 'high' } }
      })).image.uint8Array
    },
    {
      file: `${name}-gemini-3-pro`,
      run: async () => {
        const result = await generateText({
          model: 'google/gemini-3-pro-image',
          prompt,
          providerOptions: { google: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '21:9', imageSize: '2K' } } }
        })
        const image = result.files.find(f => f.mediaType?.startsWith('image/'))
        if (!image) throw new Error('no image returned')
        return image.uint8Array
      }
    }
  ]
})

const results = await Promise.allSettled(jobs.map(async (job) => {
  const bytes = await job.run()
  await writeFile(new URL(`${job.file}.png`, dir), bytes)
  return job.file
}))

results.forEach((r, i) => console.log(r.status === 'fulfilled' ? `ok   ${r.value}` : `FAIL ${jobs[i].file}: ${r.reason?.message}`))
