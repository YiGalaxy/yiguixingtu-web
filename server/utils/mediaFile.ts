// ============================================================
// server/utils/mediaFile.ts
//
// 作用：给「仅开发环境生效」的媒体路由（server/routes/media/[...file].get.ts）
//       提供两件纯逻辑 —— ① 把请求里的文件名安全地解析成磁盘路径
//       ② 解析 HTTP Range 请求头。
//
// 【为什么把这两件事抽成纯函数】
//   它们是这个路由里唯一会出错、而且出错最危险的两个人地方：
//     · 路径解析写漏一步就是**路径穿越**（/media/../../etc/passwd 能读到系统文件）
//     · Range 解析写错会让视频拖动进度条时整个文件重下，或者返回越界的数据
//   这两件事都不需要 HTTP 环境就能验证（给一个字符串、看返回什么），
//   抽出来之后可以直接用单测钉死；留在 handler 里就只能靠"起一个服务器再发请求"来测。
//
// 【技术栈与关键字】
//   · node:path 的 resolve/join 只做字符串拼接与规范化，**它不会阻止 ../**，
//     所以穿越防护必须自己写（下面每一步都在做这件事）。
//   · extname() 取扩展名；basename() 取最后一段路径 —— 用它来判断
//     "传进来的到底是不是一个纯文件名"。
//   · Range 请求头（HTTP/1.1 RFC 7233）：`bytes=开始-结束`，
//     结束可以省略（`bytes=100-` 表示到文件末尾）；服务器用 206 Partial Content
//     响应，浏览器拖动进度条时才不用把整个视频重下。
// ============================================================

import { basename, extname, resolve, sep } from 'node:path'

/** 媒体文件在仓库根目录的哪个子目录（不在 public/ 里，见 static-media/README.md） */
export const MEDIA_DIR_NAME = 'static-media'

/**
 * 允许的文件扩展名白名单。
 * 【为什么是白名单而不是黑名单】黑名单永远列不全（.jsp / .php / .env / 各种大小写变形）；
 *   这里本来就只有两个音视频文件，直接列出允许的两种最省心。
 * 【为什么统一转小写再比】Windows / macOS 上 `BG-MUSIC.MP3` 是同一个文件，
 *   而 Linux 上不是 —— 转小写之后三端行为一致，不会出现"本机好好的、服务器 404"。
 */
export const ALLOWED_MEDIA_EXTENSIONS = Object.freeze(['.mp4', '.mp3'])

/** 扩展名 → Content-Type。写死映射而不是靠第三方库推断，避免多一个依赖 */
const CONTENT_TYPES = Object.freeze({
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
})

/** 默认的媒体目录（仓库根目录下的 static-media/），允许调用方覆盖，方便测试 */
export const defaultMediaDir = () => resolve(process.cwd(), MEDIA_DIR_NAME)

/**
 * 把「请求里的文件名」解析成「磁盘上的文件路径」。
 *
 * 安全上做四件事（每一件都对应一种真实的攻击形态）：
 *   ① 只接受纯文件名：/ 或 \ 出现即拒绝 —— 挡掉 `a/b.mp4` 这种"想进子目录"的请求
 *   ② 拒绝 `..` 与隐藏文件（以 . 开头）—— 挡掉 `../../etc/passwd`、`.env`
 *   ③ 扩展名必须在白名单里 —— 挡掉"换个后缀读别的文件"
 *   ④ 【最后一道】解析出来的绝对路径必须仍在这个目录里面
 *      （用 resolve 展开后比较前缀）—— 前三条都是"事先判形状"，
 *      这一条是"判结果"，就算前三条哪天被改松了，它仍然拦得住
 *
 * @param {string} name 路由参数里的文件名（如 bg-music.mp3）
 * @param {string} [baseDir] 媒体目录，默认仓库根目录下的 static-media/
 * @returns {{ filePath: string, fileName: string, contentType: string }}
 * @throws {Error} 名字不合法时抛错，由路由翻译成 404
 */
export const resolveMediaFile = (name, baseDir = defaultMediaDir()) => {
  if (typeof name !== 'string' || !name) {
    throw new Error('[media] 缺少文件名')
  }

  // ① URL 里可能带 %2e%2e%2f 这类编码；先解码一次，让后面的判断看到的是真实字符。
  //    解码失败（比如残缺的 %E0）说明这不是一个正常文件名，直接拒绝。
  let decoded
  try {
    decoded = decodeURIComponent(name)
  } catch {
    throw new Error('[media] 文件名编码非法')
  }

  // ② 只接受纯文件名。\ 也要挡：Windows 上它是路径分隔符，而 Linux 上是普通字符，
  //    不挡的话同一个请求在两台机器上的行为会不一样。
  if (decoded.includes('/') || decoded.includes('\\')) {
    throw new Error('[media] 文件名不能包含路径分隔符')
  }
  if (decoded.includes('\0')) {
    // 空字节在某些系统调用里会截断字符串（"bg.mp3\0.png" 之类的把戏）
    throw new Error('[media] 文件名包含非法字符')
  }
  if (decoded.startsWith('.') || decoded.includes('..')) {
    throw new Error('[media] 拒绝隐藏文件与上跳路径')
  }

  // ③ 扩展名白名单（统一小写比较，见 ALLOWED_MEDIA_EXTENSIONS 的注释）
  //    没有扩展名时 extname 返回空串，同样落到"不在白名单"这一条上，不需要单独特判
  const ext = extname(decoded).toLowerCase()
  const contentType = CONTENT_TYPES[ext]
  if (!contentType) {
    throw new Error(`[media] 不允许的扩展名：${ext || '(无扩展名)'}`)
  }

  const root = resolve(baseDir)
  const filePath = resolve(root, basename(decoded))

  // ④ 最后一道：解析结果必须落在 root 里面。
  //    比较时补上 sep：否则 `/var/www/media-secret` 也会被当成"在 /var/www/media 里"。
  if (filePath !== root && !filePath.startsWith(root + sep)) {
    throw new Error('[media] 目标不在媒体目录内')
  }

  return { filePath, fileName: basename(decoded), contentType }
}

/**
 * 解析 HTTP `Range` 请求头。
 *
 * @param {string|undefined} rangeHeader 请求头原文（如 `bytes=0-99`）
 * @param {number} size 文件总字节数
 * @returns {null | { start: number, end: number } | { unsatisfiable: true }}
 *   · null —— 没有 Range 头（或格式不认识）：调用方按普通 200 返回整个文件
 *   · { start, end } —— 返回 206，只发这一段
 *   · { unsatisfiable: true } —— 语法对但要的数据不存在（起点越界）：返回 416
 */
export const parseRangeHeader = (rangeHeader, size) => {
  if (typeof rangeHeader !== 'string' || !rangeHeader.trim() || !Number.isFinite(size) || size <= 0) {
    return null
  }

  // 只支持单区间 `bytes=a-b`。多区间（bytes=0-9,20-29）在浏览器里几乎用不到，
  // 而且 multipart/byteranges 的响应体拼装麻烦得多 —— 当作"没有 Range"处理，
  // 客户端拿到完整的 200 也能正常播放，不会出错。
  const matched = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim())
  if (!matched) return null

  const [, rawStart, rawEnd] = matched
  // `bytes=-500` 这种"最后 500 字节"的写法（两个数字都空则整个头无效）
  if (rawStart === '' && rawEnd === '') return null

  let start
  let end
  if (rawStart === '') {
    // 后缀语法：取最后 N 字节
    const suffixLength = Number(rawEnd)
    if (suffixLength <= 0) return { unsatisfiable: true }
    start = Math.max(0, size - suffixLength)
    end = size - 1
  } else {
    start = Number(rawStart)
    end = rawEnd === '' ? size - 1 : Number(rawEnd)
  }

  // 结束位置超过文件末尾是**正常的**（浏览器习惯要"整段"），按文件末尾截断即可；
  // 但起点越界就是真的没数据可给，得让调用方回 416，否则会返回一个空 206，
  // 有些播放器会因此判定视频损坏。
  if (start >= size) return { unsatisfiable: true }
  if (end >= size) end = size - 1
  if (end < start) return { unsatisfiable: true }

  return { start, end }
}
