import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises, enableAutoUnmount } from '@vue/test-utils'
import FavoritesPage from '~/pages/favorites.vue'

// =====================================================================
// 收藏页（/favorites）的组件测试
//
// 【这一组守的是什么】
//   收藏列表是**自由文本分组 + 外链**这两件事的交汇处，它"看着对、其实错了"
//   的几种方式都很安静：
//     · 前端自己把分组重排一遍：后端的契约是 ORDER BY sort ASC, id ASC，
//       分组按"在列表里第一次出现"的顺序显示。前端顺手 sort 一次就会把它盖掉，
//       而页面上看不出任何异常，只是顺序不对（没人会当成 bug 报上来）
//     · category 为空的那些被丢掉：用户会以为"我明明收藏了怎么不见了"
//     · 缺失字段印出 undefined / 空白：看起来像页面坏了
//     · 地址没经过白名单就渲染成 <a href>：`javascript:` 这类值会被执行
//       （存储型 XSS），这是这一页唯一的安全红线
//       —— 所以下面既断言"合法外链是 <a href> 且带 rel=noopener"，
//       也断言"非法/缺失地址根本不渲染成 <a>"
//     · 接口挂了就把整页打白：`months`/`list` 是 null 时 v-for 会抛异常，
//       而"收藏读不到"完全不该演变成"站点打不开"
//
// 【怎么拦请求】$fetch 是 Nuxt 自动导入的，vi.stubGlobal 拦不住，
//   必须用 mockNuxtImport 换成按 URL 分发的假实现（同其它页面测试）。
//
// 【为什么每条用例结束都要卸载 + 等一个 nextTick】useAsyncData 的结果按 key
//   缓存在 Nuxt payload 里，释放时机是【组件卸载】。测试文件里所有用例共用
//   同一个 Nuxt 实例，不卸载的话下一个用例会命中上一条的缓存 —— 一个请求都不发，
//   于是"接口失败"那条用例看到的还是上一轮成功的数据（最难查的一种假绿）。
// =====================================================================

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))
mockNuxtImport('$fetch', () => fetchMock)

enableAutoUnmount(afterEach)

/** 后端统一返回 { code, message, data } */
const body = (data) => ({ code: 200, message: '成功', data })

const pathOf = (url) => String(url).split('?')[0]

/**
 * 后端 GET /favorite/list 的真实形状（FavoriteVO）：
 * 按 sort 升序、id 升序给出来，category 可能为空（= 未分组）。
 * 【为什么第二条的 description / createTime 是 null、第三条的 category 是 null】
 *   后端允许可选字段不传，JSON 里就是 null —— 页面必须能扛住，
 *   而不是印出 undefined 或者留一格空白。
 */
const FAVORITES = [
  {
    id: 3, title: 'MySQL 索引原理图解', url: 'https://example.com/mysql',
    description: '讲得很清楚', category: '文章', sort: 1, status: 1, createTime: '2026-09-10T05:03:19',
  },
  {
    id: 4, title: '正则练习场', url: 'https://regex101.com',
    description: null, category: '工具', sort: 2, status: 1, createTime: null,
  },
  {
    id: 5, title: '还没分组的一条', url: 'https://example.org/x',
    description: '', category: null, sort: 3, status: 1,
  },
]

/** 默认的假后端：按接口名分发，可单独覆盖某一个接口的返回 */
const mockBackend = (overrides = {}) => {
  fetchMock.mockImplementation((url) => {
    const path = pathOf(url)
    if (path in overrides) return Promise.resolve(overrides[path])
    if (path === '/favorite/list') return Promise.resolve(body(FAVORITES))
    return Promise.resolve(body(null))
  })
}

/** 挂载收藏页并等首屏数据落地 */
const mountFavorites = async () => {
  const wrapper = await mountSuspended(FavoritesPage)
  await flushPromises()
  return wrapper
}

/** 页面上渲染出来的分组名（顺序就是 DOM 顺序，也就是用户看到的顺序） */
const groupLabels = (wrapper) => wrapper.findAll('.fv-group .fg-name').map(n => n.text())

/** 某一个分组里的条目标题 */
const titlesIn = (wrapper, index) =>
  wrapper.findAll('.fv-group')[index].findAll('.fg-item .fi-link').map(n => n.text())

/** 整页所有条目的标题（跨分组，按 DOM 顺序） */
const allTitles = (wrapper) => wrapper.findAll('.fg-item .fi-link').map(n => n.text())

/** 读 head 里某条标签的 content */
const headContent = (selector) => document.head.querySelector(selector)?.getAttribute('content')

/**
 * 等 head 真正写进 DOM。
 * 【为什么要等一个宏任务】unhead 的客户端渲染是**防抖**的（setTimeout 0），
 * 只 await flushPromises()（微任务）时 document.head 里还是空的 ——
 * 断言会拿到 ''，看起来像"SEO 压根没接上"，其实只是标签还没画出来。
 */
const settleHead = async () => {
  await flushPromises()
  await new Promise((resolve) => { setTimeout(resolve, 0) })
  await flushPromises()
}

describe('收藏页 · 按分组浏览收藏的链接', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    mockBackend()
  })

  afterEach(async () => {
    // 见文件头：等 useAsyncData 的缓存清理真正落地
    await nextTick()
  })

  // ---------------------------------------------------------------
  // 一、正常渲染与分组
  // ---------------------------------------------------------------

  it('有数据_should按 category 分组渲染（含"未分组"那一组）', async () => {
    const wrapper = await mountFavorites()

    expect(groupLabels(wrapper)).toEqual(['文章', '工具', '未分组'])
    expect(titlesIn(wrapper, 0)).toEqual(['MySQL 索引原理图解'])
    expect(titlesIn(wrapper, 1)).toEqual(['正则练习场'])
    // 【为什么"未分组"必须出现】category 为空是后端允许的正当状态；
    // 丢掉它的话用户会以为"我明明收藏了怎么不见了"
    expect(titlesIn(wrapper, 2)).toEqual(['还没分组的一条'])
  })

  it('后端给的顺序就是显示顺序_should【一次都不重排】', async () => {
    // 【为什么故意喂一个"乱序"的输入】后端的契约是 sort 升序，但前端**不能靠这个假设
    // 去排**（那是把后端的口径复制成两份）。这里给一个 sort 乱序、分组交错出现的列表，
    // 断言页面照原样渲染：分组按第一次出现的顺序、组内保持原顺序。
    mockBackend({
      '/favorite/list': body([
        { id: 1, title: '乙组第一条', url: 'https://a.example/1', category: '乙', sort: 9 },
        { id: 2, title: '甲组第一条', url: 'https://a.example/2', category: '甲', sort: 1 },
        { id: 3, title: '乙组第二条', url: 'https://a.example/3', category: '乙', sort: 2 },
      ]),
    })

    const wrapper = await mountFavorites()

    // 分组顺序 = 在列表里第一次出现的顺序（乙 先出现，所以乙在前）——
    // 前端要是按分组名或 sort 排过，这里就会变
    expect(groupLabels(wrapper)).toEqual(['乙', '甲'])
    expect(titlesIn(wrapper, 0)).toEqual(['乙组第一条', '乙组第二条'])
  })

  it('每组标题上的条数_should是这一组自己的条数', async () => {
    const wrapper = await mountFavorites()

    expect(wrapper.findAll('.fg-count').map(n => n.text())).toEqual(['1 条', '1 条', '1 条'])
  })

  it('总数显示在标题里_should是列表长度（接口不分页、没有 total）', async () => {
    const wrapper = await mountFavorites()

    expect(wrapper.find('.fv-sub').text()).toContain('共 3 条')
    expect(wrapper.find('.fv-sub').text()).toContain('3 个分组')
  })

  // ---------------------------------------------------------------
  // 二、外链：必须能点、且必须安全
  // ---------------------------------------------------------------

  it('外链_should是带 target=_blank 与 rel=noopener 的 <a href>', async () => {
    const wrapper = await mountFavorites()

    const link = wrapper.find('.fg-item .fi-link')
    expect(link.element.tagName).toBe('A')
    expect(link.attributes('href')).toBe('https://example.com/mysql')
    // target=_blank：收藏的价值是"以后还要再来"，把用户留在本站
    expect(link.attributes('target')).toBe('_blank')
    // rel=noopener：不加的话新页面能通过 window.opener 反向操作本站（钓鱼常用手法）
    expect(link.attributes('rel')).toBe('noopener')
  })

  it('地址不是 http(s) 的_should不渲染成链接（白名单，挡存储型 XSS）', async () => {
    // `javascript:` 这类地址如果进了 href，每个访客点一下就会执行它 ——
    // 这是这个页面唯一的安全红线，所以只认后端同一套白名单
    mockBackend({
      '/favorite/list': body([
        { id: 1, title: '可疑的一条', url: 'javascript:alert(1)', category: '工具', sort: 1 },
      ]),
    })

    const wrapper = await mountFavorites()

    const cell = wrapper.find('.fg-item .fi-link')
    expect(cell.element.tagName).not.toBe('A')
    expect(wrapper.html()).not.toContain('javascript:')
    // 标题照常显示，只是点不动
    expect(cell.text()).toContain('可疑的一条')
  })

  it('地址缺失_should退化成文字并说明原因，而不是渲染 <a href="">', async () => {
    mockBackend({
      '/favorite/list': body([{ id: 1, title: '没有地址的一条', url: null, category: '工具', sort: 1 }]),
    })

    const wrapper = await mountFavorites()

    expect(wrapper.find('.fg-item .fi-link').element.tagName).not.toBe('A')
    expect(wrapper.find('.fi-bad').text()).toContain('打不开')
    expect(wrapper.text()).not.toContain('undefined')
  })

  // ---------------------------------------------------------------
  // 三、字段缺失：显示「—」或干脆不显示，绝不出 undefined / NaN
  // ---------------------------------------------------------------

  it('标题缺失_should显示「—」，而不是印出 undefined', async () => {
    mockBackend({
      '/favorite/list': body([{ id: 1, title: null, url: 'https://a.example/1', category: '工具', sort: 1 }]),
    })

    const wrapper = await mountFavorites()

    expect(wrapper.find('.fg-item .fi-link').text()).toBe('—')
    expect(wrapper.text()).not.toContain('undefined')
  })

  it('备注缺失_should整段不渲染（而不是留一个空行）', async () => {
    const wrapper = await mountFavorites()

    // 第二条的 description 是 null、第三条是空串：两条都不该有备注节点
    expect(wrapper.findAll('.fv-group')[1].find('.fi-desc').exists()).toBe(false)
    expect(wrapper.findAll('.fv-group')[2].find('.fi-desc').exists()).toBe(false)
    expect(wrapper.findAll('.fv-group')[0].find('.fi-desc').text()).toBe('讲得很清楚')
  })

  it('地址缺失时_should显示主机名占位「—」，而不是空着或 NaN', async () => {
    mockBackend({
      '/favorite/list': body([{ id: 1, title: 'A', url: null, category: '工具', sort: 1 }]),
    })

    const wrapper = await mountFavorites()

    expect(wrapper.find('.fi-host').text()).toBe('—')
    expect(wrapper.text()).not.toContain('NaN')
  })

  // ---------------------------------------------------------------
  // 四、空数据与接口失败：两句不同的话
  // ---------------------------------------------------------------

  it('空数据_should说"这里还空着"，而不是空白、也不是"读不到"', async () => {
    mockBackend({ '/favorite/list': body([]) })

    const wrapper = await mountFavorites()

    expect(wrapper.find('.fv-state').text()).toContain('还没有收藏任何东西')
    // 【这两种文案必须分开】空状态让用户"去加一条"，失败让用户"稍后再来"，
    // 混在一起会把人指到错的方向
    expect(wrapper.text()).not.toContain('读不到')
    expect(wrapper.find('.fv-group').exists()).toBe(false)
  })

  it('接口失败_should降级成一句人话 + 回首页的出口，页面骨架还在', async () => {
    mockBackend({ '/favorite/list': { code: 500, message: '服务器开小差了' } })

    const wrapper = await mountFavorites()

    expect(wrapper.find('.fv-state').text()).toContain('收藏暂时读不到')
    // 失败时给一个"还能去哪儿"的出口，而不是把用户卡在死路上
    expect(wrapper.find('.fv-state a').attributes('href')).toBe('/')
    // 页面骨架还在（标题渲染出来了），没有白屏也不是错误页
    expect(wrapper.find('.fv-head h1').text()).toBe('收藏')
    // 失败时不该说"还没有收藏" —— 那是在陈述一件我们并不知道的事
    expect(wrapper.text()).not.toContain('还没有收藏')
    // 也不该报一个总数
    expect(wrapper.find('.fv-sub').text()).not.toContain('共')
  })

  it('失败后点「重试」_should重新打一次接口，成功了就把内容渲染出来', async () => {
    mockBackend({ '/favorite/list': { code: 500, message: '服务器开小差了' } })

    const wrapper = await mountFavorites()
    expect(wrapper.find('.fv-retry').exists()).toBe(true)

    // 第二次请求成功（模拟"那次是一次网络抖动，现在好了"）
    mockBackend()
    await wrapper.find('.fv-retry').trigger('click')
    await flushPromises()

    // 【为什么断言内容而不是"请求次数 +1"】retry 的语义是"把这一页救回来"：
    // 只发请求、界面不更新（比如 refresh 后没等它落地）在次数上是看不出来的
    expect(allTitles(wrapper)).toEqual(['MySQL 索引原理图解', '正则练习场', '还没分组的一条'])
    expect(wrapper.find('.fv-state').exists()).toBe(false)
    expect(fetchMock.mock.calls.filter(c => pathOf(c[0]) === '/favorite/list').length).toBe(2)
  })

  it('接口返回的不是数组_should当成空列表，而不是把页面打崩', async () => {
    // 后端哪天把结构改成分页的 { records: [] } 时，直接 v-for 会抛
    // "not iterable"，整页白屏 —— 而"收藏少显示一点"轻得多
    mockBackend({ '/favorite/list': body({ records: FAVORITES }) })

    const wrapper = await mountFavorites()

    expect(wrapper.find('.fv-state').text()).toContain('还没有收藏任何东西')
    expect(wrapper.find('.fv-group').exists()).toBe(false)
  })

  it('data 是 null_should同样不崩（这是 500 之外最常见的返回）', async () => {
    mockBackend({ '/favorite/list': body(null) })

    const wrapper = await mountFavorites()

    expect(wrapper.find('.fv-state').exists()).toBe(true)
    expect(wrapper.find('.fv-group').exists()).toBe(false)
  })

  // ---------------------------------------------------------------
  // 五、请求拼装与 SEO
  // ---------------------------------------------------------------

  it('请求_should打到 /favorite/list 且只打一次、不带任何参数', async () => {
    const wrapper = await mountFavorites()

    const calls = fetchMock.mock.calls.filter(c => pathOf(c[0]) === '/favorite/list')
    expect(calls).toHaveLength(1)
    // 收藏接口不分页、也没有筛选：带上参数说明前端在替后端做筛选
    expect(calls[0][1]?.params).toBeUndefined()
    expect(wrapper.findAll('.fv-group')).toHaveLength(3)
  })

  it('SEO_should有 title / description / canonical', async () => {
    await mountFavorites()
    await settleHead()

    expect(document.title).toContain('收藏')
    expect(headContent('meta[name="description"]')).toContain('收藏夹')
    // canonical 必须是绝对地址，而且固定指向 /favorites
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href'))
      .toBe('https://www.yigalaxy.xin/favorites')
    expect(headContent('meta[property="og:url"]')).toBe('https://www.yigalaxy.xin/favorites')
  })
})
