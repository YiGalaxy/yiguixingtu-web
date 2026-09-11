// @vitest-environment node
// =====================================================================
// test/styleContract.spec.ts
//
// 作用：守住一条**样式契约** —— 「模板里用到的静态 class，必须在能作用于它的
//       样式里真的有定义」。
//
// 【为什么要有这个测试：它是被一个真 bug 逼出来的】
//   归档页的月份卡片与三个状态块都写了 class="glass"，
//   但 .glass **只在 index.vue 里以 scoped 形式定义过** —— 而 scoped 样式只对
//   它自己那个组件的模板生效。于是归档页那些元素**没有任何规则命中**：
//   没有背景、没有边框，文字直接压在背景视频上，看起来就是"和背景糊在一起"。
//   这是用户实际报上来的问题。
//   这类 bug 的特点是：**不报错、不让任何用例变红、构建也照样成功** ——
//   Vue 不会因为"你写了一个没定义的类"给你任何提示。
//   所以只能靠一条契约测试守着。
//
// 【为什么这个文件用 node 环境而不是 nuxt 环境】
//   它只读源码文件、做文本分析，不需要 Vue 运行时、不需要挂载组件，
//   所以不需要建一整个 Nuxt 应用（vitest.config.ts 里也写了"纯工具函数的测试
//   可以走普通 node 环境，会更快"）。顶部的 @vitest-environment 就是干这个的。
//
// 【判定规则（关键是"作用域"）】
//   一个类对某个组件"有定义"，只有两种情况：
//     ① 定义在【该文件自己的】<style> 里（scoped 或非 scoped 都行）
//     ② 定义在【全局】<style> 里（本项目里是 app.vue 与 admin.vue 的非 scoped 块）
//   特别注意 ② 里允许"带前缀的选择器"（例如 admin.vue 写的是 `.admin .panel`）：
//   那确实能给后台面板里的 .panel 生效，所以算"有定义"。
//   而【别的组件的 scoped 块】不算 —— 那正是归档页那个 bug 的成因。
// =====================================================================

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()

/** 第三方/框架自己的类名：不由本仓库定义，不参与这条契约 */
const EXTERNAL_PREFIXES = ['el-', 'md-', 'nuxt-']

/** 取出文件里所有 <style> 块，并标出它是不是 scoped */
export const extractStyleBlocks = (source) =>
  [...source.matchAll(/<style([^>]*)>([\s\S]*?)<\/style>/g)]
    .map(m => ({ scoped: /\bscoped\b/.test(m[1]), css: m[2] }))

/** 从一段 CSS 里取出所有类选择器名（.foo -> foo） */
export const classNamesInCss = (css) =>
  new Set([...css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map(m => m[1]))

/**
 * 模板里**静态**写出来的类名（class="a b c"）。
 * 不看 :class（那是表达式，静态分析会误判），只看字面量属性 —— 这条契约覆盖的
 * 正是出问题的那一类写法，而 :class 里的类名由别的用例/人工核对负责。
 *
 * 【为什么要先去掉 HTML 注释】这条是踩出来的：修归档页时我在模板里写了
 * `<!-- 原来这里是 class="mu-info" ... -->` 这样的注释解释历史，
 * 结果扫描器把**注释里的类名**也当成了"用到的类"，于是刚删干净的类又被报了出来。
 * 注释是给人看的，不是"用到了这个类"，所以必须先剥掉。
 */
export const staticClassesInTemplate = (source) => {
  const tpl = /<template>([\s\S]*)<\/template>/.exec(source)
  if (!tpl) return new Set()
  const markup = tpl[1].replace(/<!--[\s\S]*?-->/g, '')
  const out = new Set()
  // (?<!:) 是为了跳过 :class="..."（不要把它当成静态类名）
  for (const m of markup.matchAll(/(?<!:)class="([^"]*)"/g)) {
    for (const c of m[1].split(/\s+/)) {
      if (c && !EXTERNAL_PREFIXES.some(p => c.startsWith(p))) out.add(c)
    }
  }
  return out
}

/** 某个组件的样式里"用了但没有任何规则命中"的类（排序后返回，便于断言） */
export const undefinedClasses = (source, globalClasses) => {
  const own = new Set()
  for (const block of extractStyleBlocks(source)) {
    for (const c of classNamesInCss(block.css)) own.add(c)
  }
  return [...staticClassesInTemplate(source)]
    .filter(c => !own.has(c) && !globalClasses.has(c))
    .sort()
}

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

/** 全局样式注册表：只取非 scoped 的块（scoped 的作用域到不了别的文件） */
const collectGlobalClasses = (files) => {
  const set = new Set()
  for (const rel of files) {
    for (const block of extractStyleBlocks(read(rel))) {
      if (block.scoped) continue
      for (const c of classNamesInCss(block.css)) set.add(c)
    }
  }
  return set
}

const walkVue = (dir) => {
  const out = []
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${entry}`
    const abs = join(ROOT, rel)
    if (statSync(abs).isDirectory()) out.push(...walkVue(rel))
    else if (entry.endsWith('.vue')) out.push(rel)
  }
  return out
}

/** 本项目的全局样式就放在这两个文件的非 scoped 块里 */
const GLOBAL_STYLE_FILES = ['app/app.vue', 'app/pages/admin.vue']
const GLOBAL_CLASSES = collectGlobalClasses(GLOBAL_STYLE_FILES)
const COMPONENT_FILES = [...walkVue('app/pages'), ...walkVue('app/components')].sort()

describe('样式契约：用到的类必须有定义', () => {
  it('全局样式里确实定义了 .glass（归档页那个 bug 的修法）', () => {
    expect(GLOBAL_CLASSES.has('glass')).toBe(true)
  })

  it('归档页的月份卡片确实带了全局的玻璃底（用户报的就是这一块没有背景）', () => {
    // 这条是"需求锁"：只断言"用到的类都有定义"不够 —— 如果有人把 class="glass"
    // 从月份卡片上删掉，契约依然通过，而用户要的"框住"又没了。
    const src = read('app/pages/archive.vue')
    expect(src).toMatch(/class="[^"]*\bar-month\b[^"]*\bglass\b/)
  })

  it('每个页面/组件模板里用到的静态类，都能在它自己的样式或全局样式里找到定义', () => {
    const offenders = []
    for (const rel of COMPONENT_FILES) {
      const missing = undefinedClasses(read(rel), GLOBAL_CLASSES)
      if (missing.length) offenders.push(`${rel}: ${missing.join(', ')}`)
    }
    // 失败信息里直接给"哪个文件、哪个类"，不用再去翻
    expect(offenders).toEqual([])
  })

  it('【对照组】扫描器真的抓得住"用了却没定义"（否则这条契约是假绿）', () => {
    const broken = '<template><div class="glass ar-month">x</div></template>\n<style scoped>.ar-month{}</style>'
    // 用空的全局注册表跑一次：glass 无处定义 -> 必须被报出来
    expect(undefinedClasses(broken, new Set())).toEqual(['glass'])
  })

  it('【对照组】定义在了自己文件里就不该报（证明它不是"永远返回空"）', () => {
    const fine = '<template><div class="glass">x</div></template>\n<style scoped>.glass{}</style>'
    expect(undefinedClasses(fine, new Set())).toEqual([])
  })

  it('【对照组】定义在全局样式里也不该报（证明全局注册表真的被用上了）', () => {
    const usesGlobal = '<template><div class="glass">x</div></template>\n<style scoped>.other{}</style>'
    expect(undefinedClasses(usesGlobal, new Set(['glass']))).toEqual([])
  })

  it('【对照组】:class 里的动态类名不算（静态分析会误判，所以明确不看它们）', () => {
    const dynamicOnly = '<template><div :class="{ on: x }">x</div></template>'
    expect(undefinedClasses(dynamicOnly, new Set())).toEqual([])
  })

  it('【对照组】注释里提到 class 不算"用到了"（这条是被自己的注释坑出来的）', () => {
    const commented = '<template><!-- 以前写的是 class="ghost" --><div class="real">x</div></template>\n<style scoped>.real{}</style>'
    expect(undefinedClasses(commented, new Set())).toEqual([])
  })
})
