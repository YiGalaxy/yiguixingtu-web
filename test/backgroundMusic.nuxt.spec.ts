import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { ref } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises, enableAutoUnmount } from '@vue/test-utils'
import AppShell from '~/app.vue'
import IndexPage from '~/pages/index.vue'
import { useBackgroundMusic } from '~/composables/useBackgroundMusic'
import { DEFAULT_MUSIC_MODE } from '~/utils/playMode'

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
//
// 【2026-09-11 补上了另一半】那个 `<audio>` 从首页卡片挪进了外壳，
//   于是"一份状态"之外还多了"一个实例"：文件末尾那组 describe 守的就是
//   "全站恰好一个播放器、它在外壳里、页面里一个都没有"（含 preload/loop）。
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
  // 播放模式也是全局共享的（2026-09-13 加）：不复位的话，
  // 上一个用例留下的"单曲循环"会让下面涉及 ended 的断言跑出别的结果
  music.mode.value = DEFAULT_MUSIC_MODE
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

// =====================================================================
// 播放器搬进外壳（2026-09-11）
//
// 【为什么这一组必须在这里】"一份状态、多个界面"只解决了一半问题：
//   状态共享了，**放音的那个实例也必须是同一个**。
//   改之前 `<audio>` 住在首页那张音乐卡片里 —— 页面一卸载（点进归档/文章/音乐页）
//   音乐就断，回到首页还要再点一次；而音乐页出现之后就是两个 `<audio>`
//   抢同一首歌、互相覆盖共享状态里的 progress（用户看到的是"两个页面显示的进度不一样"）。
//   所以这两条守的是：**全站恰好一个播放器，它在外壳里，页面里一个都没有**。
//   （首页卡片与音乐页都只是它的遥控器 —— 点哪一处，改的都是同一份状态、同一个元素。）
// =====================================================================
describe('背景音乐 · 播放器住在外壳里', () => {
  it('外壳里_should恰好一个 <audio>，地址是 /media/bg-music.mp3', async () => {
    const shell = await mountShell()

    const audio = shell.findAll('audio')
    expect(audio).toHaveLength(1)
    // 地址来自 mediaUrl(MEDIA_FILES.backgroundMusic)：这个文件不在 public/ 里（不进构建产物），
    // 线上由 Nginx 的 /media/ 提供、dev 由 Nitro 的开发路由提供
    expect(audio[0].attributes('src')).toBe('/media/bg-music.mp3')
    // 它挂在 .shell 这一层，**不在**任何页面子树里 —— 页面随路由卸载，外壳不卸载，
    // 所以"在首页点了播放，进音乐页还在播"才成立
    expect(audio[0].element.parentElement.classList.contains('shell')).toBe(true)
  })

  it('单独挂载首页_should一个 <audio> 都没有（两个播放器会互相覆盖状态）', async () => {
    // 这条是"首页卡片不再是播放器"的正面证据。
    // 【为什么它重要】两个实例同时存在时，它们都会往共享状态里写 playing/progress，
    // 谁后写谁赢 —— 界面上的表现是"进度条一会儿对、一会儿不对"，
    // 而两边的代码看起来都是对的，最难查。
    const home = await mountSuspended(IndexPage, { global: { stubs: { NuxtLink: true } } })
    await flushPromises()

    expect(home.find('audio').exists()).toBe(false)
    expect(home.findAll('audio')).toHaveLength(0)
  })

  it('那个 audio 的 preload_should是 metadata（不要在首页就把整首 mp3 下完）', async () => {
    const shell = await mountShell()

    // 【为什么这条要单独钉住】它三个取值各有代价，而页面上**完全看不出来**：
    //   · auto  —— 每个访客一进站就开始下整首 2 MB，而音乐默认是关的
    //              （浏览器不许无手势自动播放），也就是绝大多数人白下 2 MB
    //   · none  —— 一个字都不读，进度条拿不到总时长，一上来显示 --:--
    //   · metadata（现在这个）—— 只读文件头，拿到总时长，不碰音频数据
    // 所以"以后有人顺手改成 auto"这件事必须有东西拦住它。
    expect(shell.find('audio').attributes('preload')).toBe('metadata')
  })

  it('那个 audio_should【不】带 loop（放完要由播放模式决定下一首，见 2026-09-13 那次改动）', async () => {
    const shell = await mountShell()

    // 【这条用例在 2026-09-13 反转了，读之前先看这里】
    //   加「顺序播放 / 随机播放 / 单曲循环」之前，这个 `<audio>` 带着 `loop`：
    //   它让当前这一首永远循环，代价是浏览器**永远不会派发 `ended`** ——
    //   也就是说"下一首放谁"根本没有地方可决定，加模式也就无从谈起。
    //   去掉 `loop` 之后 `ended` 成了自动下一首的主路径（`app/utils/playMode.ts`）。
    //   ⚠️ 所以这条用例现在守的是**反面**：谁要是为了"让音乐不要停"顺手把 loop 加回来，
    //   三档模式会当场全部失效 —— 而且界面上看不出来（按钮照样切、歌就是不再往下走）。
    expect(shell.find('audio').attributes('loop')).toBeUndefined()
  })

  it('ended 事件_should把"在响"与进度一起归零（默认顺序播放 + 只有一首 = 放完停下）', async () => {
    // 【这条用例的背景在 2026-09-13 变了】改之前 `<audio>` 带 `loop`，
    //   浏览器**永远不会**派发 `ended`，这条用例是"防御性"的（当时注释里如实写了）。
    //   加播放模式时 `loop` 去掉了，`ended` 成了主路径：外壳按模式决定下一首
    //   （算法在 app/utils/playMode.ts，分支用例见 test/playMode.spec.ts）。
    //   这里默认假后端只给内置那一首、模式是默认的顺序播放 ⇒ "最后一首放完了" ⇒ **停下**。
    const shell = await mountShell()
    const home = await mountSuspended(IndexPage, { global: { stubs: { NuxtLink: true } } })
    const music = useBackgroundMusic()
    await flushPromises()

    // 先放起来（这时真实浏览器里会开始出声，测试环境里只翻状态）
    await home.find('.mu-ctl .play').trigger('click')
    await flushPromises()
    expect(music.playing.value).toBe(true)
    music.progress.value = 42

    await shell.find('audio').trigger('ended')
    await flushPromises()

    expect(music.playing.value).toBe(false)
    expect(music.progress.value).toBe(0)
    // 卡片上的按钮显示的是"真的在响"，所以它回到 ▶
    expect(home.find('.mu-ctl .play').text()).toBe('▶')

    // 而 `enabled`（用户想不想听）**没有变** —— ended 只说明"这一次放完了"，
    // 没有改变用户的意图。所以页脚那个开关仍然写着"关闭背景音乐"。
    // （这两个变量是刻意分开的：`enabled` = 想听，`playing` = 真的在响。）
    expect(music.enabled.value).toBe(true)
    expect(shell.find('.music-toggle').text()).toContain('关闭背景音乐')
  })
})

// =====================================================================
// 播放模式 · 共享状态与持久化（2026-09-13 新功能）
//
// 【为什么这一组在"共享状态"这个文件里】模式是**全站一份**的状态
//   （页脚开关、⚙ 面板、首页卡片、音乐页读的都是它），
//   真正按它决定下一首的是外壳 —— 和 `enabled` 是同一个套路。
//   "切完之后真的放了哪一首"在 test/musicSwitch.nuxt.spec.ts（那边假接口给三首歌），
//   这里只守状态本身：默认值、循环切换、落盘、读回、脏值兜底。
// =====================================================================
describe('背景音乐 · 播放模式', () => {
  it('默认_should是顺序播放（行为最可预测的那一档）', () => {
    const { mode } = useBackgroundMusic()
    expect(mode.value).toBe(DEFAULT_MUSIC_MODE)
    expect(DEFAULT_MUSIC_MODE).toBe('sequence')
  })

  it('cycleMode_should按「顺序 → 随机 → 单曲循环 → 顺序」切，并落盘', () => {
    const { mode, cycleMode } = useBackgroundMusic()

    expect(localStorage.getItem('bg-music-mode')).toBeNull()   // 没动过就不写

    cycleMode()
    expect(mode.value).toBe('shuffle')
    expect(localStorage.getItem('bg-music-mode')).toBe('shuffle')

    cycleMode()
    expect(mode.value).toBe('repeat-one')
    expect(localStorage.getItem('bg-music-mode')).toBe('repeat-one')

    cycleMode()
    expect(mode.value).toBe('sequence')
    expect(localStorage.getItem('bg-music-mode')).toBe('sequence')
  })

  it('setMode_should只认那三档（传别的什么都不改，也不落盘）', () => {
    const { mode, setMode } = useBackgroundMusic()

    setMode('repeat-one')
    expect(mode.value).toBe('repeat-one')

    for (const bad of ['loop-all', '', null, undefined, 0, {}, []]) {
      setMode(bad)
      // 【为什么不"顺手改成默认档"】调用方传错值是一个 bug，
      //   默默改成别的档会把它藏起来；用户在界面上看到的是"点了没反应"，那才是对的。
      expect(mode.value).toBe('repeat-one')
    }
    expect(localStorage.getItem('bg-music-mode')).toBe('repeat-one')
  })

  it('loadPreference_should把上次的模式一起读回来（换会话还记得）', () => {
    const { mode, loadPreference } = useBackgroundMusic()

    localStorage.setItem('bg-music-mode', 'shuffle')
    loadPreference()
    expect(mode.value).toBe('shuffle')

    localStorage.setItem('bg-music-mode', 'repeat-one')
    loadPreference()
    expect(mode.value).toBe('repeat-one')
  })

  it('localStorage 里是认不出来的值（旧版本 / 手改过）_should回落到默认档而不是塞进状态', () => {
    const { mode, loadPreference } = useBackgroundMusic()

    // 【为什么必须过滤】不过滤的话 `mode` 会是一个谁也不认识的值：
    //   按钮上写着"顺序播放"，而 `advancePlayback` 会走随机那一支 —— 两边对不上，
    //   而且这种不一致只在"一首放完"时才暴露，极难查。
    for (const bad of ['', 'loop-all', 'SEQUENCE', 'Sequence', '0']) {
      localStorage.setItem('bg-music-mode', bad)
      mode.value = 'shuffle'          // 先弄脏，确认它真的被覆盖了
      loadPreference()
      expect(mode.value).toBe(DEFAULT_MUSIC_MODE)
    }
  })

  it('localStorage 不可用（隐私模式）_should退回默认档而不是把站点带崩', () => {
    const { mode, loadPreference, cycleMode } = useBackgroundMusic()
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    const spySet = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })

    mode.value = 'repeat-one'
    expect(() => loadPreference()).not.toThrow()
    expect(mode.value).toBe(DEFAULT_MUSIC_MODE)

    // 写不进去也不该抛（本次会话里模式仍然是对的）
    expect(() => cycleMode()).not.toThrow()
    expect(mode.value).toBe('shuffle')

    spy.mockRestore()
    spySet.mockRestore()
  })
})
