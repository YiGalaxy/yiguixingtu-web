// ============================================================
// app/utils/lrc.ts
//
// 作用：把 LRC 歌词文件解析成「一句一句带时间戳的数组」，并回答一个问题：
//       **"此刻唱到哪一句了？"**
//
// 【为什么单独抽成一个文件（而不是写在音乐页里）】
//   ① 解析歌词是一堆**边界条件**的集合：一行多个时间戳、`[offset:]` 要整体挪时间、
//      元信息行不是歌词行、重复时间戳、文件里混着空行和注释……
//      这些东西写在 400 行的页面里，就只能靠"打开浏览器点一下看歌词对不对"来验证，
//      而"看歌词对不对"要等一首歌播到那一句才知道，是最慢、最容易漏的一种验法。
//      抽成纯函数之后，每个边界都能在毫秒级跑完的单测里钉死 —— 这是本次改动里
//      "顺手做对一件事"的部分，也是这一批唯一能被完全验证的部分。
//   ② 它是**纯函数**：没有 Vue、没有网络、没有 DOM。输入一段字符串，输出一个对象。
//      所以测试不需要挂载组件、不需要 Nuxt 环境（见 test/lrc.spec.ts 顶部说明）。
//
// 【LRC 是什么】
//   一种纯文本歌词格式，一行一句，行首可以带若干个时间标签，例如：
//       [ti:背景音乐]            ← 元信息（标题）
//       [ar:某某]                ← 元信息（歌手）
//       [offset:-200]            ← 元信息（整体时间微调，单位毫秒）
//       [00:12.34]第一句歌词     ← 歌词行
//       [01:05][02:10]副歌       ← 一行多个时间戳 = 同一句在 1:05 与 2:10 各唱一次
//   同一句歌词因此会展开成**多条**记录（每条一个时间），这也是"按时间排序"必须做的事：
//   文件里的书写顺序是"人看着舒服"的顺序，不是时间顺序。
//
// 【技术栈与关键字】
//   · 全局正则 `g` + `exec()` 循环：`lastIndex` 是正则对象自己的状态，
//     循环跑到 null 时会自动归零；但**中途 return 就不会归零** ——
//     所以下面每次进循环前都显式复位（这个坑极其隐蔽：第二次调用会漏掉行首标签）。
//   · `String.prototype.split(/\r\n|\r|\n/)`：LRC 文件可能是 Windows 换行、老 Mac 换行，
//     只按 '\n' 切会让每行结尾多一个 '\r'，那个 '\r' 会混进歌词文本里
//     （表现为歌词末尾多一个看不见的字符，比对字符串时永远不相等）。
// ============================================================

/**
 * 时间标签：[mm:ss]、[mm:ss.xx]、[mm:ss.xxx]、[mm:ss:xx]（最后一种是老播放器的写法）。
 *  · mm 允许 1~3 位：超过 59 分钟的曲子（或者把"秒"写进分钟位的老文件）都还能解析
 *  · 小数部分不限定 2 位：两位是百分秒、三位是毫秒，两种都真实存在
 */
const TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g

/**
 * 元信息标签：[ar:歌手] [ti:标题] [al:专辑] [by:制作] [offset:±毫秒]（另外几个常见的一并收下）。
 *
 * 【为什么单独列出来，而不是"没有时间戳的行全忽略"】
 *   元信息里最有实际作用的只有 offset（整体时间微调），ti/ar/al/by 目前只用来做兜底
 *   ——但如果把它们当成非法行丢掉，将来想在播放器上显示标题就得**再去解析一遍**。
 *   收在这里的成本是几行，收益是"以后要用的时候它已经在手上了"。
 */
const META_TAG = /^\[(ar|ti|al|by|offset|re|ve|length):([^\]]*)\]$/i

/**
 * 把解析出来的秒数收敛成"毫秒精度的数字"。
 *
 * 【为什么必须做这一步】offset 会让每个时间戳做一次浮点加减，
 * `12.34 - 0.15` 在 IEEE 754 下是 `12.189999999999999`。
 * 它不影响查找"哪一句"（比较仍然正确），但会让**断言和显示**变得没法看：
 * 测试里写 `expect(time).toBe(12.19)` 会红，而人肉排查时要盯着一串 9 才能反应过来
 * "这是浮点误差、不是解析错了"。统一收到毫秒（保留 3 位小数）之后，
 * 时间戳就是一个"人写得出来、也能严格相等比较"的值。
 */
const toMillisPrecision = (seconds) => Math.round(seconds * 1000) / 1000

/**
 * 解析 LRC 文本。
 *
 * @param {string} text LRC 文件内容（可能是任何东西：空串、HTML、乱码）
 * @returns {{ meta: { ar: string, ti: string, al: string, by: string, offset: number },
 *             lines: Array<{ time: number, text: string }> }}
 *   · `lines` 已按时间**升序**排好（同一时间戳的保持文件里的先后）
 *   · 解析不出来的行**直接忽略**，任何输入都不会让它抛异常
 *
 * 【为什么"绝不抛异常"是硬要求】
 *   这个函数的输入来自网络（`/media/bg-music.lrc`）。文件可能是 404 页面、
 *   可能是被截断的半截文件、也可能是站长手写的、格式不规范的东西。
 *   如果它对坏输入抛异常，表现就是**整个音乐页白屏** ——
 *   而它本来只该影响"歌词那一块显示什么"。所以坏输入一律退化成"没有歌词"，
 *   由调用方显示「暂无歌词」（本项目对缺失数据的统一态度：宁可不显示，不编）。
 */
export const parseLrc = (text) => {
  /** 元信息默认值：都是空串 / 0，调用方不用再判 undefined */
  const meta = { ar: '', ti: '', al: '', by: '', offset: 0 }
  const lines = []

  if (typeof text !== 'string' || !text) return { meta, lines }

  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.trim()
    // 空行直接跳过：LRC 里空行很常见（分隔段落用），它没有任何语义
    if (!line) continue

    // ---- 1. 先看这一行是不是元信息 ----
    // 【为什么放在时间标签之前】`[offset:100]` 里的 "offset" 不是数字，
    // 不会被 TIME_TAG 命中，两者其实不会打架；但先判元信息可以让
    // "既有时间戳又长得像元信息"的怪行按歌词处理（时间戳优先），语义更清楚。
    const metaMatched = META_TAG.exec(line)
    if (metaMatched && !TIME_TAG.test(line)) {
      // 注意：上面那次 TIME_TAG.test() 也会推进 lastIndex，所以后面必须复位（见下）
      const key = metaMatched[1].toLowerCase()
      const value = metaMatched[2].trim()
      if (key === 'offset') {
        // offset 是毫秒整数，允许写 `+500` / `-200` / `500`
        const parsed = Number.parseInt(value, 10)
        meta.offset = Number.isFinite(parsed) ? parsed : 0
      } else if (key in meta) {
        meta[key] = value
      }
      continue
    }

    // ---- 2. 收集这一行里**所有**时间标签 ----
    // 【为什么是 while 而不是 match 一次】一行多时间戳是 LRC 的正常写法
    // （副歌重复时最常见）：`[01:05.00][02:10.00]副歌`。只取第一个的话，
    // 这首歌的 2:10 处就没有歌词了，而页面上完全看不出问题。
    const times = []
    // 【为什么不用 exec 结束后剩下的 lastIndex】exec **失败时会把 lastIndex 复位成 0**
    //   （这是规范行为），所以循环退出后 lastIndex 是 0、不是"最后一个匹配的结尾"。
    //   踩这个坑的表现是：所有歌词正文都变成整行原文（带着 [00:12] 标签一起显示）。
    //   所以匹配到的结尾自己记。
    let lastTagEnd = 0
    TIME_TAG.lastIndex = 0   // 复位：见文件头关于全局正则 lastIndex 的说明
    let matched
    while ((matched = TIME_TAG.exec(line)) !== null) {
      lastTagEnd = matched.index + matched[0].length
      const minutes = Number(matched[1])
      const seconds = Number(matched[2])
      const fraction = matched[3] ?? ''
      // 小数部分按位数解释：2 位是百分秒（×10）、3 位是毫秒（×1）、1 位是十分秒（×100）
      const fractionMs = fraction ? Number(fraction) * 10 ** (3 - fraction.length) : 0
      const total = minutes * 60 + seconds + fractionMs / 1000
      if (Number.isFinite(total)) times.push(total)
      // 防死循环：正则一定前进（每次至少吃掉一个 `[..]`）；这里不额外判断，
      // 但把"空匹配"的可能性排除掉 —— `TIME_TAG` 至少要求 1 位分钟数字
    }

    // 一个时间标签都没有，又不是元信息 → 非法行（比如"作词：某人"这种没有标签的行、或者 404 页面里的 HTML）
    if (times.length === 0) continue

    // 标签之后的才是歌词正文：用"最后一个时间标签的结尾"来切，
    // 这样 `[00:01][00:02]词` 取到的正文是"词"，而不是带标签的整行。
    const content = line.slice(lastTagEnd).trim()
    for (const time of times) lines.push({ time, text: content })
  }

  // ---- 3. 应用 offset（整体时间微调）----
  // 【方向的选择，以及为什么必须在这里写清楚】
  //   `[offset:N]` 的单位是毫秒，但**正值到底是"提前"还是"推迟"，各家实现并不一致**
  //   （这也是 LRC 这个格式最含糊的一处）。这里采用"正值 = 歌词整体提前"，也就是
  //   `time - offset/1000`，理由是本地播放器最常见的用法正是"歌词慢了一拍，给个正数把它拉回来"。
  //   如果将来接到一份按相反约定做的歌词文件，**只需要翻转这一个减号** ——
  //   所以这一行必须集中、必须带注释，而不是散在几处。
  if (meta.offset !== 0) {
    const shift = meta.offset / 1000
    for (const item of lines) {
      // 下限收在 0：负的时间戳除了让"跳转"变成一次非法赋值（currentTime 不接受负数）
      // 之外没有任何意义，前奏那句本来就该在第一帧显示
      item.time = toMillisPrecision(Math.max(0, item.time - shift))
    }
  } else {
    // 没写 offset 时也要过一遍精度收敛：`[00:12.34]` 算出来是 12.340000000000002 这种值
    for (const item of lines) item.time = toMillisPrecision(item.time)
  }

  // ---- 4. 排序 ----
  // 【为什么要排】文件顺序 ≠ 时间顺序：写字的人会按"主歌 / 副歌 / 桥段"分组写，
  //   而 `findCurrentLine` 依赖"时间递增"这个前提（它一旦发现超出就提前收工）。
  //   排序必须**稳定**：同一时间戳的多条记录要保持它们在文件里的先后（谁先写谁先显示）。
  //   JS 的 sort 在现代引擎里是稳定的，但这里显式带上原始下标做次级比较 ——
  //   契约写进代码里，比依赖引擎实现细节可靠（换个运行环境就不用再想这件事）。
  for (let i = 0; i < lines.length; i++) lines[i].__index = i
  lines.sort((a, b) => (a.time - b.time) || (a.__index - b.__index))
  for (const item of lines) delete item.__index

  return { meta, lines }
}

/**
 * 找出"此刻应该显示第几句歌词"。
 *
 * @param {Array<{ time: number, text: string }>} lines parseLrc 给的数组（**假定已按时间升序**）
 * @param {number} seconds 播放到第几秒（`<audio>.currentTime`）
 * @returns {number} 命中的下标；**-1 表示"还没唱到第一句"**（前奏、或者没有歌词）
 *
 * 【边界语义（这三条都有用例钉着，因为它们决定了界面上显示什么）】
 *   · 在第一条之前（前奏）→ -1：调用方据此显示"还没有当前句"，而不是硬塞第一句
 *     （硬塞的表现是：音乐一起就高亮第一句，用户以为已经在唱了）
 *   · 正好等于某一句的时间 → 就是那一条（用 `<=` 而不是 `<`）
 *   · 超过最后一句 → 最后一条：歌放完了、或者最后一句特别长时，
 *     高亮停在第最后一句上才是对的（返回 -1 会让大字区突然空掉）
 *   · 时间戳重复（文件里写了两条一样的时间）→ 返回**后一条**：
 *     重复时间戳通常意味着"同一时刻要显示的后半句"，玩家实现里普遍显示最后一条
 *
 * 【为什么是线性扫描而不是二分】
 *   一首歌最多几百行，二分省下的那点时间在任何设备上都量不出来，
 *   而"最后一个 `time <= seconds`"用线性写法一眼可读、也不用维护"排序前提是否成立"的第二处断言。
 *   真要换成二分时，这里唯一要注意的是**不能返回左侧**（时间戳相等时要取到最后一个）。
 */
export const findCurrentLine = (lines, seconds) => {
  if (!Array.isArray(lines) || lines.length === 0) return -1
  // NaN / Infinity / 负数（音频还没就绪时 currentTime 是 0，duration 是 NaN）一律当作"没有当前句"
  if (!Number.isFinite(seconds) || seconds < 0) return -1

  let found = -1
  for (let i = 0; i < lines.length; i++) {
    const time = lines[i]?.time
    if (!Number.isFinite(time)) continue   // 脏数据跳过，不要把下标算歪
    if (time <= seconds) found = i
    // 已排序，后面的只会更大 —— 提前收工（这也是"必须排序"的第二个理由）
    else break
  }
  return found
}
