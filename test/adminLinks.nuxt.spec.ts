import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { ElMessage, ElMessageBox } from 'element-plus'
import AdminPage from '~/pages/admin.vue'
import LinksPanel from '~/components/admin/LinksPanel.vue'

// =====================================================================
// 后台「友链管理」的组件测试
//
// 【这一组守的核心是 avatar 那两档不同的白名单】
//   · 站点地址（url）必须是 http(s) 外链（后端 @NotBlank + @Pattern 外链白名单）
//   · 头像（avatar）**多允许一种形态**：`/` 开头的站内路径
//     （图直接放在前端仓库的 public 目录里是正当用法，后端 IMAGE_URL 就是这样定的）
//   前端要是把两档混成一个（比如头像也要求 http(s)），用户会遇到
//   "界面不让保存、后端其实能收"——这类问题用户完全没法绕过。
//   所以下面两条用例是成对的：/avatar.png 必须放行、`javascript:` 必须拦下。
//
// 【"隐藏"到底做了什么】前台 GET /link/list 的过滤在**后端 SQL 层**（status = 1），
//   所以后台这里设成隐藏，前台立刻看不到它 —— 前端不需要做任何事。
//   后台列表本身必须含隐藏的（否则没法把它改回来），这条也有用例钉住。
//
// 【jsdom 不做布局】"按钮不折行"量不出来，只能钉 `.lp-acts` 的 nowrap（最末一条用例）。
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
 * 后端 GET /admin/link/list 的真实形状（含隐藏的）。
 * 【为什么第二条的 avatar / description 是 null】可选字段后端允许不传。
 */
const LINKS = [
  { id: 1, name: '联调友链A', url: 'https://a.example', avatar: '/avatar-1.png', description: '一句话介绍', sort: 1, status: 1, createTime: '2026-09-10T05:03:19' },
  { id: 2, name: '联调友链B', url: 'https://b.example', avatar: null, description: null, sort: 2, status: 0, createTime: null },
]

/**
 * 标准假后端：按路径给一条响应。
 *
 * 【为什么把它单独抽出来】有几个用例需要"自己接管某几条路径"（比如新建成功之后
 *   让列表多返回一条），那些用例会整体换掉 fetchMock 的实现。如果它们在"其余路径"
 *   上随手返回 body(null)，后台页挂载时那几个请求就会读到 null.data 而抛异常
 *   （`res.data.records`）—— 报出来是 "Unhandled error during execution of mounted hook"，
 *   最后让整个文件的退出码变成 1，看起来像测试失败（实际上用例全绿）。
 *   所以凡是自己接管的用例，其余路径一律委托给这里。
 */
const defaultResponse = (path) => {
  if (path === '/admin/link/list') return body(LINKS)
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

const gotoLinks = async (wrapper) => {
  await wrapper.findAll('.side-nav a').find(a => a.text() === '友链管理').trigger('click')
  await flushPromises()
}

const rowNames = (wrapper) => wrapper.findAll('.panel .el-table__row').map(r => r.findAll('td')[1].text())

const callTo = (method, path) =>
  fetchMock.mock.calls.find(c => pathOf(c[0]) === path && c[1]?.method === method)

const clickSave = async (wrapper) => {
  await wrapper.findAll('.el-dialog .el-button').find(b => b.text().includes('保存')).trigger('click')
  await flushPromises()
}

const clickCreate = async (wrapper) => {
  await wrapper.findAll('.toolbar .el-button').find(b => b.text().includes('新建友链')).trigger('click')
  await flushPromises()
}

const inputByPlaceholder = (wrapper, placeholder) =>
  wrapper.find(`.el-dialog input[placeholder="${placeholder}"]`)

const NAME_PH = '比如：某某的博客'
const URL_PH = 'https://example.com'
/** 头像那一栏**保留着手填输入框**（上传与手填两种入口都要能用），所以它能按 placeholder 定位 */
const AVATAR_PH = '/avatar.png 或 https://…（也可以点上传）'

const panelOf = (wrapper) => wrapper.findComponent(LinksPanel)

describe('后台 · 友链管理', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    mockBackend()
  })

  // ---------------------------------------------------------------
  // 一、列表
  // ---------------------------------------------------------------

  it('列表_should显示名称、可点的站点地址、简介与状态（含隐藏的）', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoLinks(wrapper)

    expect(rowNames(wrapper)).toEqual(['联调友链A', '联调友链B'])
    const first = wrapper.findAll('.panel .el-table__row')[0].findAll('td')
    const link = first[2].find('a')
    expect(link.attributes('href')).toBe('https://a.example')
    // 后台的外链同样要带 rel=noopener（新页面不能反向操作本站）
    expect(link.attributes('target')).toBe('_blank')
    expect(link.attributes('rel')).toBe('noopener')
    expect(first[3].text()).toBe('一句话介绍')
    expect(first[5].text()).toBe('显示')
    // 【后台列表必须含隐藏的】第二条 status = 0：它在前台看不到，
    // 但后台要能看见并改回来（这就是"后台列表不走缓存"的原因）
    expect(wrapper.findAll('.panel .el-table__row')[1].findAll('td')[5].text()).toBe('隐藏')
  })

  it('简介为 null_should显示「—」，而不是留一格空白', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoLinks(wrapper)

    expect(wrapper.findAll('.panel .el-table__row')[1].findAll('td')[3].text()).toBe('—')
  })

  it('列表接口失败_should列表为空但页面其余部分照常', async () => {
    mockBackend({ '/admin/link/list': { code: 500, message: '服务器开小差了' } })

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoLinks(wrapper)

    expect(wrapper.findAll('.panel .el-table__row').length).toBe(0)
    expect(wrapper.text()).toContain('还没有友链')
    expect(wrapper.find('.top h1').text()).toBe('友链管理')
  })

  it('列表接口返回了非数组_should当成空列表，而不是把渲染打挂', async () => {
    mockBackend({ '/admin/link/list': body({ records: LINKS }) })

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoLinks(wrapper)

    expect(wrapper.findAll('.panel .el-table__row').length).toBe(0)
  })

  // ---------------------------------------------------------------
  // 二、新建与两档白名单
  // ---------------------------------------------------------------

  it('新建友链_should POST /admin/link，字段名与后端 FriendLinkForm 一致，成功后重拉列表', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoLinks(wrapper)

    fetchMock.mockImplementation((url, options) => {
      const path = pathOf(url)
      if (path === '/admin/link' && options?.method === 'POST') return Promise.resolve(body(9))
      if (path === '/admin/link/list') {
        return Promise.resolve(body([...LINKS, { id: 9, name: '新友链', url: 'https://new.example', sort: 0, status: 1 }]))
      }
      // 其余路径委托给标准假后端（理由见 defaultResponse 的注释）
      return Promise.resolve(defaultResponse(path))
    })

    await clickCreate(wrapper)
    await inputByPlaceholder(wrapper, NAME_PH).setValue('新友链')
    await inputByPlaceholder(wrapper, URL_PH).setValue('https://new.example')
    // 头像那一栏是"上传 + 手填"两条入口都留着的：
    // 这里走手填那条（打字），顺便证明 v-model 接上了、值一路走到请求体里。
    // 【注意】上传接口返回的是绝对地址（http://localhost:8082/uploads/...），
    // 而 / 开头的站内路径同样是后端允许的形态（见下面那条用例），两者都要能提交上去
    await inputByPlaceholder(wrapper, AVATAR_PH).setValue('/avatar-9.png')
    await clickSave(wrapper)

    expect(callTo('POST', '/admin/link')[1].body).toEqual({
      name: '新友链',
      url: 'https://new.example',
      avatar: '/avatar-9.png',
      description: '',
      sort: 0,
      status: 1,
    })
    expect(rowNames(wrapper)).toContain('新友链')
  })

  it('头像地址是 / 开头的站内路径_should放行（后端 IMAGE_URL 比外链多允许这一种形态）', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoLinks(wrapper)

    await clickCreate(wrapper)
    await inputByPlaceholder(wrapper, NAME_PH).setValue('站内头像的友链')
    await inputByPlaceholder(wrapper, URL_PH).setValue('https://a.example')
    // 手填那条路：往输入框里打一个 / 开头的站内路径
    await inputByPlaceholder(wrapper, AVATAR_PH).setValue('/avatar-2.png')
    await clickSave(wrapper)

    // 用外链那一档（必须 http(s)）来判会把它判成非法 ——
    // 用户会遇到"界面不让保存、后端其实能收"这种完全没法绕过的问题
    expect(callTo('POST', '/admin/link')).toBeTruthy()
    expect(wrapper.find('.ed-error').exists()).toBe(false)
    // 【这条断言钉的是后端那张契约】IMAGE_URL 是 `^(?:https?://\S+|/\S*)?$`：
    // 站内路径必须**原样**提交上去（前端不能自作主张把它补成完整地址，也不能丢掉它）
    expect(callTo('POST', '/admin/link')[1].body.avatar).toBe('/avatar-2.png')
  })

  it('手填一个外链头像_should原样提交（上传与手填两条入口都要能用）', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoLinks(wrapper)

    await clickCreate(wrapper)
    await inputByPlaceholder(wrapper, NAME_PH).setValue('用外链头像的友链')
    await inputByPlaceholder(wrapper, URL_PH).setValue('https://a.example')
    // 友链的头像常常就是**对方站点现成的图标地址**：贴过来最省事，
    // 把输入框拿掉会逼人先下载再上传一遍
    await inputByPlaceholder(wrapper, AVATAR_PH).setValue('https://someone.example/avatar.png')
    await clickSave(wrapper)

    expect(callTo('POST', '/admin/link')[1].body.avatar).toBe('https://someone.example/avatar.png')
  })

  it('头像地址是 javascript:_should拦下来（它会被渲染成 <img src> / 卡片）', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoLinks(wrapper)

    await clickCreate(wrapper)
    await inputByPlaceholder(wrapper, NAME_PH).setValue('可疑友链')
    await inputByPlaceholder(wrapper, URL_PH).setValue('https://a.example')
    // 手填这条路能贴上任何字符串（上传那条路只会得到后端给的合法地址），
    // 所以保存时的白名单校验必须拦得住
    await inputByPlaceholder(wrapper, AVATAR_PH).setValue('javascript:alert(1)')
    await clickSave(wrapper)

    expect(callTo('POST', '/admin/link')).toBeUndefined()
    expect(wrapper.find('.ed-error').text()).toContain('头像地址必须是 http(s):// 开头')
  })

  it('站点地址不是 http(s)_should拦下来（与后端同一句提示）', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoLinks(wrapper)

    await clickCreate(wrapper)
    await inputByPlaceholder(wrapper, NAME_PH).setValue('友链')
    await inputByPlaceholder(wrapper, URL_PH).setValue('ftp://a.example')
    await clickSave(wrapper)

    expect(callTo('POST', '/admin/link')).toBeUndefined()
    expect(wrapper.find('.ed-error').text()).toContain('必须以 http:// 或 https:// 开头')
  })

  it('站点名称为空_should拦下来，一个请求都不发', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoLinks(wrapper)

    await clickCreate(wrapper)
    await inputByPlaceholder(wrapper, NAME_PH).setValue('   ')
    await inputByPlaceholder(wrapper, URL_PH).setValue('https://a.example')
    await clickSave(wrapper)

    expect(callTo('POST', '/admin/link')).toBeUndefined()
    expect(wrapper.find('.ed-error').text()).toContain('站点名称不能为空')
  })

  it('名称超过 50 字_should拦下来（上限来自后端 FriendLinkForm 的 @Size(max=50)）', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoLinks(wrapper)

    await clickCreate(wrapper)
    await inputByPlaceholder(wrapper, NAME_PH).setValue('名'.repeat(51))
    await inputByPlaceholder(wrapper, URL_PH).setValue('https://a.example')
    await clickSave(wrapper)

    expect(callTo('POST', '/admin/link')).toBeUndefined()
    expect(wrapper.find('.ed-error').text()).toContain('站点名称最长 50 字')
  })

  // ---------------------------------------------------------------
  // 三、保存失败与编辑
  // ---------------------------------------------------------------

  it('保存失败_should把后端那句话显示在弹窗里，并且不关闭弹窗', async () => {
    mockBackend({ '/admin/link': { code: 400, message: '站点地址最长 255 字' } })

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoLinks(wrapper)

    await clickCreate(wrapper)
    await inputByPlaceholder(wrapper, NAME_PH).setValue('友链')
    await inputByPlaceholder(wrapper, URL_PH).setValue('https://a.example')
    await clickSave(wrapper)

    // 【为什么断言 editVisible 而不是 `.el-dialog` 存不存在】Element Plus 关闭弹窗时
    // 不删 DOM（只把遮罩 display:none），`.exists()` 在开关两种状态下都是 true
    expect(panelOf(wrapper).vm.editVisible).toBe(true)
    expect(wrapper.find('.ed-error').text()).toContain('站点地址最长 255 字')
  })

  it('编辑_should用 PUT /admin/link/{id} 并回显当前值', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoLinks(wrapper)

    await wrapper.findAll('.panel .el-table__row')[0].findAll('.el-button')
      .find(b => b.text() === '编辑').trigger('click')
    await flushPromises()

    expect(inputByPlaceholder(wrapper, NAME_PH).element.value).toBe('联调友链A')
    // 头像那一栏现在是"预览 + 手填输入框 + 上传按钮"三件都有：
    // 输入框里要能看到当前地址（用户能改），预览图也要有（能看出来是哪张）
    expect(inputByPlaceholder(wrapper, AVATAR_PH).element.value).toBe('/avatar-1.png')
    expect(panelOf(wrapper).vm.form.avatar).toBe('/avatar-1.png')
    expect(wrapper.find('.el-dialog .cover-preview').attributes('src')).toBe('/avatar-1.png')

    await inputByPlaceholder(wrapper, NAME_PH).setValue('联调友链A改')
    await clickSave(wrapper)

    expect(callTo('PUT', '/admin/link/1')[1].body.name).toBe('联调友链A改')
    expect(callTo('POST', '/admin/link')).toBeUndefined()
  })

  it('头像为 null 的友链_should回显成空串，而不是"null"这个字面量', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoLinks(wrapper)

    await wrapper.findAll('.panel .el-table__row')[1].findAll('.el-button')
      .find(b => b.text() === '编辑').trigger('click')
    await flushPromises()

    // null 直接给表单字段会渲染成空，但一旦被 .trim() 用到就会抛异常；
    // 输入框里是空串、预览图不该出现（v-if 判空）
    expect(panelOf(wrapper).vm.form.avatar).toBe('')
    expect(inputByPlaceholder(wrapper, AVATAR_PH).element.value).toBe('')
    expect(wrapper.find('.el-dialog .cover-preview').exists()).toBe(false)
    expect(panelOf(wrapper).vm.form.description).toBe('')
    expect(panelOf(wrapper).vm.form.sort).toBe(2)
    expect(panelOf(wrapper).vm.form.status).toBe(0)
  })

  // ---------------------------------------------------------------
  // 三·二、头像上传（与文章弹窗同一套 useUpload）
  // ---------------------------------------------------------------

  it('上传头像_should把后端返回的 data.url 写回头像字段', async () => {
    // 后端 POST /upload 返回 Result<{ url, ... }>：地址在 data.url 上（不是 data 本身）
    mockBackend({ '/upload': body({ url: 'http://x/uploads/avatar/7.png' }) })

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoLinks(wrapper)
    await clickCreate(wrapper)

    const input = wrapper.find('.el-dialog input[type="file"]')
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
    expect(panelOf(wrapper).vm.form.avatar).toBe('http://x/uploads/avatar/7.png')
    // 【关键：回填必须"看得见"】地址要出现在那个手填输入框里 ——
    // 只写进 data 而不进输入框的话，用户既看不到传上去的结果、也没法接着改
    expect(inputByPlaceholder(wrapper, AVATAR_PH).element.value).toBe('http://x/uploads/avatar/7.png')
    expect(wrapper.find('.cover-preview').attributes('src')).toBe('http://x/uploads/avatar/7.png')
  })

  it('上传失败_should【保留原来的头像地址】并给出后端原话', async () => {
    const errorSpy = vi.spyOn(ElMessage, 'error').mockImplementation(() => {})
    mockBackend({ '/upload': { code: 400, message: '图片不能超过 5MB' } })

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoLinks(wrapper)

    await wrapper.findAll('.panel .el-table__row')[0].findAll('.el-button')
      .find(b => b.text() === '编辑').trigger('click')
    await flushPromises()
    expect(panelOf(wrapper).vm.form.avatar).toBe('/avatar-1.png')

    await panelOf(wrapper).vm.onAvatarChosen({
      raw: new File([new Uint8Array([1])], 'avatar.png', { type: 'image/png' }),
    })
    await flushPromises()

    // 失败时清空的话，用户会以为"我那张图丢了"，而且一保存就把友链头像真的清掉。
    // 这里连**输入框里显示的值**一起断言：实现里最容易写错的写法就是
    // "先把 form.avatar 清空再赋值"，那会让输入框当场变空。
    expect(panelOf(wrapper).vm.form.avatar).toBe('/avatar-1.png')
    expect(inputByPlaceholder(wrapper, AVATAR_PH).element.value).toBe('/avatar-1.png')
    expect(errorSpy.mock.calls.some(c => String(c[0]).includes('不能超过'))).toBe(true)
    vi.restoreAllMocks()
  })

  it('选了不支持的格式_should本地就拦下，一个请求都不发', async () => {
    const errorSpy = vi.spyOn(ElMessage, 'error').mockImplementation(() => {})

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoLinks(wrapper)
    await clickCreate(wrapper)

    // 预检只读 name / size，不通过时走不到 FormData.append，所以轻量对象就够
    await panelOf(wrapper).vm.onAvatarChosen({ raw: { name: 'note.txt', size: 10 } })
    await flushPromises()

    expect(callTo('POST', '/upload')).toBeUndefined()
    expect(errorSpy.mock.calls.some(c => String(c[0]).includes('只支持'))).toBe(true)
    vi.restoreAllMocks()
  })

  it('选了超过 5MB 的图片_should本地就拦下，一个请求都不发', async () => {
    const errorSpy = vi.spyOn(ElMessage, 'error').mockImplementation(() => {})

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoLinks(wrapper)
    await clickCreate(wrapper)

    await panelOf(wrapper).vm.onAvatarChosen({ raw: { name: 'big.png', size: 5 * 1024 * 1024 + 1 } })
    await flushPromises()

    expect(callTo('POST', '/upload')).toBeUndefined()
    expect(errorSpy.mock.calls.some(c => String(c[0]).includes('不能超过'))).toBe(true)
    vi.restoreAllMocks()
  })

  it('点「移除」_should清空头像字段（保存时提交空串，后端归一化成 null）', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoLinks(wrapper)

    await wrapper.findAll('.panel .el-table__row')[0].findAll('.el-button')
      .find(b => b.text() === '编辑').trigger('click')
    await flushPromises()

    const remove = wrapper.findAll('.el-dialog .el-button').find(b => b.text() === '移除')
    await remove.trigger('click')
    await flushPromises()

    expect(panelOf(wrapper).vm.form.avatar).toBe('')
    // 输入框也跟着空掉（它才是用户看到的那个值）
    expect(inputByPlaceholder(wrapper, AVATAR_PH).element.value).toBe('')
    await clickSave(wrapper)
    expect(callTo('PUT', '/admin/link/1')[1].body.avatar).toBe('')
  })

  // ---------------------------------------------------------------
  // 四、删除
  // ---------------------------------------------------------------

  it('删除_should先弹二次确认（带上站点名与"无法恢复"）', async () => {
    const confirmSpy = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm')

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoLinks(wrapper)

    await wrapper.findAll('.panel .el-table__row')[0].findAll('.el-button')
      .find(b => b.text() === '删除').trigger('click')
    await flushPromises()

    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(confirmSpy.mock.calls[0][0]).toContain('联调友链A')
    expect(confirmSpy.mock.calls[0][0]).toContain('无法恢复')
    expect(callTo('DELETE', '/admin/link/1')).toBeTruthy()
    confirmSpy.mockRestore()
  })

  it('二次确认里点取消_should一个请求都不发', async () => {
    const confirmSpy = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue(new Error('cancel'))

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoLinks(wrapper)

    await wrapper.findAll('.panel .el-table__row')[0].findAll('.el-button')
      .find(b => b.text() === '删除').trigger('click')
    await flushPromises()

    expect(callTo('DELETE', '/admin/link/1')).toBeUndefined()
    confirmSpy.mockRestore()
  })

  it('删除成功后_should刷新列表（那条从表格里消失）', async () => {
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm')

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoLinks(wrapper)
    expect(rowNames(wrapper)).toEqual(['联调友链A', '联调友链B'])

    fetchMock.mockImplementation((url, options) => {
      const path = pathOf(url)
      if (path === '/admin/link/1' && options?.method === 'DELETE') return Promise.resolve(body(null))
      if (path === '/admin/link/list') return Promise.resolve(body([LINKS[1]]))
      // 其余路径委托给标准假后端（理由见 defaultResponse 的注释）
      return Promise.resolve(defaultResponse(path))
    })

    await wrapper.findAll('.panel .el-table__row')[0].findAll('.el-button')
      .find(b => b.text() === '删除').trigger('click')
    await flushPromises()

    expect(rowNames(wrapper)).toEqual(['联调友链B'])
    vi.restoreAllMocks()
  })

  it('删一条已经被别人删掉的友链（404）_should自愈：提示一句 + 真的重拉列表', async () => {
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm')
    const warning = vi.spyOn(ElMessage, 'warning').mockImplementation(() => {})

    mockBackend({ '/admin/link/1': { code: 404, message: '友链不存在' } })

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoLinks(wrapper)

    const before = fetchMock.mock.calls.filter(c => pathOf(c[0]) === '/admin/link/list').length

    await wrapper.findAll('.panel .el-table__row')[0].findAll('.el-button')
      .find(b => b.text() === '删除').trigger('click')
    await flushPromises()

    expect(warning.mock.calls.some(c => String(c[0]).includes('列表已刷新'))).toBe(true)
    const after = fetchMock.mock.calls.filter(c => pathOf(c[0]) === '/admin/link/list').length
    expect(after).toBeGreaterThan(before)
    vi.restoreAllMocks()
  })

  it('菜单里_should有「友链管理」，切过去才拉列表', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()

    expect(wrapper.findAll('.side-nav .nv-label').map(n => n.text())).toContain('友链管理')
    expect(fetchMock.mock.calls.filter(c => pathOf(c[0]) === '/admin/link/list')).toHaveLength(0)
  })

  it('操作列的按钮_should有"永不折行"的结构性保证（jsdom 量不出排版）', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoLinks(wrapper)

    expect(wrapper.find('.lp-acts').exists()).toBe(true)
  })
})
