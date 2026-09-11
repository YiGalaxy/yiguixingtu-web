import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { ElMessage, ElMessageBox } from 'element-plus'
// 【为什么这里要读源码文件】有一条断言必须看源码才成立 ——
//   "操作列不折行"这件事 jsdom 量不出来（它没有布局引擎，见那条用例里的说明），
//   所以只能守"结构上的约定"（flex + nowrap 与列宽下限）。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import AdminPage from '~/pages/admin.vue'

// =====================================================================
// 后台「评论管理」的组件测试
//
// 【这一组守的是什么】
//   这个页面是评论模块能不能真正跑起来的最后一环：评论默认【待审核】，
//   不点通过，前台永远看不到它 —— 前台那句"等待审核"就是靠这里兑现的。
//   所以它的错法都指向同一件事：**待办被漏掉或者假装处理了**。
//     · 默认筛选不是「待审核」→ 新评论淹没在已处理的评论里，站长每次都要手动筛
//     · 审核后不刷新 → 表格里还列着已经通过的，看起来像"点了没反应"
//     · 只刷新列表不刷新角标 → 菜单上的数字和实际待办对不上
//     · 审核接口传错参数（比如把 status 当成 body 传）→ 后端拿不到 status 直接 400
//     · 404（评论已被别人删掉）→ 只报一句"评论不存在"，用户对着报错再点一次，
//       而表格里那条其实早就不该在
//
// 【怎么断言"发出去的请求"】$fetch 换成按 URL 分发的假实现，
//   从调用记录里读 method 与 params —— 状态是通过【查询参数】传给后端的
//   （`PUT /admin/comment/{id}/status?status=1`），所以 params 必须断言。
// =====================================================================

const { fetchMock, tokenRef } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  tokenRef: { value: 'fake-token' },
}))
mockNuxtImport('$fetch', () => fetchMock)
mockNuxtImport('useCookie', () => () => tokenRef)

// 页面上有若干个 el-select，下拉面板会 teleport 到 body 并留在那里；
// 每个用例结束都卸载，免得上一个用例残留的节点影响下一个
enableAutoUnmount(afterEach)

const body = (data) => ({ code: 200, message: '成功', data })
const pathOf = (url) => String(url).split('?')[0]

/** 后端 AdminCommentVO 的真实形状（比前台多 articleTitle / email / ip） */
const PENDING = {
  id: 2, articleId: 117, articleTitle: '测试', nickname: '联调读者',
  email: 'reader@example.com', ip: '0:0:0:0:0:0:0:1',
  content: '联调用的一条评论', status: 0, createTime: '2026-09-10T17:22:21',
}
const APPROVED = {
  id: 1, articleId: 117, articleTitle: '测试', nickname: '老读者',
  email: 'old@example.com', ip: '127.0.0.1',
  content: '早就通过的一条', status: 1, createTime: '2026-09-10T09:00:00',
}

const mockBackend = (overrides = {}) => {
  fetchMock.mockImplementation((url, options) => {
    const path = pathOf(url)
    if (path in overrides) {
      const value = overrides[path]
      return Promise.resolve(typeof value === 'function' ? value(options) : value)
    }
    if (path === '/article/stats') return Promise.resolve(body({ articleCount: 1, viewCount: 3, categoryCount: 1 }))
    if (path === '/auth/me') return Promise.resolve(body({ id: 1, username: 'admin', role: 'ADMIN' }))
    if (path === '/user/page') return Promise.resolve(body({ records: [], total: 7 }))
    if (path === '/category/list') return Promise.resolve(body([]))
    if (path === '/admin/tag/list') return Promise.resolve(body([]))
    if (path === '/admin/article/page') return Promise.resolve(body({ records: [], total: 0 }))
    if (path === '/admin/comment/page') {
      // 待审核（含菜单角标那次 size=1 的查询）与已通过各给一条，够区分两边的行为
      const status = options?.params?.status
      if (status === 1) return Promise.resolve(body({ records: [APPROVED], total: 1 }))
      return Promise.resolve(body({ records: options?.params?.size === 1 ? [] : [PENDING], total: 1 }))
    }
    return Promise.resolve(body(null))
  })
}

/** 切到「评论管理」菜单（默认停在用户管理，菜单顺序见 admin.vue 的 menus） */
const gotoComments = async (wrapper) => {
  await wrapper.findAll('.side-nav a').find(a => a.text().includes('评论管理')).trigger('click')
  await flushPromises()
}

/** 表格里当前渲染出来的评论行 */
const rows = (wrapper) => wrapper.findAll('.panel .el-table__row')

/** 某行里某个按钮（通过 / 拒绝 / 更多） */
const buttonIn = (row, label) => row.findAll('.el-button').find(b => b.text() === label)

/**
 * 打开某行的「更多」菜单（不可逆的「删除」在里面）。
 *
 * 【为什么要真实点开，而不是直接调组件的方法】和改状态筛选是同一个理由（见 pickStatus）：
 *   真正容易接错的是那根线 —— 菜单有没有绑在这一行上、点了之后有没有走到 removeComment。
 * 【为什么要用 startsWith 而不是全等】触发按钮里还有一个箭头 `<span class="caret">▾</span>`，
 *   它的 text() 是「更多▾」，全等匹配会找不到。
 */
const openMoreMenu = async (row) => {
  await row.findAll('.el-button').find(b => b.text().startsWith('更多')).trigger('click')
  await flushPromises()
}

/**
 * 点「更多」菜单里的一项。
 *
 * 【为什么要按文字找、并断言"正好一项"】
 *   Element Plus 把下拉菜单 teleport 到 body，它不在行里、也不在表格里，只能去 document 找。
 *   断言"正好一项"是有意义的：菜单是**每个下拉各自一份**的，如果哪天出现两份，
 *   说明有组件卸载后没被回收 —— 那时用户点到的可能是上一个页面残留的那一份，
 *   它的处理函数早已失效，表现是"点了没反应"。
 *
 * 【为什么不断言"菜单是可见的"（第一版就是那么写的，然后红了）】
 *   第一版按 `popper.style.display !== 'none'` 过滤，单独跑这一条时能过，
 *   放在整个文件里跑却是 0 个可见项 —— 因为 Element Plus 维护着一份**全局的 popper 状态**，
 *   同一个文件里前面的用例开过 el-select 的下拉，这份状态会漏到后面的用例，
 *   于是刚点开的菜单立刻被关掉（display:none），而菜单本身是在 DOM 里的。
 *   也就是说：**在 jsdom 里"popper 开没开"不是这个组件能决定的事**，
 *   拿它当断言条件只会得到一个随执行顺序变红的用例（比没有用例更糟）。
 *   所以这里只断言"菜单确实渲染出来了、且点它能走到同一个处理函数" ——
 *   jsdom 没有布局引擎，真正的"看起来对不对"只能靠人眼，已经写进 README 的上线核对清单。
 */
const clickMoreItem = async (label) => {
  const items = [...document.querySelectorAll('.el-dropdown-menu__item')]
    .filter(i => i.textContent.trim() === label)
  expect(items.length, `「${label}」菜单项应当正好一个（多份说明有组件没被回收）`).toBe(1)
  items[0].dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await flushPromises()
}

/**
 * 最近一次【列表查询】的参数。
 *
 * 【为什么要排掉 size=1 的那次调用 —— 这个坑值得记】
 *   菜单上的"待审核"角标走的是同一个接口（page=1&size=1&status=0），
 *   而它总是在列表查询【之后】发出。所以直接取"最后一次 /admin/comment/page 调用"
 *   拿到的其实是角标那次的参数（status 永远是 0），断言会到处对不上 ——
 *   而且看起来像"筛选没生效"，很容易往错的方向查。
 *   列表查询的 size 是页面大小（10），角标那次固定是 1，用它区分。
 */
const lastPageParams = () => {
  const calls = fetchMock.mock.calls.filter(
    c => pathOf(c[0]) === '/admin/comment/page' && c[1]?.params?.size !== 1,
  )
  return calls.at(-1)?.[1]?.params
}

/**
 * 改「状态」筛选（真实交互：点开下拉 → 点选项）。
 *
 * 【为什么不直接改组件内部状态】那样测的只是"改完值会不会发请求"，
 * 而真正常错的是**接线**：下拉框绑的是不是这个变量、change 有没有触发查询。
 * 【为什么要按标签文字认出那一个下拉面板】Element Plus 把每个 el-select 的
 * 下拉面板都 teleport 到 body 并留在那里，页面上不止一个 el-select ——
 * 直接取第一个面板里的选项，点到的可能是别人的选项，测试还会"绿"。
 */
const pickStatus = async (wrapper, label) => {
  await wrapper.find('.toolbar .el-select__wrapper').trigger('click')
  await flushPromises()

  const dropdown = [...document.querySelectorAll('.el-select-dropdown')]
    .find(d => d.textContent.includes(label))
  const item = [...dropdown.querySelectorAll('.el-select-dropdown__item')]
    .find(i => i.textContent.trim() === label)
  item.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await flushPromises()
}

/** 对 /admin/comment/page 请求过几次（用来判断"有没有刷新列表"） */
const pageCallCount = () => fetchMock.mock.calls.filter(c => pathOf(c[0]) === '/admin/comment/page').length

/** 某次请求的调用记录 */
const callTo = (method, path) =>
  fetchMock.mock.calls.find(c => pathOf(c[0]) === path && c[1]?.method === method)

describe('后台 · 评论管理', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    mockBackend()
  })

  // ---------------------------------------------------------------
  // 一、默认筛选与列表
  // ---------------------------------------------------------------

  it('默认_should按「待审核」筛选（这个页面的主要用途就是处理待办）', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoComments(wrapper)

    // 状态是通过查询参数传给后端的：status=0（不带这个参数就是不按状态过滤）
    expect(lastPageParams().status).toBe(0)
    expect(lastPageParams().page).toBe(1)
  })

  it('列表_should显示昵称、内容、文章标题、时间、邮箱与 IP（后两个只有后台接口才返回）', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoComments(wrapper)

    expect(rows(wrapper).length).toBe(1)
    const text = rows(wrapper)[0].text()
    expect(text).toContain('联调读者')
    expect(text).toContain('联调用的一条评论')
    expect(text).toContain('测试')                 // 文章标题
    expect(text).toContain('2026-09-10 17:22:21')  // 时间精确到秒
    expect(text).toContain('reader@example.com')
    expect(text).toContain('0:0:0:0:0:0:0:1')
    // 待审核的状态标出来，不然「全部」视图下分不清每行的状态
    expect(text).toContain('待审核')
  })

  it('评论内容_should按纯文本渲染（内容里的标签不会变成元素）', async () => {
    mockBackend({
      '/admin/comment/page': body({
        records: [{ ...PENDING, content: '<b>加粗</b>（后端本该转义，这里故意给个原生标签）' }],
        total: 1,
      }),
    })

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoComments(wrapper)

    // 后台也没有理由把评论当 HTML 解析：v-html 在这里同样是 XSS 入口
    expect(rows(wrapper)[0].find('.cm-cell b').exists()).toBe(false)
    expect(rows(wrapper)[0].find('.cm-cell').text()).toContain('<b>加粗</b>')
  })

  it('接口失败_should列表为空但页面照常（不把后台带崩）', async () => {
    mockBackend({ '/admin/comment/page': { code: 500, message: '服务器开小差了' } })

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoComments(wrapper)

    expect(rows(wrapper).length).toBe(0)
    expect(wrapper.text()).toContain('这个状态下还没有评论')
    // 菜单项数量：概览 / 文章 / 用户 / 标签 / 分类 / 收藏 / 项目 / 友链 / 关于 / 音乐 / 评论 / 设置
    // （F5 加了四个内容模块、后来又加了音乐，从 7 项变成 12 项）
    expect(wrapper.findAll('.side-nav .nv-label').length).toBe(12)
  })

  it('接口返回了非数组_should当成空列表，而不是把渲染打挂', async () => {
    mockBackend({ '/admin/comment/page': body({ records: null, total: 5 }) })

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoComments(wrapper)

    expect(rows(wrapper).length).toBe(0)
  })

  it('切到「已通过」_should带着 status=1 重新查询，并显示已通过的评论', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoComments(wrapper)

    await pickStatus(wrapper, '已通过')

    expect(lastPageParams().status).toBe(1)
    expect(rows(wrapper)[0].text()).toContain('老读者')
  })

  it('选「全部」_should【不发 status 参数】（发一个哨兵值会让后端去比不存在的状态）', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoComments(wrapper)

    await pickStatus(wrapper, '全部')

    expect(lastPageParams().status).toBeUndefined()
    expect(Object.keys(lastPageParams())).toContain('page')
    // 「全部」只用界面上的哨兵值表示，绝不能发 -1 给后端
    expect(lastPageParams().status).not.toBe(-1)
  })

  // ---------------------------------------------------------------
  // 二、审核：参数必须走对
  // ---------------------------------------------------------------

  it('点「通过」_should PUT /admin/comment/{id}/status?status=1，并刷新列表', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoComments(wrapper)

    const before = fetchMock.mock.calls.filter(c => pathOf(c[0]) === '/admin/comment/page').length

    await buttonIn(rows(wrapper)[0], '通过').trigger('click')
    await flushPromises()

    const put = callTo('PUT', '/admin/comment/2/status')
    expect(put).toBeTruthy()
    // 【状态是【查询参数】，不是请求体】后端签名是 @RequestParam Integer status；
    // 放到 body 里传的话后端收不到，直接 400 —— 这条断言就是钉这个的
    expect(put[1].params).toEqual({ status: 1 })
    expect(put[1].body).toBeUndefined()
    // 刷新过列表（表格里那条已经不在待审核里了）
    expect(fetchMock.mock.calls.filter(c => pathOf(c[0]) === '/admin/comment/page').length)
      .toBeGreaterThan(before)
  })

  it('点「拒绝」_should status=2（审核只有通过与拒绝两个结果，没有"退回待审核"）', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoComments(wrapper)

    await buttonIn(rows(wrapper)[0], '拒绝').trigger('click')
    await flushPromises()

    expect(callTo('PUT', '/admin/comment/2/status')[1].params).toEqual({ status: 2 })
  })

  it('已经是当前状态的那个按钮_should禁用（点它不会发生任何事，留着可点像"点了没生效"）', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoComments(wrapper)

    // 待审核这一行：「通过」「拒绝」都还能点
    const pending = rows(wrapper)[0]
    expect(buttonIn(pending, '通过').attributes('disabled')).toBeUndefined()
    expect(buttonIn(pending, '拒绝').attributes('disabled')).toBeUndefined()

    // 切到「已通过」：那一条的「通过」按钮应该已经禁用
    await pickStatus(wrapper, '已通过')

    expect(rows(wrapper)[0].text()).toContain('老读者')
    expect(buttonIn(rows(wrapper)[0], '通过').attributes('disabled')).toBeDefined()
    expect(buttonIn(rows(wrapper)[0], '拒绝').attributes('disabled')).toBeUndefined()
  })

  it('审核接口失败（400）_should列表照常，不把页面带崩', async () => {
    mockBackend({ '/admin/comment/2/status': { code: 400, message: '状态只能是 1(通过) 或 2(拒绝)' } })

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoComments(wrapper)

    await buttonIn(rows(wrapper)[0], '通过').trigger('click')
    await flushPromises()

    // 后端说得很具体（这句话本身就是它给的），页面必须还能继续用
    expect(rows(wrapper).length).toBe(1)
  })

  // ---------------------------------------------------------------
  // 三、待审核数量（菜单角标）
  // ---------------------------------------------------------------

  it('菜单角标_should显示待审核数量（进后台就看得见，不用点进菜单）', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()

    const badge = wrapper.findAll('.side-nav a').find(a => a.text().includes('评论管理')).find('.nv-badge')
    expect(badge.exists()).toBe(true)
    expect(badge.text()).toBe('1')
  })

  it('待审核为 0_should整个角标不渲染（摆一个 0 只是噪音）', async () => {
    mockBackend({
      '/admin/comment/page': body({ records: [], total: 0 }),
    })

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()

    expect(wrapper.find('.nv-badge').exists()).toBe(false)
  })

  it('在处理「已通过」时拒绝一条_should【重新查一次】待审核数（列表的 total 不代表待办数）', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoComments(wrapper)

    // 切到「已通过」
    await pickStatus(wrapper, '已通过')

    const before = pageCallCount()

    // 在「已通过」里拒绝它 → 列表总数不变，但待审核 +1，角标必须跟着变
    await buttonIn(rows(wrapper)[0], '拒绝').trigger('click')
    await flushPromises()

    // 一次刷列表 + 一次单独查待审核数
    expect(pageCallCount()).toBeGreaterThanOrEqual(before + 2)
    expect(wrapper.findAll('.side-nav a').find(a => a.text().includes('评论管理')).find('.nv-badge').text())
      .toBe('1')
  })

  // ---------------------------------------------------------------
  // 四、删除
  // ---------------------------------------------------------------

  it('操作列_should把动作排成一行不折行，且「删除」收进「更多」菜单里', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoComments(wrapper)

    const row = rows(wrapper)[0]
    const acts = row.find('.cm-acts')
    expect(acts.exists()).toBe(true)

    // 三个动作一个都不能少：通过 / 拒绝 在行内，删除在菜单里
    const labels = acts.findAll('.el-button').map(b => b.text())
    expect(labels.some(t => t === '通过')).toBe(true)
    expect(labels.some(t => t === '拒绝')).toBe(true)
    expect(labels.some(t => t.startsWith('更多'))).toBe(true)
    // 而且行内**不该**再有第四个按钮（删除已经搬进菜单；它要是回来了就会把这一列再挤爆）
    expect(labels.length).toBe(3)
    expect(labels).not.toContain('删除')

    // 删除确实在「更多」里（点开就能看到）
    await openMoreMenu(row)
    const items = [...document.querySelectorAll('.el-dropdown-menu__item')]
      .filter(i => i.textContent.trim() === '删除评论')
    expect(items.length).toBe(1)
    // 【为什么不在这里断言"菜单处于展开态"】Element Plus 的 popper 开关状态是全局的、
    //   会从同一个文件里前面的用例漏过来（详见 clickMoreItem 的注释）：
    //   单独跑能过、整文件跑就红。所以这里只断言"菜单渲染出来了"，
    //   点开它能不能用由下面三条删除用例来证明。

    /**
     * 【为什么这条断言要去看源码，而不是"看它有没有折行"】
     *   jsdom **没有布局引擎**（不算盒模型、不做排版），所以"按钮有没有折到第二行"
     *   在测试里根本量不出来 —— 这也正是"按钮堆"能长期存在的原因：
     *   它不报错、不影响任何行为，只有真人看页面才会发现。
     *   所以这里守的是**结构性的约定**：动作容器必须是 flex + `flex-wrap: nowrap`
     *   （而不是靠"把列宽调大"—— 那改一次文案就失效），并且列宽给够了。
     *   真正的观感仍然需要人眼确认，这一条只能保证"结构上不可能折"。
     */
    const src = readFileSync(join(process.cwd(), 'app/components/admin/CommentsPanel.vue'), 'utf8')
    expect(src).toMatch(/\.cm-acts\s*\{[^}]*flex-wrap:\s*nowrap/)
    const widthMatch = /label="操作"\s+width="(\d+)"/.exec(src)
    expect(widthMatch).not.toBeNull()
    // 两个小按钮（各约 48px）+ 8px 间距 + 「更多」（约 60px）+ 单元格左右内边距 24px ≈ 188，
    // 所以列宽不能低于 190 —— 176 正是原来放不下的那个值
    expect(Number(widthMatch[1])).toBeGreaterThanOrEqual(190)
  })

  it('删除_should先二次确认（并说清前台也看不到了），确认后发 DELETE', async () => {
    const confirmSpy = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm')

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoComments(wrapper)

    await openMoreMenu(rows(wrapper)[0])
    await clickMoreItem('删除评论')
    await flushPromises()

    expect(confirmSpy).toHaveBeenCalledTimes(1)
    const tip = confirmSpy.mock.calls[0][0]
    // 只说"删除评论"的话，管理员不一定知道前台也看不到了
    expect(tip).toContain('前台')
    expect(tip).toContain('无法恢复')

    expect(callTo('DELETE', '/admin/comment/2')).toBeTruthy()
    confirmSpy.mockRestore()
  })

  it('删除时点取消_should一个请求都不发', async () => {
    const confirmSpy = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue(new Error('cancel'))

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoComments(wrapper)

    await openMoreMenu(rows(wrapper)[0])
    await clickMoreItem('删除评论')
    await flushPromises()

    expect(callTo('DELETE', '/admin/comment/2')).toBeUndefined()
    confirmSpy.mockRestore()
  })

  it('删除成功后_should刷新列表（那条评论从表格里消失）', async () => {
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm')

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoComments(wrapper)
    expect(rows(wrapper).length).toBe(1)

    // 删掉之后后端就没有待审核的了
    mockBackend({ '/admin/comment/page': body({ records: [], total: 0 }) })

    await openMoreMenu(rows(wrapper)[0])
    await clickMoreItem('删除评论')
    await flushPromises()

    expect(rows(wrapper).length).toBe(0)
    vi.restoreAllMocks()
  })

  // ---------------------------------------------------------------
  // 五、404：能自愈
  // ---------------------------------------------------------------

  it('审核时撞上 404（已被别人删掉）_should提示"已经不在"并刷新列表', async () => {
    mockBackend({ '/admin/comment/2/status': { code: 404, message: '评论不存在' } })
    const warning = vi.spyOn(ElMessage, 'warning').mockImplementation(() => {})

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoComments(wrapper)

    const before = pageCallCount()
    await buttonIn(rows(wrapper)[0], '通过').trigger('click')
    await flushPromises()

    // 只报一句"评论不存在"的话，用户看到的是"报错 + 表格里还有它"，
    // 会以为操作失败再点一次 —— 把列表刷新才是能自愈的做法
    expect(warning.mock.calls.some(c => String(c[0]).includes('已经不在了'))).toBe(true)
    expect(warning.mock.calls.some(c => String(c[0]).includes('列表已刷新'))).toBe(true)
    expect(pageCallCount()).toBeGreaterThan(before)
    vi.restoreAllMocks()
  })

  it('删除时撞上 404_should同样自愈（提示 + 刷新列表）', async () => {
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm')
    mockBackend({ '/admin/comment/2': { code: 404, message: '评论不存在' } })
    const warning = vi.spyOn(ElMessage, 'warning').mockImplementation(() => {})

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoComments(wrapper)

    const before = pageCallCount()
    await openMoreMenu(rows(wrapper)[0])
    await clickMoreItem('删除评论')
    await flushPromises()

    expect(warning.mock.calls.some(c => String(c[0]).includes('列表已刷新'))).toBe(true)
    expect(pageCallCount()).toBeGreaterThan(before)
    vi.restoreAllMocks()
  })

  // ---------------------------------------------------------------
  // 六、文章被删除时的显示
  // ---------------------------------------------------------------

  it('文章标题缺失（文章已被删除）_should显示占位说明，而不是一个空白单元格', async () => {
    mockBackend({
      '/admin/comment/page': body({ records: [{ ...PENDING, articleTitle: null }], total: 1 }),
    })

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoComments(wrapper)

    // 空白的"文章"列会让人以为是页面没加载出来
    expect(rows(wrapper)[0].text()).toContain('文章已删除')
  })

  // ---------------------------------------------------------------
  // 七、超长评论的「详情」
  // ---------------------------------------------------------------

  /**
   * 一条**长**评论：超过组件里那个 40 字的阈值。
   * 特意让它的**结尾**与开头完全不同，并且断言弹窗里含结尾 ——
   * 否则"弹窗里显示了完整内容"这条断言，光靠开头几个字是证明不了的。
   */
  const LONG_TEXT = `这是一条很长的评论，用来验证长评论能不能看全。${'内容' .repeat(30)}结尾这几个字只在完整内容里才有`
  const LONG = { ...PENDING, content: LONG_TEXT }

  it('超长评论_should出现「详情」入口，点开后弹窗里是【完整】内容而不是被截断的一行', async () => {
    mockBackend({ '/admin/comment/page': body({ records: [LONG], total: 1 }) })

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoComments(wrapper)

    // ① 有入口
    const detailBtn = buttonIn(rows(wrapper)[0], '详情')
    expect(detailBtn).toBeTruthy()

    // ② 点开后弹窗里是**完整**内容（含只有完整文本才有的结尾）
    await detailBtn.trigger('click')
    await flushPromises()
    /**
     * 【⚠️ 为什么这里用 wrapper.find，而不是像下拉菜单那样去 document 找】
     *   同样是"浮层"，两者的挂载位置**不一样**：
     *     · `el-select` 的下拉面板会 teleport 到 body（所以上面 pickStatus 必须去 document 找）
     *     · `el-dialog` 的 `append-to-body` **默认是 false**，它就渲染在组件树里 ——
     *       于是它在 wrapper 里，`document.querySelector` 一个都找不到
     *   实测踩过：第一版按"浮层都在 body"去 document 找，拿到的是 null，
     *   而弹窗其实好好地开着（就在 wrapper 里）。记下来免得下次又找错地方。
     */
    const content = wrapper.find('.cm-detail-modal .dd-content')
    expect(content.exists()).toBe(true)
    expect(content.text()).toContain('结尾这几个字只在完整内容里才有')
    expect(content.text().length).toBe(LONG_TEXT.length)

    // ③ 判断"要不要通过"需要的上下文也在（邮箱 / IP / 文章 / 状态 / 时间）
    const meta = wrapper.find('.cm-detail-modal .dd-meta').text()
    for (const field of ['昵称', '状态', '时间', '邮箱', 'IP', '文章']) {
      expect(meta, `详情里应当有「${field}」`).toContain(field)
    }
    expect(meta).toContain(LONG.email)
  })

  it('短评论_should【不】给「详情」入口（每行都挂一个按钮只是噪音，还会把内容列挤窄）', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoComments(wrapper)

    // PENDING 那条是"联调用的一条评论"（8 个字），在表格里一眼看得完
    expect(buttonIn(rows(wrapper)[0], '详情')).toBeUndefined()
  })

  it('详情里点「通过」_should走同一个审核接口，并【在成功之后】关掉弹窗', async () => {
    mockBackend({ '/admin/comment/page': body({ records: [LONG], total: 1 }) })
    const success = vi.spyOn(ElMessage, 'success').mockImplementation(() => {})

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoComments(wrapper)

    await buttonIn(rows(wrapper)[0], '详情').trigger('click')
    await flushPromises()

    // 弹窗里的按钮：el-dialog 默认不 teleport 到 body，所以在 wrapper 里找（见上一条用例的说明）
    const approve = wrapper.findAll('.cm-detail-modal .el-button')
      .find(b => b.text() === '通过')
    expect(approve).toBeTruthy()
    await approve.trigger('click')
    await flushPromises()

    // ① 发出去的请求与表格里那个「通过」完全一样（同一套逻辑，没有第二份实现）
    const put = callTo('PUT', '/admin/comment/2/status')
    expect(put).toBeTruthy()
    expect(put[1].params).toEqual({ status: 1 })
    // ② 处理完了弹窗内容应当消失（detailRow 是快照，留着它用户会对着已处理的评论继续点）
    expect(wrapper.find('.cm-detail-modal .dd-content').exists()).toBe(false)
    success.mockRestore()
  })

  it('详情里审核失败_should【不】关弹窗（用户正在读的那段长评论要留在眼前好重试）', async () => {
    mockBackend({
      '/admin/comment/page': body({ records: [LONG], total: 1 }),
      '/admin/comment/2/status': { code: 429, message: '请求过于频繁，请稍后再试' },
    })

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoComments(wrapper)

    await buttonIn(rows(wrapper)[0], '详情').trigger('click')
    await flushPromises()
    const approve = wrapper.findAll('.cm-detail-modal .el-button')
      .find(b => b.text() === '通过')
    await approve.trigger('click')
    await flushPromises()

    // 失败时弹窗内容留在原地（关掉的话用户得重新找到那一行再点一次「详情」，白跑一趟）
    expect(wrapper.find('.cm-detail-modal .dd-content').exists()).toBe(true)
  })
})
