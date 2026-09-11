import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { ref } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises, enableAutoUnmount } from '@vue/test-utils'
import AppShell from '~/app.vue'
import IndexPage from '~/pages/index.vue'
import { useBackgroundMusic } from '~/composables/useBackgroundMusic'

// =====================================================================
// 背景音乐：**一份状态，三个界面**（页脚开关 / ⚙ 设置面板 / 首页音乐卡片）
//
// 【为什么要专门测这一组】改之前的状态是**局部的**：
//   app.vue 里一个 `musicOn`，首页卡片里又有自己的 `playing`，
//   两边互不知道对方 —— 页脚显示"关闭背景音乐"时，卡片可能正显示着暂停图标。
//   用户看到的就是"点了没反应"，而且从代码上看两处都是对的。
//
//   同一个 bug 还有第二层：页脚那个开关**根本没在管音乐** ——
//   它的实现是把**背景视频取消静音**（`bgVideo.muted = !musicOn`）。
//   本站的背景音乐是 `static-media/bg-music.mp3`（首页卡片在放它），
//   而背景视频是装饰性的、按设计一直静音；取消静音只会让视频自己的音轨盖在音乐上。
//   所以这里也钉住"开关音乐不会去动视频"。
// =====================================================================

const { fetchMock, cookieRefs } = vi.hoisted(() => ({ fetchMock: vi.fn(), cookieRefs: {} }))
mockNuxtImport('$fetch', () => fetchMock)
mockNuxtImport('useCookie', () => (name) => {
  if (!cookieRefs[name]) cookieRefs[name] = ref(null)
  return cookieRefs[name]
})
const { infoSpy } = vi.hoisted(() => ({ infoSpy: vi.fn() }))
vi.mock('element-plus', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    ElMessage: { ...actual.ElMessage, info: infoSpy, success: vi.fn(), error: vi.fn(), warning: vi.fn() },
  }
})

enableAutoUnmount(afterEach)

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({ code: 200, message: '成功', data: null })
  localStorage.clear()
  // 状态是全局共享的（useState 同 key 一份），所以每个用例开头都要复位，
  // 否则上一个用例留下的"音乐开着"会影响下一个
  const music = useBackgroundMusic()
  music.enabled.value = false
  music.playing.value = false
  music.progress.value = 0
})

const mountShell = async () => {
  const wrapper = await mountSuspended(AppShell, {
    global: { stubs: { NuxtPage: true, NuxtRouteAnnouncer: true } },
  })
  await flushPromises()
  return wrapper
}

describe('背景音乐 · 共享状态', () => {
  it('默认_should是关闭的（不主动放声音，也不往 localStorage 写东西）', () => {
    const { enabled, playing } = useBackgroundMusic()
    expect(enabled.value).toBe(false)
    expect(playing.value).toBe(false)
    expect(localStorage.getItem('bg-music-enabled')).toBeNull()
  })

  it('打开与关闭_should把偏好写进 localStorage（下次进站还照这个来）', () => {
    const { enabled, setEnabled, toggle } = useBackgroundMusic()

    setEnabled(true)
    expect(enabled.value).toBe(true)
    expect(localStorage.getItem('bg-music-enabled')).toBe('1')

    toggle()
    expect(enabled.value).toBe(false)
    expect(localStorage.getItem('bg-music-enabled')).toBe('0')

    toggle()
    expect(localStorage.getItem('bg-music-enabled')).toBe('1')
  })

  it('loadPreference_should把上次的偏好读回来（读了 1 就是开着）', () => {
    const { enabled, loadPreference } = useBackgroundMusic()

    localStorage.setItem('bg-music-enabled', '1')
    loadPreference()
    expect(enabled.value).toBe(true)

    localStorage.setItem('bg-music-enabled', '0')
    loadPreference()
    expect(enabled.value).toBe(false)
  })

  it('localStorage 不可用（隐私模式）_should退回默认值而不是把站点带崩', () => {
    const { enabled, loadPreference, setEnabled } = useBackgroundMusic()
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    const spySet = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })

    expect(() => loadPreference()).not.toThrow()
    expect(enabled.value).toBe(false) // 读不到就当"不播"

    // 写不进去也不该抛：背景音乐是可有可无的东西，不该有能力影响页面能不能打开
    expect(() => setEnabled(true)).not.toThrow()
    expect(enabled.value).toBe(true)

    spy.mockRestore()
    spySet.mockRestore()
  })

  it('首页卡片的播放按钮 与 页脚开关_should是同一份状态（点一处，另一处跟着变）', async () => {
    // 两个界面同时存在：一个是外壳（页脚开关在里面），一个是首页（卡片在里面）
    const shell = await mountShell()
    const home = await mountSuspended(IndexPage, {
      global: { stubs: { NuxtLink: true } },
    })
    await flushPromises()

    const footerBtn = () => shell.find('.music-toggle')
    const cardBtn = () => home.find('.mu-ctl .play')

    // 初始：两边都说"没在播"
    expect(footerBtn().text()).toContain('播放背景音乐')
    expect(cardBtn().text()).toBe('▶')

    // 点卡片上的播放 → 页脚那个开关也要变成"关闭背景音乐"
    await cardBtn().trigger('click')
    await flushPromises()
    expect(cardBtn().text()).toBe('❚❚')
    expect(footerBtn().text()).toContain('关闭背景音乐')

    // 反向：从页脚关掉 → 卡片上的按钮要回到 ▶
    await footerBtn().trigger('click')
    await flushPromises()
    expect(cardBtn().text()).toBe('▶')
    expect(footerBtn().text()).toContain('播放背景音乐')
  })

  it('开关背景音乐_should【不】去动背景视频的静音（原来的实现在这里做错了）', async () => {
    const shell = await mountShell()
    const home = await mountSuspended(IndexPage, { global: { stubs: { NuxtLink: true } } })
    await flushPromises()

    const video = shell.find('video')
    expect(video.exists()).toBe(true)
    // 背景视频按设计一直是静音的（装饰性），所以它身上必须有 muted
    expect(video.attributes('muted')).toBeDefined()

    await home.find('.mu-ctl .play').trigger('click')
    await flushPromises()
    // 开了音乐之后，视频**仍然**是静音的：
    // 老实现会把它取消静音（让视频音轨盖在音乐上），这正是这次修掉的
    expect(video.attributes('muted')).toBeDefined()
  })
})
