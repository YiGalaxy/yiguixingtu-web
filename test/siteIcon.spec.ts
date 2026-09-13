// @vitest-environment node
// =====================================================================
// test/siteIcon.spec.ts
//
// 作用：守住站点图标这件事的三条，任何一条断了都只会在"浏览器标签页上"看出来，
//       构建、lint、其它用例全都不会报错 —— 所以只能显式钉住。
//
// 【为什么值得单独一个文件】
//   2026-09-12 换图标之前的状态是这样的：public/favicon.ico 是 Nuxt 脚手架自带的
//   框架 logo（绿色双峰、品牌绿 #00DC82），而 head 里**一条 <link rel="icon"> 都没有**，
//   浏览器纯靠"猜 /favicon.ico"才显示出来。于是深蓝 + 金色的站点在标签页上顶着
//   别人家的绿色 logo，还很难查——因为页面上根本找不到这个图标的引用。
//   换完之后有四件容易再坏掉的事，这里一条一条守住：
//     ① 文件被谁删了 / 改了名（图标直接消失，页面不报错）
//     ② .ico 里只剩一档尺寸（16px 那一档是**单独画的**，丢了就退化成"512 缩到 16"的糊图）
//     ③ 图形/配色跑回框架色或别的杂色（"符合网站主题"这件事是会随时间漂走的）
//     ④ head 里那条 link 被谁顺手删掉（表现是"某些浏览器又没有图标了"）
//
// 【为什么用 node 环境，为什么用文本扫描】
//   同 styleContract.spec.ts：这里只读文件、做文本/二进制头解析，不需要 Vue 运行时。
//   nuxt.config.ts 也**不当成模块 import**（那需要 defineNuxtConfig 这个只在配置上下文
//   存在的全局），读它的源码文本即可 —— 我们要守的是"这三条 link 写在配置里"，
//   不是"Nuxt 真的把它渲染进 HTML"（后者由部署后实测页面 head 覆盖，见 README）。
// =====================================================================

import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const PUBLIC = join(ROOT, 'public')

/** 全站主题色（app/app.vue 里的 CSS 变量，这里写死是为了"改了主题色这条测试会提醒你"） */
const ACCENT = '#f2c14e'
const CYAN = '#59d6e6'

const readText = (path: string) => readFileSync(path, 'utf8')

/**
 * 解析 ICO 头，返回里面每一帧的尺寸。
 *
 * 【为什么不引一个图片库】ICO 的头是固定格式，二十行就够，而为了"读一下尺寸"
 * 往 devDependencies 里加一个包（还得跟着升级、还得过 CI）不划算：
 *   ICONDIR  = 6 字节（保留 2 + 类型 2 + 帧数 2）
 *   每帧目录项 = 16 字节，头两个字节是宽、高（0 表示 256）
 */
const icoFrames = (buffer: Buffer) => {
  const count = buffer.readUInt16LE(4)
  const sizes: Array<[number, number]> = []
  for (let i = 0; i < count; i++) {
    const offset = 6 + i * 16
    const w = buffer[offset] === 0 ? 256 : buffer[offset]
    const h = buffer[offset + 1] === 0 ? 256 : buffer[offset + 1]
    sizes.push([w, h])
  }
  return sizes
}

describe('站点图标', () => {
  it('三个图标文件_should都在 public/ 下（且不是空文件）', () => {
    for (const name of ['favicon.ico', 'favicon.svg', 'apple-touch-icon.png']) {
      const path = join(PUBLIC, name)
      expect(existsSync(path), `缺少 public/${name}`).toBe(true)
      expect(statSync(path).size, `public/${name} 是空文件`).toBeGreaterThan(200)
    }
  })

  it('favicon.ico 里_should含 16 / 32 / 48 三档（16px 那一档是单独画的，不是缩出来的）', () => {
    const sizes = icoFrames(readFileSync(join(PUBLIC, 'favicon.ico')))

    for (const want of [16, 32, 48]) {
      expect(sizes, `favicon.ico 里少了 ${want}×${want} 这一帧`).toContainEqual([want, want])
    }
  })

  it('favicon.svg_should用站点主题色画，而不是框架的品牌绿', () => {
    const svg = readText(join(PUBLIC, 'favicon.svg')).toLowerCase()

    // 矢量图是首选那一份（现代浏览器都走它），所以"配色对不对"主要看它
    expect(svg).toContain(ACCENT)
    expect(svg).toContain(CYAN)

    // Nuxt 的品牌绿：#00DC82。图标里出现它就说明又拿框架 logo 顶上了
    expect(svg).not.toContain('#00dc82')
    expect(svg).not.toContain('nuxt')
  })

  it('head 里_should挂上 svg / ico / apple-touch-icon 三条，且 svg 在前', () => {
    const config = readText(join(ROOT, 'nuxt.config.ts'))

    // 顺序有意义：浏览器挑第一个它认识的格式，svg 在前 = 新浏览器拿矢量图
    const svgAt = config.indexOf("'/favicon.svg'")
    const icoAt = config.indexOf("'/favicon.ico'")
    expect(svgAt, "nuxt.config.ts 里没有挂 /favicon.svg").toBeGreaterThan(-1)
    expect(icoAt, "nuxt.config.ts 里没有挂 /favicon.ico（老浏览器会没图标）").toBeGreaterThan(-1)
    expect(svgAt).toBeLessThan(icoAt)

    expect(config).toContain("'/apple-touch-icon.png'")
    // 移动端状态栏底色：不写的话 iOS/Android 会拿白色，和深蓝页面打架
    expect(config).toContain("theme-color")
  })
})
