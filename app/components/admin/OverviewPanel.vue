<template>
  <!--
    概览：四张数字卡片 + 最近文章。
    【这个面板为什么一个事件都不往外抛】它只负责"把父页面已经拿到的数据画出来"：
    四个数字是父页面在进入后台时就并行拉好的（见 admin.vue 的 onMounted），
    最近文章用的是父页面那份 `articles`。所以这里没有任何请求，
    也没有任何自己的状态 —— 纯展示，改起来不会牵动别处。
  -->
  <header class="top">
    <h1>概览</h1>
    <p>全站汇总数据（文章数与浏览量只统计已发布文章）</p>
  </header>
  <!-- 四个数字的来源是【独立请求】，和下面各管理页当前的筛选条件无关：
       文章 / 浏览 / 分类走公开接口 GET /article/stats（后端一条聚合 SQL 算好），
       用户在 /user/page 里筛选了什么都不会影响这里。
       接口失败时显示「—」，而不是假装是 0。 -->
  <div class="stats">
    <div class="stat glass"><span>文章（已发布）</span><b>{{ statText(stats.articleCount, statsFailed) }}</b></div>
    <div class="stat glass"><span>浏览量</span><b>{{ statText(stats.viewCount, statsFailed) }}</b></div>
    <div class="stat glass"><span>分类</span><b>{{ statText(stats.categoryCount, statsFailed) }}</b></div>
    <div class="stat glass"><span>用户</span><b>{{ statText(userCount, userCountFailed) }}</b></div>
  </div>
  <div class="panel glass">
    <div class="panel-head">最近文章</div>
    <div v-if="articles.length === 0" class="empty">还没有文章，去「文章管理」写第一篇吧</div>
    <ul v-else class="recent">
      <!-- 只取前 5 篇：概览要的是"最近发生了什么"，不是又一个文章列表 -->
      <li v-for="a in articles.slice(0, 5)" :key="a.id">
        <span class="r-title">{{ a.title }}</span>
        <span class="r-meta">
          <el-tag :type="a.status === 1 ? 'success' : 'info'" size="small" effect="plain">
            {{ a.status === 1 ? '已发布' : '草稿' }}
          </el-tag>
          {{ formatDateTime(a.createTime) }}
        </span>
      </li>
    </ul>
  </div>
</template>

<script setup>
// props 全部是只读的：这个面板不改任何数据，只按父页面给的值渲染
defineProps({
  /** GET /article/stats 的三个数字（只统计已发布文章） */
  stats: { type: Object, required: true },
  /** 统计接口是否失败：失败时数字显示「—」而不是 0 */
  statsFailed: { type: Boolean, default: false },
  /** 用户数是单独一次 page=1&size=1 查询的 total，不复用用户表格的 total */
  userCount: { type: Number, default: 0 },
  userCountFailed: { type: Boolean, default: false },
  /** 父页面那份文章列表（最近文章取前 5 篇） */
  articles: { type: Array, default: () => [] },
})

/** 数字显示：接口失败显示「—」，不要用 0 冒充一个确定的答案 */
const statText = (value, failed) => (failed ? '—' : value)
</script>

<style scoped>
/* 概览专有的样式跟着它自己走（拆组件之前这些规则挤在 admin.vue 里） */
.stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px; }
.stat { border-radius: 18px; padding: 22px; display: flex; flex-direction: column; gap: 10px; }
.stat span { color: var(--muted); font-size: 13px; }
.stat b { font-size: 34px; font-weight: 800; color: var(--accent); }

/* 「最近文章」列表 */
.recent { list-style: none; margin: 0; padding: 0; }
.recent li {
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding: 12px 4px; border-bottom: 1px solid rgba(150,190,240,.10);
}
.recent li:last-child { border-bottom: none; }
.r-title { color: var(--ink); font-weight: 600; }
.r-meta { display: flex; align-items: center; gap: 12px; color: var(--muted); font-size: 12px; }

/* 窄屏：四张卡片排两行（放在这里而不是 admin.vue 的媒体查询里，
   是为了让"概览的卡片长什么样"只有这一处定义 —— 两处都写会变成
   两个同优先级的规则抢同一行，谁生效取决于样式块的先后） */
@media (max-width: 820px) {
  .stats { grid-template-columns: repeat(2,1fr); }
}
</style>
