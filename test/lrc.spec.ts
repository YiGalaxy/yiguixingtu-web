// @vitest-environment node
// =====================================================================
// test/lrc.spec.ts
//
// 作用：守住 LRC 歌词解析（`app/utils/lrc.ts`）的每一条边界。
//
// 【为什么这个文件用 node 环境而不是 nuxt 环境】
//   被测的是两个**纯函数**：给一段字符串，返回一个对象。
//   不需要 Vue、不需要网络、不需要建一整个 Nuxt 应用（vitest.config.ts 里那条注释
//   专门说了"纯工具函数的测试可以走普通 node 环境，会更快"）。
//   这样跑一份用例是毫秒级的，改歌词解析逻辑时能立刻知道有没有踩坏东西。
//
// 【为什么不用 `~/utils/lrc` 这种别名】node 环境里没有 Nuxt 的解析上下文，
//   别名能不能用取决于配置的加载顺序 —— 相对路径在任何环境下都一样，
//   测试文件不该有"看运气"的部分。
//
// 【测得到什么 / 测不到什么，如实说明】
//   测得到：文本 → (时间戳, 正文) 的每一条规则：多时间戳展开、元信息、offset 的方向、
//           非法行、排序、以及 findCurrentLine 的四种边界。
//   测不到：真实的一份 .lrc 文件（`static-media/bg-music.lrc` **现在并不存在**，
//           所以线上走的一定是"没有歌词"那条路）。也就是说：
//           这些用例证明"解析规则按写下来的约定执行"，
//           不能证明"某份真实歌词文件能显示得好看"—— 那要等文件上传后人工看一眼。
// =====================================================================

import { describe, expect, it } from 'vitest'
import { parseLrc, findCurrentLine } from '../app/utils/lrc'

/** 常见的一份歌词：元信息 + 正文 + 空行 + 一行多时间戳 */
const SAMPLE = [
  '[ti:背景音乐]',
  '[ar:亿轨星途]',
  '[al:站点自带]',
  '[by:someone]',
  '',
  '[00:01.00]第一句',
  '[00:05.50]第二句',
  '[00:10.00][00:20.00]副歌（唱两遍）',
  '[00:30.00]最后一句',
].join('\n')

describe('LRC 解析 · parseLrc', () => {
  it('常规文本_should解析出元信息与每一句的时间（按时间升序）', () => {
    const { meta, lines } = parseLrc(SAMPLE)

    expect(meta).toEqual({ ar: '亿轨星途', ti: '背景音乐', al: '站点自带', by: 'someone', offset: 0 })
    expect(lines.map(l => l.time)).toEqual([1, 5.5, 10, 20, 30])
    expect(lines.map(l => l.text)).toEqual(['第一句', '第二句', '副歌（唱两遍）', '副歌（唱两遍）', '最后一句'])
  })

  it('一行多个时间戳_should展开成多条记录（副歌重复是最常见的写法）', () => {
    const { lines } = parseLrc('[00:10.00][00:20.00]副歌')

    // 只取第一个时间戳的话，20 秒处就没有歌词了 —— 而页面上完全看不出问题
    expect(lines).toHaveLength(2)
    expect(lines[0]).toEqual({ time: 10, text: '副歌' })
    expect(lines[1]).toEqual({ time: 20, text: '副歌' })
  })

  it('三种时间戳写法_should都认（[mm:ss] / [mm:ss.xx] / [mm:ss.xxx]）', () => {
    const { lines } = parseLrc('[00:01]整秒\n[00:02.50]百分秒\n[00:03.123]毫秒')

    expect(lines.map(l => l.time)).toEqual([1, 2.5, 3.123])
  })

  it('一行里有空行与 Windows 换行_should不受影响（\\r 不能混进歌词正文）', () => {
    // 只按 '\n' 切的话每行结尾会多一个 '\r'，它混进正文里就成了一个看不见的字符，
    // 表现为"文本看着一样、字符串比较永远不相等"
    const { lines } = parseLrc('[00:01.00]甲\r\n\r\n[00:02.00]乙\r\n')

    expect(lines.map(l => l.text)).toEqual(['甲', '乙'])
  })

  it('offset 为正值_should把每一句都提前（这是 offset 的作用）', () => {
    // 【方向是刻意选定的，也刻意写在注释里】`[offset:N]` 的正负在实现之间并不统一，
    // 这里的约定是"正值 = 歌词整体提前"，也就是 time = time - offset/1000。
    // 哪天接到一份按相反约定做的歌词，只需要翻转 lrc.ts 里那一个减号。
    const { meta, lines } = parseLrc('[offset:500]\n[00:10.00]甲\n[00:20.00]乙')

    expect(meta.offset).toBe(500)
    expect(lines.map(l => l.time)).toEqual([9.5, 19.5])
  })

  it('offset 大到会把时间戳推成负数_should收在 0（负时间戳没有任何意义）', () => {
    const { lines } = parseLrc('[offset:9000]\n[00:05.00]甲')

    // 负的时间戳会让"点这一句跳转"变成一次非法赋值（currentTime 不接受负数）
    expect(lines[0].time).toBe(0)
  })

  it('offset 写成装饰性的 + 号或非法值_should不影响其它行', () => {
    expect(parseLrc('[offset:+1500]\n[00:10.00]甲').lines[0].time).toBe(8.5)
    // 写坏了就当没有 offset，而不是把整份歌词丢掉
    expect(parseLrc('[offset:abc]\n[00:10.00]甲').lines[0].time).toBe(10)
  })

  it('文件顺序与时间顺序不一致_should按时间升序排（稳定：同时刻保持书写顺序）', () => {
    const { lines } = parseLrc('[00:30.00]晚\n[00:10.00]早\n[00:10.00]同一时刻的第二条\n[00:20.00]中')

    expect(lines.map(l => l.time)).toEqual([10, 10, 20, 30])
    // 同一时间戳的两条要保持文件里的先后（谁先写谁先显示）
    expect(lines[0].text).toBe('早')
    expect(lines[1].text).toBe('同一时刻的第二条')
  })

  it('非法行_should直接忽略，且绝不抛异常（网络来的文件什么都可能是）', () => {
    const text = [
      '作词：某人',                       // 没有时间标签，也不是 [key:value] 形式
      '<!doctype html><title>404</title>', // 最坏情况：服务器回了一个 404 页面
      '[00:1x.00]坏时间戳',
      '[]',
      '[99:99.99]分钟秒数越界（照样按算术解析）',
      '[00:05.00]能认的行',
    ].join('\n')

    expect(() => parseLrc(text)).not.toThrow()
    const { lines } = parseLrc(text)
    // 只有两行能认：越界的那一行的算术结果是 99*60+99.99，仍然是"一个数"，
    // 所以它按算术结果参与排序（这里只断言"没崩、能认的行认出来了"）
    expect(lines.map(l => l.text)).toContain('能认的行')
    expect(lines.map(l => l.text)).not.toContain('作词：某人')
    // 半截的时间标签（[00:1x.00]）连不上正则，整行都被忽略 —— 而不是把 '1x' 当成秒数
    expect(lines.map(l => l.text)).not.toContain('坏时间戳')
  })

  it('空文本 / 只有元信息 / 根本不是字符串_should都返回空歌词且不抛', () => {
    for (const input of ['', '   ', '\n\n', null, undefined, 42, {}, []]) {
      expect(() => parseLrc(input)).not.toThrow()
      const result = parseLrc(input)
      expect(result.lines).toEqual([])
      // 元信息字段永远存在（调用方不用再判 undefined）
      expect(result.meta.ti).toBe('')
      expect(result.meta.offset).toBe(0)
    }

    // 「只有元信息、一句歌词都没有」**不是**错误，而是一份合法的（只是空的）歌词文件：
    // 元信息照样要读出来，界面按"没有歌词"处理（不能因为它有 [ti:] 就以为有歌词可显示）
    const metaOnly = parseLrc('[ti:只有标题]\n[ar:某人]')
    expect(metaOnly.lines).toEqual([])
    expect(metaOnly.meta.ti).toBe('只有标题')
    expect(metaOnly.meta.ar).toBe('某人')
  })

  it('调两次_should结果一致（全局正则的 lastIndex 没有残留）', () => {
    // 这条守的是一个很隐蔽的坑：带 g 标志的正则会把匹配位置记在自己身上，
    // 一次调用之后不复位的话，**第二次解析同一份文本会漏掉行首的时间标签**。
    const first = parseLrc(SAMPLE)
    const second = parseLrc(SAMPLE)

    expect(second).toEqual(first)
    expect(second.lines).toHaveLength(5)
  })
})

describe('LRC 解析 · findCurrentLine', () => {
  const { lines } = parseLrc('[00:01.00]甲\n[00:05.00]乙\n[00:10.00]丙')

  it('第一句之前（前奏）_should返回 -1，而不是硬塞第一句', () => {
    // 硬塞第一句的表现是"音乐一起就高亮第一句"，用户会以为已经在唱了
    expect(findCurrentLine(lines, 0)).toBe(-1)
    expect(findCurrentLine(lines, 0.99)).toBe(-1)
  })

  it('正好等于某一句的时间_should就是那一句（用 <= 而不是 <）', () => {
    expect(findCurrentLine(lines, 1)).toBe(0)
    expect(findCurrentLine(lines, 5)).toBe(1)
    expect(findCurrentLine(lines, 10)).toBe(2)
  })

  it('两句之间_should返回前一句（第二句还没到）', () => {
    expect(findCurrentLine(lines, 3)).toBe(0)
    expect(findCurrentLine(lines, 9.99)).toBe(1)
  })

  it('超出最后一句_should一直停在最后一句（高亮不该突然空掉）', () => {
    expect(findCurrentLine(lines, 11)).toBe(2)
    expect(findCurrentLine(lines, 99999)).toBe(2)
  })

  it('时间戳重复_should返回后一条（同一时刻显示后写的那一句）', () => {
    const dup = parseLrc('[00:05.00]前\n[00:05.00]后').lines

    expect(findCurrentLine(dup, 5)).toBe(1)
    expect(findCurrentLine(dup, 5.1)).toBe(1)
  })

  it('时间戳是 0 的那一句_should在 0 秒就被选中', () => {
    const zero = parseLrc('[00:00.00]开头就唱').lines

    expect(findCurrentLine(zero, 0)).toBe(0)
  })

  it('空歌词 / 非法秒数_should返回 -1 而不是抛或返回 NaN', () => {
    expect(findCurrentLine([], 5)).toBe(-1)
    expect(findCurrentLine(null, 5)).toBe(-1)
    expect(findCurrentLine(lines, NaN)).toBe(-1)
    expect(findCurrentLine(lines, Infinity)).toBe(-1)
    expect(findCurrentLine(lines, -1)).toBe(-1)
    expect(findCurrentLine(lines, undefined)).toBe(-1)
  })

  it('脏数据（time 不是数字）_should跳过它，不把下标算歪', () => {
    const dirty = [{ time: 1, text: '甲' }, { time: undefined, text: '坏' }, { time: 3, text: '乙' }]

    expect(findCurrentLine(dirty, 2)).toBe(0)
    expect(findCurrentLine(dirty, 4)).toBe(2)
  })
})
