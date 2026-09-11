import { describe, it, expect } from 'vitest'
import {
  DEFAULT_PAGE_SIZE,
  DEFAULT_SITE_SETTINGS,
  ICP_LINK,
  PAGE_SIZE_MAX,
  PAGE_SIZE_MIN,
  POLICE_LINK,
  SETTING_LIMITS,
  hasFooterMeta,
  hasIcp,
  hasPolice,
  normalizeSiteSettings,
  policeQueryUrl,
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
      policeNumber: '川公网安备 51090002000169号',
      copyright: '© 2026 某某',
      pageSize: 20,
    })
    expect(s).toEqual({
      siteName: '某某博客',
      announcement: '今晚维护',
      commentEnabled: false,
      icpNumber: '京ICP备12345678号-1',
      policeNumber: '川公网安备 51090002000169号',
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
    const s = normalizeSiteSettings({ announcement: '  ', icpNumber: '', policeNumber: '   ', copyright: '   ' })
    expect(s.announcement).toBeNull()
    expect(s.icpNumber).toBeNull()
    expect(s.policeNumber).toBeNull()
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

  it('表单长度上限与后端 DTO 的注解一致（50 / 500 / 50 / 50 / 200）', () => {
    expect(SETTING_LIMITS).toEqual({
      siteName: 50,
      announcement: 500,
      icpNumber: 50,
      policeNumber: 50,
      copyright: 200,
    })
  })
})

// =====================================================================
// 公安网安备案：链接怎么拼
//
// 【这一组守的是"备案号能不能点得对"】
//   两类备案的链接规则完全不同：ICP 是一个固定地址（谁的号都链到同一个查询页），
//   而公安备案的查询页要**带上这个站的备案编号**。编号又不是照着号码原样抄 ——
//   备案号是「川公网安备 51090002000169号」，前面是省份简称、后面带个「号」字，
//   平台要的参数只是中间那串数字。
//   拼错的后果很隐蔽：页脚照样显示、链接照样能点，只是点开是……
//   一个查不到东西的页面（或者干脆是平台首页）。所以这几条要钉住。
// =====================================================================
describe('公安备案的查询链接（policeQueryUrl）', () => {
  it('从备案号里取数字部分拼进 code 参数', () => {
    // 真实形态：省份简称 + 空格 + 数字 + 「号」
    expect(policeQueryUrl('川公网安备 51090002000169号'))
      .toBe('https://beian.mps.gov.cn/#/query/webSearch?code=51090002000169')
    // 没有空格、或者站长自己多打了几个字符，结果必须一样（只认数字）
    expect(policeQueryUrl('川公网安备51090002000169号'))
      .toBe('https://beian.mps.gov.cn/#/query/webSearch?code=51090002000169')
    expect(policeQueryUrl('  川公网安备 51090002000169号  '))
      .toBe('https://beian.mps.gov.cn/#/query/webSearch?code=51090002000169')
  })

  it('号里一个数字都没有时，回落到平台首页（而不是拼出一个空 code 的死链）', () => {
    // 合规要求是"页脚要能链到公安备案平台"，落到首页仍然满足这一点；
    // 而 `?code=` 空参数的地址点开只有一片空白，比首页更糟
    for (const raw of ['川公网安备号', 'abc', '', '   ']) {
      expect(policeQueryUrl(raw)).toBe(POLICE_LINK)
    }
    // 传 null/undefined 也不能抛异常（归一化虽然会给 null，但这个函数是公开的纯函数）
    expect(policeQueryUrl(null)).toBe(POLICE_LINK)
    expect(policeQueryUrl(undefined)).toBe(POLICE_LINK)
  })

  it('两个备案体系的平台地址是【两个】常量，不能混用', () => {
    // ICP → 工信部（固定地址）；公安 → 公安部平台（要带编号）。
    // 它们长得像，但换错了就是"点开查不到这个站的备案"，而且页面上完全看不出来
    expect(ICP_LINK).toBe('https://beian.miit.gov.cn/')
    expect(POLICE_LINK).toBe('https://beian.mps.gov.cn/')
    expect(policeQueryUrl('川公网安备 51090002000169号')).not.toContain('miit.gov.cn')
  })
})

describe('页脚那一行该不该渲染（hasFooterMeta）', () => {
  it('三项里有任何一项就渲染整行', () => {
    expect(hasFooterMeta(normalizeSiteSettings({ copyright: '© 2026 某某' }))).toBe(true)
    expect(hasFooterMeta(normalizeSiteSettings({ icpNumber: '京ICP备12345678号-1' }))).toBe(true)
    expect(hasFooterMeta(normalizeSiteSettings({ policeNumber: '川公网安备 51090002000169号' }))).toBe(true)
  })

  it('三项都没有（含空串、空白）→ 整行不渲染', () => {
    // 这一条是"上线这个功能不改变站点外观"的护栏：默认值下一个字都不该多出来
    expect(hasFooterMeta(DEFAULT_SITE_SETTINGS)).toBe(false)
    expect(hasFooterMeta(normalizeSiteSettings({ copyright: '  ', icpNumber: '', policeNumber: '   ' }))).toBe(false)
  })

  it('两类备案各自独立：填了公安备案号不代表 ICP 那项也算有', () => {
    // 【为什么这条值得单写】页脚那一行是个"三项并列、各自 v-if"的结构，
    // 很容易写成"有备案号就都显示"，于是没填 ICP 的站页脚会多出一个空链接
    const onlyPolice = normalizeSiteSettings({ policeNumber: '川公网安备 51090002000169号' })
    expect(hasPolice(onlyPolice)).toBe(true)
    expect(hasIcp(onlyPolice)).toBe(false)
  })
})
