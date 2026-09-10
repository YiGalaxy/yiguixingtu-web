import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'

// =====================================================================
// useSiteStats 的单元测试
//
// 【为什么值得测】
//   它是首页个人卡片与后台概览的唯一数据来源，而且有两处"必须做对"的行为：
//     ① 失败降级：接口挂了要让页面显示 0 / 占位，绝不能抛异常把首屏带崩
//     ② 数字归一化：接口给 null、缺字段、字符串、负数时都要收成能显示的数量，
//        否则页面上会出现 NaN 或"-5 篇"这种东西
//   这两件事在界面上都不明显（接口一直正常的话永远看不到），所以用断言钉死。
//
// 【怎么拦请求】同 useApi / useUpload 的测试：$fetch 是 Nuxt 自动导入的，
//   vi.stubGlobal 拦不住，必须用 @nuxt/test-utils 的 mockNuxtImport。
// =====================================================================

const { fetchMock, tokenRef } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  tokenRef: { value: null },
}))
mockNuxtImport('$fetch', () => fetchMock)
mockNuxtImport('useCookie', () => () => tokenRef)

/** 后端统一返回 { code, message, data } */
const body = (data) => ({ code: 200, message: '成功', data })

/** 就是你实测过的那份真实返回 */
const REAL_STATS = { articleCount: 2, viewCount: 28, categoryCount: 3 }

describe('useSiteStats', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    tokenRef.value = null
  })

  // ---------------------------------------------------------------
  // 一、纯函数：归一化
  // ---------------------------------------------------------------
  describe('normalizeSiteStats / toCount', () => {
    it('正常返回_should原样取到三个数字', () => {
      expect(normalizeSiteStats(REAL_STATS))
        .toEqual({ articleCount: 2, viewCount: 28, categoryCount: 3 })
    })

    it('data 是 null_should给三个 0，而不是让模板拿到 undefined', () => {
      expect(normalizeSiteStats(null))
        .toEqual({ articleCount: 0, viewCount: 0, categoryCount: 0 })
    })

    it('少了某些字段_should缺的那个当 0，其它照常', () => {
      expect(normalizeSiteStats({ articleCount: 5 }))
        .toEqual({ articleCount: 5, viewCount: 0, categoryCount: 0 })
    })

    it('字段是数字字符串_should转成数字（JSON 序列化差异不至于让页面显示不出来）', () => {
      expect(normalizeSiteStats({ articleCount: '12', viewCount: '0', categoryCount: '3' }).articleCount).toBe(12)
    })

    it('字段是非法值_should一律当 0（不能出现 NaN）', () => {
      expect(toCount('abc')).toBe(0)
      expect(toCount(undefined)).toBe(0)
      expect(toCount(null)).toBe(0)
      expect(toCount({})).toBe(0)
      // NaN 直接显示在页面上比 0 更难排查，所以在这里就拦掉
      expect(Number.isNaN(normalizeSiteStats({ viewCount: 'x' }).viewCount)).toBe(false)
    })

    it('字段是负数_should当 0（统计值不可能为负，"-5 篇"是明显不合理的展示）', () => {
      expect(toCount(-5)).toBe(0)
    })
  })

  // ---------------------------------------------------------------
  // 二、请求与成功路径
  // ---------------------------------------------------------------
  describe('load（请求正确 + 成功时更新数字）', () => {
    it('请求发到 /article/stats（GET，不带 body）', async () => {
      fetchMock.mockResolvedValue(body(REAL_STATS))

      const { load } = useSiteStats()
      await load()

      const [url, options] = fetchMock.mock.calls[0]
      expect(url).toBe('/article/stats')
      expect(options.method).toBeUndefined()      // 不传 method 即 GET
      expect(options.body).toBeUndefined()
    })

    it('成功_should把三个数字写进 stats、failed 归位', async () => {
      fetchMock.mockResolvedValue(body(REAL_STATS))

      const { stats, failed, load } = useSiteStats()
      const res = await load()

      expect(res.ok).toBe(true)
      expect(stats.value).toEqual({ articleCount: 2, viewCount: 28, categoryCount: 3 })
      expect(failed.value).toBe(false)
    })

    it('未登录/游客也能拿到（公开接口，不该被 token 影响）', async () => {
      fetchMock.mockResolvedValue(body(REAL_STATS))
      tokenRef.value = null

      const { stats, load } = useSiteStats()
      await load()

      expect(stats.value.articleCount).toBe(2)
      const headers = fetchMock.mock.calls[0][1].headers
      // 没登录时不能带 Authorization，带了反而可能被后端当成"登录态异常"
      expect(headers.Authorization).toBeUndefined()
    })

    it('初始值_should是三个 0，首屏模板不会拿到 undefined', () => {
      const { stats, failed, loading } = useSiteStats()
      expect(stats.value).toEqual({ articleCount: 0, viewCount: 0, categoryCount: 0 })
      expect(failed.value).toBe(false)
      expect(loading.value).toBe(false)
    })
  })

  // ---------------------------------------------------------------
  // 三、失败降级（本用例的重点）
  // ---------------------------------------------------------------
  describe('load（失败必须降级，不能崩）', () => {
    it('业务失败（code≠200）_should返回 ok:false、数字保持 0、不抛异常', async () => {
      fetchMock.mockResolvedValue({ code: 500, message: '服务器开小差了' })

      const { stats, failed, load } = useSiteStats()
      const res = await load()

      expect(res.ok).toBe(false)
      expect(stats.value).toEqual({ articleCount: 0, viewCount: 0, categoryCount: 0 })
      expect(failed.value).toBe(true)
    })

    it('HTTP 层异常（500 / 断网）_should同样降级而不是把异常抛给页面', async () => {
      fetchMock.mockRejectedValue({ status: 500 })

      const { stats, failed, load } = useSiteStats()
      await expect(load()).resolves.toEqual({ ok: false })

      expect(stats.value.articleCount).toBe(0)
      expect(failed.value).toBe(true)
    })

    it('request 内部抛异常时_should也被兜住（不把"下游永不抛"当成假设）', async () => {
      fetchMock.mockImplementation(() => { throw new Error('boom') })

      const { failed, load } = useSiteStats()
      await expect(load()).resolves.toEqual({ ok: false })
      expect(failed.value).toBe(true)
    })

    it('成功后再次失败_should保留上次的数字，只把失败标记立起来', async () => {
      fetchMock.mockResolvedValueOnce(body(REAL_STATS))

      const { stats, failed, load } = useSiteStats()
      await load()
      expect(stats.value.viewCount).toBe(28)

      fetchMock.mockResolvedValueOnce({ code: 500 })
      await load()

      // 有旧数据时，"上次的真实值 + 占位提示"比"假装是 0"更有用
      expect(stats.value.viewCount).toBe(28)
      expect(failed.value).toBe(true)
    })

    it('失败后重试成功_should恢复 failed 并刷新数字', async () => {
      fetchMock.mockResolvedValueOnce({ code: 500 })

      const { stats, failed, load } = useSiteStats()
      await load()
      expect(failed.value).toBe(true)

      fetchMock.mockResolvedValueOnce(body({ articleCount: 9, viewCount: 90, categoryCount: 4 }))
      await load()

      expect(failed.value).toBe(false)
      expect(stats.value).toEqual({ articleCount: 9, viewCount: 90, categoryCount: 4 })
    })
  })

  // ---------------------------------------------------------------
  // 四、loading 标记
  // ---------------------------------------------------------------
  describe('loading（页面要据此显示骨架 / 占位）', () => {
    it('请求进行中_should是 true，结束后回到 false', async () => {
      let resolveRequest
      fetchMock.mockImplementation(() => new Promise((resolve) => { resolveRequest = resolve }))

      const { loading, load } = useSiteStats()
      const pending = load()
      expect(loading.value).toBe(true)

      resolveRequest(body(REAL_STATS))
      await pending
      expect(loading.value).toBe(false)
    })

    it('失败路径_should同样把 loading 收回来（否则转圈永远不消失）', async () => {
      fetchMock.mockRejectedValue({ status: 500 })

      const { loading, load } = useSiteStats()
      await load()

      expect(loading.value).toBe(false)
    })
  })
})
