import tailwindcss from '@tailwindcss/vite'

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  css: ['~/assets/css/main.css'],

  modules: ['@nuxt/eslint'],

  vite: {
    plugins: [tailwindcss()],
  },

  typescript: {
    strict: true,
  },

  // Private runtime config — NEVER exposed to the client.
  // Values come from .env (PRD §10); NUXT_-prefixed env vars also work.
  runtimeConfig: {
    databaseUrl: process.env.DATABASE_URL ?? '',
    sessionSecret: process.env.SESSION_SECRET ?? '',
    kenari: {
      apiKey: process.env.KENARI_API_KEY ?? '',
      baseUrl: process.env.KENARI_BASE_URL ?? 'https://kenari.id/v1',
      model: process.env.KENARI_MODEL ?? '',
    },
  },

  app: {
    head: {
      // NOTE: no class here — the theme-init script below owns the `dark` class
      // (unhead would otherwise re-apply a config class on hydration and
      // override the user's saved light preference after reload).
      htmlAttrs: { lang: 'id' },
      title: 'Financial OS',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'description', content: 'Self-hosted personal financial intelligence' },
      ],
      // Apply the stored light/dark preference before first paint (no flash).
      script: [
        {
          key: 'theme-init',
          innerHTML:
            "(function(){try{var t=localStorage.getItem('finos-theme');if(t==='light'){document.documentElement.classList.remove('dark')}else{document.documentElement.classList.add('dark')}}catch(e){}})()",
        },
      ],
    },
  },
})
