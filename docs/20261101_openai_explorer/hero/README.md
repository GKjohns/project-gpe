# Hero image candidates — "mathematician at a desk"

Generated 2026-11-01 via AI SDK `generateImage` / `generateText` through the Vercel AI Gateway.
Each `.png` is the raw model output; the `.webp` beside it is `cwebp -q 82`, width capped at 1920.

Prompt A = Dutch Golden Age scholar at an oak desk (chiaroscuro, umber/ochre).
Prompt B = Italian High Renaissance elder at a stone study with an arched window onto Tuscany.
Both ask for empty negative space on the left third for a headline.

| File | Model | Prompt | Aspect (px) | Critique |
|---|---|---|---|---|
| `gpt-image-2-a.png` | openai/gpt-image-2 (quality high) | A | 3:2 (1536x1024) | Most convincing old-master surface: craquelure, raking window light, brick townscape through leaded glass. Clean compass, globe, inkwell; hands and face fine. Left ~40% is dark empty wall, ideal for light text. Diagrams on pages are plausible scribble, no readable text. |
| `flux-3-a.png` | bfl/flux-3-image | A | 16:9 (1360x768) | Crisp and tidy, nice compass and circle diagram, good left negative space, but the paneled wall and the smoother finish read more "illustration" than oil; lowest resolution of the set (1360 wide). |
| `seedream-5-a.png` | bytedance/seedream-5.0-pro | A | 16:9 (2816x1584) | Lovely soft Vermeer-ish light and warm wall for overlay, good hands, but carries a visible "AI generated" watermark bottom-right. Unusable as-is; would need a crop or inpaint. |
| `gemini-3-pro-a.png` | google/gemini-3-pro-image (2K) | A | 16:9 (2752x1536) | Most painterly brushwork and the most "creative" pose (scholar looks up mid-thought, quill raised). Left third is pure dark void, great for overlay. Minor nits: expression a touch theatrical, small magnifying-glass/divider clutter, faint pseudo-script on pages. |
| `gpt-image-2-b.png` | openai/gpt-image-2 (quality high) | B | 3:2 (1536x1024) | Elegant and calm: arched window onto a Duomo skyline, armillary sphere, dividers, candle; hand on the dividers is correct. Big plaster wall on the left is the cleanest overlay zone of all six. Slightly flat/illustrative compared to A; crisp rather than sfumato. |
| `gemini-3-pro-b.png` | google/gemini-3-pro-image (2K) | B | 16:9 (2752x1536) | Strong loose brushwork, triple-arched loggia, Tuscan haze, candle glow. Left half is a mottled wall, workable for text. Downsides: the scroll shows legible-looking pseudo-Latin lettering (prompt said no text), and the figure stands rather than sits. |

## Ranking

1. **`gpt-image-2-a`** — best combination of museum-painting texture, correct props, no artifacts, and a dark empty left third that takes white or gold text without any treatment. 3:2 rather than 16:9, so a hero crop loses a bit of top/bottom, but there is slack to spare.
2. **`gemini-3-pro-a`** — the most "alive" and visibly hand-painted of the set, native 16:9 at 2752 wide, and the left third is already near-black. Runner-up only because the upward gaze is a little stagey and the desk clutter is busier than gpt-image-2's.

Honorable mention: `gpt-image-2-b` if Kyle prefers the Renaissance palette and a lighter hero; it has the widest clean overlay area.

## Notes

- Seedream 5.0 Pro warned that `aspectRatio` is unsupported (use `size`), but still returned 16:9; its watermark is the real blocker.
- gemini-3-pro-image is a language model on the gateway: used `generateText` with `providerOptions.google.responseModalities: ['IMAGE']` and `imageConfig: { aspectRatio: '16:9', imageSize: '2K' }`, image read from `result.files`.
- Approximate cost for the six images: about $0.90–1.10 total (gpt-image-2 high ~$0.25 each x2, gemini 2K ~$0.13–0.24 each x2, flux ~$0.05, seedream ~$0.07).
