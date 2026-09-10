import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'

// =====================================================================
// useAuth 的登出测试
//
// 【为什么专门给登出写测试】
//   这段代码原来有两个问题，而且都不会让页面报错、肉眼很难发现：
//     ① 【没调后端】只把本地 cookie 删了。看着像"退出了"，
//        但服务端签出去的 token 依然有效到自然过期（默认 24 小时）。
//        要是它被截获，拿到的人还能继续用。
//     ② 调用了 navigateTo('/login') —— 项目里根本没有这个页面（死代码）
//   所以这里的断言重点不是"函数跑通了"，而是：
//     后端到底有没有被调用、本地状态有没有清干净。
//
// 【拦截方式】
//   和 useApi / useUpload 的测试一致：$fetch 与 useCookie 都是 Nuxt 自动导入的，
//   用 mockNuxtImport 替换（vi.stubGlobal 拦不住，原因见 useApi 的测试注释）。
//   navigateTo 也一并替换，用来断言"不再跳到不存在的 /login"。
// =====================================================================

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))
mockNuxtImport('$fetch', () => fetchMock)

const { tokenRef } = vi.hoisted(() => ({ tokenRef: { value: null } }))
mockNuxtImport('useCookie', () => () => tokenRef)

const { navigateToMock } = vi.hoisted(() => ({ navigateToMock: vi.fn() }))
mockNuxtImport('navigateTo', () => navigateToMock)

const { errorSpy } = vi.hoisted(() => ({ errorSpy: vi.fn() }))
vi.mock('element-plus', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, ElMessage: { ...actual.ElMessage, error: errorSpy } }
})

describe('useAuth.logout（退出登录）', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    navigateToMock.mockReset()
    errorSpy.mockReset()
    tokenRef.value = null
    // useState 是全局共享的，前一个用例留下的 user 会带到这里
    useState('user').value = null
  })

  it('登出时_should 调用后端 POST /auth/logout', async () => {
    fetchMock.mockResolvedValue({ code: 200 })
    tokenRef.value = 'fake-token'

    const { logout } = useAuth()
    await logout()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('/auth/logout')
    expect(options.method).toBe('POST')
  })

  it('登出时_should 带上当前 token（后端要靠它解析出 jti 才能精确拉黑）', async () => {
    fetchMock.mockResolvedValue({ code: 200 })
    tokenRef.value = 'my-token'

    const { logout } = useAuth()
    await logout()

    const options = fetchMock.mock.calls[0][1]
    expect(options.headers.Authorization).toBe('Bearer my-token')
  })

  it('登出后_should 清空 token 和 user', async () => {
    fetchMock.mockResolvedValue({ code: 200 })
    tokenRef.value = 'fake-token'
    useState('user').value = { id: 1, nickname: '测试', role: 'ADMIN' }

    const { logout } = useAuth()
    await logout()

    expect(tokenRef.value).toBeNull()
    // user 忘了清的话，顶栏还显示着昵称、isAdmin 也还是 true ——
    // 看着就像没退成功，这是个很容易漏的点
    expect(useState('user').value).toBeNull()
  })

  it('后端调用失败时_should 依然清空本地登录态（不能把用户困在登录状态里）', async () => {
    fetchMock.mockRejectedValue(new Error('network down'))
    tokenRef.value = 'fake-token'
    useState('user').value = { id: 1, role: 'ADMIN' }

    const { logout } = useAuth()
    // 关键：不该抛异常
    await expect(logout()).resolves.toEqual({ ok: true })

    // 用户点退出就是想离开。因为网络抖动不给退，反而把人困住了 ——
    // 所以先尽力通知后端（失败只忽略），再无条件清本地
    expect(tokenRef.value).toBeNull()
    expect(useState('user').value).toBeNull()
  })

  it('登出时_should 不跳转到不存在的 /login（死代码已删除）', async () => {
    fetchMock.mockResolvedValue({ code: 200 })
    tokenRef.value = 'fake-token'

    const { logout } = useAuth()
    await logout()

    // 原来这里会 navigateTo('/login')，而项目里根本没有这个页面 ——
    // 点退出会跳到一个 404。跳转交给调用方（app.vue 里跳首页）去做，
    // composable 只负责"退出"这件事本身
    expect(navigateToMock).not.toHaveBeenCalled()
  })

  it('没有 token 时登出_should 不发请求也不崩', async () => {
    tokenRef.value = null

    const { logout } = useAuth()
    await expect(logout()).resolves.toEqual({ ok: true })

    // 没 token 就没必要调后端（没什么可拉黑的），但也不能因此报错
    expect(fetchMock).not.toHaveBeenCalled()
    expect(tokenRef.value).toBeNull()
  })
})

// =====================================================================
// 登录被限流（HTTP 429）与冷却
//
// 【为什么要专门测这一段】
//   后端对 /auth/login 有 5 次/分钟的限流，配额用完返回**真正的 HTTP 429**。
//   这时 $fetch 会抛异常（HTTP 非 2xx 和"业务失败返回 code≠200"完全不同），
//   原来的 catch 把它统一成「登录失败，请稍后再试」——
//   提示文不对题：用户会以为密码错了或者站点坏了，于是接着点，
//   而每点一次都在往限流窗口里再记一次。
//   这一段的断言重点是两件事：
//     ① 提示必须说明"太频繁了"，不能说成网络故障、也不能只说"登录失败"；
//     ② 冷却真的生效（含"冷却期间不再发请求"—— 这才是按钮不可点的实质）。
// =====================================================================
describe('useAuth.login（被限流之后的提示与冷却）', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    errorSpy.mockReset()
    tokenRef.value = null
    useState('user').value = null
  })

  afterEach(() => {
    // 倒计时用的是 setInterval，用例里换过假时钟就必须换回来，
    // 否则后面的用例（以及 vitest 自己的超时判断）会一起被冻住
    vi.useRealTimers()
  })

  it('被限流（HTTP 429）_should 说清楚是"太频繁"，不能是"登录失败"或"网络异常"', async () => {
    // 后端 429 的真实形状：HTTP 429 + {code:429, message:"请求过于频繁，请稍后再试"}
    fetchMock.mockRejectedValue({ status: 429, data: { code: 429, message: '请求过于频繁，请稍后再试' } })

    const { login } = useAuth()
    const res = await login('admin', '123456')

    expect(res.ok).toBe(false)
    expect(res.rateLimited).toBe(true)
    expect(res.message).toContain('频繁')
    // 关键：不能落回通用的登录失败文案 —— 那会让用户一直重试
    expect(res.message).not.toBe('登录失败，请稍后再试')
  })

  it('429 但没有 body 时_should 用兜底文案（不能空着，也不能说成网络故障）', async () => {
    // Nginx 的 limit_req 直接返回的 429 可能是没有 JSON body 的，
    // 那种情况下 readBackendMessage 拿不到东西，必须落到自己的兜底文案上
    fetchMock.mockRejectedValue({ status: 429 })

    const { login } = useAuth()
    const res = await login('admin', '123456')

    expect(res.message).toBe('请求过于频繁，请稍后再试')
  })

  it('被限流后_should 进入冷却并逐秒倒计时', async () => {
    vi.useFakeTimers()
    fetchMock.mockRejectedValue({ status: 429 })

    const auth = useAuth()
    await auth.login('admin', '123456')

    // 冷却一上来就是满额（后端是 5 次/分钟，等一小会儿才不会又撞上）
    expect(auth.coolingDown.value).toBe(true)
    expect(auth.cooldownLeft.value).toBe(LOGIN_COOLDOWN_SECONDS)
    expect(auth.cooldownLeft.value).toBe(10)

    // 用假时钟推进，不靠真实等待（真等 10 秒会让这个文件慢得离谱）
    await vi.advanceTimersByTimeAsync(3000)
    expect(auth.cooldownLeft.value).toBe(7)

    await vi.advanceTimersByTimeAsync(7000)
    expect(auth.cooldownLeft.value).toBe(0)
    expect(auth.coolingDown.value).toBe(false)
  })

  it('冷却期间再次登录_should 直接拒绝且不再发请求', async () => {
    fetchMock.mockRejectedValue({ status: 429 })

    const auth = useAuth()
    await auth.login('admin', '123456')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // 夹着一次"绕过 disabled 按钮"的提交（登录弹窗里回车也能提交，
    // 所以按钮禁用并不能真的拦住请求 —— 拦住请求的是这一层）
    const res = await auth.login('admin', '123456')

    expect(res.ok).toBe(false)
    expect(res.rateLimited).toBe(true)
    expect(res.message).toContain('秒后再试')
    // 这是这条用例的核心：冷却期间【没有第二次请求】。
    // 再发一次只会又撞一次 429（还占掉 1 分钟窗口里的一个位置），
    // 用户看到的现象就是"点了没反应、提示反复出现"
    expect(fetchMock).toHaveBeenCalledTimes(1)

    auth.stopCooldown()
  })

  it('冷却结束后_should 能正常登录', async () => {
    vi.useFakeTimers()
    fetchMock.mockRejectedValueOnce({ status: 429 })

    const auth = useAuth()
    await auth.login('admin', '123456')
    expect(auth.coolingDown.value).toBe(true)

    await vi.advanceTimersByTimeAsync(LOGIN_COOLDOWN_SECONDS * 1000)
    expect(auth.coolingDown.value).toBe(false)

    vi.useRealTimers()   // 下面这次请求不该再受假时钟影响
    fetchMock.mockResolvedValue({ code: 200, data: { token: 'new-token', username: 'admin' } })
    const res = await auth.login('admin', '123456')

    expect(res.ok).toBe(true)
    expect(tokenRef.value).toBe('new-token')
  })

  it('连点两下时（一次被限流、一次成功）_should 以成功为准，不留下冷却', async () => {
    // 【为什么要写这条】冷却期间上面有守卫拦着，所以"成功"和"冷却中"
    // 正常情况下不会同时出现 —— 除了这个竞态：
    // 用户连点两下（或者回车 + 点击同时发生），两次调用的守卫都是通过的，
    // 于是可能一次撞上 429 打开冷却、另一次却登录成功。
    // 这时如果不清冷却，用户明明已经登录成功，界面还要空等 10 秒。
    fetchMock
      .mockRejectedValueOnce({ status: 429 })
      .mockResolvedValueOnce({ code: 200, data: { token: 'race-token', username: 'admin' } })

    const auth = useAuth()
    // 两次调用都在守卫处通过（此刻还没有冷却），并发发出去
    const [limited, succeeded] = await Promise.all([
      auth.login('admin', '123456'),
      auth.login('admin', '123456'),
    ])

    expect(limited.rateLimited).toBe(true)
    expect(succeeded.ok).toBe(true)
    // 成功压过失败：冷却被清掉、token 是成功那一次留下的
    expect(auth.coolingDown.value).toBe(false)
    expect(tokenRef.value).toBe('race-token')
  })

  it('重复开始冷却_should 不会留下两个定时器一起倒数', async () => {
    vi.useFakeTimers()
    const auth = useAuth()

    auth.startCooldown(10)
    auth.startCooldown(10)
    await vi.advanceTimersByTimeAsync(1000)

    // 两个 interval 各减一次的话这里会是 8
    expect(auth.cooldownLeft.value).toBe(9)

    auth.stopCooldown()
  })

  it('密码错误（HTTP 200 + code≠200）_should 仍然透出后端的原文，不要误报成限流', async () => {
    // 这条守住"两个 429 别混在一起"的另一半：业务失败不能被误判成限流
    fetchMock.mockResolvedValue({ code: 401, message: '用户名或密码错误' })

    const auth = useAuth()
    const res = await auth.login('admin', 'wrong')

    expect(res.ok).toBe(false)
    expect(res.rateLimited).toBeUndefined()
    expect(res.message).toBe('用户名或密码错误')
    expect(auth.coolingDown.value).toBe(false)
  })

  it('网络异常_should 走原来的通用文案（限流分支不能顺手把这条也吃了）', async () => {
    fetchMock.mockRejectedValue(new Error('network down'))

    const auth = useAuth()
    const res = await auth.login('admin', '123456')

    expect(res.ok).toBe(false)
    expect(res.message).toBe('登录失败，请稍后再试')
    // 网络故障和限流是两件事：不该因为"请求失败了"就给用户一段冷却
    expect(auth.coolingDown.value).toBe(false)
  })
})
