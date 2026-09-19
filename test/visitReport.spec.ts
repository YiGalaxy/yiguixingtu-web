import { describe, it, expect } from 'vitest'
import { shouldReportVisit, VISIT_EXCLUDED_PREFIXES } from '~/utils/visitReport'

// =====================================================================
// 访问上报：哪些路径该报
//
// 【为什么这条规则值得单独一组用例】它写错的表现是**统计里多一批或少一批数据**，
//   而页面完全正常 —— 没有任何地方会报错，只有后台那个数字默默地不对。
//   而且这两种错法的排查方向完全相反：
//     · 少报了 → 曲线偏低，会让人以为"没人来"（其实是没记上）
//     · 多报了 → 站长自己看后台的那些访问混了进去，会让"访客构成"变成管理员 100%
//
// 【为什么不挂载外壳来测】未登录直接进 /admin 会被路由守卫重定向回首页 ——
//   那样测到的是"被重定向了"，而不是"这个路径被排除了"。
//   规则本身是个纯函数，直接调它最准确。
// =====================================================================

describe('shouldReportVisit —— 什么时候该报', () => {
  it.each([
    ['首页', '/'],
    ['归档', '/archive'],
    ['文章页', '/article/13'],
    ['音乐页', '/music'],
    ['带尾斜杠的路径', '/archive/'],
  ])('%s 要报', (_label, path) => {
    expect(shouldReportVisit(path)).toBe(true)
  })

  it('★ 后台路径不报（站长自己天天看后台，算进去会把统计带偏）', () => {
    expect(shouldReportVisit('/admin')).toBe(false)
    // 子路径同样要挡住 —— 只挡 '/admin' 本身的话，站内跳转后的
    // '/admin/article' 之类的地址会漏进来
    expect(shouldReportVisit('/admin/article')).toBe(false)
  })

  it('★ 前缀匹配要按【路径段】看，不能只是 startsWith 撞上', () => {
    // 【这条守的是一个很容易写出的过度排除】假如实现里写的是
    //   path.startsWith('/admin')，那 '/administrator'、'/admin-guide'
    //   这种**以 admin 开头但根本不属于后台**的路径也会被静默排除掉 ——
    //   表现为那个页面永远统计不到，而且没有任何报错。
    //   本项目的排除规则是 '/admin' 这个前缀（含它下面的子路径）。
    //   ⚠️ 目前站点上并不存在 /administrator 这样的页面；这条用例的意义是
    //      把"这条规则的边界在哪"写清楚，将来真加了这类路径时能立刻发现。
    expect(shouldReportVisit('/administrator')).toBe(true)
    expect(shouldReportVisit('/admin-guide')).toBe(true)
  })

  it.each([
    ['空串', ''],
    ['只有空格', '   '],
    ['null', null],
    ['undefined', undefined],
    ['数字', 123],
    ['相对路径（没有前导斜杠）', 'archive'],
    ['绝对地址（前端不该传这个，后端也会再洗一遍）', 'https://host/archive'],
  ])('%s → 不报（宁可不报，也不要往统计表里塞一条奇怪的路径）', (_label, path) => {
    expect(shouldReportVisit(path)).toBe(false)
  })

  it('排除清单本身要能被读到（它是规则的一部分，不是实现细节）', () => {
    expect(VISIT_EXCLUDED_PREFIXES).toContain('/admin')
  })
})
