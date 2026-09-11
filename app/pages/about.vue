<template>
  <div class="about">
    <header class="ab-head">
      <h1>关于</h1>
      <p class="ab-sub">这个站是谁在写，以及怎么找到我</p>
    </header>

    <!-- 三种状态互斥：加载中 / 读不到（降级） / 正常（含"接口给了个空壳"）。
         【为什么这里没有"空数据"这一档】关于页的特殊之处是：后端**永远返回 200 和一个对象**
         （那一行被手工删掉时它会给一个只带昵称的"壳"，见后端 AboutServiceImpl ① ），
         所以"没有内容"不是一种错误状态，而是卡片里某几块空着 —— 见下面的分支。 -->
    <div v-if="pending && !loaded" class="ab-state glass">加载中…</div>
    <div v-else-if="failed" class="ab-state glass">
      关于页暂时读不到，请稍后再试。
      <!-- 两个出口给的是两种"接下来做什么"：
           · 重试：多半是一次网络抖动 / 限流，再打一次就好了
           · 回首页：真的是服务端有问题时，别让用户耗在这一页上 -->
      <button class="ab-retry" type="button" @click="retry">重试</button>
      <NuxtLink class="ab-link" to="/">先去首页看看最新文章</NuxtLink>
    </div>

    <div v-else class="ab-card glass">
      <div class="ac-top">
        <!-- 头像：可为空（后端 AboutForm 里没有 @NotBlank）。没有就整块不渲染，
             而不是放一个灰方块 —— 空状态本身不该占一个"像是加载失败"的位子。 -->
        <img v-if="avatar" class="ac-avatar" :src="avatar" :alt="nickname" loading="lazy">
        <!-- 昵称：后端保证非空（AboutForm 上是 @NotBlank；那一行丢了也会返回"站长"壳）。
             真拿不到时显示「—」，绝不让标题位置出现空白或 undefined。 -->
        <h2 class="ac-name">{{ textOf(about?.nickname) }}</h2>
      </div>

      <!-- 联系方式：**只显示后端给了的那些**（这是这个项目的底线：
           要么接真实数据，要么不显示）。没填微信就在页面上找不到"微信"这两个字，
           而不是印一行"微信：—" —— 后者看起来像页面坏了或者数据丢了。 -->
      <ul v-if="contacts.length" class="ac-contacts">
        <li v-for="c in contacts" :key="c.key" class="ac-item">
          <span class="ai-label">{{ c.label }}</span>
          <!-- 邮箱渲染成 mailto:、GitHub 渲染成外链：这两个字段后端都做了格式校验
               （@Email / @Pattern 白名单），所以它们是可以安全放进 href 的。
               rel="noopener" 与其它页面一样是必需的（新页面不能反向操作本站）。 -->
          <a
            v-if="c.href" class="ai-value is-link" :href="c.href"
            :target="c.external ? '_blank' : undefined"
            :rel="c.external ? 'noopener' : undefined">{{ c.value }}</a>
          <!-- 微信 / QQ 只是纯文字（后端刻意不做格式校验，它们不会被渲染成链接）：
               做成链接点了会打不开，做成可点文本又要额外做复制按钮 —— 都不如原样显示。 -->
          <span v-else class="ai-value">{{ c.value }}</span>
        </li>
      </ul>
      <p v-else class="ac-empty">站长还没有公开任何联系方式。</p>

      <!-- ==================== 自我介绍 ====================
           【安全关键】bio 是 Markdown 原文，必须用与文章详情页**完全相同**的方式渲染
           （<MdPreview>，见 app/pages/article/[id].vue 里那段长注释）：
             · 绝不能自己 v-html —— Markdown 里可以塞原始 HTML
               （`<img src=x onerror=...>`），直接 v-html 等于让每个访客的浏览器
               执行别人写进数据库的脚本；这是博客系统最经典的 XSS 入口
             · MdPreview 内部接了 xss 库做白名单过滤，危险标签与属性会被清掉
             · 也不用别的 Markdown 库：同一份 Markdown 只能有一套渲染规则，
               否则关于页和文章页的显示效果会不一样，改起来要改两处
           没写自我介绍时给一句说明，而不是留一片空白（会让人以为没加载出来）。 -->
      <section class="ac-bio">
        <h3 class="ac-bio-title">自我介绍</h3>
        <MdPreview v-if="hasBio" :model-value="about.bio" theme="dark" :language="zh_CN" />
        <p v-else class="ac-bio-empty">站长还没有写自我介绍。</p>
      </section>

      <!-- 最后更新时间：后端只在有那一行时才给 updateTime，
           拿不到就整行不渲染（不印 "—" —— 这一行本来就是可有可无的元信息） -->
      <p v-if="updatedAt" class="ac-updated">最后更新：{{ updatedAt }}</p>
    </div>
  </div>
</template>

<script setup>
// ================================================================
// app/pages/about.vue
//
// 作用：GET /about —— 关于页（公开接口，无需登录）。
//
// 【它和另外三个内容页最要紧的一处不同：返回的是**一个对象**，不是数组】
//   后端 AboutController 的路径是 /about（没有 /list），返回 `Result<AboutVO>`：
//     { id, nickname, avatar, bio, email, github, wechat, qq, updateTime }
//   —— "只有一条"这件事由接口形状直接表达，所以前端【不写 data[0]】
//     （那种"万一为空就崩"的代码正是后端刻意避免的）。
//   取对象用的是共享的 asObject()：它会排除数组（万一哪天接口改成数组，
//   这里会回落到 null 而不是把数组当对象用）。
//
// 【为什么它还有一种别的页面没有的状态：接口给了个"空壳"】
//   后端有意做成"永远 200"：那一行被人手工删掉时，它返回一个只带 id 与昵称
//   （占位值"站长"）的壳，并在日志里打 WARN。公开页面的可用性 > 把数据缺失变成错误页。
//   所以这一页没有"错误页"这条分支，只有"某些块空着"（见模板里各处的 v-if）。
//
// 【为什么用 useAsyncData（服务端渲染）】
//   同另外三个内容页：这是内容，要出现在服务端 HTML 里（爬虫读得到），
//   首屏也不闪"加载中"。key 是常量，一次会话只取一次。
//
// 【技术栈与关键字】
//   · MdPreview（md-editor-v3 的**只读渲染**版）：Markdown 正文的唯一渲染方式，
//     与文章详情页同一个组件、同一个主题参数；样式引 preview.css（不需要编辑器那套）
//   · useSeoMetaFor：页面级 SEO 元信息（title / description / canonical）
//   · asObject / rawText / textOf：本批新增的共享纯函数（app/utils/contentList.ts）
//   · formatDateTime：时间显示的唯一规则（app/utils/time.ts）——
//     它不做时区换算（后端给的是没有时区的 LocalDateTime），只做字符串替换
// ================================================================

// MdPreview 是"只读渲染"版，不带动编辑器那套（体积小很多）。
// 样式引 preview.css 而不是 style.css —— 和文章详情页完全一致。
import { MdPreview, zh_CN } from 'md-editor-v3'
import 'md-editor-v3/lib/preview.css'

const { request } = useApi()

// 首屏（含服务端）取一次关于信息。失败不抛异常，而是回一个"标记失败的普通结果"：
// 失败要能被渲染成一句话（抛出去就只剩错误页了）。
const aboutAsync = useAsyncData('f5-about', async () => {
  const res = await request('/about')
  return { ok: !!res.ok, about: asObject(res) }
})

// 等服务端把数据拿到再渲染：HTML 里直接带着昵称、联系方式与自我介绍
await aboutAsync

const { data: aboutData, pending } = aboutAsync

const result = computed(() => aboutData.value ?? { ok: false, about: null })
/** "读不到"只由【明确失败】决定：pending 有单独的分支 */
const failed = computed(() => !result.value.ok)
/** 已经拿到过一次数据（用来区分"首次加载中"与"后台刷新中"） */
const loaded = computed(() => aboutData.value !== undefined)
const about = computed(() => result.value.about)

/** 头像：只认非空字符串，免得渲染出 src="undefined"（会发一个多余的 404 请求） */
const avatar = rawText(about.value?.avatar)
/** 昵称：给 SEO 与 alt 用（显示那一处走 textOf，缺值时是「—」） */
const nickname = rawText(about.value?.nickname) || '站长'

/** 有没有自我介绍：全是空白的 bio 不该渲染一个空的 Markdown 区块 */
const hasBio = rawText(about.value?.bio).length > 0

/**
 * 联系方式的展示清单。
 *
 * 【为什么在 JS 里拼成一个数组，而不是在模板里写五段 v-if】
 *   五段结构一模一样的 v-if 会让模板长出一倍，而且"哪些字段存在就显示哪些"
 *   这条规则会散在五处 —— 以后加一个字段（比如 B 站）要改五处。
 *   拼成一个数组之后，规则只有一条：**后端给了值的才进列表**。
 *
 * 【为什么 href 只给 email 与 github】
 *   · email → mailto:（后端 @Email 校验过格式）
 *   · github → 外链（后端 @Pattern 白名单只放行 http(s)）——
 *     这两个字段的值会进 href，所以它们必须是被校验过的那两个字段
 *   · wechat / qq 后端**刻意不做格式校验**（它们只是文字），所以这里也绝不放进 href
 */
const contacts = computed(() => {
  const data = about.value
  if (!data) return []
  const email = rawText(data.email)
  const github = rawText(data.github)
  const wechat = rawText(data.wechat)
  const qq = rawText(data.qq)
  return [
    email && { key: 'email', label: '邮箱', value: email, href: `mailto:${email}`, external: false },
    github && { key: 'github', label: 'GitHub', value: github, href: github, external: true },
    wechat && { key: 'wechat', label: '微信', value: wechat },
    qq && { key: 'qq', label: 'QQ', value: qq },
  ].filter(Boolean)
})

/** 最后更新时间：没有就空串（模板据此决定整行渲不渲染），而不是印一个「—」 */
const updatedAt = computed(() => (about.value?.updateTime ? formatDateTime(about.value.updateTime) : ''))

/**
 * 失败状态里那个「重试」按钮。
 * 【为什么用它而不是 location.reload()】refresh() 只重跑这一个 useAsyncData 的
 *   handler（一次 GET /about），页面本身不重建、SEO 元信息也不动；
 *   整页 reload 会把用户从"这一页"变成"重新打开整个站"。
 */
const retry = () => aboutAsync.refresh()

// ================================================================
//  关于页的 SEO 元信息
//
//  【canonical 固定是 /about】页面不接受任何查询参数，不存在第二个地址。
//
//  【description 为什么用固定文案而不是截 bio 的一段】
//   bio 是 Markdown 原文（可能带 `#`、链接、代码块），直接截前 N 个字塞进 meta，
//   抓取方拿到的会是一串带标记的碎片；而且它上限 5000 字，
//   "截多少字"这件事没有任何正确的答案。一句稳定的站点自述更适合当摘要。
// ================================================================
useSeoMetaFor(() => ({
  path: '/about',
  title: '关于',
  description: '关于亿轨星途：站长是谁、平时在写什么，以及邮箱、GitHub 等联系方式。',
  type: 'profile',
}))
</script>

<style scoped>
.about { max-width: 900px; margin: 0 auto; padding: 40px 32px 40px; }

.ab-head { margin-bottom: 24px; }
.ab-head h1 { font-size: 28px; font-weight: 800; margin: 0 0 8px; }
.ab-sub { margin: 0; color: var(--muted); font-size: 14px; }

/* 加载/失败时的占位块：玻璃底来自全局 .glass（app.vue 的全局 style 块） */
.ab-state { border-radius: 16px; padding: 60px 24px; text-align: center; color: var(--muted); font-size: 14px; }
.ab-link { color: var(--accent); margin-left: 6px; text-decoration: none; }
.ab-link:hover { text-decoration: underline; }

/* 「重试」按钮：与链接同档的观感（不是实心按钮）—— 它是"再打一次"，
   不该比页面主体的内容更抢眼。cursor: pointer 必须显式写：
   <button> 默认是 default 光标，而我们把它当链接在用 */
.ab-retry {
  margin-left: 10px; padding: 4px 12px;
  background: rgba(242,193,78,.12); border: 1px solid rgba(242,193,78,.45);
  border-radius: 999px; color: var(--accent); font-size: 13px; cursor: pointer;
  transition: border-color .2s, color .2s;
}
.ab-retry:hover { border-color: var(--accent); color: var(--accent-strong); }

/* 主体是一张卡片：关于页的内容不多（头像 + 名字 + 几条联系方式 + 自我介绍），
   散着排会显得很空，收进一张卡片里才像"一页自我介绍" */
.ab-card { border-radius: 20px; padding: 28px 30px 24px; }

.ac-top { display: flex; align-items: center; gap: 16px; margin-bottom: 20px; }
.ac-avatar { width: 72px; height: 72px; border-radius: 18px; object-fit: cover; display: block; }
/* 昵称去掉浏览器默认的 h2 字号与外边距：它要和头像对齐成一行，
   默认的 margin 会把它推到头像下面去 */
.ac-name { margin: 0; font-size: 24px; font-weight: 800; color: var(--ink); }

/* 联系方式排成两列的网格：窄屏自动变一列（auto-fit 不用写媒体查询） */
.ac-contacts {
  list-style: none; margin: 0 0 18px; padding: 0;
  display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 8px 20px;
}
.ac-item { display: flex; align-items: baseline; gap: 8px; font-size: 13px; }
/* 标签固定宽度：几行文字的左边缘因此对齐，扫读时视线不会一行一行地跳 */
.ai-label { width: 56px; flex-shrink: 0; color: var(--muted); }
.ai-value { color: var(--ink); word-break: break-all; }
.ai-value.is-link { color: var(--accent); text-decoration: none; }
.ai-value.is-link:hover { text-decoration: underline; }

.ac-empty { margin: 0 0 18px; color: var(--muted); font-size: 13px; }

/* 自我介绍区：上面一条分隔线，和联系方式区分开（两者是完全不同的东西：
   前者是"怎么找我"，后者是"我是谁"） */
.ac-bio { border-top: 1px solid var(--line); padding-top: 18px; }
.ac-bio-title { margin: 0 0 10px; font-size: 15px; font-weight: 700; color: var(--ink); }
.ac-bio-empty { margin: 0; color: var(--muted); font-size: 13px; }

.ac-updated { margin: 18px 0 0; color: var(--muted); font-size: 12px; }

/* ===== md-editor-v3 预览区暗色适配 =====
   与文章详情页同一套主题变量（保证同一段 Markdown 在文章页和关于页长得一样）。
   必须用 :deep()：预览区是 MdPreview 内部渲染的 DOM，scoped 的 scope 属性
   只打在组件根元素上，够不到里面的 .md-editor-preview。 */
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

@media (max-width: 640px) {
  .about { padding: 24px 16px; }
  .ab-card { padding: 20px 18px; }
  /* 窄屏下头像与昵称改成上下排：并排会让长昵称被挤成两三个字一行 */
  .ac-top { flex-direction: column; align-items: flex-start; gap: 10px; }
}
</style>
