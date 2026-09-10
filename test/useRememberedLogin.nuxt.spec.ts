import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import AppShell from '~/app.vue'

// =====================================================================
// 「记住密码 / 记住用户名」的 cookie
//
// 【为什么要为这几行代码写这么多用例】
//   改之前它把**明文密码**写进了 rememberMe 这个 cookie（安全审查的 🔴）：
//     · cookie 不是 httpOnly，一段注入页面的脚本读一下 document.cookie 就拿到了
//     · 它还会随每个同域请求发给服务端与反向代理，日志和抓包里都是明文
//     · 后端根本没有"用记住的密码自动登录"的接口，也就是说这个密码存下来
//       除了留一个泄露点之外没有任何用途
//   这类问题最麻烦的地方是【改完代码不等于修好了】：
//   老用户浏览器里那个带密码的 cookie 不会自己消失，所以必须主动改写它。
//   用例分成三层：
//     ① 纯函数：写进 cookie 的值到底长什么样（只允许有 username）
//     ② 组合式函数：回填、保存、清除、发现老 cookie 就重写
//     ③ 挂载整个应用外壳：真实路径上，cookie 里确实没有密码、输入框里只回填了用户名
// =====================================================================

const { fetchMock, cookieRefs } = vi.hoisted(() => ({ fetchMock: vi.fn(), cookieRefs: {} }))
mockNuxtImport('$fetch', () => fetchMock)

// 【要用真的 ref】app.vue 的模板里有 `v-if="token"`，Vue 只对真的 ref 做自动解包；
// 换成普通对象的话它永远是真值，顶栏会一直按"已登录"渲染（找不到「登录」按钮）
mockNuxtImport('useCookie', () => (name) => {
  if (!cookieRefs[name]) cookieRefs[name] = ref(null)
  return cookieRefs[name]
})

const { navigateToMock } = vi.hoisted(() => ({ navigateToMock: vi.fn() }))
mockNuxtImport('navigateTo', () => navigateToMock)

const { errorSpy, successSpy } = vi.hoisted(() => ({ errorSpy: vi.fn(), successSpy: vi.fn() }))
vi.mock('element-plus', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, ElMessage: { ...actual.ElMessage, error: errorSpy, success: successSpy } }
})

/** 明文密码就用这几个字，好在断言里做字符串检查（"cookie 里不许出现它"） */
const SECRET = 'MySecretP@ssw0rd'

/** 挂载整个应用外壳（登录弹窗在外壳里，不在任何页面里） */
const mountShell = async () => {
  const wrapper = await mountSuspended(AppShell, {
    global: { stubs: { NuxtPage: true, NuxtRouteAnnouncer: true } },
  })
  await flushPromises()
  return wrapper
}

/** 点导航栏的「登录」打开弹窗（真实入口） */
const openLoginDialog = async (wrapper) => {
  await wrapper.find('.nav-right .nav-btn').trigger('click')
  await flushPromises()
}

/** 登录表单里的两个输入框（el-input 内部就是原生 input） */
const loginInputs = (wrapper) => wrapper.findAll('.auth-form input')

describe('记住用户名 · 纯函数（写进 cookie 的值长什么样）', () => {
  it('构造出来的值_should只含 username，没有 password', () => {
    const value = buildRememberCookie('alice')

    expect(value).toEqual({ username: 'alice' })
    // 白名单式断言：以后谁往这里加字段（比如"顺手也存个密码吧"）都会立刻红
    expect(Object.keys(value)).toEqual(['username'])
    expect(JSON.stringify(value)).not.toContain('password')
  })

  it('用户名为空或全空白_should返回 null（宁可不记，也不要写一个空壳）', () => {
    expect(buildRememberCookie('')).toBe(null)
    expect(buildRememberCookie('   ')).toBe(null)
    expect(buildRememberCookie(undefined)).toBe(null)
  })

  it('读用户名_should兼容对象、JSON 字符串、纯字符串三种形态', () => {
    // 我们在本机写进去的一定是对象；但 useCookie 在不同版本/环境下
    // 可能不做 JSON 解码，所以这三种都得认
    expect(readRememberedUsername({ username: 'alice' })).toBe('alice')
    expect(readRememberedUsername('{"username":"alice","password":"x"}')).toBe('alice')
    expect(readRememberedUsername('alice')).toBe('alice')
    expect(readRememberedUsername(null)).toBe('')
    expect(readRememberedUsername('{坏掉的 json')).toBe('')
  })

  it('老格式识别_should把带 password 的 cookie 认出来（无论对象还是字符串）', () => {
    expect(hasLegacyFields({ username: 'alice', password: SECRET })).toBe(true)
    expect(hasLegacyFields(`{"username":"alice","password":"${SECRET}"}`)).toBe(true)
    // 只多出一个我们不认识的字段同样算老格式（白名单之外一律重写）
    expect(hasLegacyFields({ username: 'alice', nickname: '小星' })).toBe(true)
  })

  it('新格式_should不算老格式（否则每次挂载都会白写一次 cookie）', () => {
    expect(hasLegacyFields({ username: 'alice' })).toBe(false)
    expect(hasLegacyFields(null)).toBe(false)
  })
})

describe('记住用户名 · 组合式函数', () => {
  beforeEach(() => {
    for (const key of Object.keys(cookieRefs)) cookieRefs[key].value = null
  })

  it('保存_should把 cookie 写成只含用户名、并返回一个可回填的用户名', () => {
    const { remember, username, save } = useRememberedLogin()

    save('alice')

    expect(remember.value).toBe(true)
    expect(username.value).toBe('alice')
    expect(cookieRefs[REMEMBER_COOKIE_NAME].value).toEqual({ username: 'alice' })
  })

  it('保存时传入的对象带密码_should也不会把密码写进 cookie（值的形状由构造决定）', () => {
    const { save } = useRememberedLogin()

    // 模拟"调用方不小心把整个表单传进来"这种写法
    save({ username: 'alice', password: SECRET })

    // 对象会被当成"不是字符串"→ 不写任何东西，而不是把密码写进去
    expect(cookieRefs[REMEMBER_COOKIE_NAME].value).toBe(null)
  })

  it('回填_should只回填用户名（老的带密码 cookie 里也读不出密码）', () => {
    cookieRefs[REMEMBER_COOKIE_NAME].value = { username: 'alice', password: SECRET }

    const { username, remember, restore } = useRememberedLogin()
    const result = restore()

    expect(result.username).toBe('alice')
    expect(result.remember).toBe(true)
    // 关键：老 cookie 被主动改写掉了 —— "修完代码但老 cookie 还在"等于没修
    expect(result.migrated).toBe(true)
    expect(cookieRefs[REMEMBER_COOKIE_NAME].value).toEqual({ username: 'alice' })
    expect(JSON.stringify(cookieRefs[REMEMBER_COOKIE_NAME].value)).not.toContain(SECRET)
    expect(JSON.stringify(cookieRefs[REMEMBER_COOKIE_NAME].value)).not.toContain('password')
    expect(username.value).toBe('alice')
    expect(remember.value).toBe(true)
  })

  it('回填时遇到 JSON 字符串形态的老 cookie_should也把它改写成对象（并丢掉密码）', () => {
    cookieRefs[REMEMBER_COOKIE_NAME].value = `{"username":"alice","password":"${SECRET}"}`

    const { restore } = useRememberedLogin()
    const result = restore()

    expect(result.username).toBe('alice')
    expect(result.migrated).toBe(true)
    expect(cookieRefs[REMEMBER_COOKIE_NAME].value).toEqual({ username: 'alice' })
    expect(String(cookieRefs[REMEMBER_COOKIE_NAME].value)).not.toContain(SECRET)
  })

  it('回填时遇到新格式_should不改写 cookie（不要在每次挂载时做无意义的写入）', () => {
    cookieRefs[REMEMBER_COOKIE_NAME].value = { username: 'alice' }

    const { restore } = useRememberedLogin()
    const result = restore()

    expect(result.migrated).toBe(false)
    expect(cookieRefs[REMEMBER_COOKIE_NAME].value).toEqual({ username: 'alice' })
  })

  it('没有 cookie 时_should什么也不回填、勾选框保持不勾', () => {
    const { username, remember, restore } = useRememberedLogin()
    const result = restore()

    expect(result).toEqual({ username: '', remember: false, migrated: false })
    expect(username.value).toBe('')
    expect(remember.value).toBe(false)
    expect(cookieRefs[REMEMBER_COOKIE_NAME].value).toBe(null)
  })

  it('清除_should把 cookie 删干净（不是"留着但不用"）', () => {
    cookieRefs[REMEMBER_COOKIE_NAME].value = { username: 'alice' }

    const { username, remember, clear } = useRememberedLogin()
    clear()

    expect(cookieRefs[REMEMBER_COOKIE_NAME].value).toBe(null)
    expect(username.value).toBe('')
    expect(remember.value).toBe(false)
  })
})

describe('记住用户名 · 整个应用外壳', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    navigateToMock.mockReset()
    errorSpy.mockReset()
    successSpy.mockReset()
    for (const key of Object.keys(cookieRefs)) cookieRefs[key].value = null
  })

  it('浏览器里躺着一条带明文密码的老 cookie_should在挂载时就被清掉', async () => {
    // 这一条就是"升级之后老 cookie 还在"的场景：只改代码不改数据 = 没修
    cookieRefs[REMEMBER_COOKIE_NAME].value = { username: 'alice', password: SECRET }

    await mountShell()

    const stored = cookieRefs[REMEMBER_COOKIE_NAME].value
    expect(JSON.stringify(stored)).not.toContain(SECRET)
    expect(JSON.stringify(stored)).not.toContain('password')
    expect(stored).toEqual({ username: 'alice' })
  })

  it('挂载时_should只回填用户名，密码框保持空的', async () => {
    cookieRefs[REMEMBER_COOKIE_NAME].value = { username: 'alice', password: SECRET }

    const wrapper = await mountShell()
    await openLoginDialog(wrapper)

    const inputs = loginInputs(wrapper)
    expect(inputs[0].element.value).toBe('alice')
    // 密码【不回填】：无从回填（cookie 里已经没有它了）。
    // 原来这一格会自动填上明文密码，等于把密码长期摆在屏幕上
    expect(inputs[1].element.value).toBe('')
  })

  it('勾选「记住用户名」并登录成功_should只把用户名写进 cookie', async () => {
    fetchMock.mockResolvedValue({ code: 200, data: { token: 'good-token', username: 'alice', role: 'ADMIN' } })

    const wrapper = await mountShell()
    await openLoginDialog(wrapper)
    const inputs = loginInputs(wrapper)
    await inputs[0].setValue('alice')
    await inputs[1].setValue(SECRET)
    await wrapper.find('.auth-row .el-checkbox__original').setValue(true)

    await wrapper.find('.auth-submit').trigger('click')
    await flushPromises()

    expect(successSpy).toHaveBeenCalled()
    const stored = cookieRefs[REMEMBER_COOKIE_NAME].value
    // 字符串断言：写进去的东西里不许出现那个密码
    expect(JSON.stringify(stored)).not.toContain(SECRET)
    expect(Object.keys(stored)).toEqual(['username'])
    expect(stored.username).toBe('alice')
  })

  it('没勾「记住用户名」_should把 cookie 删掉而不是留着旧值', async () => {
    cookieRefs[REMEMBER_COOKIE_NAME].value = { username: 'old-user' }
    fetchMock.mockResolvedValue({ code: 200, data: { token: 'good-token', username: 'alice', role: 'ADMIN' } })

    const wrapper = await mountShell()
    await openLoginDialog(wrapper)
    // 不勾（挂载时因为 cookie 里有 old-user 而是勾上的，这里点掉它，
    // 模拟"用户不想被记住"）
    await wrapper.find('.auth-row .el-checkbox__original').setValue(false)

    const inputs = loginInputs(wrapper)
    await inputs[1].setValue(SECRET)
    await wrapper.find('.auth-submit').trigger('click')
    await flushPromises()

    expect(cookieRefs[REMEMBER_COOKIE_NAME].value).toBe(null)
  })
})
