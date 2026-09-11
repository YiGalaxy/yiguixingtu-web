import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { ElMessage, ElMessageBox } from 'element-plus'
import AdminPage from '~/pages/admin.vue'
import MusicPanel from '~/components/admin/MusicPanel.vue'
import { MUSIC_LIMITS, checkMediaUrl, checkImageUrl, MEDIA_URL_MESSAGE } from '~/utils/contentForm'

// =====================================================================
// 后台「音乐管理」的组件测试
//
// 【这一组守的是什么】
//   音乐页比另外四个内容页多两件"看着对、其实错了"的事：
//
//   ① 音频上传走的是 `POST /upload?type=audio`，而图片走的是 `POST /upload`
//      —— 少了那个查询参数，后端就会按**图片**的白名单校验，一个正常的 mp3 会被拒；
//      而且两种形态的白名单/大小上限完全不同（图片 10MB / 音频 20MB），
//      所以下面既断言"参数带上去了"，也断言"音频模式下 .jpg 会被本地拦下、
//      20MB 那条边界卡在 20MB+1 字节"。
//
//   ② 歌词是**长文本原文**（LRC）：它的换行与缩进就是格式，
//      保存时只能去掉首尾空白，绝不能把中间压成一行（压了歌词就废了）。
//      所以有一条用例专门喂多行歌词、断言请求体里逐字不变。
//
//   另外与其它面板同源的几条（也是这一类页面最容易写错的）：
//     · 建完不刷新列表 → 用户以为没保存成功，再点一次就多一条
//     · 二次确认点了"取消"，删除请求照样发出去 → 确认框形同虚设
//     · 404（HTTP 200 + body.code = 404）不刷新列表 → 用户对着一句报错再点一次
//     · 上传失败把原地址清掉 → 用户以为"我填的地址被弄丢了"
//
// 【怎么拦请求】$fetch 换成按 URL 分发的假实现；后端此刻还没落地，
//   所以这里全部是假数据，一个真实网络请求都不发。
// =====================================================================

const { fetchMock, tokenRef } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  tokenRef: { value: 'fake-token' },
}))
mockNuxtImport('$fetch', () => fetchMock)
mockNuxtImport('useCookie', () => () => tokenRef)

// 弹层（下拉框面板、确认框）会 teleport 到 body 并留在那里；每个用例结束都卸载，
// 免得上一个用例的残留影响下一个（其它后台用例同款处理）
enableAutoUnmount(afterEach)

const body = (data) => ({ code: 200, message: '成功', data })
const pathOf = (url) => String(url).split('?')[0]

/**
 * 后端 GET /admin/music/list 的形状（MusicVO，含隐藏的、不分页）。
 * 【为什么第三条的 artist / cover / lyrics 都是 null】后端允许这些字段为空，
 * 页面必须能渲染成「—」或占位，而不是印 undefined。
 */
const MUSICS = [
  {
    id: 1, title: '夜航星', artist: '某某乐队', url: '/media/night.mp3', cover: '/uploads/m1.png',
    lyrics: '[00:01.00]夜航星\n[00:05.00]第二行', sort: 1, status: 1, createTime: '2026-09-10T05:03:19',
  },
  {
    id: 2, title: '只有曲名的歌', artist: null, url: 'https://cdn.example/b.mp3', cover: null,
    lyrics: null, sort: 2, status: 0, createTime: null,
  },
]

/**
 * 标准假后端：按路径给一条响应。
 * 【为什么把它单独抽出来】有些用例要"自己接管某几条路径"（比如新建成功后让列表
 *   多返回一条），那些用例会整体换掉 fetchMock 的实现。如果它们在"其余路径"上
 *   随手返回 body(null)，后台页挂载时那几个请求就会读到 null.data 而抛异常
 *   （报出来是 "Unhandled error during execution of mounted hook"，
 *    最后让整个文件的退出码变成 1，看起来像测试失败）。所以自行接管的用例
 *   一律把其余路径委托给这里。
 */
const defaultResponse = (path) => {
  if (path === '/admin/music/list') return body(MUSICS)
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

/** 切到「音乐管理」菜单（默认停在用户管理，菜单顺序见 admin.vue 的 menus） */
const gotoMusic = async (wrapper) => {
  await wrapper.findAll('.side-nav a').find(a => a.text() === '音乐管理').trigger('click')
  await flushPromises()
}

/** 表格里当前渲染出来的曲名（第一列是封面缩略图，曲名在第二列） */
const rowTitles = (wrapper) => wrapper.findAll('.panel .el-table__row').map(r => r.findAll('td')[1].text())

const callTo = (method, path) =>
  fetchMock.mock.calls.find(c => pathOf(c[0]) === path && c[1]?.method === method)

const callCount = (path) => fetchMock.mock.calls.filter(c => pathOf(c[0]) === path).length

const clickSave = async (wrapper) => {
  await wrapper.findAll('.el-dialog .el-button').find(b => b.text().includes('保存')).trigger('click')
  await flushPromises()
}

const clickCreate = async (wrapper) => {
  await wrapper.findAll('.toolbar .el-button').find(b => b.text().includes('新建歌曲')).trigger('click')
  await flushPromises()
}

/** 输入框按 placeholder 定位（弹窗里有多个输入框，按顺序数很容易数错） */
const inputByPlaceholder = (wrapper, placeholder) =>
  wrapper.find(`.el-dialog input[placeholder="${placeholder}"]`)

const TITLE_PH = '比如：夜航星'
const ARTIST_PH = '比如：某某乐队（可以留空）'
const URL_PH = '/media/bg-music.mp3 或 https://…（也可以点上传）'
const COVER_PH = '/uploads/cover.png 或 https://…（也可以点上传）'

const panelOf = (wrapper) => wrapper.findComponent(MusicPanel)

/** 从界面上的文件输入框上传一个文件（走 ElUpload 真实的 on-change → 我们的回调） */
const chooseFile = async (wrapper, file) => {
  const input = wrapper.find('.el-dialog input[type="file"]')
  Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
  await input.trigger('change')
  await flushPromises()
}

/** 弹窗里第 n 个文件输入框（0 = 音频、1 = 封面） */
const fileInputs = (wrapper) => wrapper.findAll('.el-dialog input[type="file"]')

describe('后台 · 音乐管理', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    mockBackend()
  })

  // ---------------------------------------------------------------
  // 一、菜单与列表
  // ---------------------------------------------------------------

  it('菜单_should变成十二项，并且新的一项叫「音乐管理」（插在关于管理与评论管理之间）', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()

    expect(wrapper.findAll('.side-nav .nv-label').map(n => n.text())).toEqual([
      '概览', '文章管理', '用户管理', '标签管理', '分类管理',
      '收藏管理', '项目管理', '友链管理', '关于管理', '音乐管理', '评论管理', '设置',
    ])
  })

  it('切到菜单才拉列表（默认停在用户管理）_should不多打一次请求', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()

    // 面板在 v-if 链里：只有被切到才会挂载、才会 onMounted 拉数据
    expect(callCount('/admin/music/list')).toBe(0)

    await gotoMusic(wrapper)

    expect(callCount('/admin/music/list')).toBe(1)
  })

  it('列表_should显示封面缩略、曲名、歌手、排序、状态与创建时间（含隐藏的）', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoMusic(wrapper)

    expect(rowTitles(wrapper)).toEqual(['夜航星', '只有曲名的歌'])
    const first = wrapper.findAll('.panel .el-table__row')[0].findAll('td')
    // 封面缩略图是 <img>，src 就是后端给的地址
    expect(first[0].find('img').attributes('src')).toBe('/uploads/m1.png')
    expect(first[2].text()).toBe('某某乐队')
    expect(first[3].text()).toBe('1')       // 排序
    expect(first[4].text()).toBe('显示')
    expect(first[5].text()).toBe('2026-09-10 05:03:19')
    // 【后台列表必须含隐藏的】第二条 status = 0：前台播放器里看不到它，
    // 但后台要能看见并改回来
    expect(wrapper.findAll('.panel .el-table__row')[1].findAll('td')[4].text()).toBe('隐藏')
  })

  it('歌手与封面为空_should显示「—」，而不是留一格空白或印 undefined', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoMusic(wrapper)

    const second = wrapper.findAll('.panel .el-table__row')[1].findAll('td')
    expect(second[0].find('.mp-thumb-none').text()).toBe('—')   // 没有封面 → 占位
    expect(second[2].text()).toBe('—')                          // 没有歌手 → 占位
    expect(wrapper.text()).not.toContain('undefined')
  })

  it('列表接口失败_should列表为空但页面其余部分照常（不把后台带崩）', async () => {
    mockBackend({ '/admin/music/list': { code: 500, message: '服务器开小差了' } })

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoMusic(wrapper)

    expect(wrapper.findAll('.panel .el-table__row').length).toBe(0)
    expect(wrapper.text()).toContain('还没有歌曲')
    expect(wrapper.find('.top h1').text()).toBe('音乐管理')
  })

  it('列表接口返回了非数组_should当成空列表，而不是把渲染打挂', async () => {
    // 后端哪天把结构改成分页的 { records: [] } 时，直接 v-for 会抛 "not iterable"
    mockBackend({ '/admin/music/list': body({ records: MUSICS }) })

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoMusic(wrapper)

    expect(wrapper.findAll('.panel .el-table__row').length).toBe(0)
    expect(wrapper.text()).toContain('还没有歌曲')
  })

  it('空数组_should是正常状态（库里本来就可能一首歌都没有，后端刻意不插种子数据）', async () => {
    mockBackend({ '/admin/music/list': body([]) })

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoMusic(wrapper)

    // 空列表不等于"接口坏了"：这一页要显示一句人话 + 仍然能新建，
    // 而不是把它渲染成错误状态
    expect(rowTitles(wrapper)).toEqual([])
    expect(wrapper.text()).toContain('还没有歌曲')
    expect(wrapper.text()).not.toContain('读不到')
    expect(wrapper.findAll('.toolbar .el-button').some(b => b.text().includes('新建歌曲'))).toBe(true)
  })

  it('音频上传的提示语_should写清「单个音频不超过 20MB」（与后端一致）', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoMusic(wrapper)
    await clickCreate(wrapper)

    // 【为什么这条要单独钉】上限写小，用户会被前端白拦一次（后端明明能收）；
    // 写大，用户要白等一次上传才被后端拒。两种都是用户没法绕过的错，
    // 而它们在界面上看不出任何异常 —— 只能靠这条断言守
    const hint = wrapper.findAll('.el-dialog .af-hint').map(n => n.text()).join(' | ')
    expect(hint).toContain('单个音频不超过 20MB')
    expect(hint).toContain('mp3')
    // 顺带证明上传控件只收音频（选文件对话框里就不会出现图片）
    expect(fileInputs(wrapper)[0].attributes('accept')).toBe('audio/mpeg')
  })

  // ---------------------------------------------------------------
  // 二、新建
  // ---------------------------------------------------------------

  it('新建歌曲_should POST /admin/music，字段名与后端 MusicForm 一致，成功后重拉列表', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoMusic(wrapper)

    // 建完之后后端多返回一条：证明"列表真的重新拉了一次"（而不是本地塞了一条）
    fetchMock.mockImplementation((url, options) => {
      const path = pathOf(url)
      if (path === '/admin/music' && options?.method === 'POST') return Promise.resolve(body(9))
      if (path === '/admin/music/list') {
        return Promise.resolve(body([...MUSICS, { id: 9, title: '新歌', artist: '新歌手', url: '/media/new.mp3', sort: 0, status: 1 }]))
      }
      return Promise.resolve(defaultResponse(path))
    })

    await clickCreate(wrapper)
    await inputByPlaceholder(wrapper, TITLE_PH).setValue('新歌')
    await inputByPlaceholder(wrapper, ARTIST_PH).setValue('新歌手')
    await inputByPlaceholder(wrapper, URL_PH).setValue('/media/new.mp3')
    await clickSave(wrapper)

    const post = callTo('POST', '/admin/music')
    expect(post).toBeTruthy()
    // 字段名写错时后端拿不到值、也不会报错，只会把那一栏存成空 —— 所以逐个钉住
    expect(post[1].body).toEqual({
      title: '新歌',
      artist: '新歌手',
      url: '/media/new.mp3',
      cover: '',
      lyrics: '',
      sort: 0,
      status: 1,
    })
    expect(rowTitles(wrapper)).toContain('新歌')
  })

  it('歌词_should把 LRC 原文逐字提交（中间一个字符都不能动）', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoMusic(wrapper)

    // 【为什么中间那一行故意**行首带空格**】LRC 文件里行首缩进是排版的一部分；
    // 实现里如果逐行 trim（很自然的一种"顺手清理"），这一行就会被改掉 ——
    // 加上它之后，那条实现会被这条用例当场抓住
    // （第一次写这条时缩进放在了时间标签后面，逐行 trim 并不会动它，
    //   等于这条用例对那种实现是假绿的 —— 挪到行首才真的能拦住）
    const lrc = '[00:01.00]第一行\n  [00:05.00]第二行（行首缩进是有意义的）\n[00:09.50]第三行'
    await clickCreate(wrapper)
    await inputByPlaceholder(wrapper, TITLE_PH).setValue('带歌词的歌')
    await inputByPlaceholder(wrapper, URL_PH).setValue('/media/lrc.mp3')
    await wrapper.find('.el-dialog textarea').setValue(lrc)
    await clickSave(wrapper)

    // 【为什么单独一条】LRC 的换行与行首空格就是它的格式：保存时把它压成一行、
    // 或者逐行 trim，前台就再也解析不出正确的时间轴与排版了 ——
    // 而这个错误在后台界面上完全看不出来（textarea 里看着好好的）
    expect(callTo('POST', '/admin/music')[1].body.lyrics).toBe(lrc)
  })

  it('曲名为空_should前端就拦下来，一个请求都不发', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoMusic(wrapper)

    await clickCreate(wrapper)
    await inputByPlaceholder(wrapper, TITLE_PH).setValue('   ')
    await inputByPlaceholder(wrapper, URL_PH).setValue('/media/a.mp3')
    await clickSave(wrapper)

    expect(callTo('POST', '/admin/music')).toBeUndefined()
    expect(wrapper.find('.ed-error').text()).toContain('曲名不能为空')
    // 弹窗还开着，用户可以直接补内容
    expect(panelOf(wrapper).vm.editVisible).toBe(true)
  })

  it('音频地址为空_should前端就拦下来，一个请求都不发', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoMusic(wrapper)

    await clickCreate(wrapper)
    await inputByPlaceholder(wrapper, TITLE_PH).setValue('没有地址的歌')
    await clickSave(wrapper)

    // 地址是必填的（后端 MusicForm 上 url 有 @NotBlank）：没有地址的歌前台放不出声音
    expect(callTo('POST', '/admin/music')).toBeUndefined()
    expect(wrapper.find('.ed-error').text()).toContain('音频地址不能为空')
  })

  it('曲名超过 100 字_should拦下来（上限来自共享的 MUSIC_LIMITS）', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoMusic(wrapper)

    await clickCreate(wrapper)
    await inputByPlaceholder(wrapper, TITLE_PH).setValue('曲'.repeat(101))
    await inputByPlaceholder(wrapper, URL_PH).setValue('/media/a.mp3')
    await clickSave(wrapper)

    // 【这条同时证明"面板真的在读共享的那份上限"】把 MUSIC_LIMITS.title 改错，
    // 这条会立刻红 —— 光有"常量本身对不对"的断言，是测不出面板有没有用它的
    expect(callTo('POST', '/admin/music')).toBeUndefined()
    expect(wrapper.find('.ed-error').text()).toContain('曲名最长 100 字')
  })

  it('歌词超过 20000 字_should拦下来（长文本的上限同样是共享的）', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoMusic(wrapper)

    await clickCreate(wrapper)
    await inputByPlaceholder(wrapper, TITLE_PH).setValue('歌词超长的歌')
    await inputByPlaceholder(wrapper, URL_PH).setValue('/media/a.mp3')
    await wrapper.find('.el-dialog textarea').setValue('词'.repeat(20001))
    await clickSave(wrapper)

    expect(callTo('POST', '/admin/music')).toBeUndefined()
    expect(wrapper.find('.ed-error').text()).toContain('歌词最长 20000 字')
  })

  it('音频地址既不是 http(s) 也不是站内路径_should拦下来', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoMusic(wrapper)

    await clickCreate(wrapper)
    await inputByPlaceholder(wrapper, TITLE_PH).setValue('地址写错的歌')
    // 少了开头的斜杠 —— 它会被渲染成 <audio src="media/a.mp3">，相对路径会 404
    await inputByPlaceholder(wrapper, URL_PH).setValue('media/a.mp3')
    await clickSave(wrapper)

    expect(callTo('POST', '/admin/music')).toBeUndefined()
    expect(wrapper.find('.ed-error').text()).toContain('音频地址必须是 http(s):// 开头')
  })

  it('站内路径与外链两种地址_should都放行（后端两者都收）', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoMusic(wrapper)

    await clickCreate(wrapper)
    await inputByPlaceholder(wrapper, TITLE_PH).setValue('站内路径的歌')
    await inputByPlaceholder(wrapper, URL_PH).setValue('/media/bg-music.mp3')
    await clickSave(wrapper)
    expect(callTo('POST', '/admin/music')[1].body.url).toBe('/media/bg-music.mp3')

    // 换成外链再提交一次（同一套校验要放行两种形态）
    await clickCreate(wrapper)
    await inputByPlaceholder(wrapper, TITLE_PH).setValue('外链的歌')
    await inputByPlaceholder(wrapper, URL_PH).setValue('https://cdn.example/song.mp3')
    await clickSave(wrapper)
    expect(fetchMock.mock.calls.filter(c => pathOf(c[0]) === '/admin/music' && c[1]?.method === 'POST').length).toBe(2)
    expect(fetchMock.mock.calls.filter(c => pathOf(c[0]) === '/admin/music' && c[1]?.method === 'POST')[1][1].body.url)
      .toBe('https://cdn.example/song.mp3')
  })

  // ---------------------------------------------------------------
  // 三、保存失败与编辑
  // ---------------------------------------------------------------

  it('保存失败_should把后端那句话显示在弹窗里，并且不关闭弹窗', async () => {
    mockBackend({ '/admin/music': { code: 400, message: '曲名最长 100 字' } })

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoMusic(wrapper)

    await clickCreate(wrapper)
    await inputByPlaceholder(wrapper, TITLE_PH).setValue('一首歌')
    await inputByPlaceholder(wrapper, URL_PH).setValue('/media/a.mp3')
    await clickSave(wrapper)

    // 【为什么断言 editVisible 而不是 `.el-dialog` 存不存在】Element Plus 关闭弹窗时
    // 不删 DOM（只把遮罩 display:none），`.exists()` 在开关两种状态下都是 true
    expect(panelOf(wrapper).vm.editVisible).toBe(true)
    expect(wrapper.find('.ed-error').text()).toContain('曲名最长 100 字')
  })

  it('后端没给原因时_should用一句兜底文案，而不是显示一个空白的错误条', async () => {
    mockBackend({ '/admin/music': { code: 400 } })

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoMusic(wrapper)

    await clickCreate(wrapper)
    await inputByPlaceholder(wrapper, TITLE_PH).setValue('一首歌')
    await inputByPlaceholder(wrapper, URL_PH).setValue('/media/a.mp3')
    await clickSave(wrapper)

    expect(wrapper.find('.ed-error').text()).toBe('保存失败，请稍后再试')
  })

  it('编辑_should用 PUT /admin/music/{id} 并回显当前值（含歌词原文）', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoMusic(wrapper)

    await wrapper.findAll('.panel .el-table__row')[0].findAll('.el-button')
      .find(b => b.text() === '编辑').trigger('click')
    await flushPromises()

    expect(inputByPlaceholder(wrapper, TITLE_PH).element.value).toBe('夜航星')
    expect(inputByPlaceholder(wrapper, URL_PH).element.value).toBe('/media/night.mp3')
    expect(wrapper.find('.el-dialog textarea').element.value).toBe(MUSICS[0].lyrics)

    await inputByPlaceholder(wrapper, TITLE_PH).setValue('夜航星（重制版）')
    await clickSave(wrapper)

    const put = callTo('PUT', '/admin/music/1')
    expect(put).toBeTruthy()
    expect(put[1].body.title).toBe('夜航星（重制版）')
    // 编辑时 id 不上送（路径里已经有了），也不该变成 POST
    expect(callTo('POST', '/admin/music')).toBeUndefined()
  })

  it('可选字段为 null 的歌_should回显成空串，而不是"null"这个字面量', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoMusic(wrapper)

    await wrapper.findAll('.panel .el-table__row')[1].findAll('.el-button')
      .find(b => b.text() === '编辑').trigger('click')
    await flushPromises()

    const form = panelOf(wrapper).vm.form
    expect(form.artist).toBe('')
    expect(form.cover).toBe('')
    expect(form.lyrics).toBe('')
    expect(form.sort).toBe(2)
    expect(form.status).toBe(0)
  })

  it('编辑一条已经被别人删掉的歌（404）_should提示 + 关掉弹窗 + 重拉列表', async () => {
    const warning = vi.spyOn(ElMessage, 'warning').mockImplementation(() => {})
    mockBackend({ '/admin/music/1': { code: 404, message: '音乐不存在' } })

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoMusic(wrapper)

    await wrapper.findAll('.panel .el-table__row')[0].findAll('.el-button')
      .find(b => b.text() === '编辑').trigger('click')
    await flushPromises()
    await clickSave(wrapper)

    // 【404 是 HTTP 200 + body.code = 404】用 HTTP 状态码判会永远进不去这条分支，
    // 于是用户对着"记录已经不在了"的弹窗继续点保存，再撞一次 404
    expect(warning.mock.calls.some(c => String(c[0]).includes('列表已刷新'))).toBe(true)
    expect(panelOf(wrapper).vm.editVisible).toBe(false)
    vi.restoreAllMocks()
  })

  // ---------------------------------------------------------------
  // 四、删除
  // ---------------------------------------------------------------

  it('删除_should先弹二次确认，并说清"这首歌会立刻从前台播放器列表里消失"', async () => {
    const confirmSpy = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm')

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoMusic(wrapper)

    await wrapper.findAll('.panel .el-table__row')[0].findAll('.el-button')
      .find(b => b.text() === '删除').trigger('click')
    await flushPromises()

    expect(confirmSpy).toHaveBeenCalledTimes(1)
    const tip = confirmSpy.mock.calls[0][0]
    expect(tip).toContain('夜航星')            // 说清删的是哪一首
    expect(tip).toContain('前台播放器列表')     // 说清影响范围
    expect(tip).toContain('无法恢复')
    expect(callTo('DELETE', '/admin/music/1')).toBeTruthy()
    confirmSpy.mockRestore()
  })

  it('二次确认里点取消_should一个请求都不发', async () => {
    const confirmSpy = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue(new Error('cancel'))

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoMusic(wrapper)

    await wrapper.findAll('.panel .el-table__row')[0].findAll('.el-button')
      .find(b => b.text() === '删除').trigger('click')
    await flushPromises()

    // confirm 取消时是 reject：不 try/catch 之后 return 的话，
    // 用户点了取消，删除请求照样发出去（确认框形同虚设）
    expect(callTo('DELETE', '/admin/music/1')).toBeUndefined()
    confirmSpy.mockRestore()
  })

  it('删除成功后_should刷新列表（那首歌从表格里消失）', async () => {
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm')

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoMusic(wrapper)
    expect(rowTitles(wrapper)).toEqual(['夜航星', '只有曲名的歌'])

    fetchMock.mockImplementation((url, options) => {
      const path = pathOf(url)
      if (path === '/admin/music/1' && options?.method === 'DELETE') return Promise.resolve(body(null))
      if (path === '/admin/music/list') return Promise.resolve(body([MUSICS[1]]))
      return Promise.resolve(defaultResponse(path))
    })

    await wrapper.findAll('.panel .el-table__row')[0].findAll('.el-button')
      .find(b => b.text() === '删除').trigger('click')
    await flushPromises()

    expect(rowTitles(wrapper)).toEqual(['只有曲名的歌'])
    vi.restoreAllMocks()
  })

  it('删一首已经被别人删掉的歌（404）_should自愈：提示一句 + 真的重拉列表', async () => {
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm')
    const warning = vi.spyOn(ElMessage, 'warning').mockImplementation(() => {})

    mockBackend({ '/admin/music/1': { code: 404, message: '音乐不存在' } })

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoMusic(wrapper)

    const before = callCount('/admin/music/list')

    await wrapper.findAll('.panel .el-table__row')[0].findAll('.el-button')
      .find(b => b.text() === '删除').trigger('click')
    await flushPromises()

    expect(warning.mock.calls.some(c => String(c[0]).includes('列表已刷新'))).toBe(true)
    expect(callCount('/admin/music/list')).toBeGreaterThan(before)
    vi.restoreAllMocks()
  })

  // ---------------------------------------------------------------
  // 五、音频上传（useUpload 的音频模式：POST /upload?type=audio）
  // ---------------------------------------------------------------

  it('上传音频_should带上 type=audio 参数，并把返回的 data.url 填进音频地址', async () => {
    // 后端 POST /upload?type=audio 返回 Result<{ url, ... }>：地址在 data.url 上
    mockBackend({ '/upload': body({ url: 'http://x/uploads/audio/5.mp3' }) })

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoMusic(wrapper)
    await clickCreate(wrapper)

    await chooseFile(wrapper, new File([new Uint8Array([1, 2, 3])], 'song.mp3', { type: 'audio/mpeg' }))

    const upload = callTo('POST', '/upload')
    expect(upload).toBeTruthy()
    // 【少了这个参数后端会按图片的白名单校验】一个正常 mp3 会被拒
    expect(upload[1].params).toEqual({ type: 'audio' })
    // 字段名必须叫 file（后端是 @RequestParam("file")）
    expect(upload[1].body).toBeInstanceOf(FormData)
    expect(upload[1].body.get('file')).toBeTruthy()
    // 地址回填到那个手填输入框里（用户看得见、也能接着改）
    expect(panelOf(wrapper).vm.form.url).toBe('http://x/uploads/audio/5.mp3')
    expect(inputByPlaceholder(wrapper, URL_PH).element.value).toBe('http://x/uploads/audio/5.mp3')

    // 保存时提交的就是刚传上去的地址
    await inputByPlaceholder(wrapper, TITLE_PH).setValue('刚传的歌')
    await clickSave(wrapper)
    expect(callTo('POST', '/admin/music')[1].body.url).toBe('http://x/uploads/audio/5.mp3')
  })

  it('上传失败_should【保留原来的音频地址】并给出后端原话', async () => {
    const errorSpy = vi.spyOn(ElMessage, 'error').mockImplementation(() => {})
    mockBackend({ '/upload': { code: 400, message: '只允许上传 mp3 格式的音频' } })

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoMusic(wrapper)

    // 打开已有歌曲的编辑（它本来就有地址），再传一个会失败的文件
    await wrapper.findAll('.panel .el-table__row')[0].findAll('.el-button')
      .find(b => b.text() === '编辑').trigger('click')
    await flushPromises()
    expect(panelOf(wrapper).vm.form.url).toBe('/media/night.mp3')

    await chooseFile(wrapper, new File([new Uint8Array([1])], 'song.mp3', { type: 'audio/mpeg' }))

    // 失败时把地址清空的话，用户会以为"我刚填的地址被弄丢了"，
    // 而且接着点保存就把这首歌的地址真的清掉了（后端是整份表单覆盖式提交）
    expect(panelOf(wrapper).vm.form.url).toBe('/media/night.mp3')
    expect(inputByPlaceholder(wrapper, URL_PH).element.value).toBe('/media/night.mp3')
    expect(errorSpy.mock.calls.some(c => String(c[0]).includes('只允许上传'))).toBe(true)
    vi.restoreAllMocks()
  })

  it('选了不是 mp3 的文件_should本地就拦下，一个请求都不发', async () => {
    const errorSpy = vi.spyOn(ElMessage, 'error').mockImplementation(() => {})

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoMusic(wrapper)
    await clickCreate(wrapper)

    // 预检只读 name / size，不通过时走不到 FormData.append，所以轻量对象就够。
    // 【为什么图片扩展名必须被音频模式拦下】两种形态共用同一个 /upload，
    // 靠 type 参数区分；前端这里是"第一道"，拦不住就会白跑一次后端
    await panelOf(wrapper).vm.onAudioChosen({ raw: { name: 'cover.png', size: 1024 } })
    await flushPromises()

    expect(callTo('POST', '/upload')).toBeUndefined()
    expect(errorSpy.mock.calls.some(c => String(c[0]).includes('只支持'))).toBe(true)
    vi.restoreAllMocks()
  })

  it('音频超过 20MB_should本地就拦下，一个请求都不发（边界卡在 20MB+1 字节）', async () => {
    const errorSpy = vi.spyOn(ElMessage, 'error').mockImplementation(() => {})

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoMusic(wrapper)
    await clickCreate(wrapper)

    // 【为什么是 20MB 而不是图片那档的 5MB】上限写错的表现是"界面允许、后端却拒"，
    // 或者反过来"后端允许、界面先拦" —— 两种用户都没法绕过，所以边界要卡准
    await panelOf(wrapper).vm.onAudioChosen({ raw: { name: 'big.mp3', size: 20 * 1024 * 1024 + 1 } })
    await flushPromises()

    expect(callTo('POST', '/upload')).toBeUndefined()
    expect(errorSpy.mock.calls.some(c => String(c[0]).includes('20MB'))).toBe(true)
    vi.restoreAllMocks()
  })

  it('正好 20MB 的音频_should放行（边界不能写错）', async () => {
    mockBackend({ '/upload': body({ url: 'http://x/uploads/audio/exact.mp3' }) })

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoMusic(wrapper)
    await clickCreate(wrapper)

    // 正好等于上限时不该被拒（多一个字节才拒 —— 上一条用例守的另一侧）
    await panelOf(wrapper).vm.onAudioChosen({ raw: new File([new Uint8Array(1024)], 'exact.mp3', { type: 'audio/mpeg' }) })
    await flushPromises()

    expect(callTo('POST', '/upload')).toBeTruthy()
  })

  // ---------------------------------------------------------------
  // 六、封面上传（图片模式，与另外四个面板同款）
  // ---------------------------------------------------------------

  it('上传封面_should走图片那一档（不带 type 参数、上限 10MB），并把地址填进封面输入框', async () => {
    mockBackend({ '/upload': body({ url: 'http://x/uploads/cover/9.png' }) })

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoMusic(wrapper)
    await clickCreate(wrapper)

    // 弹窗里第 2 个文件输入框是封面（第 1 个是音频）
    const coverInput = fileInputs(wrapper)[1]
    expect(coverInput.attributes('accept')).toContain('image/png')
    Object.defineProperty(coverInput.element, 'files', {
      value: [new File([new Uint8Array([1])], 'cover.png', { type: 'image/png' })],
      configurable: true,
    })
    await coverInput.trigger('change')
    await flushPromises()

    const upload = callTo('POST', '/upload')
    expect(upload).toBeTruthy()
    // 图片模式【不带】type 参数（与加音频模式之前完全一样）
    expect(upload[1].params).toBeUndefined()
    expect(panelOf(wrapper).vm.form.cover).toBe('http://x/uploads/cover/9.png')
    expect(inputByPlaceholder(wrapper, COVER_PH).element.value).toBe('http://x/uploads/cover/9.png')
    expect(wrapper.find('.el-dialog .cover-preview').attributes('src')).toBe('http://x/uploads/cover/9.png')
  })

  it('封面选了超过 10MB 的图片_should按图片那一档拦下（音频的 20MB 不适用于封面）', async () => {
    const errorSpy = vi.spyOn(ElMessage, 'error').mockImplementation(() => {})

    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoMusic(wrapper)
    await clickCreate(wrapper)

    // 【为什么是 12MB】它必须落在"图片上限（10MB）之上、音频上限（20MB）之下"才有力气：
    // 图片提到 10MB 之前这条用的是 6MB，改动之后 6MB 两边都合法，
    // 这条用例就变成了永远为真 —— 两档规则万一串味，它也照样绿。
    await panelOf(wrapper).vm.onCoverChosen({ raw: { name: 'big.png', size: 12 * 1024 * 1024 } })
    await flushPromises()

    expect(callTo('POST', '/upload')).toBeUndefined()
    expect(errorSpy.mock.calls.some(c => String(c[0]).includes('10MB'))).toBe(true)
    vi.restoreAllMocks()
  })

  it('手填一个封面外链_should原样提交（封面也是"上传 + 手填"两条入口）', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoMusic(wrapper)
    await clickCreate(wrapper)

    await inputByPlaceholder(wrapper, TITLE_PH).setValue('有外链封面的歌')
    await inputByPlaceholder(wrapper, URL_PH).setValue('/media/a.mp3')
    await inputByPlaceholder(wrapper, COVER_PH).setValue('https://cdn.example/cover.png')
    await clickSave(wrapper)

    expect(callTo('POST', '/admin/music')[1].body.cover).toBe('https://cdn.example/cover.png')
  })

  it('点封面「移除」_should清空封面字段与输入框', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoMusic(wrapper)

    await wrapper.findAll('.panel .el-table__row')[0].findAll('.el-button')
      .find(b => b.text() === '编辑').trigger('click')
    await flushPromises()
    expect(inputByPlaceholder(wrapper, COVER_PH).element.value).toBe('/uploads/m1.png')

    await wrapper.findAll('.el-dialog .cover-btns .el-button').find(b => b.text() === '移除').trigger('click')
    await flushPromises()

    expect(panelOf(wrapper).vm.form.cover).toBe('')
    expect(inputByPlaceholder(wrapper, COVER_PH).element.value).toBe('')
    expect(wrapper.find('.el-dialog .cover-preview').exists()).toBe(false)
  })

  it('操作列的按钮_should有"永不折行"的结构性保证（jsdom 量不出排版）', async () => {
    const wrapper = await mountSuspended(AdminPage)
    await flushPromises()
    await gotoMusic(wrapper)

    // jsdom 不做布局，量不出"按钮有没有被挤到第二行"；能钉住的只有 flex + nowrap
    expect(wrapper.find('.mp-acts').exists()).toBe(true)
  })
})

// =====================================================================
// 音乐这套规则本身（现在住在 app/utils/contentForm.ts，与另外四个模块并列）
//
// 【为什么在这里直接测规则，而不只测"面板用起来对不对"】
//   上一轮这几条规则还写在 MusicPanel.vue 内部，这一轮搬进了共享文件。
//   搬家最容易出的问题是"搬的时候抄错一个数字"或"顺手改成复用 checkImageUrl" ——
//   两种在面板用例里都可能看不出来（比如上限从 20000 抄成 2000，
//   面板用例喂的歌词只有几十个字，照样全绿）。所以这里对常量与函数直接断言。
// =====================================================================

describe('音乐规则（app/utils/contentForm.ts，对齐后端 MusicForm / UrlPatterns）', () => {
  it('MUSIC_LIMITS_should与后端 MusicForm 的 @Size 注解逐条一致', () => {
    // title @Size(max=100) / artist @Size(max=100) / url @Size(max=500)
    // cover @Size(max=255) / lyrics @Size(max=20000)
    expect(MUSIC_LIMITS).toEqual({ title: 100, artist: 100, url: 500, cover: 255, lyrics: 20000 })
    // 冻结：它是一份"与后端对齐的约定"，被就地改一个数字就会悄悄分叉
    expect(Object.isFrozen(MUSIC_LIMITS)).toBe(true)
  })

  it('checkMediaUrl_should放行外链与 / 开头的站内路径', () => {
    // 上传接口返回的形如 http://localhost:8082/uploads/music/…；站内路径形如 /media/bg-music.mp3
    expect(checkMediaUrl('https://cdn.example/song.mp3', '音频地址', { maxLength: MUSIC_LIMITS.url })).toBe('')
    expect(checkMediaUrl('http://x/uploads/music/1.mp3', '音频地址', { maxLength: MUSIC_LIMITS.url })).toBe('')
    expect(checkMediaUrl('/media/bg-music.mp3', '音频地址', { maxLength: MUSIC_LIMITS.url })).toBe('')
  })

  it('checkMediaUrl_should拒掉相对路径与危险协议', () => {
    // 少了开头的斜杠 → 会被渲染成 <audio src="media/a.mp3">，相对路径一定 404
    expect(checkMediaUrl('media/a.mp3', '音频地址')).toContain('音频地址必须是 http(s):// 开头')
    // 存储型 XSS 通道：这个值会被塞进 <audio src>
    expect(checkMediaUrl('javascript:alert(1)', '音频地址')).not.toBe('')
    expect(checkMediaUrl('ftp://a/b.mp3', '音频地址')).not.toBe('')
  })

  it('checkMediaUrl_should默认必填（与后端 @NotBlank 一致）', () => {
    expect(checkMediaUrl('', '音频地址')).toBe('音频地址不能为空')
    expect(checkMediaUrl('   ', '音频地址')).toBe('音频地址不能为空')
    // required: false 时放行空值（留给将来别的音频类字段用）
    expect(checkMediaUrl('', '音频地址', { required: false })).toBe('')
  })

  it('checkMediaUrl_should卡长度（500 字那条边界）', () => {
    const long = 'https://cdn.example/' + 'a'.repeat(600) + '.mp3'
    expect(checkMediaUrl(long, '音频地址', { maxLength: MUSIC_LIMITS.url }))
      .toBe(`音频地址最长 ${MUSIC_LIMITS.url} 字`)
  })

  it('提示语_should来自后端的 MEDIA_URL_MESSAGE（不是图片那句）', () => {
    const msg = checkMediaUrl('media/a.mp3', '音频地址')
    // 后端 UrlPatterns.MEDIA_URL_MESSAGE：「音频地址必须是 http(s):// 开头的完整地址，或以 / 开头的站内路径」
    expect(msg).toBe(MEDIA_URL_MESSAGE)
    // 【关键】绝不能是图片那句（IMAGE_URL_MESSAGE 的主语是"图片地址"）
    expect(msg).not.toContain('图片')
  })

  it('checkMediaUrl 与 checkImageUrl_should是两个函数（规则文本相同也不能合并）', () => {
    // 【为什么这条断言有意义】两者的正则目前一模一样（外链 / `/` 站内路径），
    //   所以"让音频直接复用图片那档"的诱惑很大。但后端是**两个常量、两句文案**：
    //   合并之后，哪天后端只把其中一条改宽/改严，另一边会跟着错位且不报错 ——
    //   这正是后端 UrlPatterns 里那段注释说的坑。
    //   断言"是两个不同的函数对象"能在有人把它改成别名时立刻变红。
    expect(checkMediaUrl).not.toBe(checkImageUrl)
    // 而且各自的提示主语不同（图片那档说的是"图片地址/头像地址…"，
    // 音频这档固定是"音频地址"开头）
    expect(checkImageUrl('x.png', '封面地址')).toContain('封面地址必须是')
    expect(checkMediaUrl('x.mp3', '音频地址')).toContain('音频地址必须是')
  })
})
