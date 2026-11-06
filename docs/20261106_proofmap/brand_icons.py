# Renders Proofmap's icon set into public/: favicon.svg, favicon.ico (16/32/48), favicon-96x96.png,
# apple-touch-icon.png (180, opaque), web-app-manifest-192x192.png / -512x512.png (maskable), site.webmanifest.
# The icon is a plain serif "P" (Cormorant Garamond, the site's display face) in cream on the near-black tile.
# Run from the repo root: python3 docs/20261106_proofmap/brand_icons.py <CormorantGaramond[wght].ttf>  (writes the set)
#   (the variable font from github.com/google/fonts/tree/main/ofl/cormorantgaramond)
# With --sheet <out.png> it instead draws the candidate marks at 16/32/180 px on light and dark tab colors.
# Names follow the brand-assets skill's long-name set.
import json
import sys
from PIL import Image, ImageDraw, ImageFont

INK = '#14100b'    # footer / landing near-black
CREAM = '#f6f0e4'  # footer text
SS = 8             # supersampling for the raster renders
FONT = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith('--') else None

# --- marks, in a 64-unit box ------------------------------------------------------------------------------------
# Each is a list of primitives: ('line', x1, y1, x2, y2, width) with round caps, ('dot', cx, cy, r), ('ring', cx, cy, r, width),
# ('glyph', mask, x0, y0, x1, y1): a pre-rendered font glyph (sheet only).

# A. Node P: the P's bowl is a hollow node, its stem an edge running down to a solid node. Reads as a P and as a map pin.
NODE_P = [('line', 22, 24, 22, 42, 7), ('ring', 32, 24, 10, 7), ('dot', 22, 48, 8)]

# B. Proof tree: the theorem on top, two lemmas under it, as the explorer draws it.
TREE = [('line', 32, 17, 17, 46, 5), ('line', 32, 17, 47, 46, 5), ('dot', 32, 17, 9), ('dot', 17, 46, 7), ('dot', 47, 46, 7)]


WEIGHT = 600  # semibold: the hairlines survive at 16px


def serif_p():
    """The chosen mark: a plain Cormorant Garamond 'P' (FONT: the site's variable font as .ttf). Carries both a raster
    mask (PNG/ICO) and the glyph outline as an SVG path in font units (favicon.svg), so every size is the same letter."""
    from fontTools.pens.svgPathPen import SVGPathPen
    from fontTools.pens.boundsPen import BoundsPen
    from fontTools.ttLib import TTFont
    from fontTools.varLib.instancer import instantiateVariableFont

    tt = TTFont(FONT)
    if 'fvar' in tt:
        tt = instantiateVariableFont(tt, {'wght': WEIGHT})
    gs = tt.getGlyphSet()
    name = tt.getBestCmap()[ord('P')]
    bp = BoundsPen(gs)
    gs[name].draw(bp)
    bx0, by0, bx1, by1 = bp.bounds
    pen = SVGPathPen(gs)
    gs[name].draw(pen)
    # Font units are y-up; flip into a y-down viewBox spanning the glyph's ink.
    d = f'<g transform="matrix(1 0 0 -1 0 {f(by0 + by1)})"><path d="{pen.getCommands()}"/></g>'
    view = (bx0, by0, bx1 - bx0, by1 - by0)

    font = ImageFont.truetype(FONT, 800)
    try:
        font.set_variation_by_axes([WEIGHT])
    except OSError:
        pass
    m = Image.new('L', (900, 1100), 0)
    ImageDraw.Draw(m).text((50, 50), 'P', font=font, fill=255)
    glyph = m.crop(m.getbbox())
    h = 52
    w = h * view[2] / view[3]
    x0, y0 = 32 - w / 2, 6
    return [('glyph', glyph, x0, y0, x0 + w, y0 + h, d, view)]


def bbox(prims):
    xs, ys = [], []
    for p in prims:
        if p[0] == 'line':
            _, x1, y1, x2, y2, w = p
            xs += [x1 - w / 2, x1 + w / 2, x2 - w / 2, x2 + w / 2]
            ys += [y1 - w / 2, y1 + w / 2, y2 - w / 2, y2 + w / 2]
        elif p[0] == 'dot':
            xs += [p[1] - p[3], p[1] + p[3]]
            ys += [p[2] - p[3], p[2] + p[3]]
        elif p[0] == 'ring':
            r = p[3] + p[4] / 2
            xs += [p[1] - r, p[1] + r]
            ys += [p[2] - r, p[2] + r]
        else:
            xs += [p[2], p[4]]
            ys += [p[3], p[5]]
    return min(xs), min(ys), max(xs), max(ys)


def fit(prims, size):
    """Centre the mark in the 64 box and scale its longer side to `size` units."""
    x0, y0, x1, y1 = bbox(prims)
    s = size / max(x1 - x0, y1 - y0)
    dx, dy = 32 - (x0 + x1) / 2 * s, 32 - (y0 + y1) / 2 * s
    out = []
    for p in prims:
        if p[0] == 'line':
            out.append(('line', dx + p[1] * s, dy + p[2] * s, dx + p[3] * s, dy + p[4] * s, p[5] * s))
        elif p[0] == 'dot':
            out.append(('dot', dx + p[1] * s, dy + p[2] * s, p[3] * s))
        elif p[0] == 'ring':
            out.append(('ring', dx + p[1] * s, dy + p[2] * s, p[3] * s, p[4] * s))
        else:
            out.append(('glyph', p[1], dx + p[2] * s, dy + p[3] * s, dx + p[4] * s, dy + p[5] * s, *p[6:]))
    return out


# --- SVG ----------------------------------------------------------------------------------------------------------
def f(v):
    return f'{v:.2f}'.rstrip('0').rstrip('.')


def svg_shapes(prims):
    parts = []
    for p in prims:
        if p[0] == 'line':
            parts.append(f'<path d="M{f(p[1])} {f(p[2])}L{f(p[3])} {f(p[4])}" stroke-width="{f(p[5])}" stroke-linecap="round" fill="none" stroke="currentColor"/>')
        elif p[0] == 'dot':
            parts.append(f'<circle cx="{f(p[1])}" cy="{f(p[2])}" r="{f(p[3])}" fill="currentColor"/>')
        elif p[0] == 'ring':
            parts.append(f'<circle cx="{f(p[1])}" cy="{f(p[2])}" r="{f(p[3])}" stroke-width="{f(p[4])}" fill="none" stroke="currentColor"/>')
        elif len(p) > 6:
            # A font glyph: its outline in a nested viewBox stretched over the fitted box.
            vx, vy, vw, vh = p[7]
            parts.append(f'<svg x="{f(p[2])}" y="{f(p[3])}" width="{f(p[4] - p[2])}" height="{f(p[5] - p[3])}" '
                         f'viewBox="{f(vx)} {f(vy)} {f(vw)} {f(vh)}" preserveAspectRatio="none" fill="currentColor">{p[6]}</svg>')
    return ''.join(parts)


def tile_svg(prims):
    """Cream mark on a rounded near-black tile: legible on light and dark tab strips alike."""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
            f'<rect width="64" height="64" rx="14" fill="{INK}"/><g color="{CREAM}">{svg_shapes(fit(prims, 44))}</g></svg>\n')


def bare_svg(prims):
    """The mark alone; ink on light, cream where the viewer prefers dark."""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
            f'<style>g{{color:{INK}}}@media (prefers-color-scheme:dark){{g{{color:{CREAM}}}}}</style>'
            f'<g>{svg_shapes(fit(prims, 60))}</g></svg>\n')


# --- raster -------------------------------------------------------------------------------------------------------
def draw_mark(img, prims, color, box):
    """Draw prims (64-unit space) into the square `box` (x, y, size) of a supersampled RGBA image."""
    bx, by, bs = box
    k = bs / 64
    mask = Image.new('L', img.size, 0)
    d = ImageDraw.Draw(mask)
    for p in prims:
        if p[0] == 'line':
            _, x1, y1, x2, y2, w = p
            d.line([(bx + x1 * k, by + y1 * k), (bx + x2 * k, by + y2 * k)], fill=255, width=round(w * k))
            for x, y in ((x1, y1), (x2, y2)):
                r = w * k / 2
                d.ellipse([bx + x * k - r, by + y * k - r, bx + x * k + r, by + y * k + r], fill=255)
        elif p[0] == 'dot':
            _, cx, cy, r = p
            d.ellipse([bx + (cx - r) * k, by + (cy - r) * k, bx + (cx + r) * k, by + (cy + r) * k], fill=255)
        elif p[0] == 'ring':
            _, cx, cy, r, w = p
            ro, ri = (r + w / 2) * k, (r - w / 2) * k
            d.ellipse([bx + cx * k - ro, by + cy * k - ro, bx + cx * k + ro, by + cy * k + ro], fill=255)
            d.ellipse([bx + cx * k - ri, by + cy * k - ri, bx + cx * k + ri, by + cy * k + ri], fill=0)
        else:
            _, g, gx0, gy0, gx1, gy1 = p[:6]
            box = (round(bx + gx0 * k), round(by + gy0 * k))
            mask.paste(255, box, g.resize((round((gx1 - gx0) * k), round((gy1 - gy0) * k)), Image.LANCZOS))
    img.paste(Image.new('RGBA', img.size, color), (0, 0), mask)


def icon(prims, px, kind):
    """kind: 'tile' (rounded, transparent corners), 'full' (opaque square), 'mask' (opaque, mark in the safe zone)."""
    S = px * SS
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    if kind == 'tile':
        ImageDraw.Draw(img).rounded_rectangle([0, 0, S - 1, S - 1], radius=S * 14 / 64, fill=INK)
        mark = fit(prims, 44)
    else:
        img.paste(Image.new('RGBA', (S, S), INK))
        mark = fit(prims, 40 if kind == 'full' else 32)  # maskable: mark inside the central 80% circle with room
    draw_mark(img, mark, CREAM, (0, 0, S))
    return img.resize((px, px), Image.LANCZOS)


# --- outputs ------------------------------------------------------------------------------------------------------
def write_set(prims, out='public'):
    open(f'{out}/favicon.svg', 'w').write(tile_svg(prims))
    icon(prims, 96, 'tile').save(f'{out}/favicon-96x96.png', optimize=True)
    icon(prims, 180, 'full').convert('RGB').save(f'{out}/apple-touch-icon.png', optimize=True)
    for px in (192, 512):
        icon(prims, px, 'mask').convert('RGB').save(f'{out}/web-app-manifest-{px}x{px}.png', optimize=True)
    # Each ICO size is rendered on its own rather than downscaled from one bitmap, so 16px stays crisp.
    ico = [icon(prims, px, 'tile') for px in (16, 32, 48)]
    ico[2].save(f'{out}/favicon.ico', format='ICO', sizes=[(16, 16), (32, 32), (48, 48)], append_images=ico[:2])
    manifest = {
        'name': 'Proofmap',
        'short_name': 'Proofmap',
        'description': 'Step-by-step proof maps of OpenAI\'s math papers, in plain English.',
        'start_url': '/',
        'scope': '/',
        'display': 'standalone',
        'theme_color': INK,
        'background_color': INK,
        'icons': [
            {'src': '/web-app-manifest-192x192.png', 'sizes': '192x192', 'type': 'image/png', 'purpose': 'maskable'},
            {'src': '/web-app-manifest-512x512.png', 'sizes': '512x512', 'type': 'image/png', 'purpose': 'maskable'},
            {'src': '/favicon-96x96.png', 'sizes': '96x96', 'type': 'image/png', 'purpose': 'any'},
            {'src': '/favicon.svg', 'sizes': 'any', 'type': 'image/svg+xml', 'purpose': 'any'}
        ]
    }
    open(f'{out}/site.webmanifest', 'w').write(json.dumps(manifest, indent=2) + '\n')


def sheet(candidates, path):
    """Each candidate's favicon tile at 16, 32 and 180 px (plus 16 px blown up 6x, nearest-neighbour) on a light and
    a dark tab strip (Chrome's #dee1e6 and #202124)."""
    rows, pad, label_w = len(candidates), 28, 190
    col_w = 16 * 6 + 32 + 180 + pad * 5 + 16
    W, H = label_w + col_w * 2, 60 + rows * (180 + pad * 2)
    img = Image.new('RGB', (W, H), '#ffffff')
    d = ImageDraw.Draw(img)
    sans = ImageFont.truetype('/System/Library/Fonts/HelveticaNeue.ttc', 18)
    for j, (bg, name) in enumerate((('#dee1e6', 'light tab'), ('#202124', 'dark tab'))):
        x0 = label_w + j * col_w
        d.rectangle([x0, 0, x0 + col_w, H], fill=bg)
        d.text((x0 + pad, 20), f'{name}: 16 · 32 · 180 · 16 at 6x', font=sans, fill='#333' if j == 0 else '#ddd')
    for i, (name, prims) in enumerate(candidates):
        y = 60 + i * (180 + pad * 2) + pad
        d.text((16, y + 80), name, font=sans, fill='#222')
        for j in range(2):
            x = label_w + j * col_w + pad
            for px in (16, 32, 180):
                ic = icon(prims, px, 'tile')
                img.paste(ic, (x, y + (180 - px) // 2), ic)
                x += px + pad
            big = icon(prims, 16, 'tile').resize((96, 96), Image.NEAREST)
            img.paste(big, (x, y + 42), big)
    img.save(path)


if __name__ == '__main__':
    if '--sheet' in sys.argv:
        cands = [('A. Node P', NODE_P), ('B. Proof tree', TREE)] + ([('C. Serif P', serif_p())] if FONT else [])
        sheet(cands, sys.argv[sys.argv.index('--sheet') + 1])
    else:
        # Kyle's pick (Nov 6): the plain serif P, no node mark.
        write_set(serif_p())
