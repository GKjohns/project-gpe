# Footer image candidates

Generated 2026-11-03 with `generate.mjs` via AI SDK `generateImage` / `generateText` through the Vercel AI Gateway.
Each `.png` is the raw model output (gitignored). Picks are converted with `cwebp -q 82` into `public/landing/`, at full width (capped at 1920) and 960.

All four concepts ask for the hero's Dutch Golden Age oil-painting style, a very wide composition, a calm dark upper half for text, and no lettering. gpt-image-2 only offers 3:2 here (1536x1024), so its images are cropped by CSS; gemini-3-pro-image returned 21:9 at 3168x1344.

| File | Model | Critique |
|---|---|---|
| `stars-gpt-image-2.png` | openai/gpt-image-2 (quality high) | Gold constellations that read as a branching proof graph, over a lit Dutch skyline with observatory dome and water. Top 40% is clean blue-black. The strongest link to what the product does, and the only cool note against the hero's umber. No text or artifacts. |
| `night-gpt-image-2.png` | openai/gpt-image-2 (quality high) | The hero's study at night, empty: snuffed candle, quill, compass, globe, moon through the leaded window. Closest match to the hero's surface and palette, and it works as a bookend. Very dark, so text sits on it easily. |
| `horizon-gpt-image-2.png` | openai/gpt-image-2 (quality high) | Ruisdael-style dusk with a huge quiet sky and a tiny surveyor on a dyke. The cleanest text area of the set. Scene details are small, so they get lost on phones unless the crop holds the surveyor. |
| `still-gemini-3-pro.png` | google/gemini-3-pro-image (2K) | Tabletop still life with dividers on a sheet of circles and triangles, hourglass, snuffed candle, open book. Native wide and sharp, with a dark upper left. The book pages carry faint pseudo-script, only noticeable up close. |
| `still-gpt-image-2.png` | openai/gpt-image-2 (quality high) | Same idea with good texture, but the objects rise too high in the frame and collide with footer text. Rejected. |
| `stars-gemini-3-pro.png` | google/gemini-3-pro-image (2K) | Good skyline and native wide, but the constellations fill the top of the canvas exactly where text goes. Rejected. |
| `night-gemini-3-pro.png` | google/gemini-3-pro-image (2K) | Smoother and more illustrative, with a stagey blue light beam; it doesn't match the hero's surface. Rejected. |
| `horizon-gemini-3-pro.png` | google/gemini-3-pro-image (2K) | Strong clouds, but the canvas edges are visible as a dark border, which shows at full bleed. Rejected. |

## Ranking

1. **`stars-gpt-image-2`**: the constellations echo the proof maps, so it is the one image that says something about the product.
2. **`night-gpt-image-2`**: the safest match to the hero, and it closes the page on the same room.
3. **`horizon-gpt-image-2`**: the calmest and best for legibility.
4. **`still-gemini-3-pro`**: good, but the closest to generic "old math props."

## Outcome

Kyle asked for a traditional footer with a simple image and plain copy, so the shipped footer is link columns and a legal line under a band of `night-gpt-image-2`. It is the only candidate kept in `public/landing/`.

## Notes

- Approximate cost for the eight images: about $1.50–2.00 (gpt-image-2 high ~$0.25 each x4, gemini 2K ~$0.13–0.24 each x4), using the per-image estimates from `../20261101_openai_explorer/hero/README.md`. Not checked against the gateway bill.
