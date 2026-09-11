<template>
  <div class="music-page">
    <header class="mp-head">
      <h1 class="mp-h1">音乐</h1>
      <!-- 【这里曾经有一句"站点自带的背景音轨 · 全站只有这一个播放器（住在外壳里，切页面不会断）"】
           2026-09-11 按用户要求删掉了：那是**给用户讲实现**的话（播放器住哪、切页面会怎样），
           用户能感知到的只有"歌名 / 时长 / 怎么用"，架构说明不属于界面文案。
           同类句子在整套前端里都不该出现 —— 说明都写在注释里（注释不是给用户看的）。 -->
    </header>

    <!-- ================= 上半：旋转唱片 + 当前歌词；右：歌词列表 ================= -->
    <section class="mp-main">
      <div class="mp-stage glass">
        <!-- 【旋转唱片】
             两个刻意的决定：
             ① 唱片**永远在 DOM 里**，转与不转只改 `animation-play-state`
                （`:style="animationPlayState"`）。**不要**用 `v-if="playing"` 去重建元素 ——
                元素一被销毁重建，CSS 动画就从 0 度重新开始，用户看到的是
                "每暂停一次、唱片就跳回正上方"，而不是"停在刚才那个角度"。
             ② 转速 24 秒一圈（不是 4 秒）：真唱片大约 33/分钟，而且转太快会让人盯着它
                看到眼晕，这层动画是氛围而不是演示。
             另外：全局样式里那条 `@media (prefers-reduced-motion: reduce)`
             （app.vue 的非 scoped 块）会把所有 animation 关掉 —— 也就是说
             "减少动态效果"的用户看到的是**一张静止的唱片**，这里不需要另写媒体查询。 -->
        <div class="mp-disc-wrap">
          <div class="mp-disc" :style="{ animationPlayState: discRunning ? 'running' : 'paused' }">
            <!-- 封面：优先歌曲内嵌的那张（ID3 APIC），拿不到才用接口给的 cover。
                 【为什么条件里还有 coverSrc】接口**可以不给封面**（`cover` 是 null）——
                 那样就没有可以挂的地址。挂一个 `src=""` 的 <img> 有两种坏结果：
                 浏览器会把当前页面的地址当成图片去请求（一个多余的请求 + 控制台报错），
                 然后显示一个破图图标。所以"没有地址"和"加载失败"一样，都直接换成画出来的占位图案。 -->
            <img
              v-if="coverSrc && !coverBroken"
              class="mp-cover"
              :src="coverSrc"
              :alt="`${currentTrack.title} 封面`"
              @error="onCoverError" >
            <span v-else class="mp-cover-ph" aria-hidden="true">♪</span>
            <!-- 唱片中央的轴孔（纯装饰，读屏软件跳过） -->
            <span class="mp-hole" aria-hidden="true" />
          </div>
        </div>

        <!-- 曲名与歌手都来自**接口里的当前曲目**（没有曲目时是内置兜底那一首）：
             歌手是**可选**的，没有这个字段就整行不渲染 ——
             不编歌手名，也不留一个空格子。 -->
        <div class="mp-title">{{ currentTrack.title }}</div>
        <div v-if="currentTrack.artist" class="mp-art">{{ currentTrack.artist }}</div>

        <!-- 当前歌词（大字）。没有当前句时是空的（比如前奏）——
             这里**不填任何歌词**，也不写"前奏…"之类的拟声文案：拿不到就不显示。 -->
        <p class="mp-now" :class="{ 'is-live': currentLineIndex >= 0 }">{{ currentLineText }}</p>
        <p class="mp-state">{{ playing ? '正在播放' : '已暂停' }}</p>
      </div>

      <div class="mp-lyrics glass">
        <h2 class="mp-ly-title">歌词</h2>

        <!-- 三种状态互斥（同一时刻只会渲染一个）：
             加载中 / 没有歌词 / 有歌词。
             【为什么"加载中"和"没有歌词"要分开】两者都是空列表，但用户该做的事不同：
             前者等一下就好，后者说明**站里就没有这个文件**。
             【为什么没有"暂无歌词"这个文件时不去编歌词】本项目的底线：
             要么真实数据、要么不显示 —— 编一段看起来像歌词的文字，是最难被发现的一种假。 -->
        <p v-if="lyricsState === 'loading'" class="mp-ly-state">歌词加载中…</p>
        <p v-else-if="lyricsState === 'empty'" class="mp-ly-state">暂无歌词</p>
        <div v-else ref="lyricListRef" class="mp-ly-list">
          <!-- 每一句是一个真按钮：可以点（跳到那一句）、可以 Tab 到、可以回车触发 -->
          <button
            v-for="(line, i) in lyricLines"
            :key="`${line.time}-${i}`"
            class="mp-line"
            :class="{ 'is-cur': i === currentLineIndex }"
            :title="`跳到 ${timeText(line.time)}`"
            @click="seekToLine(line)">
            <span class="mp-line-time">{{ timeText(line.time) }}</span>
            <span class="mp-line-text">{{ lineText(line) }}</span>
          </button>
        </div>
      </div>
    </section>

    <!-- ================= 控制条 ================= -->
    <section class="mp-ctl glass">
      <!-- 播放/暂停：**只切换共享状态里的 `enabled`**，真正 play/pause 的动作在
           外壳（app.vue）里执行 —— 这样页脚 ♫、⚙ 设置面板、首页卡片、这一页
           四个入口点哪个都是同一件事，不会出现"两处状态打架"。 -->
      <button
        class="mp-play"
        :aria-label="playing ? '暂停' : '播放'"
        @click="toggle">{{ playing ? '❚❚' : '▶' }}</button>

      <div class="mp-seek">
        <span class="mp-time">{{ timeText(currentTime) }}</span>
        <!-- 进度条：原生 <input type="range">。
             【为什么不用拖拽自绘的进度条】原生 range 自带键盘支持（左右方向键微调、
             Home/End 跳到两端）、自带读屏语义（aria 值会跟着变），自己用 div 画一遍
             等于把这些全部重做一遍还不一定对。
             【为什么 duration 未知时 disable】拖动的结果要换算成"第几秒"
             （= 百分比 × 总长），读不到总长时这个换算无从谈起；先禁用，
             等 loadedmetadata 把时长读出来再启用。 -->
        <input
          class="mp-range"
          type="range"
          :style="{ '--mp-fill': played + '%' }"
          min="0"
          :max="duration > 0 ? duration : 1"
          step="0.1"
          :value="seekValue"
          :disabled="duration <= 0"
          aria-label="播放进度"
          @input="onSeekInput"
          @change="onSeekCommit" >
        <span class="mp-time">{{ duration > 0 ? timeText(duration) : '--:--' }}</span>
      </div>

      <div class="mp-vol">
        <button
          class="mp-vol-btn"
          :aria-label="muted ? '取消静音' : '静音'"
          @click="toggleMute">{{ muted ? '🔇' : '🔊' }}</button>
        <input
          class="mp-range"
          type="range"
          :style="{ '--mp-fill': Math.round((muted ? 0 : volume) * 100) + '%' }"
          min="0"
          max="1"
          step="0.01"
          :value="muted ? 0 : volume"
          aria-label="音量"
          @input="onVolumeInput" >
      </div>
    </section>

    <!-- ================= 曲目列表 =================
         【数据来自接口】这一个 v-for 渲染的是 `GET /music/list` 返回的曲目
         （后台可以上传、改、删），页面里没有写死任何曲名或地址。
         【顺序就是接口给的顺序】后端按 `sort ASC, id ASC` 排好，前端**一次都不重排** ——
         前端再排一遍等于把排序规则复制成两份，哪天后端改成"置顶优先"，
         前端这份会把它盖掉，而页面上看起来一切正常（只是顺序不对，没人会当成 bug）。
         【站长一首都没上传 / 接口挂了】列表会是**内置的那一首**（一首真实存在的曲子），
         播放器照常可用，而不是一个空列表或者"读不到"。
         【点一行会发生什么】切到那一首、位置归零、并且开始播（见 selectTrack 的注释）。 -->
    <section class="mp-tracks glass">
      <h2 class="mp-tr-title">曲目</h2>
      <ul class="mp-tr-list">
        <li v-for="(track, i) in tracks" :key="`${track.id ?? track.url}-${i}`">
          <button
            class="mp-tr-row"
            :class="{ 'is-cur': i === activeIndex }"
            :aria-current="i === activeIndex ? 'true' : undefined"
            @click="selectTrack(i)">
            <!-- 行首：当前这一首给一个音符，其余给序号 —— 序号是"第几首"，
                 音符是"就是这首"。两者都只用已有的数据（下标），不需要额外接口。 -->
            <span class="mp-tr-mark" aria-hidden="true">{{ i === activeIndex ? '♪' : i + 1 }}</span>
            <!-- 曲名为空就如实空着（后台的表单本来就要求填），不编一个"未命名"出来 -->
            <span class="mp-tr-name">{{ track.title }}</span>
            <span v-if="track.artist" class="mp-tr-artist">{{ track.artist }}</span>
          </button>
        </li>
      </ul>
    </section>
  </div>
</template>

<script setup>
// ================================================================
// app/pages/music.vue
//
// 作用：真正的音乐播放器页（导航里的「音乐」从这里开始才是**一页**）。
//
// 【为什么要有这一页】改之前导航里的「音乐」指向 `/#music` —— 首页那张卡片上的锚点。
//   点进去只是"滚到首页某个位置"，用户看到的是同一张只有播放键的卡片，
//   感觉"点进去没有东西"（用户报的原话）。现在它是一页：
//   旋转唱片（显示这首歌的封面）+ 当前歌词 + 歌词列表（点某句跳转）+ 控制条 + 曲目列表。
//
// 【这一页**不持有** <audio>，这是本次改动最关键的一点】
//   `<audio>` 在应用外壳 `app/app.vue` 里（全站唯一实例）。理由是：
//     · 页面会随路由卸载，播放器放在页面里 = 一离开这一页音乐就断
//     · 两个页面各放一个 = 两个 <audio> 抢同一首歌、还互相覆盖共享状态里的进度
//   所以这一页是**遥控器**：
//     · 播放状态（想不想听 / 真的在响 / 进度 / **当前第几首**）→ 共享组合式函数
//       `useBackgroundMusic()`，页脚开关与 ⚙ 设置面板用的也是它
//     · 秒数 / 总时长 / 音量 / 注入进来的那个元素 → 外壳通过
//       `provide('bgMusicPlayer', ...)` 交下来的接口（页面是外壳的后代组件）
//   这一页**一行播放状态都不自己存** —— 自己存一份就会出现"两个地方显示不同的进度"。
//   切歌也是这样：页面只改共享状态里的下标，"换 src、从头播"由外壳执行。
//
// 【曲目与歌词从哪来】曲目列表来自 `GET /music/list`（**后台上传**，前台不写死），
//   见 `app/composables/useMusicTracks.ts`；这一页只负责把它渲染成列表、
//   按当前这一首去取歌词与封面：
//     · 歌词：优先用接口给的 `lyrics` 原文（那是一个文本字段，不是文件路径）；
//       没有时，**只有音源是内置那一首**才回落到 `/media/bg-music.lrc`
//       （那个文件是它的歌词，显示在别的歌下面是错的歌词）。两边都没有 → 「暂无歌词」。
//     · 封面：内嵌 ID3 封面 → 接口给的 `cover` → 占位图案。
//   歌词解析用纯函数 `parseLrc` / `findCurrentLine`（app/utils/lrc.ts，有独立单测）；
//   拿不到歌词就显示「暂无歌词」，**绝不编歌词**。
//
// 【为什么歌词在客户端才去取（不在 useAsyncData / 服务端取）】
//   `/media/` 在生产环境由 Nginx 直接读磁盘提供、**不经过 Node**；而 Nitro 里那个
//   `/media/` 路由是"仅开发环境"的（生产返回 404，见 server/routes/media/[...file].get.ts）。
//   也就是说服务端去请求自己的 `/media/xxx` 在生产上会 404 ——
//   与其让它"有时候有、有时候没有"，不如明确地**在浏览器里取**：
//   SSR 输出的 HTML 上没有歌词，水合之后 200ms 内就会补上。
//
// 【技术栈与关键字】
//   · `inject('bgMusicPlayer')`：与外壳 `provide` 的是同一个字符串键（两个文件唯一的约定）
//   · `watch(..., { flush })`、`nextTick()`：状态变了之后要等 DOM 更新完才能去滚动列表
//   · `Element.scrollIntoView({ block, behavior })`：把当前那句滚到可视区中间
//   · `window.matchMedia('(prefers-reduced-motion: reduce)')`：用户系统里开了
//     "减少动态效果"时**不要平滑滚动**（平滑滚动是最容易让人不适的一类动效）
//   · 纯函数 `parseLrc` / `findCurrentLine` / `trackAt` / `mediaUrl` 都是 Nuxt 自动导入的
// ================================================================

// ---------- 共享播放状态（与页脚、⚙ 面板、首页卡片同一份）----------
// 页面从这里拿到的都是"事实"，动作也只通过它转达：
//   · `playing` 真的在响（决定唱片转不转、按钮显示什么）
//   · `toggle`  切换"想不想听"
//   · `setTrack` / `setEnabled` 切到第几首 / "点了就播"
//   · `trackIndex` 当前第几首（只用来设置，读的时候一律走下面的 activeIndex）
const { playing, toggle, setTrack, setEnabled } = useBackgroundMusic()

// ---------- 曲目 ----------
/**
 * 曲目列表：**来自接口**（`GET /music/list`），不在前端写死。
 * `useMusicTracks()` 同时负责"接口挂了 / 一首都没上传时回落成内置那一首"，
 * 所以这里拿到的 `tracks` **永远至少有一行**、`currentTrack` **永远是一首真实的曲子**。
 * 它与外壳、首页卡片用的是同一份数据（同 key 的 useAsyncData），不会各拉一遍。
 */
const { tracks, currentTrack, activeIndex, ready: tracksReady } = useMusicTracks()

/**
 * 外壳交下来的播放器接口。
 * 【键名 'bgMusicPlayer' 必须与 app/app.vue 里 `provide('bgMusicPlayer', ...)` 完全一致】
 *   —— 这是两个文件之间唯一的一处字符串约定，改一边就必须改另一边。
 * 【为什么给默认值 null】组件单测（以及将来任何"没有外壳"的用法）里注入是空的，
 *   这时页面要能照常渲染出来（时间显示 0:00 / --:--、点歌词不跳转），
 *   而不是抛 "Cannot read properties of null"。
 */
const player = inject('bgMusicPlayer', null)

/**
 * 读注入进来的一个值。
 * 【为什么要写这层壳】注入进来的可能是 ref（外壳给的就是 ref），
 * 也可能在测试里是一个普通值；两边都要能读，而且**读不到时要有默认值**
 * —— 页面不能因为"遥控器没插上"就白屏。
 */
const playerValue = (key, fallback) => {
  const source = player?.[key]
  if (source == null) return fallback
  // ref 的特征：是一个对象，且有 value 属性
  if (typeof source === 'object' && 'value' in source) return source.value ?? fallback
  if (typeof source === 'number' || typeof source === 'string' || typeof source === 'boolean') return source
  return fallback
}

/** 当前播放到第几秒（注入值；不是有限数就当 0） */
const currentTime = computed(() => {
  const value = playerValue('currentTime', 0)
  return Number.isFinite(value) ? value : 0
})
/** 总时长（秒）。0 = 还不知道，界面显示 `--:--` 并禁用拖动 */
const duration = computed(() => {
  const value = playerValue('duration', 0)
  return Number.isFinite(value) && value > 0 ? value : 0
})
/** 音量 0~1 */
const volume = computed(() => {
  const value = playerValue('volume', 1)
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1
})
/** 静音开关（只活在本会话里，外壳那边不落盘 —— 理由见 app.vue 里那段注释） */
const muted = computed(() => playerValue('muted', false) === true)
/** 歌曲**内嵌**封面（ID3 APIC）的 object URL；空串 = 没读到 → 用回落图 */
const id3CoverUrl = computed(() => {
  const value = playerValue('coverUrl', '')
  return typeof value === 'string' ? value : ''
})

/** 跳转到某一秒。外壳没提供时什么都不做（见 playerValue 的说明） */
const seek = (seconds) => {
  if (typeof player?.seek === 'function') player.seek(seconds)
}
const setVolume = (value) => {
  if (typeof player?.setVolume === 'function') player.setVolume(value)
}
const toggleMute = () => {
  if (typeof player?.toggleMute === 'function') player.toggleMute()
}

// ---------- 封面 ----------
/**
 * 回落图地址：**这首歌在接口里登记的 `cover`**（后台可以给每首歌配一张图）。
 * 【为什么这里不再过 mediaUrl()】接口给的已经是地址本身（`/uploads/xxx.png`、
 *   `/media/xxx.png` 或者完整外链），前缀是后端的事；只有内置兜底那一首的地址
 *   是前端用 mediaUrl() 拼出来的（它的文件在 static-media/ 里）。
 * 【空串就是没有回落图】这时只可能是内嵌封面或占位图案 —— 不能把空串交给 mediaUrl()
 *   （它对文件名有白名单校验，空串会让它抛异常）。
 */
const fallbackCoverSrc = computed(() => currentTrack.value.cover || '')
/** 封面是否已经确认加载失败（失败之后就不再挂 <img>，避免破图图标） */
const coverBroken = ref(false)
const coverSrc = computed(() => id3CoverUrl.value || fallbackCoverSrc.value)
const onCoverError = () => { coverBroken.value = true }
/**
 * 【换歌时要把"失败过"这件事忘掉】封面地址一变（内嵌封面到手、或者切到另一首），
 * 就重新给 <img> 一次机会 —— 否则第一首的回落图 404 之后，
 * 第二首明明有封面也永远显示占位图案（而且不报任何错）。
 */
watch(coverSrc, () => { coverBroken.value = false })

// ---------- 唱片旋转 ----------
/** 正在响才转。用 `playing`（真的在响）而不是 `enabled`（想不想听）——
 *  自动播放被浏览器拦下时，"想听"是真的，但唱片不该转（界面不能撒谎）。 */
const discRunning = computed(() => playing.value === true)

// ---------- 歌词 ----------
/**
 * 接口给的歌词**原文**（`MusicVO.lyrics` 是 LRC 文本，不是文件路径）。
 * 有它就直接用 —— 一条请求都不用发（后台填了歌词就该立刻看到）。
 */
const inlineLyrics = computed(() => currentTrack.value.lyrics || '')
/**
 * 需要回落到的歌词**文件**地址（'' = 不需要回落）。
 * 【规则】只有"音源就是内置那一首（/media/bg-music.mp3）"时才回落 ——
 *   因为 `bg-music.lrc` 是那个音频文件的歌词，把它显示在别的歌下面是**错的歌词**，
 *   比「暂无歌词」糟得多。判断逻辑在 app/utils/musicTracks.ts 的 lyricsFallbackUrl()。
 */
const fallbackLyricsUrl = computed(() => lyricsFallbackUrl(currentTrack.value))
/** 这一首的标识（用音源地址：地址变了就是换歌了） */
const trackKey = computed(() => currentTrack.value.url)

/** 从文件里取回来的歌词原文（接口没给歌词时才用得上） */
const rawLyrics = ref('')
/** 歌词文件是为**哪一首**取回来的（换歌之后要重新变成"加载中"） */
const lyricsLoadedFor = ref('')
/** 解析结果。`parseLrc` 是纯函数：任何输入（空串 / HTML / 半截文件）都只返回空数组，不抛异常 */
const parsedLyrics = computed(() => parseLrc(inlineLyrics.value || rawLyrics.value))
const lyricLines = computed(() => parsedLyrics.value.lines)
/**
 * 界面状态：loading（还在取文件）/ ready（有歌词）/ empty（拿不到 → 「暂无歌词」）。
 * 【为什么"加载中"和"没有歌词"要分开】两者都是空列表，但用户该做的事不同：
 *   前者等一下就好，后者说明这首歌就没有歌词。
 * 【为什么用"取过哪一首"而不是一个布尔】切歌之后必须回到"加载中"，
 *   否则用户会在新歌上看到上一首的「暂无歌词」（一闪而过、但确实是错的）。
 */
const lyricsState = computed(() => {
  if (inlineLyrics.value) return 'ready'            // 接口给了原文，立刻就有
  if (!fallbackLyricsUrl.value) return 'empty'      // 这首歌没有歌词，也没有可回落的文件
  if (lyricsLoadedFor.value !== trackKey.value) return 'loading'
  return lyricLines.value.length > 0 ? 'ready' : 'empty'
})

/** 当前歌词句的下标；-1 = 前奏（还没到第一句）或没有歌词 */
const currentLineIndex = computed(() => findCurrentLine(lyricLines.value, currentTime.value))

/** 某一行的显示文字：LRC 里允许空文本行（通常表示间奏），给它一个音符而不是一条空白 */
const lineText = (line) => (line && line.text ? line.text : '♪')

/** 大字区那一句。没有当前句时是空字符串（不编"前奏…"这种不存在的内容） */
const currentLineText = computed(() => {
  const index = currentLineIndex.value
  return index >= 0 ? lineText(lyricLines.value[index]) : ''
})

/** 秒数 → `m:ss`（负数/NaN 一律显示 `0:00`，不给用户看 NaN） */
const timeText = (seconds) => {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  return `${minutes}:${String(rest).padStart(2, '0')}`
}

/**
 * 取**当前这一首**的歌词文件（只在接口没给歌词原文、并且这一首有可回落的文件时才发请求）。
 * 换歌时会被 watch 再调一次。
 * 【为什么用裸 $fetch 而不是项目里的 useApi()】useApi 是**后端接口**的出口：
 * 它带鉴权头、按后端统一结构解析、失败时弹 ElMessage。
 * 而这里取的是一个静态文本文件，它很可能**就是 404**（歌词文件还没上传）——
 * 用 useApi 的话，每个访客一进音乐页就会被弹一个"加载失败"的提示，
 * 而"这首歌还没有歌词"根本不是错误（页面已经用「暂无歌词」说清楚了）。
 * 【失败一律当"没有歌词"】不抛、不提示、不重试。
 */
const loadLyrics = async () => {
  const key = trackKey.value
  const file = fallbackLyricsUrl.value
  // 先把上一首的歌词清掉、并回到"加载中"：切歌之后界面上不该还挂着上一首的歌词
  rawLyrics.value = ''
  lyricsLoadedFor.value = ''
  /**
   * 【列表还在飞的时候先别去取文件】此时界面上的"内置那一首"只是**临时兜底**
   *   （接口的曲目一到就会被换掉），现在把它的歌词文件读回来，多半立刻被丢弃 ——
   *   白一次 404。列表一落定这个 watch 会自己重跑（见下面的 watch）。
   *   注意：接口失败也算"落定"（那时兜底那一首就是最终显示的内容），所以按
   *   `pending` 判，而不是按 `success` 判。
   */
  if (tracksReady.status.value === 'pending') return
  // 接口给了歌词原文，或者这首歌没有可回落的文件 → 不用请求
  if (inlineLyrics.value || !file) return

  let text = ''
  try {
    text = await $fetch(file, { responseType: 'text' })
  } catch {
    text = ''
  }
  // 【竞态护栏】等请求回来的这段时间里用户可能已经切歌了（或者接口的曲目刚回来、
  // 界面从兜底那一首换成了真实曲目）：这份结果属于上一首，丢掉。
  // 不加这一条的表现是"页面上突然出现另一首歌的歌词"（一闪而过，很难复现）。
  if (trackKey.value !== key) return
  rawLyrics.value = typeof text === 'string' ? text : ''
  lyricsLoadedFor.value = key
}
onMounted(loadLyrics)
// 换歌 → 换歌词（接口有原文就用原文，没有就回落文件，都没有就是「暂无歌词」）；
// 曲目列表落定也要重跑一次：落定之前界面上的"内置那一首"只是兜底
watch([trackKey, () => tracksReady.status.value], () => { loadLyrics() })

// ---------- 曲目列表：点一行 ----------
/**
 * 点曲目列表里的一行：
 *   · 点的是**别的一首** → 改共享状态里的下标，外壳会换音源并从 0 开始放；
 *   · 点的就是**当前这首** → 从头再放一遍（真实播放器都是这个行为）。
 *     这一支不能走 setTrack（下标没变它什么都不做），而是直接用 `seek(0)`。
 *   · 两种情况都会把 `enabled` 置为 true：点一行曲目 = "我要听这首"，
 *     所以即使原来是暂停状态也会开始播（而不是切完歌还停着）。
 * 【为什么拿 activeIndex 比，而不是跟共享状态里的下标比】那个下标可能是旧的
 *   （列表是接口给的，回来之后第 0 首可能已经不是原来那一首了），
 *   用"当前曲目在列表里的行号"比才永远落在真实的那一行上。
 */
const selectTrack = (index) => {
  if (index === activeIndex.value) seek(0)
  else setTrack(index)
  setEnabled(true)
}

// ---------- 点歌词跳转 ----------
/** 点某一句 = 跳到那一句的时间点（seek）。这是歌词列表最主要的用途 */
const seekToLine = (line) => {
  if (!line || !Number.isFinite(line.time)) return
  seek(line.time)
}

// ---------- 自动滚动到当前句 ----------
const lyricListRef = ref()

/**
 * 用户系统里是不是开了"减少动态效果"。
 * 【为什么必须判它】平滑滚动（smooth）对一部分人会引起眩晕/不适，
 *   而 `prefers-reduced-motion` 就是他们表达"别给我动"的方式。
 *   本项目里到处都在照顾这个偏好（全局样式里那条把 animation/transition 全关掉的媒体查询），
 *   这里如果继续用 smooth 就自相矛盾了。
 * 【为什么不用 CSS 的 scroll-behavior】CSS 那一条管不到这次带参数的程序化滚动，
 *   而且它没法在"滚动"这件事上分情况（我们要的是"这次调用用不用平滑"）。
 * 【为什么要 try/catch】`window.matchMedia` 在极老的环境/某些无头环境里可能不存在，
 *   读不到偏好就按"不减少"处理（平滑滚动），而不是让页面崩掉。
 */
const prefersReducedMotion = () => {
  try {
    return typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches === true
  } catch {
    return false
  }
}

/**
 * 把当前句滚到列表**中间**。
 * `block: 'center'` 而不是默认的 `'start'`：贴着顶部滚动时，用户看不到"下一句要来了"，
 * 而歌词的价值有一半在"提前看到下一句"。
 */
const scrollToCurrentLine = async () => {
  // 等 DOM 更新完：`is-cur` 是随 currentLineIndex 变的类名，不等一拍会滚到**上一句**上去
  await nextTick()
  const target = lyricListRef.value?.querySelector?.('.is-cur')
  // scrollIntoView 在少数环境里不存在（测试用的 happy-dom 就只做了个空实现），
  // 所以先判函数存在再调 —— 一个"滚不动"的歌词列表不该把页面搞崩
  if (!target || typeof target.scrollIntoView !== 'function') return
  target.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
}

/**
 * 【什么时候滚】只在**正在播放**且当前句发生变化时滚。
 *   · 暂停时用户可能正在往上翻看歌词，这时候把他拽回来是最讨厌的一种交互
 *   · 暂停时点某一句（seek）也不需要滚 —— 他点的就是自己看到的那一句，
 *     它本来就在可视区里
 *   · `idx < 0`（前奏）时没有"当前句"，没什么可滚的
 */
watch(currentLineIndex, (index) => {
  if (index < 0 || !discRunning.value) return
  scrollToCurrentLine()
})

// ---------- 进度条：拖动与回写 ----------
/**
 * 拖动中的临时值。
 * 【为什么要单独一个 ref，而不是直接绑 currentTime】`currentTime` 是元素在播过程中
 * 每 250ms 就往回写的：拖动时如果直接绑它，用户的手还没松开，值就被播放位置覆盖回去了 ——
 * 表现是"进度条拖不动/一直往回弹"。
 * 所以拖动期间界面读的是这个临时值，松手（change）才真正 seek 一次。
 */
const seekValue = ref(0)
const draggingSeek = ref(false)

// 不在拖动时才跟着播放位置走（否则上面的"回弹"问题就回来了）
watch(currentTime, (value) => {
  if (draggingSeek.value) return
  seekValue.value = value
}, { immediate: true })

const onSeekInput = (event) => {
  const value = Number(event?.target?.value)
  if (!Number.isFinite(value)) return
  draggingSeek.value = true
  seekValue.value = value
}

/** 松手才真跳：`change` 在"放开滑块"时触发（`input` 是拖动过程中反复触发） */
const onSeekCommit = () => {
  seek(seekValue.value)
  draggingSeek.value = false
}

/**
 * 进度条上「已播放」那一截的百分比 —— 绑给 CSS 变量，见 `.mp-range` 的样式注释。
 *
 * 【为什么绑 seekValue 而不是 currentTime】拖动时界面读的就是 `seekValue`
 * （理由见上面那段）。进度条的颜色必须跟着手指一起走，否则会出现
 * "滑块已经拖到 2/3 了、左边那一截还停在原处"这种割裂感。
 *
 * ⚠️ 【为什么得自己算这个值 —— 这就是用户报的那个 bug 的根因】
 *   原生 `<input type="range">` 在 Chrome / Edge / Safari 下**没有"已播放部分"
 *   这个元素**（只有 Firefox 提供 `::-moz-range-progress`）。不自己画的话，
 *   滑块左右两边是同一个颜色：拖得动、但看不出播到哪儿了。
 */
const played = computed(() => playedPercent(seekValue.value, duration.value))

const onVolumeInput = (event) => {
  const value = Number(event?.target?.value)
  if (!Number.isFinite(value)) return
  // 走外壳的方法：它会同时改音量、取消静音（音量 > 0 时）并**持久化**到 localStorage。
  // 直接写 `el.volume` 的话，刷新页面音量就回去了（偏好没人存）
  setVolume(value)
}

// ================================================================
//  SEO：页面级元信息（唯一入口是 useSeoMetaFor，拼装规则在 app/utils/seo.ts）
//  canonical 固定是 /music —— 这一页没有任何查询参数决定内容，
//  参数化地址与它属于同一份内容，正式地址只留一个。
// ================================================================
useSeoMetaFor(() => ({
  path: '/music',
  title: '音乐',
  description: '亿轨星途的背景音乐播放器：旋转唱片、歌词与进度控制，全站共用同一个播放器。',
  type: 'website',
}))
</script>

<style scoped>
/* 这一页用全局的 .glass（app.vue 的非 scoped 块）做玻璃底，自己的排版写在这里。
   【为什么不用页面内的 .glass 副本】scoped 样式只对本组件生效；
   全局那份是"任何页面都能用"的那一份，另写一份等于把同一组取值维护两遍。 */
.music-page { max-width: 1080px; margin: 0 auto; padding: 40px 32px 48px; display: flex; flex-direction: column; gap: 20px; }
.mp-head { display: flex; flex-direction: column; gap: 8px; }
.mp-h1 { margin: 0; font-size: 28px; font-weight: 800; letter-spacing: 1px; }
/* （原来这里还有 .mp-sub：标题下那句"站点自带的背景音轨 · 全站只有这一个播放器…"。
   2026-09-11 那句按用户要求删掉了，规则一起删 —— 留着一条没有任何元素用的规则，
   下次有人改样式时会以为它还在生效。） */

/* 桌面：左唱片、右歌词；窄屏由文件末尾的媒体查询改成上下排列 */
.mp-main { display: grid; grid-template-columns: minmax(280px, 400px) 1fr; gap: 20px; align-items: stretch; }

.mp-stage { border-radius: 22px; padding: 26px 24px 22px; display: flex; flex-direction: column; align-items: center; gap: 12px; }
.mp-disc-wrap { width: min(260px, 70vw); aspect-ratio: 1; position: relative; }
/* 唱片本体：黑色同心圆纹理（repeating-radial-gradient 画出来，不用图片） */
.mp-disc {
  width: 100%; height: 100%; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: repeating-radial-gradient(circle at 50% 50%, #101a30 0 3px, #16233d 3px 6px);
  box-shadow: 0 18px 46px rgba(0, 0, 0, .5), inset 0 0 0 1px rgba(180, 210, 245, .14);
  /* 【关键】转与不转只由 animation-play-state 决定（模板里绑的是播放状态）：
     paused 时动画**保持当前角度**停住，而不是重头开始 */
  animation: mpSpin 24s linear infinite;
  animation-play-state: paused;
  will-change: transform;
}
.mp-cover { width: 62%; height: 62%; border-radius: 50%; object-fit: cover; box-shadow: 0 0 0 6px rgba(10, 18, 36, .6); }
/* 封面加载失败时的占位：一个音符 + 一点渐变，**不是**浏览器的破图图标 */
.mp-cover-ph {
  width: 62%; height: 62%; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 44px; color: var(--accent);
  background: linear-gradient(150deg, rgba(242, 193, 78, .22), rgba(89, 214, 230, .16));
  box-shadow: 0 0 0 6px rgba(10, 18, 36, .6);
}
.mp-hole { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 22px; height: 22px; border-radius: 50%; background: var(--bg); box-shadow: inset 0 0 0 2px rgba(180, 210, 245, .25); }
@keyframes mpSpin { to { transform: rotate(360deg); } }

.mp-title { font-size: 18px; font-weight: 800; }
.mp-art { color: var(--muted); font-size: 13px; margin-top: -8px; }
/* 当前歌词（大字）。给一个 min-height，免得"有歌词/没歌词"时整块面板跳一下 */
.mp-now { margin: 6px 0 0; min-height: 66px; text-align: center; font-size: 21px; font-weight: 800; line-height: 1.5; }
.mp-now.is-live { color: var(--accent-strong); }
.mp-state { margin: 0; color: var(--muted); font-size: 12px; letter-spacing: 1px; }

.mp-lyrics { border-radius: 22px; padding: 20px 22px; display: flex; flex-direction: column; min-height: 0; }
.mp-ly-title { margin: 0 0 12px; font-size: 13px; font-weight: 700; letter-spacing: 2px; color: var(--accent); }
.mp-ly-state { margin: 0; padding: 28px 0; text-align: center; color: var(--muted); font-size: 14px; }
.mp-ly-list { flex: 1; max-height: 360px; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
.mp-line {
  display: flex; gap: 10px; align-items: baseline; width: 100%;
  padding: 9px 12px; border: 1px solid transparent; border-radius: 12px;
  background: none; color: var(--muted); font: inherit; font-size: 14px;
  text-align: left; cursor: pointer; transition: color .2s, background .2s;
}
.mp-line:hover { color: var(--ink); background: rgba(255, 255, 255, .05); }
/* 当前句：用和"选中态"一致的金青渐变，和首页的分类胶囊是同一套语言 */
.mp-line.is-cur { color: #0a1224; background: linear-gradient(135deg, var(--accent), var(--cyan)); font-weight: 700; }
.mp-line-time { flex-shrink: 0; font-size: 11px; opacity: .7; font-variant-numeric: tabular-nums; }
.mp-line-text { min-width: 0; }

.mp-ctl { border-radius: 22px; padding: 16px 22px; display: flex; align-items: center; gap: 18px; flex-wrap: wrap; }
.mp-play {
  width: 52px; height: 52px; flex-shrink: 0; border: none; border-radius: 50%;
  background: linear-gradient(135deg, var(--accent), var(--cyan)); color: #0a1224;
  font-size: 17px; font-weight: 800; cursor: pointer;
}
.mp-play:hover { filter: brightness(1.08); }
.mp-seek { flex: 1; display: flex; align-items: center; gap: 12px; min-width: 220px; }
.mp-time { min-width: 44px; text-align: center; font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
/* 两条滑块（播放进度 + 音量）共用的外观。左侧（**已填充**）金→青渐变，右侧是浅灰。
   【为什么要自己画"已填充"这一截】原生 `<input type="range">` 在 Chrome / Edge /
     Safari 下**没有"已填充部分"这个元素**（只有 Firefox 有 `::-moz-range-progress`），
     不画的话滑块左右两边一模一样 —— 拖得动，但看不出播到哪儿了 / 音量到多少。
   【怎么画的】在轨道上按比例**硬切**一条渐变（同一位置给两个颜色 = 硬边，没有过渡，
     这正是要的分界线）。那个百分比由模板按各自的语义写进 `--mp-fill`：
       · 播放进度条 → 已播放百分比（算法见 app/utils/playerProgress.ts）
       · 音量条     → 当前音量百分比（静音时是 0）
   【⚠️ 关键：颜色必须画在 ::-webkit-slider-runnable-track 上】
     这是第一版写错的地方 —— 把渐变写在 `input` 自己的 `background` 上，
     在 Chrome/Edge/Safari 下**一点颜色都看不到**：原生 range 的轨道是
     `::-webkit-slider-runnable-track` 这个伪元素画的，它自带默认底色，
     会把 input 的 background **整个盖住**。
     用户报的"进度条没有颜色"**和**"音量条也没有颜色"是同一个原因。
     下面 input 上那层浅灰底不是装饰，是**兜底**：万一伪元素规则没生效，
     至少还是一条灰轨道，而不是完全看不见。
   【⚠️ var() 的兜底 0% 不能省】变量没绑上时整条 background 会失效；
     给 0% 兜底，最差也是"整条都是未填充色"，不会出现透明轨道。 */
.mp-range { flex: 1; height: 6px; border-radius: 999px; background: rgba(255, 255, 255, .12); appearance: none; -webkit-appearance: none; outline: none; }
.mp-range::-webkit-slider-runnable-track {
  border-radius: 999px;
  background: linear-gradient(90deg,
    var(--accent) 0,
    var(--cyan) var(--mp-fill, 0%),
    rgba(255, 255, 255, .12) var(--mp-fill, 0%),
    rgba(255, 255, 255, .12) 100%);
}
/* Firefox：它有原生的"已填充"伪元素，用它比渐变更准（也不必读 --mp-fill）。
   ⚠️ 这两条要成对写：只写 progress、不写 track 的话，轨道会露出默认底色，
   于是"已填充"被画两遍、颜色叠得更深。 */
.mp-range::-moz-range-track { border-radius: 999px; background: rgba(255, 255, 255, .12); }
.mp-range::-moz-range-progress { border-radius: 999px; background: linear-gradient(90deg, var(--accent), var(--cyan)); }
/* 滑块的圆点：Chrome/Safari 走 -webkit- 伪元素，Firefox 走 -moz- 那条 */
.mp-range::-webkit-slider-thumb {
  -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%;
  background: var(--accent); box-shadow: 0 2px 8px rgba(0, 0, 0, .45); cursor: pointer;
}
.mp-range::-moz-range-thumb { width: 14px; height: 14px; border: none; border-radius: 50%; background: var(--accent); cursor: pointer; }
/* 禁用态（总时长还没读出来时）要看得出来是禁用的，否则用户会以为拖动坏了 */
.mp-range:disabled { opacity: .45; cursor: not-allowed; }
.mp-vol { display: flex; align-items: center; gap: 10px; min-width: 170px; }
.mp-vol-btn {
  width: 36px; height: 36px; flex-shrink: 0; border-radius: 10px; cursor: pointer;
  background: rgba(255, 255, 255, .06); border: 1px solid var(--line); color: var(--ink); font-size: 14px;
}
.mp-vol-btn:hover { border-color: var(--accent); }

/* ===== 曲目列表 =====
   一行是"整行可点"的按钮：手机上手指随便点在哪都算，不用瞄准文字。 */
.mp-tracks { border-radius: 22px; padding: 18px 22px 20px; }
.mp-tr-title { margin: 0 0 12px; font-size: 13px; font-weight: 700; letter-spacing: 2px; color: var(--accent); }
.mp-tr-list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 2px; }
.mp-tr-row {
  display: flex; align-items: baseline; gap: 12px; width: 100%;
  padding: 10px 12px; border: 1px solid transparent; border-radius: 12px;
  background: none; color: var(--ink); font: inherit; font-size: 15px;
  text-align: left; cursor: pointer; transition: color .2s, background .2s;
}
.mp-tr-row:hover { background: rgba(255, 255, 255, .05); }
/* 当前这一首：和歌词当前句、首页分类胶囊用同一套"选中"语言（金青渐变） */
.mp-tr-row.is-cur { background: linear-gradient(135deg, var(--accent), var(--cyan)); color: #0a1224; font-weight: 700; }
.mp-tr-mark { flex-shrink: 0; width: 20px; text-align: center; font-size: 12px; opacity: .75; font-variant-numeric: tabular-nums; }
.mp-tr-row.is-cur .mp-tr-mark { opacity: 1; }
.mp-tr-name { min-width: 0; }
/* 歌手比曲名轻一档：没有这个字段时整个 span 不渲染（不编歌手、也不留空格子） */
.mp-tr-artist { color: var(--muted); font-size: 12px; }
.mp-tr-row.is-cur .mp-tr-artist { color: rgba(10, 18, 36, .72); }

/* 窄屏：唱片与歌词改成上下排列，控制条各项换行。
   【为什么是 820px】和首页那张卡片断点一致（首页 .toprow 也在 820px 变单列），
   两页在同一台设备上"什么时候变窄"保持一致，用户才不会觉得两块不一样 */
@media (max-width: 820px) {
  .music-page { padding: 24px 18px 40px; }
  .mp-main { grid-template-columns: 1fr; }
  .mp-ly-list { max-height: 240px; }
  .mp-vol { flex: 1 1 100%; min-width: 0; }
}
</style>
