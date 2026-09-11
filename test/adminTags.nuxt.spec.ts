import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { ElMessage, ElMessageBox } from 'element-plus'
import AdminPage from '~/pages/admin.vue'
import TagsPanel from '~/components/admin/TagsPanel.vue'

// =====================================================================
// 后台「标签管理」的组件测试
//
// 【这一组守的是什么】
//   标签管理是后台第一个"能写数据"的页面（用户/文章之外），它的坑全在
//   "看起来成功了"这一侧：
//     · 建完不刷新列表 → 用户以为没保存成功，于是再点一次（后端会因重名报错）
//     · 重名时只弹一个 toast → 三秒后消失，用户还在看弹窗，不知道该怎么办
//     · 删除不说明"会解除文章关联" → 用户以为只是从标签库里去掉，
//       结果文章上的标签也没了（后端是物理删除 + 解除关联）
//     · 名字前后带空格照原样提交 → 后端 trim 后入库，前端却按带空格的算长度
//     · 提交失败后把弹窗关了 → 用户刚才输入的名字白输了
//   所以下面既有"调了哪个接口、参数是什么"，也有"界面上留下了什么"。
//
// 【怎么断言"发出去的请求"】同其它后台用例：$fetch 换成按 URL 分发的假实现，
//   然后从 mock 的调用记录里读 method / body。断言请求体比断言"函数被调用了"更有意义 ——
//   它同时钉住了字段名（body.name 而不是 body.tagName）。
// =====================================================================

const { fetchMock, tokenRef } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  tokenRef: { value: 'fake-token' },
}))
mockNuxtImport('$fetch', () => fetchMock)
mockNuxtImport('useCookie', () => () => tokenRef)

// 页面上有 5 个 el-select，它们的下拉面板会 teleport 到 body 并留在那里；
// 每个用例结束都卸载，免得上一个用例残留的面板影响下一个
enableAutoUnmount(afterEach)

const body = (data) => ({ code: 200, message: '成功', data })
const pathOf = (url) => String(url).split('?')[0]

/** 后端 GET /admin/tag/list 的真实形状（articleCount = 该标签下已发布文章数） */
const TAGS = [
  { id: 3, name: '联调标签A', sort: 1, articleCount: 2 },
  { id: 4, name: '联调标签B', sort: 2, articleCount: 0 },
]

const mockBackend = (overrides = {}) => {
  fetchMock.mockImplementation((url) => {
    const path = pathOf(url)
    if (path in overrides) return Promise.resolve(overrides[path])
    if (path === '/article/stats') return Promise.resolve(body({ articleCount: 2, viewCount: 28, categoryCount: 3 }))
    if (path === '/auth/me') return Promise.resolve(body({ id: 1, username: 'admin', role: 'ADMIN' }))
    if (path === '/user/page') return Promise.resolve(body({ records: [], total: 7 }))
    if (path === '/category/list') return Promise.resolve(body([{ id: 1, name: '技术笔记', sort: 1, description: '学习记录' }]))
    if (path === '/admin/tag/list') return Promise.resolve(body(TAGS))
    if (path === '/admin/article/page') return Promise.resolve(body({ records: [], total: 0 }))
    return Promise.resolve(body(null))
  })
}

/** 切到「标签管理」菜单（默认停在用户管理，菜单顺序见 admin.vue 的 menus） */
const gotoTags = async (wrapper) => {
  const item = wrapper.findAll('.side-nav a').find(a => a.text() === '标签管理')
  await item.trigger('click')
  await flushPromises()
}

/** 表格里当前渲染出来的标签名 */
const tagNames = (wrapper) => wrapper.findAll('.panel .el-table__row').map(r => r.findAll('td')[0].text())

/**
 * 标签弹窗里的表单状态（名字 / 排序）。
 *
 * 【w7.4 拆组件之后这里的定位方式变了，断言的内容没变】
 *   拆分之前 `tagForm` 是 admin.vue 自己的变量，一句 `wrapper.vm.tagForm` 就够；
 *   拆完之后它属于 TagsPanel 那个组件（面板自己扛着弹窗表单），
 *   所以要先找到那个面板、再读它自己的表单 ——
 *   比对的还是"排序回显成 0 而不是显示成空"，这条用例在拆分前后同样会红。
 */
const tagFormOf = (wrapper) => wrapper.findComponent(TagsPanel).vm.tagForm

/** 某次请求的调用记录（找不到就是 undefined） */
const callTo = (method, path) =>
  fetchMock.mock.calls.find(c => pathOf(c[0]) === path && c[1]?.method === method)

/** 点弹窗里的保存按钮 */
const clickSave = async (wrapper) => {
  const save = wrapper.findAll('.el-dialog .el-button').find(b => b.text().includes('保存'))
  await save.trigger('click')
  await flushPromises()
}

/** 在弹窗的名字输入框里打字 */
const typeName = async (wrapper, value) => {
  await wrapper.find('.el-dialog input').setValue(value)
}

describe('后台 · 标签管理', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    mockBackend()
  })

  // ---------------------------------------------------------------
  // 一、列表
  // ---------------------------------------------------------------

  it('标签列表_should显示名字、排序与已发布文章数（0 也照样显示 0）', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoTags(wrapper)

    expect(tagNames(wrapper)).toEqual(['联调标签A', '联调标签B'])
    const firstRow = wrapper.findAll('.panel .el-table__row')[0].findAll('td')
    expect(firstRow[1].text()).toBe('1')      // 排序
    expect(firstRow[2].text()).toBe('2')      // 已发布文章数
    // 【第二条特别重要】0 是后端算出来的确定答案（GROUP BY 的结果），
    // 不是"读不到" —— 显示成「—」会让人以为接口坏了
    expect(wrapper.findAll('.panel .el-table__row')[1].findAll('td')[2].text()).toBe('0')
  })

  it('标签接口失败_should列表为空但页面其余部分照常（不把后台带崩）', async () => {
    mockBackend({ '/admin/tag/list': { code: 500, message: '服务器开小差了' } })

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoTags(wrapper)

    expect(wrapper.findAll('.panel .el-table__row').length).toBe(0)
    expect(wrapper.text()).toContain('还没有标签')
    // 菜单项数量：概览 / 文章 / 用户 / 标签 / 分类 / 收藏 / 项目 / 友链 / 关于 / 音乐 / 评论 / 设置
    // （F5 加了四个内容模块、后来又加了音乐，从 7 项变成 12 项；
    //   这条断言守的是"菜单没被少渲染"）
    expect(wrapper.findAll('.side-nav .nv-label').length).toBe(12)
  })

  it('标签接口返回了非数组_should当成空列表，而不是把渲染打挂', async () => {
    // 后端把列表改成分页结构（{records:[]}）时，直接 v-for 会崩
    mockBackend({ '/admin/tag/list': body({ records: TAGS }) })

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoTags(wrapper)

    expect(wrapper.findAll('.panel .el-table__row').length).toBe(0)
  })

  // ---------------------------------------------------------------
  // 二、新建
  // ---------------------------------------------------------------

  it('新建标签_should POST /admin/tag，成功后重新拉列表', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoTags(wrapper)

    // 建完之后后端多返回一个：证明"列表真的重新拉了一次"（而不是本地塞了一条）
    fetchMock.mockImplementation((url, options) => {
      const path = pathOf(url)
      if (path === '/admin/tag' && options?.method === 'POST') return Promise.resolve(body(9))
      if (path === '/admin/tag/list') {
        return Promise.resolve(body([...TAGS, { id: 9, name: '新标签', sort: 0, articleCount: 0 }]))
      }
      if (path === '/article/stats') return Promise.resolve(body({ articleCount: 2, viewCount: 28, categoryCount: 3 }))
      if (path === '/user/page') return Promise.resolve(body({ records: [], total: 7 }))
      if (path === '/category/list') return Promise.resolve(body([]))
      return Promise.resolve(body(null))
    })

    await wrapper.findAll('.toolbar .el-button').find(b => b.text().includes('新建标签')).trigger('click')
    await flushPromises()
    await typeName(wrapper, '新标签')
    await clickSave(wrapper)

    const post = callTo('POST', '/admin/tag')
    expect(post).toBeTruthy()
    expect(post[1].body).toEqual({ name: '新标签', sort: 0 })
    // 列表刷新过：新标签已经在表格里
    expect(tagNames(wrapper)).toContain('新标签')
  })

  it('名字前后带空格_should trim 之后再提交（后端也是 trim 后查重）', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoTags(wrapper)

    await wrapper.findAll('.toolbar .el-button').find(b => b.text().includes('新建标签')).trigger('click')
    await flushPromises()
    await typeName(wrapper, '  工作  ')
    await clickSave(wrapper)

    // 不 trim 的表现：请求体里是 "  工作  "（后端能处理，但日志里是脏数据；
    // 而且 maxlength=30 会因为空格提前截断一个本来合法的名字）
    expect(callTo('POST', '/admin/tag')[1].body.name).toBe('工作')
  })

  it('名字只有空格_should前端就拦下来，不浪费一次往返', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoTags(wrapper)

    await wrapper.findAll('.toolbar .el-button').find(b => b.text().includes('新建标签')).trigger('click')
    await flushPromises()
    await typeName(wrapper, '   ')
    await clickSave(wrapper)

    expect(callTo('POST', '/admin/tag')).toBeUndefined()
    expect(wrapper.find('.ed-error').text()).toContain('不能为空')
    // 弹窗还开着，用户可以直接补名字
    expect(wrapper.find('.el-dialog').exists()).toBe(true)
  })

  // ---------------------------------------------------------------
  // 三、重名：显示后端的原因，而且弹窗不能关
  // ---------------------------------------------------------------

  it('重名_should把后端那句「标签名已存在」显示在弹窗里，并且不关闭弹窗', async () => {
    mockBackend({
      '/admin/tag': { code: 400, message: '标签名已存在' },
    })

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoTags(wrapper)

    await wrapper.findAll('.toolbar .el-button').find(b => b.text().includes('新建标签')).trigger('click')
    await flushPromises()
    await typeName(wrapper, '联调标签A')
    await clickSave(wrapper)

    // 【为什么要断言"弹窗里"而不是只断言弹了提示】toast 三秒后消失，
    // 而重名时用户要做的动作是"改名字再点一次保存" —— 那时他还看着这个弹窗
    expect(wrapper.find('.el-dialog').exists()).toBe(true)
    expect(wrapper.find('.ed-error').text()).toContain('标签名已存在')
    // 提示要能让人看懂是"名字冲突"，而不是一句笼统的"操作失败"
    expect(wrapper.find('.ed-error').text()).not.toContain('操作失败')
  })

  it('后端没给原因时_should用一句兜底文案，而不是显示一个空白的错误条', async () => {
    mockBackend({ '/admin/tag': { code: 400 } })

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoTags(wrapper)

    await wrapper.findAll('.toolbar .el-button').find(b => b.text().includes('新建标签')).trigger('click')
    await flushPromises()
    await typeName(wrapper, '随便')
    await clickSave(wrapper)

    expect(wrapper.find('.ed-error').text()).toBe('保存失败，请稍后再试')
  })

  // ---------------------------------------------------------------
  // 四、编辑
  // ---------------------------------------------------------------

  it('编辑标签_should用 PUT /admin/tag/{id}，并把当前值回显进弹窗', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoTags(wrapper)

    await wrapper.findAll('.panel .el-table__row')[0].findAll('.el-button')
      .find(b => b.text() === '编辑').trigger('click')
    await flushPromises()

    expect(wrapper.find('.el-dialog input').element.value).toBe('联调标签A')

    await typeName(wrapper, '联调标签A改')
    await clickSave(wrapper)

    const put = callTo('PUT', '/admin/tag/3')
    expect(put).toBeTruthy()
    expect(put[1].body).toEqual({ name: '联调标签A改', sort: 1 })
  })

  it('排序是 null 的标签_should回显成 0，而不是让输入框空着（空着保存就变成 0，等于悄悄改了它）', async () => {
    mockBackend({ '/admin/tag/list': body([{ id: 5, name: '没有排序的标签', sort: null, articleCount: 0 }]) })

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoTags(wrapper)

    await wrapper.find('.panel .el-table__row .el-button').trigger('click')
    await flushPromises()

    // el-input-number 显示的是它自己的值（数字控件，不是原生 input.value）
    expect(tagFormOf(wrapper).sort).toBe(0)
  })

  // ---------------------------------------------------------------
  // 五、删除：二次确认 + 说清影响
  // ---------------------------------------------------------------

  it('删除_should先弹二次确认，并且说明会解除文章关联', async () => {
    const confirmSpy = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm')

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoTags(wrapper)

    await wrapper.findAll('.panel .el-table__row')[0].findAll('.el-button')
      .find(b => b.text() === '删除').trigger('click')
    await flushPromises()

    expect(confirmSpy).toHaveBeenCalledTimes(1)
    const tip = confirmSpy.mock.calls[0][0]
    // 后端是物理删除 + 解除关联：不写清楚的话，用户会以为"只是从标签库里去掉"
    expect(tip).toContain('解除')
    expect(tip).toContain('无法恢复')
    // 有几篇已发布文章也要报出来（articleCount 就是为这个准备的）
    expect(tip).toContain('2 篇')

    expect(callTo('DELETE', '/admin/tag/3')).toBeTruthy()
    confirmSpy.mockRestore()
  })

  it('二次确认里点取消_should一个请求都不发', async () => {
    const confirmSpy = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue(new Error('cancel'))

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoTags(wrapper)

    await wrapper.findAll('.panel .el-table__row')[0].findAll('.el-button')
      .find(b => b.text() === '删除').trigger('click')
    await flushPromises()

    expect(callTo('DELETE', '/admin/tag/3')).toBeUndefined()
    confirmSpy.mockRestore()
  })

  it('删除成功后_should刷新列表（那条标签从表格里消失）', async () => {
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm')

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoTags(wrapper)
    expect(tagNames(wrapper)).toEqual(['联调标签A', '联调标签B'])

    // 删掉之后后端只剩一个
    fetchMock.mockImplementation((url, options) => {
      const path = pathOf(url)
      if (path === '/admin/tag/3' && options?.method === 'DELETE') return Promise.resolve(body(null))
      if (path === '/admin/tag/list') return Promise.resolve(body([TAGS[1]]))
      if (path === '/article/stats') return Promise.resolve(body({ articleCount: 2, viewCount: 28, categoryCount: 3 }))
      if (path === '/user/page') return Promise.resolve(body({ records: [], total: 7 }))
      if (path === '/category/list') return Promise.resolve(body([]))
      return Promise.resolve(body(null))
    })

    await wrapper.findAll('.panel .el-table__row')[0].findAll('.el-button')
      .find(b => b.text() === '删除').trigger('click')
    await flushPromises()

    expect(tagNames(wrapper)).toEqual(['联调标签B'])
    vi.restoreAllMocks()
  })

  it('删一个已经被别人删掉的标签（404）_should自愈：提示一句 + 刷新列表', async () => {
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm')
    const warning = vi.spyOn(ElMessage, 'warning').mockImplementation(() => {})

    mockBackend({ '/admin/tag/3': { code: 404, message: '标签不存在' } })

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoTags(wrapper)

    await wrapper.findAll('.panel .el-table__row')[0].findAll('.el-button')
      .find(b => b.text() === '删除').trigger('click')
    await flushPromises()

    // 只说"标签不存在"的话，用户看到的是"报错 + 表格里还有它"，会以为删除失败再点一次
    expect(warning.mock.calls.some(c => String(c[0]).includes('列表已刷新'))).toBe(true)
    // 并且真的又拉了一次列表
    expect(fetchMock.mock.calls.filter(c => pathOf(c[0]) === '/admin/tag/list').length).toBeGreaterThan(1)
    vi.restoreAllMocks()
  })

  // ---------------------------------------------------------------
  // 六、分类：这一组原来在这里
  // ---------------------------------------------------------------
  //
  // 【为什么搬走了】上一批任务里分类页是**只读**的，所以"只读展示（一个写按钮都没有）"
  // 那两条断言放在这个文件里（两页共用同一份分类列表）。这一批分类已经做成可编辑，
  // 那两条断言的前提（不许有写按钮）正好反了过来 —— 与其在这里留一堆
  // "分类管理"的用例（这个文件已经 400 行），不如整组搬到
  // test/adminCategories.nuxt.spec.ts：一个文件守一个模块，改一个页面时能直接找到它的护栏。
  it('分类管理那一页的用例_should在 test/adminCategories.nuxt.spec.ts 里守着', async () => {
    // 这条留在这里只做一件事：告诉顺着 git blame 找到这个文件的人"用例搬去哪了"。
    // 【为什么菜单文字也一起改了】分类页从"只读展示"变成了"能增删改"，
    // 菜单名跟着从「分类」改成「分类管理」，与「标签管理」对称。
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()

    expect(wrapper.findAll('.side-nav a').map(a => a.text())).toContain('分类管理')
    expect(wrapper.findAll('.side-nav a').map(a => a.text())).not.toContain('分类')
  })
})
