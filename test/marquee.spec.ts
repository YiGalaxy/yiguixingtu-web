import { describe, it, expect } from 'vitest'
import {
  noticeMarqueeStyle,
  NOTICE_MIN_DURATION_SECONDS,
  NOTICE_SPEED_PX_PER_SECOND,
  MARQUEE_FROM_VAR,
  MARQUEE_TO_VAR,
  MARQUEE_DURATION_VAR,
} from '~/utils/marquee'

// =====================================================================
// 首页跑马灯的位移与时长的计算
//
// 【为什么它值得单独一组用例】这两个量写错了**都能跑起来**，只是跑得不对：
//   · 起点没推到容器右边之外 → 文案一上来就在屏幕上，"从右边进来"这一段不存在
//     （站长填了句四个字的短语时最容易撞上，而"看起来在滚动"会让人以为没问题）
//   · 终点没走到左边之外 → 文案在左边留个尾巴就跳回去了，也就是"没跑完全程"
//   · 时长不跟着距离走 → 文案一长就飞快掠过、一短就慢得像卡住
//   这三条在浏览器里都要盯着看几秒才反应过来，而在这里是一行断言。
//
// 【为什么它必须是个纯函数】宽度只有在真实浏览器里量得到（jsdom 里 0），
//   所以"量"的部分留在组件里、"算"的部分放在这里 —— 算的部分才是会写错的。
// =====================================================================

/** 取一个样式对象里的值（键是 CSS 变量名，写错拼写时这里会直接给出 undefined） */
const px = (value: string | undefined) => Number(String(value).replace('px', ''))

describe('跑马灯位移：一趟要跑完全程', () => {
  it('起点在容器右边界之外：向右推的距离正好是容器宽度', () => {
    const style = noticeMarqueeStyle(1080, 600)!

    // 元素的静态位置是容器的左边缘；向右推 1080 之后它的左边缘正好贴着容器右边缘
    // ——再多一像素才算"完全在外面"，而这个精度对肉眼没有差别
    expect(px(style[MARQUEE_FROM_VAR])).toBe(1080)
  })

  it('★ 终点在容器左边界之外：向左推的距离是【文字自己的宽度】', () => {
    const style = noticeMarqueeStyle(1080, 600)!

    // 元素的右边缘 = 静态位置(0) + 文字宽(600)，再向左推 600 → 右边缘落在 0
    // 也就是刚好整条走出左边。⚠️ 这里推的是"文字宽"而不是"容器宽"：
    //   推容器宽的话，短文案会在左边留下半屏没走完（"没跑完全程"就是这么来的）
    expect(px(style[MARQUEE_TO_VAR])).toBe(-600)
  })

  it('★ 短文案也要真的走完全程（最容易被百分比写法坑掉的那种）', () => {
    // 四个字：约 60px。容器 1080。
    const style = noticeMarqueeStyle(1080, 60)!

    // 起点仍在容器之外（推 1080），终点也真的出了左边（推 60）
    expect(px(style[MARQUEE_FROM_VAR])).toBe(1080)
    expect(px(style[MARQUEE_TO_VAR])).toBe(-60)
    // 要是按"元素自身宽度的百分比"算，这四个字会被推出去 60px 就停 ——
    // 而 60px 连容器都还没出，等于一动就在屏幕里
  })

  it('超长文案同样不会在左边留尾巴（比容器还宽三倍）', () => {
    const style = noticeMarqueeStyle(1080, 3000)!

    // 向左推的是文字宽，所以再长也能整条走出左边
    expect(px(style[MARQUEE_TO_VAR])).toBe(-3000)
  })
})

describe('跑马灯时长：速度恒定', () => {
  it('时长与总距离成正比（长文案跑得久，但速度一样）', () => {
    const shortText = noticeMarqueeStyle(1080, 600)!
    const longText = noticeMarqueeStyle(1080, 1200)!

    const secondsOf = (style: Record<string, string>) => Number(String(style[MARQUEE_DURATION_VAR]).replace('s', ''))

    const shortSeconds = secondsOf(shortText)
    const longSeconds = secondsOf(longText)

    // 距离：1680 vs 2280。时长比应当等于距离比（在都没触到最短时长的前提下）
    expect(longSeconds / shortSeconds).toBeCloseTo(2280 / 1680, 2)
    // 顺带核一遍绝对值：距离 / 速度
    expect(shortSeconds).toBeCloseTo(1680 / NOTICE_SPEED_PX_PER_SECOND, 1)
  })

  it('极短文案有最短时长兜底（否则会快得像闪一下）', () => {
    const style = noticeMarqueeStyle(100, 10)!

    // 距离 110px / 90px每秒 ≈ 1.2 秒 —— 太快了，必须被抬到下限
    expect(Number(String(style[MARQUEE_DURATION_VAR]).replace('s', '')))
      .toBe(NOTICE_MIN_DURATION_SECONDS)
  })
})

describe('跑马灯：量不到宽度时不要乱设值', () => {
  it.each([
    ['容器宽为 0（元素还没布局）', 0, 600],
    ['文字宽为 0（DOM 里还没有内容）', 1080, 0],
    ['负数（理论上不该出现）', -1, 600],
    ['NaN（量失败）', Number.NaN, 600],
    ['Infinity', 1080, Number.POSITIVE_INFINITY],
  ])('%s → 返回 null，让样式表里的兜底值继续生效', (_label, boxWidth, textWidth) => {
    // 【为什么不能返回 0】设成 0 的话文字会一动不动地叠在容器左边缘——
    //   而"什么都没动"看起来像页面坏了；保持兜底值至少还是在滚的
    expect(noticeMarqueeStyle(boxWidth, textWidth)).toBeNull()
  })
})
