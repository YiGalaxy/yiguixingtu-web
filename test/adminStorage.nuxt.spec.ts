import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { ElMessageBox } from 'element-plus'
import AdminPage from '~/pages/admin.vue'
import StoragePanel from '~/components/admin/StoragePanel.vue'

// =====================================================================
// 后台「存储管理」的组件测试
//
// 【这一页守的是什么】它是后台唯一会**删磁盘文件**的界面，而删除不可逆。
//   所以用例的重点不是"表格画得对不对"，而是三件事：
//     ① 该拦的拦住：被引用的文件，删除按钮必须是禁用的（前端第一道）
//     ② 该说的说清：后端返回的"跳过 / 失败"要如实告诉用户，
//        不能笼统一句"操作完成"—— 勾了 10 个还剩 3 个却没有任何解释，最像功能坏了
//     ③ 取消不误删：确认框点"取消"时一个请求都不发
//
// 【为什么这些断言有意义，而不是"测了前端也拦不住恶意请求"】
//   前端拦的是**误操作**（手滑点到一个正在用的文件），真正的边界在后端
//   （删除接口会自己重算一遍引用，见 UploadStorageService.deleteFiles）。
//   两道防线管的是两件事，都要有。
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

/** 后端 GET /admin/upload/storage 的真实形状 */
const STORAGE = {
  usedBytes: 5 * 1024 * 1024 + 512 * 1024,
  maxTotalBytes: 5 * 1024 * 1024 * 1024,
  fileCount: 3,
  orphanCount: 1,
  files: [
    {
      key: 'cover/1e/1eb9.png',
      url: '/uploads/cover/1e/1eb9.png',
      name: '1eb9.png',
      category: 'cover',
      size: 5 * 1024 * 1024,
      lastModified: '2026-09-19T05:26:00',
      references: [
        { type: 'ARTICLE', targetId: 13, title: '2.再识Java', field: '封面' },
        { type: 'MUSIC', targetId: 4, title: '夜曲', field: '封面' },
      ],
    },
    {
      key: 'attachment/15/159f.pdf',
      url: '/uploads/attachment/15/159f.pdf',
      name: '159f.pdf',
      category: 'attachment',
      size: 512 * 1024,
      lastModified: '2026-09-18T10:00:00',
      references: [
        { type: 'ATTACHMENT', targetId: 12, title: '毕业论文.pdf', field: '附件' },
      ],
    },
    {
      key: 'music/e9/e937.mp3',
      url: '/uploads/music/e9/e937.mp3',
      name: 'e937.mp3',
      category: 'music',
      size: 1024,
      lastModified: '2026-09-18T09:00:00',
      references: [],
    },
  ],
}

const callsTo = (path) => fetchMock.mock.calls.filter(([url]) => pathOf(url) === path)
const lastCallTo = (path) => {
  const calls = callsTo(path)
  return calls.length ? calls[calls.length - 1] : null
}
const lastBodyTo = (path) => lastCallTo(path)?.[1]?.body

const mockBackend = (overrides = {}) => {
  fetchMock.mockImplementation((url) => {
    const path = pathOf(url)
    if (path in overrides) return Promise.resolve(overrides[path])
    if (path === '/admin/upload/storage') return Promise.resolve(body(STORAGE))
    if (path === '/admin/upload/delete-files') {
      return Promise.resolve(body({ deleted: ['music/e9/e937.mp3'], skippedReferenced: [], failed: [] }))
    }
    if (path === '/auth/me') return Promise.resolve(body({ id: 1, username: 'admin', role: 'ADMIN' }))
    if (path === '/user/page') return Promise.resolve(body({ records: [], total: 0 }))
    if (path === '/category/list') return Promise.resolve(body([]))
    if (path === '/admin/tag/list') return Promise.resolve(body([]))
    if (path === '/article/stats') return Promise.resolve(body({ articleCount: 0, viewCount: 0, categoryCount: 0 }))
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

/** 挂整个后台并切到「存储管理」 */
const mountStorage = async () => {
  const wrapper = await mountSuspended(AdminPage)
  await flushPromises()
  await wrapper.findAll('.side-nav a').find(a => a.text() === '存储管理').trigger('click')
  await flushPromises()
  return wrapper
}

const rows = (wrapper) => wrapper.findAll('.panel .el-table__row')
const rowTexts = (wrapper) => rows(wrapper).map(r => r.text())
/** 某一行的「删除」按钮 */
const deleteBtnOf = (wrapper, index) =>
  rows(wrapper)[index].findAll('.el-button').find(b => b.text() === '删除')

describe('存储管理 —— 清单与占用', () => {
  it('菜单里有「存储管理」，切过去能打开这一页', async () => {
    const wrapper = await mountStorage()

    expect(wrapper.text()).toContain('存储管理')
    expect(rows(wrapper).length).toBe(3)
  })

  it('挂载时读一次存储清单，渲染出文件名 / 类型 / 大小 / 时间', async () => {
    const wrapper = await mountStorage()

    expect(callsTo('/admin/upload/storage')).toHaveLength(1)
    const text = wrapper.text()
    expect(text).toContain('1eb9.png')
    expect(text).toContain('159f.pdf')
    // 类型是"目录前缀"翻译过来的，不是按扩展名猜的（附件永远显示成附件）
    expect(text).toContain('图片')
    expect(text).toContain('附件')
    expect(text).toContain('音频')
    // 大小走 formatFileSize（5MB / 512KB / 1KB）
    expect(text).toContain('5.0 MB')
    expect(text).toContain('512 KB')
  })

  it('顶部显示占用概览（已用 / 上限），并给出无引用文件的个数', async () => {
    const wrapper = await mountStorage()

    expect(wrapper.find('.sp-usage-num').text()).toContain('5.5 MB')
    expect(wrapper.find('.sp-usage-num').text()).toContain('5.00 GB')
    expect(wrapper.text()).toContain('其中 1 个没有任何地方引用')
  })

  it('读接口失败_提示并清空清单（旧数据里的"无人引用"可能已经不成立，不能留着）', async () => {
    mockBackend({ '/admin/upload/storage': { code: 500, message: '服务器内部错误', data: null } })
    const wrapper = await mountStorage()

    expect(rows(wrapper).length).toBe(0)
    expect(wrapper.text()).toContain('没有符合条件的文件')
  })
})

describe('存储管理 —— 引用展示与删除的可用性', () => {
  it('被引用的文件_列出每一处引用，并且链接指向前台对应页面', async () => {
    const wrapper = await mountStorage()

    const refs = rows(wrapper)[0].findAll('.sp-ref')
    expect(refs.map(r => r.text())).toEqual([
      '文章《2.再识Java》 · 封面',
      '音乐《夜曲》 · 封面',
    ])
    // 【为什么链接指向前台而不是后台编辑器】点这一下的目的是"看看它用在哪了"，
    //   前台页面正好是这个答案；要改再回对应的管理页
    expect(refs[0].attributes('href')).toBe('/article/13')
    expect(refs[1].attributes('href')).toBe('/music')
  })

  it('★ 被引用的文件_删除按钮是禁用的（前端第一道，防手滑）', async () => {
    const wrapper = await mountStorage()

    expect(deleteBtnOf(wrapper, 0).attributes('disabled')).toBeDefined()
    expect(deleteBtnOf(wrapper, 1).attributes('disabled')).toBeDefined()
  })

  it('无人引用的文件_显示「无人引用」标签，删除按钮可用', async () => {
    const wrapper = await mountStorage()

    expect(rows(wrapper)[2].text()).toContain('无人引用')
    expect(rows(wrapper)[2].findAll('.sp-ref').length).toBe(0)
    expect(deleteBtnOf(wrapper, 2).attributes('disabled')).toBeUndefined()
  })

  it('附件那条引用_链接指向它所属的文章（不是附件行本身）', async () => {
    const wrapper = await mountStorage()

    const ref = rows(wrapper)[1].find('.sp-ref')
    expect(ref.text()).toBe('附件《毕业论文.pdf》 · 附件')
    expect(ref.attributes('href')).toBe('/article/12')
  })
})

describe('存储管理 —— 删除', () => {
  it('删单个文件_二次确认后 POST 对应的 key，成功后重新拉清单', async () => {
    const confirmSpy = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm')
    const wrapper = await mountStorage()
    const before = callsTo('/admin/upload/storage').length

    await deleteBtnOf(wrapper, 2).trigger('click')
    await flushPromises()

    expect(confirmSpy).toHaveBeenCalled()
    expect(lastCallTo('/admin/upload/delete-files')?.[1]?.method).toBe('POST')
    // 提交的是 key（不是 url）：URL 长什么样是存储实现的事，前端不该反解
    expect(lastBodyTo('/admin/upload/delete-files')).toEqual({ keys: ['music/e9/e937.mp3'] })
    expect(callsTo('/admin/upload/storage').length).toBe(before + 1)
  })

  it('★ 确认框点取消_一个请求都不发（取消不能变成"偷偷删掉"）', async () => {
    vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
    const wrapper = await mountStorage()

    await deleteBtnOf(wrapper, 2).trigger('click')
    await flushPromises()

    expect(callsTo('/admin/upload/delete-files')).toHaveLength(0)
  })

  it('★ 清理孤立文件_一次把所有无人引用的 key 提交，并把释放空间说清楚', async () => {
    const confirmSpy = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm')
    const wrapper = await mountStorage()

    await wrapper.findAll('.toolbar .el-button').find(b => b.text().includes('清理无人引用的文件')).trigger('click')
    await flushPromises()

    expect(confirmSpy).toHaveBeenCalled()
    // 确认文案要说清"删几个、能释放多少、不可撤销" —— 只说"确定吗"等于什么也没说
    const message = confirmSpy.mock.calls[0][0]
    expect(message).toContain('1 个')
    expect(message).toContain('不可撤销')
    expect(lastBodyTo('/admin/upload/delete-files')).toEqual({ keys: ['music/e9/e937.mp3'] })
  })

  it('没有任何孤儿时_清理按钮是禁用的（点了也什么都不会发生的按钮最招人烦）', async () => {
    mockBackend({
      '/admin/upload/storage': body({ ...STORAGE, orphanCount: 0, files: STORAGE.files.map(f => ({ ...f, references: [{ type: 'ARTICLE', targetId: 1, title: 'x', field: '封面' }] })) }),
    })
    const wrapper = await mountStorage()

    const btn = wrapper.findAll('.toolbar .el-button').find(b => b.text().includes('清理无人引用的文件'))
    expect(btn.attributes('disabled')).toBeDefined()
  })

  it('★ 后端说"有几个仍被引用/失败"_界面要如实说出来，而不是笼统一句成功', async () => {
    mockBackend({
      '/admin/upload/delete-files': body({
        deleted: ['a.png'], skippedReferenced: ['b.png'], failed: ['c.png'],
      }),
    })
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm')
    const wrapper = await mountStorage()

    await deleteBtnOf(wrapper, 2).trigger('click')
    await flushPromises()

    // 三种结果都要出现 —— 用户勾了 3 个，必须能一眼看出"另外两个去哪了"
    const shown = wrapper.emitted() && document.body.textContent
    expect(shown).toContain('1 个')
    expect(shown).toContain('仍被引用已保留')
    expect(shown).toContain('删除失败')
  })
})

describe('存储管理 —— 筛选', () => {
  it('按类型筛：只剩所选类型那些行', async () => {
    const wrapper = await mountStorage()
    const vm = wrapper.findComponent(StoragePanel).vm

    // 【为什么直接改筛选状态，而不是去点 el-select 的下拉】
    //   el-select 的选项是 teleport 到 body 的，jsdom 里点它要绕一大圈
    //   （先点开、再去 document.body 里找选项）。这里要测的是"选了之后列表对不对"，
    //   不是"el-select 能不能点"（那是 Element Plus 自己的用例该管的）。
    vm.category = 'cover'
    await flushPromises()

    expect(rows(wrapper).length).toBe(1)
    expect(rows(wrapper)[0].text()).toContain('1eb9.png')
  })

  it('按"是否被引用"筛：无人引用 / 有引用 各自只剩对应的行', async () => {
    const wrapper = await mountStorage()
    const vm = wrapper.findComponent(StoragePanel).vm

    vm.refFilter = 'orphan'
    await flushPromises()
    expect(rows(wrapper).length).toBe(1)
    expect(rows(wrapper)[0].text()).toContain('无人引用')

    vm.refFilter = 'referenced'
    await flushPromises()
    expect(rows(wrapper).length).toBe(2)
    expect(rowTexts(wrapper).join(' ')).not.toContain('无人引用')
  })

  it('按关键词搜：文件名与路径都能匹配', async () => {
    const wrapper = await mountStorage()
    const vm = wrapper.findComponent(StoragePanel).vm

    vm.keyword = 'pdf'
    await flushPromises()
    expect(rows(wrapper).length).toBe(1)

    // 路径也参与匹配（文件名是内容哈希，很多时候只能靠目录段找）
    vm.keyword = 'music/'
    await flushPromises()
    expect(rows(wrapper).length).toBe(1)
    expect(rows(wrapper)[0].text()).toContain('e937.mp3')
  })
})
