# Renders public/og.jpg (1200x630), the share card: the landing hero with the name and tagline over a left fade.
# Run from the repo root: python3 docs/20261106_proofmap/og_card.py <path to CormorantGaramond[wght].ttf>
# (the variable font from github.com/google/fonts/tree/main/ofl/cormorantgaramond; the site loads the same face).
import sys
from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 630
SERIF = sys.argv[1]
SANS = '/System/Library/Fonts/HelveticaNeue.ttc'

hero = Image.open('public/landing/hero.webp').convert('RGB')
# Cover-crop to 1.91:1, keeping the right side (the scholar) in frame.
scale = max(W / hero.width, H / hero.height)
hero = hero.resize((round(hero.width * scale), round(hero.height * scale)), Image.LANCZOS)
x0 = hero.width - W
y0 = (hero.height - H) // 2
card = hero.crop((x0, y0, x0 + W, y0 + H))

# Left-to-right fade into the hero's own near-black, so the text sits on dark paper.
fade = Image.new('L', (W, 1))
for x in range(W):
    t = x / W
    fade.putpixel((x, 0), round(255 * max(0.0, min(1.0, (0.78 - t) / 0.5)) ** 0.9 * 0.92))
fade = fade.resize((W, H))
card = Image.composite(Image.new('RGB', (W, H), (20, 16, 11)), card, fade)

d = ImageDraw.Draw(card)


def serif(size, weight):
    f = ImageFont.truetype(SERIF, size)
    f.set_variation_by_axes([weight])
    return f


ink = (246, 240, 228)
muted = (205, 196, 180)
LEFT = 72
d.text((LEFT, 64), 'Proofmap', font=ImageFont.truetype(SANS, 34, index=1), fill=ink)
d.text((LEFT, 204), 'Follow the proof.', font=serif(96, 600), fill=ink)
sub = ImageFont.truetype(SANS, 32)
d.text((LEFT, 340), "Step-by-step maps of OpenAI's", font=sub, fill=muted)
d.text((LEFT, 382), 'math papers, in plain English.', font=sub, fill=muted)
d.text((LEFT, 540), 'proofmap.ink', font=ImageFont.truetype(SANS, 26), fill=(170, 160, 142))

card.save('public/og.jpg', quality=88, optimize=True, progressive=True)
print('wrote public/og.jpg')
