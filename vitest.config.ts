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
      '#shared': fileURLToPath(new URL('./shared', import.meta.url)),
      // Tests never reach Supabase (dev and prod are one project): the module's server entry is a stub that throws,
      // and tests inject tests/helpers/fakeSupabase.ts with setSupabase().
      '#supabase/server': fileURLToPath(new URL('./tests/helpers/supabaseServerStub.ts', import.meta.url)),
      '#supabase/database': fileURLToPath(new URL('./app/types/database.types.ts', import.meta.url))
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
