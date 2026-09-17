// =====================================================================
// 文章详情页的「浏览上报」
//
// 【这一组守着什么】
//   浏览量原来是【读详情时顺带记的】—— GET /article/{id} 里做一次 Redis INCR。
//   那让读接口带上写副作用，代价有三条：
//     · 详情接口永远不能加任何缓存（一缓存，计数就被跳过了）；
//     · 爬虫抓一次 = 一次浏览；
//     · NuxtLink 的预取（链接进视口就抓目标页）也算一次浏览。
//   现在改成：读详情是纯读，页面真正挂载之后单独 POST /article/{id}/view。
//
//   这个改动最危险的失效方式恰好是【静默的】：
//   上报那一行没接上、或者被条件挡住，页面一切正常，
//   只是浏览量永远停在库里的快照上 —— 没有任何报错，也没有任何界面异常。
//   所以三件事都必须钉住：
//     ① 挂载后确实发了这次 POST（第一组）
//     ② 拿不到文章时【不该】发（否则探测草稿会留下痕迹，后端那条规则就白写了）
//     ③ 上报失败时页面照常显示旧数字，不能报错（浏览量是锦上添花的数据）
//
// 【怎么拦请求】与 articleAttachments / articleComments 同款：
//   $fetch 换成按 URL 分发的假实现。
// =====================================================================

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))
mockNuxtImport('$fetch', () => fetchMock)

// 正文渲染交给 md-editor-v3；本组只关心"发没发那次上报"，
// 所以把 MdPreview 换成空组件（理由与 articleAttachments 那个文件相同）
vi.mock('md-editor-v3', async (importOriginal) => {
  const actual = await importOriginal()
  const { defineComponent, h } = await import('vue')
  return {
    ...actual,
    MdPreview: defineComponent({
      name: 'MdPreview',
      props: { modelValue: String },
      setup: () => () => h('div', { class: 'md-preview-stub' }),
    }),
  }
})

// 共用同一个 Nuxt 应用实例，不卸载就会串台
enableAutoUnmount(afterEach)

const body = (data) => ({ code: 200, message: '成功', data })
const pathOf = (url) => String(url).split('?')[0]
const callTo = (method, path) =>
  fetchMock.mock.calls.find(c => pathOf(c[0]) === path && c[1]?.method === method)

/** 详情接口的返回。viewCount 刻意不是 0 —— 才能验证"被上报结果覆盖"这件事 */
const ARTICLE = {
  id: 12,
  title: '一篇会被浏览的文章',
  summary: '摘要',
  content: '正文',
  categoryName: '技术',
  viewCount: 7,
  tags: [],
  attachments: [],
  createTime: '2026-09-18T10:00:00',
}

const mockBackend = (overrides = {}) => {
  fetchMock.mockImplementation((url) => {
    const path = pathOf(url)
    if (path in overrides) {
      const value = overrides[path]
      return Promise.resolve(typeof value === 'function' ? value() : value)
    }
    if (path === '/article/12') return Promise.resolve(body(ARTICLE))
    if (path === '/comment/list') return Promise.resolve(body({ records: [], total: 0, pages: 0 }))
    if (path === '/setting') return Promise.resolve(body({}))
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

/** 挂载文章详情页（造"带地址直接打开"的场景） */
const mountArticle = async () => {
  const ArticlePage = (await import('~/pages/article/[id].vue')).default
  const wrapper = await mountSuspended(ArticlePage, { route: '/article/12' })
  await flushPromises()
  return wrapper
}

describe('详情页的浏览上报', () => {
  it('挂载后应当上报一次浏览，并用服务端返回的最新总数更新显示', async () => {
    // 上报接口返回 8（库里的快照 7 + 本次这一次）
    mockBackend({ '/article/12/view': body(8) })

    const wrapper = await mountArticle()
    await flushPromises()

    expect(callTo('POST', '/article/12/view'),
      '详情页挂载后应当 POST /article/{id}/view 上报一次浏览 —— '
      + '少了这一步，浏览量会永远停在库里的快照上，而且不会有任何报错').toBeTruthy()

    // 显示的数字被上报结果覆盖（SSR 渲染的是详情接口给的 7）
    expect(wrapper.text()).toContain('8 次浏览')
  })

  it('拿不到文章时（草稿 / 已删除）不该上报浏览', async () => {
    mockBackend({ '/article/12': { code: 404, message: '文章不存在', data: null } })

    // 详情页拿不到文章时会抛 404 错误页（那是它的既有行为，见页面里 createError 那处），
    // 所以这里要接住它 —— 本用例关心的不是"它抛不抛"，
    // 而是"它有没有在没拿到文章的情况下还错误地记一次浏览"。
    await mountArticle().catch(() => {})

    expect(callTo('POST', '/article/12/view'),
      '看不见的文章不该被计数 —— 否则拿 id 挨个探测草稿就会留下浏览痕迹，'
      + '后端 recordView 里"先校验可见性再计数"那条规则也就白写了').toBeFalsy()
  })

  it('上报失败时保持原样显示，不让页面出问题', async () => {
    mockBackend({ '/article/12/view': { code: 500, message: '服务器开小差了', data: null } })

    const wrapper = await mountArticle()
    await flushPromises()

    // 显示退回详情接口给的那个数字，正文照常
    expect(wrapper.text()).toContain('7 次浏览')
    expect(wrapper.text()).toContain('一篇会被浏览的文章')
  })
})
