// Night-time hero for dark mode. Run from the repo root: node --env-file=.env docs/20261106_hero_night/generate.mjs
// Edits the shipped hero (docs/20261101_openai_explorer/hero/gpt-image-2-a.png) so the same scholar, desk and room
// appear after dark, lit by a candle, with the moon through the window.
import { readFile, writeFile } from 'node:fs/promises'
import { generateImage, generateText } from 'ai'

const dir = new URL('./', import.meta.url)
const hero = await readFile(new URL('../20261101_openai_explorer/hero/gpt-image-2-a.png', import.meta.url))

const text = 'Repaint this exact painting as the same scene at night. Keep everything identical: the same scholar in the same pose and clothes, the same oak desk, scattered diagram pages, brass compass, quill, inkwell, stack of books and brass globe, the same leaded window on the right and the same wall on the left. Change only the light and the hour: it is deep night, the window shows a dark blue sky with a small moon and a few faint stars over the dark rooftops, and the room is lit by a single candle on the desk (place a brass candlestick with a lit candle among the papers near the inkwell) whose warm amber glow falls on the pages, his hands and face, and fades into darkness. The left third of the canvas stays an almost black empty wall. Same Dutch Golden Age oil painting, same brushwork and craquelure, deep umber and near-black palette with the warm candle glow. Absolutely no text, letters, signature, watermark or frame.'

const jobs = [
  {
    file: 'night-gpt-image-2',
    run: async () => (await generateImage({
      model: 'openai/gpt-image-2',
      prompt: { text, images: [hero] },
      size: '1536x1024',
      providerOptions: { openai: { quality: 'high', input_fidelity: 'high' } }
    })).image.uint8Array
  },
  {
    file: 'night-gemini-3-pro',
    run: async () => {
      const result = await generateText({
        model: 'google/gemini-3-pro-image',
        messages: [{ role: 'user', content: [{ type: 'file', mediaType: 'image/png', data: hero }, { type: 'text', text }] }],
        providerOptions: { google: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '3:2', imageSize: '2K' } } }
      })
      const image = result.files.find(f => f.mediaType?.startsWith('image/'))
      if (!image) throw new Error('no image returned')
      return image.uint8Array
    }
  }
]

const results = await Promise.allSettled(jobs.map(async (job) => {
  const bytes = await job.run()
  await writeFile(new URL(`${job.file}.png`, dir), bytes)
  return job.file
}))
results.forEach((r, i) => console.log(r.status === 'fulfilled' ? `ok   ${r.value}` : `FAIL ${jobs[i].file}: ${r.reason?.message}`))
