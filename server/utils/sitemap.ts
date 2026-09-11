// ============================================================
// server/utils/sitemap.ts
//
// 作用：把 sitemap.xml 与 robots.txt 的**内容生成**做成纯函数（可单测），
//       路由处理器（server/routes/*.get.ts）只负责取数、拼装与响应头。
//
// 【为什么必须做成运行时路由，而不是构建时生成一个静态 sitemap.xml】
//   两条理由，都是硬约束：
//    ① 前端镜像的 docker build 里**连不上后端**（构建阶段后端容器可能还没起，
//       甚至根本不在同一个网络里）。构建时去取文章列表，结果只会是"构建失败"
//       或者"生成一份空的 sitemap" —— 后者更糟：看起来构建成功了，
//       而线上那份 sitemap 永远只有首页
//    ② 新文章发布之后 sitemap 应当**很快**跟上。构建时生成的话，
//       站长发一篇文章还得重新构建、重新部署镜像，sitemap 才更新 ——
//       而这件事和"发文章"在时间上毫无关系
//   运行时生成 + 短缓存（见路由里的 Cache-Control）就没有这两个问题。
//
// 【服务端请求必须走内网地址】用 runtimeConfig.apiBaseServer（NUXT_API_BASE_SERVER），
//   不是浏览器那一个：容器里去访问自己的公网域名，等于绕一圈 DNS + Nginx
//   再回到同一台机器，而且域名没配好时直接失败 —— 那时 sitemap 会变成
//   "只有首页"的降级版本，表面上还看不出问题。
//
// 【技术栈与关键字】
//   · sitemap 协议（sitemaps.org）：<urlset> 里每个 <url> 一条，
//     <loc> 必须是【绝对地址】且 [必须转义] XML 特殊字符，否则整份文件非法、
//     爬虫直接丢弃（而不是"少收录一条"）
//   · W3C datetime：<lastmod> 支持 YYYY-MM-DD 这种日期形态，
//     比带时区的完整时间戳更不容易出错（后端给的是 LocalDateTime，没有时区）
//   · Nitro / h3：server/routes 下按文件名定路由
// ============================================================

// 站点地址的归一化与"拼绝对地址"只有一套实现（app/utils/seo.ts）：
// 线上 canonical 里写的域名和 sitemap 里写的域名必须**字字一致** ——
// 各写一份迟早会出现"canonical 指向 A 域名、sitemap 指向 B 域名"，
// 而搜索引擎对这种情况的处理是"两个都不太信"，很难排查。
// 那两份 util 都是纯函数、不依赖任何 Nuxt 上下文，所以服务端可以直接复用。
import { absoluteUrl, normalizeSiteUrl } from '~~/app/utils/seo'

/** sitemap 的 Content-Type（爬虫对 XML 的 MIME 比较挑，写错会当成普通文本） */
export const SITEMAP_CONTENT_TYPE = 'application/xml; charset=utf-8'

/** 站点里**不由后端数据决定**的固定页面 */
export const STATIC_PAGES = Object.freeze([
  { path: '/', changefreq: 'daily', priority: '1.0' },
  // 归档页：它的内容同样是"全部文章"，但它是一个**独立入口**（导航里点得到），
  // 不写进 sitemap 的话，爬虫只能靠导航里的那个链接发现它 ——
  // 而归档页正是"一次拿到全部内链"的地方，把它自己排除在外没有道理
  { path: '/archive', changefreq: 'daily', priority: '0.9' },
  // 这四个内容页（2026-09-11 新增）的内容**同样来自后端**，但它们的地址不由
  // "文章 id" 决定，所以只能走这份固定清单。写在这里的理由与归档页完全一样：
  // 导航里点得到 ≠ 爬虫一定能早点发现 —— sitemap 的意义正是"不用等链接被发现"。
  // 收藏 / 项目 更新得比较勤（加一条新收藏就该被重新抓一次），所以 changefreq 给 weekly；
  // 友链与关于变动很少，给 monthly。
  { path: '/favorites', changefreq: 'weekly', priority: '0.7' },
  { path: '/projects', changefreq: 'weekly', priority: '0.7' },
  { path: '/links', changefreq: 'monthly', priority: '0.6' },
  { path: '/about', changefreq: 'monthly', priority: '0.6' },
])
// 【为什么没有 /admin】它带 noindex（见 app/pages/admin.vue），
// 写进 sitemap 等于一边说"别收录"、一边主动把地址递给爬虫，自相矛盾。

/**
 * 后端分页接口单页的上限（`ArticleQuery.MAX_PAGE_SIZE = 50`）。
 * 传更大的 size 也没用：后端会夹到 50，于是"以为一页取完了"其实只取了一半，
 * 后面那些文章永远不会出现在 sitemap 里。
 */
export const ARTICLE_PAGE_SIZE = 50

/**
 * 最多翻多少页 —— 【防死循环的上限，不是在"优化"】
 * 取数循环的终止条件依赖后端返回的 total 与每页条数；
 * 万一后端返回的 total 是错的（比真实条数大很多）或者某页永远是满的，
 * 循环就不会停 —— sitemap 请求会一直挂着，直到把后端打满。
 * 50 × 2000 = 100000 篇是个远超过本站规模的数字，正常永远走不到这里。
 */
export const MAX_ARTICLE_PAGES = 40

/**
 * XML 转义。
 *
 * 【为什么必须做，而且必须先把 & 换掉】
 *   <loc> 里的地址含 & 时（比如站点地址后面带了查询串），
 *   不转义会让整份 sitemap **非法**，爬虫是整份丢弃 ——
 *   不是"少一条"，而是"一条都读不到"，而浏览器打开这个地址看起来很正常。
 *   & 必须第一个替换：反过来的话，`<` 转成 `&lt;` 之后那个 `&` 又会
 *   被下一轮替换成 `&amp;lt;`，成了双重转义。
 *
 * 【单引号也要转】属性值可能用单引号包着，只转 & < > " 的话还有漏网之鱼。
 */
export const escapeXml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

/**
 * 纯函数：把后端的 LocalDateTime（形如 `2026-09-10T05:03:26`）收成 `2026-09-10`。
 * 【为什么只要日期】<lastmod> 允许日期形态；带上没有时区的时间戳反而更容易出错
 * （后端给的是 LocalDateTime，没有时区信息，写成 Z 结尾是错的，不写又语义含糊）。
 * 拿不到合法日期时返回空串 —— 调用方会整条 <lastmod> 都不写，
 * 而不是写出 `<lastmod></lastmod>` 这种空元素。
 */
export const toLastmod = (value) => {
  const text = typeof value === 'string' ? value.trim() : ''
  const matched = /^(\d{4}-\d{2}-\d{2})/.exec(text)
  return matched ? matched[1] : ''
}

/**
 * 纯函数：一条 <url> 记录。
 * 所有文本都过 escapeXml（loc 由配置 + 数据库 id 拼成，不该假设它们永远干净）。
 */
export const buildUrlEntry = ({ loc, lastmod, changefreq, priority } = {}) => {
  const parts = [`    <loc>${escapeXml(loc)}</loc>`]
  // 空值整条不写：`<lastmod></lastmod>` 是非法值，爬虫可能把整条 url 当成脏数据
  if (lastmod) parts.push(`    <lastmod>${escapeXml(lastmod)}</lastmod>`)
  if (changefreq) parts.push(`    <changefreq>${escapeXml(changefreq)}</changefreq>`)
  if (priority) parts.push(`    <priority>${escapeXml(priority)}</priority>`)
  return `  <url>\n${parts.join('\n')}\n  </url>`
}

/**
 * 纯函数：一批记录 → 完整的 sitemap.xml 文本。
 * 传空数组也是**合法**的（至少含静态页面）—— 降级时依赖这一点。
 */
export const buildUrlset = (entries = []) => [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...entries.map(buildUrlEntry),
  '</urlset>',
  '',
].join('\n')

/**
 * 纯函数：静态页面 → sitemap 记录。
 * 静态页总是要有的（哪怕后端挂了），所以它被单独抽出来，
 * 降级路径与正常路径共用同一份定义 —— 否则"降级版本"很容易和正常版本长得不一样。
 */
export const buildStaticEntries = (siteUrl) =>
  STATIC_PAGES.map(page => ({
    loc: absoluteUrl(page.path, siteUrl),
    changefreq: page.changefreq,
    priority: page.priority,
  }))

/**
 * 纯函数：文章列表 → sitemap 记录。
 *
 * 【为什么按 id 去重】取数是"翻页循环"，翻页期间又有新文章发布时，
 * 相邻两页可能出现同一条（offset 分页的经典问题）——
 * sitemap 里出现两个相同的 <loc> 属于不合规，爬虫会抱怨。
 * 【为什么过滤掉没有 id 的记录】id 是地址的一部分，缺了它只能拼出
 * `/article/undefined` —— 那是把爬虫引到一个 404 上，比不收录更差。
 */
export const buildArticleEntries = (articles, siteUrl) => {
  const seen = new Set()
  const entries = []
  for (const article of Array.isArray(articles) ? articles : []) {
    const id = article?.id
    if (id === undefined || id === null || id === '') continue
    const key = String(id)
    if (seen.has(key)) continue
    seen.add(key)
    entries.push({
      loc: absoluteUrl(`/article/${key}`, siteUrl),
      // 改过的文章用 updateTime，从没改过的就是 createTime
      lastmod: toLastmod(article.updateTime) || toLastmod(article.createTime),
      changefreq: 'weekly',
      priority: '0.8',
    })
  }
  return entries
}

/**
 * 纯函数：入口。静态页 + 文章页 → 完整的 sitemap.xml。
 * 【静态页排在前面】不是规范要求，只是"人工打开 sitemap 时先看到首页"更直观。
 */
export const buildSitemapXml = ({ siteUrl, articles } = {}) =>
  buildUrlset([...buildStaticEntries(siteUrl), ...buildArticleEntries(articles, siteUrl)])

/**
 * 纯函数：把"文章翻页取数"这件事跑完 —— 这是本文件里唯一有点绕的逻辑。
 *
 * 【为什么要循环翻页】后端 `GET /article/page` 单页最多 50 条
 * （`ArticleQuery.MAX_PAGE_SIZE`，传再大也会被夹到 50），
 * 想拿全量就必须一页一页翻。只取第一页的话，第 51 篇之后的文章
 * 永远不会出现在 sitemap 里 —— 而这件事在只有几十篇文章时**完全看不出来**。
 *
 * 【三种终止条件，缺一不可】
 *   ① 后端这一页返回空数组 → 没数据了（也兜住了 total 不准的情况）
 *   ② 已取条数 ≥ total → 取完了（total 为 0 或缺失时不据此判断）
 *   ③ 翻到 MAX_ARTICLE_PAGES 页 → 防死循环的上限
 *
 * 【失败怎么办：降级，绝不抛异常】
 *   任何一页失败（接口挂了、被限流 429、返回的不是预期结构）就停止翻页，
 *   把**已经取到的**文章交给调用方，并标记 degraded ——
 *   调用方据此仍然返回一份含静态页面的合法 sitemap。
 *   为什么不是直接 500：sitemap 挂了没有任何人会发现（只有爬虫在读它），
 *   而"少收录一些文章"比"整份 404/500 导致爬虫把之前收录的也清掉"轻得多。
 *   也不能返回空 body：空 body 同样会被当成非法 sitemap。
 *
 * @param {object}   options
 * @param {Function} options.fetchPage  取第 N 页，返回 useApi 形状的 { ok, data }
 * @param {number}   [options.pageSize] 单页条数（默认后端上限 50）
 * @param {number}   [options.maxPages] 最多翻页数（防死循环）
 */
export const collectAllArticles = async ({
  fetchPage,
  pageSize = ARTICLE_PAGE_SIZE,
  maxPages = MAX_ARTICLE_PAGES,
}) => {
  const articles = []
  const seen = new Set()
  let total = 0
  let degraded = false
  let pages = 0

  for (let page = 1; page <= maxPages; page += 1) {
    let res
    try {
      res = await fetchPage(page, pageSize)
    } catch {
      // 取数函数自己抛异常也走降级（调用方不该因为"下游没按约定返回"而 500）
      res = null
    }
    pages = page

    if (!res || !res.ok) {
      degraded = true
      break
    }

    const records = Array.isArray(res.data?.records) ? res.data.records : []
    if (page === 1) total = Number(res.data?.total) || 0

    for (const article of records) {
      const key = String(article?.id ?? '')
      if (!key || seen.has(key)) continue
      seen.add(key)
      articles.push(article)
    }

    // ① 这一页是空的：没有更多了
    if (records.length === 0) break
    // ② 已经取满 total（total 为 0 / 缺失时不据此判断，交给下一条或下一页）
    if (total > 0 && articles.length >= total) break
  }

  // 因为翻到上限而停下：仍然算"降级"（结果是**不完整**的），
  // 但必须是"能用的不完整"——所以保持 ok，只是标记出来
  const truncated = pages >= maxPages && articles.length > 0

  return { ok: !degraded, articles, total, pages, degraded, truncated }
}

/** robots.txt 里禁止抓取的路径（后台是登录后才看得见的内部工具） */
export const DISALLOWED_PATHS = Object.freeze(['/admin'])

/**
 * 纯函数：robots.txt 内容。
 *
 * 【为什么既要 robots.txt 的 Disallow、又要页面的 noindex】
 *   两者挡的不是一回事：Disallow 只拦住"抓取这个地址"，
 *   但如果别处有链接指向它（比如谁把后台地址贴进了某个页面），
 *   搜索结果里仍然可能出现这个地址（只是没有摘要）；
 *   noindex 才是"别收录"。所以要一起用。
 *
 * 【Sitemap 必须写绝对地址】协议要求如此，写 `/sitemap.xml` 会被忽略，
 *   而 robots.txt 里一行被忽略是没有任何提示的。
 */
export const buildRobotsTxt = (siteUrl) => {
  const base = normalizeSiteUrl(siteUrl)
  return [
    '# 全部爬虫允许抓取',
    'User-Agent: *',
    'Allow: /',
    '',
    '# 后台是登录后才看得见的内部工具，不该被搜到',
    ...DISALLOWED_PATHS.map(path => `Disallow: ${path}`),
    '',
    '# sitemap 是 Nitro 的运行时路由（不是静态文件），地址必须是绝对的',
    `Sitemap: ${base}/sitemap.xml`,
    '',
  ].join('\n')
}
