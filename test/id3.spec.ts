// @vitest-environment node
// =====================================================================
// test/id3.spec.ts
//
// 作用：守住「从 mp3 开头那段字节里抠出内嵌封面」（`app/utils/id3.ts`）的每一条边界。
//
// 【为什么要"按真实帧结构造字节"，而不是给个假对象】
//   这段代码的全部难度都在**字节偏移**上：syncsafe 长度、10 字节帧头、
//   MIME 的 0x00 结尾、描述字段按编码用 1 个还是 2 个字节的终止符。
//   拿一个"看起来像"的假对象去测，等于把最容易错的那部分（偏移对不对）整个绕过去了
//   —— 测出来的绿是假的。所以下面用一个很小的构造器把 ID3v2 标签**真正拼出来**
//   （标签头 + 帧头 + 帧体，每一部分都是真实格式），再交给解析器。
//
// 【本站的现实（不许美化）】`static-media/bg-music.mp3` 里的 ID3v2.4 标签**没有 APIC**
//   （只有 ffmpeg 写的 TXXX），所以线上现在走的一定是"没有内嵌封面 → 回落图"那条路。
//   下面第 5 条用例就是照这个真实形状造的（有 ID3、没有 APIC）。
//   这些用例能证明"解析逻辑按规范写对了"，**不能**证明"在一个真实带封面的 mp3 上跑通了"
//   —— 手上没有那样的文件（报告里也这么写）。
//
// 【为什么用 node 环境】被测的是纯函数（输入字节、输出 Blob），不需要 Vue 与 Nuxt。
// =====================================================================

import { describe, expect, it } from 'vitest'
import {
  parseId3v2Cover,
  parseApicFrame,
  readSyncsafe,
  readUint32,
  deUnsynchronise,
  findDescriptionEnd,
  toUint8Array,
} from '../app/utils/id3'

// ---------------------------------------------------------------
//  造字节的小工具（只做拼装，不带任何"智能"）
// ---------------------------------------------------------------

/** 把若干段 Uint8Array 拼成一段 */
const concat = (...parts) => {
  const total = parts.reduce((sum, p) => sum + p.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const p of parts) { out.set(p, offset); offset += p.length }
  return out
}

/** ASCII / UTF-8 字符串 → 字节（帧 ID、MIME 用得到；不引 TextEncoder 是为了少一个环境依赖） */
const ascii = (text) => new Uint8Array([...text].map(c => c.charCodeAt(0) & 0xff))

/** 4 字节普通大端整数（v2.3 的帧长度用这种） */
const u32 = (n) => new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff])

/** 2 字节大端（帧标志） */
const u16 = (n) => new Uint8Array([(n >>> 8) & 0xff, n & 0xff])

/**
 * 4 字节 **syncsafe** 整数（每字节只用低 7 位）—— 标签长度与 v2.4 帧长度用这种。
 * 【为什么要显式写这个编码器】用 u32 去造长度、再用 readSyncsafe 去读，
 * 就是"两边一起错、测试还是绿的"：只要长度里有一个字节 >= 0x80（即 > 127），
 * syncsafe 与普通大端的结果就完全不同。所以编码器也必须是真的。
 */
const syncsafe = (n) => new Uint8Array([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f])

/** 一帧：帧 ID(4) + 长度(4) + 标志(2) + 帧体 */
const frame = (id, body, { version = 4, flags = 0 } = {}) =>
  concat(ascii(id), version === 4 ? syncsafe(body.length) : u32(body.length), u16(flags), body)

/**
 * APIC 的帧体：编码(1) + MIME(到 0x00) + 图片类型(1) + 描述(含终止符) + 图片数据。
 * `descriptionBytes` 由调用方给**完全展开的字节**（包含终止符）——
 * 因为"终止符占几个字节、要不要对齐"正是被测代码最容易错的地方，
 * 这里如果替它算好，用例就测不出问题了。
 */
const apicBody = ({ encoding = 3, mime = 'image/png', pictureType = 3, descriptionBytes = new Uint8Array([0]), picture }) =>
  concat(new Uint8Array([encoding]), ascii(mime), new Uint8Array([0]), new Uint8Array([pictureType]), descriptionBytes, picture)

/** UTF-8 描述 + 单字节终止符（编码 3） */
const utf8Desc = (text) => concat(ascii(text), new Uint8Array([0]))

/** UTF-16LE 描述 + 双字节终止符（编码 1，带 BOM） */
const utf16leDesc = (text) => {
  const body = new Uint8Array(text.length * 2)
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    body[i * 2] = code & 0xff
    body[i * 2 + 1] = (code >> 8) & 0xff
  }
  return concat(new Uint8Array([0xff, 0xfe]), body, new Uint8Array([0, 0]))
}

/** UTF-16BE 描述 + 双字节终止符（编码 2，无 BOM） */
const utf16beDesc = (text) => {
  const body = new Uint8Array(text.length * 2)
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    body[i * 2] = (code >> 8) & 0xff
    body[i * 2 + 1] = code & 0xff
  }
  return concat(body, new Uint8Array([0, 0]))
}

/** 整个标签：'ID3' + 版本 + 修订 + 标志 + 长度(syncsafe) + 帧区 */
const id3Tag = (frames, { version = 4, flags = 0, sizeOverride } = {}) =>
  concat(ascii('ID3'), new Uint8Array([version, 0, flags]), syncsafe(sizeOverride ?? frames.length), frames)

/**
 * 一张假的 PNG：**长度故意超过 127 字节**（200 字节）。
 * 【为什么长度要挑这个值】syncsafe 与普通大端只在"某个字节 >= 0x80"时才分道扬镳，
 * 200 的 syncsafe 编码是 00 00 01 48（4 字节），普通大端也是 00 00 00 C8 —— 数值不同。
 * 所以只要图片数据有 200 字节，凡是把 syncsafe 当普通大端读的实现都会立刻错位、读不出封面。
 */
const PNG = new Uint8Array(200).map((_, i) => (i < 8 ? [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a][i] : i & 0xff))

/** 把 Blob 读回字节，用于和原始图片数据逐字节比对 */
const blobBytes = async (blob) => new Uint8Array(await blob.arrayBuffer())

/** 帧头的固定长度（4 字节 ID + 4 字节长度 + 2 字节标志）：断言里要用到时写名字比写 10 清楚 */
const FRAME_HEADER_LENGTH = 10

// ===============================================================

describe('ID3 解析 · 基础工具', () => {
  it('readSyncsafe_should按每字节低 7 位拼（不是普通大端整数）', () => {
    // 200 = 0b1100_1000 → 7 位分组后是 1 和 72 → 字节写作 00 00 01 48
    expect(readSyncsafe(new Uint8Array([0x00, 0x00, 0x01, 0x48]), 0)).toBe(200)
    // 0x7F 每字节都满：syncsafe 读出来是 0x0FFFFFFF，普通大端读出来是 0x7F7F7F7F
    expect(readSyncsafe(new Uint8Array([0x7f, 0x7f, 0x7f, 0x7f]), 0)).toBe(268435455)
  })

  it('readSyncsafe_should把最高位的脏数据掩掉，而不是算出一个天文数字', () => {
    expect(readSyncsafe(new Uint8Array([0x80, 0x00, 0x00, 0x01]), 0)).toBe(1)
  })

  it('readSyncsafe / readUint32_should在越界时返回 -1（让调用方走"文件被截断"那条路）', () => {
    expect(readSyncsafe(new Uint8Array([1, 2, 3]), 0)).toBe(-1)
    expect(readUint32(new Uint8Array([1, 2, 3]), 0)).toBe(-1)
    expect(readUint32(new Uint8Array([1, 2, 3]), 1)).toBe(-1)
  })

  it('readUint32_should按无符号大端读（最高位置位的长度不能变成负数）', () => {
    expect(readUint32(new Uint8Array([0x00, 0x00, 0x00, 0xc8]), 0)).toBe(200)
    expect(readUint32(new Uint8Array([0xff, 0xff, 0xff, 0xff]), 0)).toBe(4294967295)
  })

  it('deUnsynchronise_should去掉 0xFF 后面被插进去的 0x00', () => {
    // 编码器为了让标签里不出现"看起来像 mp3 帧头"的字节，会插 0x00；读的时候必须去掉
    const raw = new Uint8Array([0x01, 0xff, 0x00, 0xe0, 0x02, 0xff, 0x00, 0x00])
    expect([...deUnsynchronise(raw)]).toEqual([0x01, 0xff, 0xe0, 0x02, 0xff, 0x00])
  })

  it('toUint8Array_should接住 ArrayBuffer / TypedArray 视图 / 各种非二进制输入', () => {
    const source = new Uint8Array([1, 2, 3, 4, 5, 6])
    expect([...toUint8Array(source)]).toEqual([1, 2, 3, 4, 5, 6])
    expect([...toUint8Array(source.buffer)]).toEqual([1, 2, 3, 4, 5, 6])
    // 视图：只取它自己的窗口，**不能**连带看到同一块内存里的前后数据
    expect([...toUint8Array(new DataView(source.buffer, 2, 3))]).toEqual([3, 4, 5])
    // 非二进制：接口出错时返回的对象、字符串、null …… 一律 null（不是抛异常）
    expect(toUint8Array(null)).toBeNull()
    expect(toUint8Array(undefined)).toBeNull()
    expect(toUint8Array('ID3')).toBeNull()
    expect(toUint8Array({ code: 200, data: null })).toBeNull()
  })

  it('findDescriptionEnd_should按编码找终止符（UTF-16 要按 2 字节对齐找两个 0）', () => {
    // 单字节编码：第一个 0x00 就是终止符
    expect(findDescriptionEnd(new Uint8Array([0x41, 0x42, 0x00, 0x43]), 0, 3)).toBe(2)
    // UTF-16BE 的 'A' 是 00 41：第一个字节就是 0 —— 不能用 indexOf 找单个 0x00
    expect(findDescriptionEnd(new Uint8Array([0x00, 0x41, 0x00, 0x00]), 0, 2)).toBe(2)
    // UTF-16LE 的 'A' 是 41 00：第二个字节是 0 —— 同样不能用 indexOf
    expect(findDescriptionEnd(new Uint8Array([0x41, 0x00, 0x00, 0x00]), 0, 1)).toBe(2)
    // 找不到终止符 → -1（调用方按"帧畸形"处理）
    expect(findDescriptionEnd(new Uint8Array([0x41, 0x42]), 0, 3)).toBe(-1)
  })
})

describe('ID3 解析 · APIC 帧体', () => {
  it('UTF-8 描述_should在描述之后正确切出图片数据', () => {
    const body = apicBody({ encoding: 3, descriptionBytes: utf8Desc('cover'), picture: PNG })
    const parsed = parseApicFrame(body)

    expect(parsed.mimeType).toBe('image/png')
    expect(parsed.pictureType).toBe(3)
    expect(parsed.description).toBe('cover')
    expect([...parsed.picture]).toEqual([...PNG])
  })

  it('UTF-16LE 描述（含 BOM）_should按 2 字节终止符跳过（这是最容易错的一处）', () => {
    // 'A' 在 UTF-16LE 里是 41 00：如果用 indexOf(0x00) 找终止符，会命中 'A' 的第二个字节，
    // 于是图片数据从错误的位置开始读 —— 得到一个"有长度、打不开"的坏 Blob，且不报错
    const body = apicBody({ encoding: 1, descriptionBytes: utf16leDesc('A'), picture: PNG })
    const parsed = parseApicFrame(body)

    expect(parsed.description).toBe('A')
    expect([...parsed.picture]).toEqual([...PNG])
  })

  it('UTF-16BE 描述（无 BOM）_should同样跳过 2 个字节的终止符', () => {
    const body = apicBody({ encoding: 2, descriptionBytes: utf16beDesc('封面'), picture: PNG })
    const parsed = parseApicFrame(body)

    expect(parsed.description).toBe('封面')
    expect([...parsed.picture]).toEqual([...PNG])
  })

  it('描述为空_should仍能从终止符之后开始读图片', () => {
    const body = apicBody({ encoding: 3, descriptionBytes: new Uint8Array([0]), picture: PNG })
    expect([...parseApicFrame(body).picture]).toEqual([...PNG])

    const utf16Empty = apicBody({ encoding: 2, descriptionBytes: new Uint8Array([0, 0]), picture: PNG })
    expect([...parseApicFrame(utf16Empty).picture]).toEqual([...PNG])
  })

  it('畸形帧（没有 MIME 终止符 / 描述后没有图片）_should返回 null 而不是抛异常', () => {
    // 没有 MIME 的 0x00 结尾
    expect(parseApicFrame(new Uint8Array([3, 0x69, 0x6d, 0x67]))).toBeNull()
    // 描述之后一个字节数据都没有
    expect(parseApicFrame(concat(new Uint8Array([3]), ascii('image/png'), new Uint8Array([0, 3, 0])))).toBeNull()
    // 太短
    expect(parseApicFrame(new Uint8Array([3]))).toBeNull()
    expect(parseApicFrame(null)).toBeNull()
  })
})

describe('ID3 解析 · parseId3v2Cover', () => {
  it('正常的 v2.4 标签（UTF-8 描述）_should取出封面 Blob（逐字节一致）', async () => {
    const apic = frame('APIC', apicBody({ encoding: 3, descriptionBytes: utf8Desc('front'), picture: PNG }))
    const tag = concat(id3Tag(apic), new Uint8Array([0xff, 0xfb, 0x90, 0x00]))   // 标签后面才是 mp3 帧

    const cover = parseId3v2Cover(tag)
    expect(cover).not.toBeNull()
    expect(cover.mimeType).toBe('image/png')
    expect(cover.pictureType).toBe(3)
    expect(cover.description).toBe('front')
    expect(cover.blob.type).toBe('image/png')
    expect(cover.blob.size).toBe(PNG.length)
    expect([...await blobBytes(cover.blob)]).toEqual([...PNG])
  })

  it('正常的 v2.3 标签_should也认（帧长度是普通大端，不是 syncsafe）', () => {
    // v2.3 与 v2.4 的**帧长度**编码不同：写死成一种，另一个版本就永远读不出封面 ——
    // 而页面上只是"没有封面"，不会有任何报错
    const apic = frame('APIC', apicBody({ encoding: 2, descriptionBytes: utf16beDesc('x'), picture: PNG }), { version: 3 })
    const tag = id3Tag(apic, { version: 3 })

    const cover = parseId3v2Cover(tag)
    expect(cover).not.toBeNull()
    expect([...cover.bytes]).toEqual([...PNG])
  })

  it('UTF-16 描述的封面_should逐字节一致（跳错一个字节就会被这条抓住）', () => {
    const apic = frame('APIC', apicBody({ encoding: 1, descriptionBytes: utf16leDesc('A'), picture: PNG }))
    const cover = parseId3v2Cover(id3Tag(apic))

    expect(cover.description).toBe('A')
    expect(cover.blob.size).toBe(PNG.length)
    expect([...cover.bytes]).toEqual([...PNG])
  })

  it('没有 ID3 标签（文件直接从 mp3 帧开始）_should返回 null', () => {
    // 0xFF 0xFB 是 mp3 帧同步字：一个没有标签的 mp3 就是这么开头的
    const noTag = concat(new Uint8Array([0xff, 0xfb, 0x90, 0x64]), new Uint8Array(500))

    expect(parseId3v2Cover(noTag)).toBeNull()
  })

  it('有 ID3 但没有 APIC（**本站这个 mp3 的真实形状**）_should返回 null', () => {
    // ffmpeg 写出来的就是这几个 TXXX 帧（major_brand / minor_version / compatible_brands / TSSE），
    // 整个标签只有 138 字节、没有封面、也没有标题歌手 ——
    // 所以线上走的一定是"回落图"那条路（这份断言就是照那个真实形状造的）
    const txxx = (key, value) => frame('TXXX', concat(new Uint8Array([3]), utf8Desc(key), ascii(value)))
    const frames = concat(
      txxx('major_brand', 'isom'),
      txxx('minor_version', '512'),
      txxx('compatible_brands', 'isomiso2avc1mp41'),
      txxx('TSSE', 'Lavf62.12.101'),
    )

    // 先确认这份"假标签"真的不是空的（否则这条用例就是"断言空输入返回 null"，毫无意义）
    expect(frames.length).toBeGreaterThan(50)
    expect(parseId3v2Cover(id3Tag(frames))).toBeNull()
  })

  it('APIC 帧存在但长度被写错（超出标签范围）_should不崩、返回 null', () => {
    // 帧头说这一帧有 5000 字节，实际上只有几十字节 —— 典型的"文件被截断/元数据损坏"。
    // 没有边界检查的实现会读出一段越界的垃圾（或者抛异常），把整个音乐页带崩
    const body = apicBody({ encoding: 3, descriptionBytes: utf8Desc('x'), picture: PNG })
    const brokenFrame = concat(ascii('APIC'), u32(5000), u16(0), body, new Uint8Array([0, 0, 0, 0]))
    const bytes = new Uint8Array(10 + brokenFrame.length)
    bytes.set(ascii('ID3'), 0)
    bytes.set(new Uint8Array([4, 0, 0]), 3)
    // 标签长度故意写成 5000（syncsafe），比真实缓冲区大得多
    bytes.set(syncsafe(5000), 6)
    bytes.set(brokenFrame, 10)

    expect(() => parseId3v2Cover(bytes)).not.toThrow()
    expect(parseId3v2Cover(bytes)).toBeNull()
  })

  it('标签声称的长度比缓冲区大（我们只取了文件开头一段）_should夹到真实长度，不越界读', () => {
    // 【这是线上最常见的一种】调用方只请求了开头 128 KiB 去碰封面。
    // 不夹这一刀的话，后面每个下标都读到 undefined，算出来的偏移全是 NaN
    const apic = frame('APIC', apicBody({ encoding: 3, descriptionBytes: utf8Desc('a'), picture: PNG }))
    const tag = id3Tag(apic, { sizeOverride: 999999 })

    const cover = parseId3v2Cover(tag)
    // 封面帧本身是完整的，所以照样能取出来（被截断的是"标签声称还有更多帧"这件事）
    expect(cover).not.toBeNull()
    expect(cover.blob.size).toBe(PNG.length)
  })

  it('帧长度写成 0_should直接收工（否则会原地打转成死循环）', () => {
    const broken = concat(ascii('APIC'), u32(0), u16(0), ascii('junk'))
    expect(parseId3v2Cover(id3Tag(broken))).toBeNull()
  })

  it('多个 APIC_should优先取 type=3（正面封面），而不是"谁先出现用谁"', () => {
    const artist = frame('APIC', apicBody({ pictureType: 8, descriptionBytes: utf8Desc('artist'), picture: new Uint8Array([1, 1, 1, 1]) }))
    const front = frame('APIC', apicBody({ pictureType: 3, descriptionBytes: utf8Desc('front'), picture: PNG }))

    const cover = parseId3v2Cover(id3Tag(concat(artist, front)))
    // 随机取一张的表现是"同一首歌有时显示艺人照片"，而且很难被当成 bug 报上来
    expect(cover.pictureType).toBe(3)
    expect(cover.blob.size).toBe(PNG.length)
  })

  it('没有 type=3 时_should取第一个可用的图片帧', () => {
    const back = frame('APIC', apicBody({ pictureType: 4, descriptionBytes: utf8Desc('back'), picture: PNG }))

    expect(parseId3v2Cover(id3Tag(back)).pictureType).toBe(4)
  })

  it('非图片 MIME_should跳过它（塞进 <img> 只会得到一个破图）', () => {
    // 一张"图片帧"却写着 application/octet-stream：真实文件里确实有这种畸形值
    const weird = frame('APIC', apicBody({ mime: 'application/octet-stream', descriptionBytes: utf8Desc('x'), picture: PNG }))

    expect(parseId3v2Cover(id3Tag(weird))).toBeNull()

    // 它后面还有一张真图片时，应该用后面那张（跳过而不是整份放弃）
    const good = frame('APIC', apicBody({ descriptionBytes: utf8Desc('ok'), picture: PNG }))
    const cover = parseId3v2Cover(id3Tag(concat(weird, good)))
    expect(cover).not.toBeNull()
    expect(cover.mimeType).toBe('image/png')
  })

  it('扩展头（v2.3 / v2.4 的长度语义不同）_should跳过之后仍能读到封面', () => {
    // 【为什么这条值得测】扩展头是可选的，跳过时的"跳多少字节"两个版本不一样：
    //   v2.3 的长度是普通大端且不包含自己 → 跳 4 + size；v2.4 的是 syncsafe 且包含自己 → 跳 size。
    //   只有一种写法的话，带扩展头的文件会一个封面都读不出来（而且不报错）
    // v2.3：扩展头 10 字节（长度字段写 6 = 它后面还有 6 字节）
    const v23Ext = new Uint8Array([0x00, 0x00, 0x00, 0x06, 0, 0, 0, 0, 0, 0])
    const v23Body = concat(v23Ext, frame('APIC', apicBody({ picture: PNG }), { version: 3 }))
    const v23Tag = concat(ascii('ID3'), new Uint8Array([3, 0, 0x40]), syncsafe(v23Body.length), v23Body)
    expect(parseId3v2Cover(v23Tag).blob.size).toBe(PNG.length)

    // v2.4：扩展头 6 字节（长度字段写 6 = **包含它自己**）
    const v24Ext = concat(syncsafe(6), new Uint8Array([1, 0]))
    const v24Body = concat(v24Ext, frame('APIC', apicBody({ picture: PNG })))
    const v24Tag = concat(ascii('ID3'), new Uint8Array([4, 0, 0x40]), syncsafe(v24Body.length), v24Body)
    expect(parseId3v2Cover(v24Tag).blob.size).toBe(PNG.length)
  })

  it('标签级的非同步（标志位 bit7）_should先去插进去的 0x00 再解析', () => {
    // 【为什么这条不能省】非同步的标签里，正文的字节流被插了 0x00 ——
    // 不做反处理的后果是帧长度/MIME/图片数据全部错位，表现是"封面永远读不出来"且没有任何报错。
    // 【为什么要专门挑一张带 0xFF 的图】正文里没有 0xFF 的话，编码器根本不会插字节，
    // 这条用例就成了"反处理是个空操作也能过"的假绿。
    const pictureWithFF = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0x0d, 0xff, 0x00, 0x1a, 0x0a, 0xff])
    // 【注意这里必须是 v2.3】"整个标签一起做非同步"是 v2.3 的做法（标志位 bit7）；
    // v2.4 把非同步下沉到了每一帧的标志位里（两种都写在 app/utils/id3.ts 里，
    // 各自按各自的规则处理）。用 v2.4 的帧长度编码去配 v2.3 的标签头，
    // 这条用例本身就不成立。
    const body = apicBody({ encoding: 3, descriptionBytes: utf8Desc('x'), picture: pictureWithFF })
    const frames = frame('APIC', body, { version: 3 })
    // 帧长度字段写的是"反非同步**之前**"的长度（编码器先算长度、再往正文里插 0x00）——
    // 把这一点写成断言，免得读到的人以为长度是插完之后才数的
    expect(frames.length).toBe(FRAME_HEADER_LENGTH + body.length)

    // 编码器视角：**整帧**（连帧头一起）每个 0xFF 后面插一个 0x00。
    // 正文里的 0xFF 有三个（都在图片数据里），所以会多出 3 个字节 ——
    // 先把这个数钉住：插 0 个字节时"反非同步"是个空操作，这条用例就会变成永远为真的假绿
    const unsynced = []
    for (const byte of frames) {
      unsynced.push(byte)
      if (byte === 0xff) unsynced.push(0x00)
    }
    const unsyncedBody = new Uint8Array(unsynced)
    expect(unsyncedBody.length).toBe(frames.length + 3)

    const tag = concat(ascii('ID3'), new Uint8Array([3, 0, 0x80]), syncsafe(unsyncedBody.length), unsyncedBody)

    const cover = parseId3v2Cover(tag)
    expect(cover).not.toBeNull()
    expect([...cover.bytes]).toEqual([...pictureWithFF])
  })

  it('不支持的版本（v2.2）与非二进制输入_should一律返回 null、不抛异常', () => {
    const apic = frame('APIC', apicBody({ picture: PNG }))
    const v22 = concat(ascii('ID3'), new Uint8Array([2, 0, 0]), syncsafe(apic.length), apic)

    // v2.2 的帧头结构不同（3 字节 ID + 3 字节长度），硬按 v2.3 读会读出乱七八糟的帧
    expect(parseId3v2Cover(v22)).toBeNull()
    expect(parseId3v2Cover(new Uint8Array([0x49, 0x44]))).toBeNull()          // 连 10 字节的标签头都不够
    expect(parseId3v2Cover(null)).toBeNull()
    expect(parseId3v2Cover(undefined)).toBeNull()
    expect(parseId3v2Cover('ID3')).toBeNull()
    expect(parseId3v2Cover({ code: 200, data: null })).toBeNull()
  })

  it('标签长度为 0 / 标签区全是 0 字节_should返回 null 而不是死循环', () => {
    const empty = concat(ascii('ID3'), new Uint8Array([4, 0, 0]), syncsafe(0))
    expect(parseId3v2Cover(empty)).toBeNull()

    const zeros = concat(ascii('ID3'), new Uint8Array([4, 0, 0]), syncsafe(32), new Uint8Array(32))
    expect(parseId3v2Cover(zeros)).toBeNull()
  })
})
