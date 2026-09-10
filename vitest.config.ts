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

    // 断言失败时把差异打印得更完整，方便定位"到底哪个字段对不上"
    reporters: ['default'],
  },
})
