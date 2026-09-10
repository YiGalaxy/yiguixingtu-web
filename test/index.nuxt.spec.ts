import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import IndexPage from '~/pages/index.vue'

// =====================================================================
// 首页「搜索 + 分类筛选」的组件测试
//
// 【为什么组合式函数已经测过了，还要挂载整个页面再测一遍】
//   composable 的用例证明的是"读写 URL 的那段逻辑对"，
//   而这一层要证明的是【页面真的把它接上去了】：
//     · 输入框 v-model 绑的是哪个变量、点分类会不会把 categoryId 传出去
//     · 首屏请求的参数是不是 page/size/keyword/categoryId（就是后端接口签名）
//     · 带参数的地址直接打开（等价于 F5 刷新）时，输入框与分类高亮能不能对上
//   这类"接错线"的 bug 编译器管不了，只测 composable 也管不了。
//
// 【怎么拦请求】
//   $fetch 是 Nuxt 自动导入的，vi.stubGlobal 拦不住（见 useApi 测试里的说明），
//   这里同样用 mockNuxtImport 换成按 URL 分发的假实现 ——
//   一个页面会打两个接口（/article/page 与 /category/list），必须分开给数据。
//
// 【怎么造"刷新页面"】
//   mountSuspended 支持 route 选项：先把路由推到该地址再挂载，
//   这正是"用户带着 ?keyword=nuxt&categoryId=2 打开首页"的情形。
//
// 【地址栏断言为什么要单独等】
//   router.replace() 是异步的（要跑完导航守卫，而 Nuxt 的 navigation-repaint
//   插件还会在守卫里等一次 requestAnimationFrame），只 await flushPromises()
//   拿到的还是旧地址 —— 见下面 settleRoute 的说明。
// =====================================================================

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))
mockNuxtImport('$fetch', () => fetchMock)

/** 后端统一返回 { code, message, data }，这里照抄一份，免得和真实结构脱钩 */
const body = (data) => ({ code: 200, message: '成功', data })

/** 把 '/article/page?page=1' 变成 '/article/page'，方便按接口名分发 */
const pathOf = (url) => String(url).split('?')[0]

const CATEGORIES = [
  { id: 1, name: '技术' },
  { id: 2, name: '随笔' },
  { id: 3, name: '读书' },
]

const ARTICLES = [
  { id: 11, title: '第一篇', categoryName: '技术', viewCount: 5, createTime: '2026-09-10T10:00:00' },
  { id: 12, title: '第二篇', categoryName: '随笔', viewCount: 3, createTime: '2026-09-09T10:00:00' },
]

/**
 * 站点统计接口的返回（就是实测到的那份真实数据）。
 * 【数字是刻意挑的】文章列表里两篇的 viewCount 是 5 与 3（合计 8），
 * 而统计接口给的浏览量是 28 —— 只要个人卡片显示 28 而不是 8，
 * 就证明它确实走了统计接口，而不是"拿当前这一页的文章求和"。
 */
const SITE_STATS = { articleCount: 2, viewCount: 28, categoryCount: 3 }

/** 默认的假后端：按接口名分发，并支持单独覆盖某一个接口的返回 */
const mockBackend = (overrides = {}) => {
  fetchMock.mockImplementation((url) => {
    const path = pathOf(url)
    if (path in overrides) return Promise.resolve(overrides[path])
    if (path === '/category/list') return Promise.resolve(body(CATEGORIES))
    if (path === '/article/stats') return Promise.resolve(body(SITE_STATS))
    // total 给 6、records 只给 2 条：这样 articles.length < total，
    // 页面才会渲染出「加载更多」按钮（分页那条用例要用到它）
    if (path === '/article/page') return Promise.resolve(body({ records: ARTICLES, total: 6 }))
    return Promise.resolve(body(null))
  })
}

/** 等一次地址栏变更真正落地（理由见文件头注释） */
const settleRoute = async () => {
  await flushPromises()
  await new Promise((resolve) => setTimeout(resolve, 20))
  await flushPromises()
}

/** 取最近一次 /article/page 请求带上去的参数（要断言"请求拼得对不对"） */
const lastArticleParams = () => {
  const call = [...fetchMock.mock.calls].reverse().find(c => pathOf(c[0]) === '/article/page')
  return call?.[1]?.params
}

/** 页面上渲染出来的分类按钮文字（含「全部」） */
const catLabels = (wrapper) => wrapper.findAll('.cat').map(c => c.text())

/** 当前地址栏的 query（用真路由读，证明"确实写进去了"） */
const currentQuery = (wrapper) => wrapper.vm.$router.currentRoute.value.query

/** 某个接口被请求了几次 */
const callCount = (path) => fetchMock.mock.calls.filter(c => pathOf(c[0]) === path).length

describe('首页 · 搜索与分类筛选', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    mockBackend()
  })

  afterEach(() => { vi.useRealTimers() })

  // ---------------------------------------------------------------
  // 一、分类筛选 UI
  // ---------------------------------------------------------------

  it('分类接口有数据_should渲染「全部」+ 每个分类的按钮', async () => {
    const wrapper = await mountSuspended(IndexPage)
    await settleRoute()

    expect(catLabels(wrapper)).toEqual(['全部', '技术', '随笔', '读书'])
    // 没选分类时，「全部」是选中态
    expect(wrapper.findAll('.cat')[0].classes()).toContain('on')
  })

  it('分类接口失败_should整条筛选条不渲染，页面照常显示文章', async () => {
    mockBackend({ '/category/list': { code: 500, message: '服务器开小差了' } })

    const wrapper = await mountSuspended(IndexPage)
    await settleRoute()

    // 一排空按钮比没有更糟：拿不到分类就不显示筛选条
    expect(wrapper.find('.cats').exists()).toBe(false)
    expect(wrapper.text()).toContain('第一篇')
  })

  it('分类接口返回了非数组_should当成空分类处理，而不是把渲染打挂', async () => {
    // 接口挂了 / 以后改成分页结构时，返回的可能是对象；
    // 直接拿去 .find 会抛 "categories.value.find is not a function"，
    // 首页会白屏（这条用例就是那次白屏的护栏）
    mockBackend({ '/category/list': body({ records: [] }) })

    const wrapper = await mountSuspended(IndexPage)
    await settleRoute()

    expect(wrapper.find('.cats').exists()).toBe(false)
    expect(wrapper.text()).toContain('第一篇')
  })

  it('默认进页面_should不按分类过滤（请求里没有 categoryId）', async () => {
    await mountSuspended(IndexPage)
    await settleRoute()

    const params = lastArticleParams()
    expect(params.page).toBe(1)
    expect(params.size).toBe(12)
    // 【关键】没选分类时不能传 categoryId，没输关键词时不能传空字符串
    expect(params.categoryId).toBeUndefined()
    expect(params.keyword).toBeUndefined()
  })

  // ---------------------------------------------------------------
  // 二、点分类：请求 + 地址栏 + 高亮
  // ---------------------------------------------------------------

  it('点分类_should用 categoryId 重新请求、写进地址栏，并把该按钮点亮', async () => {
    const wrapper = await mountSuspended(IndexPage)
    await settleRoute()

    await wrapper.findAll('.cat')[2].trigger('click')   // 「随笔」
    await settleRoute()

    // ① 请求参数：categoryId 必须是数字 2（后端按 Long 绑定）
    expect(lastArticleParams().categoryId).toBe(2)
    // ② 地址栏
    expect(currentQuery(wrapper).categoryId).toBe('2')
    // ③ 高亮：选中的是「随笔」，「全部」不再选中
    expect(wrapper.findAll('.cat')[2].classes()).toContain('on')
    expect(wrapper.findAll('.cat')[0].classes()).not.toContain('on')
    // ④ 标题跟着变，用户能看出当前筛的是哪一批
    expect(wrapper.find('.w-head h2').text()).toContain('随笔')
  })

  it('再点「全部」_should清掉 categoryId 并重新请求', async () => {
    const wrapper = await mountSuspended(IndexPage, { route: '/?categoryId=2' })
    await settleRoute()
    expect(lastArticleParams().categoryId).toBe(2)

    await wrapper.findAll('.cat')[0].trigger('click')   // 「全部」
    await settleRoute()

    expect(lastArticleParams().categoryId).toBeUndefined()
    expect(currentQuery(wrapper).categoryId).toBeUndefined()
  })

  it('筛选条件变化_should回到第 1 页重新请求（不能停在旧页上）', async () => {
    const wrapper = await mountSuspended(IndexPage)
    await settleRoute()

    // 先点两次「加载更多」把页码推到 3
    await wrapper.find('.more-btn').trigger('click')
    await flushPromises()
    await wrapper.find('.more-btn').trigger('click')
    await settleRoute()
    expect(lastArticleParams().page).toBe(3)

    await wrapper.findAll('.cat')[1].trigger('click')
    await settleRoute()

    // 换了筛选条件还停在第 3 页的话，后端那份数据根本不存在，用户只会看到空列表
    expect(lastArticleParams().page).toBe(1)
    expect(lastArticleParams().categoryId).toBe(1)
  })

  // ---------------------------------------------------------------
  // 三、刷新后从地址栏恢复
  // ---------------------------------------------------------------

  it('带参数的地址直接打开（等于刷新）_should恢复输入框、分类高亮与首次请求参数', async () => {
    const wrapper = await mountSuspended(IndexPage, { route: '/?keyword=nuxt&categoryId=2' })
    await settleRoute()

    // 输入框回填
    expect(wrapper.find('.searchbox input').element.value).toBe('nuxt')
    // 分类高亮
    expect(wrapper.findAll('.cat')[2].classes()).toContain('on')
    // 首屏第一次请求就带着两个条件，而不是先拉一遍全部再拉筛选结果
    expect(lastArticleParams().keyword).toBe('nuxt')
    expect(lastArticleParams().categoryId).toBe(2)
    // 标题与「清除筛选」入口都出来了
    expect(wrapper.find('.w-head h2').text()).toContain('nuxt')
    expect(wrapper.find('.w-clear').exists()).toBe(true)
  })

  it('地址栏里的 categoryId 是非法值_should当成没选分类，而不是把页面打挂', async () => {
    const wrapper = await mountSuspended(IndexPage, { route: '/?categoryId=abc' })
    await settleRoute()

    expect(wrapper.findAll('.cat')[0].classes()).toContain('on')
    expect(lastArticleParams().categoryId).toBeUndefined()
    expect(wrapper.text()).toContain('第一篇')
  })

  // ---------------------------------------------------------------
  // 四、关键词输入：防抖
  // ---------------------------------------------------------------

  it('输入关键词_should等防抖到点才请求（不是每敲一个字都请求）', async () => {
    const wrapper = await mountSuspended(IndexPage)
    await settleRoute()

    const before = callCount('/article/page')

    // 【为什么在挂载之后才打开假时钟】挂载过程里 Nuxt/vue 自己也要用定时器与
    // requestAnimationFrame，提前接管时钟会让 mountSuspended 卡住
    vi.useFakeTimers()
    await wrapper.find('.searchbox input').setValue('nu')
    await nextTick()

    // 输入框已经显示出来了（打字不能卡），但请求一个都没多发
    expect(wrapper.find('.searchbox input').element.value).toBe('nu')
    await vi.advanceTimersByTimeAsync(299)
    expect(callCount('/article/page')).toBe(before)

    await vi.advanceTimersByTimeAsync(1)
    await flushPromises()
    expect(lastArticleParams().keyword).toBe('nu')
  })

  it('清除筛选_should把输入框、分类、地址栏与请求参数一起清干净', async () => {
    const wrapper = await mountSuspended(IndexPage, { route: '/?keyword=nuxt&categoryId=2' })
    await settleRoute()

    await wrapper.find('.w-clear').trigger('click')
    await settleRoute()

    expect(wrapper.find('.searchbox input').element.value).toBe('')
    expect(wrapper.findAll('.cat')[0].classes()).toContain('on')
    expect(currentQuery(wrapper).keyword).toBeUndefined()
    expect(currentQuery(wrapper).categoryId).toBeUndefined()
    expect(lastArticleParams().keyword).toBeUndefined()
    expect(lastArticleParams().categoryId).toBeUndefined()
    // 没有筛选条件之后，标题回到默认，「清除筛选」入口也收起来
    expect(wrapper.find('.w-head h2').text()).toBe('最新文章')
    expect(wrapper.find('.w-clear').exists()).toBe(false)
  })

  // ---------------------------------------------------------------
  // 五、个人卡片的三个数字：来自站点统计接口
  // ---------------------------------------------------------------

  it('个人卡片_should显示统计接口给的全站数字，而不是当前页求和', async () => {
    const wrapper = await mountSuspended(IndexPage)
    await settleRoute()

    expect(callCount('/article/stats')).toBe(1)

    // 文章 2 / 浏览 28 / 分类 3 全部来自 /article/stats。
    // 浏览量尤其关键：列表里两篇的 viewCount 合计只有 8，显示 28 才说明
    // 用的不是"已加载文章求和"（那个数字会随「加载更多」一直变大）
    expect(wrapper.findAll('.pf-stats .st b').map(b => b.text())).toEqual(['2', '28', '3'])
  })

  it('统计接口失败_should显示占位符「—」，且文章列表照常渲染', async () => {
    mockBackend({ '/article/stats': { code: 500, message: '服务器开小差了' } })

    const wrapper = await mountSuspended(IndexPage)
    await settleRoute()

    // 0 会被访客当成"站点真的没有文章"，「—」才是诚实的"暂时读不到"
    expect(wrapper.findAll('.pf-stats .st b').map(b => b.text())).toEqual(['—', '—', '—'])
    // 统计挂了不该连累文章区
    expect(wrapper.text()).toContain('第一篇')
  })

  it('统计接口抛异常_should同样只影响这三张数字，不把首页带崩', async () => {
    fetchMock.mockImplementation((url) => {
      const path = pathOf(url)
      if (path === '/article/stats') throw new Error('boom')
      if (path === '/category/list') return Promise.resolve(body(CATEGORIES))
      return Promise.resolve(body({ records: ARTICLES, total: 6 }))
    })

    const wrapper = await mountSuspended(IndexPage)
    await settleRoute()

    expect(wrapper.findAll('.pf-stats .st b').map(b => b.text())).toEqual(['—', '—', '—'])
    expect(wrapper.find('.home').exists()).toBe(true)
    expect(wrapper.text()).toContain('第一篇')
  })

  it('带着筛选条件进页面_should不影响卡片上的全站数字（统计与筛选是两回事）', async () => {
    const wrapper = await mountSuspended(IndexPage, { route: '/?categoryId=2' })
    await settleRoute()

    expect(wrapper.findAll('.pf-stats .st b').map(b => b.text())).toEqual(['2', '28', '3'])
  })
})
