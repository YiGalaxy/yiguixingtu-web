// @vitest-environment node
// =====================================================================
// test/adminTableLayout.spec.ts
//
// 作用：守住后台表格的两条**布局契约**（读 `app/pages/admin.vue` 与 9 个面板的源码）：
//   ① 所有后台表格都**不许再用固定列**（`fixed="right"` / `fixed="left"` 一个都不许有）
//   ② 表格的横向滚动条必须**常显**（el-scrollbar 默认藏在悬停之后）
//
// 【为什么是这两条：它们是同一个 bug 的两半，而且我们走了两版弯路】
//   用户第一次报：「评论管理里这些列挤在一起，IP 和操作的按钮挤在一起了。」
//     · Element Plus 的固定列是 `position: sticky`；本项目的暗色主题把表格背景设成了
//       `transparent`（好让毛玻璃面板透出来）⇒ 固定列**没有自己的底色**，
//       横向滚动的内容会从它下面透上来（"字叠字"）
//     · 第一版把它补成"半透明底 + 模糊"，但包在 `@media (max-width: 900px)` 里 ——
//       而"桌面宽度下装得下"这个前提**会随列数变化而失效**（评论表加了两列之后
//       列宽合计涨到 1162px），于是 900~1460px 这一段里固定列正压着「IP」列，
//       媒体查询却还没生效
//     · 第二版把补底色改成**无条件生效** —— 穿透挡住了，但那一列从此和别的列不一样
//       （一层明显的深色块）。用户随即反馈：「操作那一列不是和前面一样的毛玻璃，而是有颜色的。」
//   ⇒ 结论：**不给这一列任何特殊对待**。整张表一起横向滚动（滚动条常显），
//     「操作」列与其他列完全同款，也就不存在"压住谁"的问题。
//
// 【为什么用"读源码"而不是挂载组件】
//   第 ① 条是**源码事实**（某个 prop 写没写），第 ② 条是**样式表结构**。
//   jsdom 不做布局、不解析媒体查询、也不算 sticky —— 挂载组件一条都证明不了。
//
// 【技术栈与关键字】
//   · `// @vitest-environment node`：只读文件、做文本分析，不必建整个 Nuxt 应用
//   · 判断"在不在 @media 里"用**大括号嵌套深度**：选择器所在位置的深度为 0 才算顶层
// =====================================================================

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()

const adminSfc = readFileSync(join(ROOT, 'app/pages/admin.vue'), 'utf8')

/** 后台面板组件的目录 + 文件名清单 */
const PANEL_DIR = join(ROOT, 'app/components/admin')
const panelFiles = readdirSync(PANEL_DIR).filter((name) => name.endsWith('.vue'))

/** 某个面板的源码 */
const panelSource = (name) => readFileSync(join(PANEL_DIR, name), 'utf8')

/**
 * 取出 SFC 里**所有** `<style>` 块的内容（拼在一起）。
 * 【为什么是"所有"而不是第一个】admin.vue 有两段（`scoped` + 全局），
 * 只取第一个会漏掉一半规则 —— 第一版就是这么写的，结果"找不到选择器"，
 * 报出来的却是断言失败，看起来像规则写错了，其实是取样取错了。
 */
export const styleOf = (sfc) =>
  [...sfc.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n')

/**
 * 剥掉 CSS 注释块。
 * 【为什么这一步不能省】本项目注释极密，而且注释里会**引用选择器**
 * （例如"原来这条规则被包在 `@media (max-width: 900px)` 里"）。
 * 不剥的话，"把真规则删掉、只在注释里留一句"也会被判为通过；
 * 注释里的 `{` / `}` 还会把大括号配对算歪，而配对一歪，深度判断就是错的。
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

/** 取出包含该选择器的**那一条规则**的文本（从选择器起到配对的右括号） */
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

/** 剥掉 HTML 注释（`<!-- … -->`） */
export const stripHtmlComments = (sfc) => sfc.replace(/<!--[\s\S]*?-->/g, '')

/**
 * 源码里有没有给某列写固定列（`fixed="right"` / `fixed="left"`）。
 *
 * ⚠️ 【必须先剥掉 HTML 注释】本项目的注释里**到处**在解释"fixed 那一列为什么会
 *    压住相邻列"，而且 HTML 注释 `<!-- … -->` 本身就能被 `<[^>]*>` 这种标签模式匹配到
 *    ⇒ 不剥注释的话，四五个面板会被误判成"还在用固定列"（第一版就是这样报的）。
 *    剥掉之后再扫标签，才是在看**真正的模板属性**。
 */
export const hasFixedColumn = (sfc) =>
  [...stripHtmlComments(sfc).matchAll(/<[^>]*>/g)].some((tag) => /\sfixed(=|[\s>])/.test(tag[0]))

const adminCss = styleOf(adminSfc)

describe('后台表格布局契约：不许用固定列，横向滚动条常显', () => {
  it('9 个后台面板的表格列里【一个固定列都没有】', () => {
    // 固定列（sticky）在"表格背景透明"的暗色主题下必然出现"字叠字"，
    // 而补底色又必然让那一列和别的列长得不一样 —— 两版弯路都试过了，
    // 所以约定是：不给它任何特殊对待，整张表一起横向滚动
    const offenders = panelFiles.filter((name) => hasFixedColumn(panelSource(name)))
    expect(offenders, `这些面板里还有固定列：${offenders.join('、')}`).toEqual([])
  })

  it('上面那条是"全都查过"的：面板文件数不少于 9（防止 glob 写错导致空集也通过）', () => {
    // 【为什么值得单写一条】如果哪天目录改名、或者过滤条件写错，
    // 上一条会在一个空集合上通过 —— 那就是最典型的假绿
    expect(panelFiles.length).toBeGreaterThanOrEqual(9)
    expect(panelFiles).toContain('CommentsPanel.vue')   // 用户报的那一个，必须在集合里
    expect(panelFiles).toContain('ArticlesPanel.vue')
  })

  it('横向滚动条【常显】：规则在顶层，而且确实把 opacity 提到了 1', () => {
    // el-scrollbar 默认 opacity: 0、悬停才显形。而现在"横向能滚"是**唯一**
    // 触达右侧列（含「操作」）的方式，藏起来等于让用户以为右边没内容
    expect(isTopLevelSelector(adminCss, '.el-scrollbar__bar.is-horizontal')).toBe(true)
    const rule = ruleBlockWith(adminCss, '.el-scrollbar__bar.is-horizontal')
    expect(rule).toMatch(/opacity:\s*1\s*!important/)
    // 还要够粗：默认 6px、半透明，在深色面板上几乎看不出来
    expect(rule).toMatch(/height:\s*\d+px/)
  })

  it('admin.vue 里【不再】给固定列补任何底色（那个方向已经被证伪）', () => {
    // 留着这条规则无害，但"有规则"会让后来的人以为固定列还在被使用 ——
    // 而它正是"操作列和别的列不一样"的来源
    expect(adminCss.includes('.el-table-fixed-column--right {')).toBe(false)
    expect(adminCss.includes('.el-table-fixed-column--left {')).toBe(false)
  })

  // -------------------------------------------------------------------
  // 对照组：证明上面那几套判据真的抓得住回归。
  // 没有这几条的话，一个恒真（或恒假）的检查器会让整组契约永远是绿的。
  // -------------------------------------------------------------------
  const NESTED = [
    '@media (max-width: 900px) {',
    '  .admin .panel .el-scrollbar__bar.is-horizontal { opacity: 1 !important; }',
    '}',
  ].join('\n')

  const FLAT = '.admin .panel .el-scrollbar__bar.is-horizontal { opacity: 1 !important; }'

  const PANEL_WITH_FIXED = [
    '<template>',
    '  <el-table :data="rows">',
    '    <el-table-column prop="ip" label="IP" width="120" />',
    '    <el-table-column label="操作" width="200" fixed="right">',
    '      <template #default="{ row }"><el-button @click="del(row)">删除</el-button></template>',
    '    </el-table-column>',
    '  </el-table>',
    '</template>',
  ].join('\n')

  const PANEL_WITHOUT_FIXED = PANEL_WITH_FIXED.replace(' fixed="right"', '')

  it('对照组：被 @media 包住的规则必须被判为"不在顶层"', () => {
    expect(isTopLevelSelector(NESTED, '.el-scrollbar__bar.is-horizontal')).toBe(false)
    // 而且它确实还在源码里 —— 证明上面那个 false 是"被包住了"，不是"找不到"
    expect(NESTED.includes('.el-scrollbar__bar.is-horizontal')).toBe(true)
  })

  it('对照组：顶层写的同一条规则必须被判为"在顶层"', () => {
    expect(isTopLevelSelector(FLAT, '.el-scrollbar__bar.is-horizontal')).toBe(true)
  })

  it('对照组：注释里的同名字符串不算"写了这条规则"', () => {
    // 源码里到处在注释里提选择器，剥注释这一步不能省
    const onlyInComment = '/* .el-scrollbar__bar.is-horizontal { opacity: 1 !important } */'
    expect(isTopLevelSelector(onlyInComment, '.el-scrollbar__bar.is-horizontal')).toBe(false)
  })

  it('对照组：带 fixed="right" 的面板源码必须被检出（否则第一条是假绿）', () => {
    expect(hasFixedColumn(PANEL_WITH_FIXED)).toBe(true)
    expect(hasFixedColumn(PANEL_WITHOUT_FIXED)).toBe(false)
    // 注释里提到 fixed 不算 —— 本项目的注释里就写着"为什么去掉它"
    expect(hasFixedColumn('<!-- 以前这里写的是 fixed="right" -->')).toBe(false)
  })
})
