// ============================================================
// server/routes/media/[...file].get.ts
//
// 作用：**仅开发环境生效**的媒体路由。把 /media/xxx 映射到仓库根目录
//       static-media/ 下的文件，用流（stream）的方式返回给浏览器。
//
// 【为什么需要它 —— 不是为了生产，而是为了本地开发】
//   生产环境里 /media/ 由服务器上的 Nginx 直接读磁盘提供（见 static-media/README.md），
//   请求根本到不了 Nuxt。但本地 `npm run dev` 时没有 Nginx，
//   如果只有生产有 /media/，开发时首页的背景视频和音乐就会 404 ——
//   也就是"本地打开首页看到一块坏掉的背景"。
//   让 dev 也提供同一个路径，前端代码里的地址才能只有一份（/media/xxx），
//   不存在"本地一套地址、线上另一套"这种最容易漏掉的差异。
//
// 【为什么还要显式判断环境（而不是"反正线上访问不到就留着"）】
//   ① 生产环境的 .output 里如果留着这个路由，一旦 Nginx 的 location /media/
//      配错了（漏配、路径写错、被 location / 抢走），请求就会被转发到 Node，
//      于是应用容器变成为一个"能从磁盘读文件"的服务器 —— 边界被悄悄放宽了。
//      显式返回 404 之后，这种情况表现为"媒体挂了"，而不是"多了一条读取路径"。
//   ② 生产镜像里根本没有 static-media/ 目录（见 .dockerignore），留着也没有意义。
//   `import.meta.dev` 是 Nitro 的编译期标志：build 时会被替换成常量，
//   生产构建里这个分支直接变成"永远返回 404"，同时也让这段代码可以被摇掉。
//
// 【安全】路径穿越防护在 server/utils/mediaFile.ts 里（纯函数，有单测），
//   这里只负责把它抛出的错误翻译成 404 —— **注意不是 500**：
//   对不合法的文件名，回 404 就等于"这里没有这个文件"，
//   不额外告诉对方"你的穿越尝试被识别了"。
//
// 【技术栈与关键字】
//   · Nitro（Nuxt 的服务端引擎）用文件路径定路由：routes/media/[...file].get.ts
//     → GET /media/**；`[...file]` 是 catch-all 参数，能匹配带斜杠的余下路径
//   · h3 的 sendStream()：把 Node 的可读流传给 h3 接管（自动处理连接中断等情况）
//   · createReadStream() 的 start/end 参数：只读文件的某一段，这是 Range 请求的基础
//   · 206 Partial Content / 416 Range Not Satisfiable / 404：见各自的注释
// ============================================================

import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import {
  createError,
  defineEventHandler,
  getRequestHeader,
  getRouterParam,
  setResponseHeader,
  setResponseStatus,
  sendStream,
} from 'h3'
import { parseRangeHeader, resolveMediaFile } from '../../utils/mediaFile'

export default defineEventHandler(async (event) => {
  // ---- 0. 只在开发环境提供：见文件头「为什么还要显式判断环境」 ----
  if (!import.meta.dev) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  }

  // ---- 1. 文件名 → 磁盘路径（不合法直接当"文件不存在"） ----
  let resolved
  try {
    resolved = resolveMediaFile(getRouterParam(event, 'file'))
  } catch {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  }

  // ---- 2. 文件必须真的存在，且必须是普通文件 ----
  // 用 stat 而不是 existsSync：后者在 Node 里已经废弃，而且它区分不了
  // "目录" 和 "文件"（目录也能通过 existsSync，createReadStream 拿到目录会报 EISDIR）
  const info = await stat(resolved.filePath).catch(() => null)
  if (!info?.isFile()) {
    throw createError({ statusCode: 404, statusMessage: '媒体文件不存在，检查 static-media/ 目录' })
  }

  // ---- 3. 通用响应头 ----
  setResponseHeader(event, 'Content-Type', resolved.contentType)
  // Accept-Ranges 告诉浏览器"这个资源支持分段请求"，
  // 视频播放器看到它才会在拖动进度条时发 Range 请求，而不是整段重下
  setResponseHeader(event, 'Accept-Ranges', 'bytes')
  // 开发环境不需要缓存（改完文件刷新就能听到新的），
  // 顺便避免调试时被浏览器缓存骗到；线上的缓存策略由 Nginx 那一层决定
  setResponseHeader(event, 'Cache-Control', 'no-cache')

  // ---- 4. 处理 Range（拖动视频进度条时浏览器会带这个头） ----
  const range = parseRangeHeader(getRequestHeader(event, 'range'), info.size)

  if (range && 'unsatisfiable' in range) {
    // 416：请求的区间超出文件范围。必须带上 Content-Range: bytes */总长，
    // 这是 RFC 7233 的要求，播放器靠它知道真实的文件大小
    setResponseStatus(event, 416)
    setResponseHeader(event, 'Content-Range', `bytes */${info.size}`)
    return ''
  }

  if (range) {
    // 206：只发请求的那一段。注意 end 是**闭区间**（含最后一个字节），
    // 所以长度是 end - start + 1 —— 写成 end - start 会永远少一个字节，
    // 表现为视频偶尔卡一下、音频结尾有杂音，很难查
    setResponseStatus(event, 206)
    setResponseHeader(event, 'Content-Range', `bytes ${range.start}-${range.end}/${info.size}`)
    setResponseHeader(event, 'Content-Length', String(range.end - range.start + 1))

    return sendStream(event, createReadStream(resolved.filePath, { start: range.start, end: range.end }))
  }

  // ---- 5. 普通请求：整个文件 ----
  setResponseHeader(event, 'Content-Length', String(info.size))

  // sendStream 而不是 readFileSync：媒体文件是十几 MB 级的，
  // 整块读进内存既浪费内存又让首字节延迟变高；流是边读边发，客户端能立刻开始播放
  return sendStream(event, createReadStream(resolved.filePath))
})
