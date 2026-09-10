// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  // @nuxt/eslint 会生成 .nuxt/eslint.config.mjs（Nuxt 官方的扁平配置），
  // eslint.config.mjs 再基于它做少量覆盖
  //
  // @element-plus/nuxt 是 Element Plus 官方的 Nuxt 模块，负责【按需引入】，
  // 它内部做的事和"手工配 unplugin-vue-components + unplugin-auto-import"是同一套，
  // 只是把三件事一起打包好了（见下方 elementPlus 那一块的长注释）。
  modules: ['@nuxt/eslint', '@element-plus/nuxt'],

  /**
   * 【Element Plus 的按需引入配置】
   *
   * 改之前：app/plugins/element-plus.ts 里 `app.use(ElementPlus)` 全量注册，
   * 再 import 一份 element-plus/dist/index.css（整包 CSS）。
   * 于是 90 多个组件里我们只用了十来种，剩下的全被打进产物。
   *
   * 现在：交给我们自己写插件改成交给 @element-plus/nuxt（模块的 configKey 就是
   * `elementPlus`，所以下面这个对象就是它的配置）。它做三件事：
   *   ① 把每个 Element Plus 组件注册成 Nuxt 的"全局组件"，但每个组件单独一个文件路径
   *      （element-plus/es/components/button/index.mjs 这种），
   *      所以模板里没出现过的组件根本不会进产物；
   *   ② 扫描编译后的代码里所有 `_resolveComponent("el-xxx")` 与
   *      `ElMessage` / `ElMessageBox` / `ElNotification` / `ElLoading` 这四个标识符，
   *      给命中它们的文件自动补一行组件样式的副作用导入；
   *   ③ 提供一个插件注入 Element Plus 的 ID / Z-Index 注入键
   *      （不注入的话 SSR 时会刷一堆 ZIndexInjection / IdInjection 警告）。
   */
  elementPlus: {
    /**
     * 【importStyle: 'css' 在选什么】组件样式的形态。三个取值：
     *   · 'css'  ——（选这个）每个组件引它编译好的 .css，浏览器直接吃，
     *               不需要 Sass 编译器，构建也更快
     *   · 'scss' —— 引组件的 .scss 源码，好处是能用 themeChalk 覆盖主题变量
     *               （改主色之类），代价是构建要多跑一遍 Sass
     *   · false  —— 一条样式都不引，样式得自己全量引或者自己写
     * 我们只想要"用到的组件带自己的样式"，不需要改 Element Plus 的主题变量
     * （`.panel` 里那套暗色适配走的是 CSS 变量覆盖，跟这里无关），
     * 所以选 'css'：少一层编译，产物是浏览器能直接解析的 CSS。
     */
    importStyle: 'css',

    /**
     * 【icon: false —— 关掉"把整套图标都注册成全局组件"这件事】
     *
     * 这个模块默认会把 @element-plus/icons-vue 里的**整套图标**（当前版本 293 个导出）
     * 全部注册成 Nuxt 的全局组件（名字形如 `ElIconPlus`，好让你在模板里直接写
     * `<el-icon-plus />`）。我们一个都没用（全站搜不到 el-icon 的用法；
     * Element Plus 组件内部自己要用的箭头、叉号是那些组件各自 import 的，跟这个开关无关），
     * 所以这堆注册纯属白搭。关掉之后的**效果**是：Nuxt 生成的组件清单里
     * `ElIcon*` 这类声明从 586 条变成 **0 条**
     * （586 = 293 + 293 —— 每注册一个全局组件，Nuxt 会生成 `ElIconXxx` 与
     * `LazyElIconXxx` 两条声明，实测两边各 293）。
     *
     * 【⚠️ 这里为什么不写"从 x 字节降到 y 字节"（我第一版就是这么写的，写错了）】
     *   `.nuxt/components.d.ts` 是**派生产物**：内容随代码变（多一个组件就多几条），
     *   而且实测**只有 `npx nuxi prepare` 会写它** —— `npm run build` 与 `npm run test`
     *   跑完它的 mtime 纹丝不动（专门验过）。所以我原来那组"104 423 → 6 157 字节"
     *   是把**两次不同条件下**量到的值并排写了（一次是 prepare 写的、一次是更早、
     *   组件更少的时候写的），别人在当前工作区上根本复现不出来。
     *   要量它请固定写清命令：`npx nuxi prepare` 之后立刻看，
     *   而且更要紧的是看**有没有 `ElIcon*` 条目**（0 条是绝对的），而不是看字节数。
     *
     * 【⚠️ 它不改变产物，这一点必须说清】
     *   加与不加 `icon: false`，`npm run build` 出来的 `_nuxt` 里**所有资源文件逐字节一样**：
     *   A/B 两次构建的 **138 个资源（132 个 JS + 6 个 CSS）的路径 / 大小 / SHA256 完全相同**
     *   （用 SHA256 清单逐条比对），JS 总量都是 2 487 246 字节 / gzip 896 694、
     *   CSS 都是 299 404 / gzip 52 292，最大的 chunk 同名同内容（`C28LwzqT.js`，581 913 字节）。
     *   唯一不同的是 Nitro 自己的构建元数据（`_nuxt/builds/latest.json` 与
     *   `_nuxt/builds/meta/<uuid>.json`）—— 那两个文件**每次构建都会变**，
     *   同一份配置连跑两次也在这里不同，所以与这行配置无关。
     *   原因：Nuxt 的全局组件是**懒加载**的，模板里没出现过的组件根本不会被 import 进包。
     *   由此还能推出一个反例：**"在产物里搜 `icons-vue` / `UserFilled` 得到 0 次"
     *   不能当作这行配置生效的证据** —— 不加它同样是 0 次（实测对过）。
     *
     * 【那为什么还留着它】注册 586 个永远用不到的全局组件没有任何意义，
     *   成本是一行配置；它换来的是 Nuxt 组件清单干净。
     *
     * 【⚠️ 说清楚它没能解决什么，免得后人以为它能治那个问题】
     *   单测里"把 Nuxt 环境搭起来"那一步从 2.9 秒涨到 11 秒，**不是**这堆图标造成的
     *   —— 实测把它关掉、甚至把 `components` 传成空数组（一个组件都不注册），
     *   那一步仍然是 11 秒。真正的开销是这个模块在**配置加载期**就
     *   `import * as AllComponents from 'element-plus'`（要把组件枚举出来才能逐个注册），
     *   而 nuxt.config 是被 jiti 逐文件转换执行的。那个开销躲不掉，
     *   处理办法见 vitest.config.ts 里的 `hookTimeout`。
     *
     * 【为什么敢关】这不是"少一个功能"，而是"少一套自动注册"：
     *   哪天真要用图标，`import { Plus } from '@element-plus/icons-vue'` 之后
     *   写 `<el-icon><Plus /></el-icon>` 照样能用（显式导入永远合法），
     *   或者把这一行删掉即可 —— 它只是一行配置，不是一个要重写的地方。
     */
    icon: false,
  },

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
