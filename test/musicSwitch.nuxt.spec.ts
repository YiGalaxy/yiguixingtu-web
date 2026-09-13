import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { nextTick, ref } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises, enableAutoUnmount } from '@vue/test-utils'
import AppShell from '~/app.vue'
import MusicPage from '~/pages/music.vue'
import IndexPage from '~/pages/index.vue'
import { useBackgroundMusic } from '~/composables/useBackgroundMusic'
import { builtinTrack } from '~/utils/musicTracks'
import { DEFAULT_MUSIC_MODE } from '~/utils/playMode'

// =====================================================================
// 曲目列表 · 读接口 + 切歌
//
// 【这一份守的是什么】曲目**不再由前端写死**：后台上传 → `GET /music/list` →
//   前台渲染。所以这里全部用假接口喂数据，覆盖三件事：
//   ① 列表按**接口给的顺序**渲染（前端不重排），当前那一行高亮
//   ② 点一行 = 换音源（`<audio src>` 变成那一首的 `url`）+ 从 0 开始放 + 接着播
//   ③ 歌词与封面**跟着这首歌走**（接口给的 lyrics 原文优先；没有就不显示）
//   另外守"接口挂了/一首都没有时回落成内置那一首"（那条的主用例在 music.nuxt.spec.ts）。
//
// 【后端已经做完这个接口了，字段名照契约抄的】
//   `MusicVO = { id, title, artist, url, cover, lyrics, sort, status, createTime }`，
//   公开、不分页、只出 status = 1、顺序由后端保证（sort ASC, id ASC）；
//   空表返回 `code 200` + `data: []`（不是 404、也不是 null）——
//   所以下面"空数组"那条分支是**真实会出现**的，不是防御性代码。
//   但用例一律 mock `$fetch`，**不连真后端**。
//
// 【测不到什么】真的出声、真实浏览器里跨域音频能不能放（happy-dom 没有解码器、
//   也不会做 CORS 检查）。跨域那一条只测我们自己的行为：**不去读外链的文件头**。
// =====================================================================

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

const body = (data) => ({ code: 200, message: '成功', data })
const pathOf = (url) => String(url).split('?')[0]

/**
 * 假接口给的三首：**故意让 id 与 sort 都不按顺序**（30/10/20、3/1/2）——
 * 用来钉住"前端不重排"这条契约（归一化里一旦有人顺手排一下，这份用例会红）。
 * 三首的特点各不相同，正好把分支都覆盖到：
 *   · 第一首：有歌手、有封面、**有歌词原文**（应该不发 lrc 文件的请求）；
 *     音源用后台上传的真实路径形状（`/uploads/music/年/月/xxx.mp3`）
 *   · 第二首：没歌手、没封面、**没歌词**（→「暂无歌词」）；音源是站内 `/media/` 下的
 *   · 第三首：**外链音频**（用来测"地址原样当 src 用"和"不读外链的文件头"）
 */
const API_TRACKS = [
  { id: 30, title: '第一首', artist: '甲歌手', url: '/uploads/music/2026/09/first.mp3', cover: '/uploads/music/2026/09/first.png', lyrics: '[00:05.00]第一首的歌词', sort: 3, status: 1, createTime: '2026-09-11T10:00:00' },
  { id: 10, title: '第二首', artist: null, url: '/media/b.mp3', cover: null, lyrics: null, sort: 1, status: 1, createTime: '2026-09-11T10:01:00' },
  { id: 20, title: '第三首', artist: '丙歌手', url: 'https://cdn.example.com/c.mp3', cover: 'https://cdn.example.com/c.png', lyrics: '[00:07.00]第三首的歌词', sort: 2, status: 1, createTime: '2026-09-11T10:02:00' },
]

/**
 * 假后端。`overrides` 按地址覆盖（用来测"某个接口挂了"）。
 * 默认：`/music/list` 给上面三首；音频的 ID3 抓取一律给空的 ArrayBuffer（= 没有内嵌封面）。
 */
const mockBackend = (overrides = {}) => {
  fetchMock.mockImplementation((url) => {
    const path = pathOf(url)
    if (path in overrides) return overrides[path]()
    if (path === '/music/list') return Promise.resolve(body(API_TRACKS))
    if (path.endsWith('.mp3')) return Promise.resolve(new ArrayBuffer(0))
    if (path.endsWith('.lrc')) return Promise.resolve('[00:05.00]内置那一首的歌词')
    return Promise.resolve(body(null))
  })
}

// ---------------------------------------------------------------------
//  造一段**结构真实的** ID3v2.4 字节（只含一帧 APIC）—— 用来测"内嵌封面跟着切歌换"
//  （和 test/id3.spec.ts 里那套构造器是同一个思路；这里只需要最简单的一种）
// ---------------------------------------------------------------------
const concatBytes = (...parts) => {
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0))
  let offset = 0
  for (const p of parts) { out.set(p, offset); offset += p.length }
  return out
}
const ascii = (text) => new Uint8Array([...text].map(c => c.charCodeAt(0) & 0xff))
/** syncsafe：每字节只用低 7 位（ID3v2 的标签长度与 v2.4 帧长度都用它） */
const syncsafe = (n) => new Uint8Array([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f])

/** 一个最小的 ID3v2.4 标签：帧头 + APIC（UTF-8 描述 + 8 字节"图片"） */
const id3WithCover = () => {
  const picture = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const apicBody = concatBytes(
    new Uint8Array([3]),          // 编码 3 = UTF-8
    ascii('image/png'),           // MIME（以 0x00 结尾）
    new Uint8Array([0]),
    new Uint8Array([3]),          // 图片类型 3 = 正面封面
    ascii('cover'),               // 描述（单字节编码 → 一个 0x00 终止符）
    new Uint8Array([0]),
    picture,
  )
  const frame = concatBytes(ascii('APIC'), syncsafe(apicBody.length), new Uint8Array([0, 0]), apicBody)
  const tag = concatBytes(ascii('ID3'), new Uint8Array([4, 0, 0]), syncsafe(frame.length), frame)
  return tag.buffer
}

beforeEach(() => {
  fetchMock.mockReset()
  mockBackend()
  localStorage.clear()
  for (const key of Object.keys(cookieRefs)) cookieRefs[key].value = null
  // 共享状态是全局的（useState 同 key 一份）：下标与播放状态都要复位，
  // 否则上一个用例停在第二首会让下一个用例一上来就红
  const music = useBackgroundMusic()
  music.enabled.value = false
  music.playing.value = false
  music.progress.value = 0
  music.trackIndex.value = 0
  // 播放模式同样是共享状态（2026-09-13 加）：不复位的话，
  // 上一个用例把模式切成了随机，下一个用例的"下一首应该是第二首"就变成偶然事件
  music.mode.value = DEFAULT_MUSIC_MODE
})

// useAsyncData 的结果按 key 缓存在 payload 里，**释放时机是组件卸载**；
// 同一份用例文件里所有用例共用同一个 Nuxt 实例，不卸载的话下一个用例会直接沿用
// 上一个用例的曲目列表（连请求都不发）—— 与 test/index.nuxt.spec.ts 里那个坑是同一个。
afterEach(async () => {
  await nextTick()
})

/** 外壳 + 音乐页（同一棵树：provide/inject 与那个唯一的 <audio> 都在这棵树里） */
const mountPlayer = async () => {
  const wrapper = await mountSuspended(AppShell, {
    global: { stubs: { NuxtPage: MusicPage, NuxtRouteAnnouncer: true } },
  })
  await flushPromises()
  return wrapper
}

/** 外壳 + 首页（同一棵树，用来看那张迷你卡片） */
const mountHome = async () => {
  const wrapper = await mountSuspended(AppShell, {
    global: { stubs: { NuxtPage: IndexPage, NuxtRouteAnnouncer: true } },
  })
  await flushPromises()
  return wrapper
}

const audioEl = (wrapper) => wrapper.find('audio').element
const rows = (wrapper) => wrapper.findAll('.mp-tr-row')
const currentRowText = (wrapper) => {
  const row = wrapper.find('.mp-tr-row.is-cur')
  return row.exists() ? row.text() : ''
}
const mp3Fetches = () => fetchMock.mock.calls.map(c => String(c[0])).filter(u => u.endsWith('.mp3'))
const lrcFetches = () => fetchMock.mock.calls.map(c => String(c[0])).filter(u => u.endsWith('.lrc'))

/** 模拟"播放到第 N 秒" */
const playTo = async (wrapper, seconds) => {
  audioEl(wrapper).currentTime = seconds
  await wrapper.find('audio').trigger('timeupdate')
  await flushPromises()
}

describe('曲目列表 · 来自接口', () => {
  it('列表_should按接口给的顺序渲染（前端不重排），并高亮当前那一首', async () => {
    const wrapper = await mountPlayer()

    expect(rows(wrapper)).toHaveLength(3)
    // 【顺序 = 接口给的顺序】假数据里 id 是 30/10/20、sort 是 3/1/2 ——
    // 渲染出来必须一模一样。前端重排会把这套规则复制成两份，
    // 哪天后端改成置顶优先，前端这份就把它盖掉（顺序不对但页面看着正常）。
    expect(rows(wrapper).map(r => r.find('.mp-tr-name').text())).toEqual(['第一首', '第二首', '第三首'])
    // 有歌手才渲染歌手
    expect(rows(wrapper)[0].find('.mp-tr-artist').text()).toBe('甲歌手')
    expect(rows(wrapper)[1].find('.mp-tr-artist').exists()).toBe(false)

    // 当前这一首高亮（并且只有一行）
    expect(rows(wrapper)[0].classes()).toContain('is-cur')
    expect(wrapper.findAll('.mp-tr-row.is-cur')).toHaveLength(1)
    expect(currentRowText(wrapper)).toContain('第一首')

    // 音源就是接口给的 url（不做任何拼接）—— 后台上传的路径形状
    expect(wrapper.find('audio').attributes('src')).toBe('/uploads/music/2026/09/first.mp3')
    // 这一首有歌词原文 → **一次 lrc 文件的请求都不该发**。
    // （列表落定之前界面上一度是内置那一首，但那一次也不会去读它的歌词文件：
    //   列表还没落定时我们先不取，免得白读一个随后就被丢掉的 404 —— 见 loadLyrics 里的说明）
    expect(lrcFetches()).toEqual([])
    // 唱片上的曲名也是这一首
    expect(wrapper.find('.mp-title').text()).toBe('第一首')
  })

  it('表里一首歌都没有（后端返回 code 200 + data: []）_should回落成内置那一首', async () => {
    // 【这是真实会走到的分支】后端**不插种子数据**，所以"库里一首都没有"是正常状态：
    //   接口会老老实实返回 `code 200` + `data: []`（不是 404、也不是 null）。
    //   这时播放器必须照常可用（放内置那一首），而不是空列表或者"读不到"。
    mockBackend({ '/music/list': () => Promise.resolve(body([])) })
    const wrapper = await mountPlayer()

    expect(rows(wrapper)).toHaveLength(1)
    expect(rows(wrapper)[0].text()).toContain(builtinTrack().title)
    expect(rows(wrapper)[0].classes()).toContain('is-cur')
    expect(wrapper.find('audio').attributes('src')).toBe('/media/bg-music.mp3')
  })

  it('接口挂了 / 返回结构变了_should同样回落成内置那一首', async () => {
    for (const data of [{ code: 500, message: '服务器开小差了' }, body({ records: [] }), body(null)]) {
      fetchMock.mockReset()
      mockBackend({ '/music/list': () => Promise.resolve(data) })
      const wrapper = await mountPlayer()

      expect(rows(wrapper)).toHaveLength(1)
      expect(rows(wrapper)[0].text()).toContain(builtinTrack().title)
      expect(wrapper.find('audio').attributes('src')).toBe('/media/bg-music.mp3')
      // 内置那一首的歌词只能来自那个文件 → 这条路径会去取它
      expect(lrcFetches()).toEqual(['/media/bg-music.lrc'])
      expect(wrapper.text()).toContain('内置那一首的歌词')

      wrapper.unmount()
      await nextTick()
    }
  })

  it('内置那一首的歌词文件也拿不到_should显示「暂无歌词」', async () => {
    mockBackend({
      '/music/list': () => Promise.resolve(body([])),
      '/media/bg-music.lrc': () => Promise.reject(new Error('404')),
    })
    const wrapper = await mountPlayer()

    expect(wrapper.text()).toContain('暂无歌词')
    expect(wrapper.find('.mp-ly-list').exists()).toBe(false)
  })
})

describe('曲目列表 · 切歌', () => {
  it('点第二行_should换音源、从头放，并且**接着播**（不是切成暂停）', async () => {
    const wrapper = await mountPlayer()
    const music = useBackgroundMusic()

    await wrapper.find('.mp-play').trigger('click')
    await flushPromises()
    await playTo(wrapper, 12)
    expect(audioEl(wrapper).currentTime).toBe(12)

    await rows(wrapper)[1].trigger('click')
    await flushPromises()

    // ① 音源换成第二首的 url（外壳那个唯一的 <audio>）
    expect(wrapper.find('audio').attributes('src')).toBe('/media/b.mp3')
    // ② 位置归零
    expect(audioEl(wrapper).currentTime).toBe(0)
    // ③ 原来在播 → 切完还在播（最容易做错成"切歌 = 暂停"）
    expect(music.playing.value).toBe(true)
    expect(music.enabled.value).toBe(true)
    expect(wrapper.find('.mp-play').text()).toBe('❚❚')
    // ④ 高亮与封面上的曲名都跟着走
    expect(wrapper.findAll('.mp-tr-row.is-cur')).toHaveLength(1)
    expect(currentRowText(wrapper)).toContain('第二首')
    expect(wrapper.find('.mp-title').text()).toBe('第二首')
  })

  it('外链曲目_should把完整地址原样当 src 用（不拼任何前缀）', async () => {
    const wrapper = await mountPlayer()

    await rows(wrapper)[2].trigger('click')
    await flushPromises()

    expect(wrapper.find('audio').attributes('src')).toBe('https://cdn.example.com/c.mp3')
    // 【跨域那一步要被跳过】我们"额外读文件头解析内嵌封面"是普通 fetch + Range，
    //   跨域会被 CORS 预检挡住（外链基本不放行），所以干脆不发 ——
    //   注意：被挡住的是**读封面这一步**，不是播放（`<audio>` 播放根本不需要 CORS）。
    expect(mp3Fetches().filter(u => u.includes('cdn.example.com'))).toEqual([])
    // 它的封面用接口给的那张
    expect(wrapper.find('.mp-cover').attributes('src')).toBe('https://cdn.example.com/c.png')
  })

  it('暂停状态下点一行_should开始播（点了就是要听这首）', async () => {
    const wrapper = await mountPlayer()
    const music = useBackgroundMusic()
    expect(music.playing.value).toBe(false)

    await rows(wrapper)[1].trigger('click')
    await flushPromises()

    expect(music.enabled.value).toBe(true)
    expect(music.playing.value).toBe(true)
    expect(wrapper.find('audio').attributes('src')).toBe('/media/b.mp3')
  })

  it('点当前这一行_should从头再放一遍（而不是什么都不做）', async () => {
    const wrapper = await mountPlayer()

    await wrapper.find('.mp-play').trigger('click')
    await flushPromises()
    await playTo(wrapper, 12)

    await rows(wrapper)[0].trigger('click')
    await flushPromises()

    expect(audioEl(wrapper).currentTime).toBe(0)
    expect(useBackgroundMusic().trackIndex.value).toBe(0)
    expect(wrapper.find('audio').attributes('src')).toBe('/uploads/music/2026/09/first.mp3')
  })

  it('切歌_should把上一首的进度与时长清掉（界面不该停在上一个位置）', async () => {
    const wrapper = await mountPlayer()
    const music = useBackgroundMusic()

    Object.defineProperty(audioEl(wrapper), 'duration', { value: 100, configurable: true })
    await wrapper.find('audio').trigger('durationchange')
    await flushPromises()
    expect(wrapper.text()).toContain('1:40')   // 时长按 m:ss 显示
    music.report({ progress: 42 })

    // 【为什么先把时长改回 NaN】happy-dom 在 `src` 变化之后会再派发一次 durationchange，
    // 读到的是元素当下的 duration —— 不改的话界面显示的是测试伪造的那个 100 秒，
    // 这条用例就变成在测测试替身。真实浏览器里那一刻同样是"还不知道新歌多长"。
    Object.defineProperty(audioEl(wrapper), 'duration', { value: NaN, configurable: true })

    await rows(wrapper)[1].trigger('click')
    await flushPromises()

    expect(music.progress.value).toBe(0)
    expect(wrapper.text()).toContain('--:--')
    expect(wrapper.text()).not.toContain('1:40')
    expect(wrapper.find('input[aria-label="播放进度"]').element.disabled).toBe(true)
  })
})

describe('曲目列表 · 歌词跟着这首歌走', () => {
  it('切歌_should换成这一首的歌词（接口给的原文，不用取文件）', async () => {
    const wrapper = await mountPlayer()
    expect(wrapper.text()).toContain('第一首的歌词')

    await rows(wrapper)[2].trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('第三首的歌词')
    expect(wrapper.text()).not.toContain('第一首的歌词')
    // 两首都有接口给的歌词原文 → 一次 lrc 文件请求都不该发
    expect(lrcFetches()).toEqual([])
  })

  it('这一首没有歌词_should显示「暂无歌词」（而不是留着上一首的）', async () => {
    const wrapper = await mountPlayer()
    expect(wrapper.text()).toContain('第一首的歌词')

    await rows(wrapper)[1].trigger('click')   // 第二首：lyrics 是 null
    await flushPromises()

    expect(wrapper.text()).toContain('暂无歌词')
    expect(wrapper.text()).not.toContain('第一首的歌词')
    // 【这里**不**回落成 /media/bg-music.lrc】那个文件是内置那一首（bg-music.mp3）的歌词，
    // 显示在第二首下面就是**错的歌词**（比「暂无歌词」糟得多）。
    // 契约里"lyrics 为空时回落到那个文件"这一条，我按"只有音源就是内置那一首才回落"实现，
    // 规则在 app/utils/musicTracks.ts 的 lyricsFallbackUrl()，报告里也单独写了这一点。
    expect(lrcFetches()).toEqual([])
  })

  it('切歌途中旧的那份歌词才回来_should丢掉它（竞态护栏）', async () => {
    // 【这条守的是什么】取歌词是网络请求，用户完全可能在它回来之前就切了另一首。
    //   没有护栏的话，那份迟到的歌词会盖在新歌上面 —— 用户看到的是**另一首歌的歌词**，
    //   比「暂无歌词」糟得多，而且一闪而过、极难复现。
    // 【怎么把那一瞬间钉住】第一首的音源**就是内置那一首**（`/media/bg-music.mp3`），
    //   所以它的歌词走那个文件（请求挂在那里不返回）；第二首没有歌词。
    let releaseFirstLrc
    mockBackend({
      '/music/list': () => Promise.resolve(body([
        { id: 1, title: '第一首', artist: null, url: '/media/bg-music.mp3', cover: null, lyrics: null },
        { id: 2, title: '第二首', artist: null, url: '/uploads/b.mp3', cover: null, lyrics: null },
      ])),
      '/media/bg-music.lrc': () => new Promise((resolve) => { releaseFirstLrc = resolve }),
    })

    const wrapper = await mountPlayer()
    expect(wrapper.text()).toContain('歌词加载中…')

    // 用户不等了，切到第二首（没有歌词 → 直接是「暂无歌词」）
    await rows(wrapper)[1].trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('暂无歌词')

    // 第一首那份歌词文件此刻才回来 —— 它属于已经被换掉的那一首，必须被丢掉
    releaseFirstLrc('[00:05.00]第一首的歌词')
    await flushPromises()

    expect(wrapper.text()).toContain('暂无歌词')
    expect(wrapper.text()).not.toContain('第一首的歌词')
  })
})

describe('曲目列表 · 切歌时的封面', () => {
  it('每一首的封面_should分别去读（同源才读；读到就换成本首歌的封面）', async () => {
    // 第二首的音频里有内嵌封面；第一首没有
    mockBackend({ '/media/b.mp3': () => Promise.resolve(id3WithCover()) })
    // 【为什么要 stub createObjectURL —— 如实写清楚】本套环境里
    //   `URL.createObjectURL(blob)` 会抛 TypeError（happy-dom 的 Blob 与 Node 的 Blob
    //   不是同一个类）。真实浏览器里它是标准 API。这里验证的是**接线**：
    //   封面到手 → 交给页面 → 换歌时把旧的那份回收掉。
    //   ⚠️ "真实浏览器里能不能显示出内嵌封面"没有在这套环境里验证过。
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake-cover')
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    const wrapper = await mountPlayer()
    await wrapper.find('.mp-play').trigger('click')
    await flushPromises()
    // 第一首没有内嵌封面 → 用接口给的 cover
    expect(wrapper.find('.mp-cover').attributes('src')).toBe('/uploads/music/2026/09/first.png')

    await rows(wrapper)[1].trigger('click')
    await flushPromises()
    expect(wrapper.find('.mp-cover').attributes('src')).toBe('blob:fake-cover')

    // 再切回第一首：第二首那份 object URL 必须被回收（不回收 = 每切一次歌多留一份图片数据）
    await rows(wrapper)[0].trigger('click')
    await flushPromises()
    expect(revokeSpy).toHaveBeenCalled()
    expect(wrapper.find('.mp-cover').attributes('src')).toBe('/uploads/music/2026/09/first.png')

    // 同一首不会每渲染一次就读一遍文件头：切回来之后再普通地渲染几次，读数不再涨
    const readsAfterReturn = mp3Fetches().filter(u => u === '/uploads/music/2026/09/first.mp3').length
    await playTo(wrapper, 3)
    expect(mp3Fetches().filter(u => u === '/uploads/music/2026/09/first.mp3')).toHaveLength(readsAfterReturn)

    createSpy.mockRestore()
    revokeSpy.mockRestore()
  })

  it('读不到内嵌封面、接口也没给 cover_should显示占位图案（不是破图图标）', async () => {
    const wrapper = await mountPlayer()

    await rows(wrapper)[1].trigger('click')   // 第二首：cover 是 null、音频里也没有封面
    await flushPromises()

    const img = wrapper.find('.mp-cover')
    expect(img.exists()).toBe(false)          // 没有可以挂的地址 → 直接是占位
    expect(wrapper.find('.mp-cover-ph').exists()).toBe(true)
  })
})

// =====================================================================
// 播放模式 · 放完一首之后自动切（2026-09-13 新功能）
//
// 【为什么这一组必须在这个文件里】"下一首放谁"要**列表里真的有多首**才分辨得出来：
//   本文件那份假接口给的是三首（第一首 / 第二首 / 第三首），而别的文件里
//   默认只有内置那一首 —— 只有一首歌时，三档模式的表现几乎一样。
//
// 【这一组测的是完整链路】`<audio>` 派发 `ended` → 外壳按共享状态里的模式
//   调 app/utils/playMode.ts 的纯函数 → 改下标 → watch 换音源并接着播。
//   算法本身的边界（越界、脏袋子、只有一首歌……）在 test/playMode.spec.ts 里，
//   这里只验证"接线接对了"。
//
// 【模式是怎么设的】大部分用例直接写共享状态（等价于用户点了几次按钮），
//   唯独"单曲循环"那一条**点按钮**点到位 —— 顺手证明按钮 → 状态 → 行为这条链路是通的。
// =====================================================================
describe('播放模式 · 放完一首之后自动切', () => {
  const modeBtn = (wrapper) => wrapper.find('.mp-mode')
  const srcOf = (wrapper) => wrapper.find('audio').attributes('src')

  /** 开始播放（点了才会走"自动下一首"这条路：`enabled` 为真才真的 play） */
  const startPlaying = async (wrapper) => {
    await wrapper.find('.mp-play').trigger('click')
    await flushPromises()
  }

  /** 一首放完了 */
  const finishTrack = async (wrapper) => {
    await wrapper.find('audio').trigger('ended')
    await flushPromises()
  }

  it('顺序播放_放完一首 should 自动切到下一首，并接着播（不是切成暂停）', async () => {
    const wrapper = await mountPlayer()
    const music = useBackgroundMusic()
    await startPlaying(wrapper)
    expect(srcOf(wrapper)).toBe(API_TRACKS[0].url)

    await finishTrack(wrapper)

    expect(srcOf(wrapper)).toBe(API_TRACKS[1].url)
    expect(audioEl(wrapper).currentTime).toBe(0)          // 新的一首从头开始
    expect(music.playing.value).toBe(true)                // 接着播
    expect(music.enabled.value).toBe(true)
    expect(wrapper.find('.mp-play').text()).toBe('❚❚')
    // 列表高亮与唱片上的曲名都跟着走（三处说的是同一件事）
    expect(currentRowText(wrapper)).toContain('第二首')
    expect(wrapper.find('.mp-title').text()).toBe('第二首')
  })

  it('顺序播放_最后一首放完 should 停下（不循环回第一首 —— 那是另一个模式）', async () => {
    const wrapper = await mountPlayer()
    const music = useBackgroundMusic()
    await rows(wrapper)[2].trigger('click')               // 直接听最后一首
    await flushPromises()
    expect(srcOf(wrapper)).toBe(API_TRACKS[2].url)

    await finishTrack(wrapper)

    expect(music.playing.value).toBe(false)
    expect(music.progress.value).toBe(0)
    // 音源**没换**、位置**留在最后一首** —— 用户再点一下就从这一首重新开始，
    // 而不是莫名其妙被送回第一首
    expect(srcOf(wrapper)).toBe(API_TRACKS[2].url)
    expect(music.trackIndex.value).toBe(2)
    expect(wrapper.find('.mp-play').text()).toBe('▶')
  })

  it('单曲循环（点按钮切到这一档）_放完 should 把这一首从头再放，不换音源', async () => {
    const wrapper = await mountPlayer()
    const music = useBackgroundMusic()
    await startPlaying(wrapper)
    await playTo(wrapper, 12)
    expect(audioEl(wrapper).currentTime).toBe(12)

    // 顺序 → 随机 → 单曲循环（点两下按钮，走的是用户真实的那条路）
    await modeBtn(wrapper).trigger('click')
    await modeBtn(wrapper).trigger('click')
    await flushPromises()
    expect(music.mode.value).toBe('repeat-one')

    await finishTrack(wrapper)

    expect(srcOf(wrapper)).toBe(API_TRACKS[0].url)        // 同一首
    expect(audioEl(wrapper).currentTime).toBe(0)          // 从头
    expect(music.playing.value).toBe(true)
    expect(currentRowText(wrapper)).toContain('第一首')
  })

  it('随机播放_一轮之内不重复：连着放完两次，除起点外的两首各出现一次', async () => {
    // 【这条守的是"随机"的定义】每首放完就 `Math.random()` 抽一个的写法，
    //   会出现"刚放完 A 又抽到 A"（听着像卡住）和"某首歌一整晚都没轮到"。
    //   洗牌袋保证一轮内不重复 —— 这个性质**不依赖运气**，所以断言是确定的。
    const wrapper = await mountPlayer()
    const music = useBackgroundMusic()
    music.mode.value = 'shuffle'
    await startPlaying(wrapper)

    const visited = []
    for (let i = 0; i < 2; i++) {
      await finishTrack(wrapper)
      visited.push(music.trackIndex.value)
    }

    expect([...visited].sort((a, b) => a - b)).toEqual([1, 2])   // 另外两首各一次
    expect(visited[0]).not.toBe(0)                                // 不会原地重放
    expect(visited[1]).not.toBe(visited[0])                       // 也不会连着放同一首
    // 随机播放**不会停**（不管抽到哪一首，都真的换过去了）
    expect(music.playing.value).toBe(true)
  })

  it('随机播放但列表只有一首_放完 should 原曲重放（否则"随机播放放完一首就哑了"）', async () => {
    mockBackend({ '/music/list': () => Promise.resolve(body([API_TRACKS[0]])) })
    const wrapper = await mountPlayer()
    const music = useBackgroundMusic()
    music.mode.value = 'shuffle'
    await startPlaying(wrapper)
    await playTo(wrapper, 9)

    await finishTrack(wrapper)

    expect(rows(wrapper)).toHaveLength(1)
    expect(srcOf(wrapper)).toBe(API_TRACKS[0].url)
    expect(audioEl(wrapper).currentTime).toBe(0)
    expect(music.playing.value).toBe(true)
  })

  it('切模式_should在放完下一首时立刻生效（不用刷新、不用重播当前这首）', async () => {
    // 【这条防的是"模式只在页面加载时读了一次"】共享状态是响应式的，
    //   外壳那个 handler 每次都现读 `mode` —— 中途改就该中途生效。
    const wrapper = await mountPlayer()
    const music = useBackgroundMusic()
    await startPlaying(wrapper)

    music.mode.value = 'repeat-one'      // 用户听完一半决定单曲循环
    await flushPromises()
    await finishTrack(wrapper)

    expect(srcOf(wrapper)).toBe(API_TRACKS[0].url)
    expect(audioEl(wrapper).currentTime).toBe(0)
    expect(music.playing.value).toBe(true)
  })
})

describe('首页那张迷你卡片 · 跟着当前曲目', () => {
  it('卡片_should显示当前曲名（接口给的第一首），切歌之后跟着换', async () => {
    const wrapper = await mountHome()
    const music = useBackgroundMusic()

    expect(wrapper.find('#music .mu-title').text()).toBe('第一首')
    expect(wrapper.find('#music .mu-art').text()).toBe('甲歌手')
    // 卡片里没有列表（列表只在音乐页）
    expect(wrapper.find('#music .mp-tr-row').exists()).toBe(false)

    music.trackIndex.value = 1
    await flushPromises()

    expect(wrapper.find('#music .mu-title').text()).toBe('第二首')
    // 第二首没有歌手 → 歌手那一行整行不渲染
    expect(wrapper.find('#music .mu-art').exists()).toBe(false)
  })
})
