<template>
  <div class="music-page">
    <header class="mp-head">
      <h1 class="mp-h1">音乐</h1>
    </header>

    <section class="mp-main">
      <div class="mp-stage glass">
        <!-- Keep the disc mounted so pausing preserves its angle; reduced-motion disables animation globally. -->
        <div class="mp-disc-wrap">
          <div class="mp-disc" :style="{ animationPlayState: discRunning ? 'running' : 'paused' }">
            <!-- Missing or failed cover sources render the placeholder. -->
            <img
              v-if="coverSrc && !coverBroken"
              class="mp-cover"
              :src="coverSrc"
              :alt="`${currentTrack.title} 封面`"
              @error="onCoverError" >
            <span v-else class="mp-cover-ph" aria-hidden="true">♪</span>
            <span class="mp-hole" aria-hidden="true" />
          </div>
        </div>

        <div class="mp-title">{{ currentTrack.title }}</div>
        <div v-if="currentTrack.artist" class="mp-art">{{ currentTrack.artist }}</div>

        <p class="mp-now" :class="{ 'is-live': currentLineIndex >= 0 }">{{ currentLineText }}</p>
        <p class="mp-state">{{ playing ? '正在播放' : '已暂停' }}</p>
      </div>

      <div class="mp-lyrics glass">
        <h2 class="mp-ly-title">歌词</h2>

        <!-- Loading, empty and ready lyrics are separate states. -->
        <p v-if="lyricsState === 'loading'" class="mp-ly-state">歌词加载中…</p>
        <p v-else-if="lyricsState === 'empty'" class="mp-ly-state">暂无歌词</p>
        <div v-else ref="lyricListRef" class="mp-ly-list">
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

    <section class="mp-ctl glass">
      <button
        class="mp-play"
        :aria-label="playing ? '暂停' : '播放'"
        @click="toggle">{{ playing ? '❚❚' : '▶' }}</button>

      <button
        class="mp-mode"
        :class="`mp-mode--${musicMode}`"
        :aria-label="`播放模式：${modeLabel}（点击切换）`"
        :title="`播放模式：${modeLabel} —— 点击切换（顺序播放 / 随机播放 / 单曲循环）`"
        @click="cycleMode">{{ modeLabel }}</button>

      <div class="mp-seek">
        <span class="mp-time">{{ timeText(currentTime) }}</span>
        <!-- Native range supports keyboard controls; seeking is disabled until duration is known. -->
        <input
          class="mp-range"
          type="range"
          :style="{ '--mp-fill': played + '%' }"
          min="0"
          :max="sliderMax"
          step="0.1"
          :value="sliderValue"
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

    <!-- Preserve the API track order; useMusicTracks supplies the bundled fallback. -->
    <section class="mp-tracks glass">
      <h2 class="mp-tr-title">曲目</h2>
      <ul class="mp-tr-list">
        <li v-for="(track, i) in tracks" :key="`${track.id ?? track.url}-${i}`">
          <button
            class="mp-tr-row"
            :class="{ 'is-cur': i === activeIndex }"
            :aria-current="i === activeIndex ? 'true' : undefined"
            @click="selectTrack(i)">
            <span class="mp-tr-mark" aria-hidden="true">{{ i === activeIndex ? '♪' : i + 1 }}</span>
            <span class="mp-tr-name">{{ track.title }}</span>
            <span v-if="track.artist" class="mp-tr-artist">{{ track.artist }}</span>
          </button>
        </li>
      </ul>
    </section>
  </div>
</template>

<script setup>
// Audio and playback state belong to the global player; this page renders controls.
const { playing, toggle, setTrack, setEnabled, mode: musicMode, cycleMode } = useBackgroundMusic()

const modeLabel = computed(() => MUSIC_MODE_LABEL[musicMode.value] ?? MUSIC_MODE_LABEL[DEFAULT_MUSIC_MODE])

// ---------- 曲目 ----------
// Tracks are shared with the global player and include a bundled fallback.
const { tracks, currentTrack, activeIndex, ready: tracksReady } = useMusicTracks()

// Keep the injection key in sync with useGlobalMusicPlayer; isolated renders may omit it.
const player = inject('bgMusicPlayer', null)

// Accept either injected refs or plain values.
const playerValue = (key, fallback) => {
  const source = player?.[key]
  if (source == null) return fallback
  // ref 的特征：是一个对象，且有 value 属性
  if (typeof source === 'object' && 'value' in source) return source.value ?? fallback
  if (typeof source === 'number' || typeof source === 'string' || typeof source === 'boolean') return source
  return fallback
}

const currentTime = computed(() => {
  const value = playerValue('currentTime', 0)
  return Number.isFinite(value) ? value : 0
})
// Duration 0 means metadata is unavailable and seeking stays disabled.
const duration = computed(() => {
  const value = playerValue('duration', 0)
  return Number.isFinite(value) && value > 0 ? value : 0
})
const volume = computed(() => {
  const value = playerValue('volume', 1)
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1
})
const muted = computed(() => playerValue('muted', false) === true)
const id3CoverUrl = computed(() => {
  const value = playerValue('coverUrl', '')
  return typeof value === 'string' ? value : ''
})

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
const fallbackCoverSrc = computed(() => currentTrack.value.cover || '')
const coverBroken = ref(false)
const coverSrc = computed(() => id3CoverUrl.value || fallbackCoverSrc.value)
const onCoverError = () => { coverBroken.value = true }
// Retry the cover when its source changes.
watch(coverSrc, () => { coverBroken.value = false })

// ---------- 唱片旋转 ----------
const discRunning = computed(() => playing.value === true)

// ---------- 歌词 ----------
const inlineLyrics = computed(() => currentTrack.value.lyrics || '')
// Only the bundled track may use the bundled LRC fallback.
const fallbackLyricsUrl = computed(() => lyricsFallbackUrl(currentTrack.value))
const trackKey = computed(() => currentTrack.value.url)

const rawLyrics = ref('')
const lyricsLoadedFor = ref('')
const parsedLyrics = computed(() => parseLrc(inlineLyrics.value || rawLyrics.value))
const lyricLines = computed(() => parsedLyrics.value.lines)
// Distinguish a pending lyrics request from a track with no lyrics.
const lyricsState = computed(() => {
  if (inlineLyrics.value) return 'ready'            // 接口给了原文，立刻就有
  if (!fallbackLyricsUrl.value) return 'empty'      // 这首歌没有歌词，也没有可回落的文件
  if (lyricsLoadedFor.value !== trackKey.value) return 'loading'
  return lyricLines.value.length > 0 ? 'ready' : 'empty'
})

const currentLineIndex = computed(() => findCurrentLine(lyricLines.value, currentTime.value))

const lineText = (line) => (line && line.text ? line.text : '♪')

const currentLineText = computed(() => {
  const index = currentLineIndex.value
  return index >= 0 ? lineText(lyricLines.value[index]) : ''
})

const timeText = (seconds) => {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  return `${minutes}:${String(rest).padStart(2, '0')}`
}

// Fetch static LRC in the browser; a missing file means no lyrics.
const loadLyrics = async () => {
  const key = trackKey.value
  const file = fallbackLyricsUrl.value
  // 先把上一首的歌词清掉、并回到"加载中"：切歌之后界面上不该还挂着上一首的歌词
  rawLyrics.value = ''
  lyricsLoadedFor.value = ''
  // Wait for the track list before fetching fallback lyrics.
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
// Replay the current track from zero; switching tracks updates shared playback state.
const selectTrack = (index) => {
  if (index === activeIndex.value) seek(0)
  else setTrack(index)
  setEnabled(true)
}

// ---------- 点歌词跳转 ----------
const seekToLine = (line) => {
  if (!line || !Number.isFinite(line.time)) return
  seek(line.time)
}

// ---------- 自动滚动到当前句 ----------
const lyricListRef = ref()

// Respect reduced-motion preference for lyric scrolling.
const prefersReducedMotion = () => {
  try {
    return typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches === true
  } catch {
    return false
  }
}

// Scroll after the active lyric line has rendered.
const scrollToCurrentLine = async () => {
  // 等 DOM 更新完：`is-cur` 是随 currentLineIndex 变的类名，不等一拍会滚到**上一句**上去
  await nextTick()
  const target = lyricListRef.value?.querySelector?.('.is-cur')
  // scrollIntoView 在少数环境里不存在（测试用的 happy-dom 就只做了个空实现），
  // 所以先判函数存在再调 —— 一个"滚不动"的歌词列表不该把页面搞崩
  if (!target || typeof target.scrollIntoView !== 'function') return
  target.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
}

// Do not move the lyric list while playback is paused.
watch(currentLineIndex, (index) => {
  if (index < 0 || !discRunning.value) return
  scrollToCurrentLine()
})

// ---------- 进度条：拖动与回写 ----------
// Keep drag position separate from playback updates until the user releases the slider.
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

const onSeekCommit = () => {
  seek(seekValue.value)
  draggingSeek.value = false
}

// The filled track follows drag position and stays empty until duration is known.
const played = computed(() => (duration.value > 0 ? playedPercent(seekValue.value, duration.value) : 0))

// Unknown duration uses max=1 and value=0 to avoid a falsely full slider.
const sliderMax = computed(() => (duration.value > 0 ? duration.value : 1))

const sliderValue = computed(() => (duration.value > 0 ? Math.min(seekValue.value, duration.value) : 0))

// A disabled range may not emit change, so clear the drag state when duration disappears.
watch(duration, (value) => {
  if (value <= 0) draggingSeek.value = false
})

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
/* Shared glass styles live in app/assets/css/site-shell.css. */
.music-page { max-width: 1080px; margin: 0 auto; padding: 40px 32px 48px; display: flex; flex-direction: column; gap: 20px; }
.mp-head { display: flex; flex-direction: column; gap: 8px; }
.mp-h1 { margin: 0; font-size: 28px; font-weight: 800; letter-spacing: 1px; }


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

/* 播放模式按钮：三档循环切，按钮上直接写当前那一档的名字。
   三档各给一点颜色差别（顺序=中性、随机=青、单曲循环=金）——
   不读文字也能看出"现在不是默认那一档"，省一次"我是不是点错了"的怀疑。
   它不叫 .mp-play 那一套样式：那是按钮（圆形、实心渐变），这是胶囊（描边、文字）。 */
.mp-mode {
  flex-shrink: 0; padding: 7px 14px; border-radius: 999px; cursor: pointer;
  font-size: 12px; font-weight: 600; letter-spacing: .5px; white-space: nowrap;
  background: rgba(30, 47, 82, .66); border: 1px solid rgba(180, 210, 245, .18);
  color: var(--muted); transition: color .2s, border-color .2s;
}
.mp-mode:hover { color: var(--ink); border-color: rgba(242, 193, 78, .45); }
.mp-mode--shuffle { color: var(--cyan); border-color: rgba(89, 214, 230, .4); }
.mp-mode--repeat-one { color: var(--accent); border-color: rgba(242, 193, 78, .45); }

.mp-seek { flex: 1; display: flex; align-items: center; gap: 12px; min-width: 220px; }
.mp-time { min-width: 44px; text-align: center; font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
/* WebKit needs fill on its track pseudo-element; Firefox uses its progress pseudo-element. */
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
