import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises, enableAutoUnmount } from '@vue/test-utils'
import IndexPage from '~/pages/index.vue'

// =====================================================================
// 全站 SEO 元信息
//
// 【这一组守的是什么】
//   改之前全站只有一个 <title>（还只在文章详情页），没有 description /
//   og / canonical —— 对博客来说这是硬伤：
//     · 搜索引擎拿不到摘要，只能自己从正文里截一段（常常截到导航文字或代码）
//     · 链接分享出去没有卡片，只有一行光秃秃的地址
//     · 带 ?keyword= 的搜索结果页和首页是同一份内容，却没有 canonical
//       指明谁是正式地址，爬到两遍会被当成重复内容
//   这类东西的特点是【页面上看不出来】：title 写错、canonical 写成相对地址、
//   og:image 拼出一个空值，本地打开页面都一切正常，
//   只有在"被搜到"或"被分享"的时候才发现不对 —— 所以只能靠断言钉住。
//
// 【为什么分两层测】
//   ① 纯函数层（buildSeoHead / absoluteUrl / normalizeSiteUrl）：
//      规则本身对不对（空值兜底、相对路径怎么拼、没有封面时会不会留下空的 og:image）
//   ② 组件层：首页有没有真的把它接上去（head 里到底有没有那几条标签）
//      组合式函数全绿、页面忘了调，是两回事。
//
// 【为什么还要断言"首屏渲染就有文章列表"】
//   这条是 w7.1 的核心诉求：服务端返回的 HTML 里要有文章列表。
//   组件测试里无法真的跑一次 SSR（那由 npm run build + curl 实测覆盖），
//   但可以断言"数据在第一帧渲染里就有了，而不是挂在某个 onMounted 之后"——
//   这两种写法在浏览器里看起来一模一样，只有服务端返回的 HTML 能区分开。
// =====================================================================

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))
mockNuxtImport('$fetch', () => fetchMock)

// 【为什么每个用例结束后要卸载组件】见 index.nuxt.spec.ts 里的详细说明：
// useAsyncData 的结果按 key 缓存进 Nuxt payload，而缓存的释放时机是组件卸载；
// 本文件所有用例共用同一个 Nuxt 应用实例，不卸载的话后面的用例会直接
// 沿用上一个用例的数据（连请求都不发）。nextTick 是等缓存清理真正落地。
enableAutoUnmount(afterEach)

/** 后端统一返回 { code, message, data } */
const body = (data) => ({ code: 200, message: '成功', data })
const pathOf = (url) => String(url).split('?')[0]

const ARTICLES = [
  { id: 31, title: '服务端就该有这篇文章', categoryName: '技术', viewCount: 7, createTime: '2026-09-10T10:00:00' },
]

/** 默认的假后端：文章 / 分类 / 统计都给一份数据 */
const mockBackend = () => {
  fetchMock.mockImplementation((url) => {
    const path = pathOf(url)
    if (path === '/category/list') return Promise.resolve(body([{ id: 1, name: '技术' }]))
    if (path === '/article/stats') return Promise.resolve(body({ articleCount: 1, viewCount: 7, categoryCount: 1 }))
    if (path === '/article/page') return Promise.resolve(body({ records: ARTICLES, total: 1 }))
    return Promise.resolve(body(null))
  })
}

/** 读 head 里某条标签的 content（选择器直接用真实标签选择器，避免另造一套映射） */
const headContent = (selector) => document.head.querySelector(selector)?.getAttribute('content')

/** 当前页面 head 里所有 og:* 的键值（调试与断言都好用） */
const ogOf = (property) => headContent(`meta[property="${property}"]`)

/**
 * 等 head 真正写进 DOM。
 *
 * 【为什么要等一个宏任务 —— 踩过的坑】unhead 的客户端渲染是**防抖**的：
 * 每次 push 都用 `setTimeout(..., 0)` 安排一次渲染
 * （见 @unhead/vue/dist/client.mjs 里的 debouncedRenderer），
 * 所以只 await flushPromises()（那是微任务）时 document.head 里还是空的 ——
 * 断言会拿到 ''，看着像"SEO 压根没接上"，其实只是标签还没画出来。
 */
const settleHead = async () => {
  await flushPromises()
  await new Promise((resolve) => { setTimeout(resolve, 0) })
  await flushPromises()
}

describe('SEO · 纯函数拼装规则', () => {
  const base = { siteUrl: 'https://www.yigalaxy.xin', path: '/' }

  it('首页_should有标题、描述、canonical 与五条 og', () => {
    const head = buildSeoHead(base)
    const props = head.meta.map(m => m.property).filter(Boolean)

    expect(head.title).toBe(SITE_TITLE)
    expect(head.meta).toContainEqual({ name: 'description', content: SITE_DESCRIPTION })
    // 【为什么逐条断言而不是"包含某几条"】这条用例的价值就在"og 的集合是哪几条"——
    // 少一条分享卡片就缺一块，多一条（比如把 name 写成 property）页面上完全看不出来。
    // ⚠️ 2026-09-11 由四条变五条：补上了 og:site_name（在那之前 SITE_NAME 的注释里
    //    写着"出现在 og:site_name 里"，而这里其实从来没输出过它 —— 见下面那条用例）
    expect(props).toEqual(['og:title', 'og:description', 'og:type', 'og:url', 'og:site_name'])
    // link 有两类：canonical（正式地址）与 alternate（RSS 自动发现）。
    // 【为什么逐条断言而不是只查 canonical】多出来的那条 link 很容易被顺手加错
    // （rel 写成 feed、type 漏掉、href 用了相对地址），而页面上完全看不出来 ——
    // 只有订阅器去抓的时候才会发现"这个站没有可订阅的源"
    expect(head.link).toEqual([
      { rel: 'canonical', href: 'https://www.yigalaxy.xin/' },
      {
        rel: 'alternate',
        type: 'application/rss+xml',
        title: `${SITE_NAME} 的 RSS 订阅`,
        href: 'https://www.yigalaxy.xin/feed.xml',
      },
    ])
    // og:url 与 canonical 必须是同一个地址：两者不一致等于自己声明了两个正式地址
    expect(ogOfFrom(head, 'og:url')).toBe('https://www.yigalaxy.xin/')
  })

  it('文章页_should标题带站点名、og:type 是 article、canonical 指向文章地址', () => {
    const head = buildSeoHead({
      ...base,
      path: '/article/12',
      title: '记一次 SSR 改造',
      description: '首页改成服务端渲染之后，文章列表终于出现在 HTML 里了。',
      type: 'article',
    })

    // 标题格式：文章标题 + 间隔点 + 站点名（标签页与分享卡片都靠它认人）
    expect(head.title).toBe(`记一次 SSR 改造${TITLE_SEPARATOR}${SITE_NAME}`)
    expect(ogOfFrom(head, 'og:title')).toBe(head.title)
    expect(ogOfFrom(head, 'og:type')).toBe('article')
    expect(head.link[0].href).toBe('https://www.yigalaxy.xin/article/12')
  })

  it('每条页面_should都带着 RSS 自动发现的 link（不只是首页）', () => {
    // 【为什么每个页面都要有】订阅器（以及浏览器的订阅扩展）是拿"用户当前打开的
    // 那个地址"去发现订阅源的 —— 用户最常打开的不是首页，而是分享出去的文章页。
    // 只在首页加的话，从一篇文章认识这个博客的人根本发现不了订阅入口。
    const head = buildSeoHead({ siteUrl: 'https://www.yigalaxy.xin', path: '/article/12', title: '一篇文章' })
    const alternate = head.link.filter(l => l.rel === 'alternate')

    expect(alternate).toHaveLength(1)
    expect(alternate[0].href).toBe('https://www.yigalaxy.xin/feed.xml')
    expect(alternate[0].type).toBe('application/rss+xml')
  })

  it('没有封面时_should整条 og:image 都不出现（不是空值）', () => {
    const head = buildSeoHead({ ...base, title: '一篇文章' })

    // 关键在"整条都不出现"：content 写成空串或 undefined 等于对外声明
    // "这个页面有一张空图"，分享出去就是一张空白卡片，
    // 而且只有真去分享的时候才看得出来
    expect(head.meta.filter(m => m.property === 'og:image')).toEqual([])
    expect(JSON.stringify(head.meta)).not.toContain('og:image')
  })

  it('有封面时_should把站内相对路径拼成绝对地址（og:image 规范要求绝对地址）', () => {
    const head = buildSeoHead({ ...base, path: '/article/12', image: '/uploads/cover.png' })

    // 后端封面存的是 /uploads/xxx.png；直接把相对路径塞进 og:image
    // 抓取方会当成"没有图"，而页面上完全看不出来
    expect(ogOfFrom(head, 'og:image')).toBe('https://www.yigalaxy.xin/uploads/cover.png')
  })

  it('封面本来就是绝对地址时_should原样保留（以后挪到 CDN 也能用）', () => {
    const head = buildSeoHead({ ...base, image: 'https://cdn.example.com/a.png' })

    expect(ogOfFrom(head, 'og:image')).toBe('https://cdn.example.com/a.png')
  })

  it('封面上只有空白时_should当成没有封面', () => {
    expect(buildSeoHead({ ...base, image: '   ' }).meta.filter(m => m.property === 'og:image')).toEqual([])
  })

  it('后台页_should带 noindex, nofollow（它不该被搜到）', () => {
    const head = buildSeoHead({ ...base, path: '/admin', title: '后台管理', noindex: true })

    expect(head.meta).toContainEqual({ name: 'robots', content: 'noindex, nofollow' })
    expect(head.link[0].href).toBe('https://www.yigalaxy.xin/admin')
  })

  it('普通页面_should不带 robots 标签（默认允许抓取）', () => {
    expect(buildSeoHead(base).meta.some(m => m.name === 'robots')).toBe(false)
  })

  it('标题为空时_should回落到站点默认标题（不能出现空 title）', () => {
    // 文章数据还没回来、文章不存在、或者有人忘了传 title —— 三种情况下
    // 都不能给搜索引擎一个空 <title>
    expect(buildSeoHead({ ...base, title: '' }).title).toBe(SITE_TITLE)
    expect(buildSeoHead({ ...base }).title).toBe(SITE_TITLE)
    expect(buildSeoHead({ ...base, title: '   ' }).title).toBe(SITE_TITLE)
  })

  it('描述为空时_should回落到站点默认描述', () => {
    const head = buildSeoHead({ ...base, description: '  ' })

    expect(head.meta).toContainEqual({ name: 'description', content: SITE_DESCRIPTION })
    expect(ogOfFrom(head, 'og:description')).toBe(SITE_DESCRIPTION)
  })

  it('任何页面_should都带上 lang=zh-CN（读屏与搜索引擎都读它）', () => {
    expect(buildSeoHead(base).htmlAttrs).toEqual({ lang: 'zh-CN' })
    expect(HTML_LANG).toBe('zh-CN')
  })

  it('站点地址_should去掉结尾多余的斜杠（否则会拼出双斜杠）', () => {
    expect(normalizeSiteUrl('https://a.example.com/')).toBe('https://a.example.com')
    expect(normalizeSiteUrl('https://a.example.com///')).toBe('https://a.example.com')
    expect(absoluteUrl('/article/1', 'https://a.example.com/')).toBe('https://a.example.com/article/1')
  })

  it('站点地址为空或不合法时_should回落到默认域名（不能拼出相对 canonical）', () => {
    // 【为什么这类值必须回落】canonical 规范要求绝对地址；填成
    // www.example.com（少了协议）时拼出来的是相对地址 —— 搜索引擎会直接忽略，
    // 而页面看起来"填了 canonical"，属于静默失效
    for (const bad of ['', '   ', undefined, null, 123, 'www.example.com', '/article']) {
      expect(normalizeSiteUrl(bad), `站点地址 ${String(bad)} 应回落到默认值`).toBe(DEFAULT_SITE_URL)
    }
    expect(normalizeSiteUrl('http://localhost:3000')).toBe('http://localhost:3000')
  })

  it('页面路径_should能被拼成绝对地址（缺斜杠也补上）', () => {
    expect(absoluteUrl('/', 'https://a.example.com')).toBe('https://a.example.com/')
    expect(absoluteUrl('/article/9', 'https://a.example.com')).toBe('https://a.example.com/article/9')
    expect(absoluteUrl('article/9', 'https://a.example.com')).toBe('https://a.example.com/article/9')
    expect(absoluteUrl('', 'https://a.example.com')).toBe('https://a.example.com/')
  })

  it('pageTitle / pageDescription_should把兜底规则收在一处', () => {
    expect(pageTitle('分类下')).toBe(`分类下${TITLE_SEPARATOR}${SITE_NAME}`)
    expect(pageTitle(undefined)).toBe(SITE_TITLE)
    expect(pageDescription('摘要')).toBe('摘要')
    expect(pageDescription(undefined)).toBe(SITE_DESCRIPTION)
  })
})

/** 从 buildSeoHead 的结果里取某条 meta 的 content（避免每个用例都写一遍 find） */
const ogOfFrom = (head, property) =>
  head.meta.find(m => m.property === property)?.content

describe('SEO · 首页真的接到了 head 上', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    mockBackend()
  })

  afterEach(async () => {
    await nextTick()
  })

  it('挂载首页_should把 title / description / canonical / og 写进 head', async () => {
    await mountSuspended(IndexPage)
    await settleHead()

    expect(document.title).toBe(SITE_TITLE)
    expect(headContent('meta[name="description"]')).toBe(SITE_DESCRIPTION)
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href'))
      .toBe('https://www.yigalaxy.xin/')
    expect(ogOf('og:title')).toBe(SITE_TITLE)
    expect(ogOf('og:description')).toBe(SITE_DESCRIPTION)
    expect(ogOf('og:type')).toBe('website')
    expect(ogOf('og:url')).toBe('https://www.yigalaxy.xin/')
    // 首页没有封面这样的概念，所以不能凭空出现一条空的 og:image：
    // 这里断言的是"标签根本不存在"，而不是"它的 content 是空的"——
    // content="" 也属于对外声明一张空图，分享出去照样是空白卡片
    expect(document.head.querySelector('meta[property="og:image"]')).toBeNull()
    // lang 写在 html 标签上
    expect(document.documentElement.getAttribute('lang')).toBe('zh-CN')
    // RSS 自动发现：页面的 head 里真的有这条 link（订阅器靠它找到 /feed.xml）
    expect(document.head.querySelector('link[rel="alternate"][type="application/rss+xml"]')?.getAttribute('href'))
      .toBe('https://www.yigalaxy.xin/feed.xml')
  })

  it('带筛选参数的地址_should canonical 仍然指向不带参数的首页', async () => {
    await mountSuspended(IndexPage, { route: '/?keyword=nuxt&categoryId=2' })
    await settleHead()

    // 搜索结果页与首页是同一份内容：正式地址只留 /，
    // 否则爬虫会把每个关键词组合都当成一个独立页面收录（重复内容）
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href'))
      .toBe('https://www.yigalaxy.xin/')
    expect(ogOf('og:url')).toBe('https://www.yigalaxy.xin/')
  })

  it('首屏渲染（还没等任何客户端 effect）_should已经带着文章列表', async () => {
    // 【为什么这条能代表"服务端渲染也是这份 HTML"】mountSuspended 会等 setup 里的
    // await 完成再渲染第一帧，所以"挂载后立刻读到的这棵树"就是
    // 服务端 useAsyncData 拿完数据后渲染出来的那棵树。
    // 反过来，如果数据是靠 onMounted 里发的请求拿的，这一帧里不会有文章 ——
    // 这正是改之前的问题（搜索引擎抓到的首页是空壳）。
    // 真·SSR 由 npm run build + curl 实测覆盖（见 README）。
    const wrapper = await mountSuspended(IndexPage)

    expect(wrapper.text()).toContain(ARTICLES[0].title)
    expect(wrapper.find('.waterfall .af').exists()).toBe(true)
    // 列表标题也应该是渲染好的中文，而不是"加载中…"
    expect(wrapper.find('.w-head h2').text()).toBe('最新文章')
  })
})

// =====================================================================
// 文章详情页 / 后台页的 SEO
//
// 【为什么这两页也要测】它们各自有【不同】的规则，混在一起用默认值就错了：
//   · 详情页的 og:type 必须是 article、标题必须跟着文章走、
//     封面（库里存的是 /uploads/xxx.png）必须拼成绝对地址 ——
//     首页那一套默认值套上去，分享出去就是"没有缩略图的卡片"
//   · 后台页必须带 noindex：它是登录后才看得见的内部工具，
//     被搜索引擎收录等于把管理入口递出去
// =====================================================================

/**
 * 【为什么要把 md-editor-v3 的预览组件换成一个空组件】
 *   这一组用例只关心 head（title / og / canonical），正文怎么渲染是 MdPreview 自己的事。
 *   两个理由：
 *   · `global.stubs` 对 <script setup> 里**直接 import** 的组件不生效
 *     （@vue/test-utils 的已知限制，实测 stub 了但页面里渲染的还是真组件），所以只能换模块
 *   · 顺带避开一个与本任务无关的既有问题：页面里写的是 `:language="zh_CN"`，
 *     而 md-editor-v3 把 language 声明成 String，传对象会在挂载时打一条
 *     Vue 的 prop 类型警告。那条警告不是这次改动引入的，只记进汇报、不在测试里遮掉它
 */
vi.mock('md-editor-v3', async (importOriginal) => {
  const actual = await importOriginal()
  const { defineComponent, h } = await import('vue')
  return {
    ...actual,
    MdPreview: defineComponent({
      name: 'MdPreview',
      props: { modelValue: String },
      setup: () => () => h('div', { class: 'md-preview-stub' }),
    }),
  }
})

/** 详情页的假后端：给一篇文章（带封面），封面刻意用站内相对路径 */
const ARTICLE_DETAIL = {
  id: 12,
  title: '记一次首页 SSR 改造',
  summary: '把 onMounted 换成 useAsyncData 之后，文章列表终于出现在服务端 HTML 里了。',
  cover: '/uploads/cover-12.png',
  categoryName: '技术',
  viewCount: 9,
  createTime: '2026-09-10T10:00:00',
  content: '# 正文\n\n服务端渲染的第一个好处是搜索引擎能看到内容。',
}

const mockDetailBackend = () => {
  fetchMock.mockImplementation((url) => {
    const path = pathOf(url)
    if (path === '/article/12') return Promise.resolve(body(ARTICLE_DETAIL))
    // 后台页挂载时会自己去拉统计、用户列表、文章列表与分类，
    // 这里给"空但结构正确"的分页结果 —— 返回 data:null 会让页面在读
    // res.data.records 时抛异常（那属于"后端坏了"，不该是这条用例的场景）
    if (path === '/article/stats') return Promise.resolve(body({ articleCount: 0, viewCount: 0, categoryCount: 0 }))
    if (path === '/category/list') return Promise.resolve(body([]))
    if (path === '/user/page') return Promise.resolve(body({ records: [], total: 0 }))
    if (path === '/admin/article/page') return Promise.resolve(body({ records: [], total: 0 }))
    return Promise.resolve(body({ records: [], total: 0 }))
  })
}

describe('SEO · 详情页与后台页', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    mockDetailBackend()
  })

  afterEach(async () => {
    await nextTick()
  })

  it('文章详情页_should有 article 类型的 og、跟着文章走的标题与绝对地址封面', async () => {
    const ArticlePage = (await import('~/pages/article/[id].vue')).default
    await mountSuspended(ArticlePage, { route: '/article/12' })
    await settleHead()

    expect(document.title).toBe(`${ARTICLE_DETAIL.title}${TITLE_SEPARATOR}${SITE_NAME}`)
    expect(ogOf('og:type')).toBe('article')
    expect(ogOf('og:title')).toBe(document.title)
    // 摘要用文章自己的，而不是站点的通用描述
    expect(headContent('meta[name="description"]')).toBe(ARTICLE_DETAIL.summary)
    // 封面在库里是 /uploads/cover-12.png，og:image 必须是绝对地址
    expect(ogOf('og:image')).toBe('https://www.yigalaxy.xin/uploads/cover-12.png')
    // canonical 指向这篇文章自己的地址
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href'))
      .toBe('https://www.yigalaxy.xin/article/12')
    // 正常文章当然要被收录：不该有 noindex
    expect(document.head.querySelector('meta[name="robots"]')).toBeNull()
  })

  it('后台页_should带 noindex, nofollow（内部工具不该被搜到）', async () => {
    const AdminPage = (await import('~/pages/admin.vue')).default
    await mountSuspended(AdminPage, { route: '/admin' })
    await settleHead()

    expect(headContent('meta[name="robots"]')).toBe('noindex, nofollow')
    expect(document.title).toContain('后台管理')
  })
})

// =====================================================================
// 站点名跟着站点设置走（buildSeoHead 的 siteName 参数）
//
// 【为什么这件事必须断】
//   站点名现在可以在后台改，而它出现在两处**用户不容易检查到**的地方：
//   · 浏览器标题的后缀（`标题 · 站点名`）
//   · 没有自己摘要的页面的默认描述（`XX 是一个个人博客：…`）
//   改完站名之后如果这两处还写着旧名字，页面上完全看不出来 ——
//   只有别人把你的链接分享出去、或者在搜索结果里看到时才会发现，
//   而那时你已经把"站点改名"这件事忘了。
//
// 【回落规则】不传 siteName / 传空 / 传非字符串 → 用代码里的 SITE_NAME
//   （就是"读不到站点设置"时的表现，与改动前完全一致）
// =====================================================================

describe('SEO · 站点名来自站点设置', () => {
  const opts = { siteUrl: 'https://example.com', path: '/' }

  it('传了 siteName_标题后缀用它', () => {
    expect(buildSeoHead({ ...opts, siteName: '某某博客', title: '一篇文章' }).title)
      .toBe('一篇文章 · 某某博客')
  })

  it('没有标题_默认标题是「站点名 · 副标题」', () => {
    const title = buildSeoHead({ ...opts, siteName: '某某博客' }).title
    expect(title.startsWith('某某博客 · ')).toBe(true)
    // 副标题是文案、不是配置，仍然是代码里那个常量
    expect(title).toContain(SITE_TAGLINE)
  })

  it('默认描述的开头也跟着换（那是搜索结果里最显眼的一句）', () => {
    const head = buildSeoHead({ ...opts, siteName: '某某博客' })
    const description = head.meta.find(m => m.name === 'description').content
    expect(description.startsWith('某某博客')).toBe(true)
    expect(description).not.toContain(SITE_NAME)
  })

  it('og:site_name 真的输出了，而且跟着 siteName 走', () => {
    // 【为什么要专门断这一条】在 2026-09-11 之前，SITE_NAME 的注释里一直写着
    // "出现在 og:site_name 里"，而 buildSeoHead **从来没有输出过这条标签** ——
    // 一句写在注释里的假事实，直到给站点名做配置、逐处核对"它到底影响哪里"时才被发现。
    // 分享卡片上"来源站点"那一行读的就是它，没有它卡片会缺一块。
    const og = (options) => buildSeoHead({ ...opts, ...options }).meta
      .find(m => m.property === 'og:site_name')?.content

    expect(og({ siteName: '某某博客' })).toBe('某某博客')
    expect(og({})).toBe(SITE_NAME)
  })

  it('页面自己传了 description_不受 siteName 影响', () => {
    const head = buildSeoHead({ ...opts, siteName: '某某博客', description: '这一页自己的摘要' })
    expect(head.meta.find(m => m.name === 'description').content).toBe('这一页自己的摘要')
  })

  it.each([
    ['不传', undefined],
    ['空串', ''],
    ['只有空白', '   '],
    ['非字符串', 123],
  ])('siteName %s_回落代码里的 SITE_NAME（与改动前一致）', (_label, siteName) => {
    expect(buildSeoHead({ ...opts, siteName, title: 'X' }).title).toBe(`X · ${SITE_NAME}`)
    // og:title 用的是同一个完整标题，不能只改一处
    expect(buildSeoHead({ ...opts, siteName, title: 'X' }).meta.find(m => m.property === 'og:title').content)
      .toBe(`X · ${SITE_NAME}`)
  })
})
