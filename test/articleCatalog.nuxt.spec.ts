import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))
mockNuxtImport('$fetch', () => fetchMock)
enableAutoUnmount(afterEach)

const markdown = [
  '# 概览',
  '正文',
  '## **安装**与 `配置`',
  '### 重复标题',
  '## 重复标题',
  '```markdown',
  '# 代码里的标题',
  '```',
  '补充说明\n--------',
].join('\n\n')

const mockBackend = (content = markdown) => {
  fetchMock.mockImplementation((url) => {
    const path = String(url).split('?')[0]
    const data = path === '/article/12'
      ? { id: 12, title: '目录测试', content, viewCount: 1, tags: [], attachments: [] }
      : path === '/comment/list' ? { records: [], total: 0 } : null
    return Promise.resolve({ code: 200, message: '成功', data })
  })
}

const mountArticle = async () => {
  const ArticlePage = (await import('~/pages/article/[id].vue')).default
  const wrapper = await mountSuspended(ArticlePage, { route: '/article/12', attachTo: document.body })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  fetchMock.mockReset()
  mockBackend()
})
afterEach(() => { vi.restoreAllMocks() })

describe('文章目录', () => {
  it('目录来自实际 Markdown 渲染：识别各级标题、行内格式和 Setext 标题，忽略代码块，重复标题锚点独立', async () => {
    const wrapper = await mountArticle()
    await vi.waitFor(() => expect(wrapper.findAll('.catalog-nav a')).toHaveLength(5))
    const links = wrapper.findAll('.catalog-nav a')
    expect(links.map(link => link.text())).toEqual(['概览', '安装与 配置', '重复标题', '重复标题', '补充说明'])
    const ids = links.map(link => link.attributes('href').slice(1))
    expect(new Set(ids).size).toBe(5)
    for (const id of ids) expect(wrapper.find(`[id="${id}"]`).exists()).toBe(true)
    expect(links[2].attributes('style')).not.toBe(links[3].attributes('style'))
  })

  it('没有标题时隐藏目录，正文仍然显示', async () => {
    mockBackend('这是一篇没有章节标题的短文。')
    const wrapper = await mountArticle()
    expect(wrapper.find('.article-catalog').exists()).toBe(false)
    expect(wrapper.find('.md-editor-preview').text()).toContain('没有章节标题')
  })

  it('支持展开、隐藏边框和点击跳转；减少动态效果时直接定位，并把键盘焦点移到标题', async () => {
    const wrapper = await mountArticle()
    await vi.waitFor(() => expect(wrapper.findAll('.catalog-nav a')).toHaveLength(5))
    if (wrapper.find('.catalog-toggle').attributes('aria-expanded') === 'false') {
      await wrapper.find('.catalog-toggle').trigger('click')
    }
    await wrapper.find('.catalog-border-toggle').trigger('click')
    expect(wrapper.find('.article-catalog').classes()).toContain('is-borderless')
    expect(wrapper.find('.catalog-border-toggle').attributes('aria-pressed')).toBe('true')
    await wrapper.find('.catalog-border-toggle').trigger('click')
    expect(wrapper.find('.article-catalog').classes()).not.toContain('is-borderless')

    const link = wrapper.findAll('.catalog-nav a')[3]
    const target = document.getElementById(link.attributes('href').slice(1))!
    const scroll = vi.spyOn(target, 'scrollIntoView').mockImplementation(() => {})
    vi.spyOn(window, 'matchMedia').mockImplementation(query => ({ matches: query.includes('reduce') }) as MediaQueryList)
    await link.trigger('click')
    expect(scroll).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' })
    expect(document.activeElement).toBe(target)
    expect(window.location.hash).toBe(link.attributes('href'))
    expect(link.attributes('aria-current')).toBe('location')
  })

  it('滚动阅读时高亮当前章节', async () => {
    const wrapper = await mountArticle()
    await vi.waitFor(() => expect(wrapper.findAll('.catalog-nav a')).toHaveLength(5))
    const links = wrapper.findAll('.catalog-nav a')
    links.forEach((link, index) => {
      const target = document.getElementById(link.attributes('href').slice(1))!
      vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({ top: index < 3 ? 0 : 400 } as DOMRect)
    })
    window.dispatchEvent(new Event('scroll'))
    await vi.waitFor(() => expect(links[2].attributes('aria-current')).toBe('location'))
    expect(links.filter(link => link.attributes('aria-current'))).toHaveLength(1)
  })
})
