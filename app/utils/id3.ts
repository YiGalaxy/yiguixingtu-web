// ============================================================
// app/utils/id3.ts
//
// 作用：从 mp3 文件**开头的那些字节**里，把「歌曲自带的内嵌封面」抠出来。
//
// 【为什么要自己解析二进制，而不是用现成的库】
//   需求是"旋转唱片中间显示这首歌自己的封面图"。封面就藏在 mp3 的 ID3v2 标签里
//   （APIC 帧）。为一个"读一张图"的功能引一个 mp3 解析库，等于为了 200 行逻辑
//   多背一个依赖 + 它的更新节奏；而这段逻辑本身并不复杂，**难的是边界**，
//   边界恰恰是可以用单测钉死的东西 —— 所以自己写 + 写透测试，比引库更划算。
//
// 【这段代码的现状（必须如实说明，不许假装）】
//   本站现在唯一那个音频文件 `static-media/bg-music.mp3` **没有内嵌封面**：
//   它的 ID3v2.4 标签只有 138 字节，里面只有 ffmpeg 写的 TXXX 帧
//   （major_brand / minor_version / compatible_brands / TSSE=Lavf62.12.101），
//   没有 APIC、也没有标题/歌手。**所以线上现在走的一定是回落路径**
//   （用 `cover-1.png`，那个文件也还没上传 → 再退到页面上的占位图案）。
//   这段解析代码的价值在于：**哪天换一个带封面的 mp3，它就该自动生效**。
//   下面的用例都是**按真实帧结构手工造出来的字节数组**，
//   它们能证明"解析逻辑对"，但它们**不能**证明"在一个真实带封面的 mp3 上跑通了"
//   —— 我手上没有那样的文件（这一点写在报告里，不当成已验证的事实）。
//
// 【ID3v2 的字节结构（v2.3 与 v2.4，这两个版本覆盖了几乎全部真实文件）】
//   ┌── 标签头（固定 10 字节）────────────────────────────┐
//   │ 'I' 'D' '3' | 主版本 | 修订号 | 标志位 | 长度(4 字节，syncsafe) │
//   ├── 扩展头（标志位 bit6 置位时才有，可选）──────────────┤
//   ├── 一帧一帧排下去 ────────────────────────────────┤
//   │ 帧头 10 字节：帧 ID(4) | 帧长度(4) | 帧标志(2)           │
//   │ 帧体：APIC 帧的帧体 = 编码(1) + MIME(到 0x00) + 图片类型(1)     │
//   │                    + 描述(按编码决定终止符) + 图片数据          │
//   └──────────────────────────────────────────────┘
//
// 【两个最容易写错的地方（都有用例专门盯着）】
//   ① **syncsafe 整数**：标签长度与 v2.4 的帧长度，每个字节**只用低 7 位**
//      （最高位永远为 0）。这不是普通的 32 位大端整数 —— 把它当普通整数读，
//      只要长度里有一个字节 >= 0x80（也就是 > 127）就会算出天文数字，
//      表现为"帧全部跑到标签外面去了"，于是永远找不到封面。
//      【注意 v2.3 的**帧**长度是普通 32 位大端**，只有 v2.4 才是 syncsafe】——
//      这一条是 v2.3/v2.4 之间最经典的差异，写死成一种两个版本就必坏一个。
//   ② **描述字段的终止符要按编码宽度跳过**：编码 1/2 是 UTF-16，
//      终止符是**两个** 0x00，而且必须**按 2 字节对齐**去找。
//      如果偷懒用"找到第一个 0x00"，就会撞上 UTF-16 字符里的那个 0 字节
//      （UTF-16BE 的 ASCII 字符第一个字节就是 0x00；UTF-16LE 的 ASCII 字符第二个字节是 0x00），
//      于是"图片数据"从一个错误的位置开始读 —— 结果是一个**看起来有内容、
//      但图片打不开**的坏 Blob（而且不报错，最难查）。
//
// 【技术栈与关键字】
//   · Uint8Array / .subarray()：subarray 是**视图**（共享同一段内存），不复制数据；
//     对十几 KB 的图片数据来说这正好，最后 new Blob([...]) 那一步才会真正复制。
//   · DataView 用不上：这里全是按字节读，直接下标访问最清楚。
//   · Blob：浏览器里的二进制大对象，`new Blob([bytes], { type })` 之后
//     可以由调用方 `URL.createObjectURL()` 变成 <img src> 能用的地址。
//   · 全程**不抛异常**：任何"读不通"的情况都返回 null（理由见下）。
// ============================================================

/** 标签头固定 10 字节：ID3 + 版本(2) + 标志(1) + 长度(4)…… 实际是 3+1+1+1+4 */
const TAG_HEADER_SIZE = 10
/** 帧头固定 10 字节：ID(4) + 长度(4) + 标志(2) */
const FRAME_HEADER_SIZE = 10
/** APIC = Attached Picture（附属图片）帧的 ID */
const FRAME_ID_APIC = 'APIC'
/** 图片类型 3 = 正面封面（front cover）。同一首歌可能带多张图，优先取这张 */
const PICTURE_TYPE_FRONT_COVER = 3
/** 描述字段只用来做说明，超过这个长度就丢掉（防止畸形文件让我们构造一个巨大的字符串） */
const MAX_DESCRIPTION_BYTES = 256

/**
 * 把外面传进来的各种"二进制形态"统一成 Uint8Array。
 *
 * 【为什么要容错这么多种】调用方可能是：
 *   · `await fetch(...).arrayBuffer()` → ArrayBuffer
 *   · `await $fetch(..., { responseType: 'arrayBuffer' })` → ArrayBuffer
 *   · Node 里 `fs.readFile()` → Buffer（它本身是 Uint8Array 的子类）
 *   · 测试里直接 `new Uint8Array([...])`
 * 统一入口之后，下游只需要处理一种形态；而"传进来的根本不是二进制"（比如接口
 * 出错时返回了一个 JSON 对象）也在这里被挡住，**返回 null 而不是把解析器炸掉**。
 */
export const toUint8Array = (input) => {
  if (input instanceof Uint8Array) return input                       // Buffer 也走这条
  if (typeof ArrayBuffer !== 'undefined' && input instanceof ArrayBuffer) return new Uint8Array(input)
  // 其它 TypedArray / DataView：按它自己的 byteOffset 与 byteLength 取窗口，
  // 不能直接 new Uint8Array(input.buffer) —— 那会连带看到同一块内存里的别的数据
  if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
  }
  return null
}

/**
 * 读 4 字节的 **syncsafe** 整数（ID3v2 的关键概念）。
 *
 * syncsafe 的意思是"每字节只用低 7 位"：
 *   value = (b0 & 0x7F) << 21 | (b1 & 0x7F) << 14 | (b2 & 0x7F) << 7 | (b3 & 0x7F)
 * 为什么要这么设计：mp3 里出现 0xFF 后跟 0xE0 以上的字节会被播放器当成帧同步字，
 * 所以标签里要避免任何字节 >= 0x80 —— 于是整数也被拆成 7 位一段。
 *
 * @returns {number} 读到的值；**越界（不足 4 字节）返回 -1**，
 *   让调用方用一个明显不合法的值去走"文件被截断"那条路，而不是读到 undefined 之后算出 NaN
 */
export const readSyncsafe = (bytes, offset) => {
  if (!bytes || offset < 0 || offset + 4 > bytes.length) return -1
  return ((bytes[offset] & 0x7f) << 21)
    | ((bytes[offset + 1] & 0x7f) << 14)
    | ((bytes[offset + 2] & 0x7f) << 7)
    | (bytes[offset + 3] & 0x7f)
}

/** 读 4 字节的普通大端无符号整数（v2.3 的**帧长度**用的是这种） */
export const readUint32 = (bytes, offset) => {
  if (!bytes || offset < 0 || offset + 4 > bytes.length) return -1
  // >>> 0 把它变成无符号 32 位：不加的话最高位置位的长度会变成负数
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0
}

/**
 * 反"非同步"处理（de-unsynchronisation）。
 *
 * 【它解决什么问题】编码器为了保证标签里不出现"看起来像 mp3 帧头"的字节序列，
 * 会把每个 `0xFF` 后面插一个 `0x00`。读的时候必须把插入的 `0x00` 去掉，
 * 否则帧长度、MIME、图片数据全部会错位。
 * 【为什么这是必需的一步而不是可选项】带这个标志的文件不常见，但一旦遇到，
 * 不做反处理的后果是"封面永远读不出来"，而**不会有任何报错**。
 *
 * 【实现范围，如实说明】这里实现的是 v2.3 那种"整个标签体一起做"的非同步
 * （标签头标志位 bit7）。v2.4 把非同步下沉到"每帧"，标志位在帧头里 ——
 * 那种情况在下面的帧循环里单独判断；**两种路径都没有在真实文件上验证过**
 * （手上这个 mp3 不带非同步标志）。
 */
export const deUnsynchronise = (bytes) => {
  const out = new Uint8Array(bytes.length)
  let write = 0
  for (let read = 0; read < bytes.length; read++) {
    out[write++] = bytes[read]
    // 0xFF 后面紧跟的 0x00 是编码器插进去的，丢掉它
    if (bytes[read] === 0xff && bytes[read + 1] === 0x00) read++
  }
  return out.subarray(0, write)
}

/** 按 ISO-8859-1（每个字节 = 一个字符）解码。MIME 类型、老标签里的字段用它 */
const decodeLatin1 = (bytes) => {
  let out = ''
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i])
  return out
}

/** 按 UTF-16 解码（手工做，不依赖 TextDecoder 对 utf-16be 的支持程度） */
const decodeUtf16 = (bytes, littleEndian) => {
  let start = 0
  let le = littleEndian
  // BOM（字节序标记）优先于调用方的判断：0xFF 0xFE = 小端，0xFE 0xFF = 大端
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) { le = true; start = 2 }
  else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) { le = false; start = 2 }
  let out = ''
  // 按 2 字节一组拼码元；落单的最后一字节丢弃（畸形文件里很常见，不值得为它抛错）
  for (let i = start; i + 1 < bytes.length; i += 2) {
    out += String.fromCharCode(le ? (bytes[i + 1] << 8) | bytes[i] : (bytes[i] << 8) | bytes[i + 1])
  }
  return out
}

/**
 * 按「文本编码字节」解码一段文本。
 * ID3v2 的编码字节（帧体的第一个字节）是固定的四种：
 *   0 = ISO-8859-1  1 = UTF-16（带 BOM）  2 = UTF-16BE（无 BOM）  3 = UTF-8
 */
const decodeText = (bytes, encoding) => {
  const data = bytes.subarray(0, MAX_DESCRIPTION_BYTES)
  switch (encoding) {
    case 0: return decodeLatin1(data)
    case 1: return decodeUtf16(data, true)   // 真值以 BOM 为准
    case 2: return decodeUtf16(data, false)
    case 3:
      // UTF-8 手工解码不值当（多字节序列的合法性检查又长又容易写错），
      // 交给平台的 TextDecoder；万一环境没有它，退化成"读不出来"（空串）而不是崩
      try {
        return new TextDecoder('utf-8', { fatal: false }).decode(data)
      } catch {
        return ''
      }
    default: return ''
  }
}

/**
 * 找描述字段的**终止符**位置。
 *
 * 【这是整个文件里最容易写错的一段，单独抽出来就是为了能一眼看明白】
 *   · 编码 0 / 3：终止符是**一个** 0x00
 *   · 编码 1 / 2：终止符是**两个连续的** 0x00 —— 而且要从描述起点开始**按 2 字节步进**去找。
 *     按 2 字节步进 + 两个字节一起判，两件事缺一不可：
 *       只判"两个 0x00"但不按步进 → 会把某个字符跨一半的地方当成终止符
 *       按步进但只判"第一个字节是 0" → 会把 UTF-16 里那种"高字节是 0"的字符当成终止符
 * @returns {number} 终止符的起始下标；没找到返回 -1（调用方按"帧畸形"处理）
 */
export const findDescriptionEnd = (bytes, start, encoding) => {
  if (encoding === 1 || encoding === 2) {
    for (let i = start; i + 1 < bytes.length; i += 2) {
      if (bytes[i] === 0x00 && bytes[i + 1] === 0x00) return i
    }
    return -1
  }
  // 单字节编码：indexOf 的第二个参数是"从哪里开始找"
  return bytes.indexOf(0x00, start)
}

/** 终止符本身占几个字节（切图片数据时要跳过去） */
const terminatorLength = (encoding) => ((encoding === 1 || encoding === 2) ? 2 : 1)

/**
 * 解析一个 APIC 帧的**帧体**。
 *
 * 帧体结构：编码(1) | MIME(到 0x00) | 图片类型(1) | 描述(按编码的终止符) | 图片数据(到帧尾)
 *
 * @returns {null | { mimeType: string, pictureType: number, description: string, picture: Uint8Array }}
 *   任何一步读不通都返回 null（**不抛异常**）
 */
export const parseApicFrame = (body) => {
  if (!body || body.length < 4) return null

  const encoding = body[0]
  let cursor = 1

  // ---- MIME 类型：ISO-8859-1，以 0x00 结尾（例如 "image/jpeg"）----
  const mimeEnd = body.indexOf(0x00, cursor)
  if (mimeEnd < 0) return null
  const mimeType = decodeLatin1(body.subarray(cursor, mimeEnd))
  cursor = mimeEnd + 1

  // ---- 图片类型：1 字节（0=其它, 3=正面封面, 4=背面封面 ……）----
  if (cursor >= body.length) return null
  const pictureType = body[cursor]
  cursor += 1

  // ---- 描述：跳过它，别把它当图片数据（见文件头 ②）----
  const descEnd = findDescriptionEnd(body, cursor, encoding)
  if (descEnd < 0) return null
  const description = decodeText(body.subarray(cursor, descEnd), encoding)
  const pictureStart = descEnd + terminatorLength(encoding)

  // 描述之后必须有真正的图片数据，否则这个帧是空的（畸形文件里很常见）
  if (pictureStart >= body.length) return null

  return { mimeType, pictureType, description, picture: body.subarray(pictureStart) }
}

/**
 * 【本文件的主入口】从 mp3 的**开头一段字节**里取出内嵌封面。
 *
 * 用法：
 *   const head = await $fetch('/media/bg-music.mp3',
 *     { headers: { Range: 'bytes=0-131071' }, responseType: 'arrayBuffer' })
 *   const cover = parseId3v2Cover(head)        // null = 没有封面
 *   if (cover) img.src = URL.createObjectURL(cover.blob)
 *
 * @param {ArrayBuffer|Uint8Array|null|undefined} input 文件开头的一段字节
 * @returns {null | { blob: Blob, mimeType: string, pictureType: number, description: string, bytes: Uint8Array }}
 *   · 没有 ID3 / 没有 APIC / 标签被截断 / 非图片 MIME / 输入不是二进制 → **一律 null，绝不抛异常**
 *
 * 【为什么"不抛异常"是硬要求】调用它的地方是页面上一个"锦上添花"的动作
 * （读不到就用回落图）。如果它能抛，表现就是**整个音乐页白屏** ——
 * 而它最坏的情况本来只该是"封面用回落的"。所以下面的每一个"读不通"都变成 return null。
 *
 * 【多个 APIC 怎么办】优先 `pictureType === 3`（front cover，规范里的"正面封面"），
 * 没有就取**第一个可用的**。一个文件里同时带正面封面 + 歌手照 + 乐队照很常见，
 * 随机取一个的表现是"同一首歌有时显示艺人照片"，所以要按类型挑，而不是"谁先出现用谁"。
 *
 * 【非图片 MIME 怎么办】只要 `image/` 开头的。APIC 里出现 `application/octet-stream`
 * 之类的畸形值在真实文件里确实有，把它塞进 `<img>` 只会得到一个破图 ——
 * 宁可当它不存在（回落到封面图），也不要让用户看一个破图图标。所以是**跳过**它继续找下一帧。
 */
export const parseId3v2Cover = (input) => {
  const bytes = toUint8Array(input)
  if (!bytes || bytes.length < TAG_HEADER_SIZE) return null

  // ---- 1. 标签头 ----
  // 前三个字节必须是 'I' 'D' '3'（0x49 0x44 0x33）。不是就说明这个文件没有 ID3v2 标签
  if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return null
  const majorVersion = bytes[3]
  // v2.3 / v2.4 之外一律不处理：v2.2 的帧头是 3 字节 ID + 3 字节长度（结构不同），
  // 硬拿 v2.3 的规则去读会读出乱七八糟的帧 —— 不如老实返回 null（表现只是"没有封面"）
  if (majorVersion !== 3 && majorVersion !== 4) return null

  const flags = bytes[5]
  const tagSize = readSyncsafe(bytes, 6)
  if (tagSize <= 0) return null

  // ---- 2. 把标签体切出来 ----
  // 【关键：拿"能读到的长度"和"标签声称的长度"取小】
  //   我们只请求了文件开头 128 KiB，如果标签比这还大（或者文件被截断），
  //   `TAG_HEADER_SIZE + tagSize` 会超出缓冲区。不夹这一刀的话，
  //   后面每个下标访问都会读到 undefined，算出来的帧偏移全是 NaN ——
  //   结果是"要么读不出、要么读出一个越界的 subarray"，而不是一条清晰的"被截断了"。
  const tagEnd = Math.min(TAG_HEADER_SIZE + tagSize, bytes.length)
  let body = bytes.subarray(TAG_HEADER_SIZE, tagEnd)

  // 标签级的非同步（v2.3 的写法）：先把插入的 0x00 去掉，否则后面全部错位
  if (flags & 0x80) body = deUnsynchronise(body)

  // ---- 3. 跳过扩展头（标志位 bit6）----
  // 两个版本的"扩展头长度"含义不同，这也是必须区分版本的原因之一：
  //   v2.3：长度 4 字节普通整数，且**不包含自己** → 一共跳过 4 + size
  //   v2.4：长度 4 字节 syncsafe，**包含自己** → 一共跳过 size
  let offset = 0
  if (flags & 0x40) {
    const extSize = (majorVersion === 4) ? readSyncsafe(body, 0) : readUint32(body, 0)
    if (extSize < 0) return null
    offset = (majorVersion === 4) ? extSize : extSize + 4
    if (offset >= body.length) return null
  }

  // ---- 4. 一帧一帧往下走，收集 APIC ----
  const pictures = []
  while (offset + FRAME_HEADER_SIZE <= body.length) {
    // 帧 ID：4 个 ASCII 字符。标签末尾通常是一段 0x00 填充，
    // 遇到非 [A-Z0-9] 的内容就说明"帧区结束了"，直接收工（这也是防死循环的一道保险）
    const frameId = decodeLatin1(body.subarray(offset, offset + 4))
    if (!/^[A-Z0-9]{4}$/.test(frameId)) break

    // 帧长度：v2.4 是 syncsafe，v2.3 是普通大端 —— 见文件头关于这个差异的说明
    const frameSize = (majorVersion === 4) ? readSyncsafe(body, offset + 4) : readUint32(body, offset + 4)
    // size <= 0：坏帧。不 break 的话这里会原地打转（offset 不前进 = 死循环）
    if (frameSize <= 0) break

    const frameFlags = (body[offset + 8] << 8) | body[offset + 9]
    const bodyStart = offset + FRAME_HEADER_SIZE
    const bodyEnd = bodyStart + frameSize
    // 帧体越界 = 标签被截断（我们就只取了开头一段）。已经收集到的封面照样返回，
    // 剩下的不再读 —— 因为后面每一帧的起点都不可信了
    if (bodyEnd > body.length) break

    let frameBody = body.subarray(bodyStart, bodyEnd)

    // v2.4 帧级标志（低字节）：bit0 = 数据长度指示器（帧体开头多 4 字节），
    // bit1 = 该帧单独做了非同步。两个都按规范处理掉，否则帧体会整体错位
    if (majorVersion === 4) {
      if (frameFlags & 0x0001) frameBody = frameBody.subarray(4)
      if (frameFlags & 0x0002) frameBody = deUnsynchronise(frameBody)
    }

    if (frameId === FRAME_ID_APIC) {
      const parsed = parseApicFrame(frameBody)
      // 只收图片：非 image/ 的一律跳过（见函数头注释里"非图片 MIME 怎么办"）
      if (parsed && /^image\//i.test(parsed.mimeType.trim())) pictures.push(parsed)
    }

    offset = bodyEnd
  }

  if (pictures.length === 0) return null

  // ---- 5. 挑一张：优先正面封面，否则第一张可用的 ----
  const chosen = pictures.find(p => p.pictureType === PICTURE_TYPE_FRONT_COVER) ?? pictures[0]

  // Blob 的构造理论上也可能失败（老环境没有 Blob），所以也套一层 —— 这一层的意义是
  // "读封面失败"永远不会升级成"页面白屏"
  try {
    return {
      blob: new Blob([chosen.picture], { type: chosen.mimeType.trim() }),
      mimeType: chosen.mimeType.trim(),
      pictureType: chosen.pictureType,
      description: chosen.description,
      bytes: chosen.picture,
    }
  } catch {
    return null
  }
}
