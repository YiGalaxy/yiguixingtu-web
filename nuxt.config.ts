// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  // @nuxt/eslint 会生成 .nuxt/eslint.config.mjs（Nuxt 官方的扁平配置），
  // eslint.config.mjs 再基于它做少量覆盖
  modules: ['@nuxt/eslint'],
  runtimeConfig: {
    public: {
      apiBase: 'http://localhost:8082',   // 后端 Spring Boot 地址（注意：不是 8081，8081 留给「星途点评」项目）
    },
  },
})
