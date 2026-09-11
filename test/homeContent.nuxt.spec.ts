import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick, ref } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises, enableAutoUnmount } from '@vue/test-utils'
import IndexPage from '~/pages/index.vue'
import AppShell from '~/app.vue'

// =====================================================================
// 首页「内容真实性」的组件测试
//
// 【这一组用例守的是什么】
//   首页曾经有三处硬编码的假内容，全都藏在"要点一下才看得见"的地方，
//   所以以前翻 HTML 都不一定发现：
//     · 侧边「留言」浮窗里的两条留言（访客A / 访客B）
//     · 左下角的「1 人正在看」
//     · 音乐卡片里三个编出来的曲名与上一首/下一首按钮（实际只有一个音频文件）
//   这次把它们删掉了。但"删掉"这件事本身没有类型检查、也没有 lint 规则能守住 ——
//   下一次为了"让首页看起来热闹一点"很容易再加回来。
//   所以这里用断言把"页面上不出现这些假字符串"钉住，顺便守住"真内容没被删坏"。
//
// 【为什么要断言渲染结果，而不是读源码里的字符串】
//   源码里现在确实还留着解释"为什么删掉"的注释（提到了访客A 等字样），
//   那是给读代码的人看的，不是给访客看的。
//   判断标准是【页面上有没有出现】，所以断言的是 wrapper.text()
//   —— textContent 只包含真正的文本节点，不含注释。
//
// 【为什么还要测"后端没有数据"这一种情况】
//   有真实数据时假内容容易被真数据盖住；一个空站点（没有文章、没有分类、
//   统计接口也失败）才是最容易被假内容填满来"显得不空"的场景。
// =====================================================================

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))
mockNuxtImport('$fetch', () => fetchMock)

// 【2026-09-11 新加】背景音乐的播放器挪到了外壳（app/app.vue），所以下面有两条用例
// 要连外壳一起挂。app.vue 的模板里有 `v-if="token"`，而 useCookie 必须返回**真的 ref**
// 才会被模板自动解包（返回普通对象的话它永远是真值，顶栏会一直按"已登录"渲染）——
// 与 backgroundMusic / settingsPanel 那两份用例同款写法。
const { cookieRefs } = vi.hoisted(() => ({ cookieRefs: {} }))
mockNuxtImport('useCookie', () => (name) => {
  if (!cookieRefs[name]) cookieRefs[name] = ref(null)
  return cookieRefs[name]
})

const body = (data) => ({ code: 200, message: '成功', data })
const pathOf = (url) => String(url).split('?')[0]

const ARTICLES = [
  { id: 21, title: '真实的文章标题', categoryName: '技术', viewCount: 5, createTime: '2026-09-10T10:00:00' },
]

/** 默认后端：一切正常，有 1 篇文章、1 个分类、统计有数 */
const mockBackend = () => {
  fetchMock.mockImplementation((url) => {
    const path = pathOf(url)
    if (path === '/category/list') return Promise.resolve(body([{ id: 1, name: '技术' }]))
    if (path === '/article/stats') return Promise.resolve(body({ articleCount: 1, viewCount: 5, categoryCount: 1 }))
    if (path === '/article/page') return Promise.resolve(body({ records: ARTICLES, total: 1 }))
    return Promise.resolve(body(null))
  })
}

/** 空站点：没有文章、没有分类，统计接口也挂了 */
const mockEmptyBackend = () => {
  fetchMock.mockImplementation((url) => {
    const path = pathOf(url)
    if (path === '/category/list') return Promise.resolve(body([]))
    if (path === '/article/stats') return Promise.resolve({ code: 500, message: '服务器开小差了' })
    if (path === '/article/page') return Promise.resolve(body({ records: [], total: 0 }))
    return Promise.resolve(body(null))
  })
}

/**
 * 这些字符串一个都不该出现在页面上。
 * 每一项都对应上面删掉的一处假内容，写清楚来源，免得以后有人"看不懂为什么要断这个"。
 */
const FAKE_TEXTS = [
  '访客A',            // 留言浮窗里写死的留言人
  '访客B',
  '这个站点真好看！',   // 同上，写死的留言内容
  '人正在看',          // 写死的在线人数
  '雨落星轨',          // 三个编出来的曲名
  '夜航',
  '星际漫游',
  'CLOUD MUSIC',      // 网易云音乐的品牌名，本站没有对接
  'RSS',              // GitHub / 邮箱 / RSS 三个没有地址的假入口
  'GitHub',
]

const mountHome = async () => {
  const wrapper = await mountSuspended(IndexPage)
  await flushPromises()
  return wrapper
}

/**
 * 「外壳 + 首页」挂在同一棵树里（2026-09-11 新增，给涉及播放状态的两条用例用）。
 *
 * 【为什么非得这样挂】首页那张卡片上的按钮显示的是 `playing`（**真的在响**），
 * 而"真的在响"只有外壳里那个 `<audio>` 能写进共享状态 —— 只挂首页时页面上没有播放器，
 * 点了播放之后没有任何东西会把它置为 true，按钮（正确地）仍然是 ▶。
 * 这不是测试技巧：真实应用里首页**永远**是挂在外壳里的，所以这样挂才更接近真实。
 */
const mountShellWithHome = async () => {
  const wrapper = await mountSuspended(AppShell, {
    global: { stubs: { NuxtPage: IndexPage, NuxtRouteAnnouncer: true } },
  })
  await flushPromises()
  return wrapper
}

// =====================================================================
// 【为什么每个用例结束后要卸载组件 —— 和 index.nuxt.spec.ts 里是同一个坑】
//   首页现在用 useAsyncData 取数，结果按 key 缓存进 Nuxt 的 payload，
//   而缓存的释放时机是【组件卸载】；本文件的所有用例共用同一个 Nuxt 应用实例，
//   不卸载的话下一个用例会直接沿用上一个用例的数据（连请求都不发）——
//   表现就是"空站点"那条用例看到的还是上一轮有文章的数据。
//   真实应用里页面切走就会卸载，所以让测试也这么做。
//   nextTick 是必需的：缓存的清除被安排在一个 nextTick 里。
// =====================================================================
enableAutoUnmount(afterEach)

describe('首页 · 内容真实性', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    mockBackend()
  })

  afterEach(async () => {
    // 见上面「为什么每个用例结束后要卸载组件」：等缓存清理真正落地
    await nextTick()
  })

  // ---------------------------------------------------------------
  // 一、假内容一个都不能出现
  // ---------------------------------------------------------------

  it('正常有数据时_should不出现任何假内容', async () => {
    const wrapper = await mountHome()
    const text = wrapper.text()

    for (const fake of FAKE_TEXTS) {
      expect(text, `页面不该出现「${fake}」`).not.toContain(fake)
    }
  })

  it('后端什么数据都没有时_should也不出现任何假内容', async () => {
    mockEmptyBackend()
    const wrapper = await mountHome()
    const text = wrapper.text()

    // 空站点只该老老实实说"还没有发布任何文章"，而不是拿假数据把它填满
    expect(text).toContain('还没有发布任何文章')
    for (const fake of FAKE_TEXTS) {
      expect(text, `空数据时页面也不该出现「${fake}」`).not.toContain(fake)
    }
  })

  it('假的留言浮窗_should连面板、按钮与样式一起删掉（不是只藏起来）', async () => {
    const wrapper = await mountHome()

    expect(wrapper.find('.msgs').exists()).toBe(false)
    expect(wrapper.find('.msg').exists()).toBe(false)
    // 左边吸附菜单只剩「时钟」一个按钮
    const dockButtons = wrapper.findAll('.dock .di')
    expect(dockButtons.length).toBe(1)
    expect(dockButtons[0].text()).toContain('时钟')
  })

  it('写死的在线人数_should连同它的节点一起删掉', async () => {
    const wrapper = await mountHome()

    expect(wrapper.find('.viewers').exists()).toBe(false)
    expect(wrapper.find('.dot').exists()).toBe(false)
  })

  it('没有地址的 GitHub / 邮箱 / RSS 三个入口_should不再渲染', async () => {
    const wrapper = await mountHome()

    expect(wrapper.find('.pf-links').exists()).toBe(false)
    expect(wrapper.find('.pl').exists()).toBe(false)
  })

  // ---------------------------------------------------------------
  // 二、音乐卡片：只保留真实存在的那一个音轨
  // ---------------------------------------------------------------

  it('音乐卡片_should没有自己的 <audio>（唯一的播放器在外壳里），但播放键与进度条照旧', async () => {
    const wrapper = await mountHome()

    // 【2026-09-11 改】这条原来断言的是"卡片里**恰好有一个** `<audio>`，src 是 /media/bg-music.mp3"。
    // 播放器现在挪到了应用外壳 `app/app.vue`：页面会随路由卸载（放在卡片里等于
    // "一离开首页音乐就断"），而音乐页出现之后还会变成两个 `<audio>` 抢同一首歌、
    // 互相覆盖共享状态里的 playing/progress。所以这里断言**反面**。
    expect(wrapper.find('audio').exists()).toBe(false)
    expect(wrapper.findAll('audio')).toHaveLength(0)

    // 【语义搬到了哪里】"全站恰好一个 `<audio>`、地址是 /media/bg-music.mp3"
    // 一条都没丢，它搬到了 test/backgroundMusic.nuxt.spec.ts 的
    // 「背景音乐 · 播放器住在外壳里」那一组（挂外壳断言 src / preload / loop / 父节点）。
    // 那里还有一条"单独挂载首页时一个 audio 都没有"，和这里互为印证。

    // 卡片的职责没有缩水：播放键在、进度条也在（进度条读的是共享状态里的百分比）
    expect(wrapper.find('#music .mu-ctl .play').exists()).toBe(true)
    expect(wrapper.find('#music .mu-progress').exists()).toBe(true)

    // 卡片用到的媒体地址仍然是"由 mediaUrl() 按 MEDIA_FILES 拼出来的 /media/ 前缀"，
    // 不是写死的路径 —— 这一点由封面回落图来守（音频那条由上面说的那组用例守）
    expect(wrapper.find('.mu-disc-img').attributes('src')).toBe('/media/cover-1.png')
  })

  it('音乐卡片_should没有上一首/下一首（只有一个音轨，那两个按钮点了也是原地打转）', async () => {
    const wrapper = await mountHome()

    const buttons = wrapper.findAll('.mu-ctl button')
    expect(buttons.length).toBe(1)
    expect(buttons[0].classes()).toContain('play')
    // ⏮ / ⏭ 这两个字符本身也不该出现在页面上
    expect(wrapper.text()).not.toContain('⏮')
    expect(wrapper.text()).not.toContain('⏭')
  })

  it('音乐卡片_should保留 #music 锚点（老链接 /#music 仍然落到这张卡片上）', async () => {
    const wrapper = await mountHome()

    expect(wrapper.find('#music').exists()).toBe(true)
    // 卡片上写的是曲目表（app/utils/musicTracks.ts）里**当前这一首**的曲名，
    // 不是编出来的曲名（原来这里断言的是写死的"背景音乐"，现在它来自曲目表第一首 ——
    // 2026-09-11 改成数据驱动之后，这条断言一个字没变，守的语义也一样）
    expect(wrapper.find('.mu-title').text()).toBe('背景音乐')
    // 【2026-09-11 只改了这条用例的**名字与注释**，断言一个字没动】
    // 名字原来写的是"导航栏的「音乐」指向它"——现在导航里的「音乐」指向真页面 /music 了，
    // 锚点留下来是为了老链接（/#music）不失效，而不是给导航用。
  })

  it('点播放按钮_should在播放与暂停之间切换（清理没把播放功能误删）', async () => {
    // 【2026-09-11 改】断言一个字没动，只是把挂载方式换成"外壳 + 首页"（理由见
    // mountShellWithHome 的注释）：按钮显示的是"真的在响"，而写回它的是外壳里的播放器。
    // 改动前的实现把 <audio> 放在卡片里，所以只挂首页也能翻成 ❚❚ —— 那是旧架构的产物。
    const wrapper = await mountShellWithHome()

    const button = () => wrapper.find('#music .mu-ctl .play')
    expect(button().text()).toBe('▶')

    await button().trigger('click')
    await flushPromises()
    expect(button().text()).toBe('❚❚')

    await button().trigger('click')
    await flushPromises()
    expect(button().text()).toBe('▶')
  })

  // 【这里原来还有一条「音频播放结束_should把按钮切回『播放』」】
  //   2026-09-11 它的驱动方式变了（`ended` 现在由外壳那个 audio 派发，卡片里已经没有播放器了），
  //   于是整条**搬到了** test/backgroundMusic.nuxt.spec.ts 的
  //   「背景音乐 · 播放器住在外壳里」那一组（用例名：`ended 事件_should把"在响"与进度一起归零…`）。
  //   搬家时原语义一条没丢，反而多了一句：`enabled`（想不想听）**不变**、只有 `playing` 归零
  //   —— 而且那条用例名/注释里明确写了"loop 生效时浏览器根本不会派发 ended，
  //   这是防御性路径"，不再暗示"播完会自己回到 ▶"（现在的行为是循环播放，不会停）。
  //   放在那边而不是这里，是因为它需要"挂外壳"才能拿到那个 `<audio>`，
  //   而本文件的主题是"首页上有没有假内容"。

  // ---------------------------------------------------------------
  // 三、真内容没被误删
  // ---------------------------------------------------------------

  it('删假数据_should不影响真实内容的渲染', async () => {
    const wrapper = await mountHome()

    // 文章列表、筛选条、个人卡片、时钟入口这些真实功能都还在
    expect(wrapper.text()).toContain('真实的文章标题')
    expect(wrapper.findAll('.cat').length).toBe(2)          // 「全部」+ 技术
    expect(wrapper.findAll('.pf-stats .st').length).toBe(3)
    expect(wrapper.text()).toContain('背景音乐')

    // 时钟面板也还在，并且能打开
    await wrapper.find('.dock .di').trigger('click')
    expect(wrapper.find('.clock').exists()).toBe(true)
    expect(wrapper.find('.ck-time').text()).not.toBe('')
  })
})

// =====================================================================
// 首页 · 站点设置里的「公告」与「每页条数」
//
// 【这两项为什么放在首页测】
//   它们各自只驱动首页上的一处：公告 → 顶部那条通知；每页条数 →
//   请求 /article/page 时带的 size。断在首页上才是"用户真的看得到/真的发出去了"。
//
// 【公告那两条的要点】
//   · 填了 → 顶部出现，而且是**纯文本插值**（它由管理员填写，仍按文本渲染）
//   · 留空 → **整块不渲染**，首页外观与"上线这个功能之前"完全一样 ——
//     这正是迁移里把公告留空的用意
//   公告条与原来那条欢迎跑马灯是**两块**：跑马灯是站点自己的装饰文案，
//   公告是会变的通知。合并的话，一发公告欢迎语就没了（见 index.vue 里的说明）。
// =====================================================================

describe('首页 · 站点公告与每页条数', () => {
  const BASE_SETTINGS = {
    siteName: '测试站点名',
    announcement: null,
    commentEnabled: true,
    icpNumber: null,
    copyright: null,
    pageSize: 12,
  }

  /** 在默认假后端的基础上，让 /setting 返回指定内容 */
  const withSettings = (settings) => {
    fetchMock.mockImplementation((url) => {
      const path = pathOf(url)
      if (path === '/setting') return Promise.resolve(body(settings))
      if (path === '/category/list') return Promise.resolve(body([{ id: 1, name: '技术' }]))
      if (path === '/article/stats') return Promise.resolve(body({ articleCount: 1, viewCount: 5, categoryCount: 1 }))
      if (path === '/article/page') return Promise.resolve(body({ records: ARTICLES, total: 1 }))
      return Promise.resolve(body(null))
    })
  }

  const sizeSentToArticleList = () => {
    const call = fetchMock.mock.calls.find(c => pathOf(c[0]) === '/article/page')
    return call?.[1]?.params?.size
  }

  it('公告填了_首页顶部出现公告条，内容是纯文本', async () => {
    withSettings({ ...BASE_SETTINGS, announcement: '今晚 22:00 例行维护' })
    const wrapper = await mountHome()

    expect(wrapper.find('.announce').exists()).toBe(true)
    expect(wrapper.find('.announce').text()).toContain('今晚 22:00 例行维护')
    // 原有的欢迎跑马灯照旧在（两块，不是同一块）
    expect(wrapper.find('.notice').exists()).toBe(true)
  })

  it('⚠️ 公告留空_整块不渲染（首页外观与"上线这个功能之前"一样）', async () => {
    withSettings({ ...BASE_SETTINGS, announcement: '' })
    const wrapper = await mountHome()

    expect(wrapper.find('.announce').exists()).toBe(false)
    expect(wrapper.find('.notice').exists()).toBe(true)
  })

  it('每页条数_请求列表时带上设置里的 size（不是写死的 12）', async () => {
    withSettings({ ...BASE_SETTINGS, pageSize: 20 })

    const wrapper = await mountHome()

    expect(Number(sizeSentToArticleList())).toBe(20)
    // 顺带确认文章真的渲染出来了（不是在"没数据"的分支上）
    expect(wrapper.text()).toContain('真实的文章标题')
  })

  it('每页条数读不到_回落布局默认值 12（绝不把 undefined 当参数发出去）', async () => {
    // 默认假后端对未知路径返回 data:null，归一化会把它收拾成默认值
    mockBackend()

    await mountHome()

    expect(Number(sizeSentToArticleList())).toBe(12)
  })
})
