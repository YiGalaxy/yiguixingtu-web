// ============================================================
// app/composables/useArticleFilter.ts
// 作用：首页的「筛选条件」（关键词 + 分类）状态，并把它和地址栏的 query 双向同步。
//       最终产出两个东西：① 页面上要显示的状态 ② 发给后端 /article/page 的参数。
//
// 【为什么不直接写在 index.vue 里，要单独抽一个 composable】
//   这段逻辑有三个容易写错、又不容易在界面上发现的点：
//     ① 防抖：不防抖的话每敲一个字就要发一次 /article/page（后端对这个接口还有
//        300 次/分钟的限流），同时把地址栏改一次 —— 打字快的人十几秒就能刷掉一大截额度
//     ② 双向同步：URL ⇄ 状态。只做一个方向就会出现「地址栏是 ?keyword=nuxt、
//        输入框却是空的」；用户按浏览器后退时会觉得后退失灵了
//     ③ 空值：写成 ?keyword=&categoryId= 这种空参数，既难看，
//        又让「语义相同」的地址变成两条不同的历史记录
//   抽出来之后可以脱离页面直接断言（见 test/useArticleFilter.nuxt.spec.ts），
//   index.vue 只管渲染。
//
// 【为什么把「读写 URL」做成注入进来的两个函数，而不是内部直接 useRoute/useRouter】
//   这是踩过的坑：测试里用 mockNuxtImport 把 useRouter 整个换成假的之后，
//   Nuxt 自己的内部插件（nuxt/dist/app/plugins/navigation-repaint.client.js）
//   拿到的也是这个假 router，它在 onNuxtReady 时调用 router.beforeResolve，
//   于是整个测试文件直接起不来：
//     TypeError: router.beforeResolve is not a function
//   所以这里把「读 query」「写 query」做成【注入点】：
//     · 生产环境：useArticleFilter() 注入真实的 route / router
//     · 测试：注入一个 ref + 一个 spy，既不碰 Nuxt 内部，也不用起真路由
//   这也是「面向依赖」而不是「面向全局单例」的写法 —— 纯逻辑因此可以单独验证。
//
// 关键词：
//   · 防抖（debounce）= 连续触发时只让最后一次真正执行
//   · MaybeRefOrGetter = Vue 的类型约定，表示「ref 或返回该值的函数」，
//     两种写法都能被 watch 追踪（这里两种都会接受，见下面的 toValue）
// ============================================================

/** 搜索输入的防抖时长（毫秒）：停止输入 300ms 后才认为「输完了」 */
export const SEARCH_DEBOUNCE_MS = 300

/**
 * route.query 里同一个键可能出现两次（?keyword=a&keyword=b），
 * 这时 vue-router 给的是【数组】而不是字符串。
 * 统一在这里取第一个，别让「数组」这种类型漏到业务代码里。
 */
const firstValue = (value) => (Array.isArray(value) ? value[0] : value)

/**
 * 关键词归一化：只接受字符串，其余（undefined / null / 数字）一律当空串；
 * 并且去掉首尾空格 —— 否则 "nuxt" 和 "nuxt " 会变成两条不同的 URL 与两条后端缓存。
 */
export const normalizeKeyword = (value) => {
  const raw = firstValue(value)
  return typeof raw === 'string' ? raw.trim() : ''
}

/**
 * 分类 ID 归一化：只接受【正整数】。
 * 'abc' / '0' / '-1' / '' / undefined 一律当成「没有选分类」（返回 null）。
 * 【为什么要卡这么死】categoryId 是从地址栏来的、用户可以直接改，
 * 一个 "abc" 传下去后端解析 Long 会报 400，页面就成了一片空白；
 * 转成 null 相当于「不按分类过滤」，最多是筛选没生效，不会把页面打挂。
 */
export const normalizeCategoryId = (value) => {
  const raw = firstValue(value)
  if (raw === undefined || raw === null || raw === '') return null
  const num = Number(raw)
  return Number.isInteger(num) && num > 0 ? num : null
}

/**
 * 纯函数：地址栏 query → 筛选状态。
 * 【为什么坚持写成纯函数】它不需要任何 Nuxt 上下文，因此既可以在测试里直接断言，
 * 也可以在 setup 之外使用（将来若要做「服务端渲染的分类页」同样能复用）。
 */
export const parseArticleFilter = (query) => ({
  keyword: normalizeKeyword(query?.keyword),
  categoryId: normalizeCategoryId(query?.categoryId),
})

/**
 * 纯函数：筛选状态 → 要写进地址栏的 query。
 *
 * 【为什么空值一律不写】
 *   `?keyword=&categoryId=` 这种地址既难看，又会让「什么都没筛」有两种写法，
 *   历史记录和后端缓存都会多存一份；不写，才只有一种表示。
 *
 * 【为什么 categoryId 要转成字符串】
 *   route.query 的值只有 string / string[] 两种类型，写数字进去 vue-router 也会
 *   转成字符串；这里显式转换，免得测试断言和真实行为对不上。
 */
export const toArticleQuery = ({ keyword, categoryId } = {}) => {
  const query = {}

  const kw = normalizeKeyword(keyword)
  if (kw) query.keyword = kw

  // 注意判断用的是 null / undefined 而不是「假值」：
  // 分类 ID 都是正整数，用 `if (categoryId)` 会不小心把 0 或 '' 也当成有值
  if (categoryId !== null && categoryId !== undefined) query.categoryId = String(categoryId)

  return query
}

/**
 * 纯函数：筛选状态 + 分页 → 后端 GET /article/page 的请求参数。
 *
 * 【为什么空字符串不发给后端】
 *   后端 ArticleQuery.keyword 用 StringUtils.hasText 判断，空串等价于「不筛」，
 *   结果一样；但不发出去能让请求更像「真的没筛」，日志和缓存 key 都干净。
 *   categoryId 直接传数字，交给 $fetch 序列化（?categoryId=2）。
 */
export const toArticleParams = ({ keyword, categoryId, page, size } = {}) => {
  const params = { page, size }

  const kw = normalizeKeyword(keyword)
  if (kw) params.keyword = kw
  if (categoryId !== null && categoryId !== undefined) params.categoryId = categoryId

  return params
}

/**
 * 两份 query 是否等价（只看我们管的这两个键）。
 * 【为什么不能直接比较对象】对象每次都是新建的，引用永远不同；
 * 逐个键比字符串才是「地址栏是否需要改动」的正确判据。
 */
const isSameQuery = (currentQuery, nextQuery) => {
  const current = toArticleQuery(parseArticleFilter(currentQuery))
  const keys = new Set([...Object.keys(current), ...Object.keys(nextQuery)])
  return [...keys].every((key) => current[key] === nextQuery[key])
}

/**
 * 筛选状态的核心逻辑（与 Nuxt 无关，方便单测）。
 *
 * @param {object}   options
 * @param {*}        options.querySource   读当前 query 的 ref 或 getter（会保持响应式）
 * @param {Function} options.replaceUrl    写 query 的函数，收到 toArticleQuery() 的结果
 * @param {number}   [options.debounceMs]  防抖时长，默认 SEARCH_DEBOUNCE_MS
 */
export const createArticleFilter = ({
  querySource,
  replaceUrl,
  debounceMs = SEARCH_DEBOUNCE_MS,
}) => {
  // 起始值直接从 query 里读：刷新页面、或者别人甩一条带参数的链接过来时，
  // 看到的还是当时那批文章，而不是悄悄变回「全部」
  const initial = parseArticleFilter(toValue(querySource))

  /**
   * 【为什么关键词要分成两个变量 —— 防抖的本质就在这一对里】
   *   keywordInput：输入框里的内容，用户敲一下就变一次（即时，绝不延迟，
   *                 否则打字会"卡"，光标和文字对不上）
   *   keyword     ：【生效中】的关键词，请求与地址栏只认它，它只在用户停手
   *                 debounceMs 之后才被赋值
   *
   * 反例（第一版就是这么写的）：只把"写地址栏"防抖，请求却盯着输入框，
   * 结果每敲一个字照样发一次 /article/page —— 防抖等于没做：
   * 后端 300 次/分钟的限流照打，用户每敲一个字还得等一次网络往返。
   * 所以防抖只在【输入 → 生效】这一步做一次，下游（请求、地址栏、标题）读到的
   * 永远是同一个已经定下来的值。
   */
  const keywordInput = ref(initial.keyword)
  const keyword = ref(initial.keyword)
  const categoryId = ref(initial.categoryId)

  // 定时器只在防抖期间存在；用普通变量而不是 ref —— 它不参与渲染，
  // 放进响应式只会多触发一轮无关的更新
  let timer = null

  /** 把当前【已生效】的筛选条件写进地址栏（用 replace 而不是 push，理由见下） */
  const applyUrl = () => {
    const next = toArticleQuery({ keyword: keyword.value, categoryId: categoryId.value })

    // 【这一行同时挡掉两种重复写入】
    //   ① 值没变：比如连点两次同一个分类
    //   ② 状态是被地址栏回写出来的：watch 的回调是【异步 flush】的，
    //      等它跑起来时地址栏已经是目标值了，于是必然在这里提前返回，
    //      不会出现「后退 → 又往前写一次」的循环
    if (isSameQuery(toValue(querySource), next)) return

    // 用 replace 而不是 push：搜索是「连续微调」的操作（打字、换分类），
    // 每个中间状态都进历史记录的话，用户按一次后退只能退回上一个关键词，
    // 想离开首页得按十几次。代价是后退不会回到上一个筛选条件。
    replaceUrl(next)
  }

  /** 把输入框里的内容变成"生效中"的关键词（回车、或防抖到点时调用） */
  const commitKeyword = () => {
    clearTimeout(timer)
    timer = null
    // 先归一化再赋值：首尾空格不影响请求，也不该在地址栏里留下 %20
    const next = normalizeKeyword(keywordInput.value)
    if (next !== keywordInput.value) keywordInput.value = next
    keyword.value = next
  }

  /**
   * 敲字属于连续事件：每敲一下都重置定时器，只有停手 debounceMs 才真正生效。
   * （真正开始下一次请求、改地址栏，是 keyword 变化之后的事）
   */
  const scheduleCommit = () => {
    clearTimeout(timer)
    timer = setTimeout(commitKeyword, debounceMs)
  }

  watch(keywordInput, scheduleCommit)

  // keyword 已经是【防抖之后】的值，所以这里不必再防抖：
  // 关键词和分类谁变了都立刻写地址栏。两个 ref 在同一个 tick 里一起改时
  // （例如"点分类前先把待生效的关键词落地"），Vue 的 watcher 会合并成一次回调，
  // 所以地址栏只被改一次，不会闪。
  watch([keyword, categoryId], applyUrl)

  /**
   * 地址栏自己变了（浏览器前进/后退，或别处用 navigateTo 改了 query）→ 同步回状态。
   * 少这一步，输入框就会和地址栏各说各话：地址栏回到 ?keyword=nuxt，
   * 输入框还停在刚才输的别的词上，用户再按一次回车就像"什么都没发生"。
   * 两个变量都要写：只改 keyword 的话，输入框里还留着旧的字。
   */
  watch(querySource, () => {
    const parsed = parseArticleFilter(toValue(querySource))
    if (parsed.keyword !== keywordInput.value) keywordInput.value = parsed.keyword
    if (parsed.keyword !== keyword.value) keyword.value = parsed.keyword
    if (parsed.categoryId !== categoryId.value) categoryId.value = parsed.categoryId
  })

  // 组件卸载后定时器还在跑的话，会往一个已经销毁的组件上写状态，还会白改一次地址栏
  onScopeDispose(() => clearTimeout(timer))

  /**
   * 点分类：null 表示「全部」。
   * 【为什么要先 commitKeyword】用户可能"刚打完关键词还没停手就点了分类"，
   * 此刻 keyword 还是旧值。先把输入框里的内容落地，两个条件才会在同一次
   * 地址栏写入 / 同一次请求里一起生效，而不是先按旧关键词拉一遍、300ms 后再拉一遍。
   */
  const selectCategory = (id) => {
    if (keyword.value !== normalizeKeyword(keywordInput.value)) commitKeyword()
    categoryId.value = id
  }

  /** 一键清掉全部筛选条件（搜索框的 ✕、「清除筛选」都用它） */
  const clearAll = () => {
    clearTimeout(timer)
    timer = null
    keywordInput.value = ''
    keyword.value = ''
    categoryId.value = null
  }

  /** 当前是否有生效的筛选条件：标题文案、空状态文案、清除按钮都看它 */
  const isFiltered = computed(() => Boolean(keyword.value) || categoryId.value !== null)

  return {
    // 生效中的关键词：发给后端、写进地址栏、显示在标题里
    keyword,
    // 输入框绑定的值（即时）
    keywordInput,
    categoryId,
    isFiltered,
    selectCategory,
    clearAll,
    // 按回车时调用：语义是「我不想等防抖，现在就搜」
    applyKeywordNow: commitKeyword,
  }
}

/**
 * 页面用的那一层：把真实的 route / router 注入给上面那段纯逻辑。
 *
 * 【为什么 route.query 要包成 () => route.query】
 *   watch 的源如果是函数，每次依赖变化都会重新求值 —— 这正好符合
 *   「query 变化时把我叫醒」的需求；直接传 route.query 对象则拿不到这个语义。
 */
export const useArticleFilter = () => {
  const route = useRoute()
  const router = useRouter()

  return createArticleFilter({
    querySource: () => route.query,
    // 带上 path 是【显式】的：只给 query 时 vue-router 会拿当前路由去补路径，
    // 写清楚了就不用去猜它到底怎么补
    replaceUrl: (query) => router.replace({ path: route.path, query }),
  })
}
