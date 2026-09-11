import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises, enableAutoUnmount } from '@vue/test-utils'
import ProjectsPage from '~/pages/projects.vue'

// =====================================================================
// 项目页（/projects）的组件测试
//
// 【这一组守的是什么】
//   项目卡片比收藏多了三件"看着对、其实错了"的事：
//     · 技术栈在库里是**逗号分隔的字符串**（后端有意不做成数组）。前端 split 之后
//       必须过滤空项，否则 "Spring Boot, , MySQL" 会渲染出一个空标签
//     · 封面可以为空，此时按后端实体注释里的约定退化成"渐变底 + 首字母"——
//       什么都不画的话，卡片左侧/顶部会空一块，看起来像加载失败
//     · url（在线）与 repo（仓库）**各自可选、但不能同时为空**（后端 Service 里那条
//       跨字段规则）。前端两个判断必须用**同一套白名单**，否则会出现
//       "一个链接都没有、却渲染出一个空按钮区"的怪状态
//   另外它和收藏页共享同一条安全红线：只有 http(s) 的地址才允许进 href。
//
// 【怎么拦请求 / 为什么结束要卸载】见 test/favoritesPage.nuxt.spec.ts 的文件头
//   （useAsyncData 的结果按 key 缓存、释放时机是组件卸载）。
// =====================================================================

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))
mockNuxtImport('$fetch', () => fetchMock)

enableAutoUnmount(afterEach)

const body = (data) => ({ code: 200, message: '成功', data })
const pathOf = (url) => String(url).split('?')[0]

/**
 * 后端 GET /project/list 的真实形状（ProjectVO）：
 *   { id, name, description, url, repo, cover, tech, sort, status, createTime }
 * 【为什么第二条故意只有 repo、第三条故意没有 cover / tech 是空串】
 *   后端允许"只填仓库不填在线"（url 与 repo 各自可选），
 *   也允许 cover / tech 为空 —— 这些都必须能正常渲染。
 */
const PROJECTS = [
  {
    id: 1, name: '亿轨星途博客系统', description: '前后端全栈的个人博客',
    url: 'https://www.yigalaxy.xin', repo: 'https://github.com/YiGalaxy/yiguixingtu',
    cover: '/uploads/cover-1.png', tech: 'Spring Boot,MySQL,Redis',
    sort: 1, status: 1, createTime: '2026-09-10T05:03:19',
  },
  {
    id: 2, name: '只有仓库的项目', description: null,
    url: null, repo: 'https://github.com/YiGalaxy/only-repo',
    cover: null, tech: 'Vue',
    sort: 2, status: 1, createTime: null,
  },
  {
    id: 3, name: '什么都没有的项目', description: '地址还没填',
    url: null, repo: null, cover: '', tech: '',
    sort: 3, status: 1,
  },
]

const mockBackend = (overrides = {}) => {
  fetchMock.mockImplementation((url) => {
    const path = pathOf(url)
    if (path in overrides) return Promise.resolve(overrides[path])
    if (path === '/project/list') return Promise.resolve(body(PROJECTS))
    return Promise.resolve(body(null))
  })
}

const mountProjects = async () => {
  const wrapper = await mountSuspended(ProjectsPage)
  await flushPromises()
  return wrapper
}

/** 页面上的项目卡片 */
const cards = (wrapper) => wrapper.findAll('.pj-card')
/** 某张卡片的标题 */
const nameOf = (wrapper, index) => cards(wrapper)[index].find('.pj-name').text()
/** 某张卡片里的技术栈标签文字 */
const techOf = (wrapper, index) => cards(wrapper)[index].findAll('.pt-item').map(n => n.text())

const headContent = (selector) => document.head.querySelector(selector)?.getAttribute('content')

/** 等 head 真正写进 DOM（unhead 的客户端渲染是防抖的，只 flush 微任务拿不到） */
const settleHead = async () => {
  await flushPromises()
  await new Promise((resolve) => { setTimeout(resolve, 0) })
  await flushPromises()
}

describe('项目页 · 卡片式展示做过的项目', () => {
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

  it('有数据_should按后端顺序渲染每张卡片的名称与简介', async () => {
    const wrapper = await mountProjects()

    expect(cards(wrapper)).toHaveLength(3)
    expect(nameOf(wrapper, 0)).toBe('亿轨星途博客系统')
    expect(nameOf(wrapper, 1)).toBe('只有仓库的项目')
    expect(cards(wrapper)[0].find('.pj-desc').text()).toBe('前后端全栈的个人博客')
  })

  it('技术栈_should按逗号拆成多个小标签，并且过滤掉空项', async () => {
    // 后端存的是字符串（ProjectForm 的注释写明了理由），前端 split 一次。
    // 这里刻意喂 "Spring Boot, , MySQL"（中间多打了一个逗号）：
    // 不过滤空项的话会渲染出一个空标签，看起来像界面坏了
    mockBackend({
      '/project/list': body([{ id: 1, name: 'A', tech: 'Spring Boot, , MySQL', url: 'https://a.example/1' }]),
    })

    const wrapper = await mountProjects()

    expect(techOf(wrapper, 0)).toEqual(['Spring Boot', 'MySQL'])
    expect(wrapper.findAll('.pt-item')).toHaveLength(2)
  })

  it('技术栈为空_should整块不渲染（不留一个空的标签行）', async () => {
    const wrapper = await mountProjects()

    expect(cards(wrapper)[2].find('.pj-tech').exists()).toBe(false)
  })

  it('有封面_should渲染 img，并把后端给的地址原样用作 src', async () => {
    const wrapper = await mountProjects()

    const img = cards(wrapper)[0].find('.pc-img')
    expect(img.exists()).toBe(true)
    expect(img.attributes('src')).toBe('/uploads/cover-1.png')
  })

  it('没有封面_should退化成"首字母"，而不是留一块空白或渲染 src=undefined', async () => {
    const wrapper = await mountProjects()

    // 第二条 cover 是 null、第三条是空串：两条都走兜底
    expect(cards(wrapper)[1].find('.pc-img').exists()).toBe(false)
    expect(cards(wrapper)[1].find('.pc-letter').text()).toBe('只')
    expect(cards(wrapper)[2].find('.pc-letter').text()).toBe('什')
    // src="undefined" 会往服务器发一个多余的 404 请求
    expect(wrapper.html()).not.toContain('src="undefined"')
  })

  // ---------------------------------------------------------------
  // 二、两个外链
  // ---------------------------------------------------------------

  it('在线与仓库_should都是带 target=_blank 与 rel=noopener 的 <a href>', async () => {
    const wrapper = await mountProjects()

    const links = cards(wrapper)[0].findAll('.pl-btn')
    expect(links).toHaveLength(2)
    expect(links[0].attributes('href')).toBe('https://www.yigalaxy.xin')
    expect(links[1].attributes('href')).toBe('https://github.com/YiGalaxy/yiguixingtu')
    for (const link of links) {
      expect(link.element.tagName).toBe('A')
      expect(link.attributes('target')).toBe('_blank')
      expect(link.attributes('rel')).toBe('noopener')
    }
  })

  it('只填了仓库_should只渲染一个链接（不留一个空的按钮位）', async () => {
    const wrapper = await mountProjects()

    const links = cards(wrapper)[1].findAll('.pl-btn')
    expect(links).toHaveLength(1)
    expect(links[0].text()).toBe('代码仓库')
  })

  it('两个地址都没有_should说清"点不开"，而不是渲染一个空链接区', async () => {
    const wrapper = await mountProjects()

    expect(cards(wrapper)[2].find('.pj-links').exists()).toBe(false)
    expect(cards(wrapper)[2].find('.pj-nolink').text()).toContain('暂时点不开')
  })

  it('地址不是 http(s)_should不渲染成链接（与收藏页同一套白名单）', async () => {
    mockBackend({
      '/project/list': body([{ id: 1, name: '可疑项目', url: 'javascript:alert(1)', repo: 'ftp://x/y' }]),
    })

    const wrapper = await mountProjects()

    // 【为什么两个判断必须是同一套规则】如果链接区用 `url || repo` 判、
    // 而按钮用白名单判，就会出现"链接区在、里面一个按钮都没有"的怪状态
    expect(cards(wrapper)[0].find('.pj-links').exists()).toBe(false)
    expect(cards(wrapper)[0].find('.pj-nolink').exists()).toBe(true)
    expect(wrapper.html()).not.toContain('javascript:')
  })

  // ---------------------------------------------------------------
  // 三、字段缺失
  // ---------------------------------------------------------------

  it('名称缺失_should显示「—」并且首字母只兜底成一个中性符号', async () => {
    mockBackend({ '/project/list': body([{ id: 1, name: null, url: 'https://a.example/1' }]) })

    const wrapper = await mountProjects()

    expect(wrapper.find('.pj-name').text()).toBe('—')
    expect(wrapper.find('.pc-letter').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('undefined')
  })

  it('简介缺失_should整段不渲染（而不是留一个空行）', async () => {
    const wrapper = await mountProjects()

    expect(cards(wrapper)[1].find('.pj-desc').exists()).toBe(false)
  })

  // ---------------------------------------------------------------
  // 四、空数据与接口失败
  // ---------------------------------------------------------------

  it('空数据_should说"这里还空着"，而不是空白、也不是"读不到"', async () => {
    mockBackend({ '/project/list': body([]) })

    const wrapper = await mountProjects()

    expect(wrapper.find('.pj-state').text()).toContain('还没有放上任何项目')
    expect(wrapper.text()).not.toContain('读不到')
    expect(wrapper.find('.pj-card').exists()).toBe(false)
  })

  it('接口失败_should降级成一句人话 + 回首页的出口，页面骨架还在', async () => {
    mockBackend({ '/project/list': { code: 500, message: '服务器开小差了' } })

    const wrapper = await mountProjects()

    expect(wrapper.find('.pj-state').text()).toContain('项目暂时读不到')
    expect(wrapper.find('.pj-state a').attributes('href')).toBe('/')
    expect(wrapper.find('.pj-head h1').text()).toBe('项目')
    expect(wrapper.text()).not.toContain('还没有放上任何项目')
    expect(wrapper.find('.pj-sub').text()).not.toContain('共')
  })

  it('失败后点「重试」_should重新打一次接口，成功了就把卡片渲染出来', async () => {
    mockBackend({ '/project/list': { code: 500, message: '服务器开小差了' } })

    const wrapper = await mountProjects()
    expect(wrapper.find('.pj-retry').exists()).toBe(true)

    // 第二次请求成功（模拟"那次只是一次网络抖动"）
    mockBackend()
    await wrapper.find('.pj-retry').trigger('click')
    await flushPromises()

    // 断言内容而不是"请求次数 +1"：retry 的语义是"把这一页救回来" ——
    // 只发请求、界面不更新在次数上是看不出来的
    expect(cards(wrapper)).toHaveLength(3)
    expect(wrapper.find('.pj-state').exists()).toBe(false)
    expect(fetchMock.mock.calls.filter(c => pathOf(c[0]) === '/project/list').length).toBe(2)
  })

  it('接口返回的不是数组_should当成空列表，而不是把页面打崩', async () => {
    mockBackend({ '/project/list': body({ records: PROJECTS }) })

    const wrapper = await mountProjects()

    expect(wrapper.find('.pj-state').text()).toContain('还没有放上任何项目')
    expect(wrapper.find('.pj-card').exists()).toBe(false)
  })

  // ---------------------------------------------------------------
  // 五、请求拼装与 SEO
  // ---------------------------------------------------------------

  it('请求_should打到 /project/list 且只打一次、不带任何参数', async () => {
    await mountProjects()

    const calls = fetchMock.mock.calls.filter(c => pathOf(c[0]) === '/project/list')
    expect(calls).toHaveLength(1)
    expect(calls[0][1]?.params).toBeUndefined()
  })

  it('SEO_should有 title / description / canonical', async () => {
    await mountProjects()
    await settleHead()

    expect(document.title).toContain('项目')
    expect(headContent('meta[name="description"]')).toContain('项目列表')
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href'))
      .toBe('https://www.yigalaxy.xin/projects')
  })
})
