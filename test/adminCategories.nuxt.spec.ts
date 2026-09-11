import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { ElMessage, ElMessageBox } from 'element-plus'
import AdminPage from '~/pages/admin.vue'
import CategoriesPanel from '~/components/admin/CategoriesPanel.vue'

// =====================================================================
// 后台「分类管理」的组件测试
//
// 【这一组守的是什么】
//   上一批任务里分类页是**只读**的（当时的约定是"分类的增删改不做"），
//   这一批后端已经有写接口了，于是把它做成可编辑。它和标签管理形状一样，
//   但有两处**本质不同**，而这两处恰好是最容易写错的地方：
//     ① 分类是【一对一】的：一篇文章只属于一个分类。所以"分类下还有文章"时
//        后端会**拒绝删除**，并返回 400 + 「还有 N 篇文章在用这个分类，请先调整这些文章的分类」
//        —— 这句话是用户唯一能据此行动的信息（N 篇是几篇、该去干什么）。
//        只弹一个 toast 的话，三秒后它消失了，用户既不知道有几篇也不知道去哪改，
//        所以它必须**留在页面上**（下面有用例专门钉这一点）。
//     ② 分类多一个「描述」字段（标签没有）：它是可选的、最长 255 字、
//        留空时后端归一成 null，列表里要显示成「—」而不是空白单元格。
//   另外两条与标签共有的纪律也在这里再钉一遍：提交前 trim（后端也是 trim 后查重）、
//   失败原因留在弹窗里（重名时用户要做的动作就是改名字再点一次保存）。
//
// 【怎么断言"发出去的请求"】同其它后台用例：$fetch 换成按 URL 分发的假实现，
//   然后从 mock 的调用记录里读 method / body —— 断言请求体比断言"函数被调用了"更有意义，
//   它同时钉住了字段名（body.description 而不是 body.desc）。
// =====================================================================

const { fetchMock, tokenRef } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  tokenRef: { value: 'fake-token' },
}))
mockNuxtImport('$fetch', () => fetchMock)
mockNuxtImport('useCookie', () => () => tokenRef)

// 页面上有多个 el-select，它们的下拉面板会 teleport 到 body 并留在那里；
// 每个用例结束都卸载，免得上一个用例残留的面板影响下一个
enableAutoUnmount(afterEach)

const body = (data) => ({ code: 200, message: '成功', data })
const pathOf = (url) => String(url).split('?')[0]

/** 后端 GET /category/list 的真实形状（就是联调时拿到的三个分类） */
const CATEGORIES = [
  { id: 1, name: '技术笔记', description: 'Java、Spring、数据库的学习记录', sort: 1 },
  { id: 2, name: '项目复盘', description: '做过的东西，回头看看', sort: 2 },
  { id: 3, name: '生活随笔', description: null, sort: 3 },
]

const mockBackend = (overrides = {}) => {
  fetchMock.mockImplementation((url) => {
    const path = pathOf(url)
    if (path in overrides) return Promise.resolve(overrides[path])
    if (path === '/article/stats') return Promise.resolve(body({ articleCount: 2, viewCount: 28, categoryCount: 3 }))
    if (path === '/auth/me') return Promise.resolve(body({ id: 1, username: 'admin', role: 'ADMIN' }))
    if (path === '/user/page') return Promise.resolve(body({ records: [], total: 7 }))
    if (path === '/category/list') return Promise.resolve(body(CATEGORIES))
    if (path === '/admin/tag/list') return Promise.resolve(body([]))
    if (path === '/admin/article/page') return Promise.resolve(body({ records: [], total: 0 }))
    return Promise.resolve(body(null))
  })
}

/** 切到「分类管理」菜单（默认停在用户管理，菜单顺序见 admin.vue 的 menus） */
const gotoCategories = async (wrapper) => {
  const item = wrapper.findAll('.side-nav a').find(a => a.text() === '分类管理')
  await item.trigger('click')
  await flushPromises()
}

/** 表格里当前渲染出来的分类名 */
const categoryNames = (wrapper) => wrapper.findAll('.panel .el-table__row').map(r => r.findAll('td')[1].text())

/** 点弹窗里的保存按钮 */
const clickSave = async (wrapper) => {
  const save = wrapper.findAll('.el-dialog .el-button').find(b => b.text().includes('保存'))
  await save.trigger('click')
  await flushPromises()
}

/** 弹窗里的名字输入框（描述是 textarea，所以名字用 input 定位） */
const typeName = async (wrapper, value) => {
  await wrapper.find('.el-dialog input').setValue(value)
}

/** 弹窗里的描述 textarea */
const typeDescription = async (wrapper, value) => {
  await wrapper.find('.el-dialog textarea').setValue(value)
}

/**
 * 分类弹窗里的表单状态（名字 / 描述 / 排序）。
 *
 * 【w7.4 拆组件之后这里的定位方式变了，断言的内容没变】
 *   拆分之前 `categoryForm` 是 admin.vue 自己的变量，一句 `categoryFormOf(wrapper)` 就够；
 *   拆完之后它属于 CategoriesPanel 那个组件（面板自己扛着弹窗表单），
 *   所以要先找到那个面板、再读它自己的表单。
 *   "直接改表单的值"这种做法本身没有变 —— 它模拟的是"绕过 el-input 的 maxlength"，
 *   而 el-input-number / el-input 真正断开的时候，这个断言照样会红。
 */
const categoryFormOf = (wrapper) => wrapper.findComponent(CategoriesPanel).vm.categoryForm

/** 某次请求的调用记录（找不到就是 undefined） */
const callTo = (method, path) =>
  fetchMock.mock.calls.find(c => pathOf(c[0]) === path && c[1]?.method === method)

describe('后台 · 分类管理', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    mockBackend()
  })

  // ---------------------------------------------------------------
  // 一、列表
  // ---------------------------------------------------------------

  it('分类列表_should显示 ID、名字、排序与描述', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoCategories(wrapper)

    expect(categoryNames(wrapper)).toEqual(['技术笔记', '项目复盘', '生活随笔'])
    const first = wrapper.findAll('.panel .el-table__row')[0].findAll('td')
    expect(first[0].text()).toBe('1')                      // ID
    expect(first[2].text()).toBe('1')                      // 排序
    expect(first[3].text()).toBe('Java、Spring、数据库的学习记录')
  })

  it('描述为 null 的分类_should显示「—」，而不是一个空白单元格', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoCategories(wrapper)

    // 空白会让人以为"这一格没加载出来"，而「—」明确是"没有描述"
    expect(wrapper.findAll('.panel .el-table__row')[2].findAll('td')[3].text()).toBe('—')
  })

  it('接口失败或返回非数组_should列表为空但页面其余部分照常（不把后台带崩）', async () => {
    mockBackend({ '/category/list': { code: 500, message: '服务器开小差了' } })

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoCategories(wrapper)

    expect(wrapper.findAll('.panel .el-table__row').length).toBe(0)
    expect(wrapper.text()).toContain('还没有分类')
    // 菜单项数量：概览 / 文章 / 用户 / 标签 / 分类 / 收藏 / 项目 / 友链 / 关于 / 音乐 / 评论 / 设置
    // （F5 加了四个内容模块、后来又加了音乐，从 7 项变成 12 项）
    expect(wrapper.findAll('.side-nav .nv-label').length).toBe(12)
  })

  it('分类页_should是可编辑的（有新建 / 编辑 / 删除按钮，且不再有"只读"说明）', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoCategories(wrapper)

    const labels = wrapper.findAll('.panel .el-button').map(b => b.text())
    expect(labels).toContain('编辑')
    expect(labels).toContain('删除')
    expect(wrapper.findAll('.toolbar .el-button').map(b => b.text()).join()).toContain('新建分类')
    // 【这条是"上一批的只读说明必须删掉"的护栏】它还写着"增删改后端已有接口、前台没接"，
    // 而现在前台已经接了 —— 留着就是一句假话
    expect(wrapper.text()).not.toContain('只读')
  })

  it('切到分类管理_should重新拉一次列表（在别处改过之后，看到的应该是当前的）', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    const before = fetchMock.mock.calls.filter(c => pathOf(c[0]) === '/category/list').length

    await gotoCategories(wrapper)

    expect(fetchMock.mock.calls.filter(c => pathOf(c[0]) === '/category/list').length).toBeGreaterThan(before)
  })

  // ---------------------------------------------------------------
  // 二、新建
  // ---------------------------------------------------------------

  it('新建分类_should POST /admin/category，成功后重新拉列表', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoCategories(wrapper)

    // 建完之后后端多返回一个：证明"列表真的重新拉了一次"（而不是本地塞了一条）
    fetchMock.mockImplementation((url) => {
      const path = pathOf(url)
      if (path === '/category/list') {
        return Promise.resolve(body([...CATEGORIES, { id: 9, name: '部署运维', description: '上线那些事', sort: 4 }]))
      }
      if (path === '/article/stats') return Promise.resolve(body({ articleCount: 2, viewCount: 28, categoryCount: 4 }))
      if (path === '/user/page') return Promise.resolve(body({ records: [], total: 7 }))
      if (path === '/admin/tag/list') return Promise.resolve(body([]))
      return Promise.resolve(body(null))
    })

    await wrapper.findAll('.toolbar .el-button').find(b => b.text().includes('新建分类')).trigger('click')
    await flushPromises()
    await typeName(wrapper, '部署运维')
    await typeDescription(wrapper, '上线那些事')
    await clickSave(wrapper)

    const post = callTo('POST', '/admin/category')
    expect(post).toBeTruthy()
    // 【字段名与形状都要对】后端 CategoryForm 就是 {name, description, sort}
    expect(post[1].body).toEqual({ name: '部署运维', description: '上线那些事', sort: 0 })
    expect(categoryNames(wrapper)).toContain('部署运维')
  })

  it('名字与描述前后带空格_should trim 之后再提交（后端也是 trim 后查重/落库）', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoCategories(wrapper)

    await wrapper.findAll('.toolbar .el-button').find(b => b.text().includes('新建分类')).trigger('click')
    await flushPromises()
    await typeName(wrapper, '  部署运维  ')
    await typeDescription(wrapper, '  上线那些事  ')
    await clickSave(wrapper)

    // 不 trim 的表现：请求体里是带空格的字符串（后端能处理，但日志里是脏数据，
    // 而且 maxlength=50 会因为空格提前截断一个本来合法的名字）
    expect(callTo('POST', '/admin/category')[1].body).toEqual({
      name: '部署运维',
      description: '上线那些事',
      sort: 0,
    })
  })

  it('名字只有空格_should前端就拦下来，不浪费一次往返', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoCategories(wrapper)

    await wrapper.findAll('.toolbar .el-button').find(b => b.text().includes('新建分类')).trigger('click')
    await flushPromises()
    await typeName(wrapper, '   ')
    await clickSave(wrapper)

    expect(callTo('POST', '/admin/category')).toBeUndefined()
    expect(wrapper.find('.ed-error').text()).toContain('不能为空')
    // 弹窗还开着，用户可以直接补名字
    expect(wrapper.find('.el-dialog').exists()).toBe(true)
  })

  it('名字超 50 字 / 描述超 255 字_should都在本地拦下来（与后端注解同一套上限）', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoCategories(wrapper)

    await wrapper.findAll('.toolbar .el-button').find(b => b.text().includes('新建分类')).trigger('click')
    await flushPromises()

    // el-input 上的 maxlength 会把输入截断，所以这里直接改表单的值来模拟"绕过前端"的输入
    categoryFormOf(wrapper).name = 'x'.repeat(51)
    await clickSave(wrapper)
    expect(callTo('POST', '/admin/category')).toBeUndefined()
    expect(wrapper.find('.ed-error').text()).toContain('最长 50 字')

    categoryFormOf(wrapper).name = '正常的名字'
    categoryFormOf(wrapper).description = 'y'.repeat(256)
    await clickSave(wrapper)
    expect(callTo('POST', '/admin/category')).toBeUndefined()
    expect(wrapper.find('.ed-error').text()).toContain('最长 255 字')
  })

  // ---------------------------------------------------------------
  // 三、重名：显示后端的原因，而且弹窗不能关
  // ---------------------------------------------------------------

  it('重名_should把后端那句「分类名已存在」显示在弹窗里，并且不关闭弹窗', async () => {
    mockBackend({ '/admin/category': { code: 400, message: '分类名已存在' } })

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoCategories(wrapper)

    await wrapper.findAll('.toolbar .el-button').find(b => b.text().includes('新建分类')).trigger('click')
    await flushPromises()
    await typeName(wrapper, '技术笔记')
    await clickSave(wrapper)

    // 【为什么断言"弹窗里"而不是只断言弹了提示】toast 三秒后消失，
    // 而重名时用户要做的动作是"改个名字再点一次保存" —— 那时他还看着这个弹窗
    expect(wrapper.find('.el-dialog').exists()).toBe(true)
    expect(wrapper.find('.ed-error').text()).toContain('分类名已存在')
    expect(wrapper.find('.ed-error').text()).not.toContain('操作失败')
  })

  it('后端没给原因时_should用一句兜底文案，而不是显示一个空白的错误条', async () => {
    mockBackend({ '/admin/category': { code: 400 } })

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoCategories(wrapper)

    await wrapper.findAll('.toolbar .el-button').find(b => b.text().includes('新建分类')).trigger('click')
    await flushPromises()
    await typeName(wrapper, '随便')
    await clickSave(wrapper)

    expect(wrapper.find('.ed-error').text()).toBe('保存失败，请稍后再试')
  })

  // ---------------------------------------------------------------
  // 四、编辑
  // ---------------------------------------------------------------

  it('编辑分类_should用 PUT /admin/category/{id}，并把当前值（含描述）回显进弹窗', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoCategories(wrapper)

    await wrapper.findAll('.panel .el-table__row')[0].findAll('.el-button')
      .find(b => b.text() === '编辑').trigger('click')
    await flushPromises()

    expect(wrapper.find('.el-dialog input').element.value).toBe('技术笔记')
    // 【描述也要回显】不回显的话，用户改一个排序就会把描述清空
    expect(wrapper.find('.el-dialog textarea').element.value).toBe('Java、Spring、数据库的学习记录')

    await typeName(wrapper, '技术笔记（改）')
    await clickSave(wrapper)

    const put = callTo('PUT', '/admin/category/1')
    expect(put).toBeTruthy()
    expect(put[1].body).toEqual({
      name: '技术笔记（改）',
      description: 'Java、Spring、数据库的学习记录',
      sort: 1,
    })
  })

  it('描述为 null / 排序为 null 的分类_should回显成空串与 0，而不是让输入框空着', async () => {
    mockBackend({
      '/category/list': body([{ id: 5, name: '没有描述的分类', description: null, sort: null }]),
    })

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoCategories(wrapper)

    await wrapper.find('.panel .el-table__row .el-button').trigger('click')
    await flushPromises()

    // el-input-number 显示的是它自己的值（数字控件，不是原生 input.value）
    expect(categoryFormOf(wrapper).sort).toBe(0)
    expect(categoryFormOf(wrapper).description).toBe('')
  })

  // ---------------------------------------------------------------
  // 五、删除：二次确认 + 被拒时把后端那句话留在页面上
  // ---------------------------------------------------------------

  it('删除_should先弹二次确认，且说明"分类下还有文章时会被拒绝"', async () => {
    const confirmSpy = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm')

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoCategories(wrapper)

    await wrapper.findAll('.panel .el-table__row')[0].findAll('.el-button')
      .find(b => b.text() === '删除').trigger('click')
    await flushPromises()

    expect(confirmSpy).toHaveBeenCalledTimes(1)
    const tip = confirmSpy.mock.calls[0][0]
    // 分类与标签不同：这里**不能**承诺"删掉就完事"—— 还有文章在用的话一定会被拒绝。
    // 提前说清楚，用户就不会以为是页面坏了
    expect(tip).toContain('会被拒绝')
    expect(tip).toContain('无法恢复')
    expect(callTo('DELETE', '/admin/category/1')).toBeTruthy()
    confirmSpy.mockRestore()
  })

  it('二次确认里点取消_should一个请求都不发', async () => {
    const confirmSpy = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue(new Error('cancel'))

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoCategories(wrapper)

    await wrapper.findAll('.panel .el-table__row')[0].findAll('.el-button')
      .find(b => b.text() === '删除').trigger('click')
    await flushPromises()

    expect(callTo('DELETE', '/admin/category/1')).toBeUndefined()
    confirmSpy.mockRestore()
  })

  it('删除被拒（分类下还有文章）_should把后端那句"还有 N 篇在用"原样留在页面上', async () => {
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm')

    mockBackend({
      '/admin/category/1': { code: 400, message: '还有 3 篇文章在用这个分类，请先调整这些文章的分类' },
    })

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoCategories(wrapper)

    await wrapper.findAll('.panel .el-table__row')[0].findAll('.el-button')
      .find(b => b.text() === '删除').trigger('click')
    await flushPromises()

    const notice = wrapper.find('.panel-note.is-error')
    expect(notice.exists()).toBe(true)
    // 【为什么必须留住这句话，而不是只说"删除失败"】"还有 N 篇"是用户唯一能
    // 据此行动的信息：有几篇、以及该去做什么。toast 三秒后就没了，
    // 而用户此刻正卡在"为什么删不掉"上
    expect(notice.text()).toContain('还有 3 篇文章在用这个分类，请先调整这些文章的分类')
    // 还告诉他去哪儿调整（光说"请先调整"等于没说）
    expect(notice.text()).toContain('文章管理')
    // 分类还在列表里（删除确实没生效）
    expect(categoryNames(wrapper)).toContain('技术笔记')
    vi.restoreAllMocks()
  })

  it('删除成功后_should刷新列表并清掉上一次留下的失败说明', async () => {
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm')

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoCategories(wrapper)
    expect(categoryNames(wrapper)).toHaveLength(3)

    // 先制造一次"被拒"，再让它成功：页面上那句提示必须被清掉，
    // 否则"删掉了还挂着上次的报错"，用户会以为又失败了
    mockBackend({ '/admin/category/1': { code: 400, message: '还有 3 篇文章在用这个分类，请先调整这些文章的分类' } })
    await wrapper.findAll('.panel .el-table__row')[0].findAll('.el-button')
      .find(b => b.text() === '删除').trigger('click')
    await flushPromises()
    expect(wrapper.find('.panel-note.is-error').exists()).toBe(true)

    mockBackend({
      '/admin/category/1': body(null),
      '/category/list': body([CATEGORIES[1], CATEGORIES[2]]),
    })
    await wrapper.findAll('.panel .el-table__row')[0].findAll('.el-button')
      .find(b => b.text() === '删除').trigger('click')
    await flushPromises()

    expect(categoryNames(wrapper)).toEqual(['项目复盘', '生活随笔'])
    expect(wrapper.find('.panel-note.is-error').exists()).toBe(false)
    vi.restoreAllMocks()
  })

  it('删一个已经被别人删掉的分类（404）_should自愈：提示一句 + 刷新列表', async () => {
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm')
    const warning = vi.spyOn(ElMessage, 'warning').mockImplementation(() => {})

    mockBackend({ '/admin/category/1': { code: 404, message: '分类不存在' } })

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoCategories(wrapper)

    await wrapper.findAll('.panel .el-table__row')[0].findAll('.el-button')
      .find(b => b.text() === '删除').trigger('click')
    await flushPromises()

    // 只说"分类不存在"的话，用户看到的是"报错 + 表格里还有它"，会以为删除失败再点一次
    expect(warning.mock.calls.some(c => String(c[0]).includes('列表已刷新'))).toBe(true)
    expect(fetchMock.mock.calls.filter(c => pathOf(c[0]) === '/category/list').length).toBeGreaterThan(1)
    // 404 是"它已经没了"，不是"操作被拒"，所以不该在页面上留一条错误说明
    expect(wrapper.find('.panel-note.is-error').exists()).toBe(false)
    vi.restoreAllMocks()
  })

  it('后端没给原因时_删除失败也要在页面上留一句兜底说明', async () => {
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm')
    mockBackend({ '/admin/category/1': { code: 500 } })

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoCategories(wrapper)

    await wrapper.findAll('.panel .el-table__row')[0].findAll('.el-button')
      .find(b => b.text() === '删除').trigger('click')
    await flushPromises()

    expect(wrapper.find('.panel-note.is-error').text()).toContain('请稍后再试')
    vi.restoreAllMocks()
  })
})
