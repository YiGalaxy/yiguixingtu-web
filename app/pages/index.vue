<template>
  <div class="home">
    <!-- 顶部搜索栏 -->
    <div class="search-wrap">
      <div class="searchbox glass">
        <span class="s-ico">⌕</span>
        <input v-model="kw" placeholder="输入关键词后按回车搜索..." @keyup.enter="doSearch" />
        <button v-if="kw" class="s-clear" title="清除" @click="clearSearch">✕</button>
      </div>
    </div>

    <!-- 个人卡片 + 音乐卡片（两卡并排） -->
    <section class="toprow">
      <div class="profile glass" id="profile">
        <div class="pf-head">
          <div class="pf-avatar"><img src="/cover-1.png" alt="avatar" /></div>
          <div class="pf-info">
            <div class="pf-name">亿轨星途</div>
            <div class="pf-sub">在代码与星轨之间，慢慢画自己的图。</div>
          </div>
        </div>
        <div class="pf-stats">
          <div class="st"><b>{{ stat.articles }}</b><span>文章</span></div>
          <div class="st"><b>{{ stat.views }}</b><span>浏览</span></div>
          <div class="st"><b>{{ stat.categories }}</b><span>分类</span></div>
        </div>
        <div class="pf-links">
          <span class="pl" title="GitHub">GU</span>
          <span class="pl" title="邮箱">@</span>
          <span class="pl" title="RSS">RSS</span>
        </div>
      </div>

      <div class="music glass" id="music">
        <div class="mu-badge">CLOUD MUSIC</div>
        <div class="mu-main">
          <div class="mu-cover"><img :src="tracks[cur].cover" alt="cover" /></div>
          <div class="mu-info">
            <div class="mu-title">{{ tracks[cur].title }}</div>
            <div class="mu-art">亿轨星途</div>
          </div>
        </div>
        <div class="mu-progress"><div class="mu-bar" :style="{ width: prog + '%' }"></div></div>
        <div class="mu-ctl">
          <button @click="prev">⏮</button>
          <button class="play" @click="playPause">{{ playing ? '❚❚' : '▶' }}</button>
          <button @click="next">⏭</button>
        </div>
        <audio ref="audioRef" src="/bg-music.mp3" @timeupdate="onTime" @ended="next"></audio>
      </div>
    </section>

    <!-- 公告跑马灯 -->
    <div class="notice glass">
      <div class="notice-track">
        <span>欢迎来到亿轨星途 · 好，支持，威武，有希望了！ · 愿你我都能把想法落成文字 ·</span>
        <span>欢迎来到亿轨星途 · 好，支持，威武，有希望了！ · 愿你我都能把想法落成文字 ·</span>
      </div>
    </div>

    <!-- 文章瀑布流（带封面） -->
    <section class="waterfall-wrap" id="articles">
      <div class="w-head">
        <h2>{{ kw ? '「' + kw + '」的搜索结果' : '最新文章' }}</h2>
        <span v-if="kw" class="w-clear" @click="clearSearch">清除搜索</span>
      </div>

      <!-- 三种状态：加载中 / 空 / 有数据。
           用 v-if / v-else-if / v-else 是【互斥】的 —— 同一时刻只会渲染一个，
           不会出现"转圈的同时还显示着上次的数据"这种错乱。 -->
      <div v-if="loading && articles.length === 0" class="w-empty">加载中…</div>
      <div v-else-if="articles.length === 0" class="w-empty">
        {{ kw ? '没有找到相关文章，换个词试试' : '还没有发布任何文章' }}
      </div>
      <div v-else class="waterfall">
        <a v-for="(a, i) in articles" :key="a.id" href="#" class="af glass"
           :class="{ big: i === 0 }"
           @click.prevent="goArticle(a.id)">
          <div class="af-cover"><img :src="coverOf(a, i)" :alt="a.title" loading="lazy" /></div>
          <div class="af-body">
            <span class="af-tag">{{ a.categoryName || '未分类' }}</span>
            <h3 class="af-title">{{ a.title }}</h3>
            <p v-if="a.summary" class="af-sum">{{ a.summary }}</p>
            <div class="af-meta">
              <span>{{ fmtDate(a.createTime) }}</span>
              <span>{{ a.viewCount || 0 }} 次浏览</span>
              <span class="af-go">阅读全文 ↗</span>
            </div>
          </div>
        </a>
      </div>

      <div v-if="hasMore && !loading" class="w-more">
        <button class="more-btn" @click="loadMore">加载更多</button>
      </div>
    </section>

    <!-- 右下浮动小角色 -->
    <div class="mascot" title="亿轨星途" @click="onMascot"><img src="/cover-2.png" /></div>

    <!-- 左下观看人数 -->
    <div class="viewers"><span class="dot"></span> 1 人正在看</div>

    <!-- 左侧吸附菜单 -->
    <div class="dock">
      <button class="di" :class="{ on: open.clock }" @click="toggle('clock')"><span>◷</span><i>时钟</i></button>
      <button v-if="isAdmin" class="di" :class="{ on: open.msg }" @click="toggle('msg')"><span>✉</span><i>留言</i></button>
    </div>

    <!-- 时钟面板 -->
    <div v-if="open.clock" class="wpanel glass" :style="posStyle('clock')">
      <div class="wp-head" @pointerdown="startDrag('clock', $event)">
        <span class="wp-t">时钟</span>
        <span class="wp-x" @click="close('clock')">×</span>
      </div>
      <div class="wp-body clock">
        <div class="ck-time">{{ now.time }}</div>
        <div class="ck-date">{{ now.date }}</div>
      </div>
    </div>

    <!-- 留言面板（仅后台可见） -->
    <div v-if="open.msg" class="wpanel glass" :style="posStyle('msg')">
      <div class="wp-head" @pointerdown="startDrag('msg', $event)">
        <span class="wp-t">后台留言</span>
        <span class="wp-x" @click="close('msg')">×</span>
      </div>
      <div class="wp-body msgs">
        <div v-for="(m, i) in msgs" :key="i" class="msg">
          <img class="msg-av" :src="m.av" />
          <div><div class="msg-n">{{ m.name }}</div><div class="msg-c">{{ m.text }}</div></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ElMessage } from 'element-plus'
const { openLogin, openRegister } = useAuthUi()
const { token, user } = useAuth()
const isAdmin = computed(() => user.value?.role === 'ADMIN')

const kw = ref('')
const tracks = [
  { title: '雨落星轨', cover: '/cover-1.png' },
  { title: '夜航', cover: '/cover-2.png' },
  { title: '星际漫游', cover: '/cover-3.png' },
]
const cur = ref(0)
const playing = ref(false)
const prog = ref(0)
const audioRef = ref()
const playPause = () => { if (!audioRef.value) return; playing.value ? audioRef.value.pause() : audioRef.value.play(); playing.value = !playing.value }
const onTime = () => { if (audioRef.value?.duration) prog.value = (audioRef.value.currentTime / audioRef.value.duration) * 100 }
const prev = () => { cur.value = (cur.value - 1 + tracks.length) % tracks.length; resetAudio() }
const next = () => { cur.value = (cur.value + 1) % tracks.length; resetAudio() }
const resetAudio = () => { if (audioRef.value) { audioRef.value.currentTime = 0; prog.value = 0; if (playing.value) audioRef.value.play() } }

// ================================================================
//  文章列表：从后端真实拉取
// ================================================================
const { request } = useApi()

const articles = ref([])
const total = ref(0)            // 后端返回的【总条数】，不是当前页条数
const loading = ref(false)
const categories = ref([])
const page = ref(1)
const SIZE = 12                 // 每页 12 篇，3 列瀑布流正好 4 行

// 个人卡片上的三个数字
const stat = computed(() => ({
  articles: total.value,
  categories: categories.value.length,
  // 【注意】浏览数是"已加载文章"的合计，不是全站总数。
  // 想要精确总数，需要后端加一个统计接口（比如 GET /article/stats
  // 直接 SELECT SUM(view_count) FROM article WHERE status=1）。
  // 现在够用，等文章多了再补。
  views: articles.value.reduce((sum, a) => sum + (a.viewCount || 0), 0),
}))

// 封面兜底：文章没填封面时，用自带的 3 张图轮着顶，避免出现破图
const DEFAULT_COVERS = ['/cover-1.png', '/cover-2.png', '/cover-3.png']
const coverOf = (a, i) => a.cover || DEFAULT_COVERS[i % DEFAULT_COVERS.length]

// 还有没有下一页：已加载条数 < 总数 就说明还有
const hasMore = computed(() => articles.value.length < total.value)

/**
 * 拉文章列表。
 * @param append true=追加到列表末尾（加载更多），false=整页替换（搜索/刷新）
 *
 * 这里请求的是【前台公开接口】/article/page —— 它只返回已发布的文章，
 * 所以你后台的草稿绝不会出现在首页上（这条在 ArticlePublicTest 里有测试守着）。
 */
const fetchArticles = async (append = false) => {
  loading.value = true
  const res = await request('/article/page', {
    params: {
      page: page.value,
      size: SIZE,
      keyword: kw.value || undefined,     // 空字符串不要发过去
    },
  })
  loading.value = false
  if (!res.ok) return

  const records = res.data.records || []
  articles.value = append ? [...articles.value, ...records] : records
  total.value = Number(res.data.total) || 0
}

const fetchCategories = async () => {
  const res = await request('/category/list')
  if (res.ok) categories.value = res.data || []
}

// ---------- 搜索 / 分页 / 跳转 ----------
const doSearch = () => { page.value = 1; fetchArticles(false) }
const clearSearch = () => { kw.value = ''; doSearch() }
const loadMore = () => { page.value += 1; fetchArticles(true) }
const goArticle = (id) => navigateTo('/article/' + id)

// 时间只显示到"天"，卡片上不需要精确到秒
const fmtDate = (t) => (t ? String(t).replace('T', ' ').slice(0, 10) : '')

const now = reactive({ time: '', date: '' })
const tick = () => { const d = new Date(); now.time = d.toLocaleTimeString('zh-CN', { hour12: false }); now.date = d.toLocaleDateString('zh-CN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) }
tick()
onMounted(() => setInterval(tick, 1000))

const msgs = [
  { name: '访客A', text: '这个站点真好看！', av: '/cover-3.png' },
  { name: '访客B', text: '期待你的技术文章。', av: '/cover-1.png' },
]

// —— 侧边菜单 + 可拖动面板 ——
const open = reactive({ clock: false, msg: false })
const pos = reactive({ clock: { x: 90, y: 160 }, msg: { x: 90, y: 260 } })
const posStyle = (k) => ({ left: pos[k].x + 'px', top: pos[k].y + 'px' })
const toggle = (k) => { open[k] = !open[k]; if (open[k]) { pos[k].x = 90; pos[k].y = 120 + Object.keys(open).filter(x => x !== k).length * 0 } }
const close = (k) => { open[k] = false; pos[k].x = 90; pos[k].y = 160 }
let drag = null
const startDrag = (k, e) => { drag = { k, sx: e.clientX, sy: e.clientY, ox: pos[k].x, oy: pos[k].y }; document.addEventListener('pointermove', onMove); document.addEventListener('pointerup', onUp) }
const onMove = (e) => { if (!drag) return; pos[drag.k].x = drag.ox + (e.clientX - drag.sx); pos[drag.k].y = drag.oy + (e.clientY - drag.sy) }
const onUp = () => { drag = null; document.removeEventListener('pointermove', onMove); document.removeEventListener('pointerup', onUp) }

const onMascot = () => { ElMessage.info('欢迎来到亿轨星途 ✦') }

// 首屏加载：文章列表 + 分类（两个请求互不依赖，并行发）
onMounted(() => {
  fetchArticles(false)
  fetchCategories()
})
</script>

<style scoped>
.home { }
.search-wrap { max-width: 1080px; margin: 0 auto; padding: 40px 32px 12px; }
.searchbox { display: flex; align-items: center; gap: 10px; padding: 0 18px; height: 48px; border-radius: 999px; }
.s-ico { color: var(--accent); font-size: 18px; }
.searchbox input { flex: 1; background: transparent; border: none; outline: none; color: var(--ink); font-size: 15px; }
.searchbox input::placeholder { color: var(--muted); }

.toprow { max-width: 1080px; margin: 0 auto; padding: 20px 32px; display: grid; grid-template-columns: 1.4fr 1fr; gap: 20px; }
/* 毛玻璃降档：blur 14->10 并去掉 saturate()。
   backdrop-filter 会让浏览器【每一帧】重新采样并模糊它背后的内容，
   而背景正好是播放中的视频 —— 这是首页卡顿的最大来源。 */
.glass { background: rgba(36,54,92,.34); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); border: 1px solid rgba(180,210,245,.14); box-shadow: inset 0 1px 0 rgba(255,255,255,.08); }
.profile { border-radius: 22px; padding: 24px; }
.pf-head { display: flex; gap: 16px; align-items: center; }
.pf-avatar { width: 64px; height: 64px; border-radius: 50%; overflow: hidden; border: 2px solid rgba(242,193,78,.5); }
.pf-avatar img { width: 100%; height: 100%; object-fit: cover; }
.pf-name { font-size: 22px; font-weight: 800; }
.pf-sub { color: var(--muted); font-size: 13px; margin-top: 4px; }
.pf-stats { display: flex; gap: 32px; margin: 22px 0; }
.st { display: flex; flex-direction: column; }
.st b { font-size: 24px; font-weight: 800; color: var(--accent); }
.st span { color: var(--muted); font-size: 12px; }
.pf-links { display: flex; gap: 10px; }
.pl { width: 32px; height: 32px; border-radius: 9px; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,.06); border: 1px solid var(--line); color: var(--muted); font-size: 12px; cursor: pointer; transition: .2s; }
.pl:hover { color: var(--accent); border-color: var(--accent); }

.music { border-radius: 22px; padding: 20px 22px; }
.mu-badge { font-size: 11px; letter-spacing: 2px; color: var(--accent); font-weight: 700; }
.mu-main { display: flex; gap: 14px; align-items: center; margin: 14px 0; }
.mu-cover { width: 72px; height: 72px; border-radius: 14px; overflow: hidden; box-shadow: 0 6px 20px rgba(0,0,0,.4); }
.mu-cover img { width: 100%; height: 100%; object-fit: cover; }
.mu-title { font-weight: 800; font-size: 17px; }
.mu-art { color: var(--muted); font-size: 13px; }
.mu-progress { height: 5px; border-radius: 999px; background: rgba(255,255,255,.08); overflow: hidden; }
.mu-bar { height: 100%; background: linear-gradient(90deg, var(--accent), var(--cyan)); width: 0; }
.mu-ctl { display: flex; align-items: center; justify-content: center; gap: 16px; margin-top: 14px; }
.mu-ctl button { background: none; border: none; color: var(--ink); font-size: 18px; cursor: pointer; }
.mu-ctl .play { width: 42px; height: 42px; border-radius: 50%; background: linear-gradient(135deg, var(--accent), var(--cyan)); color: #0a1224; font-weight: 800; display: flex; align-items: center; justify-content: center; }

.notice { max-width: 1080px; margin: 20px auto; padding: 12px 0; border-radius: 999px; overflow: hidden; }
.notice-track { display: flex; width: max-content; white-space: nowrap; animation: marquee 20s linear infinite; }
.notice-track span { color: #cfdcf0; font-size: 14px; letter-spacing: 1px; padding: 0 40px; }
@keyframes marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }

.waterfall-wrap { max-width: 1080px; margin: 0 auto; padding: 12px 32px 40px; }
.w-head h2 { font-size: 24px; font-weight: 800; margin: 0 0 20px; }
.waterfall { columns: 3; column-gap: 18px; }
.af { display: block; break-inside: avoid; margin-bottom: 18px; border-radius: 20px; overflow: hidden; text-decoration: none; transition: transform .25s, box-shadow .25s; }
/* 【性能关键】文章卡片去掉 backdrop-filter。
   卡片上半部分是封面图（本来就不透明），再叠一层实时模糊纯属浪费，
   而首页一次就有 6+ 张卡片同时在动 —— 去掉后卡顿改善非常明显，外观几乎无变化。 */
.af { background: rgba(30,47,82,.66); backdrop-filter: none; -webkit-backdrop-filter: none; }
.af:hover { transform: translateY(-4px); box-shadow: 0 20px 50px rgba(0,0,0,.4); }
.af-cover { aspect-ratio: 16/10; overflow: hidden; }
.af.big .af-cover { aspect-ratio: 16/11; }
.af-cover img { width: 100%; height: 100%; object-fit: cover; transition: transform .6s; }
.af:hover .af-cover img { transform: scale(1.06); }
.af-body { padding: 16px 18px 18px; }
.af-tag { font-size: 12px; color: #cfe0f0; border: 1px solid rgba(180,210,245,.25); border-radius: 999px; padding: 2px 10px; }
.af-title { font-size: 17px; font-weight: 700; line-height: 1.4; margin: 10px 0 8px; color: var(--ink); }
.af-go { color: var(--accent); font-size: 12px; font-weight: 600; }

/* 卡片摘要：最多 2 行，超出打省略号。
   -webkit-line-clamp 是"多行省略"的标准写法（带前缀，但 Chrome/Edge/Safari/Firefox 都支持）。 */
.af-sum {
  color: var(--muted); font-size: 13px; line-height: 1.6; margin: 0 0 10px;
  display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2;
  -webkit-box-orient: vertical; overflow: hidden;
}
.af-meta { display: flex; align-items: center; gap: 12px; color: var(--muted); font-size: 12px; }
.af-meta .af-go { margin-left: auto; }   /* 把"阅读全文"推到最右边 */

/* 标题行改成两端对齐：左边标题，右边「清除搜索」 */
.w-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 20px; }
.w-head h2 { margin: 0; }
.w-clear { color: var(--accent); font-size: 13px; cursor: pointer; }
.w-empty { text-align: center; color: var(--muted); padding: 60px 0; font-size: 14px; }
.w-more { text-align: center; margin-top: 6px; }

/* 「加载更多」按钮。
   特意没用 .glass —— 玻璃类带 backdrop-filter，
   而这个按钮长期停留在页面底部，没必要为它付"每帧重新模糊"的代价。 */
.more-btn {
  background: rgba(30,47,82,.66);
  border: 1px solid rgba(180,210,245,.18);
  color: var(--ink); padding: 10px 30px; border-radius: 999px;
  cursor: pointer; font-size: 14px; transition: border-color .2s, color .2s;
}
.more-btn:hover { border-color: rgba(242,193,78,.5); color: var(--accent); }

/* 搜索栏右侧的清除按钮 */
.s-clear { background: none; border: none; color: var(--muted); cursor: pointer; font-size: 14px; padding: 4px 6px; }
.s-clear:hover { color: var(--accent); }

.mascot { position: fixed; right: 22px; top: 45%; width: 84px; height: 84px; border-radius: 50%; overflow: hidden; cursor: pointer; border: 2px solid rgba(242,193,78,.5); box-shadow: 0 12px 30px rgba(0,0,0,.4); animation: bob 5s ease-in-out infinite; z-index: 5; }
.mascot img { width: 100%; height: 100%; object-fit: cover; }
@keyframes bob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-14px); } }
.viewers { position: fixed; left: 22px; bottom: 22px; color: var(--muted); font-size: 13px; display: flex; align-items: center; gap: 8px; z-index: 5; }
.viewers .dot { width: 8px; height: 8px; border-radius: 50%; background: #4ade80; box-shadow: 0 0 8px #4ade80; animation: pulseDot 1.6s infinite; }
@keyframes pulseDot { 0%,100% { opacity: .4; } 50% { opacity: 1; } }

.dock { position: fixed; left: 0; top: 50%; transform: translateY(-50%); display: flex; flex-direction: column; gap: 10px; padding: 12px 10px; background: rgba(14,24,48,.72); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); border-radius: 0 16px 16px 0; z-index: 10; border: 1px solid rgba(180,210,245,.12); border-left: none; }
.di { display: flex; flex-direction: column; align-items: center; gap: 4px; background: none; border: none; color: var(--muted); cursor: pointer; padding: 6px 8px; border-radius: 10px; }
.di span { font-size: 16px; }
.di i { font-style: normal; font-size: 10px; }
.di:hover, .di.on { color: var(--accent); background: rgba(242,193,78,.12); }

.wpanel { position: fixed; z-index: 20; min-width: 220px; border-radius: 18px; overflow: hidden; }
.wp-head { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; cursor: grab; border-bottom: 1px solid var(--line); }
.wp-t { font-weight: 700; font-size: 14px; }
.wp-x { cursor: pointer; color: var(--muted); font-size: 18px; }
.wp-x:hover { color: var(--accent); }
.wp-body { padding: 16px; }
.clock { text-align: center; }
.ck-time { font-size: 30px; font-weight: 800; letter-spacing: 2px; color: var(--accent); }
.ck-date { color: var(--muted); font-size: 12px; margin-top: 6px; }
.msgs { display: flex; flex-direction: column; gap: 12px; max-height: 220px; overflow-y: auto; }
.msg { display: flex; gap: 10px; }
.msg-av { width: 32px; height: 32px; border-radius: 50%; object-fit: cover; }
.msg-n { font-size: 12px; font-weight: 700; color: var(--accent); }
.msg-c { font-size: 13px; color: var(--ink); margin-top: 2px; }

@media (max-width: 820px) {
  .toprow { grid-template-columns: 1fr; }
  .waterfall { columns: 1; }
  .dock { top: auto; bottom: 80px; }
  .mascot { display: none; }
}
</style>
