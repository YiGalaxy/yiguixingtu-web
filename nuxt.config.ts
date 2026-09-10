// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  // @nuxt/eslint 会生成 .nuxt/eslint.config.mjs（Nuxt 官方的扁平配置），
  // eslint.config.mjs 再基于它做少量覆盖
  modules: ['@nuxt/eslint'],

  runtimeConfig: {
    /**
     * 【服务端专用地址】不会打进浏览器产物。
     *
     * 为什么要有它：文章详情页是 SSR 的，请求发生在服务器上。
     * 如果那时也去请求公开域名（https://你的域名/api），就会绕一圈公网 +
     * Nginx + DNS 再回到同一台机器的后端，白白多几十毫秒，
     * 而且域名没配好时 SSR 直接就挂了。服务端直接走内网/本机地址最稳。
     *
     * 覆盖方式：环境变量 NUXT_API_BASE_SERVER（Nuxt 按名字自动映射）
     */
    apiBaseServer: 'http://localhost:8082',

    public: {
      /**
       * 【浏览器用的地址】会打进前端产物，所以【不能放密钥】。
       * 覆盖方式：环境变量 NUXT_PUBLIC_API_BASE
       */
      apiBase: 'http://localhost:8082',
    },
  },
})
