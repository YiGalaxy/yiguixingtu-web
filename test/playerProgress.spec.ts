import { describe, it, expect } from 'vitest'
import { playedPercent } from '~/utils/playerProgress'

// =====================================================================
// 进度条「已播放」百分比（app/utils/playerProgress.ts）
//
// 【为什么要为一个算式单独一份测试】用户报的 bug 是"进度条已播放部分没有颜色"。
//   根因是原生 `<input type="range">` 在 Chrome/Edge/Safari 下没有"已播放"这个元素，
//   只能自己按进度画一条渐变 —— 于是**这个百分比直接决定颜色画到哪儿**。
//   它写错的表现不是报错，而是外观不对：
//     · 算出 NaN / Infinity → 拼出来的整条 style 非法、浏览器**静默丢弃** → 一点颜色都没有
//     · 越界（>100 或 <0）→ 渐变的分界点跑到轨道外面 → 右边那一截也被染成"已播放"
//   这几条边界在组件测试里很难触发（happy-dom 不解码音频、也不会走时间线，
//   拿不到会变的 currentTime / duration），所以放在纯函数这一层逐条钉住。
// =====================================================================

describe('playedPercent —— 已播放百分比', () => {
  it('正常换算', () => {
    expect(playedPercent(0, 120)).toBe(0)
    expect(playedPercent(30, 120)).toBe(25)
    expect(playedPercent(60, 120)).toBe(50)
    expect(playedPercent(120, 120)).toBe(100)
    expect(playedPercent(1, 3)).toBeCloseTo(33.333, 2)
  })

  it('⚠️ 总时长还不知道时给 0（不是 NaN，也不是 100）', () => {
    // 【为什么这条最要紧】时长要等 loadedmetadata 才读得到；在那之前如果算出 NaN，
    //   拼出来的是 `--mp-fill: NaN%` → 整条 background 声明失效 →
    //   连"未播放"那截灰色轨道都一起没了（比原来的样子更糟）
    for (const total of [0, -1, NaN, Infinity, -Infinity, null, undefined, 'abc']) {
      expect(playedPercent(10, total)).toBe(0)
    }
  })

  it('当前位置不是有限数时也给 0', () => {
    for (const current of [NaN, Infinity, -Infinity, null, undefined, 'abc', {}]) {
      expect(playedPercent(current, 120)).toBe(0)
    }
  })

  it('夹在 0 ~ 100 之间：越界与负值都不许漏出去', () => {
    // seek 之后有些浏览器会短暂给出越界的 currentTime，
    // 跟着它画会让渐变分界点跑到轨道外 —— 表现是"右边那一截也变色了"
    expect(playedPercent(200, 120)).toBe(100)
    expect(playedPercent(1e9, 120)).toBe(100)
    expect(playedPercent(-5, 120)).toBe(0)
    // 【这一条探的是"算不出来时不许漏出非有限数"】时长小到 Number.MIN_VALUE 时，
    //   中间那步除法会溢出成 Infinity；函数的规矩是**一律回 0**（"算不出来就给 0"），
    //   而不是回 Infinity（那会让整条样式失效）。真实的时长当然不可能这么小，
    //   这条用例存在的意义只有一个：证明没有任何一条路径能把非有限数漏给调用方。
    expect(playedPercent(1, Number.MIN_VALUE)).toBe(0)
  })

  it('永远返回一个 0~100 的有限数（调用方要直接拼进样式）', () => {
    const samples = [0, 1, 59.9, 60, 120, 121, -1]
    for (const current of samples) {
      const percent = playedPercent(current, 120)
      expect(Number.isFinite(percent)).toBe(true)
      expect(percent).toBeGreaterThanOrEqual(0)
      expect(percent).toBeLessThanOrEqual(100)
    }
  })

  it('单调：播放位置往前走，百分比不回头', () => {
    // 进度条要是偶尔往回跳，看起来像"播放位置回退了" —— 那是用户会当成 bug 报上来的现象
    let previous = -1
    for (let second = 0; second <= 120; second += 7) {
      const percent = playedPercent(second, 120)
      expect(percent).toBeGreaterThanOrEqual(previous)
      previous = percent
    }
  })
})
