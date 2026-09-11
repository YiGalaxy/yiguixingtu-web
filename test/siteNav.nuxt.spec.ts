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
//   所以这里守四件事：
//     ① 汉堡按钮在、读屏信息对（aria-expanded / aria-label / aria-controls）
//     ② 三种关法都能关：再点一次、Esc、点遮罩；路由一变也自动收
//     ③ 面板里的导航项与桌面导航是**同一批** —— 这一条最要紧：
//        两处各写一份的话，漏改不会报错，表现只是"手机上少一个入口"
//     ④ 「文章」下拉里的子项是**接口里的真分类**，而且是指向首页筛选的真链接
//        （`/?categoryId=N`）；接口挂了 / 一个分类都没有时退化成"文章 → 首页"的普通链接，
//        而不是一个点开一片空白的下拉
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

/**
 * 导航里「文章」下拉的分类**来自接口**（`GET /category/list`，见 `useCategoryList`）。
 * 这三条就是后端会返回的形状（真实分类由站长在后台维护，前端不再写死任何分类名）。
 */
const CATEGORIES = [
  { id: 1, name: '技术' },
  { id: 2, name: '读书' },
  { id: 3, name: '随笔' },
]

const body = (data) => ({ code: 200, message: '成功', data })
const pathOf = (url) => String(url).split('?')[0]

/**
 * 一份最小的后端假实现。
 * 【为什么这里要按路径分支，而不是所有请求都回 `data: null`】
 *   「文章」的子项现在来自接口，全回 null 的话分类永远是空的，
 *   于是所有"面板里的导航项"断言测的都是**降级那条路**，
 *   真正要守的"分类来自接口"反而没被测到。
 */
const mockBackend = () => {
  fetchMock.mockImplementation((url) => {
    const path = pathOf(url)
    if (path === '/category/list') return Promise.resolve(body(CATEGORIES))
    // app.vue 挂载时会调 GET /auth/me；data 为 null = 没登录，顶栏就是干净的几个按钮
    return Promise.resolve(body(null))
  })
}

beforeEach(() => {
  fetchMock.mockReset()
  mockBackend()
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
    // 窄屏那份：同一批（「文章」的三个子项也平铺在里面，共 8 + 3）。
    // 注意这三个分类名来自接口（不是写死在 navItems 里的），所以这一条同时也在守
    // "分类是渲染出来的，而不是硬编码的" —— 把接口的 mock 去掉，这里立刻会红。
    expect(panelLabels(wrapper)).toEqual([
      '首页', '归档', '文章', '技术', '读书', '随笔', '音乐', '收藏', '项目', '友链', '关于',
    ])
    // 也就是说：**桌面上有的入口，窄屏面板里一个都不少** ——
    // 这正是原来那个 bug 的核心（窄屏把导航整块藏了，用户没有任何入口）
  })

  it('「文章」下拉的子项_should是接口里的真分类，并且指向首页筛选的真链接', async () => {
    const wrapper = await mountShell()

    const links = wrapper.findAll('.nav-center .dd-menu a')
    expect(links.map(a => a.text())).toEqual(['技术', '读书', '随笔'])
    // 【为什么是 `/?categoryId=N`】首页本来就带着一整套分类筛选（点分类 → 请求参数、
    // 地址栏、列表标题三处同步），所以"按分类看"只需要把 id 交给首页。
    // 用 NuxtLink（渲染成 <a href>）而不是 click 跳转：能爬、可中键新开、刷新后状态还在。
    expect(links.map(a => a.attributes('href')))
      .toEqual(['/?categoryId=1', '/?categoryId=2', '/?categoryId=3'])
  })

  it('窄屏面板里的分类子项_should是同一批链接（桌面与手机点下去落到同一个地址）', async () => {
    const wrapper = await mountShell()
    await burgerBtn(wrapper).trigger('click')

    const subs = wrapper.findAll('#site-mobile-nav .nm-sub')
    expect(subs.map(a => a.text())).toEqual(['技术', '读书', '随笔'])
    expect(subs.map(a => a.attributes('href')))
      .toEqual(['/?categoryId=1', '/?categoryId=2', '/?categoryId=3'])

    // 点一下要**立刻收起面板**：手机上跳走之后还挂着一块盖住半屏的面板，
    // 用户会以为"点坏了"
    await subs[0].trigger('click')
    await flushPromises()
    expect(isPanelHidden(wrapper)).toBe(true)
  })

  it('一个分类都没有（接口挂了 / 还没建分类）_should退化成 文章→首页 的普通链接，而不是空下拉', async () => {
    // 三种"没有分类"的来源都过一遍：业务失败、返回的不是数组、空数组
    for (const payload of [
      { code: 500, message: '服务器开小差了', data: null },
      { code: 200, message: '成功', data: { records: [] } },
      { code: 200, message: '成功', data: [] },
    ]) {
      fetchMock.mockReset()
      fetchMock.mockImplementation((url) => {
        if (pathOf(url) === '/category/list') return Promise.resolve(payload)
        return Promise.resolve(body(null))
      })

      const wrapper = await mountShell()
      // 【为什么不能留一个空下拉】点开是一片空白，用户只会觉得坏了；
      // 也不能因此整项消失 —— 那等于"站里没建分类就没有入口进文章列表"。
      // 首页就是文章列表，所以退化成指向它的普通链接最合理。
      expect(wrapper.find('.nav-center .dd-menu').exists()).toBe(false)
      const article = wrapper.findAll('.nav-center > .nv').find(el => el.text().trim() === '文章')
      expect(article.attributes('href')).toBe('/')
      // 面板里也一样：没有子项，但「文章」这一项要在
      expect(wrapper.findAll('#site-mobile-nav .nm-sub')).toHaveLength(0)
      expect(panelLabels(wrapper)).toContain('文章')
    }
  })

  it('脏分类数据（缺 id / 缺名字）_should被过滤掉，而不是渲染出一个点不动的链接', async () => {
    fetchMock.mockReset()
    fetchMock.mockImplementation((url) => {
      if (pathOf(url) === '/category/list') {
        return Promise.resolve(body([{ id: 1, name: '技术' }, { id: null, name: '没有id' }, { id: 3, name: '' }, null]))
      }
      return Promise.resolve(body(null))
    })

    const wrapper = await mountShell()

    // 只剩一条能用的。留着脏数据的话会渲染出 `/?categoryId=undefined` 这种链接 ——
    // 点了要么 404、要么静默地不过滤，而页面上完全看不出来
    const links = wrapper.findAll('.nav-center .dd-menu a')
    expect(links.map(a => a.text())).toEqual(['技术'])
    expect(links[0].attributes('href')).toBe('/?categoryId=1')
  })

  it('面板里的每一项_should都是真 <a href>（可爬、可中键新开），且地址逐项对得上', async () => {
    // 【2026-09-11 把这条加强了】原来只抽查「归档」与「关于」两个。
    // 现在 F5 把最后四个入口（收藏 / 项目 / 友链 / 关于）也接成了真页面，
    // 于是"导航里每一项都是真链接"这件事可以**逐项**钉住了 —— 而且值得钉：
    // 只要有一项还是 `@click` 跳转（或者指回了首页锚点），爬虫就少一个入口，
    // 而页面上完全看不出差别。
    const wrapper = await mountShell()

    const hrefs = wrapper.findAll('#site-mobile-nav .nm-item')
      .map(a => [a.text(), a.attributes('href')])
    // 【为什么这里没有「文章」】它在这个 mock 下是**分组**（接口返回了 3 个分类），
    // 面板里渲染成 `.nm-group-title` + 三个 `.nm-sub`，不是 `.nm-item`
    // （分类那几条由上面那条用例单独守）。只有"一个分类都没有"时它才退化成
    // 指向首页的 `.nm-item`。
    expect(hrefs).toEqual([
      ['首页', '/'],
      ['归档', '/archive'],
      ['音乐', '/music'],       // F3：从"首页锚点"变成真页面
      ['收藏', '/favorites'],   // F5 四页
      ['项目', '/projects'],
      ['友链', '/links'],
      ['关于', '/about'],
    ])
  })

  it('面板里的链接点下去_should立刻收起面板（不收的话跳完还盖着半屏）', async () => {
    const wrapper = await mountShell()
    await burgerBtn(wrapper).trigger('click')
    expect(isPanelHidden(wrapper)).toBe(false)

    // 【这条原来测的是"点『还没做』的入口给提示并收面板"】F5 之后导航里
    // 已经没有"还没做"的入口了，所以改成用真链接来驱动同一件事：
    // 面板里的项点下去必须**立刻收**（不等路由变），否则跳走之后还挂着一块盖住半屏的面板。
    const collection = wrapper.findAll('#site-mobile-nav .nm-item').find(el => el.text() === '收藏')
    await collection.trigger('click')
    await flushPromises()

    expect(isPanelHidden(wrapper)).toBe(true)
    // 【顺带钉住"开发中"提示真的没了】F5 之前点「收藏」会弹一句「该页面开发中」；
    // 现在它是真链接。这条断言守的是"别哪天又把某个入口退回成弹提示"——
    // 那种回归在页面上只表现为"点了没跳走"，很容易被当成网络慢。
    expect(infoSpy).not.toHaveBeenCalled()
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
