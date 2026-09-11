<template>
  <div class="home">
    <!-- 顶部搜索栏 -->
    <div class="search-wrap">
      <div class="searchbox glass">
        <span class="s-ico">⌕</span>
        <!-- 输入即搜索：输入框绑的是 keywordInput（即时），
             它会在停手 300ms 后变成 keyword（生效中）—— 请求与地址栏只用 keyword，
             所以一次输入只会产生一次请求（细节见 useArticleFilter）。
             想跳过防抖立刻搜，按回车。 -->
        <input
v-model="keywordInput" placeholder="输入关键词搜索标题 / 摘要"
               @keyup.enter="applyKeywordNow" >
        <button v-if="keywordInput" class="s-clear" title="清除" @click="clearAll">✕</button>
      </div>

      <!-- 分类筛选：数据来自公开接口 GET /category/list（分类表很小，一次全量返回）。
           关键词与分类是【同一个筛选状态】的两个维度，所以共用一套 URL query 与一次请求：
           点「全部」= categoryId 置空，表示不按分类过滤。
           分类为空（接口失败或还没建分类）时整条不渲染 —— 一排空按钮比没有更糟。 -->
      <div v-if="categories.length" class="cats">
        <button
class="cat" :class="{ on: categoryId === null }"
                @click="selectCategory(null)">全部</button>
        <button
v-for="c in categories" :key="c.id" class="cat"
                :class="{ on: categoryId === c.id }"
                @click="selectCategory(c.id)">{{ c.name }}</button>
      </div>

      <!-- 标签筛选：数据来自公开接口 GET /tag/list（带每个标签下【已发布】的文章数）。
           标签是筛选状态的【第三个维度】，和关键词、分类共用同一套 URL query
           与同一次 /article/page 请求（后端把三者按 AND 叠加），
           所以这里不新开一套状态，只把 useArticleFilter 里的 tagId 绑上去。
           与分类那一排有一个刻意的区别：这里【没有「全部标签」按钮】——
           标签的数量不定，再排一个按钮既占地方、又和分类那排的按钮重复；
           取消的方式是在同一颗胶囊上再点一次（见 useArticleFilter 的 selectTag）。 -->
      <div v-if="tags.length" class="tags">
        <button
v-for="t in tags" :key="t.id" class="tagp"
                :class="{ on: tagId === t.id }"
                :title="tagCountTip(t)"
                @click="selectTag(t.id)">#{{ t.name }}</button>
      </div>
    </div>

    <!-- 个人卡片 + 音乐卡片（两卡并排） -->
    <section class="toprow">
      <div id="profile" class="profile glass">
        <div class="pf-head">
          <div class="pf-avatar"><img src="/cover-1.png" alt="avatar" ></div>
          <!-- 同上：这里原来写的是 class="pf-info"，全项目也没有这条规则，
               只是包裹用的 div，去掉类名渲染结果完全相同。 -->
          <div>
            <div class="pf-name">亿轨星途</div>
            <div class="pf-sub">在代码与星轨之间，慢慢画自己的图。</div>
          </div>
        </div>
        <div class="pf-stats">
          <!-- 三个数字都来自后端 GET /article/stats（口径：只统计已发布文章），
               不再是"当前这一页的文章求和" -->
          <div class="st"><b>{{ statText(siteStats.articleCount) }}</b><span>文章</span></div>
          <div class="st"><b>{{ statText(siteStats.viewCount) }}</b><span>浏览</span></div>
          <div class="st"><b>{{ statText(siteStats.categoryCount) }}</b><span>分类</span></div>
        </div>
        <!-- 这里原来还有 GitHub / 邮箱 / RSS 三个按钮，但它们背后【没有任何地址】：
             点下去什么也不会发生。与其摆三个"看起来能点"的假入口，
             不如先不显示 —— 等真有链接了再加回来（顺便说：本站也没有 RSS 输出，
             后端根本没这个接口）。 -->
      </div>

      <!-- 音乐卡片：播放的是站点自带的那个真实音频文件（static-media/bg-music.mp3）。
           改之前这里是个"假播放列表"：三个曲名（雨落星轨 / 夜航 / 星际漫游）
           与上一首 / 下一首按钮都是写死的，而实际上只有这一个音频文件，
           点下一首只是把 cur 加一、曲名换个字，音乐从头开始放同一段。
           现在只保留真实存在的东西：一个音轨、一个播放键。
           【地址不写死】src 由 mediaUrl() 拼出来：这个文件不在 public/ 里（不进构建产物），
           线上由 Nginx 的 /media/ 提供、dev 由 Nitro 的开发路由提供，见 app/utils/media.ts。 -->
      <div id="music" class="music glass">
        <div class="mu-badge">BACKGROUND MUSIC</div>
        <div class="mu-main">
          <div class="mu-cover"><img src="/cover-1.png" alt="背景音乐封面" ></div>
          <!-- 【原来这里是 class="mu-info"，但全项目没有任何 .mu-info 规则】
               同类缺陷在归档页造成了真问题（写了 class="glass" 却没有任何规则命中，
               卡片没有背景、文字糊在背景视频上）。这里虽然只是个纯包裹用的 div
               （去掉类名渲染结果完全相同，一个没有规则的类对视觉零影响），
               但"看起来像有样式、其实没有"的类留着就是隐患，所以直接去掉类名。
               这条由 test/styleContract.nuxt.spec.ts 守着。 -->
          <div>
            <!-- 不写曲名：本站没有这些曲目，编一个"雨落星轨"出来只是好看 -->
            <div class="mu-title">背景音乐</div>
            <div class="mu-art">站点自带音轨</div>
          </div>
        </div>
        <div class="mu-progress"><div class="mu-bar" :style="{ width: prog + '%' }"/></div>
        <div class="mu-ctl">
          <button class="play" @click="playPause">{{ playing ? '❚❚' : '▶' }}</button>
        </div>
        <audio ref="audioRef" :src="bgMusicSrc" @timeupdate="onTime" @ended="onEnded" @play="onPlay" @pause="onPause"/>
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
    <section id="articles" class="waterfall-wrap">
      <div class="w-head">
        <!-- 标题跟着筛选条件走：让用户一眼看出"现在看到的是哪一批文章" -->
        <h2>{{ listTitle }}</h2>
        <span v-if="isFiltered" class="w-clear" @click="clearAll">清除筛选</span>
      </div>

      <!-- 三种状态：加载中 / 空 / 有数据。
           用 v-if / v-else-if / v-else 是【互斥】的 —— 同一时刻只会渲染一个，
           不会出现"转圈的同时还显示着上次的数据"这种错乱。 -->
      <div v-if="loading && articles.length === 0" class="w-empty">加载中…</div>
      <div v-else-if="articles.length === 0" class="w-empty">
        {{ isFiltered ? '没有找到相关文章，换个关键词、分类或标签试试' : '还没有发布任何文章' }}
      </div>
      <div v-else class="waterfall">
        <a
v-for="(a, i) in articles" :key="a.id" href="#" class="af glass"
           :class="{ big: i === 0 }"
           @click.prevent="goArticle(a.id)">
          <div class="af-cover"><img :src="coverOf(a, i)" :alt="a.title" loading="lazy" ></div>
          <div class="af-body">
            <span class="af-tag">{{ a.categoryName || '未分类' }}</span>
            <h3 class="af-title">{{ a.title }}</h3>
            <p v-if="a.summary" class="af-sum">{{ a.summary }}</p>
            <!-- 文章身上的标签（后端列表项与详情都会带 tags，没有标签时是空数组）。
                 点它 = 按这个标签筛一批文章：请求参数与地址栏都由 useArticleFilter 管，
                 这里只负责把 id 交出去。
                 【@click.stop.prevent 两个修饰符都不能省】
                   · .prevent：它外面那层 <a href="#"> 否则会跳一下
                   · .stop：不拦下来的话事件冒泡到卡片，会变成"点标签 = 打开文章"，
                     用户想看同标签的其他文章，结果进了当前这篇的详情页 -->
            <div v-if="a.tags && a.tags.length" class="af-tags">
              <span
v-for="t in a.tags" :key="t.id" class="tg"
                    @click.stop.prevent="selectTag(t.id)">#{{ t.name }}</span>
            </div>
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
    <div class="mascot" title="亿轨星途" @click="onMascot"><img src="/cover-2.png" ></div>

    <!-- 左下角原来有个「1 人正在看」的在线人数。
         那是写死的字符串：后端没有在线人数接口，这个数字永远不会变，
         连"当前访客自己"都不一定算得准。假装有实时数据比没有更糟，直接删掉。 -->

    <!-- 左侧吸附菜单 -->
    <div class="dock">
      <button class="di" :class="{ on: open.clock }" @click="toggle('clock')"><span>◷</span><i>时钟</i></button>
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

    <!-- 这里原来还有一个「后台留言」浮窗，里面两条留言（访客A / 访客B）是写死的数组，
         不是真评论（后端还没有评论模块，前端也没有任何地方能读到它们）。
         为了让首页"看起来有人气"而摆两条假留言，和真实数据混在一起最难被发现，
         所以连面板、左边那个「留言」按钮、拖动它的坐标一起删掉。 -->
  </div>
</template>

<script setup>
import { ElMessage } from 'element-plus'

// ================================================================
//  背景音乐（只有一个音源：static-media/bg-music.mp3）
//
//  【为什么不做"播放列表"】改了之前这里有个 tracks 数组与上一首/下一首按钮，
//  但三首曲名是编的、音频只有一个文件 —— 点下一首只是把下标加一，
//  曲名换个字，声音从头再放同一段。这种"看起来像功能、其实什么都没做"的东西
//  比没有更糟，所以只保留真实存在的部分。
//
//  【音频地址为什么是算出来的】这个文件不参与构建（不在 public/ 里），
//  线上被 Nginx 接管、dev 被 Nitro 的开发路由接管，同一个 /media 前缀两边都成立。
//  在 setup 里算一次就够了：模板里每次渲染都重算没有意义（跟着上面视频同理）。
// ================================================================
const bgMusicSrc = mediaUrl(MEDIA_FILES.backgroundMusic)

/**
 * 【这张卡片不再自己管状态，而是共用 `useBackgroundMusic()` 那一份】（2026-09-11 改）
 * 改之前这里有三个自己的 ref（playing / prog / audioRef），于是：
 *   · 页脚的开关改了之后，这张卡片上的按钮**不会跟着变**（反过来也一样）——
 *     用户看到的就是"点了没反应"，而两处都觉得自己是对的
 *   · 卡片一卸载（切到别的页面），播放状态就丢了
 * 现在 `enabled`（想不想听，持久化）/ `playing`（真的在响）/ `progress` 都在共享状态里，
 * 页脚开关、⚙ 设置面板、这张卡片看到的是同一个事实。
 */
const { enabled: musicEnabled, playing, progress: prog, toggle: playPause, report } = useBackgroundMusic()

/**
 * 【谁真正去 play/pause】`<audio>` 元素在本组件里，所以由本组件**照着 `enabled` 执行**。
 *
 * 【为什么用 watch 而不是"点按钮时直接 play"】开关可能在**别处**被改
 * （页脚的开关、⚙ 设置面板），那时候按钮根本没被点过 —— 用 watch 才能三处一致。
 *
 * 【为什么 play() 之后还要乐观地把 playing 置为 true】`await el.play()` 在真实浏览器里
 * 可能被自动播放策略拒绝（那时会走 catch，状态回到 false，是诚实的结果）；
 * 而测试环境（jsdom）根本没有实现媒体播放，事件永远不会触发 ——
 * 只靠事件驱动的话，"点了之后按钮应该变成暂停图标"这条就永远测不出来。
 * 所以这里以**意图**为准先置位，再由真实事件（play / pause / ended）纠正。
 */
watch(musicEnabled, async (on) => {
  const el = audioRef.value
  if (!el) return
  if (!on) {
    el.pause()
    report({ playing: false })
    return
  }
  try {
    await el.play()
    report({ playing: true })
  } catch {
    report({ playing: false })
  }
})

const audioRef = ref()

// timeupdate 是 <audio> 的原生事件，播放过程中大约每 250ms 触发一次；
// duration 在读元数据之前是 NaN，所以要判断一下再算百分比
const onTime = () => {
  if (audioRef.value?.duration) {
    report({ progress: (audioRef.value.currentTime / audioRef.value.duration) * 100 })
  }
}

// 放完之后把按钮切回「播放」。再点播放时浏览器会从头开始放
// （HTML 规范里 play() 对已结束的媒体会先回到起始位置），所以不需要手动 currentTime = 0
const onEnded = () => { report({ playing: false, progress: 0 }) }

// 真实事件回写：浏览器可能在别的地方把音频暂停了（比如系统媒体控制、来电），
// 那时界面必须跟着变，而不是继续显示"正在播放"
const onPlay = () => { report({ playing: true }) }
const onPause = () => { report({ playing: false }) }

// ================================================================
//  文章列表：从后端真实拉取
//
//  【为什么第一页要 useAsyncData，而不是 onMounted + ref（这次改的就是这里）】
//   onMounted 只在浏览器里跑，所以服务端返回的 HTML 里【没有文章列表】：
//   · 搜索引擎抓到的首页是一张空壳，文章等于没被收录 ——
//     对一个"要被搜到"的博客来说这是硬伤
//   · 首屏会先闪一下"加载中"再出内容
//   useAsyncData 会在服务端【等数据回来再渲染】，并把结果写进 payload
//   让浏览器端复用（不会重复请求），HTML 里直接带着文章列表。
//
//  【key 怎么定】key 是"这批数据是谁"的唯一标识，也是 payload 里的键：
//   · 必须唯一：和站点统计、分类列表、标签列表各自的 key 不能撞（撞了会共用同一份缓存）
//   · 必须带上筛选条件：固定写 'home-articles' 的话，
//     "全部"与"分类 2"两个页面的数据会被当成同一份 —— 换了筛选条件却
//     显示上一批文章。所以把 keyword / categoryId / tagId 三个条件都拼进 key，
//     条件一变 key 就变，useAsyncData 会自动重新取（不用再写 watch）
//   · 【标签尤其不能漏】分类和标签常常指向同一批文章，漏了 tagId 的表现是
//     "标签 A"与"标签 B"共用同一份 payload 缓存：点了标签，地址栏变了、
//     请求也该变，可列表还是上一批（而且不报任何错，最难查的一种）
//
//  【为什么"加载更多"不用 useAsyncData】它是在已有列表后面追加，
//   不是"这一页的首屏数据"，也不需要写进 payload（服务端只渲染第一页）；
//   用普通请求 + 一个 ref 追加更直白。
// ================================================================
const { request } = useApi()

// 筛选条件（关键词 + 分类 + 标签）：状态、防抖、URL 同步全在 useArticleFilter 里，
// 页面只负责把它绑到输入框 / 分类按钮 / 标签胶囊上。
// 【keyword 与 keywordInput 的区别】前者是"生效中"的关键词（请求、标题、地址栏都用它），
// 后者是输入框里的内容（即时）；防抖就发生在这两者之间。
// 【为什么不直接写 ref 放在这里】不防抖会按字发请求，而"刷新后从地址栏恢复筛选"
// 又必须和 URL 双向同步 —— 这些逻辑混在 400 行的页面里既难读也难测，
// 抽出去之后有 36 个用例守着（test/useArticleFilter.nuxt.spec.ts）。
const {
  keyword, keywordInput, categoryId, tagId,
  isFiltered, selectCategory, selectTag, clearAll, applyKeywordNow,
} = useArticleFilter()

const page = ref(1)
const SIZE = 12                 // 每页 12 篇，3 列瀑布流正好 4 行

/** 「加载更多」追加进来的文章（首屏那一页不在这里，见下面的 articles） */
const moreArticles = ref([])
const loadingMore = ref(false)

/**
 * 拉文章列表。
 * @param pageNo 页码
 *
 * 这里请求的是【前台公开接口】/article/page —— 它只返回已发布的文章，
 * 所以你后台的草稿绝不会出现在首页上（这条在 ArticlePublicTest 里有测试守着）。
 *
 * 参数由 toArticleParams() 统一拼装：它保证「空关键词不发、没选分类不发、
 * 没选标签不发」，也就是后端 GET /article/page 里 keyword / categoryId / tagId
 * 三个都是可选参数，可以任意组合（后端按 AND 叠加）。
 */
const requestArticles = (pageNo) => request('/article/page', {
  params: toArticleParams({
    keyword: keyword.value,
    categoryId: categoryId.value,
    tagId: tagId.value,
    page: pageNo,
    size: SIZE,
  }),
})

// 首屏第一页：服务端取好、写进 payload（见上面那段说明）。
// 几个请求互不依赖，所以先各自发起、再一起 await —— 串行 await 会让
// 首屏多等几个往返（原来的 onMounted 写法就是并行的，这里不能退回去）。
const articlesAsync = useAsyncData(
  () => `home-articles:${keyword.value || '-'}:${categoryId.value ?? '-'}:${tagId.value ?? '-'}`,
  () => requestArticles(1),
)

/**
 * 分类列表：同样走服务端渲染。
 * 【为什么这个也要改】它决定筛选条，也决定列表标题里那个分类名
 * （URL 里只有 categoryId，没有名字）—— 只放在 onMounted 里的话，
 * 服务端渲染出来的标题永远是「最新文章」，而筛选条在 HTML 里也是空的。
 */
const categoriesAsync = useAsyncData('home-categories', async () => {
  const res = await request('/category/list')
  // 【为什么用 Array.isArray 兜一道】分类会被 v-for 和 listTitle 的 .find 用到，
  // 只要后端返回的不是数组（比如接口挂了、或者以后改成 { records: [...] } 这种分页结构），
  // .find 就会抛 "categories.value.find is not a function" 把整个列表渲染带崩。
  // 兜成空数组最差也只是筛选条不显示。
  return res.ok && Array.isArray(res.data) ? res.data : []
})

/**
 * 标签列表（前台公开接口 GET /tag/list，带每个标签下【已发布】的文章数）。
 *
 * 【为什么也要 SSR】和分类同一个理由：它决定筛选条，也决定列表标题里那个标签名
 * （URL 里只有 tagId，没有名字）。留在 onMounted 里的话，服务端渲染的 HTML 上
 * 筛选条是空的、标题永远回落到「最新文章」，带 ?tagId= 的链接被爬虫/别人打开时
 * 看到的就是"筛选没生效"的样子。
 *
 * 【为什么同样要 Array.isArray】和分类一样：后端返回的对象结构一旦变化，
 * 直接拿去 v-for / .find 会把首页渲染带崩；兜成空数组最多是标签条不显示。
 * 注意 articleCount 在【没有文章时是 0 而不是 null】（后端一条 GROUP BY 的兜底），
 * 所以下面判断"有没有文章"用 === 0 而不是真值判断。
 */
const tagsAsync = useAsyncData('home-tags', async () => {
  const res = await request('/tag/list')
  return res.ok && Array.isArray(res.data) ? res.data : []
})

// 站点统计（文章数 / 总浏览量 / 分类数）。
// 【为什么不用页面里的列表自己算】改之前这里是 total.value（会被筛选条件影响）、
// articles.value.reduce(...)（只是"已加载的 12 篇"之和，点一次「加载更多」数字就变）
// 和 categories.value.length —— 三个数字各有各的口径。
// 现在统一走后端公开接口 GET /article/stats，口径（只统计已发布文章）写在后端 SQL 里。
// 【为什么它也进 useAsyncData】统计接口失败时页面显示的是「—」；
// 留在 onMounted 里的话，服务端 HTML 上那三个数字会是 0 ——
// 而"0 篇"是一个确定的答案，访客会以为站点真的没有文章，
// 更糟的是它和旁边【已经渲染出来】的文章列表自相矛盾（列表里明明有文章）。
const { stats: siteStats, failed: statsFailed, load: loadSiteStats } = useSiteStats()
const statsAsync = useAsyncData('home-site-stats', () => loadSiteStats())

// 等服务端把这几份数据都拿到（并行）再渲染页面
await Promise.all([articlesAsync, categoriesAsync, tagsAsync, statsAsync])

const { data: firstPage, pending: firstPending } = articlesAsync
const categories = computed(() => categoriesAsync.data.value ?? [])
const tags = computed(() => tagsAsync.data.value ?? [])

/** 首屏那一页的文章（useAsyncData 给的；接口失败时是空数组） */
const firstPageArticles = computed(() => (firstPage.value?.ok ? (firstPage.value.data?.records ?? []) : []))

/** 后端返回的【总条数】，不是当前页条数 */
const total = computed(() => (firstPage.value?.ok ? Number(firstPage.value.data?.total) || 0 : 0))

/** 页面上要显示的文章 = 首屏那一页 + 「加载更多」追加的 */
const articles = computed(() => [...firstPageArticles.value, ...moreArticles.value])

/**
 * 加载状态：首屏在取（服务端渲染时不会走到这里，客户端导航会），
 * 或者正在追加下一页 —— 「加载更多」按钮在加载期间要藏起来（原样保留这个行为）。
 */
const loading = computed(() => firstPending.value || loadingMore.value)

/**
 * 列表标题：让标题、空状态、清除按钮都跟着筛选条件走，
 * 用户一眼能看出"现在看到的是哪一批文章"。
 * 分类名/标签名要从各自的列表里查 —— URL 里只有 id，没有名字。
 *
 * 【为什么把范围拼成一段而不是写四个 if】三个条件是可以叠加的
 * （后端按 AND 过滤），写死成"要么关键词要么分类"就会出现
 * "同时选了分类和标签，标题只提分类"这种漏报。
 * keyword 与范围谁缺谁在就退化成对应的短句，两个都没有才是「最新文章」。
 */
const listTitle = computed(() => {
  const category = categories.value.find(c => c.id === categoryId.value)
  const tag = tags.value.find(t => t.id === tagId.value)
  // 范围部分：分类和标签可以同时生效，中间用「与」连起来
  const scope = [
    category ? `「${category.name}」分类` : '',
    tag ? `「${tag.name}」标签` : '',
  ].filter(Boolean).join('与')

  if (keyword.value && scope) return `「${keyword.value}」在${scope}下的结果`
  if (keyword.value) return `「${keyword.value}」的搜索结果`
  if (scope) return `${scope}下的文章`
  return '最新文章'
})

/**
 * 标签胶囊的悬浮提示。
 * 【为什么用 tooltip 而不是把数字印在胶囊上】首页的标签条是导航，
 * 一排「#技术 3 #随笔 1」会把按钮撑得很宽、也会让人以为那个数字可以点。
 * 数字放在 title 里：想知道某个标签下有几篇，悬停一下就有；
 * 而且【没有文章时 articleCount 是 0】（后端保证不是 null），
 * 这时如实说明"点进去会是空的"，比让用户点一下看到空列表要友好。
 */
const tagCountTip = (t) => {
  const count = Number(t.articleCount) || 0
  return count > 0 ? `该标签下有 ${count} 篇已发布文章` : '该标签下还没有已发布的文章'
}

/**
 * 数字的显示。
 * 【失败时为什么是「—」而不是 0】0 是一个"确定的答案"：访客会以为站点真的没有文章。
 * 「—」才是诚实的"暂时读不到"，也和 backend 挂掉时"文章列表为空"区分得开。
 */
const statText = (count) => (statsFailed.value ? '—' : count)

// 个人卡片上的三个数字：来源见上面的 useSiteStats（后端算好、前端只显示）

// 封面兜底：文章没填封面时，用自带的 3 张图轮着顶，避免出现破图
const DEFAULT_COVERS = ['/cover-1.png', '/cover-2.png', '/cover-3.png']
const coverOf = (a, i) => a.cover || DEFAULT_COVERS[i % DEFAULT_COVERS.length]

// 还有没有下一页：已加载条数 < 总数 就说明还有
const hasMore = computed(() => articles.value.length < total.value)

// ---------- 筛选 / 分页 / 跳转 ----------
// 筛选条件一变就【回到第 1 页】：
// 否则会出现"第 3 页 + 新关键词"这种组合，而它在后端根本不存在，用户只会看到空列表。
// 【为什么要清空 moreArticles】首屏那一页由 useAsyncData 按新条件重新取（key 变了），
// 但"加载更多"追加进来的还是【旧筛选条件】下的文章 —— 不清掉就会出现
// "新关键词的结果 + 老关键词的尾巴"这种混在一起的列表。
// 【为什么这里不再手动发请求】重新取数的触发条件是 useAsyncData 的 key，
// 而 key 就是由 keyword / categoryId / tagId 拼出来的 —— 条件一变它自己就会重新取，
// 再多写一次请求就等于同一批数据打两次后端（/article/page 还有 300 次/分钟的限流）。
// 这个 watch 同时也接住了浏览器的前进/后退 —— 那种情况下 useArticleFilter
// 会把地址栏的参数写回状态，于是这里照样会清一次。
watch([keyword, categoryId, tagId], () => {
  page.value = 1
  moreArticles.value = []
})

/**
 * 加载更多：把下一页追加到列表末尾。
 * 【为什么用普通请求而不是 useAsyncData】它不属于"这一页的首屏数据"，
 * 服务端只渲染第一页，也不需要进 payload；追加语义用一次普通请求最直白。
 */
const loadMore = async () => {
  page.value += 1
  loadingMore.value = true
  const res = await requestArticles(page.value)
  loadingMore.value = false
  if (!res.ok) return
  moreArticles.value = [...moreArticles.value, ...(res.data?.records ?? [])]
}

const goArticle = (id) => navigateTo('/article/' + id)

// 时间只显示到"天"，卡片上不需要精确到秒
const fmtDate = (t) => (t ? String(t).replace('T', ' ').slice(0, 10) : '')

const now = reactive({ time: '', date: '' })
const tick = () => { const d = new Date(); now.time = d.toLocaleTimeString('zh-CN', { hour12: false }); now.date = d.toLocaleDateString('zh-CN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) }
tick()
onMounted(() => setInterval(tick, 1000))

// —— 侧边菜单 + 可拖动面板 ——
// 现在只剩「时钟」一个面板（「留言」那个假浮窗已随它的两条假留言一起删掉），
// 但这里仍然按 key 来写：拖动、定位、开关都对"任意个面板"通用，
// 将来再加面板（比如分类导航）不用重写这套坐标逻辑
const open = reactive({ clock: false })
const pos = reactive({ clock: { x: 90, y: 160 } })
const posStyle = (k) => ({ left: pos[k].x + 'px', top: pos[k].y + 'px' })
const toggle = (k) => { open[k] = !open[k]; if (open[k]) { pos[k].x = 90; pos[k].y = 160 } }
const close = (k) => { open[k] = false; pos[k].x = 90; pos[k].y = 160 }
let drag = null
const startDrag = (k, e) => { drag = { k, sx: e.clientX, sy: e.clientY, ox: pos[k].x, oy: pos[k].y }; document.addEventListener('pointermove', onMove); document.addEventListener('pointerup', onUp) }
const onMove = (e) => { if (!drag) return; pos[drag.k].x = drag.ox + (e.clientX - drag.sx); pos[drag.k].y = drag.oy + (e.clientY - drag.sy) }
const onUp = () => { drag = null; document.removeEventListener('pointermove', onMove); document.removeEventListener('pointerup', onUp) }

const onMascot = () => { ElMessage.info('欢迎来到亿轨星途 ✦') }

// ================================================================
//  首页的 SEO 元信息
//
//  【为什么首页也要有】它是全站最该被搜到的页面：文章列表、分类、
//  站点简介都在这里。改之前首页连 <title> 都没有（全站只有详情页设了），
//  也没有 description / og / canonical —— 搜索引擎抓到的就是一张没头没尾的空壳。
//
//  【canonical 为什么固定是 '/'，不带 keyword / categoryId】
//  带 ?keyword=nuxt 的搜索结果页与首页【是同一份内容】（同一套模板、
//  同一批文章的筛选视图），告诉搜索引擎"我的正式地址只有 /"才不会
//  被当成两个页面分别收录（重复内容）。分类页同理。
//
//  【标题为什么不传】传空就用站点默认标题（亿轨星途 · 那句自我介绍），
//  这正是首页想要的 —— 默认值只在一处维护（app/utils/seo.ts）。
// ================================================================
useSeoMetaFor(() => ({
  path: '/',
  description: SITE_DESCRIPTION,
  type: 'website',
}))
</script>

<style scoped>
.home { }
.search-wrap { max-width: 1080px; margin: 0 auto; padding: 40px 32px 12px; }
.searchbox { display: flex; align-items: center; gap: 10px; padding: 0 18px; height: 48px; border-radius: 999px; }
.s-ico { color: var(--accent); font-size: 18px; }
.searchbox input { flex: 1; background: transparent; border: none; outline: none; color: var(--ink); font-size: 15px; }
.searchbox input::placeholder { color: var(--muted); }

/* 分类筛选条：做成胶囊按钮而不是下拉框。
   理由：分类本来就只有几个，平铺出来"当前选中哪个"是【一眼可见】的，
   而下拉框要展开才知道；而且这是首页最主要的二次筛选动作，值得占用一行。 */
.cats { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 14px; }
.cat {
  padding: 6px 16px; border-radius: 999px; cursor: pointer; font-size: 13px;
  background: rgba(30,47,82,.66); border: 1px solid rgba(180,210,245,.18);
  color: var(--muted); transition: color .2s, border-color .2s, background .2s;
}
/* 同样不用 .glass：这一排按钮长期可见，没必要为它们付"每帧重新模糊"的开销 */
.cat:hover { color: var(--ink); border-color: rgba(242,193,78,.45); }
.cat.on { color: #0a1224; background: linear-gradient(135deg, var(--accent), var(--cyan)); border-color: transparent; font-weight: 700; }

/* 标签筛选条：和分类同一行胶囊样式，但刻意做得更"轻"一点
   （更小的字号与内边距、前缀一个 #），因为标签数量通常比分类多得多，
   视觉上要和"分类"这一排区分开，用户才知道自己在筛哪一类东西。
   它【不叫 .cat】：分类那一排的用例是按 .cat 数的（首页内容真实性那组），
   两边共用一个类名会让"分类有几个"这种断言跟着标签数量一起变 —— 最难查的那种假绿。 */
.tags { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.tagp {
  padding: 4px 12px; border-radius: 999px; cursor: pointer; font-size: 12px;
  background: rgba(30,47,82,.5); border: 1px dashed rgba(180,210,245,.22);
  color: var(--muted); transition: color .2s, border-color .2s, background .2s;
}
.tagp:hover { color: var(--accent); border-color: rgba(242,193,78,.5); }
.tagp.on { color: #0a1224; background: linear-gradient(135deg, var(--accent), var(--cyan)); border-style: solid; border-color: transparent; font-weight: 700; }

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
.pf-stats { display: flex; gap: 32px; margin: 22px 0 0; }
.st { display: flex; flex-direction: column; }
.st b { font-size: 24px; font-weight: 800; color: var(--accent); }
.st span { color: var(--muted); font-size: 12px; }
/* .pf-links / .pl 两条样式随 GitHub / 邮箱 / RSS 三个假按钮一起删掉 */

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

/* 卡片上的标签胶囊：点了就按这个标签筛一批文章（不是打开文章）。
   做成实心的小块而不是描边，是为了和上面那颗描边的「分类」胶囊区分开 ——
   同一张卡片上两个都能点、但行为不一样，长得一样会让人点错。
   cursor: pointer 必须自己写：它是个 <span>（不能嵌在 <a> 里的 <button>），
   浏览器默认给的是文本光标，用户看不出这里能点。 */
.af-tags { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 10px; }
.af-tags .tg {
  font-size: 11px; color: #cfe0f0; cursor: pointer;
  background: rgba(242,193,78,.14); border-radius: 6px; padding: 2px 8px;
  transition: background .2s, color .2s;
}
.af-tags .tg:hover { background: rgba(242,193,78,.3); color: var(--ink); }

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
/* .viewers / .dot / @keyframes pulseDot 随写死的「1 人正在看」一起删掉 */

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
/* .msgs / .msg / .msg-av / .msg-n / .msg-c 随「后台留言」假浮窗一起删掉 */

@media (max-width: 820px) {
  .toprow { grid-template-columns: 1fr; }
  .waterfall { columns: 1; }
  .dock { top: auto; bottom: 80px; }
  .mascot { display: none; }
}
</style>
