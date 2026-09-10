// ============================================================
// app/utils/seo.ts
//
// 作用：把「一个页面该有哪些 SEO 元信息」收敛成纯函数 —— 页面只描述
//       「这是哪个页面、叫什么、讲什么」，不再各自拼一遍 title / description /
//       og / canonical。
//
// 【为什么需要它（改之前是什么样）】
//   全站只有一个 <title>，而且只有文章详情页设了；description / og / canonical
//   一个都没有。对博客来说这是硬伤：
//     · 搜索引擎抓到的页面没有摘要，只能自己从正文里截一段（截出来常常是
//       导航文字或代码片段），或者干脆认为"这两页内容一样"
//     · 链接分享到微信 / 群里没有卡片，只有一行光秃秃的地址
//     · 带 ?keyword=nuxt 的搜索结果页和首页是同一份内容，却没有 canonical
//       说明谁是正式地址 —— 爬虫会当成两个页面分别收录（重复内容）
//
// 【为什么是纯函数 + 一个很薄的 composable，而不是直接写在页面里】
//   `buildSeoHead()` 等函数不依赖任何 Nuxt 上下文，所以可以脱离组件直接断言
//   （title 怎么拼、canonical 是不是绝对地址、没有封面时会不会出现空的 og:image）；
//   `useSeoMetaFor()` 那一层只负责"把运行时配置和响应式数据喂进来"。
//   分成两层之后，页面里剩下的只有一句"我是首页 / 我是第 12 篇文章"。
//
// 【为什么"没有封面时不出现 og:image"值得单独守一条】
//   拼成 `og:image: undefined` 或者 `<meta property="og:image" content="">`
//   都不会报错，但抓取方会认为"这个页面声明了一张空图"——
//   分享出去的卡片就是一片空白，而且这种现象【只在分享时才看得到】，
//   本地打开页面一切正常。所以这里的规则是：没有封面就【整个键都不出现】。
//
// 【技术栈与关键字】
//   · useHead（unhead，Nuxt 内置）：输入是一个描述对象，里面的值可以是
//     ref / computed / getter —— unhead 在"解析标签"时会把它们解包
//     （服务端渲染时同样解包），所以数据到手前后 title 能跟着变
//   · canonical：告诉搜索引擎"这份内容的正式地址是哪个"。首页的搜索/分类
//     结果页与首页是同一份内容，正式地址只留不带参数的 /
//   · og:*（Open Graph）：微信 / Twitter / 各类聊天工具抓链接时读的那套标签，
//     键名必须是 `property`（不是 name），写错了抓取方就是读不到、且不报错
//   · og:url / og:image 必须是【绝对地址】，相对地址按规范是无效的
// ============================================================

/** 站点名：出现在 title 后缀、og:site_name 等所有"站点级"文案里 */
export const SITE_NAME = '亿轨星途'

/** 首页副标题（个人卡片上那句自我介绍），也用作站点默认标题的后半句 */
export const SITE_TAGLINE = '在代码与星轨之间，慢慢画自己的图。'

/**
 * 站点默认标题（首页与"还没有数据的页面"都用它）。
 * 【为什么要有一个"默认标题"而不是让页面各自传】详情页在数据回来之前、
 * 或者文章不存在时都会走到这里，没有默认值的话这些情况下 <title> 会是空的 ——
 * 而空 title 是搜索引擎最不喜欢的一种页面。
 */
export const SITE_TITLE = `${SITE_NAME} · ${SITE_TAGLINE}`

/** 站点默认描述：首页、以及任何"没有自己摘要"的页面用它 */
export const SITE_DESCRIPTION
  = '亿轨星途是一个个人博客：记录技术实践、读书笔记与日常随笔，'
    + '首页按最新发布排列，支持关键词搜索与分类筛选。'

/** 页面标题与站点名之间的分隔符（中文语境里用间隔点比竖线干净） */
export const TITLE_SEPARATOR = ' · '

/**
 * RSS 订阅的地址、MIME 类型与标题。
 *
 * 【为什么这三个常量放在这里，而不是写在 server/utils/feed.ts 里】
 *   同一个约定有两个使用方：服务端的 `/feed.xml` 路由（用它拼 <atom:link rel="self">）
 *   和每个页面的 head（用它渲染自动发现的 `<link rel="alternate">`）。
 *   各写一份的话，哪天有人把路由改成 /rss.xml，页面上的自动发现就会指向一个 404 ——
 *   而这个 404 只在"订阅器去抓"的时候才暴露，浏览器里完全看不出来。
 *   放在这里之后两边引用的是同一个常量（服务端也 import 得到，它是纯常量、无副作用）。
 */
export const FEED_PATH = '/feed.xml'

/** RSS 的 MIME：`application/rss+xml`（不是 application/xml，订阅器按它识别） */
export const FEED_MIME = 'application/rss+xml'

/** 自动发现标签上的标题：订阅器在"发现多个订阅源"时用它给用户看 */
export const FEED_TITLE = `${SITE_NAME} 的 RSS 订阅`

/** 页面语言：写进 <html lang>，屏幕阅读器与搜索引擎都读它 */
export const HTML_LANG = 'zh-CN'

/**
 * 站点对外地址的默认值（用于 canonical / og:url / sitemap 的绝对地址）。
 *
 * 【为什么要做成可配置的】同一份镜像要能在本地（localhost:3000）、
 * 测试域名、正式域名下跑。绝对地址写死的话，本地构建出来的 canonical
 * 会指向正式域名 —— 调试时看着"对"，其实是在骗自己。
 * 覆盖方式：环境变量 NUXT_PUBLIC_SITE_URL（见 nuxt.config.ts）。
 */
export const DEFAULT_SITE_URL = 'https://www.yigalaxy.xin'

/**
 * 把站点地址收拾成"可以用来拼绝对地址"的形态。
 *
 * 【为什么要卡这么死】
 *   · 空值 / 非字符串 → 回落默认值。宁可回到正式域名，
 *     也不要拼出 `/article/12`（相对地址，canonical 规范里无效）
 *     或者 `undefined/article/12` 这种坏地址
 *   · 结尾的斜杠要统一去掉：不去掉就会拼出 `https://站点//article/12`
 *   · 不以 http(s):// 开头的值（比如有人把 NUXT_PUBLIC_SITE_URL 填成
 *     `www.example.com`）也回落默认值：这种值拼出来的 canonical 是相对地址，
 *     搜索引擎会忽略它，而页面看起来一切正常 —— 静默失效最难查
 */
export const normalizeSiteUrl = (value) => {
  if (typeof value !== 'string') return DEFAULT_SITE_URL
  const trimmed = value.trim().replace(/\/+$/, '')
  return /^https?:\/\//i.test(trimmed) ? trimmed : DEFAULT_SITE_URL
}

/**
 * 纯函数：把页面路径（或已经是绝对地址的图片 URL）拼成绝对地址。
 *
 * 【为什么图片也要过这一道】文章封面在库里存的是 `/uploads/xxx.png` 这样的
 * 站内路径，而 og:image 规范要求绝对地址 —— 直接把相对路径塞进去，
 * 微信那边抓不到图（本地打开页面看不出任何问题）。
 * 已经是 http(s):// 开头的一律原样返回（以后封面挪到 OSS / CDN 也照样能用）。
 */
export const absoluteUrl = (pathOrUrl, siteUrl = DEFAULT_SITE_URL) => {
  const base = normalizeSiteUrl(siteUrl)
  const value = typeof pathOrUrl === 'string' ? pathOrUrl.trim() : ''
  if (!value) return `${base}/`
  if (/^https?:\/\//i.test(value)) return value
  return `${base}${value.startsWith('/') ? '' : '/'}${value}`
}

/**
 * 纯函数：页面标题 → 完整标题。
 * 【为什么空标题要回落到站点默认标题】数据还没回来、文章不存在、或者
 * 有人忘了传 title —— 这三种情况下都不该出现一个空的 <title>。
 */
export const pageTitle = (title) => {
  const value = typeof title === 'string' ? title.trim() : ''
  return value ? `${value}${TITLE_SEPARATOR}${SITE_NAME}` : SITE_TITLE
}

/** 纯函数：描述 → 能显示的描述（空值回落站点默认描述） */
export const pageDescription = (description) => {
  const value = typeof description === 'string' ? description.trim() : ''
  return value || SITE_DESCRIPTION
}

/**
 * 纯函数：页面信息 → useHead 的输入对象（title / meta / link / htmlAttrs）。
 *
 * 【返回的就是 useHead 直接能用的形状】这样"元信息拼得对不对"可以完全脱离
 * Nuxt 上下文来断言：拿返回值去查 title、查有没有 canonical、
 * 查 og:image 在没封面时是不是【整个键都没有】。
 *
 * @param {object}  options
 * @param {string}  [options.siteUrl]   站点地址（运行时配置）
 * @param {string}  [options.path]      页面路径，如 '/' 或 '/article/12'
 * @param {string}  [options.title]     页面标题（不含站点名；空则用站点默认标题）
 * @param {string}  [options.description] 页面描述（空则用站点默认描述）
 * @param {string}  [options.type]      og:type，页面级别（website / article）
 * @param {string}  [options.image]     封面（相对或绝对地址；空则不出 og:image）
 * @param {boolean} [options.noindex]   true 时加 noindex, nofollow（后台页用）
 */
export const buildSeoHead = ({
  siteUrl,
  path = '/',
  title,
  description,
  type = 'website',
  image,
  noindex = false,
} = {}) => {
  const fullTitle = pageTitle(title)
  const fullDescription = pageDescription(description)
  const url = absoluteUrl(path, siteUrl)

  // 逐条列出（而不是从一张键值表循环生成）：og 的键名必须是 property，
  // 而 description 用的是 name —— 混在一张表里迟早会有一个写错，
  // 而写错的表现是"抓取方读不到"，页面上完全看不出来
  const meta = [
    { name: 'description', content: fullDescription },
    { property: 'og:title', content: fullTitle },
    { property: 'og:description', content: fullDescription },
    { property: 'og:type', content: type },
    { property: 'og:url', content: url },
  ]

  // 【没有封面就一条 og:image 都不出现】不能写成 content: '' 或 content: undefined：
  // 那等于对外声明"这个页面有一张空图"，分享出去就是一张空白卡片，
  // 而且只有在真去分享的时候才看得出来
  const imageUrl = typeof image === 'string' ? image.trim() : ''
  if (imageUrl) {
    meta.push({ property: 'og:image', content: absoluteUrl(imageUrl, siteUrl) })
  }

  // 后台页不该被搜到。用 noindex 而不是 robots.txt 里 Disallow 就够了 ——
  // 两者都要有（Disallow 挡住抓取、noindex 挡住收录，见 server/routes/robots.txt.get.ts）
  if (noindex) {
    meta.push({ name: 'robots', content: 'noindex, nofollow' })
  }

  return {
    title: fullTitle,
    // 语言写在 html 标签上，全站都该有；放在这里就等于"每个调用方都会设"
    htmlAttrs: { lang: HTML_LANG },
    meta,
    link: [
      { rel: 'canonical', href: url },
      // 【RSS 自动发现：每个页面都要有，所以放在这一层而不是某个页面里】
      //   订阅器（Feedbro / Inoreader / 浏览器扩展等）打开任意一个站内页面时，
      //   靠这条 link 才知道"这个站有订阅源、地址在哪"。
      //   只在首页加的话，用户从一篇分享出去的文章进来就发现不了订阅源 ——
      //   而"从一篇文章认识一个博客"恰恰是最常见的情形。
      // 【href 为什么用绝对地址】惯例上写 `/feed.xml` 也可以（相对地址浏览器会解析），
      //   但有些抓取工具只认绝对地址，而且绝对地址与 canonical / sitemap 用的是
      //   同一个 absoluteUrl()，三者不可能指向不同的域名。
      { rel: 'alternate', type: FEED_MIME, title: FEED_TITLE, href: absoluteUrl(FEED_PATH, siteUrl) },
    ],
  }
}
