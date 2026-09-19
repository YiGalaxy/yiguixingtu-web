import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises, enableAutoUnmount } from '@vue/test-utils'
import App from '~/app.vue'

// =====================================================================
// 全站的「访问上报」
//
// 【这一组守着什么】
//   后台的访问统计全靠前端上报（这是个 SPA：站内点链接根本不经过后端，
//   后端从自己的请求日志里看不出"用户翻了几个页面"）。
//   它最危险的失效方式与浏览量上报一样是【完全静默的】：
//   上报没接上 → 页面一切正常，只是后台的曲线永远是空的。
//
//   所以钉三件事：
//     ① 首次进入要报一次（不然统计里没有"直接打开首页"这类访问）
//     ② **站内跳转也要报**（这才是访问量的主要部分 —— 用 onMounted 只报一次
//        的话，用户翻十页也只记一次）
//     ③ 后台的访问【不报】（站长自己天天看后台，算进去会把"访客构成"带偏）
//
// 【为什么不测"上报失败怎么办"】它必须静默（后端也会吞异常），
//   而"什么都没发生"是测不出正向证据的 —— 只能靠代码里那个 catch 兜着。
//   这里用一条"失败之后页面照常渲染"间接钉住它不会把异常抛出来。
// =====================================================================

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))
mockNuxtImport('$fetch', () => fetchMock)

// 【为什么不 mock useRoute】第一版 mock 了它，结果把外壳里别的逻辑弄坏了
//   （app.vue 还会读 route.query.login，一个只有 path 的假对象让它在挂载时就抛）。
//   这里用【真实的路由】：mountSuspended 带 route 参数设置初始地址，
//   站内跳转用 $router.push 触发 —— 那也是真的路由变化，比造假对象更有说服力。

enableAutoUnmount(afterEach)

const body = (data) => ({ code: 200, message: '成功', data })
const pathOf = (url) => String(url).split('?')[0]

/** 所有访问上报的请求体 */
const visitBodies = () =>
  fetchMock.mock.calls
    .filter(c => pathOf(c[0]) === '/visit' && c[1]?.method === 'POST')
    .map(c => c[1].body)

const mockBackend = () => {
  fetchMock.mockImplementation((url) => {
    const path = pathOf(url)
    if (path === '/setting') return Promise.resolve(body({}))
    if (path === '/article/page') return Promise.resolve(body({ records: [], total: 0 }))
    if (path === '/article/stats') return Promise.resolve(body({ articleCount: 0, viewCount: 0, categoryCount: 0 }))
    if (path === '/category/list') return Promise.resolve(body([]))
    return Promise.resolve(body(null))
  })
}

beforeEach(() => {
  fetchMock.mockReset()
  mockBackend()
})

afterEach(() => {
  vi.restoreAllMocks()
})

const mountApp = async (path = '/') => {
  const wrapper = await mountSuspended(App, { route: path })
  await flushPromises()
  return wrapper
}

/** 模拟一次站内跳转（真实路由变化，不是改一个假对象的字段） */
const navigate = async (wrapper, path) => {
  await wrapper.vm.$router.push(path)
  await flushPromises()
}

describe('访问上报 · 什么时候报', () => {
  it('首次进入就报一次（否则"直接打开首页"这类访问在统计里不存在）', async () => {
    await mountApp('/')

    expect(visitBodies()).toEqual([{ path: '/' }])
  })

  it('★ 站内跳转要再报一次（这才是访问量的主要部分）', async () => {
    const wrapper = await mountApp('/')

    await navigate(wrapper, '/archive')

    expect(visitBodies()).toEqual([{ path: '/' }, { path: '/archive' }])
  })

  // 「后台不报」这条规则在 test/visitReport.spec.ts 里按纯函数测（见那个文件）——
  // ⚠️ 不在这里测的原因：未登录直接挂 /admin 会被路由守卫重定向回首页，
  //    那样测到的是"被重定向了"，而不是"后台路径被排除了"。

  it('文章页照常上报（它另有一条浏览量上报，但那条管的是"这篇被看了几次"，两件事都要记）', async () => {
    await mountApp('/article/13')

    expect(visitBodies()).toEqual([{ path: '/article/13' }])
  })

  it('报的是路径而不是完整地址（查询串里可能是搜索词，不该进统计表）', async () => {
    await mountApp('/article/13?from=wechat')

    // 即使地址栏带着参数，报上去的也只有 path 部分
    expect(visitBodies()).toEqual([{ path: '/article/13' }])
  })
})

describe('访问上报 · 失败了也不能影响用户', () => {
  it('上报接口报错_页面照常渲染（统计是锦上添花的东西）', async () => {
    fetchMock.mockImplementation((url) => {
      const path = pathOf(url)
      if (path === '/visit') return Promise.resolve({ code: 500, message: '服务器内部错误', data: null })
      return mockBackend(), Promise.resolve(body(null))
    })

    const wrapper = await mountApp('/')

    // 页面还在（没有因为统计失败而白屏）
    expect(wrapper.exists()).toBe(true)
    // 而且确实尝试上报了（不是"因为怕失败就不报"）
    expect(visitBodies()).toEqual([{ path: '/' }])
  })
})
