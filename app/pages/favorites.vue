<template>
  <div class="fav">
    <header class="fv-head">
      <h1>收藏</h1>
      <!-- 标题下面这行把"有多少东西"说清楚。
           失败时不报总数：那时我们手上是一条数据都没有的空数组，
           报"共 0 条"等于在陈述一件我们并不知道的事（归档页那一处同理）。 -->
      <p v-if="failed" class="fv-sub">收着平时看到的好文章、好工具</p>
      <p v-else class="fv-sub">
        收着平时看到的好文章、好工具 · 共 {{ total }} 条<span v-if="groups.length">，{{ groups.length }} 个分组</span>
      </p>
    </header>

    <!-- 四种状态互斥（v-if / v-else-if 链），同一时刻只渲染一个：
         加载中 / 读不到（降级） / 一条都没有 / 正常。
         【为什么"加载中"和"读不到"要分开】两者都是空列表，但用户该做的事完全不同：
         前者什么都不用做（等一下就好），后者要看提示。合成一句"没有数据"就是误导。 -->
    <div v-if="pending && !list.length" class="fv-state glass">加载中…</div>
    <div v-else-if="failed" class="fv-state glass">
      收藏暂时读不到，请稍后再试。
      <!-- 两个出口给的是两种"接下来做什么"：
           · 重试：多半是一次网络抖动 / 限流，再打一次就好了
           · 回首页：真的是服务端有问题时，别让用户耗在这一页上 -->
      <button class="fv-retry" type="button" @click="retry">重试</button>
      <NuxtLink class="fv-link" to="/">先去首页看看最新文章</NuxtLink>
    </div>
    <div v-else-if="!list.length" class="fv-state glass">
      这里还空着 —— 还没有收藏任何东西。
    </div>

    <div v-else class="fv-groups">
      <!-- 【顺序完全按后端给的来，前端一次都不排】后端的契约是
           ORDER BY sort ASC, id ASC（见后端 FavoriteServiceImpl.query），
           分组也按"在列表里第一次出现的顺序"排（见 groupFavorites）。
           前端再排一次的话，两处规则从此必须一起改 —— 哪天后端改成别的口径，
           前端这份排序会把它整个盖掉，而页面上看不出异常（只是顺序不对）。 -->
      <section v-for="g in groups" :key="g.key" class="fv-group glass">
        <h2 class="fg-head">
          <span class="fg-name">{{ g.label }}</span>
          <span class="fg-count">{{ g.items.length }} 条</span>
        </h2>
        <ul class="fg-list">
          <li v-for="item in g.items" :key="item.id" class="fg-item">
            <!-- 【外链必须是真 <a href>，并带 target="_blank" rel="noopener"】
                 · 用 <a href> 而不是 click 跳转：中键/右键新标签、复制链接、
                   状态栏显示目标地址都照常可用
                 · target="_blank"：收藏的价值是"以后还要再来"，把用户留在本站
                 · rel="noopener"：不加的话新页面能通过 window.opener 操作本站页面
                   （钓鱼链接最常见的用法）；现代浏览器默认已加，但显式写才不依赖版本 -->
            <a
              v-if="isExternalUrl(item.url)"
              class="fi-link" :href="item.url" target="_blank" rel="noopener">{{ textOf(item.title) }}</a>
            <!-- 【地址缺失时不能渲染成 <a>】后端 FavoriteForm 上 url 是必填的
                 （@NotBlank），但历史数据、或者有人手工改过库，都可能让它为空。
                 那时渲染成 <a href=""> 会跳到本站首页（点了等于"没反应"），
                 渲染成 <a href="undefined"> 更糟 —— 所以退化成一行文字 + 说明。 -->
            <span v-else class="fi-link is-dead">
              {{ textOf(item.title) }}<span class="fi-bad">（地址缺失，打不开）</span>
            </span>
            <!-- 备注是可选的（后端允许为空），没写就整段不渲染：
                 印一个空的 <p> 会白占一行高度，让卡片看起来像缺了块东西 -->
            <p v-if="item.description" class="fi-desc">{{ item.description }}</p>
            <span class="fi-host">{{ hostOf(item.url) }}</span>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>

<script setup>
// ================================================================
// app/pages/favorites.vue
//
// 作用：GET /favorite/list —— 收藏页（公开接口，无需登录）。
//
// 【为什么要有这一页】
//   "收藏"回答的是"我以后还要再来"这件事。放在浏览器书签里等于只有自己那台机器
//   看得到，而且换设备就没了；放在站上，它和文章一样是可分享、可被爬的正式内容。
//
// 【数据形状】后端 FavoriteController.list() → Result<List<FavoriteVO>>：
//   { id, title, url, description, category, sort, status, createTime }
//   · 【不分页】后端有意一次返回全部（几十条的量级，见 FavoriteController 的注释），
//     所以这里的"共 N 条"就是数组长度，不存在"当前页条数"这回事
//   · 【category 是自由文本分组名，不是 category 表】它是"工具/文章/视频"这类
//     站长自己写的字，分组由前端做（后端不 GROUP BY 的理由见后端 Mapper 注释）
//   · 空数据时 data 是 []，失败时 data 是 null —— 两种情况都要能渲染成人话
//
// 【为什么用 useAsyncData（服务端渲染）】
//   和归档页、文章页同一个理由：这是【内容】，出现在服务端 HTML 里爬虫才读得到；
//   "先空一下再刷出来"对一个内容页来说是最差的观感。
//   key 是常量（这一页不接受任何查询参数），所以一次会话里只会取一次。
//
// 【失败必须降级，绝不能白屏或变成错误页】
//   接口挂了 / 被限流 / 返回结构变了，都可能发生。这时列表兜成空数组
//   （模板里 v-for 才不会被 null 打崩），页面显示一句"收藏暂时读不到"
//   加一个回首页的出口。为什么不抛 createError：收藏只是站点的"另一个角落"，
//   它挂了不该把整个站点变成错误页 —— 首页、文章页那些入口都还是好的。
//
// 【技术栈与关键字】
//   · useAsyncData：Nuxt 的数据获取，服务端取好写进 payload，客户端导航时复用
//   · useSeoMetaFor：页面级 SEO 元信息的唯一入口（title / description / canonical）
//   · NuxtLink：渲染成 <a href>，内链可爬、可中键新开
//   · asList / groupFavorites / isExternalUrl / textOf / hostOf：本批新增的
//     共享纯函数（app/utils/contentList.ts），四个内容页用的是同一份规则
// ================================================================

const { request } = useApi()

// 首屏（含服务端）取一次收藏列表。失败不抛异常，而是回一个"标记失败的普通结果"：
// 失败要能被【渲染成一句话】，抛出去就只剩错误页了（理由见文件头）。
const favoritesAsync = useAsyncData('f5-favorites', async () => {
  const res = await request('/favorite/list')
  return { ok: !!res.ok, list: asList(res) }
})

// 等服务端把数据拿到再渲染（不是懒加载）：这样 HTML 里就直接带着收藏内容
await favoritesAsync

const { data: favoritesData, pending } = favoritesAsync

/** 数据还没回来时先按"空 + 失败"之外的形状显示（配合 pending 分支，不会闪一下"读不到"） */
const favorites = computed(() => favoritesData.value ?? { ok: false, list: [] })

const list = computed(() => favorites.value.list)
const groups = computed(() => groupFavorites(list.value))
/** 总数就是数组长度：接口不分页、没有 total 字段（后端一次给全量） */
const total = computed(() => list.value.length)
/** "读不到"只由【明确失败】决定：pending 有单独的分支 */
const failed = computed(() => !favorites.value.ok)

/**
 * 失败状态里那个「重试」按钮。
 * 【为什么用它而不是 location.reload()】refresh() 只重跑这一个 useAsyncData 的
 *   handler（一次 GET /favorite/list），页面本身不重建、滚动位置与 SEO 元信息都不动；
 *   而整页 reload 会把用户从"这一页"变成"重新打开整个站"。
 * 【为什么失败状态下才给这个按钮】它是"再打一次试试"的意思 ——
 *   成功时给一个重试按钮只会让人以为数据可能不对。
 */
const retry = () => favoritesAsync.refresh()

// ================================================================
//  收藏页的 SEO 元信息
//
//  【canonical 固定是 /favorites】这一页不接受任何查询参数（分组是页面内的展示
//  分组，不改地址），所以不存在"同一份内容的另一个地址"。
//
//  【title / description 都要写】不写的话它会继承站点默认标题，
//  在搜索结果里长得和首页一模一样 —— 两个页面互相抢同一批关键词。
// ================================================================
useSeoMetaFor(() => ({
  path: '/favorites',
  title: '收藏',
  description: '亿轨星途的收藏夹：按分组收录平时看到的好文章与好工具，每一条都能直接点开原文。',
  type: 'website',
}))
</script>

<style scoped>
/* 页面外壳：与归档页同样的宽度与内边距，全站内容页的左边缘因此是对齐的 */
.fav { max-width: 1080px; margin: 0 auto; padding: 40px 32px 40px; }

.fv-head { margin-bottom: 24px; }
.fv-head h1 { font-size: 28px; font-weight: 800; margin: 0 0 8px; }
.fv-sub { margin: 0; color: var(--muted); font-size: 14px; }

/* 空的 / 出错时的占位块：玻璃底来自【全局】的 .glass（定义在 app.vue 的全局 style 里），
   页面自己的 scoped 块只补圆角与内边距 —— 这里必须用全局类，
   否则就是归档页踩过的那个坑（写了 class="glass" 却没有任何规则命中，
   文字直接压在背景视频上）。 */
.fv-state { border-radius: 16px; padding: 60px 24px; text-align: center; color: var(--muted); font-size: 14px; }
.fv-link { color: var(--accent); margin-left: 6px; text-decoration: none; }
.fv-link:hover { text-decoration: underline; }

/* 「重试」按钮：做成与链接同档的观感（不是实心按钮）——
   它是失败状态下的一句"再打一次"，不该比页面主体的内容更抢眼。
   cursor: pointer 必须显式写：<button> 默认是 default 光标，
   而我们这里把它当成链接在用（同一个提示里还有一个 <a>）。 */
.fv-retry {
  margin-left: 10px; padding: 4px 12px;
  background: rgba(242,193,78,.12); border: 1px solid rgba(242,193,78,.45);
  border-radius: 999px; color: var(--accent); font-size: 13px; cursor: pointer;
  transition: border-color .2s, color .2s;
}
.fv-retry:hover { border-color: var(--accent); color: var(--accent-strong); }

.fv-groups { display: flex; flex-direction: column; gap: 18px; }

/* 一个分组 = 一张"小表格"，与归档页的月份卡片同一套视觉语言：
   卡片本身是外框（玻璃底 + 圆角），表头有一条实线底边，行与行之间用虚线分隔。
   overflow: hidden 是为了让表头的底色不溢出圆角。 */
.fv-group { border-radius: 16px; padding: 0; overflow: hidden; }

.fg-head {
  display: flex; align-items: baseline; justify-content: space-between; gap: 12px;
  margin: 0; padding: 13px 20px 11px;
  background: rgba(255,255,255,.035);
  border-bottom: 1px solid rgba(180,210,245,.18);
}
.fg-name { font-size: 17px; font-weight: 800; color: var(--ink); }
.fg-count { font-size: 12px; color: var(--accent); font-weight: 700; }

.fg-list { list-style: none; margin: 0; padding: 0; }
/* 分隔线画在 <li> 上（不是 <a> 上）：这样虚线是整行宽的，
   不会因为链接自己带内边距而看起来没对齐 */
.fg-list li + li { border-top: 1px dashed rgba(150,190,240,.13); }

.fg-item { display: flex; align-items: baseline; gap: 10px; padding: 11px 20px; transition: background .2s; }
.fg-item:hover { background: rgba(255,255,255,.06); }

/* 标题是这一条的主要内容，给它主题金 —— 一眼能看出"这里可以点"。
   【为什么不用 el-link】它是 Element Plus 的组件、只能渲染成 <a>，
   而这一列在"地址缺失"时要退化成 <span>（见模板里那段说明），
   一个组件同时要干两件事会把模板绕得很复杂。 */
.fi-link {
  color: var(--accent); font-size: 14px; font-weight: 600;
  text-decoration: none; word-break: break-word;
}
.fi-link:hover { text-decoration: underline; }
/* 退化成文字的那一版：用正常文字色 + 弱化的说明，
   让"这一条和别的不一样"在颜色上就能看出来 */
.fi-link.is-dead { color: var(--ink); cursor: default; }
.fi-bad { color: var(--muted); font-weight: 400; font-size: 12px; margin-left: 4px; }

/* 备注与主机名都是次要信息：次要信息用弱化色，避免和标题抢注意力 */
.fi-desc { flex: 1; min-width: 0; margin: 0; color: var(--muted); font-size: 13px; }
/* 主机名推到最右边：它是"这一条是哪个站点的"的锚点，固定在同一列更好扫读。
   margin-left:auto 让它自动吃掉剩余空间，不用给备注设宽度。 */
.fi-host { margin-left: auto; flex-shrink: 0; color: var(--muted); font-size: 12px; opacity: .8; }

@media (max-width: 640px) {
  .fav { padding: 24px 16px; }
  .fg-head { padding: 12px 14px 10px; }
  /* 窄屏把备注与主机名折到第二行：三者挤在 320px 里，标题会被压成两三个字一行 */
  .fg-item { flex-wrap: wrap; padding: 11px 14px; }
  .fi-desc { flex: 1 1 100%; }
  .fi-host { margin-left: 0; }
}
</style>
