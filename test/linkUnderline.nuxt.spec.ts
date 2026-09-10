import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { ElLink } from 'element-plus'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import AppShell from '~/app.vue'

// =====================================================================
// el-link 的 underline：不许再用废弃的**布尔值**形态
//
// 【这条警告为什么值得专门测】
//   Element Plus 2.14 起，`<el-link :underline="false">` 这种布尔写法已经废弃。
//   它【不影响功能】，只是每次渲染都往控制台打一段：
//     ElementPlusError: [el-link] [API] The underline option (boolean)
//     is about to be deprecated in version 3.0.0, please use
//     'always' | 'hover' | 'never' instead.
//   危害恰恰在于"不影响功能"：测试照样全绿，只是 stderr 里每次都刷一遍，
//   真正的报错混在其中就被忽略了（本项目已经因为同类警告吃过一次亏）。
//   而下次 Element Plus 大版本真的删掉布尔支持时，链接会静默变成"一直有下划线"，
//   也没人会发现 —— 所以现在就换成新写法，并用断言把旧写法钉死。
//
// 【为什么行为完全等价，还是必须改】
//   组件内部本来就是这么转换的：
//     isBoolean(props.underline) ? (props.underline ? 'hover' : 'never') : props.underline
//   也就是说 `:underline="false"` 的最终效果就是 `underline="never"`，
//   我们只是把"它替我们做的转换"写成显式值 —— 顺带把那句废弃警告一起去掉。
//
// 【为什么挂载整个应用外壳】
//   这两处 el-link 都在登录 / 注册弹窗里，而弹窗是 app.vue（外壳）的一部分，
//   挂在任何页面上都测不到。
//
// 【坑：弹窗内容会被 teleport 到 body】
//   与 loginRateLimit.nuxt.spec.ts 里同一个坑，所以断言走的是
//   "按组件类型找 el-link"（组件树里还在），而不是靠 DOM 层级去猜。
// =====================================================================

const { cookieRefs } = vi.hoisted(() => ({ cookieRefs: {} }))
const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))
mockNuxtImport('$fetch', () => fetchMock)

// 【必须是真正的 ref】app.vue 的模板里写着 `v-if="token"`：
// 换成 `{ value: null }` 这种普通对象后，它永远是"真值"（对象嘛），
// 顶栏会按"已登录"渲染 —— 找不到「登录」按钮，断言只会说"元素不存在"
mockNuxtImport('useCookie', () => (name) => {
  if (!cookieRefs[name]) cookieRefs[name] = ref(null)
  return cookieRefs[name]
})

const { navigateToMock } = vi.hoisted(() => ({ navigateToMock: vi.fn() }))
mockNuxtImport('navigateTo', () => navigateToMock)

/** Element Plus 那段废弃警告的特征串（用它的原文，而不是我们自己编的措辞） */
const DEPRECATED_UNDERLINE_HINT = '[el-link] [API] The underline option (boolean)'

/** 把 console.warn 的调用记录摘出来：element-plus 的 debugWarn 走的就是它 */
const underlineWarnings = (warnSpy) =>
  warnSpy.mock.calls.filter((args) =>
    args.some((arg) => String(arg?.message ?? arg).includes(DEPRECATED_UNDERLINE_HINT)),
  )

/**
 * 拦住控制台警告并收集起来。
 * 【为什么要 mockImplementation 把它吞掉】这条警告的原文很长（还带一段 URL），
 * 让它原样打印会把测试输出刷满 —— 而且我们已经在断言里盯着它了。
 */
const spyOnWarnings = () => vi.spyOn(console, 'warn').mockImplementation(() => {})

/** 挂载整个应用外壳 */
const mountShell = async () => {
  const wrapper = await mountSuspended(AppShell, {
    global: { stubs: { NuxtPage: true, NuxtRouteAnnouncer: true } },
  })
  await flushPromises()
  return wrapper
}

/** 打开某个弹窗：走真实入口（点导航栏上的按钮），而不是直接改状态 */
const openDialog = async (wrapper, selector) => {
  await wrapper.find(selector).trigger('click')
  await flushPromises()
}

describe('el-link 的 underline（废弃 API 的替换）', () => {
  let warnSpy

  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockResolvedValue({ code: 200, data: null })
    for (const key of Object.keys(cookieRefs)) cookieRefs[key].value = null
    warnSpy = spyOnWarnings()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('（对照组）传布尔值时_确实会打出这段废弃警告', () => {
    // 【这条用例的意义】证明下面那条"没有警告"的断言**真的能看见警告** ——
    // 否则一个从未被触发过的 spy 会让"expect(...).toHaveLength(0)"永远为真，
    // 就算把废弃写法写回去也照样绿。
    mount(ElLink, { props: { underline: false } })

    expect(underlineWarnings(warnSpy).length).toBeGreaterThan(0)
  })

  it('应用外壳里的链接_should 全部用字符串形态的 underline（不再传废弃的布尔值）', async () => {
    const wrapper = await mountShell()
    // 两个弹窗各有一个链接：「去注册」在登录弹窗里、「已有账号？去登录」在注册弹窗里
    await openDialog(wrapper, '.nav-right .nav-btn')       // 登录
    await openDialog(wrapper, '.nav-right .nav-ghost')     // 注册

    const links = wrapper.findAllComponents(ElLink)
    expect(links.length).toBeGreaterThanOrEqual(2)

    for (const link of links) {
      const underline = link.props('underline')
      // 布尔值一律不允许：那正是被废弃的形态（也是那条警告的唯一触发条件）
      expect(typeof underline, 'underline 不该是布尔值').not.toBe('boolean')
      expect(underline).toBe('never')
    }
  })

  it('渲染这两个链接_should 一条 el-link 废弃警告都不打印', async () => {
    const wrapper = await mountShell()
    await openDialog(wrapper, '.nav-right .nav-btn')
    await openDialog(wrapper, '.nav-right .nav-ghost')

    // 改之前：这里每次渲染都会出现 2~3 条 ElementPlusError
    expect(underlineWarnings(warnSpy)).toHaveLength(0)
    // 链接本身还在（别为了消警告把功能删掉）
    expect(wrapper.findAllComponents(ElLink).length).toBeGreaterThanOrEqual(2)
  })

  it('样式行为_should 与改之前一致（never 既不带常显下划线、也不带悬停下划线）', async () => {
    const wrapper = await mountShell()
    await openDialog(wrapper, '.nav-right .nav-btn')       // 登录
    await openDialog(wrapper, '.nav-right .nav-ghost')     // 注册

    // 【为什么按组件找而不是按 .el-link 找 DOM】弹窗内容被 teleport 到 body，
    // 用 class 选择器可能同时捞到别处残留的节点；按组件类型找拿到的是
    // "这个外壳渲染出来的 el-link"，这才是我们要守的东西
    const links = wrapper.findAllComponents(ElLink)
    const labels = []

    for (const link of links) {
      // Element Plus 的类名由 underline 的值直接决定：
      //   'always' → is-underline、'hover' → is-hover-underline、'never' → 两个都没有
      // 改之前传 false 时组件内部也会把它转成 'never'，所以类名必须【一模一样】——
      // 这条守的是"没有把行为一起改掉"
      expect(link.classes()).not.toContain('is-underline')
      expect(link.classes()).not.toContain('is-hover-underline')
      labels.push(link.text())
    }

    // 链接文本没变（不是为了消警告顺手把链接换成了别的东西）
    expect(labels).toContain('去注册')
    expect(labels).toContain('已有账号？去登录')
  })
})
