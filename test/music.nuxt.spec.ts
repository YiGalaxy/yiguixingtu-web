import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { ref, nextTick } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises, enableAutoUnmount } from '@vue/test-utils'
import AppShell from '~/app.vue'
import MusicPage from '~/pages/music.vue'
import IndexPage from '~/pages/index.vue'
import { useBackgroundMusic } from '~/composables/useBackgroundMusic'
// 内置兜底那一首（接口没给曲目时列表里显示的那一条）。用它而不是写死字符串：
// 断言要跟实现同源，改名字时两处一起改
import { builtinTrack } from '~/utils/musicTracks'

// =====================================================================
// 音乐播放器（`app/pages/music.vue` + 外壳里那个唯一的 <audio>）的组件测试
//
// 【这一组守的是什么】"音乐点进去没有东西"这个用户报的问题，以及修它的那一整套架构：
//   ① 音乐页上真的有唱片、有播放键、有歌词区（不是一个空壳页面）
//   ② `<audio>` **只有一个，在外壳里** —— 页面里没有播放器，
//      所以"在首页点了播放 → 进音乐页还在播"成立，而且不存在两个实例抢一首歌
//      【这一条的**外壳侧断言**（恰好一个实例 / src / preload / loop）在
//       test/backgroundMusic.nuxt.spec.ts 的「背景音乐 · 播放器住在外壳里」那一组里；
//       这个文件守的是"音乐页与首页卡片都只是遥控器、改的是同一个播放器"】
//   ③ 转与停只改 `animation-play-state`：**元素不重建**（重建会让唱片每次跳回正上方，
//      用户看到的是"角度丢了"，而不是"停住了"）
//   ④ 拿不到歌词文件就显示「暂无歌词」，页面上**不出现任何编造的歌词**
//   ⑤ 封面读不到（没有内嵌 ID3 封面 + 回落图也不存在）时显示占位图案，**不出现破图图标**
//   ⑥ 点某一句歌词真的会跳（把外壳那个 audio 的 currentTime 改掉）
//   ⑦ 播放中当前句变化时列表滚到中间，并且**尊重 prefers-reduced-motion**
//
// 【怎么把"外壳 + 页面"一起挂上】`mountSuspended(AppShell, { stubs: { NuxtPage: MusicPage } })`
//   —— 用真实的音乐页替掉 NuxtPage 这个桩。这一步很关键：只有挂在**同一个组件树**里，
//   `app.vue` 的 `provide('bgMusicPlayer', ...)` 与音乐页的 `inject` 才真的连上，
//   断言"点歌词 → 外壳那个 audio 的 currentTime 变了"才不是自欺欺人
//   （如果两边各挂各的、再自己造一个假的播放器对象，那测的就是"假播放器"，不是这条链路）。
//
// 【测不到什么，如实写在这里】
//   · **"点了之后真的出声了没有"测不了**：测试环境（happy-dom）里的
//     HTMLMediaElement 只是个壳 —— `play()` 会把 paused 置为 false、派发 play 事件，
//     但既不解码也不出声。所以下面所有"在播/暂停"的断言，测的都是**状态与界面**，
//     不是"有没有声音"。真实出声只能人工确认（写进了报告的"没验证"那一节）。
//   · **duration 是真的读不出来的**：happy-dom 里永远是 NaN。所以涉及"拖动进度条"
//     的用例必须自己 `Object.defineProperty(el, 'duration', ...)` 造一个时长出来
//     （下面用到时都写明了这一点）——而"真实浏览器里能读到时长"这件事，
//     由代码里的 `loadedmetadata/durationchange` 处理负责，不在这条用例的覆盖范围内。
//   · CSS 动画本身看不出转没转：下面断言的是**内联样式里的 animation-play-state**，
//     它是"停止/继续"的唯一开关，也是唯一能在无头环境里断言的东西（真正的旋转观感由人眼确认）。
// =====================================================================

const { fetchMock, cookieRefs } = vi.hoisted(() => ({ fetchMock: vi.fn(), cookieRefs: {} }))
mockNuxtImport('$fetch', () => fetchMock)

// app.vue 的模板里有 `v-if="token"`，useCookie 必须返回【真的 ref】才会被模板自动解包
mockNuxtImport('useCookie', () => (name) => {
  if (!cookieRefs[name]) cookieRefs[name] = ref(null)
  return cookieRefs[name]
})

// ElMessage 会往 DOM 里插节点；换成间谍之后还能断言"取歌词失败不会弹提示"
const { errorSpy, infoSpy } = vi.hoisted(() => ({ errorSpy: vi.fn(), infoSpy: vi.fn() }))
vi.mock('element-plus', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    ElMessage: { ...actual.ElMessage, info: infoSpy, success: vi.fn(), error: errorSpy, warning: vi.fn() },
  }
})

enableAutoUnmount(afterEach)

const body = (data) => ({ code: 200, message: '成功', data })
const pathOf = (url) => String(url).split('?')[0]

/** 首页要用的后端数据（这一份用例里首页只是"同一个播放器的另一个遥控器"） */
const ARTICLES = [{ id: 31, title: '一篇文章', categoryName: '技术', viewCount: 1, createTime: '2026-09-10T10:00:00' }]

/**
 * 歌词文件的内容（就是 LRC 的正常形状）。
 * 时间点挑得离得远一点（5/10/15 秒），这样"拖到 12 秒应该是第二句"这种断言一眼可读。
 */
const LRC = [
  '[ti:背景音乐]',
  '[ar:亿轨星途]',
  '[00:05.00]第一句歌词',
  '[00:10.00]第二句歌词',
  '[00:15.00]第三句歌词',
].join('\n')

/** 默认的假后端：歌词给了，封面给一个**空的** ArrayBuffer（= 没有 ID3 封面） */
const mockBackend = (overrides = {}) => {
  fetchMock.mockImplementation((url) => {
    const path = pathOf(url)
    if (path in overrides) return overrides[path]()
    if (path === '/media/bg-music.lrc') return Promise.resolve(LRC)
    if (path === '/media/bg-music.mp3') return Promise.resolve(new ArrayBuffer(0))
    if (path === '/category/list') return Promise.resolve(body([{ id: 1, name: '技术' }]))
    if (path === '/tag/list') return Promise.resolve(body([]))
    if (path === '/article/stats') return Promise.resolve(body({ articleCount: 1, viewCount: 1, categoryCount: 1 }))
    if (path === '/article/page') return Promise.resolve(body({ records: ARTICLES, total: 1 }))
    return Promise.resolve(body(null))   // /auth/me 等
  })
}

/** 把歌词文件换成"拿不到"（404 / 网络失败都是同一条路） */
const mockLyricsMissing = () => mockBackend({ '/media/bg-music.lrc': () => Promise.reject(new Error('404')) })

/** happy-dom 里 Element.scrollIntoView 是个空实现 —— 换成间谍才能断言"滚没滚、怎么滚" */
const scrollSpy = vi.fn()
const originalScrollIntoView = Element.prototype.scrollIntoView
const originalMatchMedia = window.matchMedia

/**
 * 造一个"用户开了减少动态效果"的 matchMedia。
 * 【为什么要把这些方法都补上】`window.matchMedia` 不只是被我们的代码调用 ——
 *   依赖里（@vueuse/core 等）也会调它并往返回的对象上注册监听。
 *   只返回 `{ matches: true }` 会让它们调 `addEventListener` 时报
 *   "el.addEventListener is not a function"（调试时踩到的），
 *   于是这条用例红在**测试替身不完整**上，而不是被测代码。
 * 【为什么 matches 只对 reduced-motion 那条查询为真】其它查询（比如深浅色偏好）
 *   也跟着变 true 的话，就顺手改变了别的组件的行为 —— 那不是这条用例想测的东西。
 */
const stubMatchMedia = (reduceMotion) => {
  window.matchMedia = vi.fn(query => ({
    matches: reduceMotion && String(query).includes('reduced-motion'),
    media: String(query),
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }))
}

beforeEach(() => {
  fetchMock.mockReset()
  mockBackend()
  errorSpy.mockClear()
  infoSpy.mockClear()
  localStorage.clear()
  for (const key of Object.keys(cookieRefs)) cookieRefs[key].value = null
  // 共享状态是全局的（useState 同 key 一份），不复位的话上一个用例的"在播"会带过来
  const music = useBackgroundMusic()
  music.enabled.value = false
  music.playing.value = false
  music.progress.value = 0
  Element.prototype.scrollIntoView = scrollSpy
  scrollSpy.mockClear()
})

afterEach(() => {
  Element.prototype.scrollIntoView = originalScrollIntoView
  window.matchMedia = originalMatchMedia
})

/**
 * 挂载「外壳 + 音乐页」（见文件头：只有同一个组件树里 provide/inject 才真的连上）。
 * `NuxtRouteAnnouncer` 在单测里没有内容，stub 掉。
 */
const mountPlayer = async () => {
  const wrapper = await mountSuspended(AppShell, {
    global: { stubs: { NuxtPage: MusicPage, NuxtRouteAnnouncer: true } },
  })
  await flushPromises()
  return wrapper
}

/** 外壳里那个唯一的 <audio>（也是全站唯一的播放器） */
const audioEl = (wrapper) => wrapper.find('audio').element

/**
 * 给元素造一个总时长。
 * 【为什么必须造假】happy-dom 里 `el.duration` 永远是 NaN（没有解码器），
 * 而"拖动进度条"要求先知道总长才能把百分比换算成秒。用 defineProperty 在实例上
 * 盖一个只读属性的值，是这套环境里唯一能把进度条测起来的办法 —— 这一点如实写在这里。
 */
const defineDuration = async (wrapper, seconds) => {
  Object.defineProperty(audioEl(wrapper), 'duration', { value: seconds, configurable: true })
  await wrapper.find('audio').trigger('durationchange')
}

/** 模拟"播放到第 N 秒"（浏览器里这件事由 timeupdate 事件通知） */
const playTo = async (wrapper, seconds) => {
  audioEl(wrapper).currentTime = seconds
  await wrapper.find('audio').trigger('timeupdate')
  await nextTick()
}

/** 当前高亮的那一句歌词的文字 */
const currentLyric = (wrapper) => {
  const cur = wrapper.find('.mp-line.is-cur')
  return cur.exists() ? cur.find('.mp-line-text').text() : ''
}

/** 首页那张音乐卡片挂载（它自己**不该**有 <audio>） */
const mountHome = async () => {
  const wrapper = await mountSuspended(IndexPage)
  await flushPromises()
  return wrapper
}

/**
 * 「外壳 + 首页」挂在同一棵树里。
 * 【为什么要这样挂，而不是各挂各的】有两个原因：
 *   · 卡片上显示的是"**当前**曲目"、按钮显示的是 `playing`（真的在响）——
 *     这两样都只有外壳里那个 `<audio>` 能写出来（页面自己没有播放器）。
 *     各挂各的话，点了播放之后没有任何东西会把它置为 true。
 *   · 实测过：同一个用例里 mountSuspended 两次之后，**第一次**那棵树里由 NuxtPage
 *     渲染出来的页面子树会在下一次状态变化时被顶掉，断言就变成"元素不存在"（测试环境的坑）。
 */
const mountShellWithHome = async () => {
  const wrapper = await mountSuspended(AppShell, {
    global: { stubs: { NuxtPage: IndexPage, NuxtRouteAnnouncer: true } },
  })
  await flushPromises()
  return wrapper
}

describe('音乐页 · 播放器界面', () => {
  it('挂载后_should渲染出唱片、当前歌词区与播放键（不是一张空壳页面）', async () => {
    const wrapper = await mountPlayer()

    expect(wrapper.find('.mp-disc').exists()).toBe(true)
    // 暂停时唱片**也在 DOM 里**（这是"转与停只改 animation-play-state"的前提，
    // 用 v-if 的写法在这里就会红）
    expect(wrapper.find('.mp-disc').attributes('style')).toContain('paused')
    expect(wrapper.find('.mp-play').exists()).toBe(true)
    expect(wrapper.find('.mp-play').text()).toBe('▶')
    // 歌词区在（内容另有用例）
    expect(wrapper.find('.mp-ly-title').text()).toBe('歌词')
  })

  it('点播放_should让唱片转起来、共享状态变成"在播"；再点一次_should停住（元素不重建）', async () => {
    const wrapper = await mountPlayer()
    const music = useBackgroundMusic()
    const discBefore = wrapper.find('.mp-disc').element

    await wrapper.find('.mp-play').trigger('click')
    await flushPromises()

    // ① 共享状态：这是页脚开关 / ⚙ 面板 / 首页卡片读的同一份
    expect(music.enabled.value).toBe(true)
    expect(music.playing.value).toBe(true)
    // ② 界面：播放键变成暂停图标，唱片的内联样式变成 running
    expect(wrapper.find('.mp-play').text()).toBe('❚❚')
    expect(wrapper.find('.mp-disc').attributes('style')).toContain('running')
    // 而且外壳那个元素真的被 play() 了（不是"只有界面变了、没人去放音"）
    expect(audioEl(wrapper).paused).toBe(false)

    // ③ 【最关键的一条】唱片还是**同一个 DOM 节点**：
    //    用 v-if 重建元素的话动画会从 0 度重来，用户看到的是"每次暂停角度都跳回去"
    expect(wrapper.find('.mp-disc').element).toBe(discBefore)

    await wrapper.find('.mp-play').trigger('click')
    await flushPromises()
    expect(music.enabled.value).toBe(false)
    expect(music.playing.value).toBe(false)
    expect(wrapper.find('.mp-play').text()).toBe('▶')
    expect(wrapper.find('.mp-disc').attributes('style')).toContain('paused')
    // 停住之后仍然是同一个节点（"暂停时停"而不是"暂停时把唱片删掉重建"）
    expect(wrapper.find('.mp-disc').element).toBe(discBefore)
  })
  it('首页卡片点播放_should驱动外壳里那个唯一的 audio（两个界面共用一个播放器）', async () => {
    // 【为什么这个用例是"外壳 + 首页"一起挂，而不是"先挂外壳和音乐页、再单独挂首页"】
    //   实测（调试时发现的）：同一个用例里 mountSuspended 两次之后，**第一次**那个树里
    //   由 NuxtPage 渲染出来的页面子树会在下一次状态变化时被顶掉 ——
    //   断言就变成了"元素不存在"（与产品代码无关，是测试环境的坑）。
    //   所以每个用例只挂一棵树：这一棵里放的正是"用户真的点了首页那张卡片"的场景。
    const wrapper = await mountSuspended(AppShell, {
      global: { stubs: { NuxtPage: IndexPage, NuxtRouteAnnouncer: true } },
    })
    await flushPromises()
    const music = useBackgroundMusic()
    const audio = wrapper.find('audio').element
    expect(audio.paused).toBe(true)

    await wrapper.find('#music .mu-ctl .play').trigger('click')
    await flushPromises()

    // ① 共享状态：这一份是全站唯一的（页脚开关、⚙ 面板、音乐页读的都是它）
    expect(music.enabled.value).toBe(true)
    expect(music.playing.value).toBe(true)
    // ② 元素真的被 play() 了（happy-dom 会把 paused 置为 false）——
    //    也就是说"点首页卡片"这件事确实落到了外壳那个播放器上，
    //    而不是"只有状态变了、没人去放音"
    expect(audio.paused).toBe(false)
    // ③ 卡片自己跟着变：按钮变成暂停图标、小唱片转起来
    expect(wrapper.find('#music .mu-ctl .play').text()).toBe('❚❚')
    expect(wrapper.find('#music .mu-disc').attributes('style')).toContain('running')
    // ④ 全树只有一个 audio，而且它**不在** #music 里面 —— 首页卡片是遥控器、不是播放器。
    //    真实应用里外壳从不卸载，所以"点了播放再进音乐页"时响的还是这一个元素
    //    （音乐页那边读的是同一份状态，见上面那组用例）
    expect(wrapper.findAll('audio')).toHaveLength(1)
    expect(wrapper.find('#music').find('audio').exists()).toBe(false)
  })
})

describe('音乐页 · 歌词', () => {
  it('歌词文件拿不到（404）_should显示「暂无歌词」，且页面上不出现任何编造的歌词', async () => {
    mockLyricsMissing()
    const wrapper = await mountPlayer()

    expect(wrapper.text()).toContain('暂无歌词')
    // 列表整个不渲染（空的滚动区比没有更让人困惑）
    expect(wrapper.find('.mp-ly-list').exists()).toBe(false)
    // 大字区也是空的 —— 本项目对缺失数据的态度是"要么真数据、要么不显示"
    expect(wrapper.find('.mp-now').text()).toBe('')
    expect(currentLyric(wrapper)).toBe('')
    // 取歌词失败**不该弹提示**：站里还没有这个文件不是错误，页面已经说清楚了
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('歌词还没取回来时_should显示「歌词加载中…」（和「暂无歌词」是两件事）', async () => {
    // 【为什么要区分这两个状态】都是空列表，但用户该做的事不同：
    // 前者等一下就好，后者说明站里根本没有这个文件。
    // 这里用手动控制的 Promise 把"请求还在飞"的那一刻**定格**下来 ——
    // 不这么做的话，进页面的那一瞬间就取完了，"加载中"这一帧根本抓不住（用例会随机红）
    let releaseLyrics
    mockBackend({ '/media/bg-music.lrc': () => new Promise((resolve) => { releaseLyrics = resolve }) })
    const wrapper = await mountPlayer()

    expect(wrapper.text()).toContain('歌词加载中…')
    expect(wrapper.text()).not.toContain('暂无歌词')

    // 放行之后才变成真正的歌词列表
    releaseLyrics(LRC)
    await flushPromises()
    expect(wrapper.findAll('.mp-line')).toHaveLength(3)
    expect(wrapper.text()).not.toContain('歌词加载中…')
  })

  it('歌词解析成功_should渲染列表，并按播放位置高亮当前句（大字区同步）', async () => {
    const wrapper = await mountPlayer()

    expect(wrapper.findAll('.mp-line')).toHaveLength(3)

    // 播到第 12 秒：按 LRC 的时间戳应该落在「第二句歌词」（10s 那句）
    await playTo(wrapper, 12)
    expect(currentLyric(wrapper)).toBe('第二句歌词')
    expect(wrapper.find('.mp-line.is-cur').exists()).toBe(true)
    // 高亮只有一条（同时高亮两句是最容易犯的错）
    expect(wrapper.findAll('.mp-line.is-cur')).toHaveLength(1)
    // 大字区显示同一句
    expect(wrapper.find('.mp-now').text()).toBe('第二句歌词')
  })

  it('前奏（还没到第一句）_should不高亮任何一句，大字区也不硬塞第一句', async () => {
    const wrapper = await mountPlayer()

    await playTo(wrapper, 1)
    // 硬塞第一句的表现是"音乐一起就高亮第一句"，用户以为已经在唱了
    expect(wrapper.findAll('.mp-line.is-cur')).toHaveLength(0)
    expect(wrapper.find('.mp-now').text()).toBe('')
  })

  it('点某句歌词_should把它设成外壳那个 audio 的 currentTime（真的跳过去）', async () => {
    const wrapper = await mountPlayer()
    expect(audioEl(wrapper).currentTime).toBe(0)

    // 点第三句（LRC 里是 15 秒）
    await wrapper.findAll('.mp-line')[2].trigger('click')
    await flushPromises()

    expect(audioEl(wrapper).currentTime).toBe(15)
    await nextTick()
    // 跳过去之后高亮也跟着过去（进度回写是立刻的，不用等下一次 timeupdate）
    expect(currentLyric(wrapper)).toBe('第三句歌词')
  })

  it('播放中当前句变化_should把这一句滚到列表中间（用平滑滚动）', async () => {
    const wrapper = await mountPlayer()
    await wrapper.find('.mp-play').trigger('click')   // 没在播时不滚（见实现里的理由）
    await flushPromises()
    scrollSpy.mockClear()

    await playTo(wrapper, 12)
    await flushPromises()

    expect(scrollSpy).toHaveBeenCalledTimes(1)
    // block: 'center' —— 贴着顶部滚的话用户看不到"下一句要来了"，
    // 而歌词的价值有一半在提前看到下一句
    expect(scrollSpy.mock.calls[0][0]).toMatchObject({ block: 'center', behavior: 'smooth' })
  })

  it('用户开了"减少动态效果"_should改用不平滑的滚动（这个项目到处都在照顾这个偏好）', async () => {
    stubMatchMedia(true)
    const wrapper = await mountPlayer()
    await wrapper.find('.mp-play').trigger('click')
    await flushPromises()
    scrollSpy.mockClear()

    await playTo(wrapper, 12)
    await flushPromises()

    expect(scrollSpy).toHaveBeenCalledTimes(1)
    // 平滑滚动对一部分人会引起眩晕，prefers-reduced-motion 就是他们表达"别给我动"的方式
    expect(scrollSpy.mock.calls[0][0]).toMatchObject({ block: 'center', behavior: 'auto' })
  })

  it('暂停时_should不自动滚动（用户可能正在往上翻歌词，把他拽回来是最讨厌的交互）', async () => {
    const wrapper = await mountPlayer()
    const music = useBackgroundMusic()
    expect(music.playing.value).toBe(false)
    scrollSpy.mockClear()

    await playTo(wrapper, 12)
    await flushPromises()

    expect(currentLyric(wrapper)).toBe('第二句歌词')   // 高亮照常
    expect(scrollSpy).not.toHaveBeenCalled()            // 但不滚
  })
})

describe('音乐页 · 封面与控制条', () => {
  it('封面加载失败_should换成占位图案，而不是留一个破图图标', async () => {
    const wrapper = await mountPlayer()
    // 现在这首歌没有内嵌 ID3 封面，所以会去取 static-media/cover-1.png
    // （那个文件 2026-09-11 起是真的存在了，但这里手动触发 error，
    //  验证的是"取不到封面时"的兜底 —— 文件被误删、CDN 抽风、
    //  部署时忘了传，都会走到这条路上）
    const img = wrapper.find('.mp-cover')
    expect(img.exists()).toBe(true)
    expect(img.attributes('src')).toBe('/media/cover-1.png')

    await img.trigger('error')
    await nextTick()

    // 失败之后不再挂 <img>（没有破图图标），换成画出来的占位
    expect(wrapper.find('.mp-cover').exists()).toBe(false)
    expect(wrapper.find('.mp-cover-ph').exists()).toBe(true)
    expect(wrapper.find('.mp-cover-ph').text()).toBe('♪')
  })

  it('总时长读不出来时_should禁用进度拖动、显示 --:--（而不是让人拖一个没反应的条）', async () => {
    const wrapper = await mountPlayer()

    // happy-dom 里 duration 永远是 NaN —— 也就是"还没读到元数据"的状态
    const seek = wrapper.find('input[aria-label="播放进度"]')
    expect(seek.element.disabled).toBe(true)
    expect(wrapper.text()).toContain('--:--')
  })

  it('拖动进度条_should在松手时把播放位置跳到那里', async () => {
    const wrapper = await mountPlayer()
    await defineDuration(wrapper, 100)
    await nextTick()

    const seek = wrapper.find('input[aria-label="播放进度"]')
    expect(seek.element.disabled).toBe(false)
    expect(wrapper.text()).toContain('1:40')   // 总时长按 m:ss 显示

    // 拖动过程中（input）先不跳，松手（change）才跳 ——
    // 每拖一格都 seek 一次会让声音一顿一顿的
    seek.element.value = '40'
    await seek.trigger('input')
    expect(audioEl(wrapper).currentTime).toBe(0)

    await seek.trigger('change')
    await flushPromises()
    expect(audioEl(wrapper).currentTime).toBe(40)
  })

  it('音量与静音_should落到元素上，并且音量会被记住', async () => {
    const wrapper = await mountPlayer()
    const audio = audioEl(wrapper)

    const volume = wrapper.find('input[aria-label="音量"]')
    volume.element.value = '0.3'
    await volume.trigger('input')
    await flushPromises()

    expect(audio.volume).toBeCloseTo(0.3)
    // 音量是长期偏好：不落盘的话刷新页面就回到 100%，用户得每次重调
    expect(localStorage.getItem('bg-music-volume')).toBe('0.3')

    // 静音：只切换 muted，**不动**用户选的音量（取消静音要回到 0.3）
    await wrapper.find('.mp-vol-btn').trigger('click')
    expect(audio.muted).toBe(true)
    expect(audio.volume).toBeCloseTo(0.3)

    await wrapper.find('.mp-vol-btn').trigger('click')
    expect(audio.muted).toBe(false)
  })

  it('拖拉音量_should顺手取消静音（否则会出现"音量拖上去了却还是没声音"）', async () => {
    const wrapper = await mountPlayer()
    const audio = audioEl(wrapper)

    await wrapper.find('.mp-vol-btn').trigger('click')
    expect(audio.muted).toBe(true)

    const volume = wrapper.find('input[aria-label="音量"]')
    volume.element.value = '0.6'
    await volume.trigger('input')
    await flushPromises()

    expect(audio.muted).toBe(false)
    expect(audio.volume).toBeCloseTo(0.6)
  })

  it('⚠️ 进度条「已播放」那一截要有颜色：轨道上的 --mp-fill 跟着播放进度走', async () => {
    // 【钉的是用户报的那个 bug】"已经播放部分的进度条没有颜色"。
    //   根因：原生 `<input type="range">` 在 Chrome / Edge / Safari 下**没有"已播放"
    //   这个元素**（只有 Firefox 提供 `::-moz-range-progress`），所以只能在轨道底色上
    //   按进度**硬切**一条渐变 —— 而那个分界点就是这里绑的 `--mp-fill`。
    //   它没绑上、或者绑成了 NaN / undefined，表现恰恰就是"滑块左右一个颜色"。
    //   ⚠️ 断言的是**内联样式里那个 CSS 变量**：happy-dom 不做布局、也不求值渐变，
    //   真正的视觉观感只能人工确认（和"唱片转不转"是同一条限制，如实写在这里）。
    const wrapper = await mountPlayer()
    await defineDuration(wrapper, 120)

    // 用 aria-label 定位，不靠"第几个 input" —— 控制条上还有一个音量滑块
    const range = () => wrapper.find('input[aria-label="播放进度"]')

    // 还没开始播：0%（不是 NaN、也不是 100% —— 时长未知时若给 100，整条轨道都会是"已播放"色）
    expect(range().attributes('style')).toMatch(/--mp-fill:\s*0%/)

    await playTo(wrapper, 30)
    expect(range().attributes('style')).toMatch(/--mp-fill:\s*25%/)

    await playTo(wrapper, 90)
    expect(range().attributes('style')).toMatch(/--mp-fill:\s*75%/)

    await playTo(wrapper, 120)
    expect(range().attributes('style')).toMatch(/--mp-fill:\s*100%/)
  })

  it('⚠️ 音量条也要有「已填充」的颜色：--mp-fill 跟着音量走（静音时归零）', async () => {
    // 【为什么这条要单独钉】两条滑块共用一个类，而"颜色该画在哪儿"这件事第一版搞错了
    //   （画在 `input` 自己的 `background` 上，被原生轨道的默认底色**整个盖住**），
    //   表现就是**进度条和音量条一起没颜色** —— 用户两条都报了。
    const wrapper = await mountPlayer()
    const vol = () => wrapper.find('input[aria-label="音量"]')

    // 音量默认 1 → 整条都是"已填充"色
    expect(vol().attributes('style')).toMatch(/--mp-fill:\s*100%/)

    const slider = wrapper.find('input[aria-label="音量"]')
    slider.element.value = '0.4'
    await slider.trigger('input')
    await flushPromises()
    // ⚠️ 这里是**取整**后的 40%：`0.4 * 100` 在 JS 里是 40.00000000000001，
    //    直接拼进 CSS 会得到一个又长又丑的值（能跑，但不该这么写）
    expect(vol().attributes('style')).toMatch(/--mp-fill:\s*40%/)

    // 静音时那一截归零 —— 否则"静音了但条还是满的"看起来像没静音成功
    await wrapper.find('.mp-vol-btn').trigger('click')
    await flushPromises()
    expect(vol().attributes('style')).toMatch(/--mp-fill:\s*0%/)
  })

  it('⚠️ 时长读到 NaN 的那一次_should保持上一个有效时长（否则进度条会自己跑到最右并锁死）', async () => {
    // 【用户报的第三个症状】"几秒的时间里拉到了最后，然后就拖动不了了"。
    //   浏览器在**音源切换 / 尚未就绪 / 加载失败**时会发一次 duration 为 NaN 的
    //   `durationchange`（换歌、接口回来之后换 src、音频 404 都会触发）。
    //   旧写法把它收成 0 ⇒ 进度条的 `max` 从 180 变成 1，而 `value`（当前秒数）
    //   还是刚才那几秒 ⇒ **滑块被浏览器夹到最右端**；
    //   同时 `:disabled="duration <= 0"` 把它置灰 ⇒ **拖不动了**。
    //   三个症状（没颜色、跑到最右、拖不动）其实是同一处引发的。
    const wrapper = await mountPlayer()
    await defineDuration(wrapper, 180)
    const range = () => wrapper.find('input[aria-label="播放进度"]')

    expect(range().attributes('max')).toBe('180')
    expect(range().attributes('disabled')).toBeUndefined()

    await playTo(wrapper, 5)
    expect(range().attributes('max')).toBe('180')

    // 浏览器发来的那一次"读不到时长"
    await defineDuration(wrapper, NaN)

    // 必须**保持** 180：清零会让 max 变成 1、滑块被夹到最右、并且被 disabled 锁死
    expect(range().attributes('max')).toBe('180')
    expect(range().attributes('disabled')).toBeUndefined()
  })

  it('⚠️ 时长还没读出来时_should显示「未知」而不是把滑块顶到最右（"迅速跳完+拖不动"的根因）', async () => {
    // 【用户报的现象】第一次打开网站 → 进音乐页 → 点播放 → 进度条几秒内跳完、然后拖不动。
    //   机制：时长还没读出来时，进度条的 `max` 退化成兜底值 **1**，而 `value` 绑的是当前秒数
    //   —— 播放一秒后 value 就超过 max ⇒ 浏览器**把滑块夹到最右端**；
    //   同时 `:disabled="duration <= 0"` 又把它置灰 ⇒ 表现就是"跳完了、而且拖不动"。
    //   ⇒ 修法：时长未知时把 value 也一起收成 0，让它老老实实待在左边。
    const wrapper = await mountPlayer()
    const range = () => wrapper.find('input[aria-label="播放进度"]')

    // happy-dom 里 el.duration 是 NaN ⇒ 页面读到的时长是 0（= 还不知道）
    expect(range().attributes('disabled')).toBeDefined()

    await playTo(wrapper, 5)   // 播放推进到第 5 秒
    // ★ 关键两条：位置必须还是 0、填充也必须是 0 —— 而不是被顶到最右并"填满"
    expect(range().attributes('value')).toBe('0')
    expect(range().attributes('max')).toBe('1')
    expect(range().attributes('style')).toMatch(/--mp-fill:\s*0%/)
  })

  it('★ 时长晚一点才读出来_should自己补上并且恢复可拖动（不依赖那两个事件）', async () => {
    // 【为什么这条最要紧】`loadedmetadata` / `durationchange` 在某些时刻给出的是 NaN 或
    //   Infinity（首次访问、还没缓冲够时很常见），而且**不一定再来一次** ——
    //   只靠事件的话进度条会永远停在"未知"、永远拖不动。
    //   所以 timeupdate（每 250ms 一次）里加了一次兜底补读。
    const wrapper = await mountPlayer()
    const range = () => wrapper.find('input[aria-label="播放进度"]')

    await playTo(wrapper, 3)
    expect(range().attributes('max')).toBe('1')       // 还没读到 ⇒ 未知状态

    // 【故意不触发 durationchange / loadedmetadata】只把属性值挂上去，
    // 模拟"事件错过、或者当时给的是 NaN"那种情况
    Object.defineProperty(audioEl(wrapper), 'duration', { value: 120, configurable: true })
    await playTo(wrapper, 3)                          // 下一次 timeupdate 顺手补上

    expect(range().attributes('max')).toBe('120')     // ★ 补上了
    expect(range().attributes('value')).toBe('3')     // ★ 位置也跟上了（不再固定在 0）
    expect(range().attributes('disabled')).toBeUndefined()
  })
})

describe('外壳里的播放器 · 状态回写', () => {
  it('播放进度_should节流回写共享状态（timeupdate 触发得比帧还勤）', async () => {
    const wrapper = await mountPlayer()
    const music = useBackgroundMusic()
    await defineDuration(wrapper, 100)

    // 一次明显的跳变（0% → 10%）要立刻写：拖完进度条、或浏览器一次跳一大段时，
    // 界面不能等下一次 250ms 的窗口
    await playTo(wrapper, 10)
    expect(music.progress.value).toBeCloseTo(10)

    // 紧随其后的一次微小变化（10% → 10.01%）在 250ms 窗口内**不写**：
    // progress 是 useState（全站共享、多处渲染），每帧都写等于把响应式系统跑满
    await playTo(wrapper, 10.01)
    expect(music.progress.value).toBeCloseTo(10)
  })

  it('audio 的 ended 事件_should把状态切回"没在播"（防御性路径，如实说明）', async () => {
    const wrapper = await mountPlayer()
    const music = useBackgroundMusic()

    await wrapper.find('.mp-play').trigger('click')
    await flushPromises()
    expect(music.playing.value).toBe(true)
    music.progress.value = 42

    await wrapper.find('audio').trigger('ended')
    expect(music.playing.value).toBe(false)
    expect(music.progress.value).toBe(0)

    // 【如实说明】生产代码里 `<audio>` 带 `loop`，浏览器**不会**派发 ended ——
    // 这条断言是手工 dispatch 出来的，它证明的是"万一它触发了，状态有主"，
    // 而不是"线上会走到这条路径"。留着它的理由写在 app.vue 那段注释里
    //（哪天去掉 loop 支持"播完停"时，这条路径就是主要路径了）。
  })
})

describe('首页那张音乐卡片 · 小播放器', () => {
  it('卡片_should有播放键与进度条、指向 /music 的真链接，并且自己不含 <audio>', async () => {
    const wrapper = await mountHome()

    expect(wrapper.find('#music').exists()).toBe(true)
    expect(wrapper.find('.mu-ctl .play').exists()).toBe(true)
    expect(wrapper.find('.mu-progress').exists()).toBe(true)
    // 上一个/下一个按钮是编出来的假功能（只有一个音轨），这次也没有加回来
    expect(wrapper.findAll('.mu-ctl button')).toHaveLength(1)

    // 【为什么必须是 <a href>】"完整播放器 →"要是可爬的内链，也要能中键新开 ——
    // 用 @click + navigateTo 的话这两件事都做不到
    const more = wrapper.find('.mu-more')
    expect(more.element.tagName).toBe('A')
    expect(more.attributes('href')).toBe('/music')
    expect(more.text()).toContain('完整播放器')

    // 卡片里没有播放器（播放器在外壳里，全站只有一个）
    expect(wrapper.findAll('audio')).toHaveLength(0)
    // 也没有曲目列表：卡片是"小"的那一半，列表是音乐页的事（塞进来会把首页那一行撑成长条）
    expect(wrapper.find('#music .mp-tr-row').exists()).toBe(false)
    expect(wrapper.find('#music .mu-tracks').exists()).toBe(false)
  })

  it('卡片上的小唱片_should跟着共享状态转与停，而且不重建元素', async () => {
    const wrapper = await mountHome()
    const music = useBackgroundMusic()
    const discBefore = wrapper.find('.mu-disc').element

    expect(wrapper.find('.mu-disc').attributes('style')).toContain('paused')

    music.playing.value = true
    await nextTick()
    expect(wrapper.find('.mu-disc').attributes('style')).toContain('running')
    expect(wrapper.find('.mu-disc').element).toBe(discBefore)

    music.playing.value = false
    await nextTick()
    expect(wrapper.find('.mu-disc').attributes('style')).toContain('paused')
    expect(wrapper.find('.mu-disc').element).toBe(discBefore)
  })

  it('卡片封面加载失败_should换成占位图案（现在线上走的就是这条路）', async () => {
    const wrapper = await mountHome()

    expect(wrapper.find('.mu-disc-img').attributes('src')).toBe('/media/cover-1.png')
    await wrapper.find('.mu-disc-img').trigger('error')
    await nextTick()

    expect(wrapper.find('.mu-disc-img').exists()).toBe(false)
    expect(wrapper.find('.mu-disc-ph').exists()).toBe(true)
  })

  it('卡片上的播放键_should是共享状态的开关（点一下，状态跟着变）', async () => {
    const wrapper = await mountHome()
    const music = useBackgroundMusic()

    await wrapper.find('.mu-ctl .play').trigger('click')
    await flushPromises()
    expect(music.enabled.value).toBe(true)

    // 【为什么这里不断言按钮变成 ❚❚】在没有外壳的这次挂载里根本没有 <audio>，
    // 也就没人会把"真的在响"写回共享状态 —— 按钮显示的是 `playing`（真的在响），
    // 所以它（正确地）仍然是 ▶。这正是"enabled 是意图、playing 是事实"的体现；
    // 挂上外壳之后按钮会变成 ❚❚，那一条由上面「首页卡片点播放」那条用例覆盖。
    expect(wrapper.find('.mu-ctl .play').text()).toBe('▶')
    expect(music.playing.value).toBe(false)
  })
})

describe('音乐页 · 曲目列表（接口没给曲目时的回落）', () => {
  it('接口挂了 / 一首都没上传_should回落成内置那一首，而不是空列表', async () => {
    // 这一份用例的假后端对 `/music/list` 一律回 `data: null`（= 接口失败或者站里没歌）。
    // 【为什么这条是产品要求】背景音乐是次要功能，它不该被一个接口带着一起崩：
    //   站长一首都没上传时，播放器照样要能放 —— 也就是今天的行为。
    const wrapper = await mountPlayer()

    const rows = wrapper.findAll('.mp-tr-row')
    expect(rows).toHaveLength(1)
    expect(rows[0].text()).toContain(builtinTrack().title)
    expect(wrapper.find('.mp-tr-title').text()).toBe('曲目')

    // 当前这一首高亮（只有一行，所以就是它）
    expect(rows[0].classes()).toContain('is-cur')
    expect(wrapper.findAll('.mp-tr-row.is-cur')).toHaveLength(1)

    // 而且它真的能放：外壳那个 <audio> 指着内置音源
    expect(wrapper.find('audio').attributes('src')).toBe('/media/bg-music.mp3')
    // 没有歌手的曲目：歌手那一格**不渲染**（不编名字，也不留空格子）
    expect(rows[0].find('.mp-tr-artist').exists()).toBe(false)
  })

  it('点当前这一行_should从头再放一遍（而不是什么都不做）', async () => {
    const wrapper = await mountPlayer()
    const music = useBackgroundMusic()

    await wrapper.find('.mp-play').trigger('click')
    await flushPromises()
    await playTo(wrapper, 30)
    expect(audioEl(wrapper).currentTime).toBe(30)

    await wrapper.find('.mp-tr-row').trigger('click')
    await flushPromises()

    expect(audioEl(wrapper).currentTime).toBe(0)
    // 从头放但**没有**被切成暂停（点一行 = 我要听这首）
    expect(music.playing.value).toBe(true)
    expect(wrapper.find('.mp-play').text()).toBe('❚❚')
  })
})

describe('界面文案 · 不给用户讲实现', () => {
  /**
   * 【用户的明确要求】界面上不许出现"给用户讲实现"的话：
   * 播放器住在哪、切页面会不会断、SSR/接口/缓存/文件路径/批次与日期……
   * 写给用户看的只有"他能感知到什么"（曲名、时长、怎么用）。
   *
   * 【为什么这条要写成用例】文案是最容易被"顺手加一句说明"改回去的东西：
   * 有人看到页面上空着一块、或者想让功能显得高级，就会写一句
   * 「站点自带的背景音轨 · 全站只有这一个播放器（住在外壳里，切页面不会断）」——
   * 那正是用户报的原话。把它钉住，改回去就会当场红。
   * 这里用的是那句话的**特征片段**，而不是整句：整句只要标点变了就测不出来了。
   */
  const IMPLEMENTATION_TALK = [
    '站点自带音轨',          // 原来卡片/音乐页上那个"歌手位"
    '站点自带的背景音轨',    // 原音乐页标题下那句
    '全站只有这一个播放器',
    '住在外壳里',
    '切页面不会断',
  ]

  it('音乐页_should不出现任何"讲实现"的句子，而该有的信息都在', async () => {
    const wrapper = await mountPlayer()
    const text = wrapper.text()

    for (const phrase of IMPLEMENTATION_TALK) {
      expect(text, `音乐页不该出现「${phrase}」`).not.toContain(phrase)
    }

    // 反面：用户能感知到的信息一个都不能少 —— 页名、曲名、歌词区、播放状态
    expect(wrapper.find('.mp-h1').text()).toBe('音乐')
    expect(wrapper.find('.mp-title').text()).toBe(builtinTrack().title)
    expect(wrapper.find('.mp-ly-title').text()).toBe('歌词')
    expect(['正在播放', '已暂停']).toContain(wrapper.find('.mp-state').text())
  })

  it('首页与外壳_should同样不出现这类句子', async () => {
    const shellWithHome = await mountShellWithHome()
    const text = shellWithHome.text()

    for (const phrase of IMPLEMENTATION_TALK) {
      expect(text, `首页/外壳不该出现「${phrase}」`).not.toContain(phrase)
    }
    // 卡片上显示的是**曲名**（接口给的当前曲目；接口没给就是内置那一首），
    // 不是"站点自带音轨"那种说明
    expect(shellWithHome.find('#music .mu-title').text()).toBe(builtinTrack().title)
    // 没有歌手 → 歌手那一行整行不渲染
    expect(shellWithHome.find('#music .mu-art').exists()).toBe(false)
  })
})
