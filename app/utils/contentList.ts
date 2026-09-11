// ============================================================
// app/utils/contentList.ts
//
// 作用：F5 四个内容模块（收藏 / 项目 / 友链 / 关于）在**前台页面**里共用的
//       「接口数据 → 页面能安全渲染的形状」这一层的纯函数。
//
// 【为什么这四条逻辑必须集中在一处，而不是各页面自己写一遍】
//   四个页面拿到的都是同一种东西：后端 `Result<List<XxxVO>>` 里的那个数组。
//   而它们各自都会遇到同一批边界情况（下面每一条都对应一个真实会发生的输入）：
//     · `data` 是 null（后端 500 时 data 就是 null）—— 直接 v-for 会抛
//       "xxx is not iterable"，整页白屏，而正确表现应该是"这一块空着"
//     · 字段是 null / 空串 / 全是空格 —— 页面上会印出空白或 `undefined`，
//       这两种都让人以为页面坏了（所以要有统一的「—」占位）
//     · `title` / `url` 里可能有 `javascript:` 这类地址 —— 它们会被渲染成
//       `<a href>`，必须用与后端同一套白名单（只认 http(s)）先筛一遍
//     · 收藏的 `category` 是自由文本分组名，需要按它分组且**绝不重排**
//   四个页面各写一份的后果是"改一处漏三处"：收藏页修好了 null，
//   友链页还印着 undefined，而没有人会发现 —— 因为两个页面平时长得都对。
//
// 【技术栈与关键字】
//   · 这是 Nuxt 的 app/utils 目录：导出会被自动导入，页面里直接写
//     `asList(res)` 即可，不需要 import 语句
//   · 全部写成**不依赖 Nuxt 上下文的纯函数**：它们只做字符串与数组处理，
//     所以可以脱离组件直接断言（测试里不需要挂载任何东西）
//   · `URL` 是浏览器/Node 都有的内置类；解析失败会抛异常，所以 hostOf 里 try/catch
// ============================================================

/**
 * 字段缺失时的统一占位符。
 * 【为什么是「—」而不是空字符串】空白单元格看起来像"页面没加载出来"或者"数据被截断了"，
 * 而「—」明确表示"这一项后端没给值"——这是两种完全不同的信息。
 * （后台四张表格用的是同一个符号，见 app/utils/time.ts 里 formatDateTime 的返回值。）
 */
export const FIELD_PLACEHOLDER = '—'

/**
 * 收藏里"没有分组名"的那些，在界面上归到哪个分组。
 * 【为什么要给一个名字而不是丢掉它们】后端允许 category 为空（空 = 未分组，
 * 见 FavoriteVO 的注释）。丢掉的话用户会以为"我明明收藏了怎么不见了"，
 * 而这是最像 bug 的一种正确行为。
 */
export const UNGROUPED_LABEL = '未分组'

/** 未分组分组在 v-for 里用的 key（不能与真实分组名撞：用一对不可能出现在名字里的尖括号） */
const UNGROUPED_KEY = '\u0000ungrouped'

/**
 * 把后端返回的字符串收成"可以显示的文字"（去首尾空格；非字符串一律当空）。
 *
 * 【为什么要做这一步而不是直接丢给模板】
 *   后端允许可选字段不传（JSON 里这个键可能根本不存在，于是是 undefined）。
 *   `{{ row.description }}` 在它缺失时会渲染出空白或 "undefined"，
 *   而 `row.description.trim()` 会直接抛异常（undefined 上没有 trim）。
 *   收成"要么是有内容的字符串、要么是空串"之后，调用方只需要判空。
 */
export const rawText = (value) => (typeof value === 'string' ? value.trim() : '')

/**
 * 可显示文字：有内容就用它，否则用占位符。
 *
 * 【为什么连数字也放行】sort / status 这类字段在 JSON 里是数字，
 * 直接 `typeof value === 'string'` 判会把它当成"缺失"而印出「—」，
 * 于是列表里"排序"那一列全是「—」，看起来像接口没返回。
 */
export const textOf = (value, placeholder = FIELD_PLACEHOLDER) => {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return rawText(value) || placeholder
}

/**
 * 从一次 `useApi().request()` 的结果里取出**列表**。
 *
 * 【为什么要兜这一道（而不是信任 res.data 一定是数组）】
 *   这些接口的结果会被 v-for / map / filter 用到。只要有一次不是数组
 *   （接口挂了 data 是 null、或者后端哪天把结构改成分页的 `{ records: [] }`），
 *   整个页面就白屏 —— 而那是一个"内容少显示一点"完全能接受、
 *   "整页打不开"完全不能接受的场景。兜成空数组之后，最差只是列表空着。
 *
 * @param {{ok?: boolean, data?: any}} res useApi().request() 的返回值
 * @returns {Array} 永远是数组
 */
export const asList = (res) => (res && res.ok && Array.isArray(res.data) ? res.data : [])

/**
 * 从一次请求结果里取出**对象**（关于页用：`GET /about` 返回的是一个对象而不是数组）。
 *
 * 【为什么必须显式排除数组】后端两个接口的形状很像，`Array.isArray` 的排除
 *   是"这份数据只有一条"这个语义的守卫：万一哪天有人把接口改成返回数组，
 *   这里会回落到 null（页面显示"没有内容"），而不是把数组当对象用
 *   （那样 `about.nickname` 是 undefined，页面上印出一堆「—」，
 *    看起来像数据全丢了，却不会报任何错）。
 */
export const asObject = (res) => {
  const data = res?.data
  if (!res?.ok || data === null || typeof data !== 'object' || Array.isArray(data)) return null
  return data
}

/**
 * 判断一个地址能不能安全地放进 `<a href>`。
 *
 * 【为什么用白名单（只认 http/https）而不是黑名单】
 *   这些地址是管理员在后台填的、存进数据库、再由前台渲染成链接的，
 *   典型的存储型 XSS 通道：`javascript:alert(document.cookie)` 填进"收藏地址"，
 *   缓存一存、前台一渲染，每个访客都会执行到它。
 *   黑名单永远列不全（`JavaScript:` 大小写、`data:text/html`、`vbscript:`…），
 *   白名单只有两条规则。**这套正则与后端 UrlPatterns.EXTERNAL_URL 是同一套规则**
 *   （那边也只放行 http(s)），前端这一道是第二道防线，不是唯一一道。
 *
 * 【为什么不是"有值就当链接"】那等于把校验完全交给后端：
 *   万一历史数据里存在一条非法地址（后端规则是后来才加的），
 *   前台就会把它当链接渲染出来。这里的判断同时承担"能不能点"的展示语义。
 */
export const isExternalUrl = (value) => /^https?:\/\/\S+$/.test(rawText(value))

/**
 * 从地址里取出主机名（卡片上显示"这个收藏是哪个站点的"）。
 *
 * 【为什么不直接截前 30 个字符】`https://` 和路径会占掉大半个宽度，
 * 用户看到的是一模一样的前缀，等于没显示。
 * 【为什么用 try/catch】`new URL()` 对非法地址会抛异常，而列表里的地址
 * 来自数据库（后面可能有人手工改过库），不能假设它一定合法 ——
 * 那种情况下返回「—」，而不是让整页渲染挂在一个异常上。
 */
export const hostOf = (value, placeholder = FIELD_PLACEHOLDER) => {
  const url = rawText(value)
  if (!url) return placeholder
  try {
    return new URL(url).host || placeholder
  } catch {
    return placeholder
  }
}

/**
 * 把项目里逗号分隔的 `tech` 拆成一个个技术标签。
 *
 * 【为什么是前端 split（而不是让后端返回数组）】后端有意把它存成字符串
 * （见 ProjectForm 的注释：提交什么字符串、列表就返回什么字符串，
 * 免得后台表单还要把数组拼回去）。所以拆分这件事只在前端做一次。
 * 【为什么要过滤空项】"Spring Boot, , MySQL" 这种多打了一个逗号的写法
 * 完全可能出现，不过滤就会渲染出一个空标签（看起来像界面坏了）。
 */
export const splitTech = (value) =>
  rawText(value)
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)

/**
 * 把收藏列表按 `category` 分组。
 *
 * 【为什么分组在前端做（后端不做 GROUP BY）】后端 FavoriteMapper 的注释写明了理由：
 *   分组名是自由文本，SQL 的 GROUP BY 与前端分组会在"首尾空格 / 大小写"上不一致。
 *   后端因此一次返回全部（带 category），由前端分组 —— 这也是这个函数的由来。
 *
 * 【为什么【一次都不重排】】
 *   后端的顺序就是契约（`ORDER BY sort ASC, id ASC`，见 FavoriteServiceImpl.query）。
 *   这里要是顺手 sort 一遍（哪怕按分组名排），哪天后端改成别的规则就会被我盖掉 ——
 *   页面上看不出任何异常，只是顺序不对，没人会当成 bug 报上来。
 *   所以：分组本身按"在列表里第一次出现的顺序"排列，组内保持后端给的顺序。
 *
 * 【为什么空分组名要保留而不是丢弃】见 UNGROUPED_LABEL 的注释。
 *
 * @param {Array} list 后端给的收藏数组（顺序即展示顺序）
 * @returns {Array<{key: string, label: string, items: Array}>} 分组数组，永远是数组
 */
export const groupFavorites = (list) => {
  const groups = []
  // Map 里存的是"分组 key → 那个分组对象"，让"这条属于哪个分组"的查找是 O(1)。
  // 用数组的 find 也能写，但列表长了就是 O(n²)（几十条时无所谓，
  // 但这是"以后会变慢"的写法，没有理由留着）。
  const byKey = new Map()

  for (const item of Array.isArray(list) ? list : []) {
    const name = rawText(item?.category)
    const key = name || UNGROUPED_KEY
    if (!byKey.has(key)) {
      const group = { key, label: name || UNGROUPED_LABEL, items: [] }
      byKey.set(key, group)
      groups.push(group)
    }
    byKey.get(key).items.push(item)
  }

  return groups
}
