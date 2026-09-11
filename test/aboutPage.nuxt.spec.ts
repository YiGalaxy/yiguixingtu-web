import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// =====================================================================
// 关于页（/about）的组件测试
//
// 【这一组守的是什么】
//   关于页有三处与另外三个内容页**不一样**，每一处错了都很安静：
//
//   ① 接口返回的是**一个对象**，不是数组
//      `GET /about` 的形状由"这份数据只有一条"决定（后端 AboutController 的注释）。
//      前端要是不判断、直接拿 data 当对象用，或反过来去读 data[0]，
//      表现分别是"整页空白"和"页面上一堆 undefined"—— 两种都不报错。
//
//   ② bio 是 Markdown 原文，必须用**与文章详情页完全相同**的方式渲染
//      绝不能自己 v-html：Markdown 里可以塞原始 HTML，直接 v-html 等于让每个访客
//      的浏览器执行别人写进数据库的脚本（博客系统最经典的 XSS 入口）。
//      所以下面既断言"bio 原文交给了 MdPreview"，也**扫描源码**证明
//      ：about.vue 里没有 v-html、而且与文章详情页用的是同一个组件。
//      后一条是这条要求在单测里唯一能钉死的写法（"渲染出来的 HTML 长什么样"
//      是 MdPreview 自己的事，见 test/seo.nuxt.spec.ts 里同样的取舍）。
//
//   ③ 联系方式"后端给了才显示"
//      没填微信就整条不渲染，而不是印一行"微信：—"——后者看起来像数据丢了。
//      但 email / github 会被放进 href，所以它们仍然要能处理"值不合法"的情况。
//
// 【怎么拦请求 / 为什么结束要卸载】见 test/favoritesPage.nuxt.spec.ts 的文件头。
// =====================================================================

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))
mockNuxtImport('$fetch', () => fetchMock)

enableAutoUnmount(afterEach)

/**
 * 【为什么把 md-editor-v3 的预览组件换成一个桩】
 *   这一组用例关心的是"页面把 bio 交给了谁、有没有自己 v-html"，
 *   而"Markdown 怎么变成 HTML"是 MdPreview 自己的事（它内部接了 xss 库做白名单过滤）。
 *   桩里把 modelValue 渲染出来，是为了能断言"传进去的就是原文"。
 *   （global.stubs 对 <script setup> 里直接 import 的组件不生效，所以只能换模块。）
 */
vi.mock('md-editor-v3', async (importOriginal) => {
  const actual = await importOriginal()
  const { defineComponent, h } = await import('vue')
  return {
    ...actual,
    MdPreview: defineComponent({
      name: 'MdPreview',
      props: { modelValue: String },
      setup: props => () => h('div', { class: 'md-preview-stub' }, props.modelValue),
    }),
  }
})

// 【为什么要动态 import】vi.mock 是提升到文件顶部的，静态 import 可能先于桩生效；
//   动态 import 保证拿到的组件用的是被替换过的模块（同 test/seo.nuxt.spec.ts）。
const AboutPage = (await import('~/pages/about.vue')).default

const body = (data) => ({ code: 200, message: '成功', data })
const pathOf = (url) => String(url).split('?')[0]

/**
 * 后端 GET /about 的真实形状（AboutVO，**对象**）：
 *   { id, nickname, avatar, bio, email, github, wechat, qq, updateTime }
 * bio 是 Markdown 原文（后端不做任何转换）。
 */
const ABOUT = {
  id: 1,
  nickname: '别太在亿啦',
  avatar: '/avatar.png',
  bio: '## 你好\n\n这里是 **Markdown** 原文。',
  email: 'me@example.com',
  github: 'https://github.com/YiGalaxy',
  wechat: 'yigalaxy',
  qq: '10001',
  updateTime: '2026-09-10T05:03:19',
}

const mockBackend = (overrides = {}) => {
  fetchMock.mockImplementation((url) => {
    const path = pathOf(url)
    if (path in overrides) return Promise.resolve(overrides[path])
    if (path === '/about') return Promise.resolve(body(ABOUT))
    return Promise.resolve(body(null))
  })
}

const mountAbout = async () => {
  const wrapper = await mountSuspended(AboutPage)
  await flushPromises()
  return wrapper
}

/** 联系方式那一行的标签文字（按 DOM 顺序） */
const contactLabels = (wrapper) => wrapper.findAll('.ac-item .ai-label').map(n => n.text())

const headContent = (selector) => document.head.querySelector(selector)?.getAttribute('content')

const settleHead = async () => {
  await flushPromises()
  await new Promise((resolve) => { setTimeout(resolve, 0) })
  await flushPromises()
}

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8')

describe('关于页 · 站长是谁、怎么找我', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    mockBackend()
  })

  afterEach(async () => {
    await nextTick()
  })

  // ---------------------------------------------------------------
  // 一、正常渲染
  // ---------------------------------------------------------------

  it('有数据_should渲染昵称、头像与自我介绍', async () => {
    const wrapper = await mountAbout()

    expect(wrapper.find('.ac-name').text()).toBe('别太在亿啦')
    expect(wrapper.find('.ac-avatar').attributes('src')).toBe('/avatar.png')
    expect(wrapper.find('.md-preview-stub').exists()).toBe(true)
  })

  it('bio_should把 Markdown 原文原样交给 MdPreview（与文章详情页同一个组件）', async () => {
    const wrapper = await mountAbout()

    // 传进去的必须是**原文**（不含任何前端转换）：渲染规则只由 MdPreview 一套决定，
    // 前端自己先转一次就等于多出一套可能与文章页不一致的规则
    expect(wrapper.find('.md-preview-stub').text()).toBe(ABOUT.bio)
  })

  it('bio 为空_should不渲染 Markdown 区块，而是说清"还没有写"', async () => {
    mockBackend({ '/about': body({ ...ABOUT, bio: null }) })

    const wrapper = await mountAbout()

    expect(wrapper.find('.md-preview-stub').exists()).toBe(false)
    expect(wrapper.find('.ac-bio-empty').text()).toContain('还没有写自我介绍')
  })

  it('联系方式_should按后端给了的字段显示，并带上正确的链接形态', async () => {
    const wrapper = await mountAbout()

    expect(contactLabels(wrapper)).toEqual(['邮箱', 'GitHub', '微信', 'QQ'])

    // 邮箱是 mailto:（后端 @Email 校验过格式），且不该带 target（本站内跳转）
    const mail = wrapper.findAll('.ac-item .ai-value')[0]
    expect(mail.element.tagName).toBe('A')
    expect(mail.attributes('href')).toBe('mailto:me@example.com')

    // GitHub 是外链：必须有 target=_blank 与 rel=noopener
    const github = wrapper.findAll('.ac-item .ai-value')[1]
    expect(github.element.tagName).toBe('A')
    expect(github.attributes('href')).toBe('https://github.com/YiGalaxy')
    expect(github.attributes('target')).toBe('_blank')
    expect(github.attributes('rel')).toBe('noopener')

    // 微信 / QQ 只是纯文字（后端刻意不做格式校验）：绝不放进 href
    const wechat = wrapper.findAll('.ac-item .ai-value')[2]
    expect(wechat.element.tagName).not.toBe('A')
    expect(wechat.text()).toBe('yigalaxy')
  })

  it('只填了部分联系方式_should只显示填了的那几个（没给的不显示）', async () => {
    mockBackend({
      '/about': body({ id: 1, nickname: '只有邮箱的站长', email: 'a@b.com', avatar: null, bio: 'x' }),
    })

    const wrapper = await mountAbout()

    expect(contactLabels(wrapper)).toEqual(['邮箱'])
    // 【这一条是这个项目的底线】接口没给的东西就不显示 ——
    // 印一行"微信：—"看起来像数据丢了，而实际上站长从来没填过
    expect(wrapper.text()).not.toContain('微信')
    expect(wrapper.text()).not.toContain('QQ')
    // 头像为空时整块不渲染，而不是渲染一个 src="undefined" 的破图
    expect(wrapper.find('.ac-avatar').exists()).toBe(false)
  })

  it('一个联系方式都没有_should说一句话，而不是留一片空白', async () => {
    mockBackend({ '/about': body({ id: 1, nickname: 'n', bio: 'b' }) })

    const wrapper = await mountAbout()

    expect(wrapper.find('.ac-empty').text()).toContain('还没有公开任何联系方式')
  })

  it('更新时间_should按 app/utils/time.ts 的规则显示', async () => {
    const wrapper = await mountAbout()

    // 后端给的是没有时区的 LocalDateTime：只做字符串替换，不做时区换算
    // （交给 new Date() 会按浏览器本地时区掰一次，凌晨那几条可能整体差一天）
    expect(wrapper.find('.ac-updated').text()).toContain('2026-09-10 05:03:19')
  })

  it('没有更新时间_should整行不渲染（而不是印一个「—」）', async () => {
    // 【为什么这条必须单独一个用例、不能和上面那条放在一起】
    //   useAsyncData 的结果按 key 缓存在 payload 里，同一个用例里第二次 mount
    //   会命中上一次的缓存（一个请求都不发），于是这里拿到的还是上面那份数据 ——
    //   表现是"断言永远为真"的假绿。跨用例的缓存由 afterEach 的卸载 + nextTick 清掉。
    mockBackend({ '/about': body({ ...ABOUT, updateTime: null }) })

    const wrapper = await mountAbout()

    expect(wrapper.find('.ac-updated').exists()).toBe(false)
  })

  // ---------------------------------------------------------------
  // 二、字段缺失
  // ---------------------------------------------------------------

  it('昵称缺失_should显示「—」，而不是空白或 undefined', async () => {
    mockBackend({ '/about': body({ id: 1, nickname: null, bio: 'x', email: null }) })

    const wrapper = await mountAbout()

    expect(wrapper.find('.ac-name').text()).toBe('—')
    expect(wrapper.text()).not.toContain('undefined')
  })

  // ---------------------------------------------------------------
  // 三、接口失败与"不是对象"的返回
  // ---------------------------------------------------------------

  it('接口失败_should降级成一句人话 + 回首页的出口，页面骨架还在', async () => {
    mockBackend({ '/about': { code: 500, message: '服务器开小差了' } })

    const wrapper = await mountAbout()

    expect(wrapper.find('.ab-state').text()).toContain('关于页暂时读不到')
    expect(wrapper.find('.ab-state a').attributes('href')).toBe('/')
    expect(wrapper.find('.ab-head h1').text()).toBe('关于')
  })

  it('失败后点「重试」_should重新打一次接口，成功了就把内容渲染出来', async () => {
    mockBackend({ '/about': { code: 500, message: '服务器开小差了' } })

    const wrapper = await mountAbout()
    expect(wrapper.find('.ab-retry').exists()).toBe(true)

    // 第二次请求成功（模拟"那次只是一次网络抖动"）
    mockBackend()
    await wrapper.find('.ab-retry').trigger('click')
    await flushPromises()

    // 断言内容而不是"请求次数 +1"：retry 的语义是"把这一页救回来" ——
    // 只发请求、界面不更新在次数上是看不出来的
    expect(wrapper.find('.ac-name').text()).toBe('别太在亿啦')
    expect(wrapper.find('.ab-state').exists()).toBe(false)
    expect(fetchMock.mock.calls.filter(c => pathOf(c[0]) === '/about').length).toBe(2)
  })

  it('接口返回的不是对象（数组 / null）_should当成"没有内容"，而不是把页面打崩', async () => {
    // 这个接口的契约是"一个对象"：万一哪天有人把它改成返回数组，
    // 把数组当对象用会得到一堆 undefined（页面上看不出报错，只是内容全空）
    mockBackend({ '/about': body([ABOUT]) })

    const wrapper = await mountAbout()

    expect(wrapper.find('.ab-state').exists()).toBe(false)
    expect(wrapper.find('.ab-card').exists()).toBe(true)
    expect(wrapper.find('.ac-name').text()).toBe('—')
    expect(wrapper.text()).not.toContain('undefined')
  })

  it('接口的 data 是 null_should同样是"没有内容"（而不是当成接口失败）', async () => {
    mockBackend({ '/about': body(null) })

    const wrapper = await mountAbout()

    expect(wrapper.find('.ab-card').exists()).toBe(true)
    expect(wrapper.find('.ac-empty').exists()).toBe(true)
    // 接口是 200，所以不该说"读不到" —— 那是在陈述一件我们并不知道的事
    expect(wrapper.text()).not.toContain('读不到')
  })

  // ---------------------------------------------------------------
  // 四、请求拼装与 SEO
  // ---------------------------------------------------------------

  it('请求_should打到 /about 且只打一次、不带任何参数', async () => {
    await mountAbout()

    const calls = fetchMock.mock.calls.filter(c => pathOf(c[0]) === '/about')
    expect(calls).toHaveLength(1)
    // 路径是 /about 而不是 /about/list（只有一条数据），也没有 id 参数
    expect(calls[0][1]?.params).toBeUndefined()
  })

  it('SEO_should有 title / description / canonical', async () => {
    await mountAbout()
    await settleHead()

    expect(document.title).toContain('关于')
    expect(headContent('meta[name="description"]')).toContain('关于亿轨星途')
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href'))
      .toBe('https://www.yigalaxy.xin/about')
  })

  // ---------------------------------------------------------------
  // 五、源码扫描：bio 的渲染方式必须与文章详情页一致
  // ---------------------------------------------------------------

  it('关于页_should用 MdPreview 渲染 bio（源码里绝不能出现 v-html 绑定）', () => {
    const src = read('app/pages/about.vue')

    expect(src).toContain('MdPreview')
    expect(src).toContain('md-editor-v3')
    // 【安全红线】v-html 会把字符串当 HTML 解析 —— Markdown 里可以塞原始 HTML，
    // 那等于让每个访客的浏览器执行别人写进数据库的脚本。
    // 【为什么这里用"属性写法"的正则、而不是 `not.toContain('v-html')`】
    //   这份源码的**注释里**是故意提到 v-html 的（说明"为什么不用它"），
    //   用子串匹配会把注释也算成违规 —— 与 test/styleContract.spec.ts 里
    //   "注释里的 class 不算用到了这个类"是同一个教训。
    expect(src).not.toMatch(/\bv-html\s*=/)
  })

  it('文章详情页_should用的是同一个组件（否则两处的渲染规则就分叉了）', () => {
    // 【为什么这条断言有意义】"用完全相同的方式渲染"这句话，在单测里唯一能钉住的
    // 写法就是"两处引用的是同一个组件"：不然哪天关于页换成别的 Markdown 库，
    // 同一段 Markdown 在两个页面上的显示效果就会不一样 ——
    // 而这属于"页面上能看出来、但没有任何测试会红"的那一类问题。
    const article = read('app/pages/article/[id].vue')

    expect(article).toContain('MdPreview')
    expect(article).toContain('md-editor-v3')
    // 两处的主题参数也要一致（深色主题），否则一块亮一块暗
    expect(read('app/pages/about.vue')).toContain('theme="dark"')
    expect(article).toContain('theme="dark"')
  })
})
