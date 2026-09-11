// ============================================================
// app/utils/playerProgress.ts
//
// 作用：把「播放到哪儿了」换算成进度条要用的百分比。
//
// 【为什么单独一个纯函数，而不是在页面里直接写算式】
//   这个数字要同时满足四条边界，每一条写错都是"界面上看起来只是配色不对"：
//     · 总时长还不知道（0 / NaN / Infinity）时不能算出 NaN 或 -Infinity ——
//       那会让整条 `style` 变成非法值，浏览器**静默丢弃**，表现就是"没颜色"
//     · 不能出现负数（有些浏览器在 seek 之后会短暂给出负的 currentTime）
//     · 不能超过 100（同理，"超出一点点"会让渐变按 100% 之后的位置算，右边那一截消失）
//     · 拖动过程中要跟着手指走，而不是跟着播放位置（那一条由调用方决定传哪个值进来）
//   抽成纯函数之后，前三条可以在单测里逐条钉住 ——
//   而组件测试里驱动一个真实的 `<audio>` 很难（happy-dom 不解码音频，也不会走时间线）。
//
// 【技术栈与关键字】
//   · 这是 Nuxt 的 app/utils 目录：导出会被**自动导入**，页面里直接写 playedPercent(...)
//   · Number.isFinite 同时挡掉 NaN / Infinity / 非数字类型（比 `> 0` 更严：
//     `NaN > 0` 是 false，看似够用，但 `Infinity > 0` 是 true —— 那会算出 0 之外的怪值）
// ============================================================

/**
 * 「已播放」占总时长的百分比（0 ~ 100 的有限数）。
 *
 * 【为什么返回 0 而不是 null / NaN】调用方要把它直接拼进 CSS（`width` / 渐变断点）：
 * 拼进样式的任何非数字都会让**整条声明失效**，而 0% 恰好就是"还没开始播"的真相 ——
 * 用一个合法值表达"不知道"比留一个会让样式崩掉的值安全得多。
 *
 * @param {number} current 当前播放位置（秒）
 * @param {number} total   总时长（秒）。0 / 负数 / 非有限数都表示"还不知道"
 * @returns {number} 0 ~ 100；总时长未知时是 0
 */
export const playedPercent = (current, total) => {
  if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0) return 0
  const percent = (current / total) * 100
  // 除法本身还可能出问题（total 是极小正数时百分比会溢出成 Infinity），再兜一道
  if (!Number.isFinite(percent)) return 0
  return Math.min(100, Math.max(0, percent))
}
