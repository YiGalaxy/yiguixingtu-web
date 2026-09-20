import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises, enableAutoUnmount } from '@vue/test-utils'
import AppShell from '~/app.vue'

// =====================================================================
// 注册表单里的「邮箱」
//
// 【为什么这一组要单独写】邮箱是 2026-09 才加的注册必填项，它的作用是
//   "从此之后每个新账号都有一个能联系到人的地址"。而它失效的方式有两种，
//   两种都不会报错：
//     · 前端没判 → 用户填了 `abc` 直接提交，看到的是后端那句提示
//       （功能上没错，但一个来回才告诉他，而且后端只报第一个字段的问题）
//     · 字段没接上 → 输入框里的值根本没进请求体，注册出来的账号邮箱是空的
//   第二条尤其危险：接口照样返回 200、账号照样建出来，
//   只有后台翻用户列表时才会发现一整批账号的邮箱栏是空的。
//
// 【后端那道校验才是权威】这里测的是"前端有没有把它接上、判对"，
//   不是"后端拦不拦得住"（那是 UserRegisterTest 的事）。
//
// 【坑：弹窗 teleport 到 body】与 loginRateLimit 那个文件同款 ——
//   el-dialog 的内容渲染在 document.body 下，wrapper.find 找不到它，
//   所以下面的选择器都是直接在整个 wrapper 上找（VTU 会带上 teleport 的内容）
//   这一条在本项目里是踩过的，见那个文件的头注释。
//
// ⚠️ 每个用例结束都卸载：el-dialog 的内容是 teleport 到 body 的，
//   而 mountSuspended 建出来的组件不会自己消失，不卸载就会一层层叠在 body 上。
//   ⚠️ 注意它**解决不了**下面那个更隐蔽的问题（useState 跨用例共享、两个弹窗
//   的 class 又完全一样）—— 那个只能靠"把选择器限定在注册卡片里"来解，
//   见 registerCard 上的说明。

const { fetchMock, cookieRefs } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  cookieRefs: {},
}))
mockNuxtImport('$fetch', () => fetchMock)

// ⚠️ 必须是真正的 ref（不是 { value: null } 这种普通对象）——
//   模板里 `v-if="token"` 只对真 ref 自动解包，用途与坑见 loginRateLimit
mockNuxtImport('useCookie', () => (name) => {
  if (!cookieRefs[name]) cookieRefs[name] = ref(null)
  return cookieRefs[name]
})

const { navigateToMock } = vi.hoisted(() => ({ navigateToMock: vi.fn() }))
mockNuxtImport('navigateTo', () => navigateToMock)

// ElMessage 要往 DOM 里插节点；换成间谍之后还能顺带断言提示文案
const { successSpy, errorSpy, warningSpy } = vi.hoisted(() => ({
  successSpy: vi.fn(), errorSpy: vi.fn(), warningSpy: vi.fn(),
}))
vi.mock('element-plus', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    ElMessage: { ...actual.ElMessage, success: successSpy, error: errorSpy, warning: warningSpy },
  }
})

const body = (data) => ({ code: 200, message: '成功', data })
const pathOf = (url) => String(url).split('?')[0]

const mockBackend = () => {
  fetchMock.mockImplementation((url) => {
    const path = pathOf(url)
    if (path === '/auth/register') return Promise.resolve(body(null))
    if (path === '/setting') return Promise.resolve(body({}))
    if (path === '/article/page') return Promise.resolve(body({ records: [], total: 0 }))
    if (path === '/article/stats') return Promise.resolve(body({ articleCount: 0, viewCount: 0, categoryCount: 0 }))
    if (path === '/category/list') return Promise.resolve(body([]))
    return Promise.resolve(body(null))
  })
}

enableAutoUnmount(afterEach)

beforeEach(() => {
  fetchMock.mockReset()
  navigateToMock.mockReset()
  successSpy.mockReset()
  errorSpy.mockReset()
  warningSpy.mockReset()
  for (const key of Object.keys(cookieRefs)) cookieRefs[key].value = null
  mockBackend()
})

afterEach(() => {
  vi.restoreAllMocks()
})

const mountShell = async () => {
  const wrapper = await mountSuspended(AppShell, {
    global: { stubs: { NuxtPage: true, NuxtRouteAnnouncer: true } },
  })
  await flushPromises()
  return wrapper
}

/**
 * 打开注册弹窗：点导航栏上那个「注册」按钮。
 * 【为什么不直接改 useAuthUi 里的状态】与 loginRateLimit 里那段注释同因：
 *   那是 useState，测试体里拿到的不一定是挂载出来的那个应用实例上的那一份，
 *   改它页面上的弹窗不会打开（踩过一次）。点按钮既是用户路径，也绕开了这个坑。
 */
const openRegisterDialog = async (wrapper) => {
  await wrapper.findAll('.nav-right .nav-btn').find(b => b.text() === '注册').trigger('click')
  await flushPromises()
}

/**
 * 注册弹窗的卡片本体（用来把选择器限定在它里面）。
 *
 * ⚠️ 【为什么非要限定不可 —— 这是实测踩出来的】
 *   登录与注册两个弹窗的 class 完全一样（都是 .auth-modal / .auth-form /
 *   .auth-submit），而 el-dialog 一旦渲染过就**不会**随 v-model 变回 false
 *   而消失（EP 只是把它隐藏起来）。
 *   更麻烦的是 useAuthUi 的状态是 useState，在同一个测试文件里是**跨用例共享**的：
 *   上一条用例注册成功后调了 switchToLogin，loginVisible 就一直是 true。
 *   于是下一条用例执行时，body 里同时躺着两个 .auth-submit ——
 *   `wrapper.find('.auth-submit')` 拿到的是**登录**那个（它在模板里更靠前），
 *   点下去走的是登录逻辑。症状是断言说"提示文案不对"，
 *   看起来像业务写错了，其实点的根本不是同一个按钮。
 *   ⇒ 用卡片标题「创建账号」把范围框死，选到的一定是注册弹窗。
 */
const registerCard = (wrapper) => {
  const card = wrapper.findAll('.auth-card').find(c => c.text().includes('创建账号'))
  if (!card) throw new Error('找不到注册弹窗（.auth-card 里没有「创建账号」）—— 弹窗没打开？')
  return card
}

/**
 * 填注册表单。
 * 顺序与模板一致：用户名 / 昵称 / 邮箱 / 密码（邮箱在密码前面）。
 */
const fillRegisterForm = async (wrapper, { username = '', nickname = '', email = '', password = '' } = {}) => {
  const inputs = registerCard(wrapper).findAll('input')
  await inputs[0].setValue(username)
  await inputs[1].setValue(nickname)
  await inputs[2].setValue(email)
  await inputs[3].setValue(password)
  await flushPromises()
}

/** 点注册弹窗里的「注 册」并等请求走完 */
const submit = async (wrapper) => {
  await registerCard(wrapper).find('.auth-submit').trigger('click')
  await flushPromises()
}

/** 发出去的注册请求体（按路径数，不按总数 —— 外壳挂载时还会打别的接口） */
const registerBodies = () =>
  fetchMock.mock.calls
    .filter(c => pathOf(c[0]) === '/auth/register')
    .map(c => c[1].body)

const FILLED = { username: 'newbie', nickname: '新来的', email: 'newbie@example.com', password: '123456' }

describe('注册邮箱 · 前端预检', () => {
  it('★ 邮箱为空：根本不发请求，当场告诉他', async () => {
    const wrapper = await mountShell()
    await openRegisterDialog(wrapper)
    await fillRegisterForm(wrapper, { ...FILLED, email: '' })

    await submit(wrapper)

    expect(warningSpy).toHaveBeenCalledWith('邮箱不能为空')
    expect(registerBodies()).toEqual([])
  })

  it('★ 邮箱格式不对：根本不发请求（少一个来回）', async () => {
    const wrapper = await mountShell()
    await openRegisterDialog(wrapper)
    await fillRegisterForm(wrapper, { ...FILLED, email: 'notanemail' })

    await submit(wrapper)

    expect(warningSpy).toHaveBeenCalledWith('邮箱格式不正确')
    expect(registerBodies()).toEqual([])
  })

  it('★ 域名里没有点的地址也要拦下（后端的 @Email 单独拦不住 a@b）', async () => {
    const wrapper = await mountShell()
    await openRegisterDialog(wrapper)
    await fillRegisterForm(wrapper, { ...FILLED, email: 'a@b' })

    await submit(wrapper)

    expect(warningSpy).toHaveBeenCalledWith('邮箱格式不正确')
    expect(registerBodies()).toEqual([])
  })

  it('密码太短也是当场拦下（顺手补上的：原来这个表单一个字的校验都没有）', async () => {
    const wrapper = await mountShell()
    await openRegisterDialog(wrapper)
    await fillRegisterForm(wrapper, { ...FILLED, password: '123' })

    await submit(wrapper)

    expect(warningSpy).toHaveBeenCalledWith('密码长度需要在 6-20 之间')
    expect(registerBodies()).toEqual([])
  })
})

describe('注册邮箱 · 真的发出去的请求', () => {
  it('★ 邮箱必须进请求体（漏了它的话账号能建出来、但邮箱是空的）', async () => {
    const wrapper = await mountShell()
    await openRegisterDialog(wrapper)
    await fillRegisterForm(wrapper, FILLED)

    await submit(wrapper)

    expect(registerBodies()).toEqual([
      { username: 'newbie', nickname: '新来的', email: 'newbie@example.com', password: '123456' },
    ])
    expect(successSpy).toHaveBeenCalledWith('注册成功，去登录')
  })

  it('注册失败时把后端给的原因显示出来（比如用户名已被占用）', async () => {
    fetchMock.mockImplementation((url) => {
      const path = pathOf(url)
      if (path === '/auth/register') return Promise.resolve({ code: 400, message: '账号已存在' })
      return Promise.resolve(body(null))
    })
    const wrapper = await mountShell()
    await openRegisterDialog(wrapper)
    await fillRegisterForm(wrapper, FILLED)

    await submit(wrapper)

    expect(errorSpy).toHaveBeenCalledWith('账号已存在')
  })
})
