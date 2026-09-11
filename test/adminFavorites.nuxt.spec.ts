import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { ElMessage, ElMessageBox } from 'element-plus'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import AdminPage from '~/pages/admin.vue'
import FavoritesPanel from '~/components/admin/FavoritesPanel.vue'

// =====================================================================
// 后台「收藏管理」的组件测试
//
// 【这一组守的是什么】
//   收藏是四个后台内容页里"字段最多、校验最容易写错"的一个（标题 + 地址 + 备注
//   + 分组 + 排序 + 状态），它的坑几乎全在"看起来成功了"这一侧：
//     · 建完不刷新列表 → 用户以为没保存成功，于是再点一次（后端会再建一条）
//     · 地址不合法时只弹一个 toast → 三秒后消失，用户还在看弹窗，不知道该怎么办
//     · 二次确认点了"取消"，删除请求照样发出去 → 确认框形同虚设
//     · 删一条已经被别人删掉的（404）时不刷新列表 → 用户对着一句报错
//       和"表格里还列着它"再点一次
//     · 提交前不 trim → 请求体与日志里都是脏数据，而且 maxlength 会因为空格
//       提前截断一个本来合法的标题
//   所以下面既有"调了哪个接口、请求体是什么"，也有"界面上留下了什么"。
//
// 【怎么断言"发出去的请求"】$fetch 换成按 URL 分发的假实现，
//   然后从 mock 的调用记录里读 method / body。断言请求体比断言"函数被调用了"
//   更有意义 —— 它同时钉住了字段名（body.title 而不是 body.name）。
//
// 【jsdom 不做布局】所以"按钮排一行不折行"这条**量不出排版**，
//   这里只能钉住那个结构性的保证（.fp-acts 上的 flex-wrap: nowrap），
//   见最后一条用例；真实观感要靠人眼在浏览器里看。
// =====================================================================

const { fetchMock, tokenRef } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  tokenRef: { value: 'fake-token' },
}))
mockNuxtImport('$fetch', () => fetchMock)
mockNuxtImport('useCookie', () => () => tokenRef)

// 弹层（下拉框的面板、确认框）会 teleport 到 body 并留在那里；
// 每个用例结束都卸载，免得上一个用例的残留影响下一个（其它后台用例同款处理）
enableAutoUnmount(afterEach)

const body = (data) => ({ code: 200, message: '成功', data })
const pathOf = (url) => String(url).split('?')[0]

/**
 * 后端 GET /admin/favorite/list 的真实形状（含**隐藏**的那些 —— 后台列表
 * 与前台的区别就在这里，它不走缓存：管理员刚点完"隐藏"就要看到效果）。
 */
const FAVORITES = [
  { id: 3, title: '联调收藏A', url: 'https://a.example/1', description: '备注A', category: '工具', sort: 1, status: 1, createTime: '2026-09-10T05:03:19' },
  { id: 4, title: '联调收藏B', url: 'https://b.example/2', description: null, category: null, sort: 2, status: 0, createTime: null },
]

/** 假后端：除了收藏接口，还要把后台页挂载时那几个请求喂饱（否则页面上会有报错） */
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
  if (path === '/admin/favorite/list') return body(FAVORITES)
  if (path === '/article/stats') return body({ articleCount: 2, viewCount: 28, categoryCount: 3 })
  if (path === '/auth/me') return body({ id: 1, username: 'admin', role: 'ADMIN' })
  if (path === '/user/page') return body({ records: [], total: 7 })
  if (path === '/category/list') return body([{ id: 1, name: '技术笔记', sort: 1 }])
  if (path === '/admin/tag/list') return body([])
  if (path === '/admin/article/page') return body({ records: [], total: 0 })
  if (path === '/admin/comment/page') return body({ records: [], total: 0 })
  return body(null)
}

/** 假后端：除了收藏接口，还要把后台页挂载时那几个请求喂饱（否则页面上会有报错） */
const mockBackend = (overrides = {}) => {
  fetchMock.mockImplementation((url) => {
    const path = pathOf(url)
    if (path in overrides) return Promise.resolve(overrides[path])
    return Promise.resolve(defaultResponse(path))
  })
}

/** 切到「收藏管理」菜单（默认停在用户管理，菜单顺序见 admin.vue 的 menus） */
const gotoFavorites = async (wrapper) => {
  const item = wrapper.findAll('.side-nav a').find(a => a.text() === '收藏管理')
  await item.trigger('click')
  await flushPromises()
}

/** 表格里当前渲染出来的标题（第一列是 ID，标题在第二列） */
const rowTitles = (wrapper) => wrapper.findAll('.panel .el-table__row').map(r => r.findAll('td')[1].text())

/** 某次请求的调用记录（找不到就是 undefined） */
const callTo = (method, path) =>
  fetchMock.mock.calls.find(c => pathOf(c[0]) === path && c[1]?.method === method)

/** 点弹窗里的「保存」 */
const clickSave = async (wrapper) => {
  const save = wrapper.findAll('.el-dialog .el-button').find(b => b.text().includes('保存'))
  await save.trigger('click')
  await flushPromises()
}

/** 点工具条上的「+ 新建收藏」 */
const clickCreate = async (wrapper) => {
  const btn = wrapper.findAll('.toolbar .el-button').find(b => b.text().includes('新建收藏'))
  await btn.trigger('click')
  await flushPromises()
}

/** 输入框按 placeholder 定位：比"第几个 input"稳（弹窗里还有下拉框与数字控件） */
const inputByPlaceholder = (wrapper, placeholder) =>
  wrapper.find(`.el-dialog input[placeholder="${placeholder}"]`)

const TITLE_PH = '比如：MySQL 索引原理图解'
const URL_PH = 'https://example.com/post/1'

describe('后台 · 收藏管理', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    mockBackend()
  })

  // ---------------------------------------------------------------
  // 一、列表
  // ---------------------------------------------------------------

  it('切到菜单才拉列表（默认菜单是用户管理）_should不多打一次请求', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()

    // 【为什么这条值得测】面板在 v-if 链里，只有被切到才会挂载、才会 onMounted 拉数据。
    // 如果哪天有人把列表请求提到 admin.vue 的 onMounted 里，进后台就会白打这一次接口
    expect(fetchMock.mock.calls.filter(c => pathOf(c[0]) === '/admin/favorite/list')).toHaveLength(0)

    await gotoFavorites(wrapper)

    expect(fetchMock.mock.calls.filter(c => pathOf(c[0]) === '/admin/favorite/list')).toHaveLength(1)
  })

  it('列表_should显示标题、分组、状态与时间（含隐藏的那些）', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoFavorites(wrapper)

    expect(rowTitles(wrapper)).toEqual(['联调收藏A', '联调收藏B'])
    const first = wrapper.findAll('.panel .el-table__row')[0].findAll('td')
    expect(first[3].text()).toBe('工具')          // 分组
    expect(first[4].text()).toBe('1')             // 排序
    expect(first[5].text()).toBe('显示')          // 状态
    // 【后台列表必须含隐藏的】第二条 status = 0，它在前台看不到，
    // 但后台要能看见并改回来（这就是"后台列表不走缓存"的原因）
    expect(wrapper.findAll('.panel .el-table__row')[1].findAll('td')[5].text()).toBe('隐藏')
  })

  it('分组为 null_should显示「—」而不是留一格空白', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoFavorites(wrapper)

    expect(wrapper.findAll('.panel .el-table__row')[1].findAll('td')[3].text()).toBe('—')
  })

  it('列表接口失败_should列表为空但页面其余部分照常（不把后台带崩）', async () => {
    mockBackend({ '/admin/favorite/list': { code: 500, message: '服务器开小差了' } })

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoFavorites(wrapper)

    expect(wrapper.findAll('.panel .el-table__row').length).toBe(0)
    expect(wrapper.text()).toContain('还没有收藏')
    // 菜单与标题都还在
    expect(wrapper.find('.top h1').text()).toBe('收藏管理')
  })

  it('列表接口返回了非数组_should当成空列表，而不是把渲染打挂', async () => {
    // 后端把列表改成分页结构（{records:[]}）时，直接 v-for 会崩
    mockBackend({ '/admin/favorite/list': body({ records: FAVORITES }) })

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoFavorites(wrapper)

    expect(wrapper.findAll('.panel .el-table__row').length).toBe(0)
  })

  // ---------------------------------------------------------------
  // 二、新建
  // ---------------------------------------------------------------

  it('新建收藏_should POST /admin/favorite，成功后重新拉列表', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoFavorites(wrapper)

    // 建完之后后端多返回一条：证明"列表真的重新拉了一次"（而不是本地塞了一条）
    fetchMock.mockImplementation((url, options) => {
      const path = pathOf(url)
      if (path === '/admin/favorite' && options?.method === 'POST') return Promise.resolve(body(9))
      if (path === '/admin/favorite/list') {
        return Promise.resolve(body([...FAVORITES, { id: 9, title: '新收藏', url: 'https://new.example/1', description: null, category: '工具', sort: 0, status: 1 }]))
      }
      // 其余路径委托给标准假后端（见 defaultResponse 的注释：
      // 随手返回 body(null) 会让后台页挂载时的请求读到 null.data 而抛异常）
      return Promise.resolve(defaultResponse(path))
    })

    await clickCreate(wrapper)
    await inputByPlaceholder(wrapper, TITLE_PH).setValue('新收藏')
    await inputByPlaceholder(wrapper, URL_PH).setValue('https://new.example/1')
    await clickSave(wrapper)

    const post = callTo('POST', '/admin/favorite')
    expect(post).toBeTruthy()
    // 字段名必须是后端 FavoriteForm 的那几个（title / url / description / category / sort / status）——
    // 写错一个，后端拿不到值却不会报错，只会把那一栏存成空
    expect(post[1].body).toEqual({
      title: '新收藏',
      url: 'https://new.example/1',
      description: '',
      category: '',
      sort: 0,
      status: 1,
    })
    // 列表刷新过：新收藏已经在表格里
    expect(rowTitles(wrapper)).toContain('新收藏')
  })

  it('标题前后带空格_should trim 之后再提交', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoFavorites(wrapper)

    await clickCreate(wrapper)
    await inputByPlaceholder(wrapper, TITLE_PH).setValue('  收藏标题  ')
    await inputByPlaceholder(wrapper, URL_PH).setValue('  https://a.example/9  ')
    await clickSave(wrapper)

    // 不 trim 的表现：请求体里带着空格（后端 Service 也会 trim，所以不算"错"，
    // 但日志与请求体里是脏数据，而且 maxlength 会因为空格提前截断一个合法标题）
    expect(callTo('POST', '/admin/favorite')[1].body.title).toBe('收藏标题')
    expect(callTo('POST', '/admin/favorite')[1].body.url).toBe('https://a.example/9')
  })

  it('标题为空_should前端就拦下来，一个请求都不发', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoFavorites(wrapper)

    await clickCreate(wrapper)
    await inputByPlaceholder(wrapper, TITLE_PH).setValue('   ')
    await clickSave(wrapper)

    expect(callTo('POST', '/admin/favorite')).toBeUndefined()
    expect(wrapper.find('.ed-error').text()).toContain('标题不能为空')
    // 弹窗还开着，用户可以直接补内容。
    // 【为什么断言 editVisible 而不是 `.el-dialog` 存不存在】Element Plus 关闭弹窗时
    // **不会把 DOM 删掉**（只是把外层遮罩 display:none），所以 `.exists()` 在开关两种
    // 状态下都是 true —— 那是一条永远为真的假绿断言（既有的标签管理用例里就是这样写的，
    // 这里不再复制那个写法）。
    expect(wrapper.findComponent(FavoritesPanel).vm.editVisible).toBe(true)
  })

  it('地址不是 http(s)_should前端拦下来并给出与后端一致的那句提示', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoFavorites(wrapper)

    await clickCreate(wrapper)
    await inputByPlaceholder(wrapper, TITLE_PH).setValue('一个收藏')
    await inputByPlaceholder(wrapper, URL_PH).setValue('ftp://a.example/1')
    await clickSave(wrapper)

    // 后端 UrlPatterns 是白名单（只放行 http(s)），前端拦一道省一次必然失败的往返。
    // 文案与后端一字不差，用户看不出是哪一道拦的
    expect(callTo('POST', '/admin/favorite')).toBeUndefined()
    expect(wrapper.find('.ed-error').text()).toContain('必须以 http:// 或 https:// 开头')
  })

  it('标题超过 100 字_should前端拦下来（上限来自后端 FavoriteForm 的 @Size(max=100)）', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoFavorites(wrapper)

    await clickCreate(wrapper)
    // 100 个字符刚好合法，101 个必须被拦 —— 上限写错的后果是"界面允许、保存却被拒"，
    // 所以这条用例把边界卡在 101
    await inputByPlaceholder(wrapper, TITLE_PH).setValue('标'.repeat(101))
    await inputByPlaceholder(wrapper, URL_PH).setValue('https://a.example/1')
    await clickSave(wrapper)

    expect(callTo('POST', '/admin/favorite')).toBeUndefined()
    expect(wrapper.find('.ed-error').text()).toContain('标题最长 100 字')
  })

  it('分组建议_should来自当前列表里的 distinct 分组名（不用额外接口）', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoFavorites(wrapper)

    await clickCreate(wrapper)

    // 后端 FavoriteVO 的注释写明了：分组下拉建议直接从这份列表里取 distinct 值。
    // 列表里只有第一条带分组（"工具"），第二条是 null —— 所以建议里只该有一项
    const panel = wrapper.findComponent(FavoritesPanel)
    expect(panel.vm.categoryOptions).toEqual(['工具'])
  })

  // ---------------------------------------------------------------
  // 三、保存失败：后端原话留在弹窗里，且弹窗不关
  // ---------------------------------------------------------------

  it('保存失败_should把后端那句话显示在弹窗里，并且不关闭弹窗', async () => {
    mockBackend({ '/admin/favorite': { code: 400, message: '地址最长 255 字' } })

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoFavorites(wrapper)

    await clickCreate(wrapper)
    await inputByPlaceholder(wrapper, TITLE_PH).setValue('一个收藏')
    await inputByPlaceholder(wrapper, URL_PH).setValue('https://a.example/1')
    await clickSave(wrapper)

    // 【为什么断言"弹窗里"而不是只断言弹了提示】toast 三秒后消失，
    // 而用户此刻正看着这个弹窗、准备改一改再点一次保存
    expect(wrapper.findComponent(FavoritesPanel).vm.editVisible).toBe(true)
    expect(wrapper.find('.ed-error').text()).toContain('地址最长 255 字')
  })

  it('后端没给原因时_should用一句兜底文案，而不是显示一个空白的错误条', async () => {
    mockBackend({ '/admin/favorite': { code: 400 } })

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoFavorites(wrapper)

    await clickCreate(wrapper)
    await inputByPlaceholder(wrapper, TITLE_PH).setValue('一个收藏')
    await inputByPlaceholder(wrapper, URL_PH).setValue('https://a.example/1')
    await clickSave(wrapper)

    expect(wrapper.find('.ed-error').text()).toBe('保存失败，请稍后再试')
  })

  // ---------------------------------------------------------------
  // 四、编辑
  // ---------------------------------------------------------------

  it('编辑_should用 PUT /admin/favorite/{id}，并把当前值回显进弹窗', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoFavorites(wrapper)

    await wrapper.findAll('.panel .el-table__row')[0].findAll('.el-button')
      .find(b => b.text() === '编辑').trigger('click')
    await flushPromises()

    expect(inputByPlaceholder(wrapper, TITLE_PH).element.value).toBe('联调收藏A')

    await inputByPlaceholder(wrapper, TITLE_PH).setValue('联调收藏A改')
    await clickSave(wrapper)

    const put = callTo('PUT', '/admin/favorite/3')
    expect(put).toBeTruthy()
    expect(put[1].body.title).toBe('联调收藏A改')
    // 编辑时 id 不上送（路径里已经有了），也不该变成 POST
    expect(callTo('POST', '/admin/favorite')).toBeUndefined()
  })

  it('分组为 null 的收藏_should回显成空（保存时不会被悄悄写成"null"这个字面量）', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoFavorites(wrapper)

    await wrapper.findAll('.panel .el-table__row')[1].findAll('.el-button')
      .find(b => b.text() === '编辑').trigger('click')
    await flushPromises()

    expect(wrapper.findComponent(FavoritesPanel).vm.form.category).toBe('')
    await clickSave(wrapper)

    expect(callTo('PUT', '/admin/favorite/4')[1].body.category).toBe('')
  })

  // ---------------------------------------------------------------
  // 五、删除：二次确认 + 404 自愈
  // ---------------------------------------------------------------

  it('删除_should先弹二次确认，并说清影响', async () => {
    const confirmSpy = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm')

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoFavorites(wrapper)

    await wrapper.findAll('.panel .el-table__row')[0].findAll('.el-button')
      .find(b => b.text() === '删除').trigger('click')
    await flushPromises()

    expect(confirmSpy).toHaveBeenCalledTimes(1)
    const tip = confirmSpy.mock.calls[0][0]
    // 提示里要带上这一条的标题，用户才知道自己点的是哪一行
    expect(tip).toContain('联调收藏A')
    // 后端是逻辑删除（行还在库里），但界面上没有恢复入口，所以要说"无法恢复"
    expect(tip).toContain('无法恢复')

    expect(callTo('DELETE', '/admin/favorite/3')).toBeTruthy()
    confirmSpy.mockRestore()
  })

  it('二次确认里点取消_should一个请求都不发', async () => {
    const confirmSpy = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue(new Error('cancel'))

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoFavorites(wrapper)

    await wrapper.findAll('.panel .el-table__row')[0].findAll('.el-button')
      .find(b => b.text() === '删除').trigger('click')
    await flushPromises()

    // ElMessageBox.confirm 取消时是 reject：不 try/catch 之后 return 的话，
    // 用户点了取消，删除请求照样发出去（确认框形同虚设）
    expect(callTo('DELETE', '/admin/favorite/3')).toBeUndefined()
    confirmSpy.mockRestore()
  })

  it('删除成功后_should刷新列表（那条从表格里消失）', async () => {
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm')

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoFavorites(wrapper)
    expect(rowTitles(wrapper)).toEqual(['联调收藏A', '联调收藏B'])

    fetchMock.mockImplementation((url, options) => {
      const path = pathOf(url)
      if (path === '/admin/favorite/3' && options?.method === 'DELETE') return Promise.resolve(body(null))
      if (path === '/admin/favorite/list') return Promise.resolve(body([FAVORITES[1]]))
      // 其余路径委托给标准假后端（理由见 defaultResponse 的注释）
      return Promise.resolve(defaultResponse(path))
    })

    await wrapper.findAll('.panel .el-table__row')[0].findAll('.el-button')
      .find(b => b.text() === '删除').trigger('click')
    await flushPromises()

    expect(rowTitles(wrapper)).toEqual(['联调收藏B'])
    vi.restoreAllMocks()
  })

  it('删一条已经被别人删掉的收藏（404）_should自愈：提示一句 + 真的重拉列表', async () => {
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm')
    const warning = vi.spyOn(ElMessage, 'warning').mockImplementation(() => {})

    mockBackend({ '/admin/favorite/3': { code: 404, message: '收藏不存在' } })

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoFavorites(wrapper)

    const before = fetchMock.mock.calls.filter(c => pathOf(c[0]) === '/admin/favorite/list').length

    await wrapper.findAll('.panel .el-table__row')[0].findAll('.el-button')
      .find(b => b.text() === '删除').trigger('click')
    await flushPromises()

    // 只说"收藏不存在"的话，用户看到的是"一句报错 + 表格里还列着它"，
    // 会以为删除失败再点一次 —— 所以必须说清"列表已刷新"，并且真的刷
    expect(warning.mock.calls.some(c => String(c[0]).includes('列表已刷新'))).toBe(true)
    const after = fetchMock.mock.calls.filter(c => pathOf(c[0]) === '/admin/favorite/list').length
    expect(after).toBeGreaterThan(before)
    vi.restoreAllMocks()
  })

  it('编辑一条已经被别人删掉的收藏（404）_should提示 + 关掉弹窗 + 重拉列表', async () => {
    const warning = vi.spyOn(ElMessage, 'warning').mockImplementation(() => {})
    mockBackend({ '/admin/favorite/3': { code: 404, message: '收藏不存在' } })

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoFavorites(wrapper)

    await wrapper.findAll('.panel .el-table__row')[0].findAll('.el-button')
      .find(b => b.text() === '编辑').trigger('click')
    await flushPromises()
    await clickSave(wrapper)

    // 【为什么弹窗必须关】用户正在编辑的那条记录已经不存在了，
    // 留着弹窗让他继续改、再点一次保存只会再撞一次 404
    expect(warning.mock.calls.some(c => String(c[0]).includes('列表已刷新'))).toBe(true)
    expect(wrapper.findComponent(FavoritesPanel).vm.editVisible).toBe(false)
    vi.restoreAllMocks()
  })

  // ---------------------------------------------------------------
  // 六、菜单与"按钮不折行"
  // ---------------------------------------------------------------

  it('菜单_should从七个变成十二个，并且后加的五项都叫「XX管理」', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()

    const labels = wrapper.findAll('.side-nav .nv-label').map(n => n.text())
    expect(labels).toEqual([
      '概览', '文章管理', '用户管理', '标签管理', '分类管理',
      '收藏管理', '项目管理', '友链管理', '关于管理', '音乐管理',
      '评论管理', '设置',
    ])
  })

  it('操作列的按钮_should有"永不折行"的结构性保证（jsdom 量不出排版，只能钉住这条样式）', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoFavorites(wrapper)

    // 【为什么只能这样测】jsdom 不做布局（没有真实宽度），所以"按钮有没有被挤到第二行"
    // 是量不出来的。能钉住的只有那个**结构性**的保证：操作列的容器是 flex + nowrap ——
    // 只要这一条在，无论文案怎么变、列宽多窄，按钮都不会折行（宽度不够时表格横向滚动）。
    expect(wrapper.find('.fp-acts').exists()).toBe(true)

    const src = readFileSync(join(process.cwd(), 'app/components/admin/FavoritesPanel.vue'), 'utf8')
    expect(src).toMatch(/\.fp-acts\s*\{[^}]*flex-wrap:\s*nowrap/)
  })
})
