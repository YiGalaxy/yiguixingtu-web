import { describe, it, expect, beforeEach } from 'vitest'

// =====================================================================
// useAuthUi 的单元测试
//
// 【这个 composable 只有 20 行，为什么值得单独测】
//   它是登录/注册弹窗的全局开关（useState 共享状态）。
//   两个弹窗的"互斥"是它唯一但关键的不变量：
//   如果 openRegister 忘了把 loginVisible 关掉，
//   用户会同时看到两个弹窗叠在一起 —— 这种界面 bug 靠肉眼回归很容易漏，
//   但用一行断言就能永久钉住。
// =====================================================================

describe('useAuthUi', () => {
  beforeEach(() => {
    // useState 是全局共享的，前一个用例留下的状态会带到这里，
    // 所以每个用例开始前先关干净
    useAuthUi().closeAll()
  })

  it('初始状态_should两个弹窗都关着', () => {
    const { loginVisible, registerVisible } = useAuthUi()
    expect(loginVisible.value).toBe(false)
    expect(registerVisible.value).toBe(false)
  })

  it('openLogin_should打开登录弹窗并关掉注册弹窗', () => {
    const { loginVisible, registerVisible, openRegister, openLogin } = useAuthUi()
    openRegister()
    expect(registerVisible.value).toBe(true)

    openLogin()

    expect(loginVisible.value).toBe(true)
    // 互斥：注册必须被关掉，否则两个弹窗会叠在一起
    expect(registerVisible.value).toBe(false)
  })

  it('openRegister_should打开注册弹窗并关掉登录弹窗', () => {
    const { loginVisible, registerVisible, openLogin, openRegister } = useAuthUi()
    openLogin()
    expect(loginVisible.value).toBe(true)

    openRegister()

    expect(registerVisible.value).toBe(true)
    expect(loginVisible.value).toBe(false)
  })

  it('closeAll_should把两个弹窗都关掉', () => {
    const { loginVisible, registerVisible, openLogin, closeAll } = useAuthUi()
    openLogin()
    expect(loginVisible.value).toBe(true)

    closeAll()

    expect(loginVisible.value).toBe(false)
    expect(registerVisible.value).toBe(false)
  })

  it('多次调用 useAuthUi_should拿到同一份状态', () => {
    // 这一点很重要：app.vue 里的弹窗、顶部导航的按钮、index.vue 的按钮
    // 分处不同组件，靠的就是"同名 useState key 全局共享一份"
    const a = useAuthUi()
    const b = useAuthUi()

    a.openLogin()

    expect(b.loginVisible.value).toBe(true)
  })

  it('闭包里的方法_should在状态改变后仍然操作同一份数据', () => {
    // 先取一次方法，之后再用新一次 useAuthUi() 读状态，
    // 验证方法操作的不是某次的快照
    const { openLogin } = useAuthUi()
    openLogin()

    const { loginVisible } = useAuthUi()
    expect(loginVisible.value).toBe(true)
  })
})
