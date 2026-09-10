import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises, enableAutoUnmount } from '@vue/test-utils'

// =====================================================================
// 文章详情页的「标签」组件测试
//
// 【这一组守的是什么】
//   详情页只有一篇文章，本身没有筛选能力，所以"按标签看同标签的其他文章"
//   只能落到首页那套筛选状态上：点标签跳回首页、地址栏带上 ?tagId=。
//   这条链路跨了两个页面，出问题的表现都很安静：
//     · 标签没渲染出来（接口字段名写错、忘了兜 null）—— 页面照样正常
//     · 点标签没反应（@click 忘了绑，或者 .prevent 拦掉了默认行为却没跳转）
//     · 跳过去了但参数丢了 —— 用户看到的是"全部文章"，还以为这个标签下就这些
//   所以这里既断言渲染，也断言"点下去之后地址栏到底是什么"。
//
// 【为什么详情页要用 useAsyncData（SSR）】
//   正文必须出现在服务端返回的 HTML 里（SEO），标签跟着正文一起回来，
//   所以这里也顺带断言"第一帧就有标签"，而不是等某个 onMounted。
//
// 【为什么要换掉 md-editor-v3 的预览组件】
//   理由和 seo.nuxt.spec.ts 里写的完全一样：这一组只关心标签，
//   正文怎么渲染是 MdPreview 自己的事；换成空组件还能避开
//   ":language 传对象"那条与本次改动无关的 prop 类型警告。
//
// 【为什么每个用例结束都要卸载组件】
//   详情页也用 useAsyncData，结果按 key 缓存进 Nuxt payload，
//   而缓存的释放时机是组件卸载 —— 不卸载的话下一个用例会直接沿用上一份数据
//   （连请求都不发），"没有标签"那条用例看到的还是上一轮带标签的那篇。
// =====================================================================

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))
mockNuxtImport('$fetch', () => fetchMock)

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

enableAutoUnmount(afterEach)

const body = (data) => ({ code: 200, message: '成功', data })
const pathOf = (url) => String(url).split('?')[0]

/** 两枚标签：形状照抄后端 TagVO（详情里 articleCount 是 null，列表里才是数字） */
const TAGS = [
  { id: 7, name: 'Vue', sort: 1, articleCount: null },
  { id: 8, name: '部署', sort: 2, articleCount: null },
]

const DETAIL = {
  id: 12,
  title: '记一次标签改造',
  summary: '把标签接进筛选条件里。',
  categoryName: '技术',
  viewCount: 9,
  createTime: '2026-09-10T10:00:00',
  content: '# 正文\n\n标签和分类是同一类东西。',
  tags: TAGS,
}

const mockBackend = (overrides = {}) => {
  fetchMock.mockImplementation((url) => {
    const path = pathOf(url)
    if (path in overrides) return Promise.resolve(overrides[path])
    if (path === '/article/12') return Promise.resolve(body(DETAIL))
    return Promise.resolve(body(null))
  })
}

/** 挂载详情页（用 route 造出"用户打开 /article/12"这个场景） */
const mountArticle = async (route = '/article/12') => {
  const ArticlePage = (await import('~/pages/article/[id].vue')).default
  const wrapper = await mountSuspended(ArticlePage, { route })
  await flushPromises()
  return wrapper
}

/** 等一次路由变更真正落地（router.replace/push 之后还要过一遍导航守卫） */
const settleRoute = async () => {
  await flushPromises()
  await new Promise((resolve) => setTimeout(resolve, 20))
  await flushPromises()
}

describe('文章详情 · 标签', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    mockBackend()
  })

  afterEach(async () => {
    await nextTick()
  })

  it('文章有标签_should在标题上方渲染出来，并且第一帧就有（SSR 的诉求）', async () => {
    const wrapper = await mountArticle()

    expect(wrapper.findAll('.doc-tag').map(t => t.text())).toEqual(['#Vue', '#部署'])
    // 分类与标签在同一行，两个都在
    expect(wrapper.find('.doc-cat').text()).toBe('技术')
    expect(wrapper.find('.doc-title').text()).toBe(DETAIL.title)
  })

  it('没有标签_should整块标签区不渲染（不能留一个空的标签行）', async () => {
    mockBackend({ '/article/12': body({ ...DETAIL, tags: [] }) })

    const wrapper = await mountArticle()

    expect(wrapper.findAll('.doc-tag').length).toBe(0)
    // 正文照常渲染：标签缺失绝不该影响这一页的主要内容
    expect(wrapper.find('.doc-title').text()).toBe(DETAIL.title)
  })

  it('tags 是 null 或结构不对_should当成没有标签，而不是把详情页渲染带崩', async () => {
    // 后端保证"没有标签时是空数组"，但接口结构一旦变化（null / 对象），
    // 直接 v-for 会把整页带崩 —— 而正文才是详情页的全部价值
    mockBackend({ '/article/12': body({ ...DETAIL, tags: null }) })

    const wrapper = await mountArticle()

    expect(wrapper.findAll('.doc-tag').length).toBe(0)
    expect(wrapper.find('.doc-title').text()).toBe(DETAIL.title)
  })

  it('标签链接的 href_should指向首页的 tagId 筛选地址（内链可爬、可中键新开）', async () => {
    const wrapper = await mountArticle()

    // 真实 href 是给爬虫与"在新标签页打开"用的；左键点击会被 .prevent 换成站内跳转
    expect(wrapper.findAll('.doc-tag')[0].attributes('href')).toBe('/?tagId=7')
    expect(wrapper.findAll('.doc-tag')[1].attributes('href')).toBe('/?tagId=8')
  })

  it('点标签_should跳到首页并把 tagId 写进地址栏（首页据此筛选）', async () => {
    const wrapper = await mountArticle()
    expect(wrapper.vm.$router.currentRoute.value.path).toBe('/article/12')

    await wrapper.findAll('.doc-tag')[0].trigger('click')
    await settleRoute()

    const route = wrapper.vm.$router.currentRoute.value
    expect(route.path).toBe('/')
    // 必须是字符串 '7'：route.query 的值只有字符串，写数字进去 vue-router 也会转，
    // 但显式转换才能让断言和真实地址栏完全一致
    expect(route.query.tagId).toBe('7')
    // 不该带上别的筛选条件：用户点的是"看这个标签"，不是"保持刚才的筛选"
    expect(route.query.categoryId).toBeUndefined()
  })
})
