// @nuxt/eslint 提供的扁平配置（flat config）。
// 它已经内置了 Nuxt 官方推荐的一套规则，并自动处理了 .vue / .ts 的解析，
// 所以这里不需要再手写 parser、plugins、extends 那些样板。
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt({
  rules: {
    // -----------------------------------------------------------------
    // 【为什么这里要显式关掉几条规则 —— 每条都有具体原因，不是图省事】
    //
    // 这个项目的代码风格是「中文注释写透 + 用原生写法保持直白」，
    // 官方推荐规则里有几条会与它冲突。改代码去迁就 lint，
    // 或者放着一堆 warning 不管，两种都不可取；显式关掉并写明原因是第三种。
    // -----------------------------------------------------------------

    // 单文件组件用 kebab-case 还是 PascalCase，是团队口味，
    // 这里保持现状（<MdEditor /> / <el-button>），不因为规则去改 1000 行的模板
    'vue/multi-word-component-names': 'off',

    // app.vue / admin.vue 里有大量刻意为之的紧凑写法（一行一个 event handler、
    // 三元表达式写在一行），这是有意的可读性取舍，不强制换行
    'vue/max-attributes-per-line': 'off',
    'vue/singleline-html-element-content-newline': 'off',

    // 允许在 <script setup> 里用 `v => ...` 这种简短箭头参数
    'vue/v-on-event-hyphenation': 'off',
  },
})
