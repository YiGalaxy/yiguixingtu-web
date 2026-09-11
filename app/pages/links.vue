<template>
  <div class="links">
    <header class="lk-head">
      <h1>友链</h1>
      <p v-if="failed" class="lk-sub">这些站点，是我也常去看的地方</p>
      <p v-else class="lk-sub">这些站点，是我也常去看的地方 · 共 {{ total }} 个</p>
    </header>

    <!-- 四种状态互斥：加载中 / 读不到 / 一个都没有 / 正常。
         两句话必须分开说（理由见收藏页：用户该做的事完全不同）。 -->
    <div v-if="pending && !list.length" class="lk-state glass">加载中…</div>
    <div v-else-if="failed" class="lk-state glass">
      友链暂时读不到，请稍后再试。
      <!-- 两个出口给的是两种"接下来做什么"：
           · 重试：多半是一次网络抖动 / 限流，再打一次就好了
           · 回首页：真的是服务端有问题时，别让用户耗在这一页上 -->
      <button class="lk-retry" type="button" @click="retry">重试</button>
      <NuxtLink class="lk-link" to="/">先去首页看看最新文章</NuxtLink>
    </div>
    <div v-else-if="!list.length" class="lk-state glass">
      这里还空着 —— 还没有添加任何友链。
    </div>

    <ul v-else class="lk-grid">
      <!-- 【顺序完全按后端给的来，前端一次都不排】后端契约是 ORDER BY sort ASC, id ASC
           （见后端 FriendLinkServiceImpl.query）。前端重排会把它盖掉，而页面上看不出异常。 -->
      <li v-for="item in list" :key="item.id" class="lk-card glass">
        <!-- 头像：有就用后端给的地址（既可能是上传接口返回的绝对地址，
             也可能是 `/` 开头的站内路径），没有就退化成"首字母 + 渐变圆"。
             缺头像时什么都不画的话，卡片左侧会出现一个空洞。 -->
        <div class="lc-avatar">
          <img v-if="item.avatar" class="lc-img" :src="item.avatar" :alt="textOf(item.name, '站点头像')" loading="lazy">
          <span v-else class="lc-letter">{{ initialOf(item.name) }}</span>
        </div>

        <div class="lc-body">
          <!-- 【外链必须是真 <a href>，并带 target="_blank" rel="noopener"】
               友链页的全部意义就是"点出去"，所以它是这一页最主要的内容，
               而不是一个附带的小按钮。rel="noopener" 是必需的：
               不加的话新页面能通过 window.opener 反向操作本站（钓鱼最常见的手法）。 -->
          <a
            v-if="isExternalUrl(item.url)"
            class="lc-name" :href="item.url" target="_blank" rel="noopener">{{ textOf(item.name) }}</a>
          <!-- 地址缺失/非法时退化成文字：渲染成 <a href=""> 会跳到本站首页
               （点了等于没反应），渲染成 <a href="undefined"> 更糟。 -->
          <span v-else class="lc-name is-dead">
            {{ textOf(item.name) }}<span class="lc-bad">（地址缺失，打不开）</span>
          </span>

          <p v-if="item.description" class="lc-desc">{{ item.description }}</p>
          <span class="lc-host">{{ hostOf(item.url) }}</span>
        </div>
      </li>
    </ul>
  </div>
</template>

<script setup>
// ================================================================
// app/pages/links.vue
//
// 作用：GET /link/list —— 友链页（公开接口，无需登录）。
//
// 【为什么要有这一页】
//   友链是博客之间最老的一种"互相指路"：它既是对外推荐，也是别人认识本站的入口。
//   后端把"隐藏"做在 SQL 层（前台恒为 status = 1），所以这一页拿到的一定是
//   站长愿意公开的那些 —— 前端不需要、也不应该再过滤一次
//   （理由见后端 LinkController 的注释：接口层过滤才拦得住 DevTools 与其它消费方）。
//
// 【数据形状】后端 LinkController.list() → Result<List<FriendLinkVO>>：
//   { id, name, url, avatar, description, sort, status, createTime }
//   · 【不分页】后端有意一次返回全部（十几个的量级），这里的"共 N 个"就是数组长度
//   · 【status 在前台恒为 1】这个字段是给后台列表用的（前后台共用同一个 VO），
//     前台可以完全忽略它 —— 所以这一页一次都不读它
//   · 【avatar 允许 http(s) 外链，也允许 `/` 开头的站内路径】两种都是正当来源：
//     上传接口返回绝对地址，图放在前端仓库的 public 目录里则是站内路径
//
// 【为什么用 useAsyncData（服务端渲染）】
//   同收藏页/项目页：这是内容，要出现在服务端 HTML 里（爬虫读得到），
//   而且首屏不会先闪"加载中"。key 是常量，一次会话只取一次。
//
// 【失败必须降级】接口挂了时列表兜成空数组 + 一句人话 + 一个出口，
//   不白屏、不变成整站错误页（与另外两个内容页同一套取舍）。
//
// 【技术栈与关键字】
//   · useAsyncData / useSeoMetaFor / NuxtLink：内容页三件套
//   · asList / isExternalUrl / textOf / hostOf：本批新增的共享纯函数
//     （app/utils/contentList.ts），四个内容页共用同一份"数据 → 可安全渲染"的规则
// ================================================================

const { request } = useApi()

// 首屏（含服务端）取一次友链列表。失败不抛异常，而是回一个"标记失败的普通结果"，
// 因为失败要能被渲染成一句话（抛出去就只剩错误页了）。
const linksAsync = useAsyncData('f5-links', async () => {
  const res = await request('/link/list')
  return { ok: !!res.ok, list: asList(res) }
})

// 等服务端把数据拿到再渲染：HTML 里直接带着友链卡片
await linksAsync

const { data: linksData, pending } = linksAsync

const links = computed(() => linksData.value ?? { ok: false, list: [] })

const list = computed(() => links.value.list)
/** 总数就是数组长度：接口不分页、没有 total 字段（后端一次给全量） */
const total = computed(() => list.value.length)
const failed = computed(() => !links.value.ok)

/**
 * 失败状态里那个「重试」按钮。
 * 【为什么用它而不是 location.reload()】refresh() 只重跑这一个 useAsyncData 的
 *   handler（一次 GET /link/list），页面本身不重建、SEO 元信息也不动；
 *   整页 reload 会把用户从"这一页"变成"重新打开整个站"。
 * 【为什么只在失败状态给这个按钮】它是"再打一次试试"的意思 ——
 *   成功时给一个重试按钮只会让人以为数据可能不对。
 */
const retry = () => linksAsync.refresh()

/**
 * 没有头像时那个字母：取站点名的第一个字符。
 * 【为什么用 …text] 而不是 text[0]】"𠮷" 这种字符在 JS 里占两个 UTF-16 码元，
 * text[0] 会取到半个字符（渲染成一个乱码方块）。展开成字符数组再取第一个才安全。
 */
const initialOf = (name) => {
  const text = typeof name === 'string' ? name.trim() : ''
  return text ? [...text][0] : '✦'
}

// ================================================================
//  友链页的 SEO 元信息
//  【canonical 固定是 /links】页面不接受任何查询参数，不存在第二个地址。
//  【要有自己的 title / description】不写就会继承站点默认标题，
//  在搜索结果里与首页长得一样，两个页面互相抢同一批关键词。
// ================================================================
useSeoMetaFor(() => ({
  path: '/links',
  title: '友链',
  description: '亿轨星途的友情链接：常去看的博客与站点，每个都附有一句话介绍，点进去就是别人的站。',
  type: 'website',
}))
</script>

<style scoped>
.links { max-width: 1080px; margin: 0 auto; padding: 40px 32px 40px; }

.lk-head { margin-bottom: 24px; }
.lk-head h1 { font-size: 28px; font-weight: 800; margin: 0 0 8px; }
.lk-sub { margin: 0; color: var(--muted); font-size: 14px; }

/* 空/错状态块：玻璃底来自全局 .glass（app.vue 的全局 style 块） */
.lk-state { border-radius: 16px; padding: 60px 24px; text-align: center; color: var(--muted); font-size: 14px; }
.lk-link { color: var(--accent); margin-left: 6px; text-decoration: none; }
.lk-link:hover { text-decoration: underline; }

/* 「重试」按钮：与链接同档的观感（不是实心按钮）—— 它是"再打一次"，
   不该比页面主体的内容更抢眼。cursor: pointer 必须显式写：
   <button> 默认是 default 光标，而我们把它当链接在用 */
.lk-retry {
  margin-left: 10px; padding: 4px 12px;
  background: rgba(242,193,78,.12); border: 1px solid rgba(242,193,78,.45);
  border-radius: 999px; color: var(--accent); font-size: 13px; cursor: pointer;
  transition: border-color .2s, color .2s;
}
.lk-retry:hover { border-color: var(--accent); color: var(--accent-strong); }

/* 友链卡片网格：比项目卡片窄（一张卡片只有"头像 + 名字 + 一句话"），
   所以 280px 就够了 —— 用项目的 340px 在中等屏幕上会变成两列，右边空一大块 */
.lk-grid {
  list-style: none; margin: 0; padding: 0;
  display: grid; gap: 16px;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
}

.lk-card {
  border-radius: 16px; padding: 16px;
  display: flex; align-items: flex-start; gap: 12px;
  transition: transform .2s, border-color .2s;
}
/* 悬停时轻微上浮 + 金色边框：整张卡片是"可以点进去"的入口，
   而它真正的 <a> 只有名字那一小块，所以要有"整块都在回应鼠标"的观感 */
.lk-card:hover { transform: translateY(-2px); border-color: rgba(242,193,78,.35); }

.lc-avatar {
  width: 46px; height: 46px; flex-shrink: 0;
  border-radius: 12px; overflow: hidden;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, rgba(89,214,230,.22), rgba(242,193,78,.20));
}
.lc-img { width: 100%; height: 100%; object-fit: cover; display: block; }
.lc-letter { font-size: 20px; font-weight: 800; color: rgba(255,255,255,.72); }

/* min-width: 0 是 flex 子项能正常省略/换行的前提（默认 min-width:auto 会让长文字撑破卡片） */
.lc-body { min-width: 0; display: flex; flex-direction: column; gap: 4px; }

.lc-name { color: var(--accent); font-size: 15px; font-weight: 700; text-decoration: none; word-break: break-word; }
.lc-name:hover { text-decoration: underline; }
/* 退化成文字的那一版：用正常文字色，让"这条和别的不一样"在颜色上就能看出来 */
.lc-name.is-dead { color: var(--ink); cursor: default; }
.lc-bad { color: var(--muted); font-weight: 400; font-size: 12px; margin-left: 4px; }

.lc-desc { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.6; }
.lc-host { color: var(--muted); font-size: 12px; opacity: .8; word-break: break-all; }

@media (max-width: 640px) {
  .links { padding: 24px 16px; }
  /* 窄屏一列排满：280px 的固定下限在 320px 屏上会横向溢出 */
  .lk-grid { grid-template-columns: 1fr; }
}
</style>
