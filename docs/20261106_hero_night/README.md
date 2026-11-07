# Night hero for dark mode

Generated 2026-11-06 with `generate.mjs` (run from the repo root: `node --env-file=.env docs/20261106_hero_night/generate.mjs`).
Both jobs take the shipped hero (`../20261101_openai_explorer/hero/gpt-image-2-a.png`) as a reference image and ask for the
same scholar, desk and room after dark, lit by one candle, with the moon in the window. Raw `.png` output is gitignored.

| File | Model | Critique |
|---|---|---|
| `night-gemini-3-pro.png` | google/gemini-3-pro-image (2K, image in the message) | Candle actually lights the face, hands and pages; crescent moon and a few stars in a deep blue window; the globe catches a highlight. The figure sits a little larger and more central than the day hero, but the left third is still near-black. **Shipped.** |
| `night-gpt-image-2.png` | openai/gpt-image-2 (quality high, input_fidelity high) | Most faithful to the day composition, almost pixel-aligned. Darker and quieter; the candle glow is small and the face stays in shadow, so it reads less "by candlelight". Runner-up. |

## In the page

`app/pages/index.vue` stacks the night image over the day one and fades it in under `.dark` (1s cross-fade on toggle). The
description, the two buttons and the left gradient warm to amber tones in dark mode; the headline stays white because the
wall behind it is dark either way. Picks converted with `cwebp -q 82` into `public/landing/hero-night{,-960}.webp`.

Cost: roughly $0.40–0.50 for the two images, not checked against the gateway bill.
