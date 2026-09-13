// @vitest-environment node
// =====================================================================
// test/playMode.spec.ts
//
// 作用：守住「播放模式与"下一首放谁"」这一段纯逻辑（`app/utils/playMode.ts`）：
//       三档模式的定义与循环切换、洗牌袋、以及一首放完之后该放哪一个。
//
// 【为什么这一份必须是纯函数测试】
//   这段逻辑的**唯一真实入口是"一首歌真的播完"**（`<audio>` 的 `ended`）。
//   要按真实路径验证，一条用例至少得等一首歌的长度 —— 不可能。
//   所以把它抽成纯函数（喂 mode/current/total/bag/random 就出结果），
//   在这里毫秒级地把每条分支都过一遍；`app.vue` 那边只剩下"照着结果换音源"。
//
// 【这一份守的是什么（都是用户能立刻察觉、但代码上看不出来的）】
//   · 顺序播放：往下走，**最后一首放完停下**（不是循环回第一首，那会变成另一个模式）
//   · 随机播放：**一轮之内不重复**（洗牌袋），一轮放完重新洗牌；
//     只有一首歌时原曲重放（否则"随机播放放完一首就哑了"看起来就是坏了）
//   · 单曲循环：一直是这一首
//   · 脏袋子（下标越界、装着刚放完的那一首）要被过滤掉，而不是原样信
//
// 【为什么 random 要当参数喂进来】"随机"这件事不可断言；喂一个确定的伪随机序列
//   之后，"洗牌结果"就是一个确定的值，可以直接 `toEqual`。
// =====================================================================

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MUSIC_MODE,
  MUSIC_MODES,
  MUSIC_MODE_LABEL,
  advancePlayback,
  createShuffleBag,
  isMusicMode,
  nextMusicMode,
} from '~/utils/playMode'

/** 固定随机源：永远返回 0（Fisher-Yates 里 j 恒为 0）—— 结果因此完全确定 */
const alwaysZero = () => 0

describe('播放模式 · 定义与循环切换', () => {
  it('只有三档，顺序就是按钮循环切换的顺序（顺序 → 随机 → 单曲循环）', () => {
    expect(MUSIC_MODES).toEqual(['sequence', 'shuffle', 'repeat-one'])
    expect(DEFAULT_MUSIC_MODE).toBe('sequence')
  })

  it('每一档_should都有一个中文名字（按钮上写的就是它，不能漏）', () => {
    for (const mode of MUSIC_MODES) {
      expect(typeof MUSIC_MODE_LABEL[mode]).toBe('string')
      expect(MUSIC_MODE_LABEL[mode].length).toBeGreaterThan(1)
    }
    expect(MUSIC_MODE_LABEL.sequence).toBe('顺序播放')
    expect(MUSIC_MODE_LABEL.shuffle).toBe('随机播放')
    expect(MUSIC_MODE_LABEL['repeat-one']).toBe('单曲循环')
  })

  it('nextMusicMode_should循环切换，从最后一档回到第一档', () => {
    expect(nextMusicMode('sequence')).toBe('shuffle')
    expect(nextMusicMode('shuffle')).toBe('repeat-one')
    expect(nextMusicMode('repeat-one')).toBe('sequence')
  })

  it('nextMusicMode 遇到不认识的模式_should从第一档开始（旧版本存的值会走到这里）', () => {
    // 表现是"点一下按钮变成顺序播放"，而不是 undefined 之后按钮上什么都不显示
    for (const bad of ['', null, undefined, 'loop-all', 0, {}]) {
      expect(nextMusicMode(bad)).toBe('sequence')
    }
  })

  it('isMusicMode_should只认那三个值', () => {
    for (const mode of MUSIC_MODES) expect(isMusicMode(mode)).toBe(true)
    for (const bad of ['', 'loop', 'SEQUENCE', null, undefined, 1, [], {}]) {
      expect(isMusicMode(bad)).toBe(false)
    }
  })
})

describe('洗牌袋 · createShuffleBag', () => {
  it('袋子_should装下"除当前这一首之外"的全部下标，且不重复', () => {
    const bag = createShuffleBag(5, 2, alwaysZero)

    expect(bag).toHaveLength(4)
    expect(bag).not.toContain(2)                       // 刚放完的那一首不在袋子里
    expect([...bag].sort((a, b) => a - b)).toEqual([0, 1, 3, 4])   // 一个不漏、一个不重
  })

  it('只有一首歌时_should给出空袋子（没有别的可放）', () => {
    expect(createShuffleBag(1, 0, alwaysZero)).toEqual([])
  })

  it('洗牌结果_should随随机源变化（不是"每次都是原顺序"）', () => {
    // 【为什么要有这一条】如果洗牌写成 `[...pool].sort(() => random() - 0.5)`
    //   或者干脆忘了洗，"随机播放"就会退化成"顺序播放"——而页面上完全看不出来。
    //   同一个 exclude、两个不同的随机序列，结果必须不同。
    const zero = createShuffleBag(6, 0, alwaysZero)
    let seed = 0
    const picking = () => { seed = (seed * 7 + 3) % 11 / 11; return seed }
    const other = createShuffleBag(6, 0, picking)

    expect(other).not.toEqual(zero)
    expect([...other].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5])
  })
})

describe('放完一首之后 · advancePlayback', () => {
  // ---------------------------------------------------------------
  // 一、顺序播放
  // ---------------------------------------------------------------
  it('顺序播放_should往下走一首', () => {
    expect(advancePlayback({ mode: 'sequence', current: 0, total: 3 })).toEqual({ index: 1, bag: [] })
    expect(advancePlayback({ mode: 'sequence', current: 1, total: 3 })).toEqual({ index: 2, bag: [] })
  })

  it('顺序播放放到最后一首_should返回 null（= 停下，不循环回第一首）', () => {
    // 【这条是产品定义】"顺序播放"与"列表循环"是两个模式；
    //   循环回第一首会让"顺序播放"和"单曲循环"之间的差别变得说不清。
    expect(advancePlayback({ mode: 'sequence', current: 2, total: 3 })).toEqual({ index: null, bag: [] })
    // 只有一首歌时同样：放完就停（要一直听就选单曲循环或随机播放）
    expect(advancePlayback({ mode: 'sequence', current: 0, total: 1 })).toEqual({ index: null, bag: [] })
  })

  it('顺序播放_should把洗牌袋清掉（切回随机时不会拿到几分钟前的旧袋子）', () => {
    const { bag } = advancePlayback({ mode: 'sequence', current: 0, total: 3, bag: [2, 1] })
    expect(bag).toEqual([])
  })

  // ---------------------------------------------------------------
  // 二、单曲循环
  // ---------------------------------------------------------------
  it('单曲循环_should一直返回当前这一首（调用方据此"从头再放"）', () => {
    for (const current of [0, 1, 2]) {
      expect(advancePlayback({ mode: 'repeat-one', current, total: 3 })).toEqual({ index: current, bag: [] })
    }
  })

  // ---------------------------------------------------------------
  // 三、随机播放（洗牌袋）
  // ---------------------------------------------------------------
  it('随机播放_should从袋子里取，并且把剩下的袋子还回来', () => {
    const first = advancePlayback({ mode: 'shuffle', current: 0, total: 3, bag: [2, 1], random: alwaysZero })

    expect(first.index).toBe(2)
    expect(first.bag).toEqual([1])
  })

  it('随机播放_袋子空了要重新洗一轮，且**不包含刚放完的那一首**', () => {
    const round = advancePlayback({ mode: 'shuffle', current: 1, total: 3, bag: [], random: alwaysZero })

    // 重新洗出来的是 [0, 2]（排除 1）经过固定随机源洗牌的结果
    expect([round.index, ...round.bag].sort((a, b) => a - b)).toEqual([0, 2])
    expect(round.index).not.toBe(1)
  })

  it('随机播放_一轮之内不会重复（三首歌：除起点外的那两首必须各出现一次）', () => {
    // 【这条就是"随机播放"与"每首都随机抽一个"的区别】纯随机会出现
    //   "刚放完 A 又抽到 A"，用户听起来像卡住了。洗牌袋保证一轮内不重复。
    let bag = []
    const visited = []
    let current = 0

    for (let i = 0; i < 2; i++) {
      const step = advancePlayback({ mode: 'shuffle', current, total: 3, bag, random: () => 0.42 })
      bag = step.bag
      current = step.index
      visited.push(current)
    }

    expect([...visited].sort((a, b) => a - b)).toEqual([1, 2])   // 另外两首各一次
  })

  it('随机播放_袋子里的脏数据要被过滤（下标越界 / 装着刚放完的那一首）', () => {
    // 列表被后台改短了（下标 9 越界）、或者用户手动点过当前这首（袋子里有 1）
    const step = advancePlayback({ mode: 'shuffle', current: 1, total: 3, bag: [9, 1, -2, 0], random: alwaysZero })

    expect(step.index).toBe(0)          // 只剩 0 是合法的候选
    expect(step.bag).toEqual([])
  })

  it('随机播放但只有一首歌_should原曲重放，而不是"放完就哑了"', () => {
    expect(advancePlayback({ mode: 'shuffle', current: 0, total: 1, bag: [] })).toEqual({ index: 0, bag: [] })
  })

  it('bag 传进来不是数组时_should当成空袋子（不抛异常）', () => {
    for (const bad of [null, undefined, 'x', 3, {}]) {
      const step = advancePlayback({ mode: 'shuffle', current: 0, total: 3, bag: bad, random: alwaysZero })
      expect(step.index).toBeGreaterThanOrEqual(0)
      expect(step.index).toBeLessThan(3)
    }
  })

  // ---------------------------------------------------------------
  // 四、越界与非法输入（播放列表是接口给的，什么形状都可能）
  // ---------------------------------------------------------------
  it('当前下标越界或不是整数_should从第一首算起（不返回越界的结果）', () => {
    for (const bad of [-1, 3, 99, 1.5, NaN, null, undefined, '1']) {
      const step = advancePlayback({ mode: 'sequence', current: bad, total: 3 })
      expect(step.index).toBe(1)        // 当作 current = 0 → 下一首是 1
    }
  })

  it('曲目数为 0 / 非法_should返回 null（没有可放的东西，不要瞎指一个下标）', () => {
    for (const total of [0, -1, NaN, undefined, null, 2.5, '', 'x', {}]) {
      expect(advancePlayback({ mode: 'shuffle', current: 0, total }).index).toBeNull()
    }
  })

  it('曲目数是数字字符串_should按数字用（接口/序列化差异不至于让"下一首"失效）', () => {
    // 与 useSiteStats 里 toCount 的取舍同源：数字字符串是**明确无歧义**的，
    // 照常换算比"什么都当作 0（= 停下）"更有用。
    expect(advancePlayback({ mode: 'sequence', current: 0, total: '3' })).toEqual({ index: 1, bag: [] })
  })

  it('模式不认识时_should退化成随机播放那一支（默认档，不会卡住）', () => {
    // 正常路径上 `useBackgroundMusic` 已经把非法模式挡住了；这里是第二道防线：
    // 万一有人绕过它设置模式，也**不能出现"放完一首就再也不动了"**。
    const step = advancePlayback({ mode: 'nonsense', current: 0, total: 3, bag: [], random: alwaysZero })
    expect(step.index).not.toBeNull()
    expect(step.index).not.toBe(0)
  })
})
