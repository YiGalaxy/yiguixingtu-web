import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'

// =====================================================================
// useApi 的单元测试：重点是把【四条失败分支】钉死
//
// 【为什么这四条分支最值得测】
//   useApi 是全部请求的唯一出口，页面自己不做错误处理，全靠它返回的 ok/code。
//   一旦某条分支写错，表现是"页面没反应"或"提示文不对题"——
//   比如把 401 当成网络异常，用户会一直看到"网络异常，请稍后再试"，
//   而真正的原因（登录过期）永远不显示出来。
//
//   这四条分支是：
//     ① body.code !== 200（业务失败，HTTP 仍是 200）
//     ② HTTP 401（token 过期 → 清 token + 弹登录框）
//     ③ HTTP 403（有登录但没权限）
//     ④ 网络层异常（断网 / 后端没起）
//   其中 ② 和 ③ 的区别是真实排错时最容易搞混的地方，所以分开断言。
// =====================================================================

// ---------------------------------------------------------------------
// 【怎么把 $fetch 换掉 —— 这里踩过一次坑，写下来】
//
// 第一版用的是 `vi.stubGlobal('$fetch', mock)`，结果 9 个用例全挂，
// 而且失败得很隐蔽：断言拿到的是【真实后端返回的数据】——
// 因为 $fetch 在 Nuxt 里是【自动导入】的，构建时 unimport 会把它
// 改写成模块级 import，运行时取的是模块绑定，不是 globalThis.$fetch。
// 所以替换全局对象根本拦不住它，请求真的发到了 localhost:8082。
//
// 正确做法是 @nuxt/test-utils 提供的 mockNuxtImport：
// 它就是专门用来替换 Nuxt 自动导入的（$fetch / useCookie / navigateTo ...）。
//
// 另外两点：
//   · 用 vi.hoisted 先备好容器：mockNuxtImport 和 vi.mock 一样会被提升到
//     import 之前执行，直接引用下面的 const 会报 "Cannot access before initialization"
//   · 工厂函数返回【同一个】vi.fn 实例，这样每个用例里用 mockReset/mockResolvedValue
//     改变行为即可，不需要为每个用例重新声明 mock
// ---------------------------------------------------------------------
const { fetchMock, tokenRef } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  // 用一个普通 ref 代替真实的 cookie ref，方便在用例里直接控制 token
  tokenRef: { value: null },
}))
mockNuxtImport('$fetch', () => fetchMock)

// ---------------------------------------------------------------------
// 【为什么连 useCookie 也替换掉 —— 这是第二个坑】
//
// 一开始我是用真的 useCookie 来准备 token 的：`useCookie('token').value = 'xxx'`。
// 结果断言"请求头里应该带 Bearer xxx"时拿到了 undefined。
// 原因：Nuxt 的 useCookie 内部是靠一个 watcher 把值写回 cookie 的，
// 写入不是同步生效的 —— 在同一个 tick 里新建一次 useCookie() 读到的还是旧值。
// 试过 await nextTick() 也不行（在测试环境里依旧读不到）。
//
// 想清楚之后发现：这本来就不该是这条用例要测的东西。
// cookie 什么时候真正落到 document.cookie 上是 Nuxt 的内部实现，
// 不是我们的业务逻辑；盯着它测只会得到一条又脆又难查的用例。
//
// useApi 真正该被钉住的行为是：
//   · 有 token 时把 Bearer 带上、没有时不带
//   · 401 时把 token 清掉、403 时不清
// 这些都只依赖"token 这个 ref 的值"，所以把它换成普通 ref 之后，
// 用例变得确定、不受时序影响，测的东西反而更准。
// ---------------------------------------------------------------------
mockNuxtImport('useCookie', () => () => tokenRef)

// ElMessage 要往 DOM 里插节点，单测里没必要真渲染提示框；
// 换成间谍函数后，还能顺带断言"提示文案对不对"。
//
// 【⚠️ 必须保留原模块，不能整个替换掉 —— 第三个坑】
// 第一版写的是 `vi.mock('element-plus', () => ({ ElMessage: {...} }))`，
// 只给了 ElMessage，等于把 default export 也一并抹掉了。
// 而项目里有 app/plugins/element-plus.ts 这个 Nuxt 插件：
//     import ElementPlus from 'element-plus'
//     nuxtApp.vueApp.use(ElementPlus)
// 插件在 Nuxt 应用初始化时就会执行，ElementPlus 成了 undefined →
// vueApp.use(undefined) 抛错 → 测试依旧"全绿"，但 stderr 里多出一行
//     [NUXT_E1005]   （含义：Error caught during app initialization）
// 这种"测试通过、初始化其实报错"最容易被忽略，所以用 importOriginal
// 拿到真实模块，只覆盖需要监视的那一个方法。
const { errorSpy } = vi.hoisted(() => ({ errorSpy: vi.fn() }))
vi.mock('element-plus', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    ElMessage: { ...actual.ElMessage, error: errorSpy },
  }
})

describe('useApi', () => {
  beforeEach(() => {
    errorSpy.mockReset()
    fetchMock.mockReset()
    tokenRef.value = null
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    tokenRef.value = null
  })

  // ---------------------------------------------------------------
  // 正常路径
  // ---------------------------------------------------------------

  it('code 为 200 时_should返回 ok 并把 data 原样带出', async () => {
    fetchMock.mockResolvedValue({ code: 200, message: '成功', data: { total: 3 } })

    const { request } = useApi()
    const res = await request('/article/page')

    expect(res.ok).toBe(true)
    expect(res.code).toBe(200)
    expect(res.data).toEqual({ total: 3 })
    // 成功时不该弹任何错误提示
    expect(errorSpy).not.toHaveBeenCalled()
  })

  // ---------------------------------------------------------------
  // 后端地址的选择：服务端走内网、浏览器走对外地址
  // ---------------------------------------------------------------

  describe('resolveApiBase（两种 baseURL 都要能正确解析）', () => {
    // 模拟一份"服务端与浏览器地址不一样"的线上配置：
    // 服务端直连内网容器，浏览器走对外域名
    const config = {
      apiBaseServer: 'http://backend:8082',
      public: { apiBase: 'https://blog.example.com/api' },
    }

    it('在服务端_should用 apiBaseServer 走内网地址', () => {
      // 为什么不绕公网：SSR 的请求发生在服务器上，
      // 去请求自己的公网域名等于绕一圈 DNS + Nginx 再回到同一台机器，
      // 白白多几十毫秒；域名没配好时 SSR 还会直接失败
      expect(resolveApiBase(true, config)).toBe('http://backend:8082')
    })

    it('在浏览器_should用 public.apiBase 走对外地址', () => {
      expect(resolveApiBase(false, config)).toBe('https://blog.example.com/api')
    })

    it('两种情形_should取到不同的地址（不能取成同一个）', () => {
      // 这条用来防止"两个配置项被写成同一个值"这种看起来没事、
      // 实际上等于没分离的情况
      expect(resolveApiBase(true, config)).not.toBe(resolveApiBase(false, config))
    })

    it('本地开发时两者相同_should也正常工作', () => {
      // 本地没有内网/公网之分，两个值都是 http://localhost:8082，
      // 所以这条分支也必须能跑通，不能假设它们一定不同
      const local = {
        apiBaseServer: 'http://localhost:8082',
        public: { apiBase: 'http://localhost:8082' },
      }
      expect(resolveApiBase(true, local)).toBe('http://localhost:8082')
      expect(resolveApiBase(false, local)).toBe('http://localhost:8082')
    })
  })

  it('浏览器侧发请求时_should用 public 里的地址作为 baseURL', async () => {
    // 上面测的是纯函数，这条补上"useApi 实际用的就是它"，
    // 避免出现"函数改对了但 useApi 忘了改"的情况
    fetchMock.mockResolvedValue({ code: 200, data: null })

    const { request } = useApi()
    await request('/article/page')

    const options = fetchMock.mock.calls[0][1]
    expect(options.baseURL).toBe(resolveApiBase(import.meta.server, useRuntimeConfig()))
  })

  it('有 token 时_should自动带上 Authorization 请求头', async () => {
    fetchMock.mockResolvedValue({ code: 200, data: null })
    tokenRef.value = 'fake-jwt-token'

    const { request } = useApi()
    await request('/user/page')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const options = fetchMock.mock.calls[0][1]
    expect(options.headers.Authorization).toBe('Bearer fake-jwt-token')
  })

  it('没有 token 时_should不带 Authorization 请求头', async () => {
    fetchMock.mockResolvedValue({ code: 200, data: null })

    const { request } = useApi()
    await request('/article/page')

    const options = fetchMock.mock.calls[0][1]
    expect(options.headers.Authorization).toBeUndefined()
  })

  it('请求地址_should拼在后端 baseURL 上', async () => {
    fetchMock.mockResolvedValue({ code: 200, data: null })

    const { request } = useApi()
    await request('/article/page', { params: { page: 1 } })

    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('/article/page')
    expect(options.baseURL).toBe(useRuntimeConfig().public.apiBase)
    // 查询参数要原样透传，不能被吞掉
    expect(options.params).toEqual({ page: 1 })
  })

  it('返回值不是统一包装格式时_should按原样当作 data 返回', async () => {
    // 后端理论上都返回 {code,message,data}，但万一某个接口直接返回裸数据，
    // 这里要能兜住，而不是把裸数据当成"失败"
    fetchMock.mockResolvedValue({ foo: 'bar' })

    const { request } = useApi()
    const res = await request('/something')

    expect(res.ok).toBe(true)
    expect(res.data).toEqual({ foo: 'bar' })
  })

  // ---------------------------------------------------------------
  // 分支 ①：业务失败（HTTP 200，code !== 200）
  // ---------------------------------------------------------------

  it('body_code 非 200 时_should返回 ok=false 并透传后端的 message', async () => {
    fetchMock.mockResolvedValue({ code: 400, message: '账号已存在', data: null })

    const { request } = useApi()
    const res = await request('/auth/register', { method: 'POST' })

    expect(res.ok).toBe(false)
    expect(res.code).toBe(400)
    // 关键：要把后端给的原文透出来，不能自己编一句"操作失败"
    expect(res.message).toBe('账号已存在')
    expect(errorSpy).toHaveBeenCalledWith('账号已存在')
    // 业务失败不是登录问题，不该清 token
    expect(tokenRef.value).toBeFalsy()
  })

  it('body_code 非 200 但没带 message 时_should给出兜底文案', async () => {
    fetchMock.mockResolvedValue({ code: 500, data: null })

    const { request } = useApi()
    const res = await request('/x')

    expect(res.ok).toBe(false)
    expect(errorSpy).toHaveBeenCalledWith('操作失败')
  })

  // ---------------------------------------------------------------
  // 分支 ②：HTTP 401（token 过期）
  // ---------------------------------------------------------------

  it('HTTP 401 时_should清掉 token、弹出登录框并返回 code 401', async () => {
    fetchMock.mockRejectedValue({ status: 401 })
    tokenRef.value = 'expired-token'

    const { loginVisible } = useAuthUi()
    loginVisible.value = false

    const { request } = useApi()
    const res = await request('/auth/me')

    expect(res.ok).toBe(false)
    expect(res.code).toBe(401)
    // 通行证已经失效，必须清掉，否则下次请求还会带着这个没用的 token
    expect(tokenRef.value).toBeFalsy()
    // 并且要把登录框弹出来，让用户能重新登录
    expect(loginVisible.value).toBe(true)
    expect(errorSpy).toHaveBeenCalledWith('登录已过期，请重新登录')
  })

  it('401 时_should走 401 分支而不是被当成网络异常', async () => {
    // 这条用例专门盯住一个容易写错的地方：
    // 如果把 status 的读取写错（比如只看 err.statusCode），
    // 401 会掉进最后的兜底分支，用户看到的是"网络异常"——
    // 提示文不对题，排查时会被带偏。
    fetchMock.mockRejectedValue({ status: 401 })

    const { request } = useApi()
    const res = await request('/auth/me')

    expect(res.code).toBe(401)
    expect(res.code).not.toBe(-1)
    expect(errorSpy).toHaveBeenCalledWith('登录已过期，请重新登录')
    expect(errorSpy).not.toHaveBeenCalledWith('网络异常，请稍后再试')
  })

  // ---------------------------------------------------------------
  // 分支 ③：HTTP 403（没权限）
  // ---------------------------------------------------------------

  it('HTTP 403 时_should返回 code 403 且不清 token', async () => {
    fetchMock.mockRejectedValue({ status: 403 })
    tokenRef.value = 'guest-token'

    const { request } = useApi()
    const res = await request('/user/page')

    expect(res.ok).toBe(false)
    expect(res.code).toBe(403)
    expect(res.message).toBe('无权限访问')
    expect(errorSpy).toHaveBeenCalledWith('无权限访问')
    // 关键区别：403 是"你登录了但不够格"，token 本身没问题，不能清
    expect(tokenRef.value).toBe('guest-token')
  })

  // ---------------------------------------------------------------
  // 分支 ④：网络异常
  // ---------------------------------------------------------------

  it('请求直接抛错（断网/后端没起）时_should返回 code -1 并提示网络异常', async () => {
    fetchMock.mockRejectedValue(new Error('Failed to fetch'))

    const { request } = useApi()
    const res = await request('/article/page')

    expect(res.ok).toBe(false)
    expect(res.code).toBe(-1)
    expect(res.message).toBe('网络异常')
    expect(errorSpy).toHaveBeenCalledWith('网络异常，请稍后再试')
    // 网络异常与登录无关，不能顺手把 token 清了
    tokenRef.value = null
  })

  // ---------------------------------------------------------------
  // 分支 ⑤：两种 429（这是后来的限流功能加上去的，也最容易混）
  //
  // 【为什么必须分成两条断言】
  //   后端有两个 body.code = 429 的场景，但含义相反：
  //     · HTTP 429（真被限流，比如登录 5 次/分钟）→ 等一下就好
  //     · HTTP 200 + body.code=429（幂等键命中"另一个相同请求正在处理中"）
  //       → 别重复提交
  //   它们只能在**HTTP 层**区分：前者 $fetch 直接抛异常，后者是正常返回。
  //   如果只写成一句"请求过于频繁"，点两下按钮的人会以为第一次失败了，
  //   于是再点一下 —— 正好又撞一次幂等键。
  // ---------------------------------------------------------------

  it('HTTP 429 时_should 提示"太频繁"，不能落回通用的网络异常', async () => {
    // 后端 Resilience4j 限流的真实形状
    fetchMock.mockRejectedValue({ status: 429, data: { code: 429, message: '请求过于频繁，请稍后再试' } })

    const { request } = useApi()
    const res = await request('/auth/login', { method: 'POST' })

    expect(res.ok).toBe(false)
    expect(res.code).toBe(429)
    expect(res.rateLimited).toBe(true)
    expect(errorSpy).toHaveBeenCalledWith('请求过于频繁，请稍后再试')
    // 这条是本次修复的核心：429 原来会掉进最后的兜底分支，
    // 用户看到的是"网络异常，请稍后再试"—— 而真实原因是"问得太勤了"，
    // 服务端一切正常。提示成网络故障会把人带去查网线/重启路由器。
    expect(errorSpy).not.toHaveBeenCalledWith('网络异常，请稍后再试')
  })

  it('HTTP 429 但没有 body 时_should 用兜底文案（代理层可能给一个空的 429）', async () => {
    fetchMock.mockRejectedValue({ status: 429 })

    const { request } = useApi()
    const res = await request('/article/page')

    expect(res.code).toBe(429)
    expect(res.message).toBe(RATE_LIMITED_MESSAGE)
    expect(errorSpy).toHaveBeenCalledWith(RATE_LIMITED_MESSAGE)
  })

  it('HTTP 429 时_should 不清 token（限流和登录状态没关系）', async () => {
    fetchMock.mockRejectedValue({ status: 429 })
    tokenRef.value = 'still-valid-token'

    const { request } = useApi()
    await request('/article/page')

    // 被限流只说明"请求太多"，不代表通行证失效；
    // 顺手把 token 清掉的话，用户会莫名其妙地被登出
    expect(tokenRef.value).toBe('still-valid-token')
  })

  it('body_code 429（HTTP 200 + 幂等键命中"处理中"）_should 提示"请勿重复提交"', async () => {
    // 这个形状是【正常返回】：HTTP 200，业务码是 429
    fetchMock.mockResolvedValue({ code: 429, message: '请求正在处理中，请勿重复提交', data: null })

    const { request } = useApi()
    const res = await request('/admin/article', { method: 'POST' })

    expect(res.ok).toBe(false)
    expect(res.code).toBe(429)
    expect(res.duplicateSubmit).toBe(true)
    expect(errorSpy).toHaveBeenCalledWith('请求正在处理中，请勿重复提交')
    // 不能退化成通用的"操作失败"：那样用户会以为第一次没成功，再点一下
    expect(errorSpy).not.toHaveBeenCalledWith('操作失败')
  })

  it('body_code 429 但没带 message 时_should 用"处理中"的兜底文案', async () => {
    fetchMock.mockResolvedValue({ code: 429, data: null })

    const { request } = useApi()
    const res = await request('/admin/article', { method: 'POST' })

    expect(res.message).toBe(DUPLICATE_SUBMIT_MESSAGE)
    expect(errorSpy).toHaveBeenCalledWith(DUPLICATE_SUBMIT_MESSAGE)
  })

  it('两种 429 的提示_should 必须不一样（一个是"等一下"，一个是"别重复点"）', async () => {
    // 直接把两条分支的文案放在一起比，防止以后有人"顺手统一一下措辞"
    fetchMock.mockRejectedValue({ status: 429, data: { code: 429, message: RATE_LIMITED_MESSAGE } })
    const { request } = useApi()
    const limited = await request('/auth/login', { method: 'POST' })

    fetchMock.mockReset()
    fetchMock.mockResolvedValue({ code: 429, message: DUPLICATE_SUBMIT_MESSAGE })
    const { request: request2 } = useApi()
    const duplicate = await request2('/admin/article', { method: 'POST' })

    expect(limited.message).not.toBe(duplicate.message)
    expect(limited.rateLimited).toBe(true)
    expect(duplicate.duplicateSubmit).toBe(true)
  })

  // ---------------------------------------------------------------
  // 接口约定
  // ---------------------------------------------------------------

  it('任何分支都_should返回带 ok 字段的对象_让调用方能统一判断', async () => {
    // 页面里的写法统一是 `const res = await request(...); if (!res.ok) return`
    // 所以返回值必须【每个分支】都有 ok 字段，漏一个页面就会静默失败
    const cases = [
      { name: '成功', mock: () => fetchMock.mockResolvedValue({ code: 200, data: 1 }) },
      { name: '业务失败', mock: () => fetchMock.mockResolvedValue({ code: 404, message: '文章不存在' }) },
      { name: '幂等重复提交（200 + code 429）', mock: () => fetchMock.mockResolvedValue({ code: 429, message: '处理中' }) },
      { name: '401', mock: () => fetchMock.mockRejectedValue({ status: 401 }) },
      { name: '403', mock: () => fetchMock.mockRejectedValue({ status: 403 }) },
      { name: '429（限流）', mock: () => fetchMock.mockRejectedValue({ status: 429 }) },
      { name: '网络异常', mock: () => fetchMock.mockRejectedValue(new Error('boom')) },
    ]

    for (const c of cases) {
      fetchMock.mockReset()
      c.mock()
      const { request } = useApi()
      const res = await request('/x')
      expect(typeof res.ok, `分支「${c.name}」应当返回 ok 字段`).toBe('boolean')
      expect(typeof res.code, `分支「${c.name}」应当返回 code 字段`).toBe('number')
    }
  })
})
