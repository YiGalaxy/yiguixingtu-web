import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { ElMessage, ElMessageBox } from 'element-plus'
import AdminPage from '~/pages/admin.vue'
import ProjectsPanel from '~/components/admin/ProjectsPanel.vue'

// =====================================================================
// 后台「项目管理」的组件测试
//
// 【这一组守的核心是一条跨字段规则】
//   项目的 url（在线演示）与 repo（代码仓库）**各自可空、但不能同时为空**
//   （后端 ProjectServiceImpl.requireAtLeastOneAddress，注解表达不了，
//    所以写在 Service 里）。两个都空的项目卡片在前台点不出任何东西 ——
//   访客看到一张写着名字的卡片，点哪儿都没反应，只会以为它坏了。
//   前端也拦一道（省一次必然失败的往返），文案与后端一字不差。
//   所以下面有：都空 → 前端拦下、一个请求都不发；只填仓库 → 正常提交。
//
// 【另外几条与收藏管理同源，但仍然是各自模块的护栏】
//   · tech 是**逗号分隔的字符串**：请求体里必须是字符串，不能是数组
//     （后端 @Size 只认字符串，传数组会直接 400）
//   · cover / avatar 这类图片字段允许 `/` 开头的站内路径（上传接口返回的就是它）
//   · 404 自愈、二次确认取消不发请求、后端原话留在弹窗里
//
// 【jsdom 不做布局】"按钮不折行"量不出来，只能钉 `.pp-acts` 的 nowrap（最末一条用例）。
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
 * 后端 GET /admin/project/list 的真实形状（含隐藏的）。
 * 【为什么第二条的 url / cover / tech 都是 null】后端允许这些字段为空，
 * 页面必须能渲染（而不是印 undefined 或者留空白）。
 */
const PROJECTS = [
  {
    id: 1, name: '联调项目A', description: '简介A',
    url: 'https://a.example', repo: 'https://github.com/a/b', cover: '/uploads/c1.png',
    tech: 'Spring Boot,MySQL', sort: 1, status: 1, createTime: '2026-09-10T05:03:19',
  },
  {
    id: 2, name: '联调项目B', description: null,
    url: null, repo: null, cover: null,
    tech: null, sort: 2, status: 0, createTime: null,
  },
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
  if (path === '/admin/project/list') return body(PROJECTS)
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

const gotoProjects = async (wrapper) => {
  await wrapper.findAll('.side-nav a').find(a => a.text() === '项目管理').trigger('click')
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
  await wrapper.findAll('.toolbar .el-button').find(b => b.text().includes('新建项目')).trigger('click')
  await flushPromises()
}

const inputByPlaceholder = (wrapper, placeholder) =>
  wrapper.find(`.el-dialog input[placeholder="${placeholder}"]`)

const NAME_PH = '比如：亿轨星途博客系统'
const URL_PH = 'https://example.com（与仓库地址至少填一个）'
const REPO_PH = 'https://github.com/you/repo（与在线地址至少填一个）'
/** 封面那一栏**保留着手填输入框**（上传与手填两种入口都要能用），所以它能按 placeholder 定位 */
const COVER_PH = '/uploads/cover.png 或 https://…（也可以点上传）'

const panelOf = (wrapper) => wrapper.findComponent(ProjectsPanel)

describe('后台 · 项目管理', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    mockBackend()
  })

  // ---------------------------------------------------------------
  // 一、列表
  // ---------------------------------------------------------------

  it('列表_should显示名称、技术栈、两个地址与状态（含隐藏的）', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoProjects(wrapper)

    expect(rowNames(wrapper)).toEqual(['联调项目A', '联调项目B'])
    const first = wrapper.findAll('.panel .el-table__row')[0].findAll('td')
    // 技术栈在库里是逗号分隔的字符串，后台原样显示（拆分是前台卡片的事）
    expect(first[2].text()).toBe('Spring Boot,MySQL')
    // 两个地址都是能点开的外链（后台也遵守同一套 http(s) 白名单）
    const links = first[3].findAll('a')
    expect(links).toHaveLength(2)
    expect(links[0].attributes('href')).toBe('https://a.example')
    expect(links[0].attributes('target')).toBe('_blank')
    expect(links[0].attributes('rel')).toBe('noopener')
    expect(first[5].text()).toBe('显示')
    expect(wrapper.findAll('.panel .el-table__row')[1].findAll('td')[5].text()).toBe('隐藏')
  })

  it('技术栈与两个地址都为 null_should显示「—」，而不是留一格空白', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoProjects(wrapper)

    const second = wrapper.findAll('.panel .el-table__row')[1].findAll('td')
    expect(second[2].text()).toBe('—')
    expect(second[3].text()).toBe('—')
    expect(wrapper.text()).not.toContain('undefined')
  })

  it('列表接口失败_should列表为空但页面其余部分照常', async () => {
    mockBackend({ '/admin/project/list': { code: 500, message: '服务器开小差了' } })

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoProjects(wrapper)

    expect(wrapper.findAll('.panel .el-table__row').length).toBe(0)
    expect(wrapper.text()).toContain('还没有项目')
    expect(wrapper.find('.top h1').text()).toBe('项目管理')
  })

  it('列表接口返回了非数组_should当成空列表，而不是把渲染打挂', async () => {
    mockBackend({ '/admin/project/list': body({ records: PROJECTS }) })

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoProjects(wrapper)

    expect(wrapper.findAll('.panel .el-table__row').length).toBe(0)
  })

  // ---------------------------------------------------------------
  // 二、新建：那条跨字段规则
  // ---------------------------------------------------------------

  it('两个地址都为空_should前端拦下来，一个请求都不发', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoProjects(wrapper)

    await clickCreate(wrapper)
    await inputByPlaceholder(wrapper, NAME_PH).setValue('一个项目')
    await clickSave(wrapper)

    // 【为什么这条最要紧】后端 Service 里也有这条规则，前端拦一道是为了
    // 省一次必然失败的往返；而且提示里必须把**两个字段名**都说出来 ——
    // 只说"地址不能为空"的话，用户看着表单里两个地址框不知道说的是哪一个
    expect(callTo('POST', '/admin/project')).toBeUndefined()
    const error = wrapper.find('.ed-error').text()
    expect(error).toContain('在线地址')
    expect(error).toContain('仓库地址')
    expect(error).toContain('至少要填一个')
  })

  it('只填仓库地址_should允许提交（两个字段各自可空、但不能同时为空）', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoProjects(wrapper)

    await clickCreate(wrapper)
    await inputByPlaceholder(wrapper, NAME_PH).setValue('只有仓库的项目')
    await inputByPlaceholder(wrapper, REPO_PH).setValue('https://github.com/a/c')
    await clickSave(wrapper)

    const post = callTo('POST', '/admin/project')
    expect(post).toBeTruthy()
    expect(post[1].body.url).toBe('')
    expect(post[1].body.repo).toBe('https://github.com/a/c')
  })

  it('只填在线地址_should同样允许提交', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoProjects(wrapper)

    await clickCreate(wrapper)
    await inputByPlaceholder(wrapper, NAME_PH).setValue('只有在线的项目')
    await inputByPlaceholder(wrapper, URL_PH).setValue('https://online.example')
    await clickSave(wrapper)

    expect(callTo('POST', '/admin/project')).toBeTruthy()
  })

  it('新建项目_should POST /admin/project，字段名与后端 ProjectForm 一致，成功后重拉列表', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoProjects(wrapper)

    fetchMock.mockImplementation((url, options) => {
      const path = pathOf(url)
      if (path === '/admin/project' && options?.method === 'POST') return Promise.resolve(body(9))
      if (path === '/admin/project/list') {
        return Promise.resolve(body([...PROJECTS, { id: 9, name: '新项目', tech: 'Vue', sort: 0, status: 1 }]))
      }
      // 其余路径委托给标准假后端（理由见 defaultResponse 的注释）
      return Promise.resolve(defaultResponse(path))
    })

    await clickCreate(wrapper)
    await inputByPlaceholder(wrapper, NAME_PH).setValue('新项目')
    await inputByPlaceholder(wrapper, URL_PH).setValue('https://new.example')
    // 技术栈是**字符串**（逗号分隔），不是数组 —— 传数组后端会 400
    await wrapper.find('.el-dialog input[placeholder^="Spring Boot,MySQL,Redis"]').setValue('Vue,TypeScript')
    await clickSave(wrapper)

    expect(callTo('POST', '/admin/project')[1].body).toEqual({
      name: '新项目',
      description: '',
      url: 'https://new.example',
      repo: '',
      cover: '',
      tech: 'Vue,TypeScript',
      sort: 0,
      status: 1,
    })
    expect(rowNames(wrapper)).toContain('新项目')
  })

  it('封面地址是 / 开头的站内路径_should允许（后端 IMAGE_URL 比外链多允许这一种形态）', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoProjects(wrapper)

    await clickCreate(wrapper)
    await inputByPlaceholder(wrapper, NAME_PH).setValue('有站内封面的项目')
    await inputByPlaceholder(wrapper, URL_PH).setValue('https://a.example')
    // 【为什么这里往输入框里打字、而不是直接设表单字段】
    //   封面那一栏是"上传 + 手填"两条入口都留着的，手填这条必须真的能走通 ——
    //   打字能同时证明 v-model 接上了、以及这个值一路走到了请求体里
    await inputByPlaceholder(wrapper, COVER_PH).setValue('/cover-1.png')
    await clickSave(wrapper)

    // 用外链那一档去判会把 /cover-1.png 判成非法 —— 用户会遇到
    // "界面不让保存、后端其实能收"，这类问题用户完全没法绕过
    expect(callTo('POST', '/admin/project')).toBeTruthy()
    expect(callTo('POST', '/admin/project')[1].body.cover).toBe('/cover-1.png')
  })

  it('封面地址不合法（比如少了开头的斜杠）_should前端拦下来', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoProjects(wrapper)

    await clickCreate(wrapper)
    await inputByPlaceholder(wrapper, NAME_PH).setValue('项目')
    await inputByPlaceholder(wrapper, URL_PH).setValue('https://a.example')
    await inputByPlaceholder(wrapper, COVER_PH).setValue('cover.png')
    await clickSave(wrapper)

    expect(callTo('POST', '/admin/project')).toBeUndefined()
    expect(wrapper.find('.ed-error').text()).toContain('封面图地址必须是 http(s):// 开头')
  })

  it('手填一个外链封面_should原样提交（上传与手填两条入口都要能用）', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoProjects(wrapper)

    await clickCreate(wrapper)
    await inputByPlaceholder(wrapper, NAME_PH).setValue('用外链封面的项目')
    await inputByPlaceholder(wrapper, URL_PH).setValue('https://a.example')
    // 有人就是想贴一个外链（图已经在 CDN 上）：把输入框拿掉会逼他先下载再上传一遍
    await inputByPlaceholder(wrapper, COVER_PH).setValue('https://cdn.example/cover.png')
    await clickSave(wrapper)

    expect(callTo('POST', '/admin/project')[1].body.cover).toBe('https://cdn.example/cover.png')
  })

  it('名称超过 100 字_should前端拦下来（上限来自后端 ProjectForm 的 @Size(max=100)）', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoProjects(wrapper)

    await clickCreate(wrapper)
    await inputByPlaceholder(wrapper, NAME_PH).setValue('名'.repeat(101))
    await inputByPlaceholder(wrapper, URL_PH).setValue('https://a.example')
    await clickSave(wrapper)

    expect(callTo('POST', '/admin/project')).toBeUndefined()
    expect(wrapper.find('.ed-error').text()).toContain('项目名称最长 100 字')
  })

  // ---------------------------------------------------------------
  // 三、保存失败与编辑
  // ---------------------------------------------------------------

  it('保存失败_should把后端那句话显示在弹窗里，并且不关闭弹窗', async () => {
    mockBackend({ '/admin/project': { code: 400, message: '在线地址和仓库地址至少要填一个，否则项目卡片点不出任何东西' } })

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoProjects(wrapper)

    await clickCreate(wrapper)
    await inputByPlaceholder(wrapper, NAME_PH).setValue('项目')
    await inputByPlaceholder(wrapper, URL_PH).setValue('https://a.example')
    await clickSave(wrapper)

    // 【为什么断言 editVisible 而不是 `.el-dialog` 存不存在】Element Plus 关闭弹窗时
    // 不删 DOM（只把遮罩 display:none），`.exists()` 在开关两种状态下都是 true
    expect(panelOf(wrapper).vm.editVisible).toBe(true)
    expect(wrapper.find('.ed-error').text()).toContain('至少要填一个')
  })

  it('编辑_should用 PUT /admin/project/{id} 并回显当前值', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoProjects(wrapper)

    await wrapper.findAll('.panel .el-table__row')[0].findAll('.el-button')
      .find(b => b.text() === '编辑').trigger('click')
    await flushPromises()

    expect(inputByPlaceholder(wrapper, NAME_PH).element.value).toBe('联调项目A')
    expect(inputByPlaceholder(wrapper, REPO_PH).element.value).toBe('https://github.com/a/b')

    await inputByPlaceholder(wrapper, NAME_PH).setValue('联调项目A改')
    await clickSave(wrapper)

    const put = callTo('PUT', '/admin/project/1')
    expect(put).toBeTruthy()
    expect(put[1].body.name).toBe('联调项目A改')
    expect(callTo('POST', '/admin/project')).toBeUndefined()
  })

  it('可选字段为 null 的项目_should回显成空串，而不是"null"这个字面量', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoProjects(wrapper)

    await wrapper.findAll('.panel .el-table__row')[1].findAll('.el-button')
      .find(b => b.text() === '编辑').trigger('click')
    await flushPromises()

    // null 直接给 el-input 会渲染成空，但一旦被 .trim() 用到就会抛异常 ——
    // 所以打开编辑时必须显式兜成空串（这些字段本来还会被拼进请求体）
    const form = panelOf(wrapper).vm.form
    expect(form.description).toBe('')
    expect(form.url).toBe('')
    expect(form.cover).toBe('')
    expect(form.tech).toBe('')
    expect(form.sort).toBe(2)
    expect(form.status).toBe(0)
  })

  // ---------------------------------------------------------------
  // 四、删除
  // ---------------------------------------------------------------

  it('删除_should先弹二次确认（带上项目名与"无法恢复"）', async () => {
    const confirmSpy = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm')

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoProjects(wrapper)

    await wrapper.findAll('.panel .el-table__row')[0].findAll('.el-button')
      .find(b => b.text() === '删除').trigger('click')
    await flushPromises()

    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(confirmSpy.mock.calls[0][0]).toContain('联调项目A')
    expect(confirmSpy.mock.calls[0][0]).toContain('无法恢复')
    expect(callTo('DELETE', '/admin/project/1')).toBeTruthy()
    confirmSpy.mockRestore()
  })

  it('二次确认里点取消_should一个请求都不发', async () => {
    const confirmSpy = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue(new Error('cancel'))

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoProjects(wrapper)

    await wrapper.findAll('.panel .el-table__row')[0].findAll('.el-button')
      .find(b => b.text() === '删除').trigger('click')
    await flushPromises()

    expect(callTo('DELETE', '/admin/project/1')).toBeUndefined()
    confirmSpy.mockRestore()
  })

  it('删一条已经被别人删掉的项目（404）_should自愈：提示一句 + 真的重拉列表', async () => {
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm')
    const warning = vi.spyOn(ElMessage, 'warning').mockImplementation(() => {})

    mockBackend({ '/admin/project/1': { code: 404, message: '项目不存在' } })

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoProjects(wrapper)

    const before = fetchMock.mock.calls.filter(c => pathOf(c[0]) === '/admin/project/list').length

    await wrapper.findAll('.panel .el-table__row')[0].findAll('.el-button')
      .find(b => b.text() === '删除').trigger('click')
    await flushPromises()

    expect(warning.mock.calls.some(c => String(c[0]).includes('列表已刷新'))).toBe(true)
    const after = fetchMock.mock.calls.filter(c => pathOf(c[0]) === '/admin/project/list').length
    expect(after).toBeGreaterThan(before)
    vi.restoreAllMocks()
  })

  // ---------------------------------------------------------------
  // 五、封面上传（与文章弹窗同一套 useUpload）
  // ---------------------------------------------------------------

  it('上传封面_should把后端返回的 data.url 写回封面字段', async () => {
    // 后端 POST /upload 返回的是 Result<{ url, ... }>：地址在 data.url 上（不是 data 本身）
    mockBackend({ '/upload': body({ url: 'http://x/uploads/cover/9.png', filename: '9.png' }) })

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoProjects(wrapper)
    await clickCreate(wrapper)

    // 【为什么从界面上的文件输入框触发、而不是直接调那个回调】
    //   直接调 onCoverChosen 只是"函数被调用了"，测不出 el-upload 有没有接上。
    //   这里给 <input type="file"> 塞一个真的 File 再触发 change，
    //   走的就是用户点按钮选文件那条路（ElUpload 的 on-change → 我们的回调）。
    const input = wrapper.find('.el-dialog input[type="file"]')
    Object.defineProperty(input.element, 'files', {
      value: [new File([new Uint8Array([1, 2, 3])], 'cover.png', { type: 'image/png' })],
      configurable: true,
    })
    await input.trigger('change')
    await flushPromises()

    const upload = callTo('POST', '/upload')
    expect(upload).toBeTruthy()
    // 后端是 @RequestParam("file")，字段名必须叫 file —— 写成别的后端收不到文件
    expect(upload[1].body).toBeInstanceOf(FormData)
    expect(upload[1].body.get('file')).toBeTruthy()
    // 地址回填到表单：保存时跟着 body.cover 一起提交
    expect(panelOf(wrapper).vm.form.cover).toBe('http://x/uploads/cover/9.png')
    // 【关键：回填必须"看得见"】地址要出现在那个手填输入框里 ——
    // 只写进 data 而不进输入框的话，用户既看不到传上去的结果、也没法接着改
    expect(inputByPlaceholder(wrapper, COVER_PH).element.value).toBe('http://x/uploads/cover/9.png')
    // 预览图也跟着出现了（不然用户不知道传上去的到底是哪张图）
    expect(wrapper.find('.cover-preview').attributes('src')).toBe('http://x/uploads/cover/9.png')
  })

  it('上传失败_should【保留原来的封面地址】并给出后端原话', async () => {
    const errorSpy = vi.spyOn(ElMessage, 'error').mockImplementation(() => {})
    mockBackend({ '/upload': { code: 400, message: '只允许上传 jpg / png 格式的图片' } })

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoProjects(wrapper)

    // 打开已有项目的编辑（它本来就有一张封面），再传一张会失败的文件
    await wrapper.findAll('.panel .el-table__row')[0].findAll('.el-button')
      .find(b => b.text() === '编辑').trigger('click')
    await flushPromises()
    expect(panelOf(wrapper).vm.form.cover).toBe('/uploads/c1.png')

    await panelOf(wrapper).vm.onCoverChosen({
      raw: new File([new Uint8Array([1])], 'cover.png', { type: 'image/png' }),
    })
    await flushPromises()

    // 【为什么这一条最要紧】失败时把字段清空的话，用户会以为"我那张图丢了"，
    // 而且接着点保存就会把项目封面真的清掉（后端是整份表单覆盖式提交）。
    // 这里连**输入框里显示的值**一起断言：实现里最容易写错的写法就是
    // "先把 form.cover 清空再赋值"，那会让输入框当场变空。
    expect(panelOf(wrapper).vm.form.cover).toBe('/uploads/c1.png')
    expect(inputByPlaceholder(wrapper, COVER_PH).element.value).toBe('/uploads/c1.png')
    expect(errorSpy.mock.calls.some(c => String(c[0]).includes('只允许上传'))).toBe(true)
    vi.restoreAllMocks()
  })

  it('选了不支持的格式_should本地就拦下，一个请求都不发', async () => {
    const errorSpy = vi.spyOn(ElMessage, 'error').mockImplementation(() => {})

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoProjects(wrapper)
    await clickCreate(wrapper)

    // 只做预检的那条路径可以用轻量对象：useUpload 只读 name / size，
    // 校验不通过时根本走不到 FormData.append（所以不需要真的 File）
    await panelOf(wrapper).vm.onCoverChosen({ raw: { name: 'evil.exe', size: 100 } })
    await flushPromises()

    // 本地拦下的意义：不白等一次往返，也不浪费用户的上行带宽
    expect(callTo('POST', '/upload')).toBeUndefined()
    expect(errorSpy.mock.calls.some(c => String(c[0]).includes('只支持'))).toBe(true)
    vi.restoreAllMocks()
  })

  it('选了超过 5MB 的图片_should本地就拦下，一个请求都不发', async () => {
    const errorSpy = vi.spyOn(ElMessage, 'error').mockImplementation(() => {})

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoProjects(wrapper)
    await clickCreate(wrapper)

    // 上限 5MB（与后端 app.upload.max-size 一致）：这里给上限 + 1 字节，边界要卡准
    await panelOf(wrapper).vm.onCoverChosen({ raw: { name: 'big.png', size: 5 * 1024 * 1024 + 1 } })
    await flushPromises()

    expect(callTo('POST', '/upload')).toBeUndefined()
    expect(errorSpy.mock.calls.some(c => String(c[0]).includes('不能超过'))).toBe(true)
    vi.restoreAllMocks()
  })

  it('上传控件的接线_should是"关掉自带请求 + 只收图片"的写法', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoProjects(wrapper)
    await clickCreate(wrapper)

    // accept 会落到 el-upload 内部那个 <input type="file"> 上：选文件对话框只列图片，
    // 用户少一次"选完才被告知不支持"的往返
    const input = wrapper.find('.el-dialog input[type="file"]')
    expect(input.exists()).toBe(true)
    expect(input.attributes('accept')).toContain('image/png')
    // 文件列表不显示：它只是"传一张图"，列出来反而占地方（预览图已经说明了结果）
    expect(wrapper.find('.el-dialog .el-upload-list').exists()).toBe(false)
  })

  it('点「移除」_should清空封面字段（保存时提交空串，后端归一化成 null）', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoProjects(wrapper)

    await wrapper.findAll('.panel .el-table__row')[0].findAll('.el-button')
      .find(b => b.text() === '编辑').trigger('click')
    await flushPromises()

    const remove = wrapper.findAll('.el-dialog .el-button').find(b => b.text() === '移除')
    expect(remove).toBeTruthy()
    await remove.trigger('click')
    await flushPromises()

    expect(panelOf(wrapper).vm.form.cover).toBe('')
    // 输入框也要跟着空掉（它是 user 看到的那个值），并且预览图消失
    expect(inputByPlaceholder(wrapper, COVER_PH).element.value).toBe('')
    expect(wrapper.find('.el-dialog .cover-preview').exists()).toBe(false)

    await clickSave(wrapper)
    expect(callTo('PUT', '/admin/project/1')[1].body.cover).toBe('')
  })

  it('菜单里_should有「项目管理」，切过去才拉列表', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()

    expect(wrapper.findAll('.side-nav .nv-label').map(n => n.text())).toContain('项目管理')
    // 面板在 v-if 链里：没切过去就一次都不该请求
    expect(fetchMock.mock.calls.filter(c => pathOf(c[0]) === '/admin/project/list')).toHaveLength(0)
  })

  it('操作列的按钮_should有"永不折行"的结构性保证（jsdom 量不出排版）', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoProjects(wrapper)

    expect(wrapper.find('.pp-acts').exists()).toBe(true)
  })
})
