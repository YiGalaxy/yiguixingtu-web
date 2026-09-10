import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises, enableAutoUnmount } from '@vue/test-utils'
import ArchivePage from '~/pages/archive.vue'

// =====================================================================
// 归档页（/archive）的组件测试
//
// 【这一组守的是什么】
//   归档页本身很简单，它唯一"看着对、其实错了"的地方是【顺序】与【降级】：
//     · 前端自己再排一次：后端的契约是"月份倒序、每月内也倒序"。
//       前端要是顺手 sort 一遍，哪天后端的排序规则变了（比如加了置顶、
//       或改成按更新时间），前端这份排序会把它整个盖掉 ——
//       页面上看不出任何异常，只是顺序不对，没人会当成 bug 报上来。
//       所以下面把【乱序的输入】喂进去，断言输出顺序与输入完全一致。
//     · 接口挂了：months 是 undefined 时直接 v-for 会把整页打崩（白屏），
//       而"归档读不到"完全不该演变成"站点打不开"。
//     · total 与每月 count 的显示：这两个数字是后端算的，
//       显示错了用户对"站里到底有多少篇"的判断就跟着错。
//
// 【怎么拦请求】同其它页面测试：$fetch 是 Nuxt 自动导入的，
//   vi.stubGlobal 拦不住，必须用 mockNuxtImport 换成按 URL 分发的假实现。
//
// 【为什么每条用例结束都要卸载 + 等一个 nextTick】见 test/index.nuxt.spec.ts
//   里那段长注释：useAsyncData 的结果按 key 缓存在 Nuxt payload 里，
//   释放时机是【组件卸载】。测试文件里所有用例共用同一个 Nuxt 实例，
//   不卸载的话下一个用例会命中上一条的缓存 —— 一个请求都不发，
//   于是"接口失败"那条用例看到的还是上一轮成功的数据（最难查的一种假绿）。
// =====================================================================

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))
mockNuxtImport('$fetch', () => fetchMock)

enableAutoUnmount(afterEach)

/** 后端统一返回 { code, message, data } */
const body = (data) => ({ code: 200, message: '成功', data })

const pathOf = (url) => String(url).split('?')[0]

/**
 * 后端 GET /article/archive 的真实形状（月份与文章都已按时间倒序）。
 * 【为什么文章的 createTime 给同一个月里的不同天】页面上只印"日"，
 * 所以这里要能证明"印的是这一篇自己的日，不是当月的某一天"。
 */
const ARCHIVE = {
  months: [
    {
      year: 2026,
      month: 9,
      count: 2,
      articles: [
        { id: 117, title: '测试', createTime: '2026-09-10T05:03:19' },
        { id: 116, title: '你好，亿轨星途', createTime: '2026-09-01T04:49:43' },
      ],
    },
    {
      year: 2025,
      month: 12,
      count: 1,
      articles: [
        { id: 42, title: '去年的最后一篇', createTime: '2025-12-31T23:59:59' },
      ],
    },
  ],
  total: 3,
}

/** 默认的假后端：按接口名分发，可单独覆盖某一个接口的返回 */
const mockBackend = (overrides = {}) => {
  fetchMock.mockImplementation((url) => {
    const path = pathOf(url)
    if (path in overrides) return Promise.resolve(overrides[path])
    if (path === '/article/archive') return Promise.resolve(body(ARCHIVE))
    return Promise.resolve(body(null))
  })
}

/** 挂载归档页并等首屏数据落地 */
const mountArchive = async () => {
  const wrapper = await mountSuspended(ArchivePage)
  await flushPromises()
  return wrapper
}

/** 页面上渲染出来的月份标题（顺序就是 DOM 顺序，也就是用户看到的顺序） */
const monthLabels = (wrapper) => wrapper.findAll('.ar-month .am-date').map(n => n.text())

/** 某个月里的文章标题 */
const articleTitles = (wrapper, index = 0) =>
  wrapper.findAll('.ar-month')[index].findAll('.am-item .am-title').map(n => n.text())

describe('归档页 · 按年月浏览全部文章', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    mockBackend()
  })

  afterEach(async () => {
    // 见文件头：等 useAsyncData 的缓存清理真正落地
    await nextTick()
  })

  // ---------------------------------------------------------------
  // 一、正常渲染
  // ---------------------------------------------------------------

  it('有数据_should按月份分组渲染标题、篇数与文章', async () => {
    const wrapper = await mountArchive()

    expect(monthLabels(wrapper)).toEqual(['2026 年 9 月', '2025 年 12 月'])
    expect(articleTitles(wrapper, 0)).toEqual(['测试', '你好，亿轨星途'])
    expect(articleTitles(wrapper, 1)).toEqual(['去年的最后一篇'])
  })

  it('篇数_should用后端给的 count（而不是前端数数组长度）', async () => {
    const wrapper = await mountArchive()

    // 每个月的标题右侧那一格就是篇数
    const counts = wrapper.findAll('.ar-month .am-count').map(n => n.text())
    expect(counts).toEqual(['2 篇', '1 篇'])
  })

  it('count 缺失时_should回落到当月文章数组的长度，而不是显示 NaN', async () => {
    mockBackend({
      '/article/archive': body({
        months: [{ year: 2026, month: 3, articles: [{ id: 1, title: 'A', createTime: '2026-03-02T10:00:00' }] }],
        total: 1,
      }),
    })

    const wrapper = await mountArchive()

    expect(wrapper.find('.am-count').text()).toBe('1 篇')
    expect(wrapper.text()).not.toContain('NaN')
  })

  it('每条文章_should是能爬的站内链接（href 指向 /article/{id}）', async () => {
    const wrapper = await mountArchive()

    const links = wrapper.findAll('.ar-month')[0].findAll('.am-item')
    expect(links[0].attributes('href')).toBe('/article/117')
    expect(links[1].attributes('href')).toBe('/article/116')
  })

  it('每篇只印"日"_should是这一篇自己的日，且月份标题里已经带了年与月', async () => {
    const wrapper = await mountArchive()

    const days = wrapper.findAll('.ar-month')[0].findAll('.am-day').map(n => n.text())
    expect(days).toEqual(['10', '1'])
    // 完整日期里的 "2026-09" 不该再出现一次（重复信息还会把标题挤走）
    expect(wrapper.find('.ar-month').text()).not.toContain('2026-09')
  })

  it('createTime 拿不到时_should那一格留空，而不是印出 NaN 或 undefined', async () => {
    mockBackend({
      '/article/archive': body({
        months: [{ year: 2026, month: 3, count: 1, articles: [{ id: 1, title: '没有时间的文章', createTime: null }] }],
        total: 1,
      }),
    })

    const wrapper = await mountArchive()

    expect(wrapper.find('.am-day').text()).toBe('')
    expect(wrapper.text()).toContain('没有时间的文章')
    expect(wrapper.text()).not.toContain('undefined')
  })

  // ---------------------------------------------------------------
  // 二、顺序：绝不重排
  // ---------------------------------------------------------------

  it('后端给的顺序就是显示顺序_should【一次都不重排】', async () => {
    // 【为什么故意喂一个"乱序"的输入】如果前端顺手 sort 了一遍（哪怕按年份排），
    // 这个顺序就会变；而页面上看不出任何异常。用乱序输入才能钉住"前端没动手"。
    mockBackend({
      '/article/archive': body({
        months: [
          { year: 2026, month: 1, count: 1, articles: [{ id: 9, title: '一月', createTime: '2026-01-05T10:00:00' }] },
          { year: 2025, month: 12, count: 1, articles: [{ id: 8, title: '十二月', createTime: '2025-12-05T10:00:00' }] },
          { year: 2026, month: 9, count: 1, articles: [{ id: 7, title: '九月', createTime: '2026-09-05T10:00:00' }] },
        ],
        total: 3,
      }),
    })

    const wrapper = await mountArchive()

    expect(monthLabels(wrapper)).toEqual(['2026 年 1 月', '2025 年 12 月', '2026 年 9 月'])
  })

  it('同一个月里的文章顺序_should也完全照搬后端', async () => {
    mockBackend({
      '/article/archive': body({
        months: [{
          year: 2026,
          month: 5,
          count: 3,
          // 后端保证"最新在前"，但前端【不能靠这个假设去排】：
          // 这里给一个"旧的在前面"的输入，断言页面照原样渲染（顺序的责任在后端）
          articles: [
            { id: 3, title: '先显示的', createTime: '2026-05-01T10:00:00' },
            { id: 2, title: '中间', createTime: '2026-05-10T10:00:00' },
            { id: 1, title: '最后显示的', createTime: '2026-05-20T10:00:00' },
          ],
        }],
        total: 3,
      }),
    })

    const wrapper = await mountArchive()

    expect(articleTitles(wrapper)).toEqual(['先显示的', '中间', '最后显示的'])
  })

  // ---------------------------------------------------------------
  // 三、空数据与接口失败：都能显示成人话
  // ---------------------------------------------------------------

  it('一篇文章都没有_should显示空状态（而不是"读不到"）', async () => {
    mockBackend({ '/article/archive': body({ months: [], total: 0 }) })

    const wrapper = await mountArchive()

    expect(wrapper.text()).toContain('还没有发布任何文章')
    // 【这两种文案必须分开】空状态让用户"去写一篇"，失败让用户"稍后再来"，
    // 混在一起会把人指到错的方向
    expect(wrapper.text()).not.toContain('读不到')
    expect(wrapper.find('.ar-month').exists()).toBe(false)
  })

  it('总数显示在标题里_should用后端的 total', async () => {
    mockBackend({ '/article/archive': body({ months: [], total: 12 }) })

    const wrapper = await mountArchive()

    expect(wrapper.find('.ar-sub').text()).toContain('共 12 篇')
  })

  it('接口失败_should降级成空列表 + 一句友好提示，不能白屏也不是错误页', async () => {
    mockBackend({ '/article/archive': { code: 500, message: '服务器开小差了' } })

    const wrapper = await mountArchive()

    expect(wrapper.find('.ar-state').text()).toContain('归档暂时读不到')
    // 失败时给一个"还能去哪儿"的出口，而不是把用户卡在死路上
    expect(wrapper.find('.ar-state a').attributes('href')).toBe('/')
    // 页面骨架还在（标题渲染出来了），没有白屏
    expect(wrapper.find('.ar-head h1').text()).toBe('归档')
    // 失败时不该说"还没有发布任何文章" —— 那是在陈述一件我们并不知道的事
    expect(wrapper.text()).not.toContain('还没有发布任何文章')
    // 也不该报出一个总数
    expect(wrapper.find('.ar-sub').text()).not.toContain('共')
  })

  it('接口返回的不是预期结构（data 为 null / months 不是数组）_should当成空归档而不是把页面打崩', async () => {
    mockBackend({ '/article/archive': body({ months: { records: [] } }) })

    const wrapper = await mountArchive()

    expect(wrapper.text()).toContain('还没有发布任何文章')
    expect(wrapper.find('.ar-month').exists()).toBe(false)
  })

  it('total 是字符串或负数_should收成能显示的数字（不出现 -1 篇或 NaN）', async () => {
    mockBackend({
      '/article/archive': body({
        months: [{ year: 2026, month: 2, count: null, articles: [] }],
        total: '-7',
      }),
    })

    const wrapper = await mountArchive()

    expect(wrapper.find('.ar-sub').text()).toContain('共 0 篇')
    expect(wrapper.text()).not.toContain('-7')
  })

  it('请求拼装_should打到 /article/archive 且只打一次（key 是常量）', async () => {
    const wrapper = await mountArchive()

    const calls = fetchMock.mock.calls.filter(c => pathOf(c[0]) === '/article/archive')
    expect(calls).toHaveLength(1)
    // 归档接口没有任何参数：有参数的话说明前端在替后端做筛选/排序
    expect(calls[0][1]?.params).toBeUndefined()
    expect(wrapper.findAll('.ar-month')).toHaveLength(2)
  })
})
