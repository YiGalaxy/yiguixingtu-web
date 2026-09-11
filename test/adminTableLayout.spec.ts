// @vitest-environment node
// =====================================================================
// test/adminTableLayout.spec.ts
//
// 作用：守住后台表格的两条**布局契约**（读 `app/pages/admin.vue` 的样式做断言）：
//   ① 固定列（「操作」那一列）的兜底底色必须**无条件生效**，不许再包进任何 @media
//   ② 表格的横向滚动条必须**常显**（el-scrollbar 默认藏在悬停之后）
//
// 【为什么这两条值得单独一份契约测试：它们是同一个 bug 的两半】
//   用户报：「评论管理里这些列挤在一起，比如这里，IP 和操作的按钮挤在一起了。」
//   机制是这样的：
//     · Element Plus 的固定列是 `position: sticky` —— 它**没有自己的不透明底色**时，
//       横向滚动的内容会直接从它下面透上来（视觉上就是"字叠字"）
//     · 这个项目的暗色主题把表格背景设成了 `transparent`（好让毛玻璃面板透出来），
//       所以固定列默认就是透的 ⇒ 必须显式补一层底色
//     · 而原来那条补底色的规则被包在 `@media (max-width: 900px)` 里，
//       前提是"桌面宽度下表格装得下、固定列没压住任何东西" ✗
//     · **前提会随列数变化而失效**：评论表加了「邮箱」+「IP」两列之后，
//       列宽合计从 798px 涨到 1162px ⇒ 900~1460px 这一大段宽度里表格已经在横向滚动、
//       「操作」列正在压住「IP」列，而媒体查询还没生效 ⇒ 用户看到的就是"挤在一起"
//   另一半天：滚动条默认不显示 ⇒ 用户看不见右边还有内容，
//   于是把"字叠字"理解成"布局坏了"，而不是"右边还能拉"。
//
// 【为什么用"读源码 + 判断块层级"而不是挂载组件】
//   这两条都是**纯 CSS** 的事实：happy-dom 不做布局、不解析媒体查询、也不算 sticky ——
//   挂载组件只能证明"类名在"，证明不了"这条规则在哪个块里"。而"在不在 @media 里"
//   恰恰就是这个 bug 的全部。所以这里断言的是**样式表的结构**。
//
// 【技术栈与关键字】
//   · `// @vitest-environment node`：只读文件、做文本分析，不必建整个 Nuxt 应用
//   · CSS 的嵌套结构用**大括号配对**判断：把样式拆成"顶层块"，
//     一个选择器只要出现在顶层块里，就说明它外面没有套 @media / @supports
// =====================================================================

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()

/** 后台页的源码（布局与表格样式都在它那段全局 <style> 里） */
const adminSfc = readFileSync(join(ROOT, 'app/pages/admin.vue'), 'utf8')

/**
 * 取出 SFC 里**所有** `<style>` 块的内容（拼在一起）。
 * 【为什么是"所有"而不是第一个】这个文件里有不止一段 `<style>`
 * （页面自己那段 + 跨面板共用的那段），只取第一个会漏掉一半规则 ——
 * 第一版就是这么写的，结果"找不到选择器"，报的却是"断言不通过"，
 * 看起来像规则写错了，其实是取样取错了。
 */
export const styleOf = (sfc) =>
  [...sfc.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n')

/**
 * 剥掉 CSS 注释块（斜杠星号到星号斜杠之间的内容）。
 * 【为什么这一步不能省】本项目的注释极密，而且注释里会**引用选择器**
 * （例如"原来这条规则被包在 `@media (max-width: 900px)` 里"）。
 * 不剥的话，"把真规则删掉、只在注释里留一句"也会被判为通过；
 * 注释里的 `{` / `}` 还会把大括号配对算歪，而配对一歪，下面那个深度判断就是错的。
 */
export const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')

/**
 * 选择器出现位置处的**大括号嵌套深度**：0 = 顶层，>0 = 被 `@media` / `@supports` 套住了。
 * 找不到该选择器时返回 null（"没写"与"写了但被套住"必须能区分开）。
 *
 * ⚠️ 【为什么不能简单地"看它落在哪个顶层块里"】顶层块是"整个 @media 大块"，
 *    里面的规则文本**仍然包含**那个选择器 —— 用 `includes()` 判断会把
 *    "被媒体查询包住"误判成"顶层"。这个错误第一版就写出来了，
 *    被下面那条对照组抓住（这正是对照组存在的意义）。
 */
export const nestingDepthAt = (css, selector) => {
  const clean = stripComments(css)
  const at = clean.indexOf(selector)
  if (at === -1) return null
  let depth = 0
  for (let i = 0; i < at; i++) {
    if (clean[i] === '{') depth++
    else if (clean[i] === '}') depth--
  }
  return depth
}

/** 某个选择器是不是写在**顶层**（外面没套任何 @ 规则） */
export const isTopLevelSelector = (css, selector) => nestingDepthAt(css, selector) === 0

/**
 * 取出包含该选择器的**那一条规则**的文本（从选择器起到配对的右括号），
 * 用来进一步断言它设了什么值。找不到返回空串。
 */
export const ruleBlockWith = (css, selector) => {
  const clean = stripComments(css)
  const at = clean.indexOf(selector)
  if (at === -1) return ''
  const open = clean.indexOf('{', at)
  if (open === -1) return ''
  let depth = 0
  for (let i = open; i < clean.length; i++) {
    if (clean[i] === '{') depth++
    else if (clean[i] === '}') {
      depth--
      if (depth === 0) return clean.slice(at, i + 1)
    }
  }
  return clean.slice(at)
}

const adminCss = styleOf(adminSfc)

describe('后台表格布局契约（admin.vue 的样式）', () => {
  it('固定列的兜底底色【必须无条件生效】：不许再包进任何 @media', () => {
    // 这就是用户那个 bug 的根因：一旦它被某个宽度断点包住，
    // "断点还没生效、但表格已经开始横向滚动"的那一段宽度里就会出现字叠字
    expect(isTopLevelSelector(adminCss, '.el-table-fixed-column--right')).toBe(true)
    expect(isTopLevelSelector(adminCss, '.el-table-fixed-column--left')).toBe(true)
  })

  it('固定列确实补了一层半透明底色（不是把 background 清成 none）', () => {
    // 【为什么不用写死纯色】面板叠在背景视频上、底色每帧都在变 —— 纯色必然对不上。
    // 所以断言的是"有一层半透明底 + 模糊"，而不是某个具体颜色。
    const rule = ruleBlockWith(adminCss, '.el-table-fixed-column--right')
    expect(rule).toMatch(/background:\s*rgba\(/)
    expect(rule).toMatch(/backdrop-filter:\s*blur/)
  })

  it('横向滚动条【常显】：规则在顶层，而且确实把 opacity 提到了 1', () => {
    // el-scrollbar 默认 opacity: 0、悬停才显形。后台表格"横向能滚"是常态，
    // 藏起来等于让用户以为右边没内容 —— 所以这条也必须在顶层、且带 !important
    // （Element Plus 自己的悬停规则选择器权重不低，不覆盖不掉）。
    expect(isTopLevelSelector(adminCss, '.el-scrollbar__bar.is-horizontal')).toBe(true)
    const rule = ruleBlockWith(adminCss, '.el-scrollbar__bar.is-horizontal')
    expect(rule).toMatch(/opacity:\s*1\s*!important/)
    // 滚动条要够粗、够看得见：太细（默认 6px、半透明）在深色面板上几乎看不出来
    expect(rule).toMatch(/height:\s*\d+px/)
  })

  // -------------------------------------------------------------------
  // 对照组：证明上面那套"在不在顶层"的判据真的抓得住回归。
  // 没有这几条的话，一个恒真的检查器会让整组契约永远为绿。
  // -------------------------------------------------------------------
  const NESTED = [
    '/* 假设有人又把它塞回媒体查询里 */',
    '@media (max-width: 900px) {',
    '  .admin .panel .el-table-fixed-column--right { background: rgba(18,30,56,.78) !important; }',
    '}',
  ].join('\n')

  const FLAT = [
    '.admin .panel .el-table-fixed-column--right { background: rgba(18,30,56,.78) !important; }',
  ].join('\n')

  it('对照组：被 @media 包住的规则必须被判为"不在顶层"', () => {
    expect(isTopLevelSelector(NESTED, '.el-table-fixed-column--right')).toBe(false)
    // 而且它确实还在源码里 —— 证明上面那个 false 是"被包住了"，不是"找不到"
    expect(NESTED.includes('.el-table-fixed-column--right')).toBe(true)
  })

  it('对照组：顶层写的同一条规则必须被判为"在顶层"', () => {
    expect(isTopLevelSelector(FLAT, '.el-table-fixed-column--right')).toBe(true)
  })

  it('对照组：注释里的同名字符串不算"写了这条规则"', () => {
    // 源码里到处在注释里提选择器（本项目注释很密），剥注释这一步不能省 ——
    // 不剥的话"把真规则删掉、只在注释里留一句"也会被判为通过
    const onlyInComment = `/* .el-table-fixed-column--right { background: red } */`
    expect(isTopLevelSelector(onlyInComment, '.el-table-fixed-column--right')).toBe(false)
  })
})
