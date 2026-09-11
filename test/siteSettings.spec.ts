import { describe, it, expect } from 'vitest'
import {
  DEFAULT_PAGE_SIZE,
  DEFAULT_SITE_SETTINGS,
  ICP_LINK,
  PAGE_SIZE_MAX,
  PAGE_SIZE_MIN,
  SETTING_LIMITS,
  hasIcp,
  normalizeSiteSettings,
} from '~/utils/siteSettings'
import { SITE_NAME } from '~/utils/seo'

// =====================================================================
// 站点设置的归一化（app/utils/siteSettings.ts）
//
// 【这一组守的是什么】
//   站点设置是"后端可能给不全、还可能整个读不到"的一份数据。归一化的职责是：
//   让拿到它的人**永远得到一个形状完整的对象**，不用各自判空。
//   如果每个用到它的地方各自兜，兜法一定会不一致 —— 最典型的就是**评论开关**：
//   一处按"读不到就当成开"、另一处按"读不到就当成关"，
//   于是接口抖一下的时候评论框就忽隐忽现。
//
//   所以下面这些用例里，最要紧的是两条：
//     ① 传 null / 非对象 / 空对象时，拿到的仍是**完整**的默认值（不是一堆 undefined）
//     ② 评论开关只有后端**明确给 false** 时才关 —— 其余一切情况都保持"开"
//        （它是"配置缺失"与"功能消失"的分界线）
// =====================================================================

describe('normalizeSiteSettings —— 形状永远完整', () => {
  it('正常输入：逐字段取回', () => {
    const s = normalizeSiteSettings({
      siteName: '某某博客',
      announcement: '今晚维护',
      commentEnabled: false,
      icpNumber: '京ICP备12345678号-1',
      copyright: '© 2026 某某',
      pageSize: 20,
    })
    expect(s).toEqual({
      siteName: '某某博客',
      announcement: '今晚维护',
      commentEnabled: false,
      icpNumber: '京ICP备12345678号-1',
      copyright: '© 2026 某某',
      pageSize: 20,
    })
  })

  // 这三种是本函数存在的理由：接口失败、那一行被删、返回了意料之外的东西
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['字符串', 'nope'],
    ['数组', [1, 2, 3]],
    ['空对象', {}],
  ])('异常输入（%s）→ 完整的默认值，而不是 undefined 满地', (_label, raw) => {
    expect(normalizeSiteSettings(raw)).toEqual(DEFAULT_SITE_SETTINGS)
  })

  it('站点名：空串 / 空白 / 非字符串 → 回落 seo.ts 的 SITE_NAME', () => {
    // 【为什么回落成那个常量】后端在"那一行缺失"时刻意返回 null（不自己编一个站名），
    // 就是为了让"默认站点名"只有 seo.ts 这一处定义 —— 改站名不会漏掉后端那一份
    for (const raw of ['', '   ', null, 123, {}]) {
      expect(normalizeSiteSettings({ siteName: raw }).siteName).toBe(SITE_NAME)
    }
    // 首尾空白要去掉（站长手滑打了空格不该体现在页眉上）
    expect(normalizeSiteSettings({ siteName: '  某某博客  ' }).siteName).toBe('某某博客')
  })

  it('评论开关：只有明确给 false 才关，其余一律保持开', () => {
    // ⚠️ 这是整个归一化里最要紧的一条：接口抖一下不该让全站的评论框消失
    //    （那是把"配置缺失"升级成了"功能消失"）
    expect(normalizeSiteSettings({ commentEnabled: false }).commentEnabled).toBe(false)
    expect(normalizeSiteSettings({ commentEnabled: true }).commentEnabled).toBe(true)
    for (const raw of [null, undefined, 0, 1, 'false', '', {}]) {
      expect(normalizeSiteSettings({ commentEnabled: raw }).commentEnabled).toBe(true)
    }
  })

  it('可选字段：空串 / 空白 → null（"没有"只有一种表示）', () => {
    const s = normalizeSiteSettings({ announcement: '  ', icpNumber: '', copyright: '   ' })
    expect(s.announcement).toBeNull()
    expect(s.icpNumber).toBeNull()
    expect(s.copyright).toBeNull()
    // 前端据此"整块不渲染"，而不是渲染一个空条
  })

  it('每页条数：越界与非法值的处理（夹取而不是全部回落）', () => {
    // 正常值原样通过
    expect(normalizeSiteSettings({ pageSize: 20 }).pageSize).toBe(20)
    expect(normalizeSiteSettings({ pageSize: PAGE_SIZE_MIN }).pageSize).toBe(PAGE_SIZE_MIN)
    expect(normalizeSiteSettings({ pageSize: PAGE_SIZE_MAX }).pageSize).toBe(PAGE_SIZE_MAX)

    // 太大 → 夹到上界（用户显然是想"多显示一些"，给他 50 比给他默认值更接近意图）
    expect(normalizeSiteSettings({ pageSize: 999 }).pageSize).toBe(PAGE_SIZE_MAX)

    // 小数取整（JS 里 12.7 这种值虽然不该出现，但不能让它进到请求参数里）
    expect(normalizeSiteSettings({ pageSize: 12.7 }).pageSize).toBe(12)

    // 非法 / 太小 → 回落默认值（后端给 0 或负数说明数据不对，不该让它变成坏请求）
    for (const raw of [0, -1, null, undefined, 'abc', NaN, Infinity]) {
      expect(normalizeSiteSettings({ pageSize: raw }).pageSize).toBe(DEFAULT_PAGE_SIZE)
    }
  })
})

describe('站点设置的常量', () => {
  it('每页条数的上界与后端的接口上限一致（都是 50）', () => {
    // 【为什么这条值得断言】后端的分页上限（ArticleQuery.MAX_PAGE_SIZE）会把超出的
    // size **静默夹到 50**；前端若允许更大的值，站长会看到一个"设置了但不生效"的开关。
    // 两边的 50 是同一个事实，各写一份迟早会漂移 —— 这条用例是那个事实的提醒。
    expect(PAGE_SIZE_MAX).toBe(50)
    expect(DEFAULT_PAGE_SIZE).toBe(12) // 3 列瀑布流正好 4 行，是排版决策
  })

  it('备案号链到工信部，而不是由站长填的地址', () => {
    // 备案号按规范必须链到工信部的查询页。让它可配置只会多出"填错/填成别处"的可能
    expect(ICP_LINK).toBe('https://beian.miit.gov.cn/')
  })

  it('hasIcp 只在真的有备案号时为真', () => {
    expect(hasIcp(normalizeSiteSettings({ icpNumber: '京ICP备12345678号-1' }))).toBe(true)
    expect(hasIcp(normalizeSiteSettings({ icpNumber: '  ' }))).toBe(false)
    expect(hasIcp(DEFAULT_SITE_SETTINGS)).toBe(false)
  })

  it('表单长度上限与后端 DTO 的注解一致（50 / 500 / 50 / 200）', () => {
    expect(SETTING_LIMITS).toEqual({
      siteName: 50,
      announcement: 500,
      icpNumber: 50,
      copyright: 200,
    })
  })
})
