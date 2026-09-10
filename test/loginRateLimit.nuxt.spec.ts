import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick, ref } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import AppShell from '~/app.vue'

// =====================================================================
// 登录被限流时，登录按钮到底变成什么样
//
// 【为什么 useAuth / useApi 都测过了，还要挂载整个外壳再测一遍】
//   composable 的用例证明的是"认出 429 了、冷却开了"，
//   而这一层要证明的是【页面上真的接上了】：
//     · 按钮是不是真的 disabled（而不是只有一句提示）
//     · 按钮上的倒计时是不是跟着秒数走
//     · 冷却期间点它，会不会又发一次请求
//   这三件事都属于"接错线"类的问题：composable 全绿、页面照样能点。
//
// 【为什么要把整个 app.vue 挂起来】
//   登录弹窗不在任何页面里，它是应用外壳（app.vue）的一部分 ——
//   只挂首页是测不到它的。
//
// 【坑：弹窗是 teleport 到 body 的】
//   el-dialog 的内容通过 <teleport to="body"> 渲染，所以 wrapper.find(...)
//   找不到它；断言必须去 document.body 里查（下面有 loginDialog() 统一处理）。
// =====================================================================

const { fetchMock, cookieRefs } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  // useCookie 按名字返回同一个可写对象：token 与 rememberMe 要各自独立，
  // 否则一次写入会互相污染（app.vue 同时用到了这两个 cookie）
  cookieRefs: {},
}))
mockNuxtImport('$fetch', () => fetchMock)

// 【必须是真正的 ref，不能是 { value: null } 这种普通对象 —— 这是一个坑】
// app.vue 的模板里写着 `v-if="token"`。Vue 只对【真的 ref】做模板自动解包，
// 换成普通对象之后 `{ value: null }` 永远是个真值（对象嘛），
// 于是顶栏会一直按"已登录"渲染：找不到「登录」按钮、点到的其实是「退出」——
// 而且不报错，断言只会说"元素不存在"。
mockNuxtImport('useCookie', () => (name) => {
  if (!cookieRefs[name]) cookieRefs[name] = ref(null)
  return cookieRefs[name]
})

// navigateTo 在测试里没有真实路由可跳（登录成功后会跳首页），换掉即可
const { navigateToMock } = vi.hoisted(() => ({ navigateToMock: vi.fn() }))
mockNuxtImport('navigateTo', () => navigateToMock)

// ElMessage 要往 DOM 里插节点；换成间谍函数后还能顺带断言提示文案
const { errorSpy, warningSpy } = vi.hoisted(() => ({ errorSpy: vi.fn(), warningSpy: vi.fn() }))
vi.mock('element-plus', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    ElMessage: { ...actual.ElMessage, error: errorSpy, warning: warningSpy },
  }
})

/** 后端登录被限流时的真实形状（Resilience4j 返回 HTTP 429 + body.code 429） */
const RATE_LIMITED = { status: 429, data: { code: 429, message: '请求过于频繁，请稍后再试' } }

/** 挂载整个应用外壳；NuxtPage / 路由播报器在单测里没有内容可渲染，stub 掉 */
const mountShell = async () => {
  const wrapper = await mountSuspended(AppShell, {
    global: { stubs: { NuxtPage: true, NuxtRouteAnnouncer: true } },
  })
  await flushPromises()
  return wrapper
}

/**
 * 打开登录弹窗：点导航栏上那个「登录」按钮（真实入口，不是直接改状态）。
 *
 * 【为什么不能直接写 useAuthUi().loginVisible.value = true】
 *   useAuthUi 的状态是 useState（挂在 Nuxt 应用实例上的），而弹窗里的那份
 *   属于 mountSuspended 建出来的那个应用实例。在测试体里拿到的可能是另一份，
 *   改它不会让页面上的弹窗打开（踩过一次：弹窗压根没渲染，断言全部落空）。
 *   走"点按钮"这条路就绕开了这个坑 —— 而且它本来就是用户的操作路径。
 */
const openLoginDialog = async (wrapper) => {
  await wrapper.find('.nav-right .nav-btn').trigger('click')
  await flushPromises()
}

/** 登录弹窗里那个提交按钮 */
const loginButton = (wrapper) => wrapper.find('.auth-submit')

/** 原生 button 元素（要读 disabled 属性，组件包装对象上没有这个属性） */
const loginButtonEl = (wrapper) => loginButton(wrapper).element

/** 填好用户名与密码（el-input 内部就是原生 input，v-model 认 input 事件） */
const fillLoginForm = async (wrapper, username, password) => {
  const inputs = wrapper.findAll('.auth-form input')
  for (const [index, value] of [[0, username], [1, password]]) {
    await inputs[index].setValue(value)
  }
  await flushPromises()
}

/** 点登录按钮并等请求走完 */
const clickLogin = async (wrapper) => {
  await loginButton(wrapper).trigger('click')
  await flushPromises()
}

describe('登录被限流 · 按钮冷却', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    navigateToMock.mockReset()
    errorSpy.mockReset()
    warningSpy.mockReset()
    // cookie 是全局共享的（mock 出来的那份），用例之间要清干净
    for (const key of Object.keys(cookieRefs)) cookieRefs[key].value = null
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('登录被限流之后_should 提示"太频繁"而不是"网络异常"', async () => {
    fetchMock.mockRejectedValue(RATE_LIMITED)
    const wrapper = await mountShell()
    await openLoginDialog(wrapper)
    await fillLoginForm(wrapper, 'admin', '123456')
    await clickLogin(wrapper)

    expect(errorSpy).toHaveBeenCalledWith('请求过于频繁，请稍后再试')
    expect(errorSpy).not.toHaveBeenCalledWith('网络异常，请稍后再试')
  })

  it('登录被限流之后_should 把登录按钮禁用并显示倒计时', async () => {
    fetchMock.mockRejectedValue(RATE_LIMITED)
    const wrapper = await mountShell()
    await openLoginDialog(wrapper)
    await fillLoginForm(wrapper, 'admin', '123456')

    // 限流之前是可点的
    expect(loginButtonEl(wrapper).disabled).toBe(false)
    expect(loginButton(wrapper).text()).toContain('登 录')

    await clickLogin(wrapper)

    // 被限流之后：按钮禁用 + 文案告诉用户还要等多久。
    // 【为什么必须禁用而不是只弹一句提示】用户的第一个反应是"再点一次"，
    // 而每点一次都会再撞一次限流（还占掉 1 分钟窗口里的一个位置），
    // 点了没反应会让人以为按钮坏了。
    // （"为什么太频繁"由上面那条提示负责，按钮上只留秒数 —— 按钮那么小，
    //   写满了反而看不清到底还要等多久）
    expect(loginButtonEl(wrapper).disabled).toBe(true)
    expect(loginButton(wrapper).text()).toContain(`${LOGIN_COOLDOWN_SECONDS} 秒后再试`)
  })

  it('冷却期间再次点击_should 不再发请求（按钮不可点的实质是"不重复打后端"）', async () => {
    fetchMock.mockRejectedValue(RATE_LIMITED)
    const wrapper = await mountShell()
    await openLoginDialog(wrapper)
    await fillLoginForm(wrapper, 'admin', '123456')
    await clickLogin(wrapper)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await clickLogin(wrapper)
    await clickLogin(wrapper)

    // disabled 的按钮点不动，所以请求数不变
    expect(loginButtonEl(wrapper).disabled).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('冷却期间按回车提交_should 被拦下并提示还要等多久（回车绕得过 disabled）', async () => {
    fetchMock.mockRejectedValue(RATE_LIMITED)
    const wrapper = await mountShell()
    await openLoginDialog(wrapper)
    await fillLoginForm(wrapper, 'admin', '123456')
    await clickLogin(wrapper)

    // 登录表单的密码框上有 @keyup.enter="onLogin"，也就是"回车也能提交"——
    // 这条路绕得过 disabled 的按钮，所以页面里必须再拦一道
    await wrapper.findAll('.auth-form input')[1].trigger('keyup.enter')
    await flushPromises()

    expect(warningSpy).toHaveBeenCalledWith(expect.stringContaining('秒后再试'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('倒计时结束之后_should 按钮恢复可点（冷却不是永久锁死）', async () => {
    fetchMock.mockRejectedValue(RATE_LIMITED)
    const wrapper = await mountShell()
    await openLoginDialog(wrapper)
    await fillLoginForm(wrapper, 'admin', '123456')

    // 【为什么假时钟要等到这一刻才换】挂载和弹窗渲染里有大量 async/await
    // 与过渡，而其中的内部实现会用到真实的 setTimeout（@vue/test-utils 的
    // flushPromises 本身就是 `setTimeout(resolve, 0)`）—— 提前换成假时钟
    // 会把它们一起冻住（表现为测试卡死到超时）。倒计时是这里唯一需要
    // "时间快进"的东西，而 setInterval 正是在点按钮这一刻建立起来的。
    vi.useFakeTimers()
    await loginButton(wrapper).trigger('click')     // 不能再用 clickLogin：它会 flushPromises
    await vi.advanceTimersByTimeAsync(0)            // 让 $fetch 的 promise 链落地
    await nextTick()

    expect(loginButtonEl(wrapper).disabled).toBe(true)
    // 冷却从满额开始倒数
    expect(loginButton(wrapper).text()).toContain(`${LOGIN_COOLDOWN_SECONDS} 秒后再试`)

    await vi.advanceTimersByTimeAsync(1000)
    await nextTick()
    expect(loginButton(wrapper).text()).toContain(`${LOGIN_COOLDOWN_SECONDS - 1} 秒后再试`)

    await vi.advanceTimersByTimeAsync(LOGIN_COOLDOWN_SECONDS * 1000)
    await nextTick()
    vi.useRealTimers()

    // 冷却结束后按钮必须自己活过来 —— 否则用户会以为"登录坏了"，
    // 只能刷新页面（这条用例守的就是"别把按钮锁死"）
    expect(loginButtonEl(wrapper).disabled).toBe(false)
    expect(loginButton(wrapper).text()).toContain('登 录')
  })

  it('登录成功_should 不进入冷却（冷却只属于"被限流"那一种失败）', async () => {
    fetchMock.mockResolvedValue({ code: 200, data: { token: 'good-token', username: 'admin', role: 'ADMIN' } })
    const wrapper = await mountShell()
    await openLoginDialog(wrapper)
    await fillLoginForm(wrapper, 'admin', '123456')

    await clickLogin(wrapper)

    expect(cookieRefs.token.value).toBe('good-token')
    expect(navigateToMock).toHaveBeenCalledWith('/')
  })

  it('密码错误（业务失败）_should 显示后端的原文，也不进入冷却', async () => {
    fetchMock.mockResolvedValue({ code: 401, message: '用户名或密码错误' })
    const wrapper = await mountShell()
    await openLoginDialog(wrapper)
    await fillLoginForm(wrapper, 'admin', 'wrong')

    await clickLogin(wrapper)

    expect(errorSpy).toHaveBeenCalledWith('用户名或密码错误')
    expect(loginButtonEl(wrapper).disabled).toBe(false)
  })
})
