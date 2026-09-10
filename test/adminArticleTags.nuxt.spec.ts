import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises, enableAutoUnmount } from '@vue/test-utils'
import AdminPage from '~/pages/admin.vue'
import ArticleEditDialog from '~/components/admin/ArticleEditDialog.vue'

// =====================================================================
// 后台「文章弹窗里的标签多选」组件测试
//
// 【为什么单独一个文件、而不是塞进 admin.nuxt.spec.ts】
//   那个文件守的是概览那四个数字的口径；这个文件守的是文章弹窗与标签的接线。
//   两件事各自需要不同的假后端（这里要有标签、要有带 tags 的文章），
//   混在一个文件里会让"某个接口该返回什么"变成两份用途打架的配置。
//
// 【这一组守的是什么】
//   标签是【覆盖式】语义：后端不认"没传这个字段"，只认最终收到的那串 id。
//   前端的错法全都安静得看不出来：
//     · 打开编辑时没回显 → 用户以为这篇没标签 → 一保存把标签全清了
//     · 打开编辑时用的是列表里那份【旧】的 tags → 别人刚改过的标签被覆盖回去
//     · 一个都不选时不传 tagIds → 后端也是清空，但日志里分不清
//       "用户清空了标签"和"前端忘了传"（后者是 bug，两者长得一模一样）
//   所以这里连"发出去的请求体长什么样"一起钉住。
//
// 【怎么点 el-select 的多选】走真实 DOM：点开下拉框 → 在【属于标签那一个】的
//   下拉面板里点选项。Element Plus 的选项是 teleport 到 body 的，
//   而页面上有 5 个下拉框，所以必须按内容认出标签那一个
//   （见 tagDropdown 的注释），否则点到的是别的下拉框的选项 ——
//   那种测试会"通过"，但什么都没验证。
// =====================================================================

const { fetchMock, tokenRef } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  tokenRef: { value: 'fake-token' },
}))
mockNuxtImport('$fetch', () => fetchMock)
mockNuxtImport('useCookie', () => () => tokenRef)

// 每个用例都卸载：页面上有 5 个 teleport 到 body 的下拉面板，
// 不卸载的话下一个用例可能点开上一轮残留的那个（它的选项还是旧数据）
enableAutoUnmount(afterEach)

const body = (data) => ({ code: 200, message: '成功', data })
const pathOf = (url) => String(url).split('?')[0]

/** 后端 GET /admin/tag/list 的真实形状（articleCount = 该标签下【已发布】文章数） */
const TAGS = [
  { id: 7, name: 'Vue', sort: 1, articleCount: 2 },
  { id: 8, name: '部署', sort: 2, articleCount: 0 },
]

/** 列表里的一篇文章：列表项也带 tags（后端列表接口会给） */
const LIST_ARTICLE = {
  id: 12, title: '一篇带标签的文章', summary: '摘要', categoryId: 1, categoryName: '技术',
  status: 1, isTop: 0, viewCount: 3, createTime: '2026-09-10T10:00:00',
  updateTime: '2026-09-10T11:00:00',
  tags: [{ id: 7, name: 'Vue', sort: 1, articleCount: null }],
}

/** 详情接口返回的 tags —— 刻意和列表【不一样】，用来证明回显以详情为准 */
const DETAIL_TAGS = [
  { id: 7, name: 'Vue', sort: 1, articleCount: null },
  { id: 8, name: '部署', sort: 2, articleCount: null },
]

const mockBackend = (overrides = {}) => {
  fetchMock.mockImplementation((url) => {
    const path = pathOf(url)
    if (path in overrides) return Promise.resolve(overrides[path])
    if (path === '/article/stats') return Promise.resolve(body({ articleCount: 1, viewCount: 3, categoryCount: 1 }))
    if (path === '/auth/me') return Promise.resolve(body({ id: 1, username: 'admin', role: 'ADMIN' }))
    if (path === '/user/page') return Promise.resolve(body({ records: [], total: 0 }))
    if (path === '/category/list') return Promise.resolve(body([{ id: 1, name: '技术' }]))
    if (path === '/admin/tag/list') return Promise.resolve(body(TAGS))
    if (path === '/admin/article/page') return Promise.resolve(body({ records: [LIST_ARTICLE], total: 1 }))
    if (path === '/admin/article/12') return Promise.resolve(body({ ...LIST_ARTICLE, content: '# 正文', tags: DETAIL_TAGS }))
    return Promise.resolve(body(null))
  })
}

/** 切到「文章管理」菜单（默认停在用户管理） */
const gotoArticles = async (wrapper) => {
  await wrapper.findAll('.side-nav a')[1].trigger('click')
  await flushPromises()
}

/** 弹窗里的表单行（按左边的标签文字找，比记下标稳） */
const formRow = (wrapper, label) =>
  wrapper.findAll('.af-row').find(r => r.find('.ed-label').text() === label)

/**
 * 在「标签」那一行选一个标签（真实交互：点开下拉 → 点选项）。
 *
 * 【为什么要按内容认出"标签那一个"下拉面板】
 *   页面上有 5 个 el-select（用户筛选 2 个、文章筛选 2 个、弹窗里的分类与标签），
 *   Element Plus 会把每个下拉面板都 teleport 到 body 并留在那里，
 *   所以 `document.querySelectorAll('.el-select-dropdown__item')[0]` 拿到的
 *   极可能属于别的下拉框 —— 点下去什么都不会发生，而测试却"绿"了。
 *   这里直接用标签名认出含 'Vue'/'部署' 的那一个面板，只点它里面的选项。
 */
const pickTag = async (wrapper, name) => {
  await formRow(wrapper, '标签').find('.el-select__wrapper').trigger('click')
  await flushPromises()

  const dropdown = [...document.querySelectorAll('.el-select-dropdown')]
    .find(d => d.textContent.includes(name))
  const item = [...dropdown.querySelectorAll('.el-select-dropdown__item')]
    .find(i => i.textContent.trim() === name)

  item.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await flushPromises()
}

/** 点弹窗底部的「保存」按钮 */
const clickSave = async (wrapper) => {
  const saveBtn = wrapper.findAll('.art-edit-modal .el-button').find(b => b.text().includes('保存'))
  await saveBtn.trigger('click')
  await flushPromises()
}

/**
 * 文章弹窗里当前选中的标签 id（表单状态）。
 *
 * 【w7.4 拆组件之后这里的定位方式变了，断言的内容没变】
 *   拆分之前 `artForm` 是 admin.vue 自己的变量，一句 `artFormTags(wrapper)` 就够；
 *   拆完之后它属于 ArticleEditDialog 那个组件（弹窗自己扛着整张表单的状态），
 *   所以要先找到那个组件、再读它自己的表单。
 *   这是"够不着了换个定位方式"，不是把断言放宽：
 *   比的还是"哪几个标签被选中"，同样的用例在拆分前会红、拆分后照样会红。
 */
const artFormTags = (wrapper) => wrapper.findComponent(ArticleEditDialog).vm.form.tagIds

/** 最近一次文章提交（POST 新建 / PUT 编辑）带上去的请求体 */
const lastArticleBody = () => {
  const call = [...fetchMock.mock.calls]
    .reverse()
    .find(c => ['/admin/article', '/admin/article/12'].includes(pathOf(c[0])) && c[1]?.body)
  return call?.[1]?.body
}

describe('后台 · 文章弹窗的标签多选', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    mockBackend()
  })

  it('标签选项_should来自后台的 /admin/tag/list（不走缓存，刚建的标签立刻能选到）', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()

    expect(fetchMock.mock.calls.filter(c => pathOf(c[0]) === '/admin/tag/list').length).toBe(1)

    await gotoArticles(wrapper)
    const editBtn = wrapper.findAll('.el-table__row .el-button').find(b => b.text() === '编辑')
    await editBtn.trigger('click')
    await flushPromises()

    const options = [...document.querySelectorAll('.el-select-dropdown')]
      .find(d => d.textContent.includes('Vue'))
    expect(options).toBeTruthy()
    expect([...options.querySelectorAll('.el-select-dropdown__item')].map(i => i.textContent.trim()))
      .toEqual(['Vue', '部署'])
  })

  it('新建文章_should标签是空的（不能带着上一篇的标签）', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoArticles(wrapper)

    // 先编辑一篇（把它那一个标签带进表单），再新建 —— 不清空的话新文章会莫名带上它
    await wrapper.findAll('.el-table__row .el-button').find(b => b.text() === '编辑').trigger('click')
    await flushPromises()
    expect(artFormTags(wrapper)).toEqual([7, 8])

    await wrapper.findAll('.toolbar .el-button').find(b => b.text().includes('新建文章')).trigger('click')
    await flushPromises()

    expect(artFormTags(wrapper)).toEqual([])
  })

  it('编辑一篇文章_should用详情里的 tags 回显选中的标签', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoArticles(wrapper)

    await wrapper.findAll('.el-table__row .el-button').find(b => b.text() === '编辑').trigger('click')
    await flushPromises()

    // 列表里这篇只有 Vue，详情里是 Vue + 部署 —— 回显必须【以详情为准】，
    // 因为列表那一份可能是几分钟前拉的（别人刚改过标签时就会不一致）
    expect(artFormTags(wrapper)).toEqual([7, 8])
    expect(formRow(wrapper, '标签').text()).toContain('Vue')
  })

  it('编辑时列表与详情的标签不一致_should以详情为准（否则会把别人刚打的标签覆盖掉）', async () => {
    // 详情接口拿不到（挂了）：这时退回用列表里的那一份回显，
    // 而不是把标签显示成"一个都没选"—— 后者会让用户一保存就清掉全部标签
    mockBackend({ '/admin/article/12': { code: 500, message: '服务器开小差了' } })

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoArticles(wrapper)

    await wrapper.findAll('.el-table__row .el-button').find(b => b.text() === '编辑').trigger('click')
    await flushPromises()

    expect(artFormTags(wrapper)).toEqual([7])
  })

  it('选了标签再保存_should把选中的 id 数组作为 tagIds 发出去', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoArticles(wrapper)

    await wrapper.findAll('.el-table__row .el-button').find(b => b.text() === '编辑').trigger('click')
    await flushPromises()

    await pickTag(wrapper, '部署')      // 详情回显的是 [7,8]，点它 = 取消
    expect(artFormTags(wrapper)).toEqual([7])

    await clickSave(wrapper)

    expect(lastArticleBody().tagIds).toEqual([7])
    // 编辑走 PUT（幂等，不带幂等键）
    const call = fetchMock.mock.calls.find(c => pathOf(c[0]) === '/admin/article/12' && c[1]?.method === 'PUT')
    expect(call).toBeTruthy()
  })

  it('一个标签都不选就保存_should【显式】提交空数组，而不是不传这个字段', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoArticles(wrapper)

    await wrapper.findAll('.el-table__row .el-button').find(b => b.text() === '编辑').trigger('click')
    await flushPromises()

    // 把两个标签都点掉（回显是 [7,8]，各点一次即取消）
    await pickTag(wrapper, 'Vue')
    await pickTag(wrapper, '部署')
    expect(artFormTags(wrapper)).toEqual([])

    await clickSave(wrapper)

    const body = lastArticleBody()
    // 后端对"不传字段"和"传空数组"都是清空，两者等价；
    // 但显式传空数组把"我就是要清空"写进了请求体 ——
    // 看日志的人才能分辨"用户清空了标签"和"前端忘了传这个字段"（后者是 bug）
    expect(body.tagIds).toEqual([])
    expect(Object.keys(body)).toContain('tagIds')
  })

  it('标签接口失败_should下拉框为空，但弹窗与保存照常（标签挂了不该拦住写文章）', async () => {
    mockBackend({ '/admin/tag/list': { code: 500, message: '服务器开小差了' } })

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoArticles(wrapper)

    await wrapper.findAll('.el-table__row .el-button').find(b => b.text() === '编辑').trigger('click')
    await flushPromises()

    expect(wrapper.vm.tags).toEqual([])
    // 详情里仍然有 tags，所以回显还在（选项为空只是"选不到别的标签"）
    expect(artFormTags(wrapper)).toEqual([7, 8])
    expect(wrapper.find('.art-edit-modal').exists()).toBe(true)
  })
})
