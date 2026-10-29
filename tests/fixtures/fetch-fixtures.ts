// Downloads the ETH source into tests/fixtures/latex/eth/ and Huang's sensitivity paper into
// tests/fixtures/latex/sensitivity/ (both gitignored) the first time a test needs them.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

export const ETH_GITHUB_URL = 'https://github.com/openai/math/tree/main/preprints/The-Exponential-Time-Hypothesis-is-False-October-25-2026/build'
const RAW = 'https://raw.githubusercontent.com/openai/math/main/preprints/The-Exponential-Time-Hypothesis-is-False-October-25-2026/build'
const FILES = ['main_full_version.tex', 'quantitative-circuits.tex', 'quantitative-contraction.tex', 'quantitative-reduction.tex']
const DIR = fileURLToPath(new URL('./latex/eth/', import.meta.url))

export async function ensureEthFixture(): Promise<{ path: string, content: string }[]> {
  mkdirSync(DIR, { recursive: true })
  for (const name of FILES) {
    if (!existsSync(DIR + name)) {
      const res = await fetch(`${RAW}/${name}`)
      if (!res.ok) {
        throw new Error(`fetch-fixtures: ${name} → HTTP ${res.status}`)
      }
      writeFileSync(DIR + name, await res.text())
    }
  }
  return readdirSync(DIR).filter(f => f.endsWith('.tex')).sort()
    .map(path => ({ path, content: readFileSync(DIR + path, 'utf8') }))
}

export function readFixtureDir(rel: string): { path: string, content: string }[] {
  const root = fileURLToPath(new URL(`./latex/${rel}/`, import.meta.url))
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
    .flatMap(d => d.isDirectory() ? walk(`${dir}${d.name}/`) : [`${dir}${d.name}`])
  return walk(root).map(p => ({ path: p.slice(root.length), content: readFileSync(p, 'utf8') }))
}

const SENSITIVITY_DIR = fileURLToPath(new URL('./latex/sensitivity/', import.meta.url))

/** arXiv 1907.00847's e-print is a single gzipped .tex; saved under the name the app's fetcher gives it. */
export async function ensureSensitivityFixture(): Promise<{ path: string, content: string }[]> {
  const path = '1907.00847.tex'
  if (!existsSync(SENSITIVITY_DIR + path)) {
    const res = await fetch('https://arxiv.org/e-print/1907.00847')
    if (!res.ok) {
      throw new Error(`fetch-fixtures: arXiv 1907.00847 → HTTP ${res.status}`)
    }
    mkdirSync(SENSITIVITY_DIR, { recursive: true })
    writeFileSync(SENSITIVITY_DIR + path, gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8'))
  }
  return [{ path, content: readFileSync(SENSITIVITY_DIR + path, 'utf8') }]
}
