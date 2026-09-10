import { describe, it, expect } from 'vitest'

// =====================================================================
// feed.xml（RSS 2.0）的纯函数
//
// 【为什么这一组必须是单测，而且要覆盖边界】
//   /feed.xml 和 sitemap.xml 有一个共同点：**没有任何人会在浏览器里"看见"它**。
//   浏览器对 XML 的容错比订阅器宽得多 —— 站长打开 /feed.xml 看到一屏正常的 XML，
//   而订阅器那边可能因为一个未转义的 `&` 把**整份 feed 丢弃**，
//   症状是"订阅了但永远收不到新文章"。所以规则只能靠断言钉住：
//     · XML 转义：写错整份 feed 非法（不是"少一条"，是一条都读不到）
//     · RFC 822 的 pubDate：格式错了订阅器会当成"没有时间"，
//       于是所有文章的顺序变成"抓到的顺序"，而 feed 本身看起来完全正常
//     · 降级：接口挂了必须仍然返回**合法**的 feed（含站点信息），不能 500 或空 body ——
//       订阅器把 500 / 空 body 当成"这个源坏了"，恢复后也不会自动回来
//     · description 放的是**摘要**而不是 Markdown 源码（否则订阅器里会显示
//       `# 标题`、`**加粗**` 这种原文标记）
//
// 【怎么断言"XML 合法"—— 为什么不用 DOMParser】
//   本仓库的测试环境是 happy-dom，它的 XML 解析是**容错的**：实测喂一个未转义的
//   `&`（`<title>A & B</title>`）进去，它照样返回 rss 根节点、不报 parsererror。
//   用它断言"能被解析"等于没断言。node_modules 里唯一严格一点的是 sax，
//   但它只是构建工具链的**传递依赖**（nuxt → @nuxt/vite-builder → cssnano →
//   postcss-svgo → svgo → sax），直接 import 属于"依赖别人的依赖"，
//   哪天链子断了这条测试会以"模块找不到"的方式挂掉。
//   所以下面自带一个极简的良构扫描器（只认我们自己生成的构造：
//   元素、属性、文本、5 个预定义实体），并**配一组对照组**证明它真的会报错 ——
//   否则一个永远返回 null 的检查器会让"XML 合法"永远为真（假绿）。
//   DOMParser 仍然用来**取值**（数 item、读 title 文本），因为取值不需要严格性。
// =====================================================================

import { buildFeedXml, buildFeedItem, normalizeFeedArticles, toPubDate } from '../server/utils/feed'
import { buildSitemapXml } from '../server/utils/sitemap'
import { buildSeoHead, FEED_PATH } from '~~/app/utils/seo'

const SITE = 'https://www.yigalaxy.xin'

/** 造一篇后端 RSS 形状的文章（id / title / summary / content / createTime） */
const article = (id, extra = {}) => ({
  id,
  title: `第 ${id} 篇`,
  summary: `第 ${id} 篇的摘要`,
  content: `# 第 ${id} 篇\n\n**正文**`,
  createTime: '2026-09-10T05:03:19',
  ...extra,
})

/** 造一批文章（1..count，时间依次往前推） */
const articles = (count) => Array.from({ length: count }, (_, i) => article(count - i, {
  createTime: `2026-09-${String(20 - i).padStart(2, '0')}T10:00:00`,
}))

// ---------------------------------------------------------------
// 极简 XML 良构检查：通过返回 null，否则返回一句"哪里不对"
// ---------------------------------------------------------------

/** `&` 必须是合法实体引用之一；文本里出现裸 `<` 同样算错 */
const entityError = (text) => {
  const bad = /&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.exec(text)
  if (bad) return `有未转义的 &（位置 ${bad.index}）`
  if (text.includes('<')) return '文本里有未转义的 <'
  return null
}

const xmlFormError = (xml) => {
  const text = String(xml)
  if (!text.startsWith('<?xml ')) return '缺少 XML 声明'
  const declEnd = text.indexOf('?>')
  if (declEnd === -1) return 'XML 声明没有结束'

  const stack = []
  // 只接受我们生成的那几种标签：名字 + 若干 双引号包起来的属性 + 可选自闭合
  const tagRe = /^<(\/?)([A-Za-z][\w:.-]*)((?:\s+[A-Za-z][\w:.-]*="[^"]*")*)\s*(\/?)>/
  let i = declEnd + 2

  while (i < text.length) {
    const lt = text.indexOf('<', i)
    const chunk = lt === -1 ? text.slice(i) : text.slice(i, lt)
    const textError = entityError(chunk)
    if (textError) return textError
    if (lt === -1) break

    const matched = tagRe.exec(text.slice(lt))
    if (!matched) return `位置 ${lt} 处的 "<" 没有构成合法标签`
    const attributeError = entityError(matched[3])
    if (attributeError) return `标签属性里 ${attributeError}`

    if (matched[1] === '/') {
      const opened = stack.pop()
      if (opened !== matched[2]) return `标签不配对：</${matched[2]}> 对不上 <${opened}>`
    } else if (!matched[4]) {
      stack.push(matched[2])
    }
    i = lt + matched[0].length
  }

  if (stack.length) return `这些标签没有闭合：${stack.join(', ')}`
  return null
}

/** 取值用（不是校验用）：把 XML 解析成文档，方便数 item、读文本 */
const parse = (xml) => new DOMParser().parseFromString(xml, 'application/xml')

const itemsOf = (xml) => [...parse(xml).querySelectorAll('item')]
const textOf = (node, tag) => node.querySelector(tag)?.textContent ?? null

/** 从一条 item 里抠出文章 id（link 的最后一段） */
const idOf = (node) => String(textOf(node, 'link') ?? '').split('/').pop()

/** RFC 822 里的英文月份缩写 */
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

describe('feed · XML 转义', () => {
  it('标题与摘要里的 & < > 都要转义（否则整份 feed 非法、订阅器整份丢弃）', () => {
    const xml = buildFeedXml({
      siteUrl: SITE,
      articles: [article(1, {
        title: '备忘 & 待办',
        summary: 'A & B <C> "D" \'E\'',
      })],
    })

    expect(xml).toContain('备忘 &amp; 待办')
    expect(xml).toContain('A &amp; B &lt;C&gt; &quot;D&quot; &apos;E&apos;')
    // 绝不能出现裸的 `&`（后接空格那种）或者原样的标签
    expect(xml).not.toContain('& ')
    expect(xml).not.toContain('<C>')
  })

  it('`&` 必须最先替换（否则会双重转义成 &amp;lt;）', () => {
    const xml = buildFeedXml({ siteUrl: SITE, articles: [article(1, { title: '<script>' })] })

    expect(xml).toContain('&lt;script&gt;')
    expect(xml).not.toContain('&amp;lt;')
  })

  it('标题里带 & 与尖括号时_整份 feed 仍然是良构的', () => {
    const xml = buildFeedXml({
      siteUrl: SITE,
      articles: [
        article(1, { title: 'A & B <script>alert(1)</script>', summary: 'x & y < z > w' }),
        article(2, { title: '引号"与\'都要转', summary: 'he said "hi"' }),
      ],
    })

    expect(xmlFormError(xml)).toBeNull()
    // 页面上不该出现任何真的可执行标签
    expect(xml).not.toContain('<script>')
  })

  it('站点地址里带 & 时_<link>/<guid> 里的 & 也要转义', () => {
    const xml = buildFeedXml({ siteUrl: 'https://example.com', articles: [], title: 'A & B' })

    expect(xmlFormError(xml)).toBeNull()
    expect(xml).toContain('A &amp; B')
  })
})

describe('feed · 整体结构', () => {
  it('应该是一份合法的 RSS 2.0：声明 + rss 2.0 + channel 的站点信息', () => {
    const xml = buildFeedXml({ siteUrl: SITE, articles: [article(1)] })

    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
    expect(xml).toContain('<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">')
    expect(xml.trimEnd().endsWith('</rss>')).toBe(true)
    expect(xmlFormError(xml)).toBeNull()

    expect(xml).toContain('<title>亿轨星途</title>')
    expect(xml).toContain(`<link>${SITE}/</link>`)
    expect(xml).toContain('<language>zh-CN</language>')
    // 站点描述沿用 SEO 那一份（两处文案不一致的话，分享卡片与订阅源会各说各的）
    expect(xml).toContain('<description>亿轨星途是一个个人博客')
    // rel="self"：订阅器据此知道"这个源的正式地址"
    expect(xml).toContain(`<atom:link href="${SITE}${FEED_PATH}" rel="self" type="application/rss+xml"/>`)
  })

  it('lastBuildDate_should取最新那篇的时间（而不是每次请求时的 now）', () => {
    const xml = buildFeedXml({ siteUrl: SITE, articles: [article(1, { createTime: '2026-09-10T05:03:19' })] })

    expect(xml).toContain('<lastBuildDate>Thu, 10 Sep 2026 05:03:19 +0800</lastBuildDate>')
  })

  it('条目数量与顺序_should完全照搬后端给的那一批', () => {
    const list = articles(3)
    const xml = buildFeedXml({ siteUrl: SITE, articles: list })

    expect(itemsOf(xml)).toHaveLength(3)
    // 后端已经按时间倒序，前端不再排也不截断 —— 这里用"顺序与输入逐字一致"钉住它
    expect(itemsOf(xml).map(n => textOf(n, 'title'))).toEqual(list.map(a => a.title))
    expect(itemsOf(xml).map(n => idOf(n))).toEqual(['3', '2', '1'])
  })

  it('每条 item_should有 title / link / guid / pubDate / description', () => {
    const xml = buildFeedXml({ siteUrl: SITE, articles: [article(117)] })
    const node = itemsOf(xml)[0]

    expect(textOf(node, 'title')).toBe('第 117 篇')
    expect(textOf(node, 'link')).toBe(`${SITE}/article/117`)
    // guid 与 link 用同一个值：订阅器靠 guid 判重，让"判重依据"和"点击目标"错位没有好处
    expect(textOf(node, 'guid')).toBe(`${SITE}/article/117`)
    expect(node.querySelector('guid').getAttribute('isPermaLink')).toBe('true')
    expect(textOf(node, 'pubDate')).toBe('Thu, 10 Sep 2026 05:03:19 +0800')
    expect(textOf(node, 'description')).toBe('第 117 篇的摘要')
  })

  it('没有 id 的文章_should被丢掉（否则会拼出 /article/undefined 把用户指向 404）', () => {
    const xml = buildFeedXml({ siteUrl: SITE, articles: [article(1), { title: '没有 id' }, null, undefined] })

    expect(itemsOf(xml)).toHaveLength(1)
    expect(xml).not.toContain('undefined')
    expect(xmlFormError(xml)).toBeNull()
  })

  it('站点地址带结尾斜杠时_should不会拼出双斜杠', () => {
    const xml = buildFeedXml({ siteUrl: `${SITE}/`, articles: [article(5)] })

    expect(xml).toContain(`<link>${SITE}/</link>`)
    expect(xml).toContain(`${SITE}/article/5`)
    expect(xml).not.toContain(`${SITE}//`)
  })
})

// 小工具：从 item 里抠出文章 id（link 的最后一段）

describe('feed · pubDate 的 RFC 822 格式', () => {
  it('后端的 LocalDateTime_should转成 RFC 822（星期 + 英文月份 + 数值时区）', () => {
    // `2026-09-10` 是星期四（用 Date.UTC 独立算过，见下一条）
    expect(toPubDate('2026-09-10T05:03:19')).toBe('Thu, 10 Sep 2026 05:03:19 +0800')
    expect(toPubDate('2026-09-10 05:03:19')).toBe('Thu, 10 Sep 2026 05:03:19 +0800')
  })

  it('星期几要与日期对得上（不能全站都印同一个星期）', () => {
    const cases = [
      ['2026-09-10', 'Thu'],
      ['2025-12-31', 'Wed'],
      ['2026-01-01', 'Thu'],
      ['2024-02-29', 'Thu'],
    ]
    for (const [date, weekday] of cases) {
      expect(toPubDate(`${date}T00:00:00`)).toBe(`${weekday}, ${Number(date.slice(8))} ${MONTH_ABBR[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)} 00:00:00 +0800`)
    }
  })

  it('只有日期时_should补成 00:00:00，而不是拼出一个残缺的时间', () => {
    expect(toPubDate('2026-09-10')).toBe('Thu, 10 Sep 2026 00:00:00 +0800')
  })

  it('拿不到合法时间时_should整条 pubDate 都不写，绝不用"当前时间"兜底', () => {
    // 编一个时间比没有时间更糟：订阅器会把它当成真实发布时间，
    // 文章的顺序与"新文章提醒"就全乱了
    for (const bad of ['', '   ', '昨天', undefined, null, 20260910, '2026/09/10']) {
      expect(toPubDate(bad), `「${String(bad)}」应当返回空串`).toBe('')
    }

    const xml = buildFeedXml({ siteUrl: SITE, articles: [article(1, { createTime: null })] })
    expect(xml).not.toContain('pubDate')
    expect(xml).toContain(`${SITE}/article/1`)
  })

  it('不存在的日期（2 月 30 日 / 13 月 / 25 点）_should当成拿不到，而不是让它滚到下一天', () => {
    // Date 会把这些值静默滚动（2026-02-30 → 3 月 2 日），于是 feed 里出现一个
    // 凭空捏造的时间 —— 而它看起来完全正常
    for (const bad of ['2026-02-30T10:00:00', '2026-13-01T10:00:00', '2026-09-10T25:00:00', '2026-00-10T10:00:00']) {
      expect(toPubDate(bad), `「${bad}」应当返回空串`).toBe('')
    }
  })
})

describe('feed · description 里放什么', () => {
  it('放的是后端给的 summary（纯文本），不是 Markdown 源码', () => {
    const xml = buildFeedXml({ siteUrl: SITE, articles: [article(1)] })
    const node = itemsOf(xml)[0]

    expect(textOf(node, 'description')).toBe('第 1 篇的摘要')
    // 【这条是"就放摘要"这个决定的护栏】契约里 content 是 Markdown 源码，
    // 直接塞进 description 的话订阅器会把 `#`、`**` 原样显示出来 ——
    // 以后有人图省事改成塞 content，这条断言会红
    expect(xml).not.toContain('# 第 1 篇')
    expect(xml).not.toContain('**')
  })

  it('summary 为空时_should整条 description 不写（空元素同样会让订阅器把 item 当脏数据）', () => {
    const xml = buildFeedXml({ siteUrl: SITE, articles: [article(1, { summary: '' })] })
    const node = itemsOf(xml)[0]

    expect(node.querySelector('description')).toBeNull()
    expect(xmlFormError(xml)).toBeNull()
    expect(textOf(node, 'title')).toBe('第 1 篇')
  })

  it('文章没有标题时_should用"文章 {id}"兜底，而不是发出一个没有标题的条目', () => {
    const xml = buildFeedXml({ siteUrl: SITE, articles: [article(9, { title: '   ' })] })

    expect(textOf(itemsOf(xml)[0], 'title')).toBe('文章 9')
  })
})

describe('feed · 降级（后端挂了 / 一篇文章都没有）', () => {
  it('空列表_should仍然是一份合法的 feed：站点信息齐全、只是没有 item', () => {
    const xml = buildFeedXml({ siteUrl: SITE, articles: [] })

    expect(xmlFormError(xml)).toBeNull()
    expect(xml).toContain('<rss version="2.0"')
    expect(xml).toContain('</rss>')
    expect(xml).toContain('<title>亿轨星途</title>')
    expect(xml).toContain(`<link>${SITE}/</link>`)
    expect(xml).not.toContain('<item>')
    // 没有文章时不该编一个 lastBuildDate
    expect(xml).not.toContain('lastBuildDate')
    // 不能是空 body：空 body 同样会被订阅器当成"这个源坏了"
    expect(xml.length).toBeGreaterThan(200)
  })

  it('文章列表不是数组 / 混进 null_should兜成空数组，而不是把生成打崩', () => {
    expect(normalizeFeedArticles(null)).toEqual([])
    expect(normalizeFeedArticles({ records: [] })).toEqual([])
    expect(normalizeFeedArticles([null, undefined, 'x'])).toEqual([])
    expect(normalizeFeedArticles([article(1)])).toHaveLength(1)

    expect(xmlFormError(buildFeedXml({ siteUrl: SITE, articles: { records: [] } }))).toBeNull()
  })

  it('站点地址为空或非法时_should回落到默认域名（与 canonical / sitemap 用的是同一套归一化）', () => {
    const xml = buildFeedXml({ siteUrl: '', articles: [article(1)] })

    expect(xmlFormError(xml)).toBeNull()
    expect(xml).toContain('<link>https://www.yigalaxy.xin/</link>')
    expect(xml).toContain('https://www.yigalaxy.xin/article/1')
  })

  it('单条 item 生成失败（没有 id）时_should返回空串，由调用方过滤掉', () => {
    expect(buildFeedItem({ title: '没有 id' }, SITE)).toBe('')
  })
})

// =====================================================================
// 约定核对：canonical / sitemap / feed 三处必须是**同一个域名**
//
// 【为什么单独一条】三个地方各自拼域名，一旦不一致（比如 sitemap 用默认域名、
// canonical 用了环境变量覆盖后的域名），结果就是"订阅器被引到 A 域名、
// 爬虫被引到 B 域名"，而三份文件单独看都没问题 —— 属于只有对比才能发现的一类问题。
// =====================================================================
describe('feed 与 canonical / sitemap 的站点地址约定', () => {
  it('换一个站点地址_should三处一起跟着变', () => {
    const site = 'https://blog.example.com'
    const list = [article(9)]

    const head = buildSeoHead({ siteUrl: site, path: '/' })
    const sitemap = buildSitemapXml({ siteUrl: site, articles: list })
    const feed = buildFeedXml({ siteUrl: site, articles: list })

    expect(head.link[0].href).toBe(`${site}/`)
    expect(sitemap).toContain(`<loc>${site}/</loc>`)
    expect(sitemap).toContain(`<loc>${site}/article/9</loc>`)
    expect(feed).toContain(`<link>${site}/</link>`)
    expect(feed).toContain(`<atom:link href="${site}${FEED_PATH}"`)
    expect(feed).toContain(`${site}/article/9`)
    // 三处都不该残留默认域名
    expect(`${sitemap}${feed}${JSON.stringify(head)}`).not.toContain('yigalaxy.xin')
  })

  it('页面上自动发现的订阅地址_should与 feed.xml 的地址一致', () => {
    // 页面 head 里的 <link rel="alternate"> 与 feed 里 rel="self" 指同一个地址，
    // 订阅器才发现得了、也不会把用户引到一个 404 上
    const head = buildSeoHead({ siteUrl: SITE, path: '/article/1' })
    const alternate = head.link.find(l => l.rel === 'alternate')

    expect(alternate).toEqual({
      rel: 'alternate',
      type: 'application/rss+xml',
      title: '亿轨星途 的 RSS 订阅',
      href: `${SITE}${FEED_PATH}`,
    })
    expect(buildFeedXml({ siteUrl: SITE, articles: [] })).toContain(`href="${alternate.href}" rel="self"`)
  })
})

// =====================================================================
// 对照组：证明上面那个良构检查器真的会报错
//
// 【为什么必须有这一条】一个永远返回 null 的检查器会让"XML 合法"永远为真 ——
// 那种测试是**假绿**：它看起来在守护 XML 转义，实际上什么都没守。
// 所以这里喂三段**故意写坏**的 XML，断言检查器能认出来。
// （同样的对照思路见 test/linkUnderline.nuxt.spec.ts 里那条"没有警告"的用例。）
// =====================================================================
describe('feed · 良构检查器自身的对照组', () => {
  it('未转义的 & 会被认出来', () => {
    expect(xmlFormError('<?xml version="1.0" encoding="UTF-8"?><rss><title>A & B</title></rss>'))
      .toContain('未转义的 &')
  })

  it('文本里的裸 < 会被认出来', () => {
    expect(xmlFormError('<?xml version="1.0" encoding="UTF-8"?><rss><title>a < b</title></rss>'))
      .toContain('没有构成合法标签')
  })

  it('标签不配对 / 没有闭合会被认出来', () => {
    expect(xmlFormError('<?xml version="1.0" encoding="UTF-8"?><rss><title>x</title></channel></rss>'))
      .toContain('不配对')
    expect(xmlFormError('<?xml version="1.0" encoding="UTF-8"?><rss><channel>')).toContain('没有闭合')
  })

  it('而正常生成出来的 feed 要通过（检查器不是"永远报错"）', () => {
    expect(xmlFormError(buildFeedXml({ siteUrl: SITE, articles: articles(2) }))).toBeNull()
  })
})
