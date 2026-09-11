import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises, enableAutoUnmount } from '@vue/test-utils'
import AppShell from '~/app.vue'
import { SITE_NAME } from '~/utils/seo'
import { ICP_LINK } from '~/utils/siteSettings'

// =====================================================================
// 站点设置的「外壳接线」—— 页眉站名 + 页脚版权与备案号
//
// 【这一组最要紧的是备案号那两条】
//   页面底部展示备案号并链接到工信部，是大陆备案的**合规要求**。
//   所以这里钉的是三件事：
//     ① 填了备案号 → 它真的出现在页脚，且链到 ICP_LINK（工信部备案系统）
//     ② 留空 → 那一行**整个不渲染**（不是渲染一个空条），
//        这样"上线这个功能"本身不改变站点外观
//     ③ 站点设置读不到（接口失败）→ 站名回落到 seo.ts 的 SITE_NAME，
//        页脚不会出现一片空白
//
// 【为什么断言的是渲染出来的 DOM，而不是"组合式函数被调用了"】
//   这一层的价值全在"用户真的看得到"，所以断言落在 `.brand-name` / `.foot-meta`
//   这些真实节点上。第一版只断言了 settings 对象，那样即使模板里写错了变量名
//   （页脚仍然显示写死的旧站名）也照样绿。
// =====================================================================

const { fetchMock, cookieRefs } = vi.hoisted(() => ({ fetchMock: vi.fn(), cookieRefs: {} }))
mockNuxtImport('$fetch', () => fetchMock)
// app.vue 的模板里有 `v-if="token"`，所以 useCookie 必须返回【真的 ref】才会被模板自动解包
// （普通对象永远是真值，顶栏会一直按"已登录"渲染）—— 与其它挂载外壳的用例同款写法
mockNuxtImport('useCookie', () => (name) => {
  if (!cookieRefs[name]) cookieRefs[name] = ref(null)
  return cookieRefs[name]
})

enableAutoUnmount(afterEach)

const body = (data) => ({ code: 200, message: '成功', data })
const pathOf = (url) => String(url).split('?')[0]

const SETTINGS = {
  siteName: '测试站点名',
  announcement: null,
  commentEnabled: true,
  icpNumber: '京ICP备12345678号-1',
  copyright: '© 2026 测试站点',
  pageSize: 12,
}

/** 让 /setting 返回给定的内容；其余路径（/auth/me、/category/list…）给空 */
const respondWith = (settings) => {
  fetchMock.mockImplementation((url) => {
    if (pathOf(url) === '/setting') return Promise.resolve(body(settings))
    return Promise.resolve(body(null))
  })
}

beforeEach(() => {
  fetchMock.mockReset()
  respondWith(SETTINGS)
  for (const key of Object.keys(cookieRefs)) cookieRefs[key].value = null
})

const mountShell = async () => {
  const wrapper = await mountSuspended(AppShell, {
    global: { stubs: { NuxtPage: true, NuxtRouteAnnouncer: true } },
  })
  await flushPromises()
  return wrapper
}

describe('外壳：页眉与页脚的站名', () => {
  it('页眉与页脚都显示站点设置里的站点名（不是代码里写死的那个）', async () => {
    const w = await mountShell()

    expect(w.find('.brand-name').text()).toBe('测试站点名')
    expect(w.find('.foot-brand').text()).toContain('测试站点名')
    // 反向确认：代码里那个默认常量**不该**出现在这一页上
    // （它只在"读不到设置"时才该出现，见下面那条用例）
    expect(w.find('.foot-brand').text()).not.toContain(SITE_NAME)
  })

  it('站点设置读不到时，站名回落 seo.ts 的 SITE_NAME（页脚不会空）', async () => {
    fetchMock.mockImplementation(() => Promise.resolve({ code: 500, message: '服务器内部错误', data: null }))
    const w = await mountShell()

    expect(w.find('.brand-name').text()).toBe(SITE_NAME)
    expect(w.find('.foot-brand').text()).toContain(SITE_NAME)
  })
})

describe('外壳：页脚的版权与备案号', () => {
  it('两样都有时：都渲染出来，且备案号链到工信部', async () => {
    const w = await mountShell()

    const meta = w.find('.foot-meta')
    expect(meta.exists()).toBe(true)
    expect(meta.text()).toContain('© 2026 测试站点')

    const icp = meta.find('.foot-icp')
    expect(icp.text()).toBe('京ICP备12345678号-1')
    expect(icp.attributes('href')).toBe(ICP_LINK)
    // 外链的固定要求：新窗口打开 + noopener（否则新页面能通过 window.opener 操作本页）
    expect(icp.attributes('target')).toBe('_blank')
    expect(icp.attributes('rel')).toContain('noopener')
  })

  it('⚠️ 两样都为空时：那一行【整个不渲染】（上线这个功能不改变外观）', async () => {
    respondWith({ ...SETTINGS, icpNumber: null, copyright: null })
    const w = await mountShell()

    // 页脚仍然在（站名与音乐开关照旧），只是没有那第二行
    expect(w.find('.site-footer').exists()).toBe(true)
    expect(w.find('.foot-meta').exists()).toBe(false)
    expect(w.find('.foot-icp').exists()).toBe(false)
  })

  it('只有备案号（没填版权）时：只渲染备案号那一个链接', async () => {
    respondWith({ ...SETTINGS, copyright: null })
    const w = await mountShell()

    const meta = w.find('.foot-meta')
    expect(meta.exists()).toBe(true)
    expect(meta.find('.foot-icp').exists()).toBe(true)
    // 空字符串与 null 都归一化成"不渲染"，所以版权那一段文字不该出现
    expect(meta.text()).toBe('京ICP备12345678号-1')
  })

  it('版权填了、备案号没填：只渲染版权（不出现一个空的备案链接）', async () => {
    respondWith({ ...SETTINGS, icpNumber: '' })
    const w = await mountShell()

    const meta = w.find('.foot-meta')
    expect(meta.exists()).toBe(true)
    expect(meta.text()).toContain('© 2026 测试站点')
    expect(meta.find('.foot-icp').exists()).toBe(false)
  })
})
