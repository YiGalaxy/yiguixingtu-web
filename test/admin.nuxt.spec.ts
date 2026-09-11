import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import AdminPage from '~/pages/admin.vue'

// =====================================================================
// 后台「概览」的组件测试
//
// 【这次修的是什么，为什么要用组件测试守住】
//   改之前概览的四个数字直接取用户表格 / 文章表格 / 分类列表的变量，而那些表格
//   是"哪个菜单被点开才加载"的 —— 直接进后台点「概览」，四个数字全是 0；
//   在用户管理里筛了"禁用"，回到概览看到的又变成禁用用户数。
//   这是**页面接线的错误**，不是某个函数算错了，所以必须挂载整个页面来测：
//     · 进入 /admin 就应该主动把概览数据拉回来（不依赖用户点过哪些菜单）
//     · 四个数字来自独立请求，和被筛过的列表变量无关
//     · 接口失败时显示占位而不是 0，且页面其余部分照常渲染
//
// 【怎么拦请求】同首页的组件测试：$fetch 换成按 URL 分发的假实现
//   （admin.vue 一个页面会打 5 个接口，必须分开给数据）。
// =====================================================================

const { fetchMock, tokenRef } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  tokenRef: { value: 'fake-token' },
}))
mockNuxtImport('$fetch', () => fetchMock)
// admin.vue 的 ensureUser 会走 /auth/me，useApi 又要读 token —— 用普通 ref 代替真 cookie
// （理由同 useApi 测试：cookie 什么时候真正落盘是 Nuxt 内部实现，不该进断言）
mockNuxtImport('useCookie', () => () => tokenRef)

const body = (data) => ({ code: 200, message: '成功', data })
const pathOf = (url) => String(url).split('?')[0]

/** 与后端实测一致的真实返回 */
const REAL_STATS = { articleCount: 2, viewCount: 28, categoryCount: 3 }

/**
 * 默认的假后端：按接口名分发。
 * overrides 的值可以是响应体，也可以是一个【会抛错的函数】——
 * 后者用来模拟"请求层内部直接抛异常"这种最坏情况。
 */
const mockBackend = (overrides = {}) => {
  fetchMock.mockImplementation((url) => {
    const path = pathOf(url)
    const override = overrides[path]
    if (typeof override === 'function') return Promise.resolve(override())
    if (override) return Promise.resolve(override)
    if (path === '/article/stats') return Promise.resolve(body(REAL_STATS))
    if (path === '/auth/me') return Promise.resolve(body({ id: 1, username: 'admin', role: 'ADMIN' }))
    if (path === '/user/page') return Promise.resolve(body({ records: [], total: 7 }))
    if (path === '/category/list') return Promise.resolve(body([{ id: 1, name: '技术' }]))
    if (path === '/admin/article/page') return Promise.resolve(body({ records: [], total: 0 }))
    return Promise.resolve(body(null))
  })
}

/** 挂载后点左侧「概览」菜单 —— 概览不是默认页（默认停在用户管理） */
const gotoOverview = async (wrapper) => {
  await wrapper.findAll('.side-nav a')[0].trigger('click')
  await flushPromises()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await flushPromises()
}

/** 概览四张卡片的数字 */
const cardValues = (wrapper) => wrapper.findAll('.stat b').map(b => b.text())
/** 概览四张卡片的标题 */
const cardLabels = (wrapper) => wrapper.findAll('.stat span').map(s => s.text())
/** 某个接口被请求了几次 */
const callCount = (path) => fetchMock.mock.calls.filter(c => pathOf(c[0]) === path).length

describe('后台 · 概览数字', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    mockBackend()
  })

  // ---------------------------------------------------------------
  // 一、进入后台就主动加载（本次修复的重点）
  // ---------------------------------------------------------------

  it('进入 /admin_should主动请求统计接口，不用先点「概览」菜单', async () => {
    await mountSuspended(AdminPage)
    await flushPromises()

    expect(callCount('/article/stats')).toBe(1)

    // 用户数走的是独立的一次查询（page=1&size=1 只要 total），
    // 不复用用户表格的 total —— 那个会被管理员在用户管理页设的筛选条件影响
    const userCall = fetchMock.mock.calls.find(c => pathOf(c[0]) === '/user/page' && c[1]?.params?.size === 1)
    expect(userCall).toBeTruthy()
    expect(userCall[1].params.page).toBe(1)
  })

  it('点开「概览」_should显示统计接口返回的真实数字', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()

    await gotoOverview(wrapper)

    // 文章 2 / 浏览 28 / 分类 3 来自 /article/stats，用户 7 来自 /user/page 的 total
    expect(cardValues(wrapper)).toEqual(['2', '28', '3', '7'])
  })

  it('概览卡片_should标明文章数是"已发布"口径，并且不再有标签那张假卡片', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoOverview(wrapper)

    expect(cardLabels(wrapper)).toEqual(['文章（已发布）', '浏览量', '分类', '用户'])
    // 「标签 0」是写死的：后端还没有标签模块，留着它等于摆一个永远不变的数字
    expect(cardLabels(wrapper)).not.toContain('标签')
  })

  it('切到概览时_should再拉一次（刚发布完文章回到概览看到的是新数字）', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    expect(callCount('/article/stats')).toBe(1)

    await gotoOverview(wrapper)

    expect(callCount('/article/stats')).toBe(2)
  })

  // ---------------------------------------------------------------
  // 二、数字与列表筛选互不干扰
  // ---------------------------------------------------------------

  it('在用户管理里筛选过之后_should不影响概览的用户数', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()

    // 模拟"筛了一次用户"：表格那次查询（size=10）只数出 1 条，
    // 而概览用的那次查询（size=1）仍然是全站 7 —— 两个请求分开给数
    fetchMock.mockImplementation((url, options) => {
      const path = pathOf(url)
      if (path === '/user/page') {
        return Promise.resolve(body({ records: [], total: options?.params?.size === 1 ? 7 : 1 }))
      }
      if (path === '/article/stats') return Promise.resolve(body(REAL_STATS))
      return Promise.resolve(body({ records: [], total: 0 }))
    })
    await wrapper.find('.toolbar .el-button--primary').trigger('click')
    await flushPromises()

    await gotoOverview(wrapper)

    // 用户数仍然是全站 7（来自 size=1 那次独立查询），不是筛选后的 1
    expect(cardValues(wrapper)[3]).toBe('7')
  })

  // ---------------------------------------------------------------
  // 三、失败降级
  // ---------------------------------------------------------------

  it('统计接口失败_should显示占位符而不是 0，并且页面其余部分照常渲染', async () => {
    mockBackend({ '/article/stats': { code: 500, message: '服务器开小差了' } })

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoOverview(wrapper)

    // 0 会被当成"站点真的没有文章"，「—」才是诚实的"读不到"
    expect(cardValues(wrapper).slice(0, 3)).toEqual(['—', '—', '—'])
    // 用户那一路是好的，照常显示
    expect(cardValues(wrapper)[3]).toBe('7')
    // 页面没崩：左侧菜单、最近文章面板都在。
    // 【为什么这里从 5 改成 7、F5 之后又改成 11、音乐模块之后是 12】原来那个
    // 「分类 / 标签」占位菜单被拆成了「标签管理」与「分类管理」（两个都真能增删改），
    // 后面又接了「评论管理」—— 它们背后是后端三套不同的能力，
    // 挤在一个菜单里没法表达"各自的入口在哪"。
    // F5 又加了四个内容模块（收藏 / 项目 / 友链 / 关于），后面又加了「音乐管理」，
    // 每一个都是独立的表与接口。
    // 【为什么断言 .nv-label 而不是整个 a 的文字】评论管理那一项在有待审核时
    // 会多一个数字角标（动态的），拿 a 的文字去比会变成一条"看心情"的断言；
    // 只比标签文字，断言的就是"菜单项叫什么"这件事本身。
    // 【这条为什么值得逐字列出来】菜单是逐个 v-else-if 挂上去的，漏挂一个面板
    // ——或者插错了位置——都不会报错，只会让某个模块在后台里点不到。
    expect(wrapper.findAll('.side-nav .nv-label').map(a => a.text()))
      .toEqual([
        '概览', '文章管理', '用户管理', '标签管理', '分类管理',
        '收藏管理', '项目管理', '友链管理', '关于管理', '音乐管理', '评论管理', '设置',
      ])
    expect(wrapper.text()).toContain('最近文章')
  })

  it('统计接口抛异常_should也不把页面带崩', async () => {
    // 请求层自己抛异常（不是返回 { code }）—— 最坏的一种情况
    mockBackend({ '/article/stats': () => { throw new Error('boom') } })

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoOverview(wrapper)

    expect(cardValues(wrapper).slice(0, 3)).toEqual(['—', '—', '—'])
    expect(wrapper.find('.admin').exists()).toBe(true)
  })

  it('用户数接口失败_should只有用户那张卡片显示占位，统计数字照常', async () => {
    mockBackend({ '/user/page': { code: 403, message: '无权限访问' } })

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoOverview(wrapper)

    expect(cardValues(wrapper)).toEqual(['2', '28', '3', '—'])
  })
})
