import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises, enableAutoUnmount } from '@vue/test-utils'
import LinksPage from '~/pages/links.vue'

// =====================================================================
// 友链页（/links）的组件测试
//
// 【这一组守的是什么】
//   友链页是"整块内容都是外链"的一页 —— 它存在的唯一意义就是把人送出去，
//   所以外链的属性（target / rel）在这页上比在别的页面更要紧：
//     · rel="noopener" 漏掉时，被打开的（别人控制的）页面可以通过 window.opener
//       反向操作本站；友链恰恰是"别人控制的站点"，这不是理论风险
//     · 地址缺失/非法时必须退化成文字：<a href=""> 会跳到本站首页（点了等于没反应）
//   另外两件：
//     · 头像可为空（后端允许），要有兜底，否则卡片左侧空一块
//     · 后端在前台只返回 status = 1 的（过滤在 SQL 层，见后端 LinkController），
//       所以这一页**不该**再按 status 过滤一次 —— 下面有一条用例钉住这件事
//
// 【怎么拦请求 / 为什么结束要卸载】见 test/favoritesPage.nuxt.spec.ts 的文件头。
// =====================================================================

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))
mockNuxtImport('$fetch', () => fetchMock)

enableAutoUnmount(afterEach)

const body = (data) => ({ code: 200, message: '成功', data })
const pathOf = (url) => String(url).split('?')[0]

/**
 * 后端 GET /link/list 的真实形状（FriendLinkVO）：
 *   { id, name, url, avatar, description, sort, status, createTime }
 * 【为什么第二条的 avatar 是 / 开头的站内路径】后端允许两种形态：
 *   上传接口返回的绝对地址，或图放在前端仓库 public 目录里的站内路径。
 * 【为什么第三条的 status 写成 1 却"看着像隐藏"】前台接口恒返回 1；
 *   这里给 1 是为了钉住"前端不按它过滤"（见下面的用例）。
 */
const LINKS = [
  {
    id: 1, name: '某某的博客', url: 'https://someone.example',
    avatar: 'https://someone.example/avatar.png', description: '写前端的一位朋友',
    sort: 1, status: 1, createTime: '2026-09-10T05:03:19',
  },
  {
    id: 2, name: '站内头像的站点', url: 'https://internal.example',
    avatar: '/avatar-2.png', description: null,
    sort: 2, status: 1, createTime: null,
  },
  {
    id: 3, name: '没有头像也没有介绍的站点', url: 'https://bare.example',
    avatar: null, description: '',
    sort: 3, status: 1,
  },
]

const mockBackend = (overrides = {}) => {
  fetchMock.mockImplementation((url) => {
    const path = pathOf(url)
    if (path in overrides) return Promise.resolve(overrides[path])
    if (path === '/link/list') return Promise.resolve(body(LINKS))
    return Promise.resolve(body(null))
  })
}

const mountLinks = async () => {
  const wrapper = await mountSuspended(LinksPage)
  await flushPromises()
  return wrapper
}

const cards = (wrapper) => wrapper.findAll('.lk-card')
const nameOf = (wrapper, index) => cards(wrapper)[index].find('.lc-name').text()

const headContent = (selector) => document.head.querySelector(selector)?.getAttribute('content')

const settleHead = async () => {
  await flushPromises()
  await new Promise((resolve) => { setTimeout(resolve, 0) })
  await flushPromises()
}

describe('友链页 · 把可以去的站点列出来', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    mockBackend()
  })

  afterEach(async () => {
    await nextTick()
  })

  // ---------------------------------------------------------------
  // 一、正常渲染
  // ---------------------------------------------------------------

  it('有数据_should按后端顺序渲染站点名与一句话介绍', async () => {
    const wrapper = await mountLinks()

    expect(cards(wrapper)).toHaveLength(3)
    expect(nameOf(wrapper, 0)).toBe('某某的博客')
    expect(nameOf(wrapper, 2)).toBe('没有头像也没有介绍的站点')
    expect(cards(wrapper)[0].find('.lc-desc').text()).toBe('写前端的一位朋友')
  })

  it('总数_should是列表长度（接口不分页、没有 total 字段）', async () => {
    const wrapper = await mountLinks()

    expect(wrapper.find('.lk-sub').text()).toContain('共 3 个')
  })

  it('头像_should原样使用后端给的地址（既支持外链也支持 / 开头的站内路径）', async () => {
    const wrapper = await mountLinks()

    expect(cards(wrapper)[0].find('.lc-img').attributes('src')).toBe('https://someone.example/avatar.png')
    expect(cards(wrapper)[1].find('.lc-img').attributes('src')).toBe('/avatar-2.png')
  })

  it('没有头像_should退化成"首字母"，而不是空一块或 src=undefined', async () => {
    const wrapper = await mountLinks()

    expect(cards(wrapper)[2].find('.lc-img').exists()).toBe(false)
    expect(cards(wrapper)[2].find('.lc-letter').text()).toBe('没')
    expect(wrapper.html()).not.toContain('src="undefined"')
  })

  // ---------------------------------------------------------------
  // 二、外链：这一页的核心
  // ---------------------------------------------------------------

  it('站点名_should是带 target=_blank 与 rel=noopener 的外链', async () => {
    const wrapper = await mountLinks()

    const link = cards(wrapper)[0].find('.lc-name')
    expect(link.element.tagName).toBe('A')
    expect(link.attributes('href')).toBe('https://someone.example')
    // 【为什么 rel=noopener 在友链页尤其要紧】打开的是**别人控制的站点**，
    // 不加的话它可以通过 window.opener 反向操作本站页面
    expect(link.attributes('target')).toBe('_blank')
    expect(link.attributes('rel')).toBe('noopener')
  })

  it('地址不是 http(s)_should不渲染成链接（挡存储型 XSS）', async () => {
    mockBackend({
      '/link/list': body([{ id: 1, name: '可疑站点', url: 'javascript:alert(1)', sort: 1, status: 1 }]),
    })

    const wrapper = await mountLinks()

    expect(wrapper.find('.lc-name').element.tagName).not.toBe('A')
    expect(wrapper.html()).not.toContain('javascript:')
    expect(wrapper.find('.lc-bad').text()).toContain('打不开')
  })

  it('地址缺失_should退化成文字并说明原因，而不是渲染 <a href="">', async () => {
    mockBackend({ '/link/list': body([{ id: 1, name: '没有地址的站点', url: null, sort: 1 }]) })

    const wrapper = await mountLinks()

    expect(wrapper.find('.lc-name').element.tagName).not.toBe('A')
    expect(wrapper.text()).toContain('没有地址的站点')
    expect(wrapper.text()).not.toContain('undefined')
  })

  // ---------------------------------------------------------------
  // 三、字段缺失与"前端不该再过滤一次"
  // ---------------------------------------------------------------

  it('介绍缺失_should整段不渲染（而不是留一个空行）', async () => {
    const wrapper = await mountLinks()

    expect(cards(wrapper)[1].find('.lc-desc').exists()).toBe(false)
    expect(cards(wrapper)[2].find('.lc-desc').exists()).toBe(false)
  })

  it('名字缺失_should显示「—」，而不是印出 undefined', async () => {
    // 地址给一个**合法**的：这样它会渲染成 <a>，文字里只有标题这一项，
    // 断言才能精确到"标题那一格显示的是什么"
    mockBackend({ '/link/list': body([{ id: 1, name: null, url: 'https://bare.example', sort: 1 }]) })

    const wrapper = await mountLinks()

    expect(wrapper.find('.lc-name').text()).toBe('—')
    // 主机名照常显示（它是从地址里解析出来的，与名字无关）
    expect(wrapper.find('.lc-host').text()).toBe('bare.example')
    expect(wrapper.text()).not.toContain('undefined')
  })

  it('地址缺失时_should主机名那一格也显示「—」，而不是空着或 NaN', async () => {
    mockBackend({ '/link/list': body([{ id: 1, name: '某站', url: null, sort: 1 }]) })

    const wrapper = await mountLinks()

    expect(wrapper.find('.lc-host').text()).toBe('—')
    expect(wrapper.text()).not.toContain('NaN')
  })

  it('前端【不该】再按 status 过滤一次（过滤是后端 SQL 层的事）', async () => {
    // 【为什么这条重要】后端 LinkController 的注释写明了：隐藏的友链在 SQL 层
    // 就被过滤掉了（status = 1），接口根本不返回它们。
    // 前端要是也写一个 filter(status === 1)，那是把同一个口径复制成两份 ——
    // 哪天后端改成"前台也要能看到草稿"（比如登录后预览），前端这份会静默把它挡掉。
    // 这里喂一条 status 为 0 的数据（正常情况下接口不会给），断言页面**照原样渲染**：
    // 证明"过滤"这件事不在前端。
    mockBackend({
      '/link/list': body([
        { id: 1, name: '接口居然返回了隐藏的', url: 'https://a.example/1', sort: 1, status: 0 },
      ]),
    })

    const wrapper = await mountLinks()

    expect(cards(wrapper)).toHaveLength(1)
    expect(nameOf(wrapper, 0)).toBe('接口居然返回了隐藏的')
  })

  // ---------------------------------------------------------------
  // 四、空数据与接口失败
  // ---------------------------------------------------------------

  it('空数据_should说"这里还空着"，而不是空白、也不是"读不到"', async () => {
    mockBackend({ '/link/list': body([]) })

    const wrapper = await mountLinks()

    expect(wrapper.find('.lk-state').text()).toContain('还没有添加任何友链')
    expect(wrapper.text()).not.toContain('读不到')
    expect(wrapper.find('.lk-card').exists()).toBe(false)
  })

  it('接口失败_should降级成一句人话 + 回首页的出口，页面骨架还在', async () => {
    mockBackend({ '/link/list': { code: 500, message: '服务器开小差了' } })

    const wrapper = await mountLinks()

    expect(wrapper.find('.lk-state').text()).toContain('友链暂时读不到')
    expect(wrapper.find('.lk-state a').attributes('href')).toBe('/')
    expect(wrapper.find('.lk-head h1').text()).toBe('友链')
    expect(wrapper.text()).not.toContain('还没有添加任何友链')
    expect(wrapper.find('.lk-sub').text()).not.toContain('共')
  })

  it('失败后点「重试」_should重新打一次接口，成功了就把卡片渲染出来', async () => {
    mockBackend({ '/link/list': { code: 500, message: '服务器开小差了' } })

    const wrapper = await mountLinks()
    expect(wrapper.find('.lk-retry').exists()).toBe(true)

    // 第二次请求成功（模拟"那次只是一次网络抖动"）
    mockBackend()
    await wrapper.find('.lk-retry').trigger('click')
    await flushPromises()

    // 断言内容而不是"请求次数 +1"：retry 的语义是"把这一页救回来" ——
    // 只发请求、界面不更新在次数上是看不出来的
    expect(cards(wrapper)).toHaveLength(3)
    expect(wrapper.find('.lk-state').exists()).toBe(false)
    expect(fetchMock.mock.calls.filter(c => pathOf(c[0]) === '/link/list').length).toBe(2)
  })

  it('接口返回的不是数组_should当成空列表，而不是把页面打崩', async () => {
    mockBackend({ '/link/list': body({ records: LINKS }) })

    const wrapper = await mountLinks()

    expect(wrapper.find('.lk-state').text()).toContain('还没有添加任何友链')
    expect(wrapper.find('.lk-card').exists()).toBe(false)
  })

  // ---------------------------------------------------------------
  // 五、请求拼装与 SEO
  // ---------------------------------------------------------------

  it('请求_should打到 /link/list 且只打一次、不带任何参数', async () => {
    await mountLinks()

    const calls = fetchMock.mock.calls.filter(c => pathOf(c[0]) === '/link/list')
    expect(calls).toHaveLength(1)
    expect(calls[0][1]?.params).toBeUndefined()
  })

  it('SEO_should有 title / description / canonical', async () => {
    await mountLinks()
    await settleHead()

    expect(document.title).toContain('友链')
    expect(headContent('meta[name="description"]')).toContain('友情链接')
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href'))
      .toBe('https://www.yigalaxy.xin/links')
  })
})
