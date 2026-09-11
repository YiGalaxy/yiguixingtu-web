import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { ref } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises, enableAutoUnmount } from '@vue/test-utils'
import AppShell from '~/app.vue'

// =====================================================================
// 窄屏导航（汉堡菜单）的组件测试
//
// 【这一组守的是什么】
//   原来 `app.vue` 里只有一行 CSS：
//       @media (max-width: 1000px) { .nav-center { display: none; } }
//   也就是说窄屏下**整个中间导航被藏掉、且没有任何替代入口** ——
//   手机上只剩 Logo 与登录按钮，归档 / 音乐 / 关于 这些页面根本进不去。
//   （注意：不是"标签被挤窄"，是整块消失 —— 这两件事的表现很像，但修法完全不同。）
//
//   所以这里守三件事：
//     ① 汉堡按钮在、读屏信息对（aria-expanded / aria-label / aria-controls）
//     ② 三种关法都能关：再点一次、Esc、点遮罩；路由一变也自动收
//     ③ 面板里的导航项与桌面导航是**同一批** —— 这一条最要紧：
//        两处各写一份的话，漏改不会报错，表现只是"手机上少一个入口"
//
//   【测不到的部分，如实写在这里】窄屏/宽屏的显隐是 CSS 媒体查询负责的，
//   jsdom **不做布局、也不求值媒体查询**，所以"手机上是不是真的显示汉堡"量不出来 ——
//   这里只能断言"两套结构都在 DOM 里、由状态控制显隐"，真正的观感由人眼确认
//   （已写进 README 的上线核对清单）。
// =====================================================================

const { fetchMock, cookieRefs } = vi.hoisted(() => ({ fetchMock: vi.fn(), cookieRefs: {} }))
mockNuxtImport('$fetch', () => fetchMock)

// 与 loginRateLimit 那份同样的理由：app.vue 的模板里有 `v-if="token"`，
// 必须是【真的 ref】才会被模板自动解包（普通对象永远是真值，顶栏会一直按已登录渲染）
mockNuxtImport('useCookie', () => (name) => {
  if (!cookieRefs[name]) cookieRefs[name] = ref(null)
  return cookieRefs[name]
})

// ElMessage 会往 DOM 里插节点；换成间谍之后还能断言提示文案
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
  // app.vue 挂载时会调 GET /auth/me；这里让它返回"没登录"，顶栏就是干净的几个按钮
  fetchMock.mockResolvedValue({ code: 200, message: '成功', data: null })
  infoSpy.mockClear()
  for (const key of Object.keys(cookieRefs)) cookieRefs[key].value = null
  document.body.style.overflow = ''
})

/** 挂载整个应用外壳（NuxtPage / 路由播报器在单测里没有内容，stub 掉） */
const mountShell = async () => {
  const wrapper = await mountSuspended(AppShell, {
    global: { stubs: { NuxtPage: true, NuxtRouteAnnouncer: true } },
  })
  await flushPromises()
  return wrapper
}

const burgerBtn = (w) => w.find('.nav-burger')
const navPanel = (w) => w.find('#site-mobile-nav')

/**
 * 面板当前是不是"收着"的。
 *
 * 【为什么直接看内联样式，而不是 `wrapper.isVisible()` —— 这是实测踩出来的】
 *   `v-show` 收起时确实往元素上写了 `style="display: none;"`（已确认），
 *   但在本项目的测试环境（happy-dom）里 `isVisible()` **照样返回 true**。
 *   拿它当断言条件会得到一条**永远为真**的用例 —— 面板不管开没开都"可见"，
 *   这条断言就再也不会失败（假绿，比没有断言更糟）。
 *   而 `display:none` 是 `v-show` 唯一的产物，直接断言它既准确又不会骗人。
 */
const isPanelHidden = (w) => (navPanel(w).attributes('style') || '').includes('display: none')

/** 面板里的导航项文字（含「文章」那个分组标题与它的子项） */
const panelLabels = (w) => w
  .findAll('#site-mobile-nav .nm-item, #site-mobile-nav .nm-sub, #site-mobile-nav .nm-group-title')
  .map(el => el.text().trim())

/**
 * 桌面导航的文字。
 * 【为什么要取 `.nav-center > .nv`（直接子元素）并把下拉按钮的文字单独取出来】
 *   「文章」那一项是个 div，里面**嵌套着**下拉里的三个链接 ——
 *   直接用 `el.text()` 会把子项的文字一起拼进来（实测得到 "文章 技术读书随笔"），
 *   两个列表就没法逐项对比了。
 */
const desktopLabels = (w) => w.findAll('.nav-center > .nv').map((el) => {
  const btn = el.find('.nv-btn')
  return (btn.exists() ? btn.text() : el.text()).replace('▾', '').trim()
})

describe('窄屏导航 · 汉堡菜单', () => {
  it('汉堡按钮_should初始是收起状态，且读屏信息齐全', async () => {
    const wrapper = await mountShell()

    const btn = burgerBtn(wrapper)
    expect(btn.exists()).toBe(true)
    // 读屏软件靠这几个属性知道"这个按钮是干什么的、现在是开还是关"
    expect(btn.attributes('aria-expanded')).toBe('false')
    expect(btn.attributes('aria-label')).toBe('打开导航菜单')
    expect(btn.attributes('aria-controls')).toBe('site-mobile-nav')

    // 收起时面板不可见（v-show 用 display:none，读屏与 Tab 键都不会走进去）

    expect(isPanelHidden(wrapper)).toBe(true)
  })

  it('点汉堡_should展开面板，并且 aria 信息跟着变', async () => {
    const wrapper = await mountShell()
    await burgerBtn(wrapper).trigger('click')

    expect(burgerBtn(wrapper).attributes('aria-expanded')).toBe('true')
    expect(burgerBtn(wrapper).attributes('aria-label')).toBe('关闭导航菜单')
    expect(isPanelHidden(wrapper)).toBe(false)
  })

  it('再点一次汉堡_should收起（同一个按钮开也它关也它）', async () => {
    const wrapper = await mountShell()
    await burgerBtn(wrapper).trigger('click')
    expect(isPanelHidden(wrapper)).toBe(false)

    await burgerBtn(wrapper).trigger('click')
    expect(isPanelHidden(wrapper)).toBe(true)
    expect(burgerBtn(wrapper).attributes('aria-expanded')).toBe('false')
  })

  it('按 Esc_should收起（浮层一律要能用键盘关掉）', async () => {
    const wrapper = await mountShell()
    await burgerBtn(wrapper).trigger('click')
    expect(isPanelHidden(wrapper)).toBe(false)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(isPanelHidden(wrapper)).toBe(true)
  })

  it('点遮罩_should收起（手机上最常见的关法）', async () => {
    const wrapper = await mountShell()
    await burgerBtn(wrapper).trigger('click')

    await wrapper.find('.nav-scrim').trigger('click')
    expect(isPanelHidden(wrapper)).toBe(true)
  })

  it('点面板里的链接_should立刻收起（不等路由变化，手机上那一下延迟都感觉得到）', async () => {
    const wrapper = await mountShell()
    await burgerBtn(wrapper).trigger('click')
    expect(isPanelHidden(wrapper)).toBe(false)

    const archiveLink = wrapper.findAll('#site-mobile-nav .nm-item').find(a => a.text() === '归档')
    await archiveLink.trigger('click')
    await flushPromises()
    // 点了就收 —— 不用等跳转完成（否则面板会在新页面上多盖一瞬）
    expect(isPanelHidden(wrapper)).toBe(true)
  })

  // ⚠️ 【有一条行为这里测不了，如实说明】
  //   代码里还有一个"路由一变就自动收起"的 watch（兜住后退/点 Logo/navigateTo 等
  //   所有不是从面板里发起的跳转）。它在**本测试环境里无法验证**：
  //   实测 `wrapper.vm.$router.push()` 与点 NuxtLink 都不会让 app.vue 里
  //   `useRoute()` 读到的 route 真的变化（测试应用没有真实的页面路由），
  //   所以"路由变了会不会关"这件事在这里驱动不起来 —— 硬写只会得到一条
  //   永远碰不到 watch 的假绿用例。它由人眼的核对清单覆盖（见 README 上线核对表）。
  //   上面这一条测的是"点面板里的项立刻收"，那是同一诉求里可测、也更关键的一半。

  it('面板里的导航项_should与桌面导航是同一批（一处定义，两处渲染）', async () => {
    const wrapper = await mountShell()

    // 桌面那份（8 项：首页/归档/文章/音乐/收藏/项目/友链/关于）
    expect(desktopLabels(wrapper)).toEqual(['首页', '归档', '文章', '音乐', '收藏', '项目', '友链', '关于'])
    // 窄屏那份：同一批（「文章」的三个子项也平铺在里面，共 8 + 3）
    expect(panelLabels(wrapper)).toEqual([
      '首页', '归档', '文章', '技术', '读书', '随笔', '音乐', '收藏', '项目', '友链', '关于',
    ])
    // 也就是说：**桌面上有的入口，窄屏面板里一个都不少** ——
    // 这正是原来那个 bug 的核心（窄屏把导航整块藏了，用户没有任何入口）
  })

  it('面板里的真链接_should是普通 <a href>（可爬、可中键新开），而不是 click 跳转', async () => {
    const wrapper = await mountShell()

    const archive = wrapper.findAll('#site-mobile-nav .nm-item').find(a => a.text() === '归档')
    expect(archive.attributes('href')).toBe('/archive')

    const about = wrapper.findAll('#site-mobile-nav .nm-item').find(a => a.text() === '关于')
    expect(about.attributes('href')).toBe('/#profile')
  })

  it('面板里点「还没做」的入口_should给提示，并把面板收起来（不收的话提示被面板盖住）', async () => {
    const wrapper = await mountShell()
    await burgerBtn(wrapper).trigger('click')

    const devItem = wrapper.findAll('#site-mobile-nav .nm-item').find(el => el.text() === '收藏')
    await devItem.trigger('click')

    expect(infoSpy).toHaveBeenCalled()
    expect(String(infoSpy.mock.calls[0][0])).toContain('开发中')
    expect(isPanelHidden(wrapper)).toBe(true)
  })

  it('展开时_should锁住 body 滚动，收起与卸载时都要解开', async () => {
    const wrapper = await mountShell()

    await burgerBtn(wrapper).trigger('click')
    // 手机上滑面板会带着背后的页面一起滚，松手后停在一个莫名其妙的位置
    expect(document.body.style.overflow).toBe('hidden')

    await burgerBtn(wrapper).trigger('click')
    expect(document.body.style.overflow).toBe('')

    // 【为什么卸载时也要解】不解的话 overflow:hidden 会被带到下一个页面 ——
    // 表现是整个站点突然不能滚，而且很难联想到是这个面板干的
    await burgerBtn(wrapper).trigger('click')
    expect(document.body.style.overflow).toBe('hidden')
    wrapper.unmount()
    expect(document.body.style.overflow).toBe('')
  })
})
