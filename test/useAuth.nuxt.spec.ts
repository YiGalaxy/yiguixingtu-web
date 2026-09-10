import { describe, it, expect, vi, beforeEach } from 'vitest'
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
