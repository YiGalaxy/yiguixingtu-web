// ============================================================
// app/composables/useCategoryList.ts
//
// 作用：**分类列表的唯一一份来源** —— 导航栏「文章」下拉里的分类、首页筛选条里的分类，
//       以及列表标题里那个分类名，用的都是这里这一份。
//
// 【为什么要共享一份，而不是各页各调一次】
//   ① 这两处本来就该显示同一批分类。各调各的，最容易出的不是"少一个分类"，
//      而是**两份数据不一致**（一处已经刷新、另一处还是旧的），
//      而这种不一致在界面上几乎看不出来。
//   ② 少发一次请求：`useAsyncData` 的 key 相同就是同一份数据（Nuxt 内部按 key
//      去重，第二个调用只是把依赖计数 +1，不会重新请求）。所以外壳（`app.vue`）
//      与首页（`pages/index.vue`）一起用它，一个页面只打一次 `GET /category/list`。
//
// 【为什么用 useAsyncData，而不是 onMounted 里发请求 —— 这条最要紧】
//   它是**服务端渲染时就会去拿**的那一个：useAsyncData 内部会注册 onServerPrefetch，
//   服务端要把这份数据拿完才输出 HTML。所以爬虫抓到的页面里，「文章」下拉里的分类
//   是**真实存在、可爬的内链**，而不是一个空壳（空壳等于"导航里的分类永远不会被收录"）。
//   【服务端能等、客户端不能等】就是 SSR 与"挂载后再去拿"的分水岭。
//
// 【为什么还要 ready 这个返回值】
//   服务端渲染时 `useAsyncData` 返回的是一个 Promise（字段挂在它身上），
//   调用方 `await` 它会等数据真的到位；客户端它是个普通对象，await 一个非 Promise
//   也是安全的（立刻返回）。首页把那几份首屏数据一起 `await Promise.all([...])`，
//   就是为了"这一帧就是服务端渲染出来的那一帧"。
// ============================================================
export const useCategoryList = () => {
  const { request } = useApi()

  const asyncData = useAsyncData('category-list', async () => {
    const res = await request('/category/list')
    // 【为什么用 Array.isArray 兜一道】这个数组会被 v-for / map / find 用到，
    // 后端结构一变（比如以后改成 `{ records: [...] }` 这种分页结构）就会抛
    // "xxx is not a function"，把整页渲染带崩。兜成空数组最差只是不显示分类。
    return res.ok && Array.isArray(res.data) ? res.data : []
  }, {
    /**
     * 【这十行是被真实 SSR 跑出来的，不是抄的 —— 也是这一批唯一一个"看起来没问题、
     *   实际每次打开首页都白打一次接口"的坑】
     *
     * 情况：外壳（app.vue，导航里的「文章」下拉）与首页（pages/index.vue，筛选条）
     *   各调一次这个组合式函数。同 key 的第二次调用**不会**自动复用第一次的结果 ——
     *   因为 Nuxt 默认的 getCachedData 在**服务端**只认 `nuxtApp.static.data`
     *   （预渲染载荷），不认 `payload.data`（本次请求里已经取到的数据）。
     *   而 app.vue 是外壳，它的 onServerPrefetch 会在子页面渲染**之前**就把数据拿完，
     *   所以首页那次调用既赶不上"请求在飞"（复用不了），也读不到缓存（被忽略）——
     *   结果就是每次打开首页打两次 `GET /category/list`。
     *
     * 实测（build 之后真起一个服务端、用一个会记请求数的桩后端）：
     *   · 默认行为：首页 `/category/list` 被请求 **2** 次
     *   · 加上这段 getCachedData：**1** 次；归档页等其它页面本来就是 1 次，不受影响
     *
     * 做法就是"本次请求里已经有人取过了就直接用"，但边界划得很清楚：
     *   · **只在服务端**这么做（`import.meta.server`）。`payload.data` 是"这一趟请求的结果"，
     *     每趟请求都是一个新实例、新的空 payload，所以**不会跨请求变旧**。
     *     客户端保持 Nuxt 原本的行为（再进首页会重新取一次），免得出现
     *     "分类改了、但整个 SPA 会话里都还是旧的、只有刷新才生效"。
     *   · `refresh:manual` / `refresh:hook` 这两种 cause 一律不走缓存 ——
     *     否则 `refresh()` 会拿到旧值，表现是"点了刷新没反应"，比多打一次接口糟糕得多。
     */
    getCachedData: (key, nuxtApp, ctx) => {
      if (ctx?.cause === 'refresh:manual' || ctx?.cause === 'refresh:hook') return undefined
      if (import.meta.server) return nuxtApp.payload.data[key] ?? nuxtApp.static.data[key]
      return nuxtApp.static.data[key]
    },
  })

  /**
   * 分类数组（**永远是数组**，用不着调用方再判一次）。
   * 【为什么这里再兜一次】服务端数据到位之前 `data` 是 undefined；
   * 到位之后它是后端的原始值，也仍然可能不是数组（见上面那条）。
   */
  const categories = computed(() => (Array.isArray(asyncData.data?.value) ? asyncData.data.value : []))

  return { categories, ready: asyncData }
}
