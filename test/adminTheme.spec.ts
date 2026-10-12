// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

describe('后台与登录框的日夜主题', () => {
  it('Markdown 编辑器跟随当前主题，而不是固定深色', () => {
    const dialog = read('app/components/admin/ArticleEditDialog.vue')
    expect(dialog).toContain(':theme="editorTheme"')
    expect(dialog).toContain("themeMode.value === 'day' ? 'light' : 'dark'")
    expect(dialog).not.toContain('theme="dark"')
  })

  it('文章与关于页的 Markdown 预览跟随主题', () => {
    for (const path of ['app/pages/about.vue', 'app/pages/article/[id].vue']) {
      const source = read(path)
      expect(source).toContain(':theme="editorTheme"')
      expect(source).toContain(':deep(.md-editor-light)')
    }
  })

  it('登录框输入底色使用主题变量', () => {
    const css = read('app/assets/css/site-shell.css')
    expect(css).toContain('background: var(--surface-2) !important')
    expect(css).not.toContain('background: #0d1b38 !important')
  })
})
