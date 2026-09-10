// ============================================================
// app/middleware/admin.ts —— 后台路由守卫
// 作用：访问 /admin 前检查是否已登录（有 token）。
//       没登录 -> 回首页 并 弹出登录弹窗。
// 关键词：defineNuxtRouteMiddleware = Nuxt 的"路由守卫"，每次进入该页面前执行。
// ============================================================
export default defineNuxtRouteMiddleware(() => {
  const token = useCookie('token')   // 读登录 token
  if (!token.value) {
    const { openLogin } = useAuthUi()  // 打开登录弹窗（共享状态）
    openLogin()
    return navigateTo('/')             // 跳回首页
  }
})
