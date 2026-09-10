import { describe, it, expect } from 'vitest'

// =====================================================================
// sitemap.xml 与 robots.txt 的纯函数
//
// 【为什么这一组必须是单测，而且要覆盖边界】
//   这两份文件有一个共同点：**没有任何人会在浏览器里"看见"它们**。
//   sitemap 里少了一批文章、robots.txt 里 Sitemap 那一行写成了相对地址，
//   站长打开首页一切正常；出问题的信号只有"搜不到"，
//   而那是几周之后、还很难归因的事。所以规则只能靠断言钉住：
//     · XML 转义：写错的话整份 sitemap **非法**，爬虫是整份丢弃 ——
//       不是"少一条"，是一条都读不到，而用浏览器打开那个地址看起来完全正常
//     · 翻页循环：后端单页上限 50，不循环的话第 51 篇之后的文章永远不会出现，
//       这在只有几十篇文章时完全看不出来
//     · 降级：接口挂了必须仍然返回合法 XML（含首页），不能 500 或空 body
//
// 【为什么直接 import server/utils 而不是走 HTTP】
//   与 test/media.nuxt.spec.ts 同一个做法（那里测的是 server/utils/mediaFile.ts）：
//   纯函数不需要 Nitro 上下文，直接断言最快也最准；
//   "路由真的挂在 /sitemap.xml 上"由构建后的 curl 实测覆盖（见 README）。
//
// 【为什么这些纯函数里有 async】
//   collectAllArticles() 的输入是一个 fetchPage 函数，测试里传一个
//   "按页返回固定数据"的假实现即可 —— 不需要真网络，也不需要 Nitro。
// =====================================================================

import {
  ARTICLE_PAGE_SIZE,
  MAX_ARTICLE_PAGES,
  buildArticleEntries,
  buildRobotsTxt,
  buildSitemapXml,
  buildStaticEntries,
  buildUrlEntry,
  buildUrlset,
  collectAllArticles,
  escapeXml,
  toLastmod,
} from '../server/utils/sitemap'

const SITE = 'https://www.yigalaxy.xin'

/** 造一篇后端形状的文章（ArticleVO：id / title / summary / updateTime / createTime） */
const article = (id, extra = {}) => ({
  id,
  title: `第 ${id} 篇`,
  createTime: '2026-09-01T10:00:00',
  updateTime: '2026-09-02T10:00:00',
  ...extra,
})

/** 造一批文章（1..count） */
const articles = (count) => Array.from({ length: count }, (_, i) => article(i + 1))

/**
 * 假的"后端分页接口"：把一整个数组按 pageSize 切开，
 * 按后端真实形状返回 { ok, data: { records, total } }。
 */
const fakePagedFetch = (all, { failOn = 0 } = {}) => {
  const calls = []
  const fetchPage = async (page, size) => {
    calls.push({ page, size })
    if (failOn && page === failOn) return { ok: false }
    const from = (page - 1) * size
    return {
      ok: true,
      data: { records: all.slice(from, from + size), total: all.length },
    }
  }
  return { fetchPage, calls }
}

describe('sitemap · XML 转义', () => {
  it('五个特殊字符都要转义（否则整份 sitemap 非法、爬虫整份丢弃）', () => {
    expect(escapeXml('A & B <C> "D" \'E\'')).toBe('A &amp; B &lt;C&gt; &quot;D&quot; &apos;E&apos;')
  })

  it('& 必须最先替换（否则会双重转义）', () => {
    // 反过来的话 `<` 先变成 `&lt;`，那个 & 又会被下一轮换成 `&amp;lt;`
    expect(escapeXml('<')).toBe('&lt;')
    expect(escapeXml('&lt;')).toBe('&amp;lt;')
  })

  it('标题里的 & 与 < 会被转义（以后谁往 sitemap 里加元素可以直接用这个函数）', () => {
    expect(escapeXml('文章标题里有 & 和 <script>')).toBe('文章标题里有 &amp; 和 &lt;script&gt;')
  })

  it('null / undefined / 数字都能安全处理（不抛异常，也不出现 "undefined" 字样）', () => {
    expect(escapeXml(null)).toBe('')
    expect(escapeXml(undefined)).toBe('')
    expect(escapeXml(42)).toBe('42')
  })
})

describe('sitemap · lastmod 归一化', () => {
  it('后端的 LocalDateTime_should只取日期部分', () => {
    expect(toLastmod('2026-09-10T05:03:26')).toBe('2026-09-10')
    expect(toLastmod('2026-09-10')).toBe('2026-09-10')
  })

  it('拿不到合法日期时_should返回空串（整条 lastmod 不写，而不是写空元素）', () => {
    for (const bad of ['', '   ', '昨天', undefined, null, '2026/09/10']) {
      expect(toLastmod(bad), `「${String(bad)}」应当返回空串`).toBe('')
    }
  })
})

describe('sitemap · 单条与整份 XML', () => {
  it('一条记录_should包含 loc / changefreq / priority', () => {
    const entry = buildUrlEntry({ loc: `${SITE}/`, changefreq: 'daily', priority: '1.0' })

    expect(entry).toContain(`<loc>${SITE}/</loc>`)
    expect(entry).toContain('<changefreq>daily</changefreq>')
    expect(entry).toContain('<priority>1.0</priority>')
  })

  it('lastmod 为空时_should整条不写（空元素是非法值）', () => {
    expect(buildUrlEntry({ loc: `${SITE}/`, lastmod: '' })).not.toContain('lastmod')
    expect(buildUrlEntry({ loc: `${SITE}/`, lastmod: '2026-09-02' })).toContain('<lastmod>2026-09-02</lastmod>')
  })

  it('整份文件_should有 XML 声明与 urlset 命名空间', () => {
    const xml = buildUrlset(buildStaticEntries(SITE))

    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
    expect(xml.trimEnd().endsWith('</urlset>')).toBe(true)
    expect(xml).toContain(`<loc>${SITE}/</loc>`)
  })

  it('空记录也是合法 XML（降级路径依赖这一点）', () => {
    const xml = buildUrlset([])

    expect(xml).toContain('<urlset')
    expect(xml).toContain('</urlset>')
    // 不能是空 body：空 body 同样会被爬虫当成非法 sitemap
    expect(xml.length).toBeGreaterThan(50)
  })

  it('loc 里有 & 与单引号时_should被转义（否则整份文件非法）', () => {
    const xml = buildUrlset([{ loc: `${SITE}/article/1?a=1&b='2'` }])

    expect(xml).toContain('&amp;')
    expect(xml).toContain('&apos;')
    expect(xml).not.toContain('a=1&b=')
  })
})

describe('sitemap · 文章记录', () => {
  it('文章_should拼成绝对地址、优先用 updateTime 当 lastmod', () => {
    const entries = buildArticleEntries([article(12)], SITE)

    expect(entries[0].loc).toBe(`${SITE}/article/12`)
    expect(entries[0].lastmod).toBe('2026-09-02')
    expect(entries[0].priority).toBe('0.8')
  })

  it('没有 updateTime 时_should回落到 createTime', () => {
    const entries = buildArticleEntries([article(12, { updateTime: null })], SITE)

    expect(entries[0].lastmod).toBe('2026-09-01')
  })

  it('两个时间都拿不到时_should不写 lastmod（而不是写空元素）', () => {
    const xml = buildSitemapXml({ siteUrl: SITE, articles: [article(12, { updateTime: null, createTime: null })] })

    expect(xml).toContain(`${SITE}/article/12`)
    expect(xml).not.toContain('lastmod')
  })

  it('按 id 去重（翻页期间有新文章发布时，相邻两页会出现同一条）', () => {
    const entries = buildArticleEntries([article(7), article(7), article(8)], SITE)

    expect(entries.map(e => e.loc)).toEqual([`${SITE}/article/7`, `${SITE}/article/8`])
  })

  it('没有 id 的记录_should被丢掉（否则会拼出 /article/undefined 把爬虫引到 404）', () => {
    const entries = buildArticleEntries([article(1), { title: '没有 id' }, null, undefined], SITE)

    expect(entries).toHaveLength(1)
    expect(buildSitemapXml({ siteUrl: SITE, articles: [null, { title: 'x' }] })).not.toContain('undefined')
  })

  it('文章标题里的 & 与 < 不会让 sitemap 变成非法 XML', () => {
    // 【为什么断言"不出现"而不是"被转义"】sitemap 协议里没有放标题的元素
    // （只有 loc / lastmod / changefreq / priority），所以标题根本不会进 XML。
    // 这条守的是"以后有人往 sitemap 里加 title 元素"时必须走 escapeXml，
    // 以及"绝不能把标题直接拼进去"。
    const xml = buildSitemapXml({
      siteUrl: SITE,
      articles: [article(3, { title: 'A & B <script>alert(1)</script>' })],
    })

    expect(xml).not.toContain('<script>')
    expect(xml).not.toContain('A & B')
    expect(xml).toContain(`${SITE}/article/3`)
  })

  it('静态页_should永远包含首页，且没有 /admin（它带 noindex）', () => {
    const xml = buildSitemapXml({ siteUrl: SITE, articles: [] })

    expect(xml).toContain(`<loc>${SITE}/</loc>`)
    expect(xml).not.toContain('/admin')
  })

  it('站点地址带结尾斜杠时_should不会拼出双斜杠', () => {
    const xml = buildSitemapXml({ siteUrl: `${SITE}/`, articles: [article(5)] })

    expect(xml).toContain(`<loc>${SITE}/article/5</loc>`)
    expect(xml).not.toContain(`${SITE}//`)
  })
})

describe('sitemap · 分页取全部文章', () => {
  it('total 为 0（一篇文章都没有）_should只请求一次就结束', async () => {
    const { fetchPage, calls } = fakePagedFetch([])
    const result = await collectAllArticles({ fetchPage })

    expect(calls).toHaveLength(1)
    expect(result).toEqual({ ok: true, articles: [], total: 0, pages: 1, degraded: false, truncated: false })
  })

  it('恰好 50 条_should只请求一次（不能多翻一页空页）', async () => {
    const { fetchPage, calls } = fakePagedFetch(articles(50))
    const result = await collectAllArticles({ fetchPage })

    // 50 条正好是后端单页上限：取完就该停
    expect(calls).toHaveLength(1)
    expect(result.articles).toHaveLength(50)
    expect(result.degraded).toBe(false)
  })

  it('51 条_should翻两页，第二页只取到 1 条（最后一页不满）', async () => {
    const { fetchPage, calls } = fakePagedFetch(articles(51))
    const result = await collectAllArticles({ fetchPage })

    expect(calls.map(c => c.page)).toEqual([1, 2])
    expect(result.articles).toHaveLength(51)
    expect(result.articles[50].id).toBe(51)
    expect(result.degraded).toBe(false)
  })

  it('120 条_should翻三页（50 + 50 + 20）', async () => {
    const { fetchPage, calls } = fakePagedFetch(articles(120))
    const result = await collectAllArticles({ fetchPage })

    expect(calls.map(c => c.page)).toEqual([1, 2, 3])
    expect(result.articles).toHaveLength(120)
  })

  it('每页都带上单页上限 50（传更大的值后端也会夹到 50）', async () => {
    const { fetchPage, calls } = fakePagedFetch(articles(60))
    await collectAllArticles({ fetchPage })

    expect(calls.every(c => c.size === ARTICLE_PAGE_SIZE)).toBe(true)
    expect(ARTICLE_PAGE_SIZE).toBe(50)
  })

  it('后端给的 total 明显不对（比真实条数大很多）_should靠"空页"停下来，不无限翻', async () => {
    // 这是真实的坑：终止条件只看 total 的话，一个错误的 total 会让循环一直翻下去
    // （这里的 id 每页往后错开，避免被"按 id 去重"掩盖掉实际取到的条数）
    const fetchPage = async (page) => ({
      ok: true,
      data: {
        records: page <= 2 ? articles(50).map((a, i) => ({ ...a, id: (page - 1) * 50 + i + 1 })) : [],
        total: 999999,
      },
    })
    const result = await collectAllArticles({ fetchPage })

    expect(result.articles).toHaveLength(100)
    expect(result.pages).toBe(3)
  })

  it('后端永远返回满页（total 也永远不对）时_should在页数上限停下', async () => {
    // 没有上限的话这条用例会一直跑到超时 —— 而线上表现是"sitemap 请求挂着把后端打满"
    let served = 0
    const fetchPage = async () => {
      served += 50
      return { ok: true, data: { records: articles(50).map((a, i) => ({ ...a, id: served + i })), total: 999999 } }
    }
    const result = await collectAllArticles({ fetchPage, maxPages: 3 })

    expect(result.pages).toBe(3)
    expect(result.articles).toHaveLength(150)
    // 结果不完整时必须标记出来（truncated），而不是当成"取全了"
    expect(result.truncated).toBe(true)
  })

  it('接口失败_should停止翻页并保留已取到的部分（degraded）', async () => {
    const { fetchPage } = fakePagedFetch(articles(120), { failOn: 2 })
    const result = await collectAllArticles({ fetchPage })

    expect(result.ok).toBe(false)
    expect(result.degraded).toBe(true)
    // 第一页拿到的 50 条还在：能收录一部分也好过整份丢掉
    expect(result.articles).toHaveLength(50)
  })

  it('一上来就失败_should返回空列表但仍然 ok=false（由调用方降级成"只有首页"）', async () => {
    const { fetchPage } = fakePagedFetch(articles(10), { failOn: 1 })
    const result = await collectAllArticles({ fetchPage })

    expect(result.ok).toBe(false)
    expect(result.articles).toEqual([])

    // 降级之后仍然是一份【合法】的 sitemap，而且含首页
    const xml = buildSitemapXml({ siteUrl: SITE, articles: result.articles })
    expect(xml).toContain('<urlset')
    expect(xml).toContain(`<loc>${SITE}/</loc>`)
  })

  it('取数函数直接抛异常_should同样降级，而不是把异常抛给路由（否则就是 500）', async () => {
    const fetchPage = async () => { throw new Error('boom') }
    const result = await collectAllArticles({ fetchPage })

    expect(result.degraded).toBe(true)
    expect(result.articles).toEqual([])
  })

  it('后端返回的不是预期结构_should当成"没有数据"而不是崩', async () => {
    const fetchPage = async () => ({ ok: true, data: null })
    const result = await collectAllArticles({ fetchPage })

    expect(result.ok).toBe(true)
    expect(result.articles).toEqual([])
    expect(result.pages).toBe(1)
  })

  it('翻页期间重复返回同一条_should去重（offset 分页的经典问题）', async () => {
    const fetchPage = async (page) => ({
      ok: true,
      data: { records: page === 1 ? articles(50) : [article(50), article(51)], total: 51 },
    })
    const result = await collectAllArticles({ fetchPage })

    expect(result.articles).toHaveLength(51)
    expect(result.articles.filter(a => a.id === 50)).toHaveLength(1)
  })

  it('页数上限是个正数（防止以后有人"顺手"把它改成 0 或负数）', () => {
    expect(MAX_ARTICLE_PAGES).toBeGreaterThan(0)
    expect(Number.isInteger(MAX_ARTICLE_PAGES)).toBe(true)
  })
})

describe('robots.txt', () => {
  it('应该允许抓取、挡掉后台、并指向绝对的 sitemap 地址', () => {
    const txt = buildRobotsTxt(SITE)

    expect(txt).toContain('User-Agent: *')
    expect(txt).toContain('Allow: /')
    expect(txt).toContain('Disallow: /admin')
    // Sitemap 按协议必须是绝对地址：写成 /sitemap.xml 会被直接忽略，而且没有任何提示
    expect(txt).toContain(`Sitemap: ${SITE}/sitemap.xml`)
  })

  it('站点地址带结尾斜杠时_should不会拼出双斜杠', () => {
    expect(buildRobotsTxt(`${SITE}/`)).toContain(`Sitemap: ${SITE}/sitemap.xml`)
  })

  it('站点地址为空或非法时_should回落到默认域名（与 canonical 用的是同一套归一化）', () => {
    // 「robots 里指的域名」和「canonical 里写的域名」必须一致：
    // 不一致的话爬虫会被引到一个不是正式地址的地方
    expect(buildRobotsTxt('')).toContain(`Sitemap: ${DEFAULT_SITE_URL}/sitemap.xml`)
    expect(buildRobotsTxt('www.yigalaxy.xin')).toContain(`Sitemap: ${DEFAULT_SITE_URL}/sitemap.xml`)
  })

  it('以换行结尾（有些爬虫按行解析，最后一行没有换行符会被吃掉）', () => {
    expect(buildRobotsTxt(SITE).endsWith('\n')).toBe(true)
  })
})

// =====================================================================
// 约定核对：sitemap 与页面里的 canonical 必须用同一个站点地址
//
// 【为什么单独一条】两个地方各自拼域名，一旦不一致（比如 sitemap 用默认域名、
// canonical 用了环境变量覆盖后的域名），结果就是"搜索引擎被告知两个正式地址"，
// 而两份文件单独看都没问题 —— 属于只有对比才能发现的一类问题。
// =====================================================================
describe('sitemap 与 canonical 的站点地址约定', () => {
  it('两边都应该用同一份归一化规则（同源：app/utils/seo.ts）', () => {
    // buildSitemapXml 里的绝对地址、页面 canonical、robots 里的 Sitemap
    // 都由 absoluteUrl / normalizeSiteUrl 拼出来，所以传同样的 siteUrl 必然一致
    const normalized = 'https://blog.example.com'
    expect(buildSitemapXml({ siteUrl: normalized, articles: [] })).toContain(`<loc>${normalized}/</loc>`)
    expect(buildRobotsTxt(normalized)).toContain(`Sitemap: ${normalized}/sitemap.xml`)
    expect(absoluteUrl('/', normalized)).toBe(`${normalized}/`)
    expect(absoluteUrl('/article/9', normalized)).toBe(`${normalized}/article/9`)
  })
})
