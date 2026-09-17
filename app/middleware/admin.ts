// ============================================================
// app/middleware/admin.ts —— 后台路由守卫
// 作用：访问 /admin 前检查"有没有登录"以及"是不是管理员"。
// 关键词：defineNuxtRouteMiddleware = Nuxt 的"路由守卫"，每次进入该页面前执行。
// ============================================================
export default defineNuxtRouteMiddleware(() => {
  const token = useCookie('token')   // 读登录 token

  if (!token.value) {
    // 【为什么把"要弹登录框"写进 URL，而不是直接 openLogin()】
    //   openLogin() 改的是 useState('loginVisible') —— 那是【服务端进程内存里】的状态。
    //   而下面那句 navigateTo('/') 在 SSR 时是一条 302：浏览器收到的只有"去首页"，
    //   那个 state 根本不会随响应传下来。
    //   结果就是：直接输网址 / 书签 / 刷新进入 /admin 的未登录用户，
    //   只会被莫名弹回首页，既没有登录框、也没有任何提示；
    //   而"在站内点链接进来"那条 SPA 跳转路径却会正常弹窗 —— 同一个守卫两条路径两种行为。
    //   改成把意图放进 query、由首页去消费，两条路径就一致了。
    //   （文章详情页的 goTag() 也是用 query 传状态的，同一套做法。）
    return navigateTo({ path: '/', query: { login: '1' } })
  }

  // 【已登录但不是管理员：同样挡在门外】
  //   少了这一道会很难看：普通用户能进 /admin、SSR 出整个后台外壳，
  //   随后页面一次性发出的 5 个后台请求全部 403，而 useApi 对每一个都会弹一次
  //   "无权限访问" —— 进一次页面连弹 5 条，表格全空。
  //   这里直接给一个明确结果（退回首页），比让他对着一堆报错强。
  //
  //   ⚠️ 边界必须说清楚：user 是客户端异步取的（app.vue 里 onMounted 打 /auth/me），
  //      所以【首次直接访问 /admin】时它可能还没到，这道检查会暂时放行。
  //      这种情况由后端兜底（每个后台接口都有 @PreAuthorize）。
  //      也就是说：这条守卫的作用是"少让用户看一次报错"，【不是安全边界】——
  //      真正的安全边界始终在后端，前端这些判断都是体验优化。
  const user = useState('user')
  if (user.value && user.value.role !== 'ADMIN') {
    return navigateTo('/')
  }
})
