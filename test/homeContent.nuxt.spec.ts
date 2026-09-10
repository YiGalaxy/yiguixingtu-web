import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import IndexPage from '~/pages/index.vue'

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

describe('首页 · 内容真实性', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    mockBackend()
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

  it('音乐卡片_should只指向真实存在的那个音频文件', async () => {
    const wrapper = await mountHome()

    const audio = wrapper.findAll('audio')
    expect(audio.length).toBe(1)
    expect(audio[0].attributes('src')).toBe('/bg-music.mp3')
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

  it('音乐卡片_should保留 #music 锚点（导航栏的「音乐」指向它）', async () => {
    const wrapper = await mountHome()

    expect(wrapper.find('#music').exists()).toBe(true)
    // 卡片上写的是"背景音乐"这个真实的说明，而不是编出来的曲名
    expect(wrapper.find('.mu-title').text()).toBe('背景音乐')
  })

  it('点播放按钮_should在播放与暂停之间切换（清理没把播放功能误删）', async () => {
    const wrapper = await mountHome()

    const button = wrapper.find('.mu-ctl .play')
    expect(button.text()).toBe('▶')

    await button.trigger('click')
    expect(wrapper.find('.mu-ctl .play').text()).toBe('❚❚')

    await wrapper.find('.mu-ctl .play').trigger('click')
    expect(wrapper.find('.mu-ctl .play').text()).toBe('▶')
  })

  it('音频播放结束_should把按钮切回「播放」（原来这里接的是"下一首"）', async () => {
    const wrapper = await mountHome()

    await wrapper.find('.mu-ctl .play').trigger('click')
    expect(wrapper.find('.mu-ctl .play').text()).toBe('❚❚')

    await wrapper.find('audio').trigger('ended')
    expect(wrapper.find('.mu-ctl .play').text()).toBe('▶')
  })

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
