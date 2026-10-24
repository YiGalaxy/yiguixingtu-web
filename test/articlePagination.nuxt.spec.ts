import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))
mockNuxtImport('$fetch', () => fetchMock)
enableAutoUnmount(afterEach)

const body = (data) => ({ code: 200, message: '成功', data })
const pathOf = (url) => String(url).split('?')[0]

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockImplementation((url, options) => {
    const path = pathOf(url)
    if (path === '/setting') return Promise.resolve(body({ pageSize: 2 }))
    if (path === '/category/list') return Promise.resolve(body([{ id: 1, name: '技术' }]))
    if (path === '/tag/list') return Promise.resolve(body([]))
    if (path === '/article/page') {
      const page = options?.params?.page ?? 1
      const size = options?.params?.size ?? 2
      const filtered = options?.params?.categoryId === 1
      const start = (page - 1) * size
      const total = filtered ? 3 : 5
      const records = Array.from({ length: Math.max(0, Math.min(size, total - start)) }, (_, index) => ({
        id: start + index + 1,
        title: `${filtered ? '分类文章' : '文章'} ${start + index + 1}`,
        categoryName: '技术',
      }))
      return Promise.resolve(body({ records, total, current: page, size }))
    }
    return Promise.resolve(body(null))
  })
})

describe('文章图鉴分页', () => {
  it('切换页码时只请求并展示当前页，筛选条件变化后回到第一页', async () => {
    const ArticleListPage = (await import('~/pages/articles.vue')).default
    const wrapper = await mountSuspended(ArticleListPage, { route: '/articles' })
    await flushPromises()

    const requests = () => fetchMock.mock.calls
      .filter(([url]) => pathOf(url) === '/article/page')
      .map(([, options]) => options?.params)

    expect(requests()[0]).toMatchObject({ page: 1, size: 2 })
    expect(wrapper.findAll('.article-card h3').map(title => title.text())).toEqual(['文章 1', '文章 2'])

    const pageTwo = wrapper.findAll('.el-pager li.number').find(item => item.text() === '2')
    expect(pageTwo).toBeDefined()
    await pageTwo!.trigger('click')
    await vi.waitFor(() => expect(requests().at(-1)?.page).toBe(2))
    await flushPromises()

    expect(wrapper.findAll('.article-card h3').map(title => title.text())).toEqual(['文章 3', '文章 4'])
    expect(wrapper.find('.card-index').text()).toBe('03')
    expect(wrapper.find('.load-more').exists()).toBe(false)

    await wrapper.findAll('.filter-chip').find(item => item.text() === '技术')!.trigger('click')
    await vi.waitFor(() => expect(requests().at(-1)).toMatchObject({ page: 1, categoryId: 1 }))
    await flushPromises()
    expect(wrapper.findAll('.article-card h3').map(title => title.text())).toEqual(['分类文章 1', '分类文章 2'])
  })

  it('修改每页条数时回到第一页，单页时仍可切回较少条数并保留分类', async () => {
    const ArticleListPage = (await import('~/pages/articles.vue')).default
    const wrapper = await mountSuspended(ArticleListPage, { route: '/articles' })
    await flushPromises()

    const lastRequest = () => fetchMock.mock.calls
      .filter(([url]) => pathOf(url) === '/article/page').at(-1)?.[1]?.params
    await wrapper.findAll('.el-pager li.number').find(item => item.text() === '2')!.trigger('click')
    await vi.waitFor(() => expect(lastRequest()?.page).toBe(2))
    await flushPromises()

    await wrapper.get('select[aria-label="每页显示条数"]').setValue('6')
    await vi.waitFor(() => expect(lastRequest()).toMatchObject({ page: 1, size: 6 }))
    await flushPromises()
    expect(wrapper.findAll('.article-card')).toHaveLength(5)
    expect(wrapper.find('.card-index').text()).toBe('01')
    expect(wrapper.find('nav[aria-label="文章分页"]').exists()).toBe(true)
    expect(wrapper.find('select').element.value).toBe('6')

    await wrapper.findAll('.filter-chip').find(item => item.text() === '技术')!.trigger('click')
    await vi.waitFor(() => expect(lastRequest()).toMatchObject({ page: 1, size: 6, categoryId: 1 }))
    await flushPromises()
    await wrapper.get('select').setValue('2')
    await vi.waitFor(() => expect(lastRequest()).toMatchObject({ page: 1, size: 2, categoryId: 1 }))
    await flushPromises()
    expect(wrapper.findAll('.article-card')).toHaveLength(2)
    expect(wrapper.findAll('.el-pager li.number').map(item => item.text())).toEqual(['1', '2'])
  })
})
