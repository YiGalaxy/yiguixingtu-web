import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { ElMessage } from 'element-plus'
import { MdEditor } from 'md-editor-v3'
import AdminPage from '~/pages/admin.vue'
import ArticleEditDialog from '~/components/admin/ArticleEditDialog.vue'

// =====================================================================
// 文章附件 + 编辑器内插图 的组件测试
//
// 【这一组守的是什么】
//   附件是"跟着文章走的一份可下载清单"（正文之后的附件区 + 后台弹窗里的那条清单），
//   它有三条**完全静默**的错法 —— 界面上都看起来正常，数据却在悄悄丢：
//
//   ① 详情接口读不到就让用户进编辑器
//      正文与附件**只存在于详情接口里**（列表为省带宽既不返回 content、也不返回附件）。
//      静默失败还打开弹窗的话：编辑器是空的 ⇒ 一保存就把正文清空；
//      清单是空的 ⇒ 一保存就把附件（连同磁盘上的文件）全部替换成空。
//      所以 `openEdit()` 里那道"读不到就不打开"的护栏必须有用例守着（第四组）。
//
//   ② 编辑器工具栏的图片按钮没接上 `on-upload-img`
//      不接的表现是"点了没有任何反应"（用户就是这么反馈的：以为这个功能没做）。
//      接上了但**失败时不回调 callback([])** 的表现更隐蔽：编辑器永远停在"上传中"，
//      工具栏从此不可用 —— 所以成功、全失败两条路径都要钉住（第三组）。
//
//   ③ 附件清单不回显 / 不回传
//      回显漏了 ⇒ 用户看到"这篇没有附件" ⇒ 一保存把附件全删了；
//      提交时漏传这个字段 ⇒ 后端（整体替换语义）照样当"清空"处理，
//      而且日志里分不清"用户移除了附件"和"前端忘了传"（后者是 bug）。见第二组。
//
// 【为什么文章页那几条也算在这一组里】
//   附件是**可选字段**（老接口不返回、没有附件的文章是 undefined）。
//   一个可选字段不该有能力把整篇文章带崩 —— 正文才是详情页的全部价值。
//   所以第一组里除了"渲染得对不对"，专门有一条"字段缺失时不崩"。
//
// 【怎么拦请求】$fetch 换成按 URL 分发的假实现（与 articleComments / adminArticleTags 同款），
//   同一个假后端同时喂文章页与后台页，避免"两套 mock 各说各话"。
// =====================================================================

const { fetchMock, tokenRef } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  tokenRef: { value: 'fake-token' },
}))
mockNuxtImport('$fetch', () => fetchMock)
// 后台路由守卫要读到 token（否则挂载出来的是登录弹窗，不是后台）；
// 返回真的对象而不是 ref 在这里够用，因为后台不把它绑进模板的自动解包
mockNuxtImport('useCookie', () => () => tokenRef)

// 正文渲染交给 md-editor-v3；本组只关心附件与编辑器事件，
// 所以把 MdPreview 换成空组件（理由与 articleComments / seo 那两个文件相同，
// 顺带避开那条与本次改动无关的 `language` prop 类型警告）。
// 【注意 MdEditor 保留真实的那个】：第三组要从编辑器组件上触发 `onUploadImg`，
// 换成 stub 就等于"测自己写的假组件"，测不出接线到底通没通。
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

// 共用同一个 Nuxt 应用实例，不卸载就会串台：
// 详情页用 useAsyncData 取数、结果按 key 缓存进 payload，缓存的释放时机是组件卸载
enableAutoUnmount(afterEach)

const body = (data) => ({ code: 200, message: '成功', data })
const pathOf = (url) => String(url).split('?')[0]
const callTo = (method, path) =>
  fetchMock.mock.calls.find(c => pathOf(c[0]) === path && c[1]?.method === method)

/**
 * 详情接口返回的附件清单。
 * 【为什么大小刻意选这三个数】它们分别要显示成 `2.0 MB` / `512 KB` / `12.0 MB`：
 *   一个 MB 档、一个 KB 档、一个"看起来很像超限"的 MB 档 ——
 *   界面上那一格是 formatFileSize 算出来的，选同一档的数字就测不出换档有没有写对。
 */
const ATTACHMENTS = [
  { name: '组件设计说明.pdf', url: '/uploads/attachment/2026/09/design.pdf', size: 2 * 1024 * 1024 },
  { name: '接口文档.docx', url: '/uploads/attachment/2026/09/api.docx', size: 512 * 1024 },
  { name: '联调录屏.mp4', url: '/uploads/attachment/2026/09/demo.mp4', size: 12 * 1024 * 1024 },
]

/** 详情接口的返回：正文 + 附件都在这里（列表接口一个都没有） */
const DETAIL_ARTICLE = {
  id: 12,
  title: '一篇带附件的文章',
  summary: '摘要',
  categoryName: '技术',
  viewCount: 9,
  createTime: '2026-09-10T10:00:00',
  content: '# 正文',
  tags: [],
  attachments: ATTACHMENTS,
}

/**
 * 列表里的这篇文章。
 * 【为什么这里【故意】没有 attachments】后端列表接口为省带宽不返回它 ——
 *   所以"弹窗里的附件从哪来"只有一个答案：详情接口。
 *   要是列表里也放一份，用例就分辨不出回显到底读的是哪一份了。
 */
const LIST_ARTICLE = {
  id: 12, title: '一篇带附件的文章', summary: '摘要', categoryId: 1, categoryName: '技术',
  status: 1, isTop: 0, viewCount: 9, createTime: '2026-09-10T10:00:00',
  updateTime: '2026-09-10T11:00:00', tags: [],
}

/**
 * 标准假后端：文章页与后台页共用一份。
 * overrides 里的值可以是响应对象，也可以是**函数**（用来说明"第几次请求返回什么"）。
 */
const mockBackend = (overrides = {}) => {
  fetchMock.mockImplementation((url, options) => {
    const path = pathOf(url)
    if (path in overrides) {
      const value = overrides[path]
      return Promise.resolve(typeof value === 'function' ? value(options) : value)
    }
    // ---- 文章详情页 ----
    if (path === '/article/12') return Promise.resolve(body(DETAIL_ARTICLE))
    if (path === '/comment/list') return Promise.resolve(body({ records: [], total: 0, pages: 0 }))
    // ---- 后台（admin.vue 挂载时会自己拉的那几个）----
    if (path === '/article/stats') return Promise.resolve(body({ articleCount: 1, viewCount: 9, categoryCount: 1 }))
    if (path === '/auth/me') return Promise.resolve(body({ id: 1, username: 'admin', role: 'ADMIN' }))
    if (path === '/user/page') return Promise.resolve(body({ records: [], total: 0 }))
    if (path === '/category/list') return Promise.resolve(body([{ id: 1, name: '技术' }]))
    if (path === '/admin/tag/list') return Promise.resolve(body([]))
    if (path === '/admin/article/page') return Promise.resolve(body({ records: [LIST_ARTICLE], total: 1 }))
    if (path === '/admin/article/12') return Promise.resolve(body(DETAIL_ARTICLE))
    return Promise.resolve(body(null))
  })
}

beforeEach(() => {
  fetchMock.mockReset()
  mockBackend()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------
// 定位与交互的小工具
// ---------------------------------------------------------------

/** 挂载文章详情页（与 articleComments 同款：造"带地址直接打开"的场景） */
const mountArticle = async () => {
  const ArticlePage = (await import('~/pages/article/[id].vue')).default
  const wrapper = await mountSuspended(ArticlePage, { route: '/article/12' })
  await flushPromises()
  return wrapper
}

/** 挂载整个后台并切到「文章管理」（弹窗与表格都在这个面板里） */
const mountAdmin = async () => {
  const wrapper = await mountSuspended(AdminPage)
  await flushPromises()
  await wrapper.findAll('.side-nav a')[1].trigger('click')
  await flushPromises()
  return wrapper
}

const dialogOf = (wrapper) => wrapper.findComponent(ArticleEditDialog)

/** 点表格里那一篇的「编辑」（会先去拉详情，再决定要不要开弹窗） */
const openEdit = async (wrapper) => {
  await wrapper.findAll('.el-table__row .el-button').find(b => b.text() === '编辑').trigger('click')
  await flushPromises()
}

/** 点工具栏的「新建文章」 */
const clickCreate = async (wrapper) => {
  await wrapper.findAll('.toolbar .el-button').find(b => b.text().includes('新建文章')).trigger('click')
  await flushPromises()
}

/** 弹窗底部那一排按钮里的「保存」 */
const clickSave = async (wrapper) => {
  const saveBtn = wrapper.findAll('.art-edit-modal .el-button').find(b => b.text().includes('保存'))
  await saveBtn.trigger('click')
  await flushPromises()
}

/** 弹窗里附件清单的每一行（`.af-attach-list li`） */
const attachRows = (wrapper) => wrapper.findAll('.af-attach-list li')
/**
 * 清单里显示的文字。
 * 【为什么文章页与弹窗各有两个 helper】它们是两处独立实现的界面：
 *   文章页用 `.doc-attach-*`、后台弹窗用 `.af-attach-*`（类名不同、结构也不同），
 *   合成一个"两边都能认"的选择器只会让"有一边漏渲染"这件事测不出来。
 */
const pageNames = (wrapper) => wrapper.findAll('.doc-attach-name').map(n => n.text())
const pageSizes = (wrapper) => wrapper.findAll('.doc-attach-size').map(n => n.text())
const dialogNames = (wrapper) => wrapper.findAll('.af-attach-name').map(n => n.text())
const dialogSizes = (wrapper) => wrapper.findAll('.af-attach-size').map(n => n.text())

/** 最近一次文章提交（POST 新建 / PUT 编辑）带上去的请求体 */
const lastArticleBody = () => {
  const call = [...fetchMock.mock.calls]
    .reverse()
    .find(c => ['/admin/article', '/admin/article/12'].includes(pathOf(c[0])) && c[1]?.body)
  return call?.[1]?.body
}

/**
 * 给附件那一栏的文件输入框塞一个真 File 再触发 change。
 *
 * 【为什么从 input[type=file] 触发、而不是直接调 onAttachmentChosen】
 *   直接调那个回调只是"函数被调用了"，测不出 el-upload 有没有接上
 *   （这正是本组第一件要守的事：接线断了界面上就是"点了没反应"）。
 * 【为什么不能只写 `.el-dialog input[type="file"]`】弹窗里有两个上传控件
 *   （封面 + 附件），按顺序取会随着以后有人往表单里加一栏而悄悄取错 ——
 *   这里按**附件的容器**定位，加一栏也不会串。
 */
const chooseAttachment = async (wrapper, file) => {
  const input = wrapper.find('.af-attach input[type="file"]')
  expect(input.exists()).toBe(true)
  Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
  await input.trigger('change')
  await flushPromises()
}

/**
 * 附件上传用的真 File。
 * 【为什么必须是真的 File】这一条走的是 el-upload 的完整链路
 *   （input → on-change → 我们的回调 → FormData.append）：用轻量对象会在 append 那一步炸掉。
 * 【这里不刻意造大小】用例断言的大小来自后端返回的那一份，不需要为了凑一个数字
 *   真去造 100MB 的内容；"上限边界"那件事归 useUpload 的单元测试管（那边只读 name / size）。
 */
const pdfFile = (name = 'report.pdf') =>
  new File([new Uint8Array([1, 2, 3])], name, { type: 'application/pdf', lastModified: 0 })

describe('文章附件 + 编辑器内插图', () => {
  // ---------------------------------------------------------------
  // 一、文章页的附件区
  // ---------------------------------------------------------------

  it('有附件_should在正文之后渲染出「附件（3）」这段清单（名称 + 大小）', async () => {
    const wrapper = await mountArticle()

    const section = wrapper.find('.doc-attach')
    expect(section.exists()).toBe(true)
    // 标题里带数量：读者一眼知道这篇附了几个文件，不用一个个数
    expect(wrapper.find('.doc-attach-title').text()).toBe('附件（3）')
    // 顺序照搬接口（它是作者排的顺序），前端不重排
    expect(pageNames(wrapper)).toEqual(['组件设计说明.pdf', '接口文档.docx', '联调录屏.mp4'])
    // 大小是给读者看的，必须已经换算过：字节数（2097152）没人读得懂
    expect(pageSizes(wrapper)).toEqual(['2.0 MB', '512 KB', '12.0 MB'])
  })

  it('附件区_should排在正文【之后】、「完」之前（放到评论区下面等于藏起来）', async () => {
    // 【为什么要断言"位置"】这条清单放在哪儿是个明确的取舍：读者读完正文正好看到它。
    //   挪到评论区下面不会有任何报错，只是几乎没人会翻过去 —— 那种"东西还在、就是没人看见"
    //   的改动，只有位置断言拦得住。
    const wrapper = await mountArticle()
    const children = [...wrapper.find('.doc').element.children]
    const previewIndex = children.findIndex(el => el.classList.contains('md-preview-stub'))
    const attachIndex = children.findIndex(el => el.classList.contains('doc-attach'))

    expect(previewIndex).toBeGreaterThanOrEqual(0)
    expect(attachIndex).toBeGreaterThan(previewIndex)
  })

  it('每个附件_should都是「可下载 + 新窗口 + noopener」的整行链接', async () => {
    const wrapper = await mountArticle()
    const links = wrapper.findAll('.doc-attach-item')

    for (const link of links) {
      // 整行可点：手机上比"只有文字可点"好按得多
      expect(link.element.tagName).toBe('A')
      expect(link.attributes('target')).toBe('_blank')
      expect(link.attributes('rel')).toContain('noopener')
      // 【为什么 download 必须有】它让浏览器**下载**而不是就地打开，
      //   与后端那层 `Content-Disposition: attachment` 是同一件事的两道保险：
      //   前端这道在跨域等场景下不生效，但不能因此不写
      expect(link.attributes('download')).toBeTruthy()
    }

    // 逐项对到"哪一个链接是哪一个文件"：地址与 download 的文件名都要对得上，
    // 否则（比如 v-for 里把 index 写成 0）三个链接指向同一个文件也照样"有链接"
    expect(links.map(l => l.attributes('href'))).toEqual(ATTACHMENTS.map(a => a.url))
    expect(links.map(l => l.attributes('download'))).toEqual(ATTACHMENTS.map(a => a.name))
  })

  it('⚠️ 没有 attachments 字段（老接口 / 这篇没附件）_should整块不渲染、且正文照常', async () => {
    // 【这条是本组最要紧的护栏之一】附件是后加的**可选字段**：
    //   接口还没更新时 `article.attachments` 是 undefined，
    //   而模板里写的是 `attachments.length` —— 没有兜底就会在渲染时抛错，
    //   把整篇文章（连同评论区）带崩成白屏。正文才是详情页的全部价值，
    //   一个可选字段不该有这个能力（与 tags 那条同一个理由）。
    const { attachments, ...withoutAttachments } = DETAIL_ARTICLE
    mockBackend({ '/article/12': body(withoutAttachments) })

    const wrapper = await mountArticle()

    // 整块不渲染（不是渲染一个空的"附件（0）"）
    expect(wrapper.find('.doc-attach').exists()).toBe(false)
    expect(wrapper.find('.doc-attach-list').exists()).toBe(false)
    // 正文与标题照常 —— 这一条才是"没崩"的证据
    expect(wrapper.find('.doc-title').text()).toBe(DETAIL_ARTICLE.title)
    expect(wrapper.find('.md-preview-stub').exists()).toBe(true)
  })

  it('attachments 是 null_should当成没有附件，而不是把页面带崩', async () => {
    mockBackend({ '/article/12': body({ ...DETAIL_ARTICLE, attachments: null }) })

    const wrapper = await mountArticle()

    expect(wrapper.find('.doc-attach').exists()).toBe(false)
    expect(wrapper.find('.doc-title').text()).toBe(DETAIL_ARTICLE.title)
  })

  it('attachments 不是数组（结构变了）_should同样当成没有附件（不崩、不印 undefined）', async () => {
    mockBackend({ '/article/12': body({ ...DETAIL_ARTICLE, attachments: { name: '误传成对象了' } }) })

    const wrapper = await mountArticle()

    expect(wrapper.find('.doc-attach').exists()).toBe(false)
    expect(wrapper.find('.doc-title').text()).toBe(DETAIL_ARTICLE.title)
  })

  // ---------------------------------------------------------------
  // 二、后台弹窗：回显 / 移除 / 提交
  // ---------------------------------------------------------------

  it('编辑一篇文章_should用【详情】里的 attachments 回显清单（列表里根本没有这个字段）', async () => {
    const wrapper = await mountAdmin()
    await openEdit(wrapper)

    expect(attachRows(wrapper)).toHaveLength(3)
    expect(dialogNames(wrapper)).toEqual(ATTACHMENTS.map(a => a.name))
    expect(dialogSizes(wrapper)).toEqual(['2.0 MB', '512 KB', '12.0 MB'])
    // 表单里的那份要与界面一致（逐项比对，包括 size 与 url）
    expect(dialogOf(wrapper).vm.form.attachments).toEqual(ATTACHMENTS)
  })

  it('清单里的长文件名_should带 title（被省略号截断时还能看到全名）', async () => {
    // 【为什么这条重要】弹窗里每一行的名字栏写的是 ellipsis，而后端允许文件名长到 100 字：
    //   一旦被截断**就没有第二条路**能看到全名了，:title 是这一格唯一的兜底（悬停即显示）。
    //   ⚠️ 文章页那一侧的 span 没有 title —— 这是本次改动里的一处不对称，已写进交付报告。
    const wrapper = await mountAdmin()
    await openEdit(wrapper)

    expect(wrapper.findAll('.af-attach-name').map(n => n.attributes('title')))
      .toEqual(ATTACHMENTS.map(a => a.name))
  })

  it('点中间那一项的「移除」_should只去掉那一项（剩下的顺序不变）', async () => {
    const wrapper = await mountAdmin()
    await openEdit(wrapper)

    // 【为什么删【中间】那一项】删第一项或最后一项时，"按 index 删"和
    //   "按名字过滤"两种写法结果一样；只有删中间才能分辨
    //   （index 传成 item 之类的错法会表现为删错行或一项都没删）
    const removeBtn = attachRows(wrapper)[1].findAll('.el-button').find(b => b.text() === '移除')
    await removeBtn.trigger('click')
    await flushPromises()

    expect(dialogNames(wrapper)).toEqual(['组件设计说明.pdf', '联调录屏.mp4'])
    expect(dialogOf(wrapper).vm.form.attachments).toEqual([ATTACHMENTS[0], ATTACHMENTS[2]])
  })

  it('保存_should把界面上的附件清单原样提交（顺序与每一项的内容都一致）', async () => {
    const wrapper = await mountAdmin()
    await openEdit(wrapper)

    // 移掉中间那一项，然后保存 —— 提交的必须是"用户看到的"那两份
    const removeBtn = attachRows(wrapper)[1].findAll('.el-button').find(b => b.text() === '移除')
    await removeBtn.trigger('click')
    await flushPromises()

    await clickSave(wrapper)

    const submitted = lastArticleBody().attachments
    // 【这条断言要的是"逐字段相等"而不是"长度对"】toEqual 会连字段一起比：
    //   漏了 size（清单里那一格变成「—」）、多了个 index、或者把 url 写成了 name，
    //   只要与界面上的清单不一致就会红
    expect(submitted).toEqual([
      { name: '组件设计说明.pdf', url: '/uploads/attachment/2026/09/design.pdf', size: 2 * 1024 * 1024 },
      { name: '联调录屏.mp4', url: '/uploads/attachment/2026/09/demo.mp4', size: 12 * 1024 * 1024 },
    ])
    expect(dialogNames(wrapper)).toEqual(submitted.map(a => a.name))
  })

  it('一个附件都没有就保存_should【显式】提交空数组，而不是不传这个字段', async () => {
    const wrapper = await mountAdmin()
    await openEdit(wrapper)

    // 三项都移除（每次点第一项）
    for (let i = 0; i < ATTACHMENTS.length; i += 1) {
      const removeBtn = attachRows(wrapper)[0].findAll('.el-button').find(b => b.text() === '移除')
      await removeBtn.trigger('click')
      await flushPromises()
    }
    expect(attachRows(wrapper)).toHaveLength(0)

    await clickSave(wrapper)

    const submitted = lastArticleBody()
    // 后端对附件是【整体替换】：不传这个字段和传空数组都是"清空这篇的附件"
    //（而且会连带删掉磁盘上的文件）。既然等价，就显式传一份 ——
    // 看日志的人才能分辨"用户移除了附件"和"前端忘了传这个字段"（后者是 bug）
    expect(submitted.attachments).toEqual([])
    expect(Object.keys(submitted)).toContain('attachments')
  })

  it('新建文章_should附件清单是空的（不能带着上一篇的附件）', async () => {
    const wrapper = await mountAdmin()

    // 先编辑一篇（把它的三个附件带进表单），再点新建 —— 不清空的话新文章会莫名带上它们，
    // 而且保存时会把它们真的挂到新文章上
    await openEdit(wrapper)
    expect(attachRows(wrapper)).toHaveLength(3)

    await clickCreate(wrapper)

    expect(dialogOf(wrapper).vm.form.attachments).toEqual([])
    // 界面上也要真的空掉（只清 form 不清 DOM 的情况这里能分辨出来）
    expect(attachRows(wrapper)).toHaveLength(0)
  })

  it('上传附件_should带上 type=attachment，并把后端给的文件名与大小写进清单', async () => {
    mockBackend({
      '/upload': body({ url: 'http://x/uploads/attachment/9.pdf', name: '最终定稿-第二版.pdf', size: 2048 }),
    })

    const wrapper = await mountAdmin()
    await clickCreate(wrapper)
    await chooseAttachment(wrapper, pdfFile())

    const upload = callTo('POST', '/upload')
    expect(upload).toBeTruthy()
    // 【少了这个参数后端会按图片的白名单校验】一个正常的 pdf 会被拒
    expect(upload[1].params).toEqual({ type: 'attachment' })
    // 后端是 @RequestParam("file")，字段名必须叫 file
    expect(upload[1].body).toBeInstanceOf(FormData)
    expect(upload[1].body.get('file')).toBeTruthy()

    // 清单里显示的必须是**后端回的那一份**（它才是真正落库的文件名）
    expect(dialogNames(wrapper)).toEqual(['最终定稿-第二版.pdf'])
    expect(dialogSizes(wrapper)).toEqual(['2 KB'])
    expect(dialogOf(wrapper).vm.form.attachments).toEqual([
      { name: '最终定稿-第二版.pdf', url: 'http://x/uploads/attachment/9.pdf', size: 2048 },
    ])
  })

  it('已经到了 20 个上限_should本地拦下（不浪费用户一次 100MB 的上传）', async () => {
    const warningSpy = vi.spyOn(ElMessage, 'warning').mockImplementation(() => {})
    const full = Array.from({ length: 20 }, (_, i) => ({
      name: `附件${i + 1}.pdf`, url: `/uploads/attachment/2026/09/${i + 1}.pdf`, size: 1024,
    }))
    mockBackend({ '/admin/article/12': body({ ...DETAIL_ARTICLE, attachments: full }) })

    const wrapper = await mountAdmin()
    await openEdit(wrapper)
    expect(attachRows(wrapper)).toHaveLength(20)

    await chooseAttachment(wrapper, pdfFile('第21个.pdf'))

    // 【为什么要在前端先拦】后端也会拒，但那时用户已经把一个 100MB 的文件传上去了 ——
    // 浪费的是他自己的上行带宽，而前端只要看一眼条数就知道结果
    expect(callTo('POST', '/upload')).toBeUndefined()
    expect(warningSpy.mock.calls.some(c => String(c[0]).includes('20'))).toBe(true)
    expect(attachRows(wrapper)).toHaveLength(20)
  })

  // ---------------------------------------------------------------
  // 三、编辑器内插图（工具栏那个图片按钮）
  // ---------------------------------------------------------------

  it('编辑器工具栏的图片按钮_should上传成功并把 URL 数组交给 callback', async () => {
    mockBackend({ '/upload': body({ url: 'http://x/uploads/image/1.png' }) })

    const wrapper = await mountAdmin()
    await openEdit(wrapper)

    // 【从编辑器组件上触发它的事件，而不是去调组件内部的函数】
    //   这正是这一组要守的接线：没接 @on-upload-img 时那个按钮点了没反应，
    //   而"有没有接上"只有从编辑器这一侧发事件才测得出来
    const editor = wrapper.findComponent(MdEditor)
    expect(editor.exists()).toBe(true)

    const callback = vi.fn()
    const file = { name: 'shot.png', size: 1024, type: 'image/png' }
    editor.vm.$emit('onUploadImg', [file], callback)
    await flushPromises()

    // callback 收到的必须是**上传后的地址数组**（编辑器负责把它插进正文）
    expect(callback).toHaveBeenCalledWith(['http://x/uploads/image/1.png'])
    // 插图走的是图片那一档：不发 type 参数（否则后端按别的白名单校验）
    const upload = callTo('POST', '/upload')
    expect(upload).toBeTruthy()
    expect(upload[1].params).toBeUndefined()
  })

  it('⚠️ 一张都没传成功_should回调空数组（不回调的话编辑器永远停在"上传中"）', async () => {
    const errorSpy = vi.spyOn(ElMessage, 'error').mockImplementation(() => {})
    mockBackend({ '/upload': { code: 400, message: '只允许上传 jpg / png 格式的图片' } })

    const wrapper = await mountAdmin()
    await openEdit(wrapper)

    const callback = vi.fn()
    const editor = wrapper.findComponent(MdEditor)
    editor.vm.$emit('onUploadImg', [{ name: 'shot.png', size: 1024, type: 'image/png' }], callback)
    await flushPromises()

    // 【这一条钉的就是那句"张张失败也要 callback([])"】不回调的话，
    // md-editor-v3 会一直停在上传中状态，工具栏从此不可用 ——
    // 用户看到的是"点了没反应"，而且刷新页面之前都好不了
    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith([])
    // 失败原因要给出来（后端原话），否则用户只知道"没成功"
    expect(errorSpy.mock.calls.some(c => String(c[0]).includes('只允许上传'))).toBe(true)
  })

  it('一次选多张、其中一张失败_should把成功的那张交给 callback（失败的那张要有提示）', async () => {
    const errorSpy = vi.spyOn(ElMessage, 'error').mockImplementation(() => {})
    let attempt = 0
    mockBackend({
      // 第 1 张成功、第 2 张失败（用调用次数模拟"后端只拒了其中一张"）
      '/upload': () => {
        attempt += 1
        return attempt === 1
          ? body({ url: 'http://x/uploads/image/1.png' })
          : { code: 400, message: '只允许上传 jpg / png 格式的图片' }
      },
    })

    const wrapper = await mountAdmin()
    await openEdit(wrapper)

    const callback = vi.fn()
    const files = [
      { name: 'ok.png', size: 1024, type: 'image/png' },
      { name: 'bad.png', size: 1024, type: 'image/png' },
    ]
    wrapper.findComponent(MdEditor).vm.$emit('onUploadImg', files, callback)
    await flushPromises()

    // 成功的那张照常给编辑器（用户不该因为另一张失败就整批白传），
    // 失败的那张单独提示 —— "逐张"是为了让用户知道是哪一张没上去
    expect(callback).toHaveBeenCalledWith(['http://x/uploads/image/1.png'])
    // 【这里只数"有没有提示"，不数次数】失败提示会走两条路各弹一次：
    //   useApi 内部对业务失败自己也会 toast（app/composables/useApi.ts 的 `toast(toastMessage)`），
    //   我们的处理函数再弹一次（那次是为了兜"后端没给原因"的情况）。
    //   写死次数会在别人合并这两处时莫名其妙变红，而那条合并本身是好事。
    expect(errorSpy.mock.calls.some(c => String(c[0]).includes('只允许上传'))).toBe(true)
  })

  // ---------------------------------------------------------------
  // 四、详情接口读不到时不许打开编辑器
  //
  // 【为什么单列一组】这是这次改动里唯一一处"宁可不给用、也不给错"的取舍：
  //   正文与附件只在详情接口里，静默失败还让用户进编辑器 = 一保存就清空它们。
  //   这条护栏要是哪天被人当成"多余的 return"删掉，
  //   界面上完全看不出来（编辑器照常打开），只有数据丢了才知道。
  // ---------------------------------------------------------------

  it('⚠️ 详情接口失败_should不打开编辑器并报错（否则一保存就把正文与附件清空）', async () => {
    const errorSpy = vi.spyOn(ElMessage, 'error').mockImplementation(() => {})
    mockBackend({ '/admin/article/12': { code: 500, message: '服务器开小差了' } })

    const wrapper = await mountAdmin()

    // 【先证明"本来就没开"】不然下面那句"没打开"可能只是因为弹窗压根还没渲染过，
    // 那样这条用例就成了一条永远为真的假绿
    expect(wrapper.find('.art-edit-modal').exists()).toBe(false)

    await openEdit(wrapper)

    expect(wrapper.find('.art-edit-modal').exists()).toBe(false)
    // 必须**说出来**：静默返回的话用户只会觉得"点了编辑没反应"
    expect(errorSpy).toHaveBeenCalled()
    expect(errorSpy.mock.calls.some(c => String(c[0]).includes('服务器开小差了'))).toBe(true)
  })

  it('详情接口直接抛异常（断网）_should也提示一句、并且不打开编辑器', async () => {
    // 【为什么连抛异常这条也要测】useApi 把网络异常收成 { ok:false, message }，
    //   但它是同一个"读不到详情"的分支：静默失败在这里的代价同样是"一保存就清空"。
    //   断言只要求"提示非空"：文案由 useApi 决定（可能带上追踪号），不该在这里写死。
    const errorSpy = vi.spyOn(ElMessage, 'error').mockImplementation(() => {})
    mockBackend({ '/admin/article/12': () => Promise.reject({ status: 500 }) })

    const wrapper = await mountAdmin()
    await openEdit(wrapper)

    expect(wrapper.find('.art-edit-modal').exists()).toBe(false)
    expect(errorSpy).toHaveBeenCalled()
    expect(String(errorSpy.mock.calls[0][0]).length).toBeGreaterThan(0)
  })

  it('详情正常回来_should照常打开编辑器（别把护栏写成"永远打不开"）', async () => {
    // 【对照组】上面两条守的是"读不到就别开"，这一条守的是"读得到就照常开" ——
    //   写错成 `if (detail.ok) { ...; return }` 那种反向逻辑时，
    //   表现是"后台再也编辑不了文章"，而上面两条用例照样全绿。
    const wrapper = await mountAdmin()
    await openEdit(wrapper)

    expect(wrapper.find('.art-edit-modal').exists()).toBe(true)
    expect(dialogOf(wrapper).vm.form.content).toBe('# 正文')
    expect(attachRows(wrapper)).toHaveLength(3)
  })
})
