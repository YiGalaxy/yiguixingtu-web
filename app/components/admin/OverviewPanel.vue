<template>
  <!-- Overview is a presentation component; data comes from the parent. -->
  <header class="top">
    <h1>概览</h1>
    <p>全站汇总数据（文章数与浏览量只统计已发布文章）</p>
  </header>
  <div class="stats">
    <div class="stat glass"><span>文章（已发布）</span><b>{{ statText(stats.articleCount, statsFailed) }}</b></div>
    <div class="stat glass"><span>浏览量</span><b>{{ statText(stats.viewCount, statsFailed) }}</b></div>
    <div class="stat glass"><span>分类</span><b>{{ statText(stats.categoryCount, statsFailed) }}</b></div>
    <div class="stat glass"><span>用户</span><b>{{ statText(userCount, userCountFailed) }}</b></div>
  </div>
  <div class="panel glass">
    <div class="panel-head">
      访问统计
      <span class="vs-days">
        <el-button
          size="small"
          :disabled="!visits || visits.totalPv === 0"
          @click="openIpList">访客 IP</el-button>
        <el-radio-group v-model="visitDays" size="small" @change="loadVisits">
          <el-radio-button :value="7">近 7 天</el-radio-button>
          <el-radio-button :value="30">近 30 天</el-radio-button>
          <el-radio-button :value="90">近 90 天</el-radio-button>
        </el-radio-group>
      </span>
    </div>

    <div v-if="visitsFailed" class="empty">访问数据读取失败（不影响其它统计）</div>
    <div v-else-if="!visits || visits.totalPv === 0" class="empty">
      这段时间还没有访问记录。等有人来过之后这里就会出现曲线。
    </div>
    <template v-else>
      <!-- 三个关键数字：访问次数 / 独立访客 / 其中新访客。
           【为什么 PV 和 UV 要并排放】PV 一个数字很容易自欺欺人（自己刷十次就是十个），
           旁边那个"多少个不同的人"才是真正想看的。 -->
      <div class="vs-nums">
        <div class="vs-num"><span>访问次数（PV）</span><b>{{ visits.totalPv }}</b></div>
        <div class="vs-num"><span>独立访客（UV）</span><b>{{ visits.totalUv }}</b></div>
        <div class="vs-num">
          <span>其中首次来访</span>
          <b>{{ visits.newVisitors }}</b>
          <em>{{ newVisitorRatio }}</em>
        </div>
      </div>

      <StatsChart :option="dailyOption" height="280px" />

      <div class="vs-grid">
        <div class="vs-block">
          <div class="vs-block-head">访客身份</div>
          <StatsChart :option="pieOption(visits.visitorTypes, VISITOR_LABELS)" height="220px" />
        </div>
        <div class="vs-block">
          <div class="vs-block-head">来源</div>
          <StatsChart :option="pieOption(visits.refererTypes, REFERER_LABELS)" height="220px" />
        </div>
        <div class="vs-block">
          <div class="vs-block-head">设备</div>
          <StatsChart :option="pieOption(visits.devices, DEVICE_LABELS)" height="220px" />
        </div>
      </div>

      <div class="vs-grid vs-grid-2">
        <div class="vs-block">
          <div class="vs-block-head">访问最多的页面</div>
          <ul class="vs-rank">
            <li v-for="p in arrayValue(visits.topPaths)" :key="p.key">
              <span class="vs-rank-name" :title="p.key">{{ p.key }}</span>
              <span class="vs-rank-val">{{ p.value }}</span>
            </li>
          </ul>
        </div>
        <div class="vs-block">
          <div class="vs-block-head">访问最多的文章</div>
          <ul class="vs-rank">
            <li v-for="a in arrayValue(visits.topArticles)" :key="a.id">
              <span class="vs-rank-name" :title="a.title || ''">
                {{ a.title || '（文章已删除）' }}
              </span>
              <span class="vs-rank-val">{{ a.pv }}</span>
            </li>
          </ul>
        </div>
      </div>
    </template>
  </div>

  <!-- ==================== 访客 IP（下钻弹窗） ====================
       【为什么单独一个接口、点开才拉】它带着访客的完整 IP（个人信息），
       与上面那份统计报表分开是为了让"传输范围"和"实际看了多少"对齐 ——
       合并进来的话每次打开概览都会把 IP 一起传到浏览器，哪怕没人点开。
       （后端 AdminVisitController 的类注释里写了同一件事。） -->
  <el-dialog v-model="ipVisible" title="访客 IP" width="min(620px, 92vw)" class="vs-ip-modal">
    <p v-if="ipFailed" class="empty">访客数据读取失败（不影响其它统计）</p>
    <template v-else>
      <el-table v-loading="ipLoading" :data="ipRows" empty-text="这段时间还没有访客记录">
        <el-table-column prop="ip" label="IP" min-width="140" />
        <!-- 归属地：解析不出时为 null（老记录 / IPv6 / 畸形值），显示「—」 -->
        <el-table-column prop="region" label="归属地" min-width="130">
          <template #default="{ row }">{{ row.region || '—' }}</template>
        </el-table-column>
        <el-table-column prop="visits" label="访问次数" width="96" />
        <el-table-column prop="lastVisit" label="最后访问" min-width="150">
          <template #default="{ row }">{{ formatDateTime(row.lastVisit) }}</template>
        </el-table-column>
      </el-table>
      <p class="vs-ip-note">
        按访问次数排序，最多显示 {{ IP_LIMIT }} 个 IP（它回答"都是谁"，不是全量导出）。
        访客 IP 与归属地属于个人信息，超过保留期会自动删除。
      </p>
    </template>
    <template #footer>
      <el-button @click="ipVisible = false">关闭</el-button>
    </template>
  </el-dialog>

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
import StatsChart from './StatsChart.vue'

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

// ---------------------------------------------------------------------
//  访问统计
// ---------------------------------------------------------------------
const { request } = useApi()

// Visit analytics is local to this panel and uses the admin endpoint.
const visitDays = ref(30)
const visits = ref(null)
const visitsFailed = ref(false)
/** 请求中（切 7/30/90 天时会有一小段空白，用它显示加载态） */
const visitsLoading = ref(false)

const loadVisits = async () => {
  visitsLoading.value = true
  const res = await request('/admin/stats/visits', { params: { days: visitDays.value } })
  visitsLoading.value = false
  if (!res.ok || !res.data) {
    visitsFailed.value = true
    visits.value = null
    return
  }
  visitsFailed.value = false
  visits.value = res.data
}

onMounted(loadVisits)

// ---------------------------------------------------------------------
//  访客 IP 列表（统计页下钻出来的那一层）
// ---------------------------------------------------------------------

/** Keep this in sync with the backend visitor IP limit. */
const IP_LIMIT = 200

const ipVisible = ref(false)
const ipLoading = ref(false)
const ipFailed = ref(false)
const ipRows = ref([])

/** Open the drill-down and request IPs for the selected period. */
const openIpList = async () => {
  ipVisible.value = true
  ipLoading.value = true
  ipFailed.value = false
  const res = await request('/admin/stats/visits/ips', { params: { days: visitDays.value } })
  ipLoading.value = false
  if (!res.ok || !res.data) {
    ipFailed.value = true
    ipRows.value = []
    return
  }
  ipRows.value = res.data
}

/** 首次来访占比：把它写在"新访客"数字旁边，比单看一个绝对值有信息量得多 */
const newVisitorRatio = computed(() => {
  const v = visits.value
  if (!v || !v.totalUv) return ''
  return `占 ${Math.round((v.newVisitors / v.totalUv) * 100)}%`
})

// ---------- 分组值 → 中文 ----------
// 【为什么中文放在前端】这些 key 是**统计口径**（后端定义"怎么分类"），
// 而"显示成什么字"是界面的事。后端加一档时前端不会崩（认不出就原样显示）。
const VISITOR_LABELS = { GUEST: '游客', USER: '注册用户', ADMIN: '管理员' }
const REFERER_LABELS = { INTERNAL: '站内跳转', EXTERNAL: '外链', DIRECT: '直接访问' }
const DEVICE_LABELS = { PC: '电脑', MOBILE: '手机' }

/** 主题色（与全站暗色主题一致；饼图需要一组能区分的颜色） */
const CHART_COLORS = ['#f2c14e', '#7fb2f0', '#6ee7b7', '#f0868a', '#b78af0']

const AXIS_STYLE = {
  axisLabel: { color: '#8fa3bf', fontSize: 11 },
  axisLine: { lineStyle: { color: 'rgba(150,190,240,.2)' } },
  splitLine: { lineStyle: { color: 'rgba(150,190,240,.08)' } },
}

/** Build a complete date series, filling days without records with zero. */
const dailyOption = computed(() => {
  const v = visits.value
  if (!v) return {}

  const byDate = new Map((Array.isArray(v.daily) ? v.daily : []).map(d => [String(d.date).slice(0, 10), d]))
  const dates = []
  const pv = []
  const uv = []
  const today = new Date()
  const days = Number(v.days) > 0 ? Number(v.days) : 1
  for (let i = days - 1; i >= 0; i -= 1) {
    const day = new Date(today)
    day.setDate(today.getDate() - i)
    // 用本地日期拼 yyyy-MM-dd（不能用 toISOString：那是 UTC，跨时区会差一天）
    const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
    dates.push(key.slice(5))     // 轴上只显示 MM-DD，年份在标题里
    const point = byDate.get(key)
    pv.push(point ? point.pv : 0)
    uv.push(point ? point.uv : 0)
  }

  return {
    grid: { left: 8, right: 16, top: 36, bottom: 8, containLabel: true },
    tooltip: { trigger: 'axis' },
    legend: { data: ['访问次数', '独立访客'], textStyle: { color: '#8fa3bf' }, right: 0, top: 0 },
    xAxis: { type: 'category', boundaryGap: false, data: dates, ...AXIS_STYLE },
    yAxis: { type: 'value', minInterval: 1, ...AXIS_STYLE },
    series: [
      {
        name: '访问次数', type: 'line', smooth: true, data: pv,
        itemStyle: { color: CHART_COLORS[0] },
        areaStyle: { color: 'rgba(242,193,78,.12)' },
      },
      {
        name: '独立访客', type: 'line', smooth: true, data: uv,
        itemStyle: { color: CHART_COLORS[1] },
        areaStyle: { color: 'rgba(127,178,240,.10)' },
      },
    ],
  }
})

/** Build a donut chart option with labels and values. */
const pieOption = (slices, labels) => ({
  tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
  legend: { bottom: 0, textStyle: { color: '#8fa3bf', fontSize: 11 } },
  color: CHART_COLORS,
  series: [
    {
      type: 'pie',
      radius: ['45%', '68%'],
      center: ['50%', '43%'],
      avoidLabelOverlap: true,
      label: { color: '#cfdcf0', fontSize: 11, formatter: '{b} {c}' },
      labelLine: { lineStyle: { color: 'rgba(150,190,240,.3)' } },
      // 分组值是英文常量，这里翻成中文（认不出的原样显示，见上面那条注释）
      data: arrayValue(slices).map(s => ({ name: labels[s.key] || s.key, value: s.value })),
  },
],
})

const arrayValue = value => (Array.isArray(value) ? value : [])
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

/* ---------- 访问统计 ---------- */
/* 右上角那组控件：与 panel-head 的标题同一行。
   【为什么是 flex 而不是简单地并排写】「访客 IP」按钮与天数切换器是两组
   独立的控件，靠 inline 元素之间的空白符对齐会随字号/缩放漂移，
   而它们高度也不一样（按钮 24px 左右、radio-group 同样 small），
   align-items:center 让它们在一条中线上。 */
.vs-days { float: right; margin-top: -4px; display: flex; align-items: center; gap: 10px; }

/* 访客 IP 弹窗底部那行说明（"最多 200 个""个人信息"）：
   小字、灰色，不与表格抢注意力 —— 但必须在，见那两句话各自的理由 */
.vs-ip-note { color: var(--muted); font-size: 12px; line-height: 1.7; margin: 12px 0 0; }

/* 三个关键数字：与上面那四张卡片区分开 —— 那四个是"全站累计"，这三个是"这段时间" */
.vs-nums { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 18px; }
.vs-num {
  display: flex; flex-direction: column; gap: 6px;
  padding: 14px 16px; border-radius: 14px;
  background: rgba(150,190,240,.05);
}
.vs-num span { color: var(--muted); font-size: 12px; }
.vs-num b { font-size: 26px; font-weight: 800; color: var(--accent); }
/* "占 xx%" 那行小字跟着数字走，不单独占一行 */
.vs-num em { color: var(--muted); font-size: 12px; font-style: normal; }

/* 三个饼图并排 */
.vs-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 18px; }
/* 两张排行榜并排（只有两块，所以单独一个两列规则） */
.vs-grid-2 { grid-template-columns: repeat(2, 1fr); }
.vs-block { min-width: 0; }
.vs-block-head { color: var(--muted); font-size: 13px; margin-bottom: 8px; }

/* 排行榜：名字超长时省略号截断（path 可能很长），数值靠右对齐 */
.vs-rank { list-style: none; margin: 0; padding: 0; }
.vs-rank li {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 8px 2px; border-bottom: 1px solid rgba(150,190,240,.08);
}
.vs-rank li:last-child { border-bottom: none; }
.vs-rank-name {
  color: var(--ink); font-size: 13px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0;
}
.vs-rank-val { color: var(--accent); font-weight: 600; font-size: 13px; flex: none; }

@media (max-width: 1100px) {
  /* 窄屏时三列饼图与两列排行都变一列 —— 挤在三列里图会小到看不清 */
  .vs-grid, .vs-grid-2 { grid-template-columns: 1fr; }
  .vs-nums { grid-template-columns: 1fr; }
}
</style>
