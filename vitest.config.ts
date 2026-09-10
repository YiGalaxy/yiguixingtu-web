import { defineVitestConfig } from '@nuxt/test-utils/config'

export default defineVitestConfig({
  test: {
    /**
     * 【为什么必须用 nuxt 环境，而不是普通的 jsdom / happy-dom】
     * 被测代码（useApi / useAuth / useAuthUi）用的是 Nuxt 自动导入的 API：
     *   useRuntimeConfig / useCookie / useState / $fetch / navigateTo
     * 这些在裸的 node / jsdom 里根本不存在，测试连跑都跑不起来。
     * nuxt 环境会把这些 API 按真实 Nuxt 运行时提供出来，
     * 所以测的是"代码在 Nuxt 里的真实行为"，而不是把依赖全 mock 掉自己骗自己。
     */
    environment: 'nuxt',

    /**
     * 测试文件统一放 test/ 下。
     * 文件名用 .nuxt.spec.ts 结尾是 @nuxt/test-utils 的约定写法，
     * 一眼能看出这个文件需要 Nuxt 环境（以后若要加纯工具函数的测试，
     * 那些可以走普通 node 环境，会更快）。
     */
    include: ['test/**/*.spec.ts'],

    /**
     * 【为什么要把 hook 超时从默认的 10 秒提到 60 秒】
     *
     * 这不是"把断言放宽"，而是"给环境搭建留出时间"。@nuxt/test-utils 的
     * runtime/entry.mjs 里有个 `beforeAll(() => setupNuxt())`：每个测试文件
     * 都要先把一整个 Nuxt 应用建起来，这个 beforeAll 默认只有 10 秒。
     *
     * 本项目在 w7.3 换成了 Element Plus 官方的按需引入模块
     * （`@element-plus/nuxt`，见 nuxt.config.ts），它在**配置加载期**就
     * `import * as AllComponents from 'element-plus'`（要把组件名枚举出来才能
     * 逐个注册），而 nuxt.config 是被 jiti 逐文件转换后执行的 ——
     * 实测"建 Nuxt 环境"这一步从 2.9 秒涨到 11 秒（单个测试文件，空载机器）。
     *
     * 后果不是"变慢一点"，而是**整组失败**：25 个测试文件里有 10 个
     * 连一条用例都没跑到就报 `Hook timed out in 10000ms`，
     * 表现是"238 passed / 228 skipped"——看起来像跳过，其实那 10 个文件一个都没测。
     * 这种"测试没跑却像跳过"的状态比红灯更危险，所以必须显式把时间给足。
     *
     * 【为什么是 60 秒】实测最慢的一次约 13 秒；留 4 倍余量是为了
     * CI 上更慢的机器（GitHub Actions 的共享 runner）不会因为"机器慢"
     * 变成随机红灯 —— 一个会随机失败的测试套件等于没有测试套件。
     */
    hookTimeout: 60_000,

    // 断言失败时把差异打印得更完整，方便定位"到底哪个字段对不上"
    reporters: ['default'],
  },
})
