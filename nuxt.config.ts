// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: [
    '@nuxt/eslint',
    '@nuxt/ui',
    '@comark/nuxt'
  ],

  devtools: {
    enabled: true
  },

  css: ['~/assets/css/main.css'],

  // AI_GATEWAY_API_KEY and DATABASE_URL are read from process.env directly (gateway, server/db/index.ts).
  runtimeConfig: {
    public: {
      appUrl: 'http://localhost:3120'
    }
  },

  compatibilityDate: '2026-06-30',

  // Nitro builds one Vercel function, so this is the ceiling for /api/inngest's step invocations (the whole-paper
  // Opus outline/critique steps are the longest, ~2 min on ETH) and for everything else. 800 s is Fluid compute's max.
  nitro: {
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
  }
})
