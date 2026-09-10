// ============================================================
// app/composables/useSeoMetaFor.ts
//
// 作用：页面级 SEO 元信息的**唯一入口**。页面只说一句"我是谁"，
//       拼装规则与站点地址都在 app/utils/seo.ts 里。
//
// 用法（首页）：
//   useSeoMetaFor(() => ({
//     path: '/',
//     description: SITE_DESCRIPTION,
//   }))
//
// 用法（文章详情页，标题要跟着数据走）：
//   useSeoMetaFor(() => ({
//     path: `/article/${route.params.id}`,
//     title: article.value?.title,
//     description: article.value?.summary,
//     type: 'article',
//     image: article.value?.cover,
//   }))
//
// 【为什么参数是一个「函数」而不是一个对象】
//   文章详情页在数据回来之前是拿不到标题和封面的，所以这些值必须能【变】。
//   传函数（getter）之后，useSeoMetaFor 内部用 computed 包一层，
//   unhead 在解析标签时会重新取值 —— title 从"站点默认标题"变成文章标题、
//   封面到了之后 og:image 才出现，全都自动发生，页面里不用写 watch。
//
// 【为什么用 computed 包起来再交给 useHead，而不是每个字段各写一个 computed】
//   拼装是"整体"的：description 空不空决定它用不用站点默认描述、
//   有没有封面决定 og:image 这条 meta 存不存在。
//   分散到字段上会变成"每个字段各自兜底"，规则很快就会不一致。
//
// 【为什么不直接调 Nuxt 的 useSeoMeta】
//   useSeoMeta 走的是"扁平键名 → 标签"的映射（ogTitle → og:title），
//   而我们的规则里有一条是"没有封面就**整条** og:image 都不出现"——
//   这种"键可以不存在"的逻辑用显式 meta 数组表达最直白，
//   也更好测（断言数组里有没有这一项，而不是断言某个键是不是 undefined）。
//
// 关键字：
//   · useRuntimeConfig() 是 Nuxt 的运行时配置：public.siteUrl 由
//     nuxt.config.ts 提供默认值，可用环境变量 NUXT_PUBLIC_SITE_URL 覆盖，
//     所以"本地 / 测试域名 / 正式域名"不需要改代码
//   · useHead（unhead）的输入里可以放 ref / computed，服务端渲染会解包后才写进 HTML
// ============================================================

export const useSeoMetaFor = (input) => {
  // useRuntimeConfig / useHead 都依赖 Nuxt 上下文，必须在 setup 阶段取好
  const config = useRuntimeConfig()

  /**
   * 读出站点地址。
   * 【为什么在这里读、而不是让页面自己传】全站只有一个站点地址，
   * 让每个页面各读一次配置等于把"从哪里读"这件事复制了三遍；
   * 而且归一化（去尾斜杠、非法值回落）在 app/utils/seo.ts 里只有一套。
   */
  const siteUrl = computed(() => normalizeSiteUrl(config.public.siteUrl))

  // 整体拼装的结果。input 是 getter，所以它依赖的数据一变就会重算，
  // unhead 会跟着更新 head（服务端渲染时也会解包后写进 HTML）
  const head = computed(() => buildSeoHead({ ...input(), siteUrl: siteUrl.value }))

  // 【为什么要拆成三个 computed 交给 useHead】unhead 的输入对象里每个值
  // 都可以是 ref；整块换掉（直接传 computed 对象）它反而不会按字段解包。
  // 这样写还有一个好处：meta / link 的数组是"新算出来的一份"，
  // 不会被 unhead 或调用方就地改坏。
  useHead({
    title: computed(() => head.value.title),
    htmlAttrs: computed(() => head.value.htmlAttrs),
    meta: computed(() => head.value.meta),
    link: computed(() => head.value.link),
  })

  return { head }
}
