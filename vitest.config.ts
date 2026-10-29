import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Mirrors Nitro's raw plugin: prompt files import as strings.
  plugins: [{
    name: 'raw-md',
    // Nitro's `raw:` specifier → Vite's `?raw`.
    resolveId(id, importer) {
      return id.startsWith('raw:') && importer ? `${resolve(dirname(importer), id.slice(4))}?raw` : undefined
    },
    transform(code, id) {
      return id.endsWith('.md') ? `export default ${JSON.stringify(code)}` : undefined
    }
  }],
  resolve: {
    alias: {
      '#shared': fileURLToPath(new URL('./shared', import.meta.url))
    }
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Each file gets its own module graph, so each file's in-memory PGlite (via setDb) is isolated.
    isolate: true,
    testTimeout: 20_000
  }
})
