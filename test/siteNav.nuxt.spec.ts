import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { ref } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises, enableAutoUnmount } from '@vue/test-utils'
import AppShell from '~/app.vue'

const { fetchMock, cookieRefs } = vi.hoisted(() => ({ fetchMock: vi.fn(), cookieRefs: {} }))
mockNuxtImport('$fetch', () => fetchMock)
mockNuxtImport('useCookie', () => (name) => {
  if (!cookieRefs[name]) cookieRefs[name] = ref(null)
  return cookieRefs[name]
})

vi.mock('element-plus', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    ElMessage: { ...actual.ElMessage, info: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn() },
  }
})

enableAutoUnmount(afterEach)

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({ code: 200, message: '成功', data: null })
  for (const key of Object.keys(cookieRefs)) cookieRefs[key].value = null
  document.body.style.overflow = ''
})

const mountShell = async () => {
  const wrapper = await mountSuspended(AppShell, {
    route: '/',
    global: { stubs: { NuxtPage: true, NuxtRouteAnnouncer: true } },
  })
  await flushPromises()
  return wrapper
}

const burgerBtn = (w) => w.find('.nav-burger')
const navPanel = (w) => w.find('#site-mobile-nav')
const isPanelHidden = (w) => (navPanel(w).attributes('style') || '').includes('display: none')
const panelLinks = (w) => w.findAll('#site-mobile-nav .nm-item')
const desktopLinks = (w) => w.findAll('.nav-center > .nv')

describe('窄屏导航', () => {
  it('汉堡按钮初始收起并提供完整 aria 信息', async () => {
    const wrapper = await mountShell()
    const btn = burgerBtn(wrapper)
    expect(btn.attributes('aria-expanded')).toBe('false')
    expect(btn.attributes('aria-label')).toBe('打开导航菜单')
    expect(btn.attributes('aria-controls')).toBe('site-mobile-nav')
    expect(isPanelHidden(wrapper)).toBe(true)
  })

  it('汉堡按钮可以打开、再次点击关闭、Esc 和遮罩也能关闭', async () => {
    const wrapper = await mountShell()
    await burgerBtn(wrapper).trigger('click')
    expect(isPanelHidden(wrapper)).toBe(false)
    await burgerBtn(wrapper).trigger('click')
    expect(isPanelHidden(wrapper)).toBe(true)
    await burgerBtn(wrapper).trigger('click')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(isPanelHidden(wrapper)).toBe(true)
    await burgerBtn(wrapper).trigger('click')
    await wrapper.find('.nav-scrim').trigger('click')
    expect(isPanelHidden(wrapper)).toBe(true)
  })

  it('桌面与移动端使用同一批真实页面入口', async () => {
    const wrapper = await mountShell()
    const expected = [
      ['首页', '/'],
      ['归档', '/archive'],
      ['文章', '/articles'],
      ['音乐', '/music'],
      ['收藏', '/favorites'],
      ['项目', '/projects'],
      ['友链', '/links'],
      ['关于', '/about'],
    ]
    expect(desktopLinks(wrapper).map(a => [a.text(), a.attributes('href')])).toEqual(expected)
    expect(panelLinks(wrapper).map(a => [a.text(), a.attributes('href')])).toEqual(expected)
  })

  it('点击移动端链接会立即收起面板', async () => {
    const wrapper = await mountShell()
    await burgerBtn(wrapper).trigger('click')
    await panelLinks(wrapper).find(a => a.text() === '文章').trigger('click')
    await flushPromises()
    expect(isPanelHidden(wrapper)).toBe(true)
  })

  it('其他入口切换路由时也会收起面板', async () => {
    const wrapper = await mountShell()
    await burgerBtn(wrapper).trigger('click')
    expect(isPanelHidden(wrapper)).toBe(false)

    await wrapper.vm.$router.push('/?from=menu')
    await flushPromises()

    expect(isPanelHidden(wrapper)).toBe(true)
    expect(document.body.style.overflow).toBe('')
  })

  it('展开时锁定滚动，收起和卸载时恢复', async () => {
    const wrapper = await mountShell()
    await burgerBtn(wrapper).trigger('click')
    expect(document.body.style.overflow).toBe('hidden')
    await burgerBtn(wrapper).trigger('click')
    expect(document.body.style.overflow).toBe('')
    await burgerBtn(wrapper).trigger('click')
    wrapper.unmount()
    expect(document.body.style.overflow).toBe('')
  })
})
