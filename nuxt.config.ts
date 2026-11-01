// https://nuxt.com/docs/api/configuration/nuxt-config
import { fileURLToPath } from 'node:url'

export default defineNuxtConfig({
  modules: [
    '@nuxt/eslint',
    '@nuxt/ui',
    '@comark/nuxt',
    '@nuxtjs/supabase'
  ],

  devtools: {
    enabled: true
  },

  css: ['~/assets/css/main.css'],

  // AI_GATEWAY_API_KEY is read from process.env directly (gateway). SUPABASE_* go through the supabase block below.
  runtimeConfig: {
    public: {
      appUrl: 'http://localhost:3120'
    }
  },

  // The module maps `#supabase/database` for Nitro and the server tsconfig only, but the app tsconfig also compiles
  // server/utils through Nitro's generated auto-import and route types; same file the module points at.
  alias: {
    '#supabase/database': fileURLToPath(new URL('./app/types/database.types.ts', import.meta.url))
  },

  // The @supabase/* packages ship ESM that Nitro's build step chokes on (supabase_auth.md § 1).
  build: {
    transpile: [
      '@supabase/supabase-js', '@supabase/auth-js', '@supabase/functions-js',
      '@supabase/postgrest-js', '@supabase/realtime-js', '@supabase/storage-js'
    ]
  },

  compatibilityDate: '2026-06-30',

  // Nitro builds one Vercel function, so this is the ceiling for /api/inngest's step invocations (the whole-paper
  // Opus outline/critique steps are the longest, ~2 min on ETH) and for everything else. 800 s is Fluid compute's max.
  // Tasks (server/tasks/) replace the tsx operator scripts; their HTTP routes exist only in dev.
  nitro: {
    // File tracing drops `tslib/modules/index.js` once a Supabase package reaches a server chunk, and the built server
    // won't boot (ERR_MODULE_NOT_FOUND). Camera Shy and Daylight inline it for the same reason.
    externals: {
      inline: ['tslib']
    },
    experimental: {
      tasks: true
    },
    vercel: {
      functions: {
        maxDuration: 800
      }
    }
  },

  eslint: {
    config: {
      stylistic: {
        commaDangle: 'never',
        braceStyle: '1tbs'
      }
    }
  },

  // Data only: every read and write is server-side through the service-role client (server/utils/supabase.ts). No
  // Supabase Auth, so `redirect: false` (the module's default guard would bounce every page to its /login) and none
  // of the auth plugins, redirect paths or cookie options Camera Shy carries.
  supabase: {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_KEY,
    secretKey: process.env.SUPABASE_SECRET_KEY,
    redirect: false
  }
})
