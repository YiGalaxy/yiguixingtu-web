// ============================================================
// app/composables/useSiteStats.ts
// 作用：对接后端公开接口 GET /article/stats，拿到站点级别的三个数字
//       （已发布文章数 / 已发布文章总浏览量 / 分类数），供首页个人卡片
//       和后台概览显示。
//
// 【为什么必须换成这个接口，而不是前端自己算】
//   改之前首页那三个数字是"拿当前这一页的文章求和"：
//     · 文章数用的是 /article/page 的 total —— 只要加了筛选条件，它就变成
//       "符合条件的篇数"，不是全站的
//     · 浏览量是 articles.value.reduce(...) —— 只是"已加载的这 12 篇"之和，
//       用户点一次「加载更多」数字就变了（而它写的是"浏览"，看起来像全站）
//     · 分类数用的是 /category/list 的长度 —— 这个碰巧是对的，但口径不统一
//   口径一旦散落在前端，改口径就要改前端代码；放在后端一条 SQL 里算好，
//   前端只负责显示。而且后端这个接口的 SQL 是聚合查询，比前端把文章列表全拉回来求和便宜得多。
//
// 【口径：只统计已发布文章】（后端 ArticleStatsVO 的注释里写明了）
//   草稿是作者自己还没写完的东西，不该出现在对外展示的数字里 ——
//   否则首页写着"共 250 篇"，游客点进去只数得出 30 篇，看着像虚报。
//   这个口径是后端定的，前端不要自己去拼条件。
//
// 【失败了一定要降级】
//   这是首页首屏就会出现的东西，接口挂掉绝不能连累整页渲染：
//   这里不抛异常，把 stats 留成 0、failed 置 true，由页面决定显示 0 还是占位符。
//
// ⚠️【做 SSR 的页面里，显示的数字必须从 useAsyncData 的 data 里读，不要读这里的 ref】
//   这是 2026-09-12 修掉的一个真实线上 bug，现象是"首页那三个数字刷新一下先显示真值、
//   随即变成 0"。原因是 useAsyncData 的 handler 只在**服务端**执行一次，结果写进 payload，
//   浏览器水合时命中的是 payload 里那一份、handler 不会再跑 —— 所以只在这里的
//   `stats.value = ...` 里更新的数字，在浏览器上永远停在水合前的初始值 0。
//   正确写法见 app/pages/index.vue：`useAsyncData(key, () => load())` 之后从
//   `asyncData.data` 里取那一份 `{ ok, data }`。
//   这里的 stats / failed / load 适合"客户端自己调一次"的场景（后台概览就是），
//   那类页面没有服务端渲染的那一份 payload，行为完全正常。
//
// 关键词：
//   · GET /article/stats → { code, message, data: { articleCount, viewCount, categoryCount } }
//   · 三个字段后端是 Long，JSON 里是数字；这里仍然做一次归一化，
//     因为接口返回 null / 缺字段 / 字符串都不是不可能
// ============================================================

/** 接口路径单独提出来：页面与测试都引用它，避免两边各写一份字符串 */
export const SITE_STATS_PATH = '/article/stats'

/** 每个字段的初始值 / 降级值 */
export const EMPTY_SITE_STATS = Object.freeze({
  articleCount: 0,
  viewCount: 0,
  categoryCount: 0,
})

/**
 * 把一个值归一化成"可以显示的数量"。
 *
 * 【为什么不直接用 Number(x) || 0】
 *   `Number('abc')` 是 NaN，`NaN || 0` 是 0 —— 这条能过；但负数会漏过去
 *   （`-5 || 0` 还是 -5），显示成"-5 篇"很荒唐。
 *   数量的合法范围是"非负有限数"，照这个来卡，异常值一律当 0，
 *   宁可少显示，也不要在页面上出现 NaN 或负数。
 */
export const toCount = (value) => {
  const num = Number(value)
  return Number.isFinite(num) && num >= 0 ? Math.trunc(num) : 0
}

/**
 * 纯函数：接口返回的 data → 页面要用的三个数字。
 * 【为什么要归一化而不是直接透传】
 *   `data` 可能是 null（后端返回 data:null）、可能少了某个字段、
 *   也可能哪天多出一个字段。全部收在这里之后，页面拿到的形状是稳定的，
 *   模板里也就不需要写 `stats.viewCount || 0` 这种到处补的兜底。
 */
export const normalizeSiteStats = (data) => ({
  articleCount: toCount(data?.articleCount),
  viewCount: toCount(data?.viewCount),
  categoryCount: toCount(data?.categoryCount),
})

export const useSiteStats = () => {
  const { request } = useApi()

  // 初始就是 0：首屏渲染只依赖这个对象，所以"还没加载完"和"加载失败"
  // 都不会让模板拿到 undefined
  const stats = ref({ ...EMPTY_SITE_STATS })
  const loading = ref(false)
  // 失败标记：页面用它决定显示 0 还是「—」。
  // 【为什么要单独一个标记，而不是靠"三个数字都是 0"判断】
  //   站点真的只有 0 篇文章时那三个数也全是 0，但那是真实数据，不该显示成「—」。
  const failed = ref(false)

  /**
   * 拉一次统计。
   * 【为什么这里还要 try/catch 兜一层】useApi 的 request() 自己会把网络异常
   * 与 401/403 都收成 { ok:false }，正常情况下不会抛。但"页面渲染不能挂在
   * 下游永远不抛异常"这种假设上 —— 以后有人改了 request 的返回契约，
   * 这里最多是显示 0，而不是首页白屏。
   */
  const load = async () => {
    loading.value = true

    let res
    try {
      res = await request(SITE_STATS_PATH)
    } catch {
      // 抛异常也走"失败降级"这一条路，下面的 !res 判断会接住
      res = null
    }

    loading.value = false

    // 失败：保持已有的数字（可能是 0，也可能是上一回成功拿到的），
    // 只把 failed 立起来让页面显示占位。不把数字清成 0 ——
    // 有旧数据的时候，"上次的真实值 + 占位提示"比"假装是 0"更有用。
    if (!res || !res.ok) {
      failed.value = true
      return { ok: false }
    }

    stats.value = normalizeSiteStats(res.data)
    failed.value = false
    return { ok: true, data: stats.value }
  }

  return { stats, loading, failed, load }
}
