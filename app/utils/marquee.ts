/**
 * =====================================================================
 * 首页滚动跑马灯：位移与时长的计算
 *
 * 【为什么要单独一个纯函数】这两个量必须**按实测宽度算**，而宽度只有在浏览器里
 *   量得到（jsdom 里 clientWidth / scrollWidth 恒为 0，组件用例测不了它）。
 *   抽成纯函数之后，"多长算跑完全程""速度是不是恒定"这些规则就能单独钉住 ——
 *   而它们恰恰是最容易写错、又最难靠肉眼发现的地方（跑快跑慢都能看，但
 *   "文案短的时候它根本没从右边进来"要盯着看几秒才反应过来）。
 * =====================================================================
 */

/** 每秒走多少像素 —— 跑马灯的速度感由它决定 */
export const NOTICE_SPEED_PX_PER_SECOND = 90

/** 一趟最少跑多久（秒）：文案极短时不至于快得像闪一下 */
export const NOTICE_MIN_DURATION_SECONDS = 6

/** CSS 变量名（组件与样式表两处都要用，写成常量免得拼错） */
export const MARQUEE_FROM_VAR = '--mq-from'
export const MARQUEE_TO_VAR = '--mq-to'
export const MARQUEE_DURATION_VAR = '--mq-duration'

/**
 * 算出跑马灯一趟的起止位置与时长。
 *
 * 【一趟 = 从"完全在容器右边之外"走到"完全在左边之外"】
 *   · 起点：把文字整体向右推【一个容器宽度】—— 此时它的左边缘贴着容器的右边缘
 *   · 终点：把文字整体向左推【文字自己的宽度】—— 此时它的右边缘贴着容器的左边缘
 *   两者之差就是这一趟要走的距离：容器宽 + 文字宽。
 *
 * 【为什么不能写死百分比】百分比在 transform 里是相对【元素自身宽度】的，
 *   而这里的两个参照物（容器、文字）宽度完全不同：
 *     · 只写四个字时，元素很窄 —— 按自身宽度的百分比推出去，它其实一直留在屏幕里，
 *       "从右边进来"这一段根本不存在
 *     · 写满 200 字时元素比容器宽好几倍 —— 按自身宽度推，终点又会在左边留下一个尾巴
 *   所以两个宽度都得由调用方量出来传进来。
 *
 * 【为什么时长跟着距离走】速度恒定。写死时长的话，文案一长就飞快掠过、
 *   一短就慢得像卡住 —— 而这句文案的长度由站长自己填。
 *
 * @param boxWidth  容器宽度（px）
 * @param textWidth 文字宽度（px）
 * @returns 三个 CSS 变量（px 与 s），量不到宽度时返回 null（调用方保持兜底值）
 */
export const noticeMarqueeStyle = (boxWidth: number, textWidth: number) => {
  // 量不到就什么都不设：SSR 到水合完成之间用样式表里的兜底值，
  // 硬编一个 0 会让文字叠在左边缘不动
  if (!Number.isFinite(boxWidth) || !Number.isFinite(textWidth)) return null
  if (boxWidth <= 0 || textWidth <= 0) return null

  const distance = boxWidth + textWidth
  const seconds = Math.max(NOTICE_MIN_DURATION_SECONDS, distance / NOTICE_SPEED_PX_PER_SECOND)

  return {
    [MARQUEE_FROM_VAR]: `${boxWidth}px`,
    [MARQUEE_TO_VAR]: `${-textWidth}px`,
    // 保留一位小数：整数秒的时长差别肉眼看不出来，多几位只是噪音
    [MARQUEE_DURATION_VAR]: `${seconds.toFixed(1)}s`,
  }
}
