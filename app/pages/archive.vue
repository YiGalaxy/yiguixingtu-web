<template>
  <div class="archive">
    <header class="ar-head">
      <!-- 标题下面这行把"有多少东西"说清楚：总量来自后端的 total（不是前端把各月的
           count 加起来 —— 后端已经算好了，前端再算一次等于把口径复制成两份）。 -->
      <h1>归档</h1>
      <p v-if="failed" class="ar-sub">按年月浏览全部已发布文章</p>
      <p v-else class="ar-sub">
        按年月浏览全部已发布文章 · 共 {{ total }} 篇<span v-if="months.length">，{{ months.length }} 个月</span>
      </p>
    </header>

    <!-- 四种状态互斥（v-if / v-else-if 链），同一时刻只会渲染一个：
         加载中 / 读不到（降级） / 一篇都没有 / 正常。
         【为什么"加载中"要和"读不到"分开】两者都是空列表，但用户该做的事完全不同：
         前者什么都不用做（等一下就好），后者要看提示。合成一句"没有数据"就成了误导。 -->
    <div v-if="pending && !months.length" class="ar-state glass">加载中…</div>
    <div v-else-if="failed" class="ar-state glass">
      归档暂时读不到，请稍后再试。
      <NuxtLink class="ar-link" to="/">先去首页看看最新文章</NuxtLink>
    </div>
    <div v-else-if="!months.length" class="ar-state glass">还没有发布任何文章</div>

    <div v-else class="ar-months">
      <!-- 【顺序完全按后端给的 months 来，前端一次都不排】
           后端的契约就是"月份倒序、每月里的文章也倒序（最新在前）"。
           前端再排一次的话，两处排序规则从此必须一起改 ——
           哪天后端改成"置顶优先"或者"按更新时间"，前端这份排序就会把它盖掉，
           而页面上看起来一切正常（只是顺序不对，没人会当成 bug 报上来）。 -->
      <section v-for="m in months" :key="monthKey(m)" class="ar-month glass">
        <h2 class="am-head">
          <span class="am-date">{{ m.year }} 年 {{ m.month }} 月</span>
          <span class="am-count">{{ countOf(m) }} 篇</span>
        </h2>
        <ul class="am-list">
          <li v-for="a in articlesOf(m)" :key="a.id">
            <!-- 用真实的 <NuxtLink>（渲染成 <a href>）而不是 click 跳转：
                 归档页的价值之一就是"让爬虫把每篇文章都摸到"，
                 内链是 crawl 的入口；顺带中键 / 右键新标签打开也照常可用。 -->
            <NuxtLink class="am-item" :to="`/article/${a.id}`">
              <!-- 这里只印"日"：年和月已经在这一段的标题里了，
                   再印一遍完整日期是重复信息，也会把标题挤到右边去 -->
              <span class="am-day">{{ dayOf(a.createTime) }}</span>
              <span class="am-title">{{ a.title }}</span>
            </NuxtLink>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>

<script setup>
// ================================================================
// app/pages/archive.vue
//
// 作用：GET /archive —— 按「年 / 月」浏览全部已发布文章的归档页。
//
// 【为什么要有这一页】
//   首页是"信息流"：它擅长"看最近有什么"，不擅长"找去年 3 月那篇"。
//   翻页翻到第 8 页去找一篇文章，是这个站上最难受的一种操作。
//   归档页把同一批文章按时间轴重新排一遍，一屏扫完，这正是博客该有的第二入口。
//
// 【数据来自后端 GET /article/archive（公开接口，走缓存）】
//   形状：{ months: [{ year, month, count, articles: [{ id, title, createTime }] }], total }
//   · months 已经【按时间倒序】（最新月份在最前），每个月里的 articles 也已倒序
//     → 所以下面【一次排序都不做】（理由见模板里那段注释）
//   · 只含已发布文章，最多 500 篇 —— 草稿永远不会出现在这里
//   · 空数据时 months 是 []、total 是 0
//
// 【为什么也用 useAsyncData（服务端渲染）】
//   和首页、文章页同一个理由：归档是【内容】，出现在服务端 HTML 里，爬虫才读得到；
//   "先空一下再刷出来"对一个内容页来说是最差的观感。
//   key 用 'archive-months' —— 它是页面级常量（不像首页那样随筛选条件变），
//   所以同一份数据在一次会话里只会取一次，来回切页面不会重复打接口。
//
// 【失败必须降级，绝不能白屏或 500】
//   接口挂了 / 被限流 / 返回结构变了，都可能发生。这时：
//     · months 兜成空数组（模板里 v-for 才不会被 null 打崩）
//     · 页面显示一句"归档暂时读不到，请稍后再试" + 一个回首页的入口
//   为什么不直接抛 createError 变成错误页：归档只是"换个角度看文章"，
//   它挂了不该把整个站点变成一张错误页 —— 首页/详情页那些入口都还是好的。
//   这里唯一的请求出口是 useApi（错误提示、追踪号、401/403/429 的判断都归它管），
//   所以超时/限流的提示也自动和其它页面一致。
//
// 【技术栈与关键字】
//   · useAsyncData：Nuxt 的数据获取，服务端取好写进 payload，客户端导航时复用
//   · useSeoMetaFor：页面级 SEO 元信息的唯一入口（title / description / canonical）
//   · NuxtLink：渲染成 <a href>，内链可爬、可中键新开
// ================================================================

const { request } = useApi()

/**
 * 归一化：后端返回的 data → 页面稳定能用的形状。
 *
 * 【为什么要归一化而不是把 res.data 直接交给模板】
 *   `data` 可能是 null、`months` 可能不是数组（接口结构以后改成
 *   `{ records: [...] }` 这种分页形状）。模板里直接 v-for 一个非数组会抛
 *   "months is not iterable"，整个页面白屏 —— 而"归档少显示一点"轻得多。
 *   这里定死三个字段的形状之后，模板里一个兜底都不用写。
 */
const normalizeArchive = (data) => ({
  months: Array.isArray(data?.months) ? data.months : [],
  // total 用过 useSiteStats 里那个 toCount：它把 null / 字符串 / 负数一律收成
  // "可以显示的非负整数"，页面上不会出现 NaN 或者 -1 篇
  total: toCount(data?.total),
})

// 首屏（含服务端）取一次归档数据；key 是常量，所以一次会话里只会取一次
const archiveAsync = useAsyncData('archive-months', async () => {
  const res = await request('/article/archive')
  // 失败不抛异常，而是回一个"标记失败的普通结果"：失败要能被【渲染成一句话】，
  // 抛出去就只剩错误页了（理由见文件头）
  if (!res.ok) return { ok: false, ...normalizeArchive(null) }
  return { ok: true, ...normalizeArchive(res.data) }
})

// 等服务端把数据拿到再渲染（不是懒加载）：这样 HTML 里就直接带着归档内容
await archiveAsync

const { data: archiveData, pending } = archiveAsync

/** 数据还没回来时先按"空归档"显示（配合 pending 分支，不会闪一下"读不到"） */
const archive = computed(() => archiveData.value ?? { ok: false, months: [], total: 0 })

const months = computed(() => archive.value.months)
const total = computed(() => archive.value.total)
/** "读不到"只由【明确失败】决定：pending 有单独的分支 */
const failed = computed(() => !archive.value.ok)

/** 每月的 key：后端只给 year + month，所以用它俩拼（不能只用 month，跨年重复） */
const monthKey = (m) => `${m?.year ?? ''}-${m?.month ?? ''}`

/**
 * 月份后面的篇数。
 * 【为什么优先用后端给的 count】count 是后端的口径（该月已发布文章数），
 * 前端拿 articles.length 算只是"这一页渲染出来几条"—— 以后万一接口为了瘦身
 * 只返回每个月的头几篇，两个数字就会对不上，而页面上看不出来。
 * count 缺失（老接口 / 结构变化）时才回落到数组长度。
 */
const countOf = (m) => {
  const count = Number(m?.count)
  if (Number.isFinite(count) && count >= 0) return Math.trunc(count)
  return Array.isArray(m?.articles) ? m.articles.length : 0
}

/** 每月里的文章：同样兜一道数组，entries 不是数组时当月渲染成空列表而不是崩掉 */
const articlesOf = (m) => (Array.isArray(m?.articles) ? m.articles : [])

/**
 * createTime（后端是 LocalDateTime，形如 `2026-09-10T05:03:19`）→ 只取"日"。
 * 用正则而不是 `new Date(...)`：这个时间戳【没有时区】，交给 Date 解析会按
 * 浏览器本地时区掰一次 —— 凌晨那几篇文章的日期就可能整体差一天。
 * 取不到合法日期时返回空串，页面上那一格空着，不印 "NaN" 或 "undefined"。
 */
const dayOf = (value) => {
  // 第三个 \d{2} 才是"日"（前两个是年、月）—— 抓错一个分组的表现是
  // 页面上所有文章都印着同一个小数字（比如"5"），而它长得完全像正常数据
  const matched = /^\d{4}-\d{2}-(\d{2})/.exec(String(value ?? ''))
  // Number(...) 去掉 "01" 前面的那个 0：日期是 1 号时显示 "1 日" 而不是 "01"
  return matched ? String(Number(matched[1])) : ''
}

// ================================================================
//  归档页的 SEO 元信息
//
//  【canonical 固定是 /archive】这一页不接受任何查询参数（排序、筛选都不做），
//  所以不存在"同一份内容的另一个地址"。
//
//  【title / description 都要写】不写的话它会继承站点默认标题
//  （"亿轨星途 · 那句自我介绍"），在搜索结果里长得和首页一模一样 ——
//  两个页面互相抢同一批关键词，而搜索引擎分不清该给谁。
// ================================================================
useSeoMetaFor(() => ({
  path: '/archive',
  title: '归档',
  description: '亿轨星途的全部已发布文章，按年月倒序排列，可以按时间线找到任意一篇旧文。',
  type: 'website',
}))
</script>

<style scoped>
/* 【为什么整页是"平铺"而不是 el-collapse 折叠】
   ① 归档页的诉求就是"一眼看全部"：折叠默认是收起的，那等于把用户想看的
      东西先藏起来，再让他一个月一个月点开
   ② 折叠还有一条很实际的坏处：**浏览器 Ctrl+F 找不到收起面板里的文字**。
      归档页恰恰是"我记得标题里有某个词，来找旧文"的地方 —— 用了折叠，
      站内的滚动查找就废了一半
   ③ 每一条只有"日 + 标题"一行，本身足够紧凑（不像首页卡片带着封面和摘要），
      不需要靠折叠来控制高度；内容特别长时页面滚动本来就能用
   ④ 用折叠组件实现"全部展开"还得给每个面板传默认展开的 name 数组，
      等于用了折叠却全是展开态 —— 多一层交互和 DOM，换不到任何东西 */
.archive { max-width: 1080px; margin: 0 auto; padding: 40px 32px 40px; }

.ar-head { margin-bottom: 24px; }
.ar-head h1 { font-size: 28px; font-weight: 800; margin: 0 0 8px; }
.ar-sub { margin: 0; color: var(--muted); font-size: 14px; }

/* 空的 / 出错时的占位块：和首页 .w-empty 一样的"安静"风格，只多一层玻璃底 */
.ar-state { border-radius: 20px; padding: 60px 24px; text-align: center; color: var(--muted); font-size: 14px; }
.ar-link { color: var(--accent); margin-left: 6px; text-decoration: none; }
.ar-link:hover { text-decoration: underline; }

.ar-months { display: flex; flex-direction: column; gap: 18px; }
.ar-month { border-radius: 20px; padding: 20px 24px 8px; }

/* 月份标题做成"左侧时间轴 + 右侧篇数"两栏：一眼能看出这一段是几月、有多少篇 */
.am-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin: 0 0 12px; }
.am-date { font-size: 19px; font-weight: 800; color: var(--ink); }
.am-count { font-size: 12px; color: var(--accent); font-weight: 700; }

.am-list { list-style: none; margin: 0; padding: 0; }
.am-item {
  display: flex; align-items: baseline; gap: 14px;
  padding: 9px 10px; border-radius: 10px;
  color: var(--muted); text-decoration: none;
  transition: color .2s, background .2s;
}
.am-item:hover { color: var(--ink); background: rgba(255,255,255,.05); }
/* 「日」固定宽度右对齐：这样不同月份的文章标题左边缘是对齐的，
   扫读的时候视线不会一行一行地跳 */
.am-day { width: 26px; flex-shrink: 0; text-align: right; color: var(--accent); font-weight: 700; font-size: 13px; }
.am-title { font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

@media (max-width: 640px) {
  .archive { padding: 24px 16px; }
  .am-title { white-space: normal; }
}
</style>
