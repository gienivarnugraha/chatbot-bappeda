// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: false },
  modules: ['@nuxt/ui', '@nuxt/eslint', '@nuxtjs/mdc'],
  css: ['~/assets/css/main.css'],
  typescript: {
    typeCheck: true
  },
  vite: {
    server: {
    },
    plugins: [
    ]
  }
})