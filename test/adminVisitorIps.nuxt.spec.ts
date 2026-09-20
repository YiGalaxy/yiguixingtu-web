import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises, enableAutoUnmount } from '@vue/test-utils'
import AdminPage from '~/pages/admin.vue'

// =====================================================================
// 后台「概览 → 访问统计 → 访客 IP」这个下钻弹窗
//
// 【这一组守的是什么】
//   IP 列表与上面那三张图不同：它是**点开才拉**的，而且带着完整 IP（个人信息）。
//   这两件事各自都有一种"错了也看不出来"的失效方式：
//     · 一进页面就把它拉回来 → 什么都没坏，只是"没人点开也传了访客 IP"，
//       而这正是当初把它与统计报表拆成两个接口的原因（后端也有对应用例）
//     · 天数与上面那三张图不共用 → 曲线是"近 7 天"、列表却是"近 30 天"，
//       两个数字对不上，看起来像统计错了
//     · 归属地为 null 时显示成空白 → 与"加载中"分不开（老记录 / IPv6 解析不出）
//
// 【怎么断言"发出去的请求"】与 adminComments 那套一致：$fetch 换成按 URL 分发的
//   假实现，从调用记录里读 method 与 params —— 天数是通过查询参数传的
//   （`GET /admin/stats/visits/ips?days=7`），所以 params 必须断言。
// =====================================================================

const { fetchMock, tokenRef } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  tokenRef: { value: 'fake-token' },
}))
mockNuxtImport('$fetch', () => fetchMock)
mockNuxtImport('useCookie', () => () => tokenRef)

// 每个用例结束都卸载：访客 IP 弹窗是 teleport 到 body 的，
// 不卸载就会一层层叠在 document.body 上（下面的 dialogRows 会数到上一个用例的行）
enableAutoUnmount(afterEach)

const body = (data) => ({ code: 200, message: '成功', data })
const pathOf = (url) => String(url).split('?')[0]

/** GET /admin/stats/visits 的返回：只填这块面板用得到的字段 */
const STATS = {
  days: 30,
  totalPv: 12,
  totalUv: 3,
  newVisitors: 2,
  daily: [],
  visitorTypes: [],
  refererTypes: [],
  devices: [],
  topPaths: [],
  topArticles: [],
}

/** GET /admin/stats/visits/ips 的返回：一个解析得出归属地的、一个解析不出的 */
const VISITOR_IPS = [
  { ip: '116.25.100.1', region: '广东省 深圳市', visits: 9, lastVisit: '2026-09-20T11:20:00' },
  { ip: '2001:db8::1', region: null, visits: 1, lastVisit: '2026-09-19T08:05:00' },
]

const mockBackend = (overrides = {}) => {
  fetchMock.mockImplementation((url, options) => {
    const path = pathOf(url)
    if (path in overrides) {
      const value = overrides[path]
      return Promise.resolve(typeof value === 'function' ? value(options) : value)
    }
    if (path === '/article/stats') return Promise.resolve(body({ articleCount: 1, viewCount: 3, categoryCount: 1 }))
    if (path === '/auth/me') return Promise.resolve(body({ id: 1, username: 'admin', role: 'ADMIN' }))
    if (path === '/user/page') return Promise.resolve(body({ records: [], total: 1 }))
    if (path === '/category/list') return Promise.resolve(body([]))
    if (path === '/admin/tag/list') return Promise.resolve(body([]))
    if (path === '/admin/article/page') return Promise.resolve(body({ records: [], total: 0 }))
    if (path === '/admin/stats/visits') return Promise.resolve(body(STATS))
    if (path === '/admin/stats/visits/ips') return Promise.resolve(body(VISITOR_IPS))
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

/** 挂后台并切到「概览」（默认停在用户管理，菜单顺序见 admin.vue 的 menus） */
const mountOverview = async () => {
  const wrapper = await mountSuspended(AdminPage, { route: '/admin' })
  await flushPromises()
  await wrapper.findAll('.side-nav a').find(a => a.text().includes('概览')).trigger('click')
  await flushPromises()
  return wrapper
}

/** 所有访客 IP 列表的请求（用于断言"点开才拉"与天数口径） */
const ipRequests = () =>
  fetchMock.mock.calls
    .filter(c => pathOf(c[0]) === '/admin/stats/visits/ips')
    .map(c => c[1]?.params)

/** 「访客 IP」那个按钮 */
const ipButton = (wrapper) =>
  wrapper.findAll('.panel-head button').find(b => b.text().includes('访客 IP'))

/**
 * 切到某个天数。
 * 【为什么点的是那个隐藏的 radio input 而不是可见的那块】el-radio-button 渲染成
 *   `<label><input type="radio"><span>近 7 天</span></label>`，可见的是 span ——
 *   而它在 jsdom 里点不动（label 的"点它等于点里面的控件"是浏览器行为，
 *   jsdom 的 label 激活不完整）。直接给 radio 赋值并触发 change 才是
 *   真正驱动 v-model 的那条路径。
 */
const pickDays = async (wrapper, days) => {
  await wrapper.find(`.panel-head input.el-radio-button__original-radio[value="${days}"]`).setValue()
  await flushPromises()
}

/** 当前弹窗里渲染出来的行 */
const dialogRows = (wrapper) =>
  wrapper.findAll('.el-dialog .el-table__row')

describe('访客 IP · 什么时候才去拉数据', () => {
  it('★ 打开概览【不会】去拉访客 IP（没人点开就不该把访客 IP 传到浏览器）', async () => {
    await mountOverview()

    expect(ipRequests()).toEqual([])
  })

  it('★ 点了「访客 IP」才拉，且带上当前选的天数', async () => {
    const wrapper = await mountOverview()

    await ipButton(wrapper).trigger('click')
    await flushPromises()

    expect(ipRequests()).toEqual([{ days: 30 }])
  })

  it('★ 天数跟着上面那三张图走：切到「近 7 天」再点开，拉的是 7 天', async () => {
    const wrapper = await mountOverview()

    await pickDays(wrapper, 7)
    await ipButton(wrapper).trigger('click')
    await flushPromises()

    // ⚠️ 这条是"口径一致"的守卫：两个请求各按各的天数算的话，
    //    曲线说这段时间有 3 个访客、列表里却有 15 行，看起来像统计坏了
    expect(ipRequests()).toEqual([{ days: 7 }])
  })

  it('这段时间没有访问记录时按钮点不动（空表点开没有意义）', async () => {
    mockBackend({ '/admin/stats/visits': body({ ...STATS, totalPv: 0, totalUv: 0, newVisitors: 0 }) })
    const wrapper = await mountOverview()

    expect(ipButton(wrapper).attributes('disabled')).toBeDefined()
    expect(ipRequests()).toEqual([])
  })
})

describe('访客 IP · 列表长什么样', () => {
  it('显示 IP / 归属地 / 访问次数 / 最后访问时间', async () => {
    const wrapper = await mountOverview()
    await ipButton(wrapper).trigger('click')
    await flushPromises()

    const rows = dialogRows(wrapper)
    expect(rows).toHaveLength(2)

    const first = rows[0].text()
    expect(first).toContain('116.25.100.1')
    expect(first).toContain('广东省 深圳市')
    expect(first).toContain('9')
    // 时间统一走 formatDateTime（T 换成空格、截到秒）
    expect(first).toContain('2026-09-20 11:20:00')
  })

  it('★ 归属地解析不出来的显示「—」，不是空白（留白看起来像没加载出来）', async () => {
    const wrapper = await mountOverview()
    await ipButton(wrapper).trigger('click')
    await flushPromises()

    const second = dialogRows(wrapper)[1].text()
    expect(second).toContain('2001:db8::1')
    expect(second).toContain('—')
  })

  it('说明里点出"最多显示 200 个"与"个人信息"（被截断这件事必须说出来）', async () => {
    const wrapper = await mountOverview()
    await ipButton(wrapper).trigger('click')
    await flushPromises()

    const note = wrapper.find('.el-dialog .vs-ip-note').text()
    expect(note).toContain('200')
    expect(note).toContain('个人信息')
  })

  it('接口失败时说清楚是这一块读不到，而不是显示一张空表', async () => {
    mockBackend({ '/admin/stats/visits/ips': { code: 500, message: '服务器内部错误' } })
    const wrapper = await mountOverview()
    await ipButton(wrapper).trigger('click')
    await flushPromises()

    expect(wrapper.find('.el-dialog').text()).toContain('访客数据读取失败')
    expect(dialogRows(wrapper)).toHaveLength(0)
  })
})
