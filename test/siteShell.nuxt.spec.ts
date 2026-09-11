import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises, enableAutoUnmount } from '@vue/test-utils'
import AppShell from '~/app.vue'
import { SITE_NAME } from '~/utils/seo'
import { ICP_LINK, POLICE_LINK } from '~/utils/siteSettings'

// =====================================================================
// 站点设置的「外壳接线」—— 页眉站名 + 页脚的版权与两类备案
//
// 【这一组最要紧的是备案那几条】
//   页面底部展示备案号（ICP + 公安网安）是大陆站点的**合规要求**，
//   而且公安那一条还要求带官方图标。所以这里钉的是四件事：
//     ① 填了备案号 → 它真的出现在页脚，且链到对应平台（ICP → 工信部，公安 → 公安部）
//     ② 留空 → 那一项**整个不渲染**（不是渲染一个空链接）；
//        三项全空时那一行**整行不存在**，这样"上线这个功能"本身不改变站点外观
//     ③ 站点设置读不到（接口失败）→ 站名回落到 seo.ts 的 SITE_NAME，
//        页脚不会出现一片空白
//     ④ **位置**：那一行在页脚内部、且在"品牌 + 音乐开关"那一行**之后**
//        （用户报过"备案号位置不对"，所以位置本身也进了断言 ——
//         只断言"它存在"是抓不到位置问题的）
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
  policeNumber: '川公网安备 51090002000169号',
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

describe('外壳：页脚的版权与两类备案', () => {
  it('三样都有时：都渲染出来，两类备案各自链到【自己的】平台', async () => {
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

    // 公安备案：链到公安部平台、URL 里要带上备案编号的数字部分（不是把号原样拼进去）
    // 【为什么这里不调 policeQueryUrl() 来拼期望值】那是"用实现验证实现"——
    //   函数拼错时用例会跟着一起错、照样绿。期望值在这里按平台规则手写一遍。
    const police = meta.find('.foot-police')
    expect(police.text()).toContain('川公网安备 51090002000169号')
    expect(police.attributes('href'))
      .toBe(`${POLICE_LINK}#/query/webSearch?code=51090002000169`)
    expect(police.attributes('href')).not.toContain('miit.gov.cn')
    expect(police.attributes('target')).toBe('_blank')
    expect(police.attributes('rel')).toContain('noopener')
    // ⚠️ 公安那一条必须有官方图标（合规要求是"备案号 + 图标"一起展示），
    //    而且它走 /media/ 前缀（static-media/ 里的文件，不进构建产物，可与备案号一起换）
    const icon = police.find('.foot-police-icon')
    expect(icon.exists()).toBe(true)
    expect(icon.attributes('src')).toBe('/media/beian.png')
    expect(icon.attributes('alt')).toBeTruthy()
  })

  it('⚠️ 三样都为空时：那一行【整个不渲染】（上线这个功能不改变外观）', async () => {
    respondWith({ ...SETTINGS, icpNumber: null, policeNumber: null, copyright: null })
    const w = await mountShell()

    // 页脚仍然在（第一行的站名与音乐开关照旧），只是没有第二行
    expect(w.find('.site-footer').exists()).toBe(true)
    expect(w.find('.foot-top').exists()).toBe(true)
    expect(w.find('.foot-meta').exists()).toBe(false)
    expect(w.find('.foot-icp').exists()).toBe(false)
    expect(w.find('.foot-police').exists()).toBe(false)
  })

  it('只有备案号（没填版权）时：两项备案都渲染，版权那一段不出现', async () => {
    respondWith({ ...SETTINGS, copyright: null })
    const w = await mountShell()

    const meta = w.find('.foot-meta')
    expect(meta.exists()).toBe(true)
    expect(meta.find('.foot-icp').exists()).toBe(true)
    expect(meta.find('.foot-police').exists()).toBe(true)
    // 空字符串与 null 都归一化成"不渲染"，所以版权那一段文字不该出现
    expect(meta.text()).not.toContain('©')
  })

  it('版权填了、两类备案都没填：只渲染版权（不出现空的备案链接）', async () => {
    respondWith({ ...SETTINGS, icpNumber: '', policeNumber: '   ' })
    const w = await mountShell()

    const meta = w.find('.foot-meta')
    expect(meta.exists()).toBe(true)
    expect(meta.text()).toContain('© 2026 测试站点')
    expect(meta.find('.foot-icp').exists()).toBe(false)
    expect(meta.find('.foot-police').exists()).toBe(false)
  })

  it('只填了公安备案号时：ICP 那一项不渲染（两类备案各自独立）', async () => {
    // 【为什么要单独一条】页脚那一行是"三项并列、各自 v-if"的结构，
    // 很容易写成"有任一备案号就把两项都显示出来"，于是没填 ICP 的站会多出一个空链接
    respondWith({ ...SETTINGS, icpNumber: null })
    const w = await mountShell()

    const meta = w.find('.foot-meta')
    expect(meta.find('.foot-icp').exists()).toBe(false)
    expect(meta.find('.foot-police').exists()).toBe(true)
  })

  it('⚠️ 位置：备案那一行在页脚【内部】，且在"品牌 + 音乐开关"那一行【之后】', async () => {
    // 【用户实际报过的问题】备案号的位置不对 —— 所以"存在"之外还要钉住"在哪"。
    //   期望的结构是：页脚纵向两行，第一行是品牌与音乐开关，第二行才是通栏居中的备案信息。
    const w = await mountShell()

    const footer = w.find('.site-footer')
    expect(footer.exists()).toBe(true)

    // ① 那一行确实在 footer 里面（不是被放到了别处，比如顶栏或某个浮层）
    expect(footer.find('.foot-meta').exists()).toBe(true)

    // ② 顺序：foot-top（品牌 + 音乐开关）在前，foot-meta（备案）在后
    const html = footer.html()
    expect(html.indexOf('foot-top')).toBeGreaterThan(-1)
    expect(html.indexOf('foot-top')).toBeLessThan(html.indexOf('foot-meta'))

    // ③ 音乐开关现在属于第一行（原来它是页脚的直接子元素，改版后要跟着品牌走）
    expect(footer.find('.foot-top .music-toggle').exists()).toBe(true)
    expect(footer.find('.foot-meta .music-toggle').exists()).toBe(false)
  })
})
