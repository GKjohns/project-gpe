# Figure rasterization inside the render sandbox (TeX snapshot: poppler, Ghostscript, rsvg-convert, Pillow).
# Input: a job file (argv[1]) {"pdf": path|null, "dpi": int, "out": dir, "jobs": [{"id", "page", "rect": [x, y, w, h]}
# | {"id", "files": [paths]}]}. A rect job crops the compiled PDF (PDF points, top-left origin); a files job renders the
# figure's own graphics files (used when the paper did not compile). Every image is trimmed to its ink, padded,
# capped at MAX_SIDE px and written as <out>/<id>.png. Prints one JSON line per job: {"id", "ok", "w", "h", "error"}.
import json
import os
import subprocess
import sys

from PIL import Image, ImageChops, ImageOps

MAX_SIDE = 1600
PAD = 14


def run(args):
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=120)


def trim(img):
    img = img.convert('RGB')
    bg = Image.new('RGB', img.size, (255, 255, 255))
    mask = ImageOps.grayscale(ImageChops.difference(img, bg)).point(lambda p: 255 if p > 16 else 0)
    box = mask.getbbox()
    if not box:
        return img
    x0, y0, x1, y1 = box
    img = img.crop((max(0, x0 - PAD), max(0, y0 - PAD), min(img.width, x1 + PAD), min(img.height, y1 + PAD)))
    return img


def cap(img):
    side = max(img.size)
    if side <= MAX_SIDE:
        return img
    k = MAX_SIDE / side
    return img.resize((max(1, round(img.width * k)), max(1, round(img.height * k))), Image.LANCZOS)


def flatten_alpha(img):
    if img.mode in ('RGBA', 'LA') or (img.mode == 'P' and 'transparency' in img.info):
        rgba = img.convert('RGBA')
        bg = Image.new('RGBA', rgba.size, (255, 255, 255, 255))
        return Image.alpha_composite(bg, rgba).convert('RGB')
    return img.convert('RGB')


def from_file(path, dpi, tmp):
    lower = path.lower()
    if lower.endswith('.pdf'):
        run(['pdftoppm', '-f', '1', '-l', '1', '-r', str(dpi), '-png', '-singlefile', path, tmp])
        return Image.open(tmp + '.png')
    if lower.endswith('.eps') or lower.endswith('.ps'):
        run(['gs', '-q', '-dSAFER', '-dBATCH', '-dNOPAUSE', '-dEPSCrop', '-sDEVICE=png16m', f'-r{dpi}', f'-sOutputFile={tmp}.png', path])
        return Image.open(tmp + '.png')
    if lower.endswith('.svg'):
        run(['rsvg-convert', '-d', str(dpi), '-p', str(dpi), '-o', tmp + '.png', path])
        return Image.open(tmp + '.png')
    return Image.open(path)


def side_by_side(images):
    h = min(max(i.height for i in images), 900)
    scaled = [i.resize((max(1, round(i.width * h / i.height)), h), Image.LANCZOS) for i in images]
    gap = 24
    out = Image.new('RGB', (sum(i.width for i in scaled) + gap * (len(scaled) - 1), h), (255, 255, 255))
    x = 0
    for i in scaled:
        out.paste(i, (x, 0))
        x += i.width + gap
    return out


def main():
    job = json.load(open(sys.argv[1]))
    dpi = int(job.get('dpi', 200))
    out = job['out']
    os.makedirs(out, exist_ok=True)
    for j in job['jobs']:
        tmp = os.path.join(out, '_tmp_' + j['id'])
        try:
            if 'rect' in j:
                x, y, w, h = j['rect']
                s = dpi / 72.0
                run(['pdftoppm', '-f', str(j['page']), '-l', str(j['page']), '-r', str(dpi),
                     '-x', str(max(0, round(x * s))), '-y', str(max(0, round(y * s))),
                     '-W', str(max(1, round(w * s))), '-H', str(max(1, round(h * s))),
                     '-png', '-singlefile', job['pdf'], tmp])
                img = Image.open(tmp + '.png')
            else:
                parts = [flatten_alpha(from_file(f, dpi, f'{tmp}_{k}')) for k, f in enumerate(j['files'])]
                img = parts[0] if len(parts) == 1 else side_by_side([trim(p) for p in parts])
            img = cap(trim(flatten_alpha(img)))
            img.save(os.path.join(out, j['id'] + '.png'), optimize=True)
            print(json.dumps({'id': j['id'], 'ok': True, 'w': img.width, 'h': img.height}), flush=True)
        except Exception as e:  # one bad figure must not sink the rest
            msg = e.stderr.decode('utf8', 'replace')[-300:] if isinstance(e, subprocess.CalledProcessError) and e.stderr else str(e)
            print(json.dumps({'id': j['id'], 'ok': False, 'error': msg[:300]}), flush=True)


main()
