import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { ref } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises, enableAutoUnmount } from '@vue/test-utils'
import AppShell from '~/app.vue'
import { useBackgroundMusic } from '~/composables/useBackgroundMusic'

// =====================================================================
// ⚙ 站点设置面板（右上角那个齿轮）
//
// 【这一组守的是什么】
//   那个按钮原来写的是 `@click="onDev"` —— 点下去只弹一句「该页面开发中」，
//   用户报的就是这个（"设置功能也是没有带卡片的情况"）。现在它是一个抽屉面板，
//   里面两个开关：背景视频、背景音乐。
//
//   这里钉住四件事：
//     ① 齿轮打开的是真面板（有卡片、两个开关、各有名字与说明），不再弹"开发中"
//     ② 背景视频开关**真的把视频元素从 DOM 里去掉**，而且偏好写进了 cookie
//     ③ 背景音乐开关与页脚那个 ♫ 是**同一份状态**（改一处、另一处跟着变）——
//        这正是原来那个"点了没反应"bug 的正面反例
//     ④ 两个开关互不干扰：关音乐不该去动视频
//
// 【为什么专门有一条"cookie 里写着关，首屏就没有视频"】
//   那是"视频偏好为什么存 cookie 而不是 localStorage"这件事的可测版本：
//   服务端读到的就是这个 cookie，读到 false 时渲染出来的 HTML 里**根本不该有 video**。
//   如果改用 localStorage，服务端只能默认渲染出 video，用户每次打开页面都会
//   白下一段视频、看它闪一下再消失。
// =====================================================================

const { fetchMock, cookieRefs } = vi.hoisted(() => ({ fetchMock: vi.fn(), cookieRefs: {} }))
mockNuxtImport('$fetch', () => fetchMock)

// app.vue 的模板里有 `v-if="token"`，所以 useCookie 必须返回【真的 ref】才会被模板自动解包
// （普通对象永远是真值，顶栏会一直按"已登录"渲染）—— 与其它挂载外壳的用例同款写法。
mockNuxtImport('useCookie', () => (name) => {
  if (!cookieRefs[name]) cookieRefs[name] = ref(null)
  return cookieRefs[name]
})

// ElMessage 会往 DOM 里插节点；换成间谍之后还能断言"点齿轮没有弹开发中"
const { infoSpy } = vi.hoisted(() => ({ infoSpy: vi.fn() }))
vi.mock('element-plus', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    ElMessage: { ...actual.ElMessage, info: infoSpy, success: vi.fn(), error: vi.fn(), warning: vi.fn() },
  }
})

enableAutoUnmount(afterEach)

/**
 * Element Plus 锁背景滚动时加在 body 上的类。
 * 【为什么写成常量】用错类名的话断言会"永远为真"（body 上本来就没有这个类），
 * 那是一条不会失败的假绿用例；写在一处并配上说明，至少改的时候看得见它是什么。
 */
const POPUP_LOCK_CLASS = 'el-popup-parent--hidden'

beforeEach(() => {
  fetchMock.mockReset()
  // app.vue 挂载时会调 GET /auth/me；这里让它返回"没登录"，顶栏就是干净的几个按钮
  fetchMock.mockResolvedValue({ code: 200, message: '成功', data: null })
  infoSpy.mockClear()
  localStorage.clear()
  // cookie 都复位成"没设置过"：对 bg-video-enabled 来说 null 就是默认开
  for (const key of Object.keys(cookieRefs)) cookieRefs[key].value = null
  // 音乐状态是全局共享的（useState 同 key 一份），不复位的话上一个用例的"开着"会带过来
  const music = useBackgroundMusic()
  music.enabled.value = false
  music.playing.value = false
  music.progress.value = 0
  document.body.style.overflow = ''
  // 上一条用例卸载时，Element Plus 的解锁是延迟 200ms 做的；这里直接清干净，
  // 免得上一条的残留让下一条的"刚开始没锁"断言偶然变红
  document.body.classList.remove(POPUP_LOCK_CLASS)
})

const mountShell = async () => {
  const wrapper = await mountSuspended(AppShell, {
    global: { stubs: { NuxtPage: true, NuxtRouteAnnouncer: true } },
  })
  await flushPromises()
  return wrapper
}

const gearBtn = (w) => w.find('.nav-right .icon-btn[aria-label="打开站点设置"]')
const drawerEl = (w) => w.find('.settings-drawer')

/**
 * 抽屉开着没有。
 *
 * 【为什么看 `open` 这个类，而不是 `isVisible()`】
 *   收起时抽屉的根元素**仍然在 DOM 里**（Element Plus 是在外层遮罩上用 v-show 收起的），
 *   所以"元素在不在"完全区分不出开关状态。而 `open` 类是抽屉自己的模板里写死的
 *   （`visible && "open"`），它才是真正的开合状态。
 *   另外本项目实测过：happy-dom 下 `isVisible()` 对 v-show 的元素**照样返回 true**，
 *   拿它当断言会得到一条永远为真的假绿用例（见 siteNav 那份用例里的说明）。
 */
const isDrawerOpen = (w) => {
  const el = drawerEl(w)
  return el.exists() && el.classes().includes('open')
}

/** 面板里的两个开关：0 = 背景视频，1 = 背景音乐（模板里的顺序） */
const switches = (w) => w.findAll('.settings-drawer .el-switch')

/** 开关的当前状态。用 aria-checked 而不是类名：那是读屏软件读的那一份，改不动也不会骗人 */
const switchState = (el) => el.find('.el-switch__input').attributes('aria-checked')

describe('⚙ 站点设置面板', () => {
  it('点齿轮_should打开设置面板，而不是弹「该页面开发中」', async () => {
    const wrapper = await mountShell()
    expect(gearBtn(wrapper).exists()).toBe(true)
    // 按钮没有可见文字（只有一个 ⚙），所以必须有可访问名
    expect(gearBtn(wrapper).attributes('aria-haspopup')).toBe('dialog')
    expect(isDrawerOpen(wrapper)).toBe(false)

    await gearBtn(wrapper).trigger('click')
    await flushPromises()

    expect(isDrawerOpen(wrapper)).toBe(true)
    // 原来这里是 onDev()，会弹一句"该页面开发中" —— 这就是用户报的那个问题
    expect(infoSpy).not.toHaveBeenCalled()
  })

  it('面板里_should正好是两个开关，各自有名字和一句说明', async () => {
    const wrapper = await mountShell()
    await gearBtn(wrapper).trigger('click')
    await flushPromises()

    expect(switches(wrapper)).toHaveLength(2)
    expect(wrapper.findAll('.settings-drawer .set-name').map(el => el.text())).toEqual(['背景视频', '背景音乐'])
    // 说明文字不能是空的：用户要能看懂关掉它会发生什么
    for (const desc of wrapper.findAll('.settings-drawer .set-desc')) {
      expect(desc.text().length).toBeGreaterThan(0)
    }
    // 开关本身没有可读文字（名字在旁边的 span 里），所以要给 aria-label
    expect(wrapper.findAll('.settings-drawer .el-switch__input').map(el => el.attributes('aria-label')))
      .toEqual(['背景视频', '背景音乐'])
    // 「带卡片」：两行设置外面有一层玻璃卡片（全局 .glass），这正是用户说的"没有带卡"
    expect(wrapper.find('.settings-drawer .set-card.glass').exists()).toBe(true)
  })

  it('初始状态_should按各自的偏好显示（视频默认开、音乐默认关）', async () => {
    const wrapper = await mountShell()
    await gearBtn(wrapper).trigger('click')
    await flushPromises()

    const [video, music] = switches(wrapper)
    // 视频是默认开的（cookie 没设置过 = 开）
    expect(switchState(video)).toBe('true')
    // 音乐默认关：没有用户手势时浏览器根本不许自动播放，所以默认不"想听"
    expect(switchState(music)).toBe('false')
  })

  it('关掉背景视频_should把 video 从 DOM 里去掉，并把偏好写进 cookie', async () => {
    const wrapper = await mountShell()
    await gearBtn(wrapper).trigger('click')
    await flushPromises()

    // 默认开着：视频元素在，而且是静音的（装饰性，按设计一直静音）
    expect(wrapper.find('video').exists()).toBe(true)

    await switches(wrapper)[0].trigger('click')
    await flushPromises()

    // 【为什么必须是"从 DOM 里去掉"而不是藏起来】display:none 的视频照样解码、照样占显存，
    // "关掉更省电"就成了假话
    expect(wrapper.find('video').exists()).toBe(false)
    expect(switches(wrapper)[0].find('.el-switch__input').attributes('aria-checked')).toBe('false')
    // 偏好落到了 cookie 上（下次进站，服务端渲染时就能读到）
    expect(cookieRefs['bg-video-enabled'].value).toBe(false)
    // 而且不该顺手动到音乐
    expect(localStorage.getItem('bg-music-enabled')).toBeNull()
  })

  it('重新打开背景视频_should把 cookie 删掉（"没设置"就等于默认开）', async () => {
    const wrapper = await mountShell()
    await gearBtn(wrapper).trigger('click')
    await flushPromises()

    await switches(wrapper)[0].trigger('click')
    await flushPromises()
    expect(cookieRefs['bg-video-enabled'].value).toBe(false)

    await switches(wrapper)[0].trigger('click')
    await flushPromises()

    expect(wrapper.find('video').exists()).toBe(true)
    // 不写 true，而是把 cookie 删掉：这样"没设置过"与"设置成开"不会变成
    // 两个表达同一件事的值（将来改默认值时才不会出现"老用户被固定在旧默认上"）
    expect(cookieRefs['bg-video-enabled'].value).toBeNull()
  })

  it('cookie 里已经写着关（= 服务端读到的那一份）_should首屏就不渲染 video', async () => {
    // 模拟"上次关掉了视频的用户"：服务端从请求头里读到的就是 false
    cookieRefs['bg-video-enabled'] = ref(false)

    const wrapper = await mountShell()
    await flushPromises()

    // 这一条就是"为什么这个偏好必须存 cookie"的证据：
    // 如果它存在 localStorage（服务端读不到），这里首屏一定有一个 video 元素，
    // 浏览器就会立刻去下 bg-star.mp4 —— 用户特意关掉的正是这个
    expect(wrapper.find('video').exists()).toBe(false)
  })

  it('面板里打开背景音乐_should让页脚那个开关跟着变（一份状态、两个界面）', async () => {
    const wrapper = await mountShell()
    await gearBtn(wrapper).trigger('click')
    await flushPromises()

    expect(wrapper.find('.music-toggle').text()).toContain('播放背景音乐')

    await switches(wrapper)[1].trigger('click')
    await flushPromises()

    // 面板与页脚是同一份状态：改面板，页脚立刻跟着变
    // （改之前它们是两个互不相干的 ref，页脚说"关闭"、卡片却在播，用户看到的就是"点了没反应"）
    expect(wrapper.find('.music-toggle').text()).toContain('关闭背景音乐')
    expect(localStorage.getItem('bg-music-enabled')).toBe('1')
  })

  it('从页脚打开音乐_should让面板里的开关也亮起来（反方向也通）', async () => {
    const wrapper = await mountShell()
    await gearBtn(wrapper).trigger('click')
    await flushPromises()

    await wrapper.find('.music-toggle').trigger('click')
    await flushPromises()

    expect(switchState(switches(wrapper)[1])).toBe('true')
  })

  it('开关背景音乐_should不去动背景视频（视频还在、而且仍然是静音的）', async () => {
    const wrapper = await mountShell()
    await gearBtn(wrapper).trigger('click')
    await flushPromises()

    await switches(wrapper)[1].trigger('click')
    await flushPromises()

    const video = wrapper.find('video')
    expect(video.exists()).toBe(true)
    // 老实现把"背景音乐开关"做成了"给背景视频取消静音"，那会让视频音轨盖在音乐上
    expect(video.attributes('muted')).toBeDefined()
  })

  it('窄屏导航面板开着时点齿轮_should把导航面板收起来（两个浮层不叠在一起）', async () => {
    const wrapper = await mountShell()

    await wrapper.find('.nav-burger').trigger('click')
    const navPanel = wrapper.find('#site-mobile-nav')
    expect(navPanel.attributes('style') || '').not.toContain('display: none')

    await gearBtn(wrapper).trigger('click')
    await flushPromises()

    expect(isDrawerOpen(wrapper)).toBe(true)
    // 叠着的两个浮层，Esc 与点遮罩都只能关掉一个，剩下那个还盖着半屏 —— 看起来像"没关上"
    expect(wrapper.find('#site-mobile-nav').attributes('style') || '').toContain('display: none')
  })

  it('设置面板打开时_should锁住背景滚动，关掉之后再解开', async () => {
    const wrapper = await mountShell()
    expect(document.body.classList.contains(POPUP_LOCK_CLASS)).toBe(false)

    await gearBtn(wrapper).trigger('click')
    await flushPromises()
    // 手机上滑面板会把背后的页面一起滚走，松手后停在一个莫名其妙的位置。
    // 【为什么断言的是 body 上的类，而不是内联的 style.overflow】Element Plus 的滚动锁
    // 用的是 `el-popup-parent--hidden` 这个类（只有补偿滚动条宽度时才写内联 width），
    // 和我们自己那个窄屏面板直接写 style.overflow 的做法不一样 ——
    // 断言写错地方会得到一条永远为真的假绿用例。
    expect(document.body.classList.contains(POPUP_LOCK_CLASS)).toBe(true)

    await drawerEl(wrapper).find('.el-drawer__close-btn').trigger('click')
    await flushPromises()
    expect(isDrawerOpen(wrapper)).toBe(false)
    // 【为什么要等 200ms】Element Plus 的解锁走的是一个 setTimeout(200)，
    // 不是同步的 —— 立刻断言会红，但那不是产品的问题
    await new Promise(resolve => setTimeout(resolve, 260))
    expect(document.body.classList.contains(POPUP_LOCK_CLASS)).toBe(false)
  })

  it('按 Esc_should关掉面板（浮层一律要能用键盘关掉）', async () => {
    const wrapper = await mountShell()
    await gearBtn(wrapper).trigger('click')
    await flushPromises()
    expect(isDrawerOpen(wrapper)).toBe(true)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()

    expect(isDrawerOpen(wrapper)).toBe(false)
  })
})
