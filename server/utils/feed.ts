// ============================================================
// server/utils/feed.ts
//
// 作用：把 RSS 2.0 的**内容生成**做成纯函数（可单测），
//       路由处理器（server/routes/feed.xml.get.ts）只负责取数与响应头。
//       和 server/utils/sitemap.ts 是同一套路：运行时路由 + 纯函数生成 + 失败降级。
//
// 【为什么也要做成运行时路由】
//   与 sitemap.xml 完全相同的两条硬约束：
//    ① 前端镜像的 docker build 里连不上后端，构建时生成只会得到"构建失败"
//       或者一份**空的** feed（后者更糟：构建看着成功了，线上却永远没有内容）
//    ② 新文章发布后订阅里应该很快看得到；构建时生成的话，发文章还得重新构建镜像
//
// 【服务端请求必须走内网地址】用 runtimeConfig.apiBaseServer（NUXT_API_BASE_SERVER）：
//   容器里去访问自己的公网域名等于绕一圈 DNS + Nginx 再回到同一台机器，
//   域名没配好时直接失败 —— 那时 feed 会静默降级成"只有站点信息"的版本。
//
// 【⚠️ XML 里所有文本都必须转义，这条最容易漏】
//   标题/摘要里出现一个 `&`（比如"备忘 & 待办"）就会让整份 feed **非法**，
//   而订阅器对非法 feed 的处理是**整份丢弃**（不是"少一条"）——
//   症状是"订阅了但永远收不到新文章"，站长在浏览器里打开 /feed.xml
//   看着却一切正常（浏览器对 XML 的容错比订阅器宽得多）。
//   所以转义用的是 sitemap 那一份 `escapeXml()`：同一条规则只维护一处。
//
// 【description 里放什么：摘要，不是 Markdown 源码，也不是硬转出来的 HTML】
//   后端 GET /article/rss 给的是 `content`（Markdown 源码）+ `summary`（纯文本摘要）。
//   把 Markdown 源码原样塞进 <description> 是最差的选择：订阅器会把
//   `# 标题`、`**加粗**` 当成普通文字显示出来。剩下两条路：
//     · 服务端把 Markdown 转成 HTML（更好看，但要引入渲染依赖）
//     · 退一步，<description> 放后端已经算好的 summary（纯文本）
//   这里选的是**后者**，理由写在 README 里（一句话版：本仓库唯一的 Markdown 渲染依赖
//   md-editor-v3 是**浏览器端的 Vue 组件**，导出的是 MdEditor/MdPreview 这类组件，
//   没有可以直接调用的 markdown→HTML 函数；在 Nitro 的路由里用它只能"起一个 Vue SSR
//   把组件渲染一遍"，为一个 XML 接口付这个代价不值得，而且它随时可能因为组件内部
//   用了 document 而在 feed 这条没人看的链路上崩掉）。
//
// 【技术栈与关键字】
//   · RSS 2.0（cyber.harvard.edu/rss/rss.html）：<rss version="2.0"> 里一个 <channel>，
//     文章是若干 <item>；<guid> 是"这一条的唯一标识"，订阅器靠它判断"是不是同一篇"
//     （重复的 guid 会让阅读器把新文章当成已读过的）
//   · RFC 822 日期：<pubDate> 的格式必须是 `Thu, 10 Sep 2026 05:03:19 +0800`
//     （星期、英文月份缩写、+0800 形式的时区偏移）—— 格式错了订阅器会当成没有时间，
//     于是所有文章的顺序变成"抓到的顺序"
//   · atom:link rel="self"：告诉订阅器"这个 feed 的正式地址是哪个"，
//     是 RSS 最佳实践（不加也能用，但有些订阅器会因此反复重新订阅）
// ============================================================

// 站点信息（标题 / 描述）与地址归一化只有一套实现（app/utils/seo.ts）：
// feed 里写的域名必须和 canonical、sitemap 里的**字字一致**
import { SITE_DESCRIPTION, SITE_NAME, absoluteUrl, normalizeSiteUrl, FEED_MIME, FEED_PATH } from '~~/app/utils/seo'
// 转义规则与 sitemap 共用一份：两处各写一遍迟早会出现"这里转了、那里没转"
import { escapeXml } from './sitemap'

/** feed 的 Content-Type：订阅器按 `application/rss+xml` 识别，写错会当成普通 XML */
export const FEED_CONTENT_TYPE = 'application/rss+xml; charset=utf-8'

/** Atom 命名空间（只用来放 rel="self" 那条 link） */
export const ATOM_NAMESPACE = 'http://www.w3.org/2005/Atom'

/**
 * 时间戳按哪个时区解释。
 *
 * 【为什么是一个常量而不是"自动判断"】后端给的是 `LocalDateTime`
 * （形如 `2026-09-10T05:03:19`）—— **它没有时区信息**，前端无从得知它是 UTC 还是东八区。
 * 能确定的是后端容器跑在 `Asia/Shanghai`（数据源连接串里写的就是它），
 * 所以按 +0800 解释、并且把它写成一个显式的常量：
 * 哪天后端换成 UTC 时间戳，这里是**唯一**要改的地方（而不是散在格式化逻辑里）。
 * 【为什么不写成 +08:00】RFC 822 的日期里时区是紧凑写法（+0800 / GMT），
 * 带冒号的 ISO 8601 形态有些订阅器解析不了。
 */
export const FEED_TIMEZONE_OFFSET = '+0800'

/** 星期的英文缩写（RFC 822 要求英文三字母） */
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** 月份的英文缩写（RFC 822 要求英文三字母，不能用数字） */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * 纯函数：后端的 `LocalDateTime` → RFC 822 日期串。
 *
 * `2026-09-10T05:03:19` → `Thu, 10 Sep 2026 05:03:19 +0800`
 *
 * 【为什么只认这个形状，而不是丢给 `new Date(text)`】
 *   `new Date('2026-09-10T05:03:19')` 在 JS 里的行为是**按本地时区解释**
 *   （不带时区的日期时间串按本地时区算），于是同一份数据在服务器（Asia/Shanghai）
 *   和用户浏览器（可能在任何时区）上解析出的是**两个不同的时刻** ——
 *   而 feed 是给服务器渲染的，这种"取决于解析环境"的行为不该出现在这里。
 *   自己按固定偏移拼，结果在任何机器上都一样。
 *
 * 【为什么要校验日期是不是真的存在】
 *   `2026-13-45` 这种值 `Date.UTC()` 会**静默滚动**成 2027 年 2 月某天，
 *   于是 feed 里出现一个凭空捏造的时间。所以这里把滚动后的三个字段和输入比对一次，
 *   不一致就返回空串（调用方据此整条 <pubDate> 都不写）。
 *
 * 【拿不到就返回空串，而不是"用当前时间兜底"】编一个时间比没有时间更糟：
 *   订阅器会把它当成真实发布时间，文章的顺序与"新文章提醒"就全乱了。
 */
export const toPubDate = (value) => {
  const text = typeof value === 'string' ? value.trim() : ''
  // 时间部分可缺省（只有日期时按当天 00:00:00 算），缺省的部分用 0 补齐
  const matched = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(text)
  if (!matched) return ''

  const year = Number(matched[1])
  const month = Number(matched[2])
  const day = Number(matched[3])
  const hour = Number(matched[4] ?? 0)
  const minute = Number(matched[5] ?? 0)
  const second = Number(matched[6] ?? 0)

  // 字段范围先卡一道：`2026-09-10T25:00:00` 这种值同样会被 Date 滚动到第二天
  if (month < 1 || month > 12 || day < 1 || day > 31) return ''
  if (hour > 23 || minute > 59 || second > 59) return ''

  // 用 Date.UTC 取星期：只借它算"这一天是星期几"，不拿它做时间换算，
  // 所以不会引入任何时区问题（GMT 与 +0800 的星期几是同一天）
  const utc = new Date(Date.UTC(year, month - 1, day))
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) {
    return '' // 日期不存在（比如 2 月 30 日），Date 已经替我们滚动了
  }

  const pad = (num) => String(num).padStart(2, '0')
  return `${WEEKDAYS[utc.getUTCDay()]}, ${day} ${MONTHS[month - 1]} ${year} `
    + `${pad(hour)}:${pad(minute)}:${pad(second)} ${FEED_TIMEZONE_OFFSET}`
}

/**
 * 纯函数：一篇文章 → 一条 `<item>`。
 *
 * 【为什么要丢掉没有 id 的文章】id 是链接与 guid 的一部分，缺了它只能拼出
 * `/article/undefined` —— 那是把一个 404 递给订阅器，比不收录更差
 * （用户会点进一个空白页）。sitemap 里也是同一条纪律。
 */
export const buildFeedItem = (article, siteUrl) => {
  const id = article?.id
  if (id === undefined || id === null || id === '') return ''

  const link = absoluteUrl(`/article/${id}`, siteUrl)
  const title = typeof article?.title === 'string' && article.title.trim()
    ? article.title.trim()
    : `文章 ${id}`
  // summary 就是这个 item 的正文（见文件头对 description 的说明）
  const summary = typeof article?.summary === 'string' ? article.summary.trim() : ''
  const pubDate = toPubDate(article?.createTime)

  const parts = [
    `    <title>${escapeXml(title)}</title>`,
    `    <link>${escapeXml(link)}</link>`,
    // 【guid 用文章地址，并显式写 isPermaLink="true"】它同时是"订阅器判重的依据"
    // 和"用户点进去要去的地址"，用同一个值最不容易出现"guid 说 A、link 说 B"的错位。
    // 不写 isPermaLink 时规范默认是 true，但显式写出来读代码的人不用去查规范
    `    <guid isPermaLink="true">${escapeXml(link)}</guid>`,
  ]

  // 空值整条不写（`<pubDate></pubDate>` 是非法值，有些订阅器会把整条 item 当脏数据丢掉）
  if (pubDate) parts.push(`    <pubDate>${escapeXml(pubDate)}</pubDate>`)
  if (summary) parts.push(`    <description>${escapeXml(summary)}</description>`)

  return `  <item>\n${parts.join('\n')}\n  </item>`
}

/**
 * 纯函数：文章列表 → 完整的 feed.xml 文本。
 *
 * 传空数组（接口挂了 / 一篇文章都没有）时返回的是**仍然合法**的 feed：
 * 声明、<rss>、<channel>、站点标题/链接/描述都在，只是没有任何 <item>。
 * 降级路径依赖这一点 —— 空 body 或者 500 会让订阅器认为"这个源坏了"，
 * 而"暂时没有新文章"只是没有新文章。
 *
 * 【为什么不再排序、也不截断】后端 `GET /article/rss` 已经是
 * "最近 20 篇已发布文章、时间倒序"。前端再排一次或再切一刀，
 * 就等于把同一条规则维护成两份（和归档页是同一条纪律）。
 */
export const buildFeedXml = ({ siteUrl, articles, title, description } = {}) => {
  const base = normalizeSiteUrl(siteUrl)
  const items = (Array.isArray(articles) ? articles : [])
    .map(article => buildFeedItem(article, base))
    .filter(Boolean)

  // 【lastBuildDate 为什么取"最新那篇的时间"，而不是请求时的 now()】
  //   ① 语义上它就是"内容最后一次变化的时间"，最新一篇的发布时间是对它的忠实近似
  //   ② 用 now() 的话，每次抓取都会产生一行新内容 —— 测试没法断言，
  //      而对订阅器来说"每次都变"和"每天都变"没有区别
  //   ③ 一篇文章都没有 / 时间都解析不出来时整条不写（编一个当前时间没有意义）
  // 后端已按时间倒序，所以取"第一个能解析出时间的那篇"就是最新的一篇
  const list = normalizeFeedArticles(articles)
  const lastBuildDate = list.map(a => toPubDate(a?.createTime)).find(Boolean) || ''

  const channel = [
    `    <title>${escapeXml(title || SITE_NAME)}</title>`,
    `    <link>${escapeXml(absoluteUrl('/', base))}</link>`,
    `    <description>${escapeXml(description || SITE_DESCRIPTION)}</description>`,
    `    <language>zh-CN</language>`,
    // 正式地址：订阅器据此知道"这个源自己是谁"（有些人是套一层代理在转发 feed 的）
    `    <atom:link href="${escapeXml(absoluteUrl(FEED_PATH, base))}" rel="self" type="${FEED_MIME}"/>`,
  ]
  if (lastBuildDate) channel.push(`    <lastBuildDate>${escapeXml(lastBuildDate)}</lastBuildDate>`)

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<rss version="2.0" xmlns:atom="${ATOM_NAMESPACE}">`,
    '  <channel>',
    ...channel,
    ...items,
    '  </channel>',
    '</rss>',
    '',
  ].join('\n')
}

/**
 * 纯函数：后端的 data → feed 用的文章数组。
 * 结构不对（data 不是数组、数组里混进了 null）时兜成空数组 ——
 * "暂时没有新文章"远好过"feed 500"。
 */
export const normalizeFeedArticles = (data) =>
  (Array.isArray(data) ? data : []).filter(article => article && typeof article === 'object')
