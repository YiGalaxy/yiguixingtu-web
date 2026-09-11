<template>
  <div class="admin">
    <!-- ==================== 左侧菜单 ==================== -->
    <aside class="side glass">
      <div class="side-brand"><span class="mk">✦</span> 亿轨星途 · 后台</div>
      <nav class="side-nav">
        <a
          v-for="m in menus" :key="m.key"
          :class="{ active: cur === m.key }"
          @click="cur = m.key">
          <!-- 文字单独包一层：待审核数量是个角标，混在文字里会让"菜单项的文字"
               断言（用例里按文字核对菜单）时有时无，读代码的人也不容易发现它是动态的 -->
          <span class="nv-label">{{ m.label }}</span>
          <!-- 待审核数量的角标：评论默认待审核，站长最关心的就是"有没有新的要处理"，
               不点进菜单也该看得见。数量为 0 时整个角标不渲染（显示一个 0 只是噪音）。 -->
          <i v-if="m.key === 'comments' && pendingCommentCount" class="nv-badge">{{ pendingCommentCount }}</i>
        </a>
      </nav>
    </aside>

    <div class="main">
      <!--
        ==================== 十二个菜单 ====================
        【每个菜单是一个组件，划分依据有两条】
          ① 一个菜单 = 一个独立的"加载 / 刷新单元"：切过去要重新拉一次的东西
             （标签列表、分类列表、评论待办、概览数字）正好都是那个菜单的整块内容，
             所以按菜单切，边界和"什么时候该刷新"是同一件事，不用另画一张表。
          ② 一个菜单 = 一个能独立改坏的单元：改评论审核只需要打开一个文件，
             不用再滚过一千多行别人的代码（这是这次拆分的直接动机）。

        【哪些状态留在这一层，为什么】
          留在页面里的都是**跨菜单共用**的那几份数据，各复制一份就会出现
          "两个地方看到的不是同一批数据"：
            · articles / artTotal / artLoading / artQuery —— 文章管理表格，
              同时喂概览页的「最近文章」（概览要的是全站最新 5 篇，不是当前筛选结果，
              所以列表数据只能有一份）
            · categories —— 文章筛选下拉框 + 文章弹窗的分类单选 + 分类管理页
            · tags       —— 文章弹窗的标签多选 + 标签管理页
            · pendingCommentCount —— 左侧菜单的角标 + 评论管理页标题
            · 概览的四个数字 —— 进后台就并行拉好（不依赖用户点过哪些菜单），
              所以不能等概览那个组件挂载了才拉
          向下传用 props（只读的）与 v-model（父子共用的对象/数字），
          向上抛用事件（refresh / refresh-tags / refresh-pending）
          —— 谁持有数据谁负责去读接口，组件只负责"要一份新的"。
      -->
      <AdminOverviewPanel
        v-if="cur === 'overview'"
        :stats="siteStats"
        :stats-failed="statsFailed"
        :user-count="userCount"
        :user-count-failed="userCountFailed"
        :articles="articles" />

      <AdminArticlesPanel
        v-else-if="cur === 'articles'"
        v-model:query="artQuery"
        :articles="articles"
        :total="artTotal"
        :loading="artLoading"
        :categories="categories"
        :tags="tags"
        @refresh="fetchArticles"
        @refresh-tags="fetchTags" />

      <AdminUsersPanel
        v-else-if="cur === 'users'"
        :my-id="myId" />

      <AdminTagsPanel
        v-else-if="cur === 'tags'"
        :tags="tags"
        :loading="tagLoading"
        @refresh="fetchTags" />

      <AdminCategoriesPanel
        v-else-if="cur === 'categories'"
        :categories="categories"
        :loading="categoryLoading"
        @refresh="fetchCategories" />

      <!-- ==================== ⑧ F5 四个内容模块 ====================
           【为什么这四个面板没有 props、也不监听事件】它们的列表只有自己用
           （不像标签/分类那样要喂文章弹窗的下拉框），所以列表 ref、loading 与
           "什么时候刷新"全都留在面板内部（挂载时自己拉一次）——
           这里只负责"哪个菜单显示哪一个"。这与「评论管理」是同一个判断，
           好处是 admin.vue 不用再为四个模块各维护一份没人共用的状态与请求。 -->
      <AdminFavoritesPanel v-else-if="cur === 'favorites'" />
      <AdminProjectsPanel v-else-if="cur === 'projects'" />
      <AdminLinksPanel v-else-if="cur === 'links'" />
      <AdminAboutPanel v-else-if="cur === 'about'" />
      <!-- 音乐管理（第 12 个菜单）：同样是"数据只有自己用"的自包含面板 ——
           它的音频文件走 POST /upload?type=audio，那一套规则收在 useUpload('audio') 里 -->
      <AdminMusicPanel v-else-if="cur === 'music'" />

      <AdminCommentsPanel
        v-else-if="cur === 'comments'"
        v-model:pending-count="pendingCommentCount"
        @refresh-pending="fetchPendingCommentCount" />

      <!-- ==================== ⑦ 其他模块占位 ==================== -->
      <template v-else>
        <header class="top"><h1>{{ curLabel }}</h1><p>该模块开发中。</p></header>
        <div class="panel glass"><div class="empty">该模块开发中 · 敬请期待</div></div>
      </template>
    </div>
  </div>
</template>

<script setup>
// ================================================================
//  后台页的 SEO 元信息
//
//  【为什么后台也要设 head】不设的话它会继承站点默认标题，看起来像"公开页面"；
//  更要紧的是【必须让它明确不可索引】：
//   · robots 里给 noindex, nofollow —— 后台是登录后才看得见的内部工具，
//     被搜索引擎收录没有任何好处，只有"把管理入口暴露给别人"的风险
//   · 光靠 robots.txt 的 Disallow 是不够的：Disallow 只挡住"抓取"，
//     如果别处有链接指向它，搜索结果里仍然可能出现这个地址（只是没有摘要）。
//     两者都做才算完整（robots.txt 见 server/routes/robots.txt.get.ts）
//
//  【为什么不上全站登录墙】后台的访问控制本来就在 useApi + 路由守卫（middleware/admin），
//  noindex 处理的是"搜索引擎",不是"攻击者"：真正拦住人的是后端接口的 401/403。
// ================================================================
// 路由守卫：没登录就弹登录框并回首页
definePageMeta({ middleware: 'admin' })

useSeoMetaFor(() => ({
  path: '/admin',
  title: '后台管理',
  description: '亿轨星途的站点后台（仅管理员可见），不对搜索引擎开放。',
  noindex: true,
}))

const { request } = useApi()
const { user } = useAuth()

// 当前登录用户 ID：用来禁用「操作自己」的按钮（传给用户管理面板）
const myId = computed(() => user.value?.id)

// ---------- 左侧菜单 ----------
// 【分类与标签现在是两个对称的菜单】
//   · 标签管理：标签是多对多（一篇文章可以有多个），增删改齐全
//   · 分类管理：分类是一对一（一篇文章只属于一个），增删改也齐全，
//     但**删除可能被拒**（分类下还有文章时后端会拒绝，见 CategoriesPanel 的 removeCategory）
//   两个菜单名都带「管理」两个字：它们背后是同一类能力（维护一个维度），
//   叫法不一致会让人以为分类那一页有什么不同。
const menus = [
  { key: 'overview', label: '概览' },
  { key: 'articles', label: '文章管理' },
  { key: 'users',    label: '用户管理' },
  { key: 'tags',     label: '标签管理' },
  { key: 'categories', label: '分类管理' },
  // ---------- 内容模块（F5 的四个 + 音乐，菜单从七个变十二个）----------
  // 【为什么插在「分类管理」之后、「评论管理」之前】
  //   这几项和上面的标签/分类是同一类东西：**站点级静态内容**（站长自己维护、
  //   没有别人引用、用"显示/隐藏"控制可见性），排在内容类菜单里最自然。
  //   而「评论管理」是每天要处理一遍的待办（它带角标），「设置」是站点的开关 ——
  //   这两个各有各的性质，所以留在最后。
  // 【名字都带「管理」】与标签管理/分类管理对称：叫法不一致会让人以为
  //   某一页的能力不一样（实际上这几页都是"列表 + 增删改"）。
  { key: 'favorites', label: '收藏管理' },
  { key: 'projects',  label: '项目管理' },
  { key: 'links',     label: '友链管理' },
  { key: 'about',     label: '关于管理' },
  { key: 'music',     label: '音乐管理' },
  { key: 'comments', label: '评论管理' },
  { key: 'settings', label: '设置' },
]
const cur = ref('users')
const curLabel = computed(() => menus.find(m => m.key === cur.value)?.label || '')

// ================================================================
//  概览的四个数字
// ================================================================
// 文章 / 浏览 / 分类：公开接口 GET /article/stats（口径：只统计已发布文章），
// 和首页个人卡片共用同一个 composable，口径与降级行为完全一致。
const { stats: siteStats, failed: statsFailed, load: loadSiteStats } = useSiteStats()

// 用户数是单独一个 ref，不复用用户表格的 total。
// 【为什么】total 是"用户管理页当前查询条件"的总数：管理员在那边筛了"禁用用户"，
// 概览的用户数就会跟着变成禁用用户数 —— 这正是要修掉的"数字取决于你点过什么"。
const userCount = ref(0)
const userCountFailed = ref(false)

const fetchUserCount = async () => {
  // size=1：只需要 total 这个总数，不需要真的把那一页数据拉回来
  const res = await request('/user/page', { params: { page: 1, size: 1 } })
  if (res.ok) {
    userCount.value = toCount(res.data?.total)
    userCountFailed.value = false
  } else {
    // 失败就保留旧值 + 显示占位，不把数字清成 0（假装"没有用户"比"读不到"更糟）
    userCountFailed.value = true
  }
}

/**
 * 拉一次概览数据。
 * 【为什么进入后台就要主动拉，而不是等用户点「概览」菜单】
 *   改之前概览的数字来自用户表格 / 文章表格 / 分类列表的变量，而这些表格是
 *   "哪个菜单被点开才加载"的 —— 于是概览显示什么，取决于你点过哪些菜单：
 *   直接进后台点「概览」，四个数字全是 0。现在进入页面就并行拉好。
 *   （概览面板因此是纯展示组件：它一个请求都不发，只把这几份数据画出来。）
 */
const loadOverview = () => Promise.all([loadSiteStats(), fetchUserCount()])

// ================================================================
//  文章列表（概览的「最近文章」与文章管理面板共用这一份）
// ================================================================
const articles = ref([])
const artTotal = ref(0)
const artLoading = ref(false)

// 筛选条件。用 v-model:query 交给文章面板去改（那边是真正的交互发生地），
// 这里只读它来发请求 —— 条件只有这一份，不会出现"界面筛了、请求没带"。
const artQuery = reactive({
  page: 1, size: 10,
  keyword: '', categoryId: null, status: null,
  sortField: '', sortOrder: '',
})

// ---------- 拉文章列表 ----------
// 【注意这里打的是 /admin/article/page，不是前台的 /article/page】
// 区别：后台接口带 token 且要求 ADMIN，能看见草稿；前台接口一律隐藏草稿。
// 管理后台当然要看得见自己没写完的草稿，所以走后台接口。
const fetchArticles = async () => {
  artLoading.value = true
  const res = await request('/admin/article/page', {
    params: {
      page: artQuery.page,
      size: artQuery.size,
      keyword: artQuery.keyword || undefined,
      categoryId: artQuery.categoryId === null ? undefined : artQuery.categoryId,
      status: artQuery.status === null ? undefined : artQuery.status,
      sortField: artQuery.sortField || undefined,
      sortOrder: artQuery.sortOrder || undefined,
    },
  })
  artLoading.value = false
  if (!res.ok) return
  articles.value = res.data.records || []
  artTotal.value = Number(res.data.total) || 0
}

// ================================================================
//  分类列表（文章筛选下拉框 + 文章弹窗的分类单选 + 分类管理页共用这一份）
//
//  【为什么还打公开接口，而不是后台的 GET /admin/category/list】
//   后端在 AdminCategoryController 里写明了：分类列表**只有一个缓存**，
//   写操作会推进缓存版本号让它立刻失效，所以后台那份和前台那份一定是
//   同一份最新数据（这也是后端为什么没有像标签那样单独做一个"不走缓存"的方法）。
//   既然两者等价，就沿用已经在用的公开接口 ——
//   换来换去只会多出一个要同步的 ref，而"刚建完的分类能不能立刻选到"
//   这件事由后端那套版本号保证（联调实测过：新建后立刻再查，列表里就有它）。
//
//  【失败时为什么保留上一次的结果，而不是清空】
//   这个 ref 同时喂着文章筛选下拉框与文章弹窗的分类选择。分类是"很少变、
//   一次失败不该影响别的操作"的那种数据：清空的表现是"下拉框突然空了，
//   于是这篇文章保存出去就没有分类" —— 比"显示一份几秒钟前的分类"糟得多。
//   返回结构不是数组时（比如以后改成分页结构）兜成空数组：
//   它会被 v-for 与 .find 用到，直接拿去遍历会把整个后台带崩。
// ================================================================
const categories = ref([])
const categoryLoading = ref(false)

const fetchCategories = async () => {
  const res = await request('/category/list')
  if (!res.ok) return
  categories.value = Array.isArray(res.data) ? res.data : []
}

/** 带 loading 的刷新（切到分类菜单时用；面板里那个「刷新」按钮走 fetchCategories 也够） */
const loadCategories = async () => {
  categoryLoading.value = true
  await fetchCategories()
  categoryLoading.value = false
}

// ================================================================
//  标签列表（后台接口 GET /admin/tag/list，需要 ADMIN）
//
//  【为什么后台不用前台的 GET /tag/list】两个接口形状一样，差别只有一条：
//   前台那份**走了缓存**（标签是给访客看的导航，几乎不变），
//   后台这份不走缓存 —— 管理员刚建完标签就要能在文章的标签下拉框里选到它。
//   用前台那份的话，新建的标签可能几分钟内都选不到，
//   而"是不是没保存成功"这种疑惑是后台最不该出现的东西。
//
//  【为什么这一个 ref 同时喂两处】文章弹窗的标签下拉框与「标签管理」页共用它：
//   两处看到的必须是同一批标签，各拉一份迟早会有一处是旧的。
// ================================================================
const tags = ref([])
const tagLoading = ref(false)

const fetchTags = async () => {
  const res = await request('/admin/tag/list')
  // 和分类一样用 Array.isArray 兜一道：它会被 v-for 和 .find 用到，
  // 接口挂了 / 结构变了（比如返回 {records:[]}）时兜成空数组，
  // 最差只是下拉框是空的，不会把整个后台渲染带崩
  tags.value = res.ok && Array.isArray(res.data) ? res.data : []
}

/** 带 loading 的刷新（切到标签菜单时用；面板里那个「刷新」按钮走 fetchTags 也够） */
const loadTags = async () => {
  tagLoading.value = true
  await fetchTags()
  tagLoading.value = false
}

// ================================================================
//  待审核评论数（左侧菜单角标 + 评论管理页标题共用）
//
//  它和评论列表的 total 不是一回事：total 是"当前筛选条件下的条数"。
//  所以这一份单独查、单独放在这里 —— 评论面板审核完一条之后会抛
//  `refresh-pending` 让这里重查（在「已通过」里拒绝一条时列表 total 不变、待办却 +1）。
// ================================================================
const pendingCommentCount = ref(0)

/** 单独查一次"待审核有多少条" */
const fetchPendingCommentCount = async () => {
  // size=1：只要 total 这个总数，不需要真的把那一页数据拉回来
  const res = await request('/admin/comment/page', { params: { page: 1, size: 1, status: COMMENT_STATUS.PENDING } })
  if (res.ok) pendingCommentCount.value = Number(res.data?.total) || 0
}

// ---------- 刷新登录用户信息 ----------
// useState('user') 刷新页面后会变回 null，此时 myId 是 undefined，
// 「不能操作自己」的按钮就会失效，所以用 /auth/me 补一次
const ensureUser = async () => {
  if (user.value?.id) return
  const res = await request('/auth/me')
  if (res.ok) user.value = res.data
}

// 切菜单时需要补的那几次请求。
// 【为什么这几条还留在这里，而不是各自在组件里 onMounted】这几份数据的宿主都是本页面
//   （见模板上方那段"哪些状态留在这一层"）：
//   · 切到文章管理时如果还没加载过，补一次（文章列表同时喂概览，不能无条件重拉）
//   · 切到概览时刷新一次（比如刚从文章管理发布/删除了文章，回到概览看到的应该是新数字）
//   · 标签 / 分类管理：在别处（文章弹窗、另一个标签页）改过之后切过来，
//     看到的应该是当前的列表，而不是进页面那一刻的快照
//   · 评论管理不在这里 —— 它那一页自己的加载跟着组件挂载走（见 CommentsPanel）
watch(cur, (v) => {
  if (v === 'articles' && articles.value.length === 0) fetchArticles()
  if (v === 'overview') loadOverview()
  if (v === 'tags') loadTags()
  // 分类要多一次：列表是进后台时就并行拉好的，但"文章弹窗里改过分类"之后
  // 切过来看到的应该是当前的（分类很少变，这一次刷新换的是"一定不过期"）
  if (v === 'categories') loadCategories()
})

onMounted(async () => {
  // 这几件事互不依赖，并行发出去（Promise.all 而不是一个个 await，省几个来回的网络时间）。
  // 【用户列表不在这一批里】用户管理是默认菜单，它的加载跟着 UsersPanel 的挂载走 ——
  // 那一次挂载就发生在这次 onMounted 之前，一次不多一次不少。
  await ensureUser()
  await Promise.all([
    fetchCategories(), fetchTags(), fetchArticles(), loadOverview(),
    // 待审核评论数：菜单上的角标。进后台就该看见"有几条要处理"，
    // 而不是必须点进评论管理才知道
    fetchPendingCommentCount(),
  ])
})
</script>

<style scoped>
/* ===== 外壳本身（侧边菜单 + 内容区）=====
   只有真正属于这个页面自己的元素写在 scoped 里：
   .admin / .side / .side-nav / .nv-* / .main 都是这个模板里的元素，
   scoped 生效；而面板、表格、弹窗的内容在子组件里（弹层还会被 teleport 到 body），
   父组件的 scoped 样式够不到它们 —— 那些统一放在下面的全局块里，见那里的说明。 */
.admin { display: flex; gap: 24px; max-width: 1440px; margin: 0 auto; padding: 32px; min-height: 70vh; }

.side { width: 220px; flex-shrink: 0; border-radius: 20px; padding: 24px 18px; height: fit-content; }
.side-brand { display: flex; align-items: center; gap: 8px; font-weight: 800; font-size: 15px; margin-bottom: 24px; }
.side-brand .mk { color: var(--accent); }
.side-nav { display: flex; flex-direction: column; gap: 6px; }
/* 菜单项本身是 flex：这样"待审核"的角标能被推到最右边，
   而不是紧贴着文字（贴着文字会让人以为数字是名字的一部分） */
.side-nav a { padding: 10px 14px; border-radius: 12px; color: var(--muted); cursor: pointer; transition: background .2s, color .2s; display: flex; align-items: center; gap: 8px; }
.side-nav a:hover { color: var(--ink); background: rgba(255,255,255,.05); }
.side-nav a.active { color: var(--accent); background: rgba(242,193,78,.12); font-weight: 600; }
.nv-label { flex: 1; }
/* 待审核角标：用金色实心圆点 + 深色数字，和主题一致；空的时候整个不渲染 */
.nv-badge {
  font-style: normal; font-size: 11px; font-weight: 700; line-height: 1;
  color: #0a1224; background: var(--accent);
  border-radius: 999px; padding: 3px 7px;
}

.main { flex: 1; min-width: 0; }

/* 中等宽度：收窄侧边栏和内边距，把空间让给表格 */
@media (max-width: 1300px) {
  .admin { padding: 24px; }
  .side { width: 176px; }
}

/* 窄于 1180px：侧边栏改成横向顶栏，把整幅宽度让给表格。
   原来只在 820px 才折叠，导致 1000~1180px 这段窗口表格仍然装不下，
   「操作」列会重新压到「创建时间」上。 */
@media (max-width: 1180px) {
  .admin { flex-direction: column; padding: 20px; }
  .side { width: 100%; }
  .side-nav { flex-direction: row; flex-wrap: wrap; }
}

@media (max-width: 820px) {
  .admin { padding: 20px; }
}
</style>

<!-- =====================================================================
     全局样式（不是 scoped）。这里放两类东西，两类都**必须**是全局的：

     ① 被多个面板共用的展示规则：.panel / .toolbar / .top / .glass / .pager …
        它们在子组件里，父组件的 scoped 样式够不到（Vue 只会把父组件的
        scope 属性打在子组件的**根元素**上，根元素里面的东西一概不管）。
        统一用 `.admin` 前缀包一层：既不用给每个面板抄一份，也不会漏到前台页面。

        ⚠️ 这里原来写的是"也不会漏到首页 / 归档页（它们自己有同名类 .glass、.top
        的 scoped 定义，不加前缀就会互相打架）"—— **这句是错的，已更正**：
        · 归档页**从来没有**定义过 `.glass`（它只在 index.vue 里以 scoped 形式定义，
          而 scoped 只对首页自己的模板生效）。结果就是归档页写了 class="glass"
          却没有任何规则命中，卡片没有背景，文字直接压在背景视频上 —— 这是用户
          实际报上来的 bug。修法是在 app.vue 的**全局**样式块里定义 `.glass`，
          详见那边的注释。
        · `.top` 同理：归档页用的是 `.ar-head`，根本没有同名类。
     ② 弹层与第三方组件的覆盖：文章/标签/分类/用户四个弹窗都会被
        el-dialog teleport 到 body，**物理上已经不在 .admin 里面了**，
        所以它们的表单行（.af-* / .ed-*）和 Element Plus、md-editor-v3 的
        主题变量只能用不带前缀的全局规则写 —— 这些类名都是本项目自己的
        （af- / ed- 前缀）或第三方固定类名，不存在跟别的页面撞车的可能。

     scoped 样式对 teleport 是有效的（scope 属性是渲染时打在元素上的，
     跟元素最后挂在哪个父节点无关）—— 面板自己独有的样式就写在面板的 scoped 块里。
     ===================================================================== -->

<style>
/* 毛玻璃降档：blur 14->10 并去掉 saturate()，减轻背景视频播放时的每帧开销 */
.admin .glass { background: rgba(36,54,92,.34); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); border: 1px solid rgba(180,210,245,.14); box-shadow: inset 0 1px 0 rgba(255,255,255,.08); }

/* 各面板共用的标题区 */
.admin .top { margin-bottom: 24px; }
.admin .top h1 { font-size: 30px; font-weight: 800; margin: 0 0 8px; }
.admin .top p { color: var(--muted); margin: 0; }

.admin .panel {
  border-radius: 20px;
  padding: 24px;
  /* 排序箭头图标，见下方「排序箭头」一节。
     用 data URI 内联一个 16x16 的 SVG，配合 mask 使用。
     %20 是空格的 URL 编码（data URI 里空格必须转义），解码后的真面目是：
       <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'>
         <path d='M8 13.5V3.8M8 3.8L3.9 7.9M8 3.8L12.1 7.9'
               fill='none' stroke='black' stroke-width='2.1'
               stroke-linecap='round' stroke-linejoin='round'/>
       </svg>
     就是【一条竖线 + 一个箭头帽】。配合 mask 用而不是直接当图片，
     是因为这样才能用 background-color 自由改颜色，跟着主题走。 */
  --sort-arrow: url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2016%2016'%3E%3Cpath%20d='M8%2013.5V3.8M8%203.8L3.9%207.9M8%203.8L12.1%207.9'%20fill='none'%20stroke='black'%20stroke-width='2.1'%20stroke-linecap='round'%20stroke-linejoin='round'/%3E%3C/svg%3E");
}
.admin .panel-head { font-weight: 700; margin-bottom: 18px; }
.admin .empty { color: var(--muted); text-align: center; padding: 40px 0; font-size: 14px; }

.admin .toolbar { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; border-radius: 18px; padding: 16px 18px; margin-bottom: 20px; }
.admin .tb-item { width: 180px; }
/* 工具条上的说明文字（标签管理那句"这里建完立刻就能选到"）：靠右、弱化，
   它解释的是"这个页面和别处的关系"，不是必须读的操作指引 */
.admin .tb-hint { color: var(--muted); font-size: 12px; margin-left: auto; }
.admin .pager { display: flex; justify-content: flex-end; margin-top: 18px; }

/* 文章 / 标签 / 分类三张表格共用的单元格样式
   （标题和「置顶」「分类」两个小标签挤在一行，省掉一整个「分类」列的位置） */
.admin .art-title { color: var(--ink); font-weight: 600; }
.admin .art-tag { margin-left: 8px; }

/* ===== 弹窗里的表单行（文章 / 标签 / 分类三个弹窗共用）===== */
/* 标签固定宽度，输入框吃掉剩余空间 */
.af-row { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
.af-row .ed-label { width: 56px; }
.af-row > .el-input,
.af-row > .el-select { flex: 1; }
.af-opts { display: flex; align-items: center; gap: 28px; flex-wrap: wrap; }
.af-hint { color: var(--muted); font-size: 12px; }
/* 弹窗底部：提示语靠左，按钮靠右 */
.af-foot-tip { color: var(--muted); font-size: 12px; margin-right: auto; }

/* 弹窗里的失败原因（比如「标签名已存在」）。
   用主题里的错误色而不是灰色：它是一条"必须处理才能继续"的信息 */
.ed-error {
  color: var(--el-color-danger, #f56c6c);
  font-size: 13px; line-height: 1.6; margin: 4px 0 0;
}

/* ===== Element Plus 暗色适配 ===== */
.admin .panel, .admin .toolbar, .user-edit-modal {
  --el-bg-color: transparent;
  --el-fill-color-blank: rgba(255,255,255,.06);
  --el-text-color-primary: var(--ink);
  --el-text-color-regular: var(--ink);
  --el-text-color-placeholder: var(--muted);
  --el-border-color: rgba(150,190,240,.18);
  --el-border-color-light: rgba(150,190,240,.14);
  --el-table-bg-color: transparent;
  --el-table-tr-bg-color: transparent;
  --el-table-header-bg-color: rgba(255,255,255,.05);
  --el-table-text-color: var(--ink);
  --el-table-header-text-color: var(--muted);
  --el-table-border-color: rgba(150,190,240,.14);
  --el-table-row-hover-bg-color: rgba(242,193,78,.10);
  --el-pagination-bg-color: rgba(255,255,255,.06);
  --el-pagination-text-color: var(--muted);
  --el-pagination-button-color: var(--muted);
  --el-pagination-button-bg-color: rgba(255,255,255,.06);
  --el-pagination-hover-color: var(--accent);
}
.admin .panel .el-table { background: transparent; font-size: 13px; }
.admin .panel .el-table__inner-wrapper::before { display: none; }
.admin .panel .el-table th.el-table__cell,
.admin .panel .el-table td.el-table__cell { background: transparent; }

/* ===== 排序箭头：单箭头 + 旋转动画 =====
   Element Plus 默认是"上下两个小三角"叠着放，信息量小、还占 24px 宽度。
   这里换成【单个箭头】：升序朝上、降序朝下（原地转 180°），切换时带旋转动画。

   为什么纯 CSS 就能做到、不用改模板：
   EP 会把当前排序状态直接写成 th 上的 class ——
     未排序：th 上没有任何状态类
     升    序：th 带 .ascending
     降    序：th 带 .descending
   所以我们只要盯住这两个类，就能驱动箭头的样子。 */

/* ① 干掉 EP 默认的两个小三角 */
.admin .panel .el-table th .sort-caret { display: none; }

/* ② 把箭头容器收成 16x16 的居中盒子（原来 24px 宽，省下 8px 给列内容） */
.admin .panel .el-table th .caret-wrapper {
  width: 16px;
  height: 16px;
  padding: 0;
  margin-left: 3px;
  justify-content: center;
  background: none;   /* 它其实是个 <button>，清掉浏览器默认底色和边框 */
  border: none;
}

/* ③ 用 ::before 画出箭头本身 */
.admin .panel .el-table th .caret-wrapper::before {
  content: '';
  width: 13px;
  height: 13px;
  /* 颜色由 background-color 决定，形状由 mask 从 SVG 里"抠"出来 */
  background-color: rgba(190,210,240,.45);      /* 未排序：淡淡的灰蓝 */
  -webkit-mask: var(--sort-arrow) center / contain no-repeat;
  mask: var(--sort-arrow) center / contain no-repeat;
  /* 旋转动画：cubic-bezier 带一点点回弹，转起来更有"手感"，
     而不是生硬地一下转过去。
     注意这里【不加】 translateZ(0)：现代浏览器做 transform 过渡时会自动上合成层，
     手动强制提层反而会让 mask 出来的图形被栅格化、边缘发虚。 */
  transition: transform .34s cubic-bezier(.34,1.4,.64,1), background-color .25s;
  transform: rotate(0deg);
}

/* ④ 鼠标悬停时提亮，暗示"这里可以点"
   注意 :not(.ascending):not(.descending) —— 必须排掉正在生效的列。
   因为 CSS 里 :hover 这条规则的选择器类数比第⑤条多，
   优先级更高；不排除的话，鼠标停在已排序列上会把金色盖成灰色。 */
.admin .panel .el-table th.is-sortable:hover:not(.ascending):not(.descending) .caret-wrapper::before {
  background-color: rgba(190,210,240,.9);
}

/* ⑤ 当前正在生效的列，箭头点亮成主题金 */
.admin .panel .el-table th.ascending .caret-wrapper::before,
.admin .panel .el-table th.descending .caret-wrapper::before {
  background-color: var(--accent);
}

/* ⑥ 降序 = 把升序的箭头原地旋转 180°（配合上面的 transition 就是动画） */
.admin .panel .el-table th.descending .caret-wrapper::before {
  transform: rotate(180deg);
}

/* ⑦ 尊重系统的"减少动态效果"设置：开了就取消旋转动画，直接切换 */
@media (prefers-reduced-motion: reduce) {
  .admin .panel .el-table th .caret-wrapper::before { transition: none; }
}

/* ===== 表格列宽 / 固定列修复 =====
   现象：右侧「操作」列的按钮和「创建时间」的文字叠在一起。
   根因有两层，缺一不可：
     ① 列宽合计 980px 超过了表格可用宽度 842px —— 表格横向溢出，
        而 fixed="right" 的「操作」列会被【钉在容器右边缘】，
        正好压在「创建时间」列上（实测重叠 138px）；
     ② 上面的暗色主题把表格背景设成了 transparent，固定列因此没有
        不透明底色，下层文字直接透上来 —— 看起来就是"字叠字"。
   所以两手都要抓：收窄列宽治本，给固定列补底色兜底。 */
.admin .panel .el-table .el-button + .el-button { margin-left: 8px; }
.admin .panel .el-table .el-button--small { padding: 5px 10px; }

/* 固定列兜底：只在【真的会溢出】的窄窗口下才给固定列加底色。
   为什么：桌面宽度下表格已经装得下，固定列根本没压住任何内容，
           这时再给它加底色，反而会凭空多出一个色块，和毛玻璃面板格格不入。
   何时需要：实测窗口 < 900px 时，容器会小于 798px 的列宽合计，表格开始横向滚动，
           「操作」列就会压住「创建时间」—— 这时必须挡住下层文字。
   注意【不能写死纯色】：面板是半透明叠在背景视频上的，底色每帧都在变，
           写死颜色必然对不上。用「半透明底 + 背景模糊」，它跟着背景一起变，永远吻合。 */
@media (max-width: 900px) {
  .admin .panel .el-table-fixed-column--left,
  .admin .panel .el-table-fixed-column--right {
    background: rgba(18,30,56,.78) !important;
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
  }
}

/* 窄屏：工具条里的每个控件独占一行（表格那边靠媒体查询已经改成横向滚动） */
@media (max-width: 820px) {
  .admin .tb-item { width: 100%; }
}

/* =====================================================================
   弹层主题：teleport 到 body 的弹层（下拉框 / 确认框 / 弹窗 / 编辑器）
   这些元素在 DOM 上已经不是 .admin 的后代了，所以只能用不带前缀的全局规则。
   ===================================================================== */
.el-select-dropdown {
  background: #16264a !important;
  border: 1px solid rgba(150,190,240,.18) !important;
}
.el-select-dropdown__item { color: var(--muted) !important; }
.el-select-dropdown__item.is-hovering { background: rgba(242,193,78,.12) !important; color: var(--ink) !important; }
.el-select-dropdown__item.is-selected { color: var(--accent) !important; font-weight: 700; }
.el-popper__arrow::before { background: #16264a !important; border-color: rgba(150,190,240,.18) !important; }

.el-message-box {
  background: #16264a !important;
  border: 1px solid rgba(150,190,240,.18) !important;
}
.el-message-box__title, .el-message-box__content { color: var(--ink) !important; }

.el-dialog.user-edit-modal {
  background: #16264a !important;
  border: 1px solid rgba(150,190,240,.18) !important;
  border-radius: 18px;
}
.user-edit-modal .el-dialog__title { color: var(--ink) !important; }
.user-edit-modal .el-dialog__body { color: var(--ink) !important; padding-top: 8px; }

/* ==================== 文章 / 标签 / 分类三个弹窗（同一个类名）==================== */
.el-dialog.art-edit-modal {
  background: #16264a !important;
  border: 1px solid rgba(150,190,240,.18) !important;
  border-radius: 18px;
}
.art-edit-modal .el-dialog__title { color: var(--ink) !important; }
.art-edit-modal .el-dialog__body { color: var(--ink) !important; padding-top: 8px; }
/* 底部改成 flex，这样「正文用 Markdown 写」的提示能靠左、按钮靠右 */
.art-edit-modal .el-dialog__footer { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }

/* ==================== 评论详情弹窗（CommentsPanel 里的那个） ====================
   【为什么这几条写在全局块里】与上面文章弹窗同一个原因：el-dialog 会被 teleport 到 body，
   物理上已经不在 .admin 里面了 —— 写进 CommentsPanel 的 scoped 块对**弹窗容器本身**不生效
   （弹窗内容那部分生效，那些元素是该组件渲染的，scope 属性打在它们身上）。
   这里只负责"容器长什么样"，正文与元信息的排版在 CommentsPanel 的 scoped 块里。 */
.el-dialog.cm-detail-modal {
  background: #16264a !important;
  border: 1px solid rgba(150,190,240,.18) !important;
  border-radius: 18px;
}
.cm-detail-modal .el-dialog__title { color: var(--ink) !important; }
.cm-detail-modal .el-dialog__body { color: var(--ink) !important; padding-top: 8px; }
/* 底部的两个按钮靠右（「关闭」在最左，通过/拒绝跟在后面） */
.cm-detail-modal .el-dialog__footer { display: flex; justify-content: flex-end; gap: 10px; }

/* ==================== 弹窗高度自适应 ====================
   【为什么必须做这件事】
   原来的弹窗内容是写死高度的（表单 5 行 + 编辑器 460px ≈ 840px）。
   实测：视口 900px 时「保存」按钮在 827~859，勉强可见；
        视口 800px 时跑到 823~855 —— 已经在屏幕外了。
   笔记本不最大化窗口（768~800px 高）就会踩到，用户得滚动才能点保存，
   很容易以为"没保存按钮"。

   解法：让弹窗自己不超过视口，正文区内部滚动，
   标题栏和底部按钮固定不动 —— 保存按钮永远在视野里。 */
.el-dialog.art-edit-modal {
  display: flex;
  flex-direction: column;
  max-height: 92vh;
  /* EP 默认给弹窗底部留 50px 外边距，加上 4vh 的顶部间距会顶出视口，
     这里压到 2vh。注意要 !important，因为 EP 是用简写 margin 设的。 */
  margin-bottom: 2vh !important;
}
.art-edit-modal .el-dialog__body {
  flex: 1;
  min-height: 0;          /* flex 子项默认 min-height:auto，不归零的话内部滚不起来 */
  overflow-y: auto;
}
/* 编辑器高度跟着视口走：clamp(最小, 期望, 最大)
   期望值 = 视口高 - 400px（表单行 + 标题栏 + 底栏的固定开销）
   视口高 1200 → 560（撞上限）；1000 → 520；800 → 400；700 → 300；再矮保底 240

   【这个库自带 .md-editor { height: 500px } 默认值，必须覆盖掉，否则永远是 500px】

   注意这里【不能写 :deep()】！
   :deep() 是 Vue SFC 的编译期语法，只在 <style scoped> 里被处理。
   写在全局 <style> 块里，它会原样保留在 CSS 里 —— 浏览器不认识 :deep 这个伪类，
   整条规则会被静默丢弃，怎么调都不生效（这次就踩了这个坑：高度一直卡在 500px）。 */
.af-editor .md-editor {
  height: clamp(240px, calc(92vh - 400px), 560px);
}

/* ==================== md-editor-v3 暗色适配 ====================
   这个库自带一套暗色主题（.md-editor-dark），默认是偏中性的灰黑。
   这里把它的主题变量换成博客的暗金蓝，让它和面板融为一体。
   --md-* 是它公开的主题变量，改这些比去覆盖内部类名稳妥得多
   （内部类名会随版本变，而这两个变量是它的公开 API）。 */
.md-editor-dark {
  --md-bk-color: #101d38;                              /* 编辑区底色 */
  --md-bk-color-outstand: rgba(255,255,255,.05);       /* 工具栏底色 */
  --md-bk-hover-color: rgba(242,193,78,.12);           /* 悬停高亮 */
  --md-border-color: rgba(150,190,240,.18);
  --md-border-hover-color: rgba(242,193,78,.45);
  --md-border-active-color: #f2c14e;                   /* 当前激活的工具栏按钮 = 主题金 */
  --md-color: var(--ink);
  --md-hover-color: #ffffff;
  --md-scrollbar-bg-color: rgba(255,255,255,.04);
  --md-scrollbar-thumb-color: rgba(150,190,240,.28);
  border-radius: 14px;
  overflow: hidden;
}
</style>
