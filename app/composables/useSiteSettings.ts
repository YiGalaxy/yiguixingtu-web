// ============================================================
// app/composables/useSiteSettings.ts
//
// 作用：**站点设置的唯一一份来源** —— 页眉的站点名、页脚的版权与备案号、
//       首页的公告与每页条数、文章页的评论开关，用的都是这里这一份。
//
// 【为什么是 useAsyncData 而不是 onMounted 里发请求 —— 这条最要紧】
//   这份数据驱动的是【整站的外壳】，而且是外壳里最不该"晚一步出现"的两样东西：
//     · 页脚的**备案号**：它是合规要求，必须出现在服务端渲染出的 HTML 里。
//       如果先在客户端渲染再补上，那么"爬虫/未执行 JS 的浏览器"看到的页脚是空的 ——
//       而备案检查恰好就是这么看的
//     · 页眉的**站点名**：它是页面的身份，晚一步出现会先闪一下空标题
//   useAsyncData 内部会注册 onServerPrefetch，服务端要把这份数据拿完才输出 HTML，
//   于是上面两样都在源码里（和导航里的分类是同一个道理，见 useCategoryList）。
//
// 【为什么要那段 getCachedData】
//   调用它的是两处：外壳（app.vue：页眉品牌名 + 页脚）和各个页面
//   （首页要公告与每页条数、文章页要评论开关）。同 key 的第二次调用
//   **不会**自动复用第一次的结果 —— Nuxt 默认的 getCachedData 在服务端只认
//   `nuxtApp.static.data`，不认本次请求里已经取到的 `payload.data`。
//   而外壳的 onServerPrefetch 会在子页面渲染之前就把数据拿完，于是页面那次调用
//   既赶不上"请求在飞"、也读不到缓存，结果就是**每次打开页面打两次 `/setting`**。
//   （坑与实测数字见 useCategoryList 里那段同样注释：默认 2 次 → 加上这段 1 次。）
//   边界同样划清：只在服务端复用本次请求的结果，`refresh` 类的调用一律绕过缓存 ——
//   否则"后台保存后让前台刷新"会拿到旧值。
//
// 【接口失败时怎么办】
//   归一化那边把"读不到"收拾成 {@link DEFAULT_SITE_SETTINGS}（就是上线前的站点表现），
//   所以这里**不需要** loading / error 分支：外壳永远有东西可渲染，
//   最差的情况是"页脚少了备案号"，而不是整页崩掉或空一块。
//   这也是为什么这个组合式函数只返回 settings 与 ready，没有 error。
// ============================================================

import { DEFAULT_SITE_SETTINGS, normalizeSiteSettings } from '~/utils/siteSettings'

export const useSiteSettings = () => {
  const { request } = useApi()

  const asyncData = useAsyncData('site-settings', async () => {
    const res = await request('/setting')
    // 【为什么这里不判 res.data 的类型】归一化函数本身就是干这个的：
    // 给它 null / 任何非对象都安全（见 siteSettings.ts 的文件头）
    return normalizeSiteSettings(res.ok ? res.data : null)
  }, {
    // 与 useCategoryList 同一段逻辑、同一个理由（外壳与页面都会调它）：
    // 只在服务端复用"本趟请求里已经取到的"那份，客户端保持 Nuxt 原本行为
    getCachedData: (key, nuxtApp, ctx) => {
      if (ctx?.cause === 'refresh:manual' || ctx?.cause === 'refresh:hook') return undefined
      if (import.meta.server) return nuxtApp.payload.data[key] ?? nuxtApp.static.data[key]
      return nuxtApp.static.data[key]
    },
  })

  /**
   * 站点设置（**形状永远完整**，用不着调用方再判空）。
   * 【为什么还要 ?? DEFAULT】服务端数据到位之前 data 是 undefined；
   * 有了这一层，模板里就能直接写 `settings.siteName` 而不用加可选链。
   */
  const settings = computed(() => asyncData.data.value ?? DEFAULT_SITE_SETTINGS)

  return { settings, ready: asyncData }
}
