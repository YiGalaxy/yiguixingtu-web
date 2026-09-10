// ============================================================
// app/composables/useAuthUi.ts
// 作用：登录/注册弹窗的"开关"，做成全局共享状态(useState)，
//       这样顶部导航和首页按钮都能打开同一个弹窗。
// 关键词：useState = Nuxt 的"全局响应式状态"，同名 key 全局共享一份。
// ============================================================
export const useAuthUi = () => {
  // 两个开关：false=关，true=开
  const loginVisible = useState('loginVisible', () => false)
  const registerVisible = useState('registerVisible', () => false)

  // 打开登录弹窗（同时关掉注册）
  const openLogin = () => {
    loginVisible.value = true
    registerVisible.value = false
  }
  // 打开注册弹窗（同时关掉登录）
  const openRegister = () => {
    registerVisible.value = true
    loginVisible.value = false
  }
  // 全部关闭
  const closeAll = () => {
    loginVisible.value = false
    registerVisible.value = false
  }

  // 出口：谁调用 useAuthUi() 都能拿到这两个开关和打开/关闭方法
  return { loginVisible, registerVisible, openLogin, openRegister, closeAll }
}
