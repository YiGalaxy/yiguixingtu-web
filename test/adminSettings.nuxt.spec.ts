import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises, enableAutoUnmount } from '@vue/test-utils'
import SettingsPanel from '~/components/admin/SettingsPanel.vue'

// =====================================================================
// 后台「设置」面板的组件测试
//
// 【这一组守的是什么】
//   这一页是一张**单条记录的表单**（后端 site_setting 只有一行），所以没有列表、
//   没有新建删除。它的坑集中在三处，每条都用一个用例钉住：
//     ① 保存之后前台要跟着变（页眉站名、页脚、公告、评论开关、每页条数）
//        —— 不刷新外壳的话，站长改完抬头一看页眉还是旧名字，会以为没保存成功
//     ② 校验失败必须**把原因留在面板上**，不能只弹一个三秒就消失的 toast
//        —— 那时用户还在看这个表单
//     ③ 字段名和服务端必须逐字一致（写错了不会报错，只会把那一栏存成空）
//
// 【怎么断言"发出去的请求"】$fetch 换成按 URL 分发的假实现，
//   再从 mock 的调用记录里读 method / body。断言请求体比"函数被调用了"更有意义 ——
//   它同时钉住了字段名与类型（commentEnabled 是布尔而不是 0/1，
//   因为库里存 0/1、而这里提交的应当是界面上那个 el-switch 的值）。
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

/** 后端 GET /setting 的真实形状（含 updateTime） */
const SETTINGS = {
  siteName: '亿轨星途',
  announcement: '今晚 22:00 例行维护',
  commentEnabled: true,
  icpNumber: '京ICP备12345678号-1',
  policeNumber: '川公网安备 51090002000169号',
  copyright: '© 2026 亿轨星途',
  pageSize: 12,
  updateTime: '2026-09-11T16:00:00',
}

const callsTo = (path) => fetchMock.mock.calls.filter(([url]) => pathOf(url) === path)
const lastCallTo = (path) => {
  const calls = callsTo(path)
  return calls.length ? calls[calls.length - 1] : null
}
const lastBodyTo = (path) => lastCallTo(path)?.[1]?.body
const lastMethodTo = (path) => lastCallTo(path)?.[1]?.method

beforeEach(() => {
  fetchMock.mockReset()
  // 默认假后端：这一页只读 /setting 与写 /admin/setting
  fetchMock.mockImplementation((url) => {
    if (pathOf(url) === '/setting') return Promise.resolve(body(SETTINGS))
    return Promise.resolve(body(null))
  })
})

const mountPanel = async () => {
  const wrapper = await mountSuspended(SettingsPanel)
  await flushPromises()
  return wrapper
}

/** 面板上那句话（三种语义共用这一个元素，靠类名区分） */
const noticeOf = (w) => w.find('.st-notice')

describe('设置面板 —— 读取与回显', () => {
  it('挂载时读一次 GET /setting，并把七个字段都填进表单', async () => {
    const w = await mountPanel()

    expect(callsTo('/setting')).toHaveLength(1)

    const inputs = w.findAll('input')
    const values = inputs.map(i => i.element.value)
    expect(values).toContain('亿轨星途')
    expect(values).toContain('京ICP备12345678号-1')
    // 两类备案号是两个独立的输入框（它们是两个备案体系，不能合成一栏）
    expect(values).toContain('川公网安备 51090002000169号')
    expect(values).toContain('© 2026 亿轨星途')
    // 公告是 textarea、每页条数是 el-input-number，值不在 input 的值列表里
    expect(w.find('textarea').element.value).toBe('今晚 22:00 例行维护')
    // ⚠️ el-input-number 的数字在 <input> 的 value 里，**不在**文本节点里 ——
    //    用 w.text() 找 "12" 是找不到的（第一版就是这么写的，用例红了才发现）
    expect(w.find('.el-input-number input').element.value).toBe('12')

    // 读成功时那句话是"说明"，不是错误
    expect(noticeOf(w).classes()).toContain('is-info')
  })

  it('读失败时【不清空表单】：保留已读到的内容，并说明这是读的问题', async () => {
    fetchMock.mockImplementation(() => Promise.resolve({ code: 500, message: '服务器内部错误', data: null }))
    const w = await mountPanel()

    // 表单里是默认值（不是空），用户不会以为"我填的东西丢了"
    expect(w.findAll('input').map(i => i.element.value)).toContain('亿轨星途')
    expect(noticeOf(w).classes()).toContain('is-error')
  })
})

describe('设置面板 —— 保存', () => {
  it('保存走 PUT /admin/setting，且字段名与类型逐字正确', async () => {
    const w = await mountPanel()

    await w.find('.toolbar .el-button--primary').trigger('click')
    await flushPromises()

    expect(lastMethodTo('/admin/setting')).toBe('PUT')
    expect(lastBodyTo('/admin/setting')).toEqual({
      siteName: '亿轨星途',
      announcement: '今晚 22:00 例行维护',
      commentEnabled: true,          // ⚠️ 布尔，不是 0/1（库里存 0/1，接口层是布尔）
      icpNumber: '京ICP备12345678号-1',
      policeNumber: '川公网安备 51090002000169号',
      copyright: '© 2026 亿轨星途',
      pageSize: 12,
    })
  })

  it('保存成功后：重读一次，并把提示变成成功', async () => {
    const w = await mountPanel()
    expect(callsTo('/setting')).toHaveLength(1)

    await w.find('.toolbar .el-button--primary').trigger('click')
    await flushPromises()

    // 重读一次：后端会做归一化，所以"提交的"和"库里的"不一定完全一样
    expect(callsTo('/setting')).toHaveLength(2)
    expect(noticeOf(w).classes()).toContain('is-ok')
  })

  it('⚠️ 站点名空着时【一个请求都不发】，并把原因留在面板上', async () => {
    const w = await mountPanel()

    const siteNameInput = w.findAll('input').find(i => i.element.value === '亿轨星途')
    await siteNameInput.setValue('   ')
    await w.find('.toolbar .el-button--primary').trigger('click')
    await flushPromises()

    // 不发请求（后端 @NotBlank 必然拒绝，本地先拦一道省一个来回）
    expect(callsTo('/admin/setting')).toHaveLength(0)
    // 而且原因要留在面板上 —— 只弹 toast 的话用户很容易以为"保存按钮坏了"
    expect(noticeOf(w).classes()).toContain('is-error')
    expect(noticeOf(w).text()).toContain('站点名不能为空')
  })

  it('后端拒绝时，把后端给的原因显示出来（而不是笼统一句"保存失败"）', async () => {
    fetchMock.mockImplementation((url) => {
      if (pathOf(url) === '/setting') return Promise.resolve(body(SETTINGS))
      return Promise.resolve({ code: 400, message: '每页条数最多 50（接口的分页上限）', data: null })
    })
    const w = await mountPanel()

    await w.find('.toolbar .el-button--primary').trigger('click')
    await flushPromises()

    expect(noticeOf(w).classes()).toContain('is-error')
    expect(noticeOf(w).text()).toContain('每页条数最多 50')
  })
})

describe('设置面板 —— 备案号与页脚那一块', () => {
  it('备案号的说明里有指向工信部的链接（这是备案要求的一部分）', async () => {
    const w = await mountPanel()

    const link = w.findAll('a').find(a => a.attributes('href')?.includes('beian.miit.gov.cn'))
    expect(link, '面板里应当说明"会自动链接到工信部备案系统"').toBeTruthy()
    // 外链一律带 target=_blank + rel=noopener（否则新开的页面能通过 window.opener 操作本页）
    expect(link.attributes('target')).toBe('_blank')
    expect(link.attributes('rel')).toContain('noopener')
  })

  it('公安备案号那一栏：说明里指向【公安部】平台，而不是工信部那个', async () => {
    // 【为什么这条要单独钉】两类备案的平台地址长得像（beian.miit.gov.cn / beian.mps.gov.cn），
    // 复制粘贴时最典型的错误就是把公安那一栏也写成工信部的地址 ——
    // 表现是"链接能点、页面也在，只是查的是另一个体系的备案"，肉眼几乎发现不了
    const w = await mountPanel()

    const link = w.findAll('a').find(a => a.attributes('href')?.includes('beian.mps.gov.cn'))
    expect(link, '公安备案号那一栏的说明里应当有指向公安部平台的链接').toBeTruthy()
    expect(link.attributes('href')).not.toContain('miit.gov.cn')
    expect(link.attributes('target')).toBe('_blank')
    expect(link.attributes('rel')).toContain('noopener')
  })

  it('每页条数的取值范围与后端一致（1 ~ 50）', async () => {
    const w = await mountPanel()
    const numberInput = w.find('.el-input-number input')
    // el-input-number 会把 min/max 收在自己的 props 里，这里断言说明文字里的范围
    expect(w.text()).toContain('1 ~ 50')
    expect(numberInput.element.value).toBe('12')
  })
})
