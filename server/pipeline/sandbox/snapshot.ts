/**
 * Method B's base image: a Vercel Sandbox snapshot of node:24 with the Claude Agent SDK installed in /vercel/sandbox/agent.
 * Built once and cached by id in .data/sandbox-snapshot.json (or SANDBOX_SNAPSHOT_ID), so a run boots in seconds and
 * nothing is downloaded at run time through the sandbox's network allow-list.
 * Self-contained (no relative imports) so a plain `node` script can call it too.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { Sandbox, Snapshot } from '@vercel/sandbox'

export const AGENT_DIR = '/vercel/sandbox/agent'
export const PAPER_DIR = '/vercel/sandbox/paper'
// Pinned: the SDK ships its CLI as platform optional deps, so `npm i` at build time pulls the linux binary.
export const AGENT_SDK_VERSION = '0.3.312'
const BASE_IMAGE = 'vercel/sandbox/node:24'
const CACHE_FILE = resolve(process.cwd(), '.data/sandbox-snapshot.json')

interface Cached { snapshotId: string, sdkVersion: string, image: string, createdAt: string }

async function readCache(): Promise<Cached | null> {
  try {
    const c = JSON.parse(await readFile(CACHE_FILE, 'utf8')) as Cached
    return c.sdkVersion === AGENT_SDK_VERSION && c.image === BASE_IMAGE ? c : null
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

/** The snapshot id to boot agent sandboxes from; builds it (~1–2 min) the first time. */
export function ensureSnapshot(log: (msg: string) => void | Promise<void> = () => {}): Promise<string> {
  building ??= (async () => {
    const fromEnv = process.env.SANDBOX_SNAPSHOT_ID
    if (fromEnv) {
      return fromEnv
    }
    const cached = await readCache()
    if (cached && await usable(cached.snapshotId)) {
      return cached.snapshotId
    }
    await log(`sandbox · building snapshot (${BASE_IMAGE} + @anthropic-ai/claude-agent-sdk@${AGENT_SDK_VERSION}); once per SDK version`)
    const sandbox = await Sandbox.create({
      image: BASE_IMAGE,
      resources: { vcpus: 2 },
      timeout: 10 * 60 * 1000,
      keepLastSnapshots: { count: 1 },
      tags: { app: 'gpe', role: 'snapshot-builder' }
    })
    try {
      const install = await sandbox.runCommand({
        cmd: 'bash',
        args: ['-lc', `mkdir -p ${AGENT_DIR} && cd ${AGENT_DIR} && npm init -y >/dev/null && npm i --no-audit --no-fund @anthropic-ai/claude-agent-sdk@${AGENT_SDK_VERSION} zod@4 && node -e "import('@anthropic-ai/claude-agent-sdk').then(m => console.log('sdk ok', typeof m.query))"`]
      })
      const out = await install.stdout()
      if (install.exitCode !== 0) {
        throw new Error(`snapshot build: npm install failed (${install.exitCode}): ${(await install.stderr()).slice(-500)}`)
      }
      if (!out.includes('sdk ok function')) {
        throw new Error(`snapshot build: SDK did not load: ${out.slice(-300)}`)
      }
      // snapshot() stops the sandbox.
      const snap = await sandbox.snapshot({ expiration: 0 })
      const entry: Cached = { snapshotId: snap.snapshotId, sdkVersion: AGENT_SDK_VERSION, image: BASE_IMAGE, createdAt: new Date().toISOString() }
      try {
        await mkdir(dirname(CACHE_FILE), { recursive: true })
        await writeFile(CACHE_FILE, JSON.stringify(entry, null, 2))
      } catch {
        // Read-only filesystem (Vercel): set SANDBOX_SNAPSHOT_ID instead; this instance keeps the id in memory.
      }
      await log(`sandbox · snapshot ${snap.snapshotId} ready`)
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
