// ============================================================
// app/utils/contentForm.ts
//
// 作用：F5 四个后台面板（收藏 / 项目 / 友链 / 关于）在**提交之前**共用的
//       字段长度上限、地址格式白名单与本地预检函数。
//
// 【上限数字是从哪来的 —— 这一条最要紧】
//   每一个数字都抄自**后端 DTO 上的校验注解**，不是猜的：
//     · 友链   FriendLinkForm：@Size(max=50) name / @Size(max=255) url /
//              @Size(max=255) avatar / @Size(max=200) description
//     · 项目   ProjectForm：@Size(max=100) name / @Size(max=500) description /
//              @Size(max=255) url、repo、cover / @Size(max=200) tech
//     · 收藏   FavoriteForm：@Size(max=100) title / @Size(max=255) url /
//              @Size(max=500) description / @Size(max=50) category
//     · 关于   AboutForm：@Size(max=50) nickname / @Size(max=255) avatar /
//              @Size(max=5000) bio / @Size(max=100) email /
//              @Size(max=255) github / @Size(max=50) wechat / @Size(max=30) qq
//   后端 Service 里还有一份**同样的**常量（normalizeXxx 里逐字段卡长度），
//   连同数据库列宽共三处一致。前端这里是第四处，作用只有一个：
//   **本地先拦一道，省掉一次注定失败的往返**（用户不用等一个网络来回才知道超长了）。
//   ⚠️ 上限写错的后果不是"多一层报错"，而是**和后端的校验打架**：
//     前端以为 20 字合法、后端说 30 字才超，用户就会看到"界面允许、保存却被拒"。
//     所以这里的数字必须与后端注解逐一对齐（改后端时要一起改这里）。
//
// 【为什么地址用正则白名单而不是"看起来像不像 URL"】
//   同 app/utils/contentList.ts 里 isExternalUrl 的说明：这些字段会变成
//   `<a href>` / `<img src>`，是存储型 XSS 的通道。后端
//   common/validation/UrlPatterns 用的是白名单（只放行 http(s)），
//   这里**原样抄那两条正则与两句提示文案** —— 两边规则一致，
//   用户才不会遇到"前端说不行、后端说行"这种无从下手的情况。
//   ⚠️ 正则里整组可以缺省（末尾的 `?`）：空串是合法的，表示"清空这一栏"，
//     必填由 required 那一档单独判（后端也是这么分的：@NotBlank 管必填、
//     @Pattern 管格式）。
//
// 【技术栈与关键字】
//   · 全部是纯函数，返回「空串 = 通过」「非空串 = 给用户看的中文原因」，
//     调用方一行 `const err = checkXxx(...); if (err) { ... }` 就能用
//   · 文案刻意与后端保持一致（"标题最长 100 字"这种句式就是后端
//     normalizeOptional 拼出来的），用户看不出是哪一道拦的 —— 这正是想要的
//   · 这些函数不依赖 Nuxt 上下文与 Vue，可以脱离组件直接断言
// ============================================================

import { rawText } from './contentList'

/**
 * 友链的字段上限（对齐 FriendLinkForm / FriendLinkServiceImpl 的常量）。
 * 用 Object.freeze 冻结：它是一份"与后端对齐的约定"，
 * 被就地改一个数字会让前端预检和后端校验悄悄分叉。
 */
export const LINK_LIMITS = Object.freeze({
  name: 50,
  url: 255,
  avatar: 255,
  description: 200,
})

/** 项目的字段上限（对齐 ProjectForm / ProjectServiceImpl 的常量） */
export const PROJECT_LIMITS = Object.freeze({
  name: 100,
  description: 500,
  url: 255,
  repo: 255,
  cover: 255,
  tech: 200,
})

/** 收藏的字段上限（对齐 FavoriteForm / FavoriteServiceImpl 的常量） */
export const FAVORITE_LIMITS = Object.freeze({
  title: 100,
  url: 255,
  description: 500,
  category: 50,
})

/** 关于页的字段上限（对齐 AboutForm / AboutServiceImpl 的常量） */
export const ABOUT_LIMITS = Object.freeze({
  nickname: 50,
  avatar: 255,
  bio: 5000,
  email: 100,
  github: 255,
  wechat: 50,
  qq: 30,
})

/**
 * 音乐（后台「音乐管理」）的字段上限 —— 抄自后端 `MusicForm` 的注解：
 *   · title   `@NotBlank` + `@Size(max=100)`（曲名会被渲染成播放列表里的一行文字）
 *   · artist  `@Size(max=100)`（可空：纯音乐没有歌手）
 *   · url     `@NotBlank` + `@Size(max=500)` + `@Pattern(MEDIA_URL)`（音频地址）
 *   · cover   `@Size(max=255)` + `@Pattern(IMAGE_URL)`（封面走图片那一档）
 *   · lyrics  `@Size(max=20000)`（LRC 原文；后端**刻意不校验格式** ——
 *              纯音乐没有歌词、有人想贴纯文本歌词都是正当输入）
 *   · status  `@Min(0)` + `@Max(1)`
 * 与另外四组一样：这些数字必须与后端注解逐条对齐，前端拦一道只是省一次
 * 必然失败的往返（写小了会白拦用户，写大了会白跑一趟后端）。
 */
export const MUSIC_LIMITS = Object.freeze({
  title: 100,
  artist: 100,
  url: 500,
  cover: 255,
  lyrics: 20000,
})

/**
 * 外链白名单，与后端 `UrlPatterns.EXTERNAL_URL` **逐字符相同**：
 *   ^(?:https?:\/\/\S+)?$ —— 要么是空串，要么必须是 http(s):// 开头的完整地址。
 * 【为什么不用 `new URL()` 判】`new URL()` 会放行 `ftp:` / `mailto:` 等协议，
 * 而白名单只认两条协议；而且它对空串会抛异常（空串在这里是合法的"清空"）。
 */
export const EXTERNAL_URL_PATTERN = /^(?:https?:\/\/\S+)?$/

/**
 * 图片地址白名单，与后端 `UrlPatterns.IMAGE_URL` 逐字符相同：
 * 既接受外链，也接受 `/` 开头的站内路径（封面/头像是上传到本机的，
 * 后端上传接口返回的就是 `/uploads/...` 这种站内路径）。
 */
export const IMAGE_URL_PATTERN = /^(?:https?:\/\/\S+|\/\S*)?$/

/** 外链格式不合法时的提示（与后端 UrlPatterns.EXTERNAL_URL_MESSAGE 一字不差） */
export const EXTERNAL_URL_MESSAGE = '地址必须以 http:// 或 https:// 开头'

/** 图片地址格式不合法时的提示（与后端 UrlPatterns.IMAGE_URL_MESSAGE 一字不差） */
export const IMAGE_URL_MESSAGE = '图片地址必须是 http(s):// 开头的完整地址，或以 / 开头的站内路径'

/**
 * 音频（媒体）地址白名单，与后端 `UrlPatterns.MEDIA_URL` 逐字符相同：
 * `^(?:https?://\S+|/\S*)?$` —— 外链、`/` 开头的站内路径、或空串。
 *
 * 【⚠️ 它与 IMAGE_URL_PATTERN 的规则文本现在是一模一样的，但**必须是两个常量**】
 *   这正是后端 `UrlPatterns` 里那段注释说的坑，照抄过来：
 *     ① 名字会误导 —— 音乐的 url 指向 mp3，拿 IMAGE_URL 去校验它，
 *        下一个人读到会以为"音乐地址被限制成图片地址了"，然后去查是不是漏配了音频格式
 *     ② 两者的演化方向不同 —— 图片那边可能加"只允许图片扩展名"，
 *        音频这边可能收窄成"只允许 /uploads/music/ 或特定 CDN 域名"；
 *        合并成一个之后任何一边的调整都会**同时**改到另一边，而且不会有任何报错
 *   ⇒ 重复的是这一行正则，不是规则本身。
 */
export const MEDIA_URL_PATTERN = /^(?:https?:\/\/\S+|\/\S*)?$/

/** 音频地址格式不合法时的提示（与后端 UrlPatterns.MEDIA_URL_MESSAGE 一字不差） */
export const MEDIA_URL_MESSAGE = '音频地址必须是 http(s):// 开头的完整地址，或以 / 开头的站内路径'

/**
 * 必填文本的预检（对齐后端 `@NotBlank` + `@Size(max=…)`）。
 *
 * 【为什么要 trim 之后再判长度】后端 Service 是"先 trim 再卡长度"
 *   （normalizeTitle / normalizeName 都是这个顺序），所以 "  abc  " 这种输入
 *   在后端算 3 个字。前端不 trim 就判的话，用户会因为几个空格被判超长，
 *   而他看着输入框里的字完全不明白为什么 —— 这条和标签/分类面板的 trim 是同一件事。
 *
 * @returns {string} '' 表示通过；否则是给用户看的原因
 */
export const checkRequiredText = (value, label, maxLength) => {
  const text = rawText(value)
  if (!text) return `${label}不能为空`
  if (text.length > maxLength) return `${label}最长 ${maxLength} 字`
  return ''
}

/**
 * 可选文本的预检（对齐后端 `@Size(max=…)`；空值一律放行）。
 * 【空值为什么放行】空串在后端会被归一化成 null（"没有值"只有一种表示），
 * 是**正当输入**，不是错误 —— 把"清空某一栏"判成非法会让用户没法删掉不要的内容。
 */
export const checkOptionalText = (value, label, maxLength) => {
  const text = rawText(value)
  if (text.length > maxLength) return `${label}最长 ${maxLength} 字`
  return ''
}

/**
 * 外链字段的预检：先判必填（如果 required），再判格式与长度。
 *
 * @param {string} value    用户输入
 * @param {string} label    出错提示里用的字段名（"站点地址"/"在线地址"…）
 * @param {object} options  { maxLength: number, required: boolean }
 */
export const checkExternalUrl = (value, label, { maxLength, required = false } = {}) => {
  const text = rawText(value)
  if (!text) return required ? `${label}不能为空` : ''
  if (Number.isFinite(maxLength) && text.length > maxLength) return `${label}最长 ${maxLength} 字`
  // 格式不合法时用的是后端那句原文（"地址必须以 http:// 或 https:// 开头"），
  // 而不是"格式错误"这种让人不知道该怎么改的话
  if (!EXTERNAL_URL_PATTERN.test(text)) return `${label}必须以 http:// 或 https:// 开头`
  return ''
}

/** 图片/头像/封面字段的预检：可空，允许外链也允许 `/` 开头的站内路径 */
export const checkImageUrl = (value, label, { maxLength } = {}) => {
  const text = rawText(value)
  if (!text) return ''
  if (Number.isFinite(maxLength) && text.length > maxLength) return `${label}最长 ${maxLength} 字`
  if (!IMAGE_URL_PATTERN.test(text)) return `${label}${IMAGE_URL_MESSAGE.replace('图片地址', '')}`
  return ''
}

/**
 * 音频（媒体）地址字段的预检：**必填** + 长度 + `MEDIA_URL` 白名单。
 *
 * 【为什么它不直接复用 checkImageUrl —— 这是本文件里最要紧的一条注释】
 *   两者的规则文本**目前一模一样**（外链 / `/` 开头的站内路径），所以"省一行代码"
 *   的诱惑很大。但不复用的理由是后端自己写下的（`UrlPatterns.MEDIA_URL` 那一段）：
 *     · 名字会误导：拿 `checkImageUrl` 去校验"音频地址"，后来的人会以为
 *       "音乐地址被当成图片地址校验了"，然后花时间查是不是漏了音频格式
 *     · 两者的演化方向不同：图片可能加"只允许图片扩展名"，音频可能收窄成
 *       "只允许 /uploads/music/ 或某个 CDN 域名"。一旦合并，任何一边的调整都会
 *       **同时**改到另一边 —— 而这种连带改不会有任何报错
 *   所以这里是与后端 `MEDIA_URL` / `MEDIA_URL_MESSAGE` 一一对应的第三档，
 *   而不是 `checkImageUrl` 的别名。
 *
 * 【required 的默认值是 true（与 checkExternalUrl 相反），为什么】
 *   音频地址在后端是 `@NotBlank` —— 没有音源的歌在前台放不出任何声音。
 *   而 `checkExternalUrl` 服务的项目 url/repo 是"两个里至少填一个"，
 *   单个字段本来就可空，所以它默认 false。两处默认值不同是照着各自的后端规则来的。
 *
 * @param {string} value    用户输入
 * @param {string} label    出错提示里的字段名（"音频地址" —— 与后端 @NotBlank/@Size
 *                          的 message 主语一致，用户看不出是哪一道拦的）
 * @param {object} options  { maxLength: number, required: boolean }
 * @returns {string} '' 表示通过；否则是给用户看的原因
 */
export const checkMediaUrl = (value, label, { maxLength, required = true } = {}) => {
  const text = rawText(value)
  if (!text) return required ? `${label}不能为空` : ''
  if (Number.isFinite(maxLength) && text.length > maxLength) return `${label}最长 ${maxLength} 字`
  // 裁掉后端那句提示里的主语（"音频地址"），换上调用方给的字段名 ——
  // 与 checkImageUrl 对 IMAGE_URL_MESSAGE 的处理是同一个做法
  if (!MEDIA_URL_PATTERN.test(text)) return `${label}${MEDIA_URL_MESSAGE.replace('音频地址', '')}`
  return ''
}

/**
 * 邮箱格式的预检。
 *
 * 【为什么这里刻意写得**比后端宽**】
 *   后端用的是 Jakarta 的 `@Email`（Hibernate Validator 那套正则，规则很细：
 *   本地部分不能以点开头/结尾、不能连续两个点，域名部分也有自己的规则）。
 *   前端要"完全复刻"它是做不到的（那等于把一份正则实现两遍，还容易做得更严）。
 *   而这层预检的目标只有一个：**拦住一眼就不像邮箱的输入，省一次必然失败的往返**。
 *   所以这里的判断刻意宽松（有 @、@ 两侧非空、域名里有点、没有空白字符）：
 *   · 宁可放过一个后端会拒绝的值 —— 那时后端会返回它的原文，用户照样能得到准确原因
 *   · 也绝不要拦住一个后端**接受**的合法值 —— 那种情况下用户完全没法绕过，
 *     界面上"这明明是个正常邮箱为什么不让保存"是最糟的一种 bug
 *   （空值一律放行：清空邮箱在后端是正当操作，@Email 对 null 与空串都放行。）
 */
export const checkEmail = (value, label, maxLength) => {
  const text = rawText(value)
  if (!text) return ''
  if (Number.isFinite(maxLength) && text.length > maxLength) return `${label}最长 ${maxLength} 字`
  if (/\s/.test(text) || !/^[^@]+@[^@.]+(\.[^@.]+)+$/.test(text)) return `${label}格式不正确`
  return ''
}

/**
 * 状态字段的预检：只允许 0（隐藏）/ 1（显示）。
 * 【为什么显式拒绝而不是"不属于 0/1 就当 1"】静默纠正会让调用方永远发现不了传错值：
 * 界面显示"已保存"，实际效果是"被隐藏了"，用户会以为是显示逻辑坏了。
 * 后端 requireValidStatus 也是直接报错（"状态只能是 0(隐藏) 或 1(显示)"）。
 */
export const checkStatus = (status) =>
  (status === 0 || status === 1) ? '' : '状态只能是 0(隐藏) 或 1(显示)'

/**
 * 项目特有的一条跨字段规则：**在线地址与仓库地址至少要填一个**。
 *
 * 【为什么前端也要拦】这条规则在后端 Service 里（ProjectServiceImpl.
 *   requireAtLeastOneAddress，它跨两个字段，单字段注解表达不了）。
 *   前端拦一道的价值是省一次必然失败的往返；文案与后端一致，
 *   把两个字段名都写出来 —— 只说"地址不能为空"的话，
 *   用户看着表单里两个地址框会不知道说的是哪一个。
 */
export const requireAtLeastOneProjectAddress = (url, repo) =>
  (rawText(url) || rawText(repo)) ? '' : '在线地址和仓库地址至少要填一个，否则项目卡片点不出任何东西'
