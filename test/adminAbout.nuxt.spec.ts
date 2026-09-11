import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import AdminPage from '~/pages/admin.vue'
import AboutPanel from '~/components/admin/AboutPanel.vue'

// =====================================================================
// 后台「关于管理」的组件测试
//
// 【这一组守的是"单条记录"那三件事 —— 它们和另外三个内容页都不一样】
//
//   ① **只有保存**：没有"新建"、没有"删除"、没有 POST
//      关于页的数据只有一份（后端 about 表永远只有 id = 1 那一行）：
//      "再建一条关于信息"没有语义；不要了就该清空字段。
//      后端**根本没有 POST /admin/about** —— 发了会真的返回 405。
//      所以界面上绝不能出现"新建关于"这种点了必然报错的按钮，
//      而这一点只能靠测试钉住（多一个按钮不会让任何东西变红）。
//
//   ② 保存走 **PUT /admin/about**（路径上没有 {id}：只有一个能改的对象），
//      返回 **Result<Void>（没有 data）**，所以保存成功后要**重新 GET 一次 /about**
//      才能回显库里的真实状态（后端保存时会做归一化：空串 → null、trim）。
//
//   ③ 读的是**公开的 GET /about**（后端有意不再开一个"后台专用读"，
//      因为保存会推进缓存版本号、缓存立刻失效，后台读到的一定是最新的）。
//
// 【为什么失败提示必须留在面板上】这一页**没有弹窗**，所以"后端原话"没有别的地方可放：
//   只弹一个三秒就消失的 toast，用户还在表单上，不知道刚才那句是什么。
//
// 【jsdom 不做布局】所以不断言任何排版；能被钉住的只有行为与文案。
// =====================================================================

const { fetchMock, tokenRef } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  tokenRef: { value: 'fake-token' },
}))
mockNuxtImport('$fetch', () => fetchMock)
mockNuxtImport('useCookie', () => () => tokenRef)

enableAutoUnmount(afterEach)

const body = (data) => ({ code: 200, message: '成功', data })
const pathOf = (url) => String(url).split('?')[0]

/**
 * 后端 GET /about 的真实形状（**对象**，不是数组）：
 *   { id, nickname, avatar, bio, email, github, wechat, qq, updateTime }
 * 【为什么 qq / wechat 给的是普通字符串】后端刻意不做格式校验（它们只是文字，
 * 不会被渲染成链接），所以前端也绝不能把它们放进 href。
 */
const ABOUT = {
  id: 1,
  nickname: '别太在亿啦',
  avatar: '/avatar.png',
  bio: '# 自我介绍\n\n用的是 **Markdown** 原文。',
  email: 'me@example.com',
  github: 'https://github.com/YiGalaxy',
  wechat: 'yigalaxy',
  qq: '10001',
  updateTime: '2026-09-10T05:03:19',
}

/**
 * 标准假后端：按路径给一条响应。
 *
 * 【为什么把它单独抽出来，而不是只留一个 mockBackend】
 *   有几个用例需要"自己接管某几条路径"（比如让 /about 前后两次返回不同的东西），
 *   那些用例会整体换掉 fetchMock 的实现。如果它们在"其余路径"上随手返回 body(null)，
 *   后台页挂载时那几个请求就会读到 null.data 而抛异常
 *   （`res.data.records` —— 报出来是"Unhandled error during execution of mounted hook"，
 *    最终让整个文件的退出码变成 1，看起来像测试失败）。
 *   所以凡是自己接管的用例，其余路径一律委托给这里。
 */
const defaultResponse = (path) => {
  if (path === '/about') return body(ABOUT)
  if (path === '/article/stats') return body({ articleCount: 2, viewCount: 28, categoryCount: 3 })
  if (path === '/auth/me') return body({ id: 1, username: 'admin', role: 'ADMIN' })
  if (path === '/user/page') return body({ records: [], total: 7 })
  if (path === '/category/list') return body([])
  if (path === '/admin/tag/list') return body([])
  if (path === '/admin/article/page') return body({ records: [], total: 0 })
  if (path === '/admin/comment/page') return body({ records: [], total: 0 })
  return body(null)
}

const mockBackend = (overrides = {}) => {
  fetchMock.mockImplementation((url) => {
    const path = pathOf(url)
    if (path in overrides) return Promise.resolve(overrides[path])
    return Promise.resolve(defaultResponse(path))
  })
}

const gotoAbout = async (wrapper) => {
  await wrapper.findAll('.side-nav a').find(a => a.text() === '关于管理').trigger('click')
  await flushPromises()
}

const callTo = (method, path) =>
  fetchMock.mock.calls.find(c => pathOf(c[0]) === path && c[1]?.method === method)

const callCount = (method, path) =>
  fetchMock.mock.calls.filter(c => pathOf(c[0]) === path && (!method || c[1]?.method === method)).length

const panelOf = (wrapper) => wrapper.findComponent(AboutPanel)

/** 点工具条上的「保存」 */
const clickSave = async (wrapper) => {
  await wrapper.findAll('.toolbar .el-button').find(b => b.text().includes('保存')).trigger('click')
  await flushPromises()
}

/** 输入框按 placeholder 定位（表单里有 7 个输入框，按顺序数很容易数错） */
const inputByPlaceholder = (wrapper, placeholder) =>
  wrapper.find(`.panel input[placeholder="${placeholder}"]`)

const NICKNAME_PH = '比如：别太在亿啦'
const EMAIL_PH = 'me@example.com（可以留空）'
const GITHUB_PH = 'https://github.com/you（可以留空）'
/** 头像那一栏**保留着手填输入框**（上传与手填两种入口都要能用），所以它能按 placeholder 定位 */
const AVATAR_PH = '/avatar.png 或 https://…（也可以点上传）'

describe('后台 · 关于管理（单条记录）', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    mockBackend()
  })

  // ---------------------------------------------------------------
  // 一、读：切到菜单才请求，且读的是公开的那个 GET /about
  // ---------------------------------------------------------------

  it('切到菜单才读_should打 GET /about（而不是某个后台专用读接口）', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()

    // 没切过去之前一次都不该请求（面板在 v-if 链里）
    expect(callCount(null, '/about')).toBe(0)

    await gotoAbout(wrapper)

    expect(callCount(null, '/about')).toBe(1)
    // 后端 AdminAboutController 的注释写明了：前台那个 GET 就是这份数据的唯一读法
    expect(callCount(null, '/admin/about')).toBe(0)
  })

  it('读到的内容_should回显进表单（含 Markdown 原文的 bio）', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoAbout(wrapper)

    const form = panelOf(wrapper).vm.form
    expect(form.nickname).toBe('别太在亿啦')
    expect(form.avatar).toBe('/avatar.png')
    // bio 是**原文**：后台这里原样编辑，不做任何转换（渲染是前台关于页的事）
    expect(form.bio).toBe(ABOUT.bio)
    expect(form.email).toBe('me@example.com')
    expect(form.github).toBe('https://github.com/YiGalaxy')
    expect(form.wechat).toBe('yigalaxy')
    expect(form.qq).toBe('10001')
  })

  it('接口失败_should提示一句并保留表单里已有的内容（不清空）', async () => {
    mockBackend({ '/about': { code: 500, message: '服务器开小差了' } })

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoAbout(wrapper)

    // 清空表单的话，用户会以为"关于页的内容丢了" —— 而实际上只是这一次请求没成功
    expect(wrapper.find('.ab-notice.is-error').text()).toContain('暂时读不到')
    expect(panelOf(wrapper).vm.form.nickname).toBe('')
    expect(wrapper.find('.top h1').text()).toBe('关于管理')
  })

  it('接口返回的不是对象_should当成"没有内容"，而不是把页面打崩', async () => {
    mockBackend({ '/about': body([ABOUT]) })

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoAbout(wrapper)

    // asObject 会排除数组：把数组当对象用会得到一堆 undefined（页面上看不出报错）
    expect(panelOf(wrapper).vm.form.nickname).toBe('')
    expect(wrapper.text()).not.toContain('undefined')
  })

  // ---------------------------------------------------------------
  // 二、界面里没有"新建"、没有"删除"
  // ---------------------------------------------------------------

  it('界面上_should没有"新建"也没有"删除"按钮（后端没有 POST，发了会 405）', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoAbout(wrapper)

    const buttons = wrapper.findAll('.toolbar .el-button').map(b => b.text())
    // 只有「保存」和「重新载入」两个动作（形状上就没有"新建/删除"这两个动作）
    expect(buttons).toEqual(['保存', '重新载入'])

    // 【为什么按"按钮文字"断言，而不是判断 wrapper.text() 里不含"新建"】
    //   面板顶部那句说明里**故意**写着"这里只能保存，没有新建与删除"——
    //   拿整页文字去断言会把那句说明本身当成违规（这条断言就会变成永远为假，
    //   而它验证的东西根本不是我们想守的）。要钉的是"没有任何一个可点的按钮叫这个名字"。
    const allButtonTexts = wrapper.findAll('button').map(b => b.text())
    expect(allButtonTexts.some(t => t.includes('新建'))).toBe(false)
    expect(allButtonTexts.some(t => t.includes('删除'))).toBe(false)

    // 也没有表格：这一页不是"列表 + 弹窗"的形状，而是一个表单
    expect(wrapper.find('.el-table').exists()).toBe(false)
    // 顺带钉住"一个 /admin/about 的写请求都没发过"
    expect(callCount(null, '/admin/about')).toBe(0)
  })

  it('源码里_should没有对 /admin/about 发 POST 的写法（除了 PUT 之外一个都不许有）', async () => {
    const src = readFileSync(join(process.cwd(), 'app/components/admin/AboutPanel.vue'), 'utf8')

    // 这条是"界面里别出现新建按钮"的**结构性**护栏：只要源码里没有 POST，
    // 界面就不可能通过某个隐藏入口建出第二条关于信息
    expect(src).toContain("'/admin/about'")
    expect(src).not.toMatch(/POST\s*['"]?[,}]/)
    expect(src).not.toMatch(/method:\s*'POST'/)
    expect(src).toContain("method: 'PUT'")
  })

  // ---------------------------------------------------------------
  // 三、保存：PUT /admin/about，成功后重新读一次
  // ---------------------------------------------------------------

  it('保存_should PUT /admin/about（字段名与后端 AboutForm 逐个对齐），成功后重新读一次', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoAbout(wrapper)

    const readsBefore = callCount(null, '/about')

    await clickSave(wrapper)

    const put = callTo('PUT', '/admin/about')
    expect(put).toBeTruthy()
    // 字段名写错时后端拿不到值，而它不会报错 —— 只会把那一栏保存成空
    expect(put[1].body).toEqual({
      nickname: '别太在亿啦',
      avatar: '/avatar.png',
      bio: ABOUT.bio,
      email: 'me@example.com',
      github: 'https://github.com/YiGalaxy',
      wechat: 'yigalaxy',
      qq: '10001',
    })
    // 保存接口返回 Result<Void>（没有 data），所以必须重新 GET 一次才能回显库里的真实状态
    expect(callCount(null, '/about')).toBe(readsBefore + 1)
    expect(wrapper.find('.ab-notice.is-ok').text()).toContain('已保存')
  })

  it('清空可选字段_should把空串原样提交（后端把空串归一化成 null，不在前端做这件事）', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoAbout(wrapper)

    // 头像这一栏是"预览 + 手填输入框 + 上传按钮"三件都有：
    // 清空那条路走的是输入框（用户能看到它空掉了），「移除」按钮由下面上传那组覆盖
    await inputByPlaceholder(wrapper, AVATAR_PH).setValue('')
    await inputByPlaceholder(wrapper, EMAIL_PH).setValue('')
    await inputByPlaceholder(wrapper, GITHUB_PH).setValue('')
    await clickSave(wrapper)

    const put = callTo('PUT', '/admin/about')
    // 【前端不替后端做归一化】"没有值"在库里只有 NULL 一种表示，而
    // "" → null 的规则只在后端一处（前端再实现一遍，两边迟早不一致）
    expect(put[1].body.avatar).toBe('')
    expect(put[1].body.email).toBe('')
    expect(put[1].body.github).toBe('')
  })

  it('bio 清空_should允许提交（它是可选的，清空 = 前台不显示自我介绍）', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoAbout(wrapper)

    await wrapper.find('.panel textarea').setValue('')
    await clickSave(wrapper)

    expect(callTo('PUT', '/admin/about')[1].body.bio).toBe('')
  })

  it('保存失败_should把后端原话留在面板上（不是只弹一个三秒就消失的 toast），并且内容不丢', async () => {
    mockBackend({ '/admin/about': { code: 400, message: '邮箱格式不正确' } })

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoAbout(wrapper)

    await clickSave(wrapper)

    // 这一页没有弹窗，所以错误只能留在面板上；只弹 toast 的表现是
    // "点保存没反应，提示一闪而过"
    expect(wrapper.find('.ab-notice.is-error').text()).toContain('邮箱格式不正确')
    // 表单里用户填的内容还在（不然等于白填）
    expect(panelOf(wrapper).vm.form.nickname).toBe('别太在亿啦')
  })

  it('后端没给原因时_should用一句兜底文案，而不是显示一条空白的提示', async () => {
    mockBackend({ '/admin/about': { code: 400 } })

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoAbout(wrapper)
    await clickSave(wrapper)

    expect(wrapper.find('.ab-notice.is-error').text()).toBe('保存失败，请稍后再试')
  })

  // ---------------------------------------------------------------
  // 四、前端预检：省一次必然失败的往返
  // ---------------------------------------------------------------

  it('昵称为空_should前端就拦下来，一个请求都不发', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoAbout(wrapper)

    await inputByPlaceholder(wrapper, NICKNAME_PH).setValue('   ')
    await clickSave(wrapper)

    expect(callTo('PUT', '/admin/about')).toBeUndefined()
    expect(wrapper.find('.ab-notice.is-error').text()).toContain('昵称不能为空')
  })

  it('昵称超过 50 字_should拦下来（上限来自后端 AboutForm 的 @Size(max=50)）', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoAbout(wrapper)

    await inputByPlaceholder(wrapper, NICKNAME_PH).setValue('名'.repeat(51))
    await clickSave(wrapper)

    expect(callTo('PUT', '/admin/about')).toBeUndefined()
    expect(wrapper.find('.ab-notice.is-error').text()).toContain('昵称最长 50 字')
  })

  it('邮箱格式明显不对_should拦下来', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoAbout(wrapper)

    await inputByPlaceholder(wrapper, EMAIL_PH).setValue('这不是邮箱')
    await clickSave(wrapper)

    expect(callTo('PUT', '/admin/about')).toBeUndefined()
    expect(wrapper.find('.ab-notice.is-error').text()).toContain('邮箱格式不正确')
  })

  it('邮箱只是"看着不标准"（后端会接受）_should放行，不替后端做更严的判断', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoAbout(wrapper)

    // 【为什么这条是有意的】前端预检的目标是"拦住一眼就不像邮箱的输入"，
    // 而不是"重新实现一遍 Jakarta @Email"。做得比后端更严的后果是
    // **用户完全没法绕过**：界面不让保存，后端却明明能收。
    // 所以像 a+b@localhost.local 这种"后端会接受"的值必须放行。
    await inputByPlaceholder(wrapper, EMAIL_PH).setValue('a+b@localhost.local')
    await clickSave(wrapper)

    expect(callTo('PUT', '/admin/about')).toBeTruthy()
  })

  it('GitHub 地址不是 http(s)_should拦下来（它会被前台渲染成链接）', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoAbout(wrapper)

    await inputByPlaceholder(wrapper, GITHUB_PH).setValue('github.com/YiGalaxy')
    await clickSave(wrapper)

    expect(callTo('PUT', '/admin/about')).toBeUndefined()
    expect(wrapper.find('.ab-notice.is-error').text()).toContain('GitHub 地址必须以 http:// 或 https:// 开头')
  })

  it('头像地址是 / 开头的站内路径_should放行（后端 IMAGE_URL 允许它，上传接口不拦这一种）', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoAbout(wrapper)

    // 手填那条路：往输入框里打一个 / 开头的站内路径（图放在前端仓库的 public 里）
    await inputByPlaceholder(wrapper, AVATAR_PH).setValue('/avatar-2.png')
    await clickSave(wrapper)

    expect(callTo('PUT', '/admin/about')?.[1].body.avatar).toBe('/avatar-2.png')
  })

  it('手填一个外链头像_should原样提交（上传与手填两条入口都要能用）', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoAbout(wrapper)

    // 站长可能把头像放在自己的图床 / CDN 上（那里已经有现成地址）：
    // 把输入框拿掉会逼他先下载再上传一遍
    await inputByPlaceholder(wrapper, AVATAR_PH).setValue('https://cdn.example/avatar.png')
    await clickSave(wrapper)

    expect(callTo('PUT', '/admin/about')?.[1].body.avatar).toBe('https://cdn.example/avatar.png')
  })

  it('自我介绍超过 5000 字_should拦下来（上限来自后端 AboutForm 的 @Size(max=5000)）', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoAbout(wrapper)

    await wrapper.find('.panel textarea').setValue('字'.repeat(5001))
    await clickSave(wrapper)

    expect(callTo('PUT', '/admin/about')).toBeUndefined()
    expect(wrapper.find('.ab-notice.is-error').text()).toContain('自我介绍最长 5000 字')
  })

  // ---------------------------------------------------------------
  // 四·二、头像上传（与文章弹窗同一套 useUpload）
  // ---------------------------------------------------------------

  it('上传头像_should把后端返回的 data.url 写回头像字段', async () => {
    // 后端 POST /upload 返回 Result<{ url, ... }>：地址在 data.url 上（不是 data 本身）
    mockBackend({ '/upload': body({ url: 'http://x/uploads/avatar/3.png' }) })

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoAbout(wrapper)

    // 从界面上的文件输入框触发：走的就是用户点「上传头像」选文件那条路
    // （ElUpload 的 on-change → 我们的回调），而不是直接调那个回调
    const input = wrapper.find('.panel input[type="file"]')
    expect(input.exists()).toBe(true)
    expect(input.attributes('accept')).toContain('image/png')
    Object.defineProperty(input.element, 'files', {
      value: [new File([new Uint8Array([1, 2, 3])], 'avatar.png', { type: 'image/png' })],
      configurable: true,
    })
    await input.trigger('change')
    await flushPromises()

    const upload = callTo('POST', '/upload')
    expect(upload).toBeTruthy()
    // 字段名必须叫 file（后端是 @RequestParam("file")）
    expect(upload[1].body).toBeInstanceOf(FormData)
    expect(upload[1].body.get('file')).toBeTruthy()
    expect(panelOf(wrapper).vm.form.avatar).toBe('http://x/uploads/avatar/3.png')
    // 【关键：回填必须"看得见"】地址要出现在那个手填输入框里 ——
    // 只写进 data 而不进输入框的话，用户既看不到传上去的结果、也没法接着改
    expect(inputByPlaceholder(wrapper, AVATAR_PH).element.value).toBe('http://x/uploads/avatar/3.png')
    expect(wrapper.find('.cover-preview').attributes('src')).toBe('http://x/uploads/avatar/3.png')

    // 上传成功后保存，提交的就是刚传上去的地址
    await clickSave(wrapper)
    expect(callTo('PUT', '/admin/about')[1].body.avatar).toBe('http://x/uploads/avatar/3.png')
  })

  it('上传失败_should【保留原来的头像地址】并给出后端原话', async () => {
    const errorSpy = vi.spyOn(ElMessage, 'error').mockImplementation(() => {})
    mockBackend({ '/upload': { code: 400, message: '只允许上传 jpg / png 格式的图片' } })

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoAbout(wrapper)
    expect(panelOf(wrapper).vm.form.avatar).toBe('/avatar.png')

    await panelOf(wrapper).vm.onAvatarChosen({
      raw: new File([new Uint8Array([1])], 'avatar.png', { type: 'image/png' }),
    })
    await flushPromises()

    // 失败时清空的话用户会以为"我的头像丢了"，而且一保存就真的清掉了。
    // 这里连**输入框里显示的值**一起断言：实现里最容易写错的写法就是
    // "先把 form.avatar 清空再赋值"，那会让输入框当场变空。
    expect(panelOf(wrapper).vm.form.avatar).toBe('/avatar.png')
    expect(inputByPlaceholder(wrapper, AVATAR_PH).element.value).toBe('/avatar.png')
    expect(errorSpy.mock.calls.some(c => String(c[0]).includes('只允许上传'))).toBe(true)
    vi.restoreAllMocks()
  })

  it('选了不支持的格式_should本地就拦下，一个请求都不发', async () => {
    const errorSpy = vi.spyOn(ElMessage, 'error').mockImplementation(() => {})

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoAbout(wrapper)

    // 预检只读 name / size，不通过时走不到 FormData.append，所以轻量对象就够
    await panelOf(wrapper).vm.onAvatarChosen({ raw: { name: 'avatar.bmp', size: 100 } })
    await flushPromises()

    expect(callTo('POST', '/upload')).toBeUndefined()
    expect(errorSpy.mock.calls.some(c => String(c[0]).includes('只支持'))).toBe(true)
    vi.restoreAllMocks()
  })

  it('选了超过 5MB 的图片_should本地就拦下，一个请求都不发', async () => {
    const errorSpy = vi.spyOn(ElMessage, 'error').mockImplementation(() => {})

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoAbout(wrapper)

    await panelOf(wrapper).vm.onAvatarChosen({ raw: { name: 'big.png', size: 5 * 1024 * 1024 + 1 } })
    await flushPromises()

    expect(callTo('POST', '/upload')).toBeUndefined()
    expect(errorSpy.mock.calls.some(c => String(c[0]).includes('不能超过'))).toBe(true)
    vi.restoreAllMocks()
  })

  it('点「移除」_should清空头像字段（并真的提交空串）', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoAbout(wrapper)

    const remove = wrapper.findAll('.cover-btns .el-button').find(b => b.text() === '移除')
    expect(remove).toBeTruthy()
    await remove.trigger('click')
    await flushPromises()

    expect(panelOf(wrapper).vm.form.avatar).toBe('')
    // 输入框也跟着空掉（它才是用户看到的那个值），预览图消失
    expect(inputByPlaceholder(wrapper, AVATAR_PH).element.value).toBe('')
    expect(wrapper.find('.cover-preview').exists()).toBe(false)
    await clickSave(wrapper)
    expect(callTo('PUT', '/admin/about')[1].body.avatar).toBe('')
  })

  // ---------------------------------------------------------------
  // 四·三、"接口答了但没内容"这个边角（后端有意放宽的地方）
  // ---------------------------------------------------------------

  it('GET /about 的 data 是 null_should显示成一张空表单，而不是说"读取失败"', async () => {
    mockBackend({ '/about': body(null) })

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoAbout(wrapper)

    // 【为什么这条要紧】后端对这张单条表有意放宽：那一行被物理删掉时读接口
    // 会返回"壳"甚至空数据，而**保存会自动把那一行写回来**（AboutServiceImpl 的自愈）。
    // 所以"没有内容"不是故障 —— 说成"暂时读不到"会把用户吓得不敢填，
    // 而且那是假话（接口明明答了 200）。
    expect(wrapper.find('.ab-notice.is-info').text()).toContain('还没有内容')
    expect(wrapper.text()).not.toContain('读不到')
    // 表单是可用的空表单（昵称空着、没有头像预览），保存按钮也在
    expect(panelOf(wrapper).vm.form.nickname).toBe('')
    expect(wrapper.find('.cover-preview').exists()).toBe(false)
    expect(wrapper.findAll('.toolbar .el-button').some(b => b.text().includes('保存'))).toBe(true)
  })

  it('空内容时填好昵称保存_should PUT 成功，并把自愈写回的内容重新读回来', async () => {
    // 第一次读：那一行不在了（data 为 null）；PUT 之后后端自愈写回，再读就有内容了
    let saved = false
    fetchMock.mockImplementation((url, options) => {
      const path = pathOf(url)
      if (path === '/admin/about' && options?.method === 'PUT') {
        saved = true
        return Promise.resolve(body(null))
      }
      if (path === '/about') {
        return Promise.resolve(body(saved ? { ...ABOUT, nickname: '刚写回去的站长' } : null))
      }
      // 其余路径委托给标准假后端（见 defaultResponse 的注释：
      // 随手返回 body(null) 会让后台页挂载时的请求读到 null.data 而抛异常）
      return Promise.resolve(defaultResponse(path))
    })

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoAbout(wrapper)

    await inputByPlaceholder(wrapper, NICKNAME_PH).setValue('刚写回去的站长')
    await clickSave(wrapper)

    expect(callTo('PUT', '/admin/about')).toBeTruthy()
    expect(callTo('PUT', '/admin/about')[1].body.nickname).toBe('刚写回去的站长')
    // 保存成功后重读一次：拿到的是后端自愈写回之后的内容
    expect(panelOf(wrapper).vm.form.nickname).toBe('刚写回去的站长')
    expect(wrapper.find('.ab-notice.is-ok').text()).toContain('已保存')
  })

  it('空内容时昵称也空着保存_should本地就拦下，一个请求都不发（别白跑一趟后端）', async () => {
    mockBackend({ '/about': body(null) })

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoAbout(wrapper)

    await clickSave(wrapper)

    // 后端 AboutForm 上 nickname 是 @NotBlank：空着必然被拒，所以本地先拦
    expect(callTo('PUT', '/admin/about')).toBeUndefined()
    // 提示必须留在界面上（这一页没有弹窗，onMounted 那次读也什么都没写回），
    // 只弹 toast 的话用户会以为"保存按钮坏了"
    expect(wrapper.find('.ab-notice.is-error').text()).toContain('昵称不能为空')
  })

  // ---------------------------------------------------------------
  // 五、菜单
  // ---------------------------------------------------------------

  it('菜单里_should有「关于管理」', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()

    expect(wrapper.findAll('.side-nav .nv-label').map(n => n.text())).toContain('关于管理')
  })
})
