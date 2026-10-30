/**
 * The render stage's base image: a Vercel Sandbox snapshot of the universal (Ubuntu) image with TeX Live 2025 from
 * the distro (pdfLaTeX, XeLaTeX, LuaLaTeX, latexmk, biber; the collections arXiv papers lean on), poppler-utils,
 * Ghostscript, rsvg-convert and Pillow for figure rasterization. Built once (~3 min) and cached by id in
 * .data/sandbox-tex-snapshot.json (or SANDBOX_TEX_SNAPSHOT_ID). Render sandboxes boot from it with no network.
 * Self-contained (no relative imports), like snapshot.ts.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { Sandbox, Snapshot } from '@vercel/sandbox'

export const RENDER_DIR = '/vercel/sandbox/render'
// Bump when the package list changes so a stale snapshot is rebuilt.
export const TEX_IMAGE_VERSION = 'texlive2025-ubuntu-v1'
const BASE_IMAGE = 'vercel/sandbox/universal'
const CACHE_FILE = resolve(process.cwd(), '.data/sandbox-tex-snapshot.json')

export const TEX_PACKAGES = [
  'texlive-latex-recommended', 'texlive-latex-extra', 'texlive-science', 'texlive-pictures', 'texlive-publishers',
  'texlive-fonts-recommended', 'texlive-fonts-extra', 'texlive-bibtex-extra', 'texlive-plain-generic',
  'texlive-xetex', 'texlive-luatex', 'lmodern', 'cm-super', 'latexmk', 'biber',
  'poppler-utils', 'ghostscript', 'librsvg2-bin', 'python3-pil'
]

interface Cached { snapshotId: string, version: string, createdAt: string }

async function readCache(): Promise<Cached | null> {
  try {
    const c = JSON.parse(await readFile(CACHE_FILE, 'utf8')) as Cached
    return c.version === TEX_IMAGE_VERSION ? c : null
  } catch {
    return null
  }
}

async function usable(snapshotId: string): Promise<boolean> {
  try {
    const s = await Snapshot.get({ snapshotId })
    return s.status === 'created'
  } catch {
    return false
  }
}

let building: Promise<string> | null = null

/** The snapshot id render sandboxes boot from; builds it the first time. */
export function ensureTexSnapshot(log: (msg: string) => void | Promise<void> = () => {}): Promise<string> {
  building ??= (async () => {
    const fromEnv = process.env.SANDBOX_TEX_SNAPSHOT_ID
    if (fromEnv) {
      return fromEnv
    }
    const cached = await readCache()
    if (cached && await usable(cached.snapshotId)) {
      return cached.snapshotId
    }
    await log(`render · building the TeX snapshot (${BASE_IMAGE} + TeX Live 2025, poppler, Pillow; ~3 min, once)`)
    const sandbox = await Sandbox.create({
      image: BASE_IMAGE,
      resources: { vcpus: 4 },
      timeout: 20 * 60 * 1000,
      keepLastSnapshots: { count: 1 },
      tags: { app: 'gpe', role: 'tex-snapshot-builder' }
    })
    try {
      const install = await sandbox.runCommand({
        cmd: 'bash',
        args: ['-lc', [
          'set -e',
          'sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq',
          `sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends ${TEX_PACKAGES.join(' ')} > /tmp/apt.log 2>&1 || (tail -40 /tmp/apt.log; exit 1)`,
          `mkdir -p ${RENDER_DIR}`,
          // Warm the font and format caches so the first real compile doesn't pay for them.
          `cd /tmp && printf '%s\\n' '\\documentclass{article}' '\\usepackage[T1]{fontenc}\\usepackage{lmodern,amsmath,amssymb,tikz,graphicx,hyperref}' '\\begin{document}Warm $x^2$.\\end{document}' > warm.tex && latexmk -pdf -interaction=nonstopmode warm.tex > /dev/null 2>&1`,
          'python3 -c "import PIL; print(\'pil ok\')"',
          'pdflatex --version | head -1; pdftoppm -v 2>&1 | head -1'
        ].join(' && ')]
      })
      const out = await install.stdout()
      if (install.exitCode !== 0 || !out.includes('pil ok')) {
        throw new Error(`TeX snapshot build failed (${install.exitCode}): ${(out + await install.stderr()).slice(-800)}`)
      }
      const snap = await sandbox.snapshot({ expiration: 0 })
      const entry: Cached = { snapshotId: snap.snapshotId, version: TEX_IMAGE_VERSION, createdAt: new Date().toISOString() }
      try {
        await mkdir(dirname(CACHE_FILE), { recursive: true })
        await writeFile(CACHE_FILE, JSON.stringify(entry, null, 2))
      } catch {
        // Read-only filesystem (Vercel): set SANDBOX_TEX_SNAPSHOT_ID instead; this instance keeps the id in memory.
      }
      await log(`render · TeX snapshot ${snap.snapshotId} ready`)
      return snap.snapshotId
    } catch (err) {
      await sandbox.stop().catch(() => {})
      throw err
    }
  })().catch((err) => {
    building = null
    throw err
  })
  return building
}
