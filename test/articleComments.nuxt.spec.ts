import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises, enableAutoUnmount } from '@vue/test-utils'

// =====================================================================
// 文章详情页「评论区」的组件测试
//
// 【这一组守的是什么】
//   评论区是本站第一个"游客能往数据库写东西"的地方，它的坑分两类：
//   ① 用户**以为自己发出去了**，其实没有（或者以为没发出去，其实成功了）
//      · 提交成功后不说"要审核" → 用户去列表里找不到自己的评论 →
//        再发一遍 → 同一条评论进了两次审核队列
//      · 提交失败时提示成"网络异常" → 明明是限流（等一会儿就好），
//        用户却去查网络、反复重试，每重试一次还多吃一个限流名额
//      · 校验失败直接放行 → 后端返回 400，用户白等一个往返才知道哪错了
//   ② 别人提交的内容被当成代码执行（XSS）—— 这条最严重，所以单独测
//
// 【安全那一条为什么要用两种输入测】
//   · 后端转义过的内容（`&lt;script&gt;`）：前端**照原样显示**才对。
//     反转义就会把后端那层保护拆掉；再转义一次会出现 `&amp;lt;` 这种乱码
//   · 万一哪天后端漏了转义、返回了**原生标签**：只要页面用的是 {{ }} 插值，
//     它也只会显示成一串文字。这一条是"即使后端出问题，前端也不执行"的兜底，
//     而 v-html 会让这两种输入都变成真标签 —— 所以两条都要钉住
//
// 【怎么拦请求】同其它页面用例：$fetch 换成按 URL 分发的假实现。
//   提交失败要模拟【真实 HTTP 429】（useApi 走 catch 分支那种），
//   所以假实现要 reject 一个带 status / data 的异常对象。
// =====================================================================

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))
mockNuxtImport('$fetch', () => fetchMock)

// 正文渲染交给 md-editor-v3，这里换成空组件：本组只关心评论区
// （理由与 seo.nuxt.spec.ts 相同，顺带避开那条与本次改动无关的 prop 类型警告）
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

// 详情页用 useAsyncData 取数，结果按 key 缓存进 payload，而缓存的释放时机是
// 组件卸载；本文件所有用例共用同一个 Nuxt 应用实例，不卸载就会串台
// （"没有评论"那条用例可能看到上一轮那三条评论）
enableAutoUnmount(afterEach)

const body = (data) => ({ code: 200, message: '成功', data })
const pathOf = (url) => String(url).split('?')[0]

const ARTICLE = {
  id: 12,
  title: '一篇有评论的文章',
  summary: '摘要',
  categoryName: '技术',
  viewCount: 9,
  createTime: '2026-09-10T10:00:00',
  content: '# 正文',
  tags: [],
}

/** 已通过的评论（公开接口按【时间正序】返回：最早的在上面） */
const COMMENTS = [
  { id: 101, articleId: 12, nickname: '早来的读者', content: '先留个脚印', status: 1, createTime: '2026-09-10T09:00:00' },
  { id: 102, articleId: 12, nickname: '后来的读者', content: '写得清楚', status: 1, createTime: '2026-09-10T11:30:00' },
]

/** 默认假后端：一篇文章 + 两条已通过评论 */
const mockBackend = (overrides = {}) => {
  fetchMock.mockImplementation((url, options) => {
    const path = pathOf(url)
    if (path in overrides) {
      const value = overrides[path]
      return Promise.resolve(typeof value === 'function' ? value(options) : value)
    }
    if (path === '/article/12') return Promise.resolve(body(ARTICLE))
    if (path === '/comment/list') return Promise.resolve(body({ records: COMMENTS, total: 2, pages: 1 }))
    return Promise.resolve(body(null))
  })
}

const mountArticle = async () => {
  const ArticlePage = (await import('~/pages/article/[id].vue')).default
  const wrapper = await mountSuspended(ArticlePage, { route: '/article/12' })
  await flushPromises()
  return wrapper
}

/** 最近一次 POST /comment 带上去的请求体 */
const lastPostBody = () => {
  const call = [...fetchMock.mock.calls].reverse()
    .find(c => pathOf(c[0]) === '/comment' && c[1]?.method === 'POST')
  return call?.[1]?.body
}

/** 填写表单（只填需要的那几项） */
const fillForm = async (wrapper, { nickname = '路过的读者', email = '', content = '写得不错' } = {}) => {
  const inputs = wrapper.findAll('.cm-field input')
  await inputs[0].setValue(nickname)
  await inputs[1].setValue(email)
  await wrapper.find('.cm-textarea').setValue(content)
}

const submit = async (wrapper) => {
  await wrapper.find('.cm-form').trigger('submit')
  await flushPromises()
}

describe('文章详情 · 评论区', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    mockBackend()
  })

  afterEach(async () => {
    await nextTick()
  })

  // ---------------------------------------------------------------
  // 一、列表
  // ---------------------------------------------------------------

  it('没有评论_should显示友好的空状态', async () => {
    mockBackend({ '/comment/list': body({ records: [], total: 0, pages: 0 }) })

    const wrapper = await mountArticle()

    expect(wrapper.find('.cm-empty').text()).toContain('还没有评论')
    expect(wrapper.find('.cm-list').exists()).toBe(false)
    // 空的时候不显示「加载更多」
    expect(wrapper.find('.cm-more').exists()).toBe(false)
  })

  it('有评论_should渲染昵称、时间与内容，并保持时间正序', async () => {
    const wrapper = await mountArticle()

    const items = wrapper.findAll('.cm-item')
    expect(items.length).toBe(2)
    expect(items[0].find('.cm-nick').text()).toBe('早来的读者')
    expect(items[0].find('.cm-body').text()).toBe('先留个脚印')
    // 时间要精确到分钟：同一篇文章下的评论常常只差几分钟，
    // 只显示日期的话"谁先说的"看不出来，时间正序就白排了
    expect(items[0].find('.cm-time').text()).toBe('2026-09-10 09:00')
    // 顺序必须与后端给的一致（它按时间正序返回），不能在前端再排一次
    expect(items[1].find('.cm-nick').text()).toBe('后来的读者')
  })

  it('评论数_should显示已通过的条数（第一页来自 SSR 的 payload）', async () => {
    const wrapper = await mountArticle()

    expect(wrapper.find('.cm-count').text()).toBe('2')
  })

  it('评论接口失败_should只让评论区空着，正文照常渲染', async () => {
    mockBackend({ '/comment/list': { code: 500, message: '服务器开小差了' } })

    const wrapper = await mountArticle()

    expect(wrapper.find('.cm-empty').text()).toContain('还没有评论')
    // 正文才是这一页的全部价值，评论挂了绝不能连累它
    expect(wrapper.find('.doc-title').text()).toBe(ARTICLE.title)
  })

  it('评论接口返回了非数组_should当成没有评论，而不是把正文页带崩', async () => {
    mockBackend({ '/comment/list': body({ records: null, total: 3 }) })

    const wrapper = await mountArticle()

    expect(wrapper.find('.cm-empty').exists()).toBe(true)
    expect(wrapper.find('.doc-title').text()).toBe(ARTICLE.title)
  })

  // ---------------------------------------------------------------
  // 二、内容渲染的安全（本组最重要的一条）
  // ---------------------------------------------------------------

  it('后端转义过的内容_should原样显示实体码（不反转义、也不再转义一次）', async () => {
    mockBackend({
      '/comment/list': body({
        records: [{
          id: 201, articleId: 12, nickname: '攻击者',
          // 后端入库前把 < > & 转义成实体，所以前端拿到的就是这个样子
          content: '&lt;script&gt;alert(1)&lt;/script&gt;',
          status: 1, createTime: '2026-09-10T12:00:00',
        }],
        total: 1, pages: 1,
      }),
    })

    const wrapper = await mountArticle()

    // ① 页面上没有 script 元素（内容没有被当成 HTML 解析）
    expect(wrapper.find('.cm-body script').exists()).toBe(false)
    // 【为什么断言 .cm-body 的 html 而不是整个页面的 html】整页 html 里本来就有
    // 别的 script 字样（模板注释在 dev 构建里是保留的），拿它当判据会误报；
    // 要证明的只是"这条评论渲染出来的是什么"
    expect(wrapper.find('.cm-body').html()).not.toContain('<script')
    // ② 显示出来的是实体码本身：这证明我们【没有反转义】
    //    （反转义再插值 = 把后端那层保护拆掉）
    expect(wrapper.find('.cm-body').text()).toBe('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('即使内容里是原生 HTML 标签_should也只显示成文字（用的必须是 {{ }} 而不是 v-html）', async () => {
    mockBackend({
      '/comment/list': body({
        records: [{
          id: 202, articleId: 12, nickname: '攻击者',
          // 万一哪天后端漏了转义、返回了原生标签：
          // v-html 会当场把它变成一个真的元素（XSS），{{ }} 只会显示成一串文字
          content: '<b>加粗</b><img src=x onerror=alert(1)>',
          status: 1, createTime: '2026-09-10T12:10:00',
        }],
        total: 1, pages: 1,
      }),
    })

    const wrapper = await mountArticle()

    expect(wrapper.find('.cm-body b').exists()).toBe(false)
    expect(wrapper.find('.cm-body img').exists()).toBe(false)
    expect(wrapper.find('.cm-body').text()).toBe('<b>加粗</b><img src=x onerror=alert(1)>')
  })

  // ---------------------------------------------------------------
  // 三、发表：成功路径
  // ---------------------------------------------------------------

  it('提交成功_should提示"等待审核"，并把刚提交的那条显示出来（不能让它看起来像没发出去）', async () => {
    mockBackend({
      '/comment': body({
        id: 301, articleId: 12, nickname: '路过的读者', content: '写得不错',
        // 后端默认存成待审核（status=0），所以它【不会】出现在上面的公开列表里
        status: 0, createTime: '2026-09-10T13:00:00',
      }),
    })

    const wrapper = await mountArticle()
    await fillForm(wrapper)
    await submit(wrapper)

    // ① 请求拼得对吗（字段名、articleId 是数字）
    expect(lastPostBody()).toEqual({
      articleId: 12, nickname: '路过的读者', content: '写得不错',
    })

    // ② 必须明确说"等审核"：只说"提交成功"的话，用户会去上面找自己的评论，
    //    找不到就以为没发出去（然后很可能再发一遍，同一条进两次审核队列）
    const alert = wrapper.find('.cm-alert.ok')
    expect(alert.exists()).toBe(true)
    expect(alert.text()).toContain('等待审核')

    // ③ 刚提交的那条要看得见，并且标着「待审核」、放在"仅你可见"那一块里
    const mine = wrapper.find('.cm-mine')
    expect(mine.text()).toContain('写得不错')
    expect(mine.find('.cm-badge').text()).toBe('待审核')
    // 它不该混进公开列表（否则用户会以为"别人已经看到了"）
    expect(wrapper.findAll('.cm-list')[0].findAll('.cm-item').length).toBe(2)

    // ④ 内容清空、昵称留着（同一个人常常连着说几句）
    expect(wrapper.find('.cm-textarea').element.value).toBe('')
    expect(wrapper.findAll('.cm-field input')[0].element.value).toBe('路过的读者')
  })

  it('提交成功的响应里 createTime 是 null（联调实测就是这个形状）_should显示「刚刚」而不是空着一块', async () => {
    // 后端插入后没有把数据库生成的时间回填到返回对象上，所以 POST /comment 的
    // 响应里 createTime 是 null（前台列表接口返回的评论则有时间）。
    // 照原样显示会出现一个空白的时间位，看着像页面坏了
    mockBackend({
      '/comment': body({ id: 303, articleId: 12, nickname: '读者', content: '你好', status: 0, createTime: null }),
    })

    const wrapper = await mountArticle()
    await fillForm(wrapper)
    await submit(wrapper)

    expect(wrapper.find('.cm-mine .cm-time').text()).toBe('刚刚')
  })

  it('提交失败_should不把内容清空（用户刚写的一段话不能丢）', async () => {
    mockBackend({ '/comment': { code: 429, message: '请求过于频繁，请稍后再试' } })

    const wrapper = await mountArticle()
    await fillForm(wrapper, { content: '一段很长的话，不能因为限流就丢掉' })
    await submit(wrapper)

    expect(wrapper.find('.cm-textarea').element.value).toBe('一段很长的话，不能因为限流就丢掉')
  })

  it('邮箱选填_should不填也能提交，而且请求里不会出现空的 email 字段', async () => {
    mockBackend({ '/comment': body({ id: 302, articleId: 12, nickname: '读者', content: '你好', status: 0, createTime: '2026-09-10T13:05:00' }) })

    const wrapper = await mountArticle()
    await fillForm(wrapper, { email: '' })
    await submit(wrapper)

    expect(Object.keys(lastPostBody())).not.toContain('email')
  })

  // ---------------------------------------------------------------
  // 四、提交失败：分支必须走对
  // ---------------------------------------------------------------

  it('本地校验没过_should一个请求都不发，并提示具体哪一项不合格', async () => {
    const wrapper = await mountArticle()

    await fillForm(wrapper, { nickname: '   ' })
    await submit(wrapper)

    expect(lastPostBody()).toBeUndefined()
    expect(wrapper.find('.cm-alert.err').text()).toContain('昵称')
  })

  it('内容为空_should也拦在本地，并提示内容不能为空', async () => {
    const wrapper = await mountArticle()

    await fillForm(wrapper, { content: '   ' })
    await submit(wrapper)

    expect(lastPostBody()).toBeUndefined()
    expect(wrapper.find('.cm-alert.err').text()).toContain('评论内容不能为空')
  })

  it('后端返回 400_should显示后端那句话（而不是笼统的「操作失败」）', async () => {
    mockBackend({ '/comment': { code: 400, message: '评论最长 1000 字' } })

    const wrapper = await mountArticle()
    await fillForm(wrapper)
    await submit(wrapper)

    expect(wrapper.find('.cm-alert.err').text()).toContain('评论最长 1000 字')
    // 失败时不应该出现"等待审核"那句（那会让用户以为发出去了）
    expect(wrapper.find('.cm-alert.ok').exists()).toBe(false)
  })

  it('文章不存在或已成草稿（404）_should把后端的原因显示出来', async () => {
    mockBackend({ '/comment': { code: 404, message: '文章不存在' } })

    const wrapper = await mountArticle()
    await fillForm(wrapper)
    await submit(wrapper)

    expect(wrapper.find('.cm-alert.err').text()).toContain('文章不存在')
  })

  it('被限流（真实 HTTP 429）_should提示"请求过于频繁"，绝不能显示成「网络异常」', async () => {
    // 这个接口是 20 次/分钟的【整站】配额，很容易撞到。
    // 真 429 在 HTTP 层就失败了 → useApi 走 catch 分支并带上 message
    mockBackend({
      '/comment': () => {
        const err = new Error('rate limited')
        err.status = 429
        err.data = { code: 429, message: '请求过于频繁，请稍后再试' }
        return Promise.reject(err)
      },
    })

    const wrapper = await mountArticle()
    await fillForm(wrapper)
    await submit(wrapper)

    const text = wrapper.find('.cm-alert.err').text()
    expect(text).toContain('频繁')
    // 说成网络故障会把人往"查网线、重启路由器"的方向带，而真实原因是
    // "服务端好好的，只是让你等一会儿" —— 反复重试还会再吃掉限流名额
    expect(text).not.toContain('网络')
  })

  it('被限流且响应里没有 message_should用本地兜底文案（仍要有"频繁"两个字）', async () => {
    mockBackend({
      '/comment': () => {
        // 极端情况：Nginx 的 limit_req 直接返回一个没有 body 的 429
        const err = new Error('rate limited')
        err.status = 429
        return Promise.reject(err)
      },
    })

    const wrapper = await mountArticle()
    await fillForm(wrapper)
    await submit(wrapper)

    expect(wrapper.find('.cm-alert.err').text()).toContain('频繁')
  })

  it('请求层直接抛异常（断网）_should提示网络异常，而不是把页面带崩', async () => {
    mockBackend({ '/comment': () => { throw new Error('boom') } })

    const wrapper = await mountArticle()
    await fillForm(wrapper)
    await submit(wrapper)

    expect(wrapper.find('.cm-alert.err').exists()).toBe(true)
    expect(wrapper.find('.cm-form').exists()).toBe(true)
  })

  // ---------------------------------------------------------------
  // 五、防连点
  // ---------------------------------------------------------------

  it('提交中_should禁用按钮并显示"提交中…"（评论接口有 20 次/分钟的限流，多打一次少一次配额）', async () => {
    let release
    mockBackend({
      '/comment': () => new Promise((resolve) => { release = () => resolve(body({ id: 9, articleId: 12, nickname: '读者', content: '你好', status: 0, createTime: '2026-09-10T14:00:00' })) }),
    })

    const wrapper = await mountArticle()
    await fillForm(wrapper)
    await wrapper.find('.cm-form').trigger('submit')
    await nextTick()

    const btn = wrapper.find('.cm-submit')
    expect(btn.attributes('disabled')).toBeDefined()
    expect(btn.text()).toContain('提交中')

    release()
    await flushPromises()
    expect(wrapper.find('.cm-submit').attributes('disabled')).toBeUndefined()
  })

  // ---------------------------------------------------------------
  // 六、分页：加载更多
  // ---------------------------------------------------------------

  it('还有下一页_should显示「加载更多」，点它请求第 2 页并追加在后面', async () => {
    // 第一页 2 条、总共 3 条 → 有下一页
    mockBackend({
      '/comment/list': (options) => {
        if (options?.params?.page === 2) {
          return body({
            records: [{ id: 103, articleId: 12, nickname: '第三位', content: '我也说一句', status: 1, createTime: '2026-09-10T12:00:00' }],
            total: 3, pages: 2,
          })
        }
        return body({ records: COMMENTS, total: 3, pages: 2 })
      },
    })

    const wrapper = await mountArticle()
    expect(wrapper.find('.cm-more').exists()).toBe(true)

    await wrapper.find('.cm-more button').trigger('click')
    await flushPromises()

    // 追加在末尾（公开列表是时间正序，第 2 页本来就更晚）
    expect(wrapper.findAll('.cm-item').map(i => i.find('.cm-nick').text()))
      .toEqual(['早来的读者', '后来的读者', '第三位'])
    // 第一页就带了 articleId（不带后端直接 400）
    const first = fetchMock.mock.calls.find(c => pathOf(c[0]) === '/comment/list')
    expect(first[1].params.articleId).toBe('12')
    // 取完了，按钮收起来
    expect(wrapper.find('.cm-more').exists()).toBe(false)
  })

  it('已经取完_should不显示「加载更多」（否则用户点了没反应）', async () => {
    const wrapper = await mountArticle()

    // 第一页 2 条、总共 2 条
    expect(wrapper.find('.cm-more').exists()).toBe(false)
  })

  it('加载更多失败_should保留已显示的评论，不把列表清空', async () => {
    mockBackend({
      '/comment/list': (options) => {
        if (options?.params?.page === 2) return { code: 500, message: '服务器开小差了' }
        return body({ records: COMMENTS, total: 3, pages: 2 })
      },
    })

    const wrapper = await mountArticle()
    await wrapper.find('.cm-more button').trigger('click')
    await flushPromises()

    // 已经拿到的两条是真数据，没有理由因为下一页失败就丢掉
    expect(wrapper.findAll('.cm-item').length).toBe(2)
    expect(wrapper.find('.cm-more').exists()).toBe(true)
  })
})

// =====================================================================
// 文章详情 · 站点设置里的「评论总开关」
//
// 【这一组守的是"关掉评论"这个动作的两半，缺一不可】
//   ① **已有的评论仍然显示** —— "关闭评论"的语义是"不再接收新评论"，
//      不是"把历史评论藏起来"。既有评论是站点内容的一部分，
//      而且后端也只是拒绝新的提交（不是把数据删了）。
//      把这一条钉住是因为它最容易被顺手写错成 v-if 整块藏掉。
//   ② **表单换成一句说明** —— 用户看到"评论已关闭"比看到一个点了没反应的
//      提交按钮好得多（后者会让人以为站点坏了，然后反复点）。
//
//   ⚠️ 还有第三半在**后端**：关掉之后 POST /comment 会被真的拒绝。
//      那一半的用例在后端仓库（SiteSettingTest ⑰）——
//      只藏前端表单是"假开关"，谁都能直接调接口绕过。
// =====================================================================

describe('文章详情 · 评论总开关', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  afterEach(async () => {
    await nextTick()
  })

  const mockBackendWith = (commentEnabled) => {
    mockBackend({
      '/setting': body({
        siteName: '测试站点名',
        announcement: null,
        commentEnabled,
        icpNumber: null,
        copyright: null,
        pageSize: 12,
      }),
    })
  }

  it('开关关掉_should显示"评论已关闭"，且不出现发表表单', async () => {
    mockBackendWith(false)
    const wrapper = await mountArticle()

    expect(wrapper.find('.cm-closed').exists()).toBe(true)
    expect(wrapper.find('.cm-closed').text()).toContain('评论已关闭')
    // 表单整个不渲染（不是"渲染出来再禁用"）
    expect(wrapper.find('.cm-form').exists()).toBe(false)
    expect(wrapper.find('.cm-field').exists()).toBe(false)
    expect(wrapper.find('.cm-submit').exists()).toBe(false)
  })

  it('开关关掉_已有的评论仍然显示（关的是"新评论"，不是历史评论）', async () => {
    mockBackendWith(false)
    const wrapper = await mountArticle()

    expect(wrapper.findAll('.cm-item').length).toBe(2)
    expect(wrapper.find('.cm-list').text()).toContain('先留个脚印')
    // 评论数那个角标也还在
    expect(wrapper.find('.cm-title').text()).toContain('2')
  })

  it('开关开着（或缺省）_表单照常出现，没有"已关闭"那句话', async () => {
    mockBackendWith(true)
    const wrapper = await mountArticle()

    expect(wrapper.find('.cm-form').exists()).toBe(true)
    expect(wrapper.find('.cm-closed').exists()).toBe(false)
  })

  it('⚠️ 站点设置整个读不到_表单照常出现（不能因为接口抖一下就关掉评论）', async () => {
    // 归一化把"读不到"当成"开启" —— 这是刻意的：配置缺失不该升级成功能消失
    mockBackend({
      '/setting': { code: 500, message: '服务器开小差了', data: null },
    })
    const wrapper = await mountArticle()

    expect(wrapper.find('.cm-form').exists()).toBe(true)
    expect(wrapper.find('.cm-closed').exists()).toBe(false)
  })
})
