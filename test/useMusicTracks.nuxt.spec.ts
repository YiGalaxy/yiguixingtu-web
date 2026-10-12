import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { clearNuxtData, useNuxtApp } from '#app'
import { useMusicTracks } from '~/composables/useMusicTracks'

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))
mockNuxtImport('$fetch', () => fetchMock)

const key = 'music-tracks'
const track = (title: string) => ({
  id: 1, title, artist: '歌手', url: '/media/song.mp3',
  cover: '/media/song.png', lyrics: '', builtin: false,
})
let session: ReturnType<typeof useMusicTracks>
let wrapper: Awaited<ReturnType<typeof mountSuspended>> | undefined
const Harness = defineComponent({
  setup() {
    session = useMusicTracks()
    return () => h('div', [
      h('span', { class: 'title' }, session.currentTrack.value.title),
      h('img', { src: session.currentTrack.value.cover }),
    ])
  },
})

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({ code: 200, data: [track('最新曲目')] })
  const app = useNuxtApp()
  app.isHydrating = false
  clearNuxtData(key)
  delete app.static.data['music-tracks']
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  const app = useNuxtApp()
  app.isHydrating = false
  clearNuxtData(key)
  delete app.static.data['music-tracks']
})

describe('音乐曲目 · SSR 缓存与刷新', () => {
  it('普通 SSR 水合复用 payload，不闪成内置曲目或重新请求', async () => {
    const app = useNuxtApp()
    app.payload.data[key] = [track('服务端曲目')]
    app.isHydrating = true

    wrapper = await mountSuspended(Harness)
    expect(wrapper.find('.title').text()).toBe('服务端曲目')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('水合首帧保留 SSR 曲名和封面，优先 payload 并避免重复请求', async () => {
    const app = useNuxtApp()
    app.payload.data[key] = [track('服务端曲目')]
    app.static.data[key] = [track('旧静态曲目')]
    app.isHydrating = true

    wrapper = await mountSuspended(Harness)
    expect(wrapper.find('.title').text()).toBe('服务端曲目')
    expect(wrapper.find('img').attributes('src')).toBe('/media/song.png')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('客户端重新进入时重新获取曲目，不沿用上次 payload 或静态缓存', async () => {
    const app = useNuxtApp()
    app.payload.data[key] = [track('上次曲目')]
    app.static.data[key] = [track('旧静态曲目')]

    wrapper = await mountSuspended(Harness)
    await flushPromises()
    expect(wrapper.find('.title').text()).toBe('最新曲目')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('手动刷新绕过 SSR 缓存并显示最新曲目', async () => {
    const app = useNuxtApp()
    app.payload.data[key] = [track('服务端曲目')]
    app.isHydrating = true
    wrapper = await mountSuspended(Harness)
    fetchMock.mockClear()

    await session.ready.refresh()
    await flushPromises()
    expect(wrapper.find('.title').text()).toBe('最新曲目')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('后台触发刷新也绕过 SSR 缓存', async () => {
    const app = useNuxtApp()
    app.payload.data[key] = [track('服务端曲目')]
    app.isHydrating = true
    wrapper = await mountSuspended(Harness)
    fetchMock.mockClear()

    await app.hooks.callHookParallel('app:data:refresh', [key])
    await flushPromises()
    expect(wrapper.find('.title').text()).toBe('最新曲目')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
