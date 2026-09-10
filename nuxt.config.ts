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

      /**
       * 【大文件（背景视频 / 背景音乐）的地址前缀】
       *
       * 这两个文件不在 public/ 里，也就是不参与构建（见 static-media/README.md）：
       * 线上由 Nginx 的 `location /media/` 直接从磁盘提供，dev 由 Nitro 的一个
       * 仅开发环境生效的路由提供（server/routes/media/[...file].get.ts）。
       * 两边路径都是 /media，所以这里默认值就是它。
       *
       * 【为什么要做成可配置的】文件从"服务器本地磁盘"换成对象存储 / CDN 时，
       * 只需要改这个前缀（NUXT_PUBLIC_MEDIA_BASE=https://cdn.example.com/media），
       * 代码一行都不用动 —— 因为页面里的地址统一由 app/utils/media.ts 的
       * mediaUrl() 拼出来，没有第二处硬编码。
       *
       * 覆盖方式：环境变量 NUXT_PUBLIC_MEDIA_BASE
       */
      mediaBase: '/media',

      /**
       * 【站点的对外地址】SEO 用：canonical / og:url / sitemap.xml 里的绝对地址。
       *
       * 为什么必须有它：canonical 与 og:url **必须是绝对地址**（规范要求），
       * 只写 /article/12 的话搜索引擎会忽略这条 canonical，
       * 而页面上看不出任何异常 —— 属于"静默失效"那一类问题。
       *
       * 为什么默认值是正式域名、而不是 localhost：本地开发时没人看 SEO，
       * 但本地构建出来的产物如果要验证 canonical，指向一个不存在的本地地址
       * 反而更难判断对错；真正需要区分环境时用环境变量覆盖即可。
       *
       * 覆盖方式：环境变量 NUXT_PUBLIC_SITE_URL
       *   NUXT_PUBLIC_SITE_URL=https://www.yigalaxy.xin
       * 合法性校验在 app/utils/seo.ts 的 normalizeSiteUrl()：
       * 空值、不以 http(s):// 开头、结尾多斜杠都会被收拾成可用形态。
       */
      siteUrl: 'https://www.yigalaxy.xin',
    },
  },
})
