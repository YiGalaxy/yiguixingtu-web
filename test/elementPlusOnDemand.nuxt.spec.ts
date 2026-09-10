import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import AdminPage from '~/pages/admin.vue'

// =====================================================================
// Element Plus「按需引入」的护栏（w7.3）
//
// 【这一组守的是什么】
//   w7.3 把 Element Plus 从「全量注册」（app/plugins/element-plus.ts 里
//   `nuxtApp.vueApp.use(ElementPlus)` + import 整包 dist/index.css）换成了
//   官方的按需引入模块 @element-plus/nuxt。好处是产物体积掉了一大截
//   （JS 3 025 646 → 2 483 252 字节，CSS 521 014 → 299 419 字节）。
//
//   但这一改动有个很不体面的特点：**它坏掉的时候不报错**。三件事都成立：
//     · 组件没注册 → 页面照样能跑，只是那个按钮变成一个没有样式的空标签
//     · 样式没被注入 → 组件测试断言的从来是文字与 DOM，从来不读 CSS，照样全绿
//     · 有人把全量引入改回去 → 功能和样式立刻全对，只有产物体积悄悄长回去
//   所以这一组不测"业务逻辑"，测的是"别把这套按需引入悄悄弄坏"：
//     A. 页面上真正渲染出来的 el-* 是【真的 Element Plus 组件】（DOM 侧）
//     B. 源码里不许再出现全量引入的写法（体积侧）
//     C. 源码里不许显式 import 某个组件（样式侧，最容易踩、也最难发现的一条）
//
// 【为什么样式侧只能用"扫描源码"这种办法】组件测试里 CSS 是不加载的
//   （Vitest 默认把 CSS 当空模块），所以"样式在不在"断不出来 ——
//   真实证据只能靠构建产物 + curl，那几条写在 README 的「上线前的检查」里。
//   下面 C 守的是**导致样式丢失的那个写法**，它才是能在单测里钉住的东西。
// =====================================================================

const { fetchMock, tokenRef } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  tokenRef: { value: 'fake-token' },
}))
mockNuxtImport('$fetch', () => fetchMock)
mockNuxtImport('useCookie', () => () => tokenRef)

// 后台页有 5 个 el-select，它们的面板会 teleport 到 body 并留在那里；
// 每个用例结束都卸载，免得上一个用例的残留面板影响下一个（其它后台用例同款处理）
enableAutoUnmount(afterEach)

const body = (data) => ({ code: 200, message: '成功', data })
const pathOf = (url) => String(url).split('?')[0]

/** 一份最小的后端假实现：只为把后台页的五个面板都渲染出来，不关心内容 */
const mockBackend = () => {
  fetchMock.mockImplementation((url) => {
    const path = pathOf(url)
    if (path === '/article/stats') return Promise.resolve(body({ articleCount: 2, viewCount: 28, categoryCount: 3 }))
    if (path === '/auth/me') return Promise.resolve(body({ id: 1, username: 'admin', role: 'ADMIN' }))
    if (path === '/user/page') return Promise.resolve(body({ records: [], total: 7 }))
    if (path === '/category/list') return Promise.resolve(body([{ id: 1, name: '技术笔记', sort: 1 }]))
    if (path === '/admin/tag/list') return Promise.resolve(body([]))
    if (path === '/admin/article/page') return Promise.resolve(body({ records: [], total: 0 }))
    if (path === '/admin/comment/page') return Promise.resolve(body({ records: [], total: 0 }))
    return Promise.resolve(body(null))
  })
}

// ---------- 源码扫描用的小工具 ----------

/**
 * app/ 的绝对路径。
 * 【为什么用 process.cwd() 而不是 import.meta.url】在 nuxt 测试环境里
 * `import.meta.url` 不是 file:// 开头的（模块是被 Vite 的 dev server 提供的），
 * 拿它去 fileURLToPath 会直接报 "The URL must be of scheme file"。
 * vitest 的 cwd 就是项目根目录（npm run test 在仓库根执行），所以用它最稳。
 */
const APP_DIR = join(process.cwd(), 'app')

/** 递归收集 app/ 下的全部源码文件 */
const appSources = () => {
  const out = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.(vue|ts)$/.test(entry.name)) out.push(full)
    }
  }
  walk(APP_DIR)
  return out
}

const shortPath = (p) => p.slice(APP_DIR.length).replace(/\\/g, '/')

/**
 * 哪些 Element Plus 的导出**可以**被显式 import 而不会丢样式。
 *
 * 【为什么只有这四个】@element-plus/nuxt 注入样式靠两条路：
 *   ① 扫编译产物里的 `_resolveComponent("el-xxx")` —— 管模板里写的组件
 *   ② 扫源码里的 `ElLoading` / `ElMessage` / `ElMessageBox` / `ElNotification`
 *      这四个**标识符**（模块内部的 methodsRegExp 就是这四个）
 * 所以"显式 import 一个 API（函数）"没问题：②会把它的样式补上。
 *
 * 但"显式 import 一个**组件**"（比如 `import { ElButton } from 'element-plus'`）
 * 就麻烦了：`<script setup>` 里有这个绑定之后，Vue 编译器不会再生成
 * `_resolveComponent("el-button")`，而是直接 `_createBlock($setup["ElButton"])`
 * —— ①的那句话就落空了，而这个组件的样式**不会**被注入。
 * 这条不是推测，是用 @vue/compiler-sfc 实测出来的：
 *   没有显式 import：resolveComponent("el-button")
 *   加了显式 import：_createBlock($setup["ElButton"], ...)
 */
const STYLE_SAFE_APIS = ['ElLoading', 'ElMessage', 'ElMessageBox', 'ElNotification']

/**
 * 从一段源码里挑出"会丢样式的显式 import"。
 * 【为什么要抽成纯函数】下面有一条用例专门拿假源码喂它（对照组）——
 * 一个从来没被触发过的扫描器，会让"没有违规"这句话永远为真。
 */
const riskyElementPlusImports = (src) => {
  const bad = []
  // import { A, B as C } from 'element-plus' —— 顺便连 import type 一起匹配（它会被编译期擦掉，无害）
  for (const m of src.matchAll(/import\s+(type\s+)?\{([^}]+)\}\s*from\s*['"]element-plus['"]/g)) {
    if (m[1]) continue
    for (const raw of m[2].split(',')) {
      const name = raw.trim().split(/\s+as\s+/)[0].trim()
      if (name && !STYLE_SAFE_APIS.includes(name)) bad.push(name)
    }
  }
  return bad
}

describe('Element Plus 按需引入的护栏', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    mockBackend()
  })

  // ---------------------------------------------------------------
  // A、DOM 侧：组件真的被注册成了组件
  // ---------------------------------------------------------------

  it('后台页渲染出的 el-* _should 是真的 Element Plus 组件，而不是被当成未知元素原样渲染', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()

    // 这几个类名全都是 Element Plus 组件自己的模板里写死的：
    // 只有"组件真的被解析并渲染了"才会有，跟我们的业务代码无关
    expect(wrapper.find('.el-table').exists()).toBe(true)
    expect(wrapper.find('.el-table__header-wrapper').exists()).toBe(true)
    expect(wrapper.find('.el-pagination__total').exists()).toBe(true)
    expect(wrapper.find('.el-input__wrapper').exists()).toBe(true)
    expect(wrapper.find('.el-button').exists()).toBe(true)

    // 【对照组：为什么上面那几条不是废话】
    // 组件没注册时 Vue 不会报错，而是把它当成"未知元素"原样渲染 ——
    // 页面上会出现一个真正的 <el-table> 标签，且它一个 el-* 类名都不带。
    // 所以这两条反向断言恰好卡住那种情况：真出问题时，它们和上面几条会一起翻转。
    expect(wrapper.find('el-table').exists()).toBe(false)
    expect(wrapper.find('el-pagination').exists()).toBe(false)
  })

  // ---------------------------------------------------------------
  // B、体积侧：全量引入不许回来
  // ---------------------------------------------------------------

  it('源码里 _should 再也找不到"全量引入 Element Plus"的写法（否则产物体积会悄悄长回去）', () => {
    const files = appSources()
    // 先证明扫描器真的扫到了东西（否则"一条违规都没有"可能只是因为什么都没扫）
    expect(files.length).toBeGreaterThan(10)

    const offenders = []
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      // ① 整包 CSS：这一个 import 就是 340 KB 的 theme-chalk 全量样式
      if (src.includes('element-plus/dist/index.css')) offenders.push(`${shortPath(file)} 引入整包 CSS`)
      // ② 全量注册：把所有组件都挂到 Vue 应用上，等于按需引入白做
      if (/vueApp\.use\(\s*ElementPlus\s*\)/.test(src) || /\bapp\.use\(\s*ElementPlus\s*\)/.test(src)) {
        offenders.push(`${shortPath(file)} 里还在 app.use(ElementPlus)`)
      }
    }
    expect(offenders).toEqual([])

    // 那个全量注册的插件文件本身也必须已经不在了：
    // 留着它（哪怕没人 import）迟早会被谁"顺手"接回去
    expect(existsSync(join(APP_DIR, 'plugins/element-plus.ts'))).toBe(false)
  })

  // ---------------------------------------------------------------
  // C、样式侧：显式 import 组件会让它的样式不被注入
  // ---------------------------------------------------------------

  it('源码里 _should 不存在"从 element-plus 显式 import 某个组件"的写法（那会让它的样式被丢掉）', () => {
    const offenders = []
    for (const file of appSources()) {
      for (const name of riskyElementPlusImports(readFileSync(file, 'utf8'))) {
        offenders.push(`${shortPath(file)} 显式 import 了 ${name}`)
      }
    }
    // 修法只有两种，选哪种都行，但必须显式做一次：
    //   · 模板里直接写组件（`<el-button>`），让模块走 _resolveComponent 那条路自动带样式
    //   · 真的要用它的 JS 导出时，额外自己补一行
    //     `import 'element-plus/es/components/button/style/css'`
    expect(offenders).toEqual([])
  })

  it('扫描器自身 _should 真的抓得住"显式 import 组件"的写法（对照组）', () => {
    // 没有这一条的话，上面那条用例可能只是因为"扫描器永远返回空数组"而永远为真
    expect(riskyElementPlusImports(`import { ElButton } from 'element-plus'`)).toEqual(['ElButton'])
    expect(riskyElementPlusImports(`import { ElTable, ElTableColumn } from 'element-plus'`))
      .toEqual(['ElTable', 'ElTableColumn'])
    // 起了别名也一样要抓住：判断的是"import 的是哪个导出"，跟本地叫什么名字无关
    expect(riskyElementPlusImports(`import { ElButton as Btn } from 'element-plus'`)).toEqual(['ElButton'])

    // 反过来，这三种写法是【合法】的，一个都不该被抓出来：
    // · ElMessage 换个别名照样安全 —— 模块是按标识符扫样式的那一类 API
    // · import type 会被编译期整个擦掉，没有任何运行时产物，也就无所谓样式
    // · 别的库完全不在这个扫描器的职责范围内
    expect(riskyElementPlusImports(`import { ElMessage as Msg } from 'element-plus'`)).toEqual([])
    expect(riskyElementPlusImports(`import { ElMessage, ElMessageBox } from 'element-plus'`)).toEqual([])
    expect(riskyElementPlusImports(`import type { FormInstance } from 'element-plus'`)).toEqual([])
    expect(riskyElementPlusImports(`import { MdEditor } from 'md-editor-v3'`)).toEqual([])
  })
})
