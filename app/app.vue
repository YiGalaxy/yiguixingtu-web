<template>
  <div class="shell" :data-theme="themeMode">
    <!-- 单一文档高度背景，避免长页面滚动时平铺或重复。 -->
    <img
      class="bg-poster"
      :class="`is-${themeMode}`"
      :src="bgPosterSrc"
      alt=""
      aria-hidden="true">

    <!-- 全站唯一的播放器，挂在外壳上以跨路由保持状态。 -->
    <audio
      ref="audioRef"
      :src="bgMusicSrc"
      preload="metadata"
      @timeupdate="onMusicTime"
      @durationchange="onMusicDuration"
      @loadedmetadata="onMusicDuration"
      @play="onMusicPlay"
      @pause="onMusicPause"
      @ended="onMusicEnded"
      @volumechange="onMusicVolumeChange"/>

    <header class="site-nav">
      <NuxtLink to="/" class="brand">
        <span class="brand-mark" title="亿轨星途" aria-hidden="true"><img src="/assets/brand-minecraft-pixel-transparent.png" alt=""></span>
        <span class="brand-name">{{ settings.siteName }}</span>
      </NuxtLink>
      <nav class="nav-center">
        <!-- 桌面和移动端共用同一份导航数据。 -->
        <template v-for="item in navItems" :key="item.label">
          <!-- 有子项时显示下拉菜单。 -->
          <div v-if="item.children" class="nv dd" :data-tip="item.tip">
            <button class="nv-btn"><span v-if="item.icon" class="pixel-ui-icon" :class="item.icon" aria-hidden="true" />{{ item.label }} <span class="caret">▾</span></button>
            <div class="dd-menu">
              <NuxtLink v-for="child in item.children" :key="child.label" :to="child.to"><span v-if="child.icon" class="pixel-ui-icon" :class="child.icon" aria-hidden="true" />{{ child.label }}</NuxtLink>
            </div>
          </div>
          <NuxtLink v-else :to="item.to" class="nv" :data-tip="item.tip"><span v-if="item.icon" class="pixel-ui-icon" :class="item.icon" aria-hidden="true" />{{ item.label }}</NuxtLink>
        </template>
      </nav>
      <nav class="nav-right">
        <!-- 窄屏导航由 CSS 控制显示，ARIA 属性同步菜单状态。
             aria-expanded 让读屏软件知道"这个按钮是展开还是收起"，
             aria-controls 指向它控制的那个面板。 -->
        <button
          class="icon-btn nav-burger"
          :class="{ on: navOpen }"
          :aria-expanded="navOpen ? 'true' : 'false'"
          aria-controls="site-mobile-nav"
          :aria-label="navOpen ? '关闭导航菜单' : '打开导航菜单'"
          @click="toggleNav">
          <span class="burger-lines"><i /><i /><i /></span>
        </button>
        <button
          class="icon-btn theme-toggle"
          :aria-label="themeMode === 'night' ? '切换到白天主题' : '切换到夜晚主题'"
          :title="themeMode === 'night' ? '切换到白天主题' : '切换到夜晚主题'"
          @click="toggleTheme">
          <span class="theme-glyph" :class="`is-${themeMode}`" aria-hidden="true" />
        </button>
        <button class="icon-btn" aria-haspopup="dialog" aria-label="打开站点设置" title="站点设置" @click="openSettings">⚙</button>
        <template v-if="token">
          <!-- 登录状态提示：头像首字 + 昵称 + 角色标签 -->
          <div class="user-chip" :title="'当前登录：' + displayName">
            <span class="uc-avatar"><img src="/assets/avatar-catgirl-pixel.png" alt=""></span>
            <span class="uc-name">{{ displayName }}</span>
            <span class="uc-role" :class="{ 'is-admin': isAdmin }">{{ isAdmin ? '管理员' : '游客' }}</span>
          </div>
          <NuxtLink v-if="isAdmin" to="/admin" class="nav-admin" title="后台工作台"><span class="pixel-ui-icon icon-workbench" aria-hidden="true" /><span>后台</span></NuxtLink>
          <el-button type="primary" round class="nav-btn" @click="onLogout">退出</el-button>
        </template>
        <template v-else>
          <el-button type="primary" round class="nav-btn" @click="openLogin">登录</el-button>
          <el-button round class="nav-btn nav-ghost" @click="openRegister">注册</el-button>
        </template>
      </nav>
    </header>

    <!-- 窄屏导航面板；遮罩和路由变化都会关闭它。 -->
    <div v-if="navOpen" class="nav-scrim" @click="closeNav" />
    <nav v-show="navOpen" id="site-mobile-nav" class="nav-mobile glass">
      <template v-for="item in navItems" :key="item.label">
        <div v-if="item.children" class="nm-group">
          <div class="nm-group-title">{{ item.label }}</div>
          <NuxtLink v-for="child in item.children" :key="child.label" :to="child.to" class="nm-sub" @click="closeNav">{{ child.label }}</NuxtLink>
        </div>
        <NuxtLink v-else :to="item.to" class="nm-item" @click="closeNav"><span v-if="item.icon" class="pixel-ui-icon" :class="item.icon" aria-hidden="true" />{{ item.label }}</NuxtLink>
      </template>
    </nav>

    <main class="page">
      <NuxtRouteAnnouncer />
      <NuxtPage />
    </main>

    <footer class="site-footer">
      <!-- 页脚上方放品牌与音乐开关。 -->
      <div class="foot-top">
        <div class="foot-brand">
          <img class="foot-mark" src="/assets/brand-minecraft-pixel-transparent.png" alt=""> {{ settings.siteName }}
        </div>

        <button class="music-toggle" :class="{ on: musicEnabled }" :aria-label="musicEnabled ? '关闭背景音乐' : '播放背景音乐'" @click="toggleMusic">
          <span class="glyph">♫</span>
          <span class="music-label">{{ musicEnabled ? '关闭背景音乐' : '播放背景音乐' }}</span>
        </button>
      </div>

      <!-- 空字段不渲染；备案信息需要保留在 SSR HTML 中。 -->
      <div v-if="footerMetaVisible" class="foot-meta">
        <span v-if="settings.copyright">{{ settings.copyright }}</span>
        <a
          v-if="settings.icpNumber" class="foot-icp"
          :href="ICP_LINK" target="_blank" rel="noopener noreferrer">
          {{ settings.icpNumber }}
        </a>
        <a
          v-if="settings.policeNumber" class="foot-police"
          :href="policeQueryUrl(settings.policeNumber)" target="_blank" rel="noopener noreferrer">
          <img class="foot-police-icon" :src="policeIconSrc" alt="公安网安备案" height="20" >
          <span>{{ settings.policeNumber }}</span>
        </a>
      </div>
    </footer>

    <!-- 站点设置使用抽屉，包含遮罩、Esc 和焦点管理。
         组件负责遮罩、Esc、焦点管理和背景滚动锁定。 -->
    <el-drawer
      v-model="settingsOpen"
      class="settings-drawer"
      title="站点设置"
      direction="rtl"
      size="min(380px, 88vw)">
      <p class="set-sub">昼夜主题控制页面背景，音乐开关只影响你这台设备。</p>
      <div class="set-card glass">
        <div class="set-row">
          <div class="set-info">
            <span class="set-name">背景音乐</span>
            <span class="set-desc">和页脚的 ♫ 是同一个设置，改哪个都一样</span>
          </div>
          <el-switch
            :model-value="musicEnabled"
            aria-label="背景音乐"
            @update:model-value="setMusicOn" />
        </div>
      </div>
    </el-drawer>

    <el-dialog v-model="loginVisible" class="auth-modal" :show-close="false" width="400px" :close-on-click-modal="true">
      <div class="auth-card">
        <div class="brand-line"><img src="/assets/brand-minecraft-pixel-transparent.png" alt=""> 亿轨星途</div>
        <h2 class="auth-title">欢迎回来</h2>
        <p class="auth-sub">登录后，继续绘制你的星图</p>
        <el-form label-position="top" class="auth-form" @submit.prevent="onLogin">
          <el-form-item label="用户名"><el-input v-model="form.username" placeholder="请输入用户名" size="large" /></el-form-item>
          <el-form-item label="密码"><el-input v-model="form.password" type="password" show-password placeholder="请输入密码" size="large" @keyup.enter="onLogin" /></el-form-item>
        </el-form>
        <div class="auth-row">
          <!-- 仅保存用户名，密码不写入客户端存储。 -->
          <el-checkbox v-model="remember">记住用户名</el-checkbox>
          <el-link type="primary" underline="never" @click="switchToRegister">去注册</el-link>
        </div>
        <!-- 限流期间禁用提交按钮，回车提交也在登录逻辑中拦截。 -->
        <el-button
          type="primary"
          class="auth-submit"
          :loading="loading"
          :disabled="coolingDown"
          @click="onLogin">{{ loginButtonText }}</el-button>
      </div>
    </el-dialog>

    <el-dialog v-model="registerVisible" class="auth-modal" :show-close="false" width="400px" :close-on-click-modal="true">
      <div class="auth-card">
        <div class="brand-line"><img src="/assets/brand-minecraft-pixel-transparent.png" alt=""> 亿轨星途</div>
        <h2 class="auth-title">创建账号</h2>
        <p class="auth-sub">开始记录你的第一篇</p>
        <el-form label-position="top" class="auth-form" @submit.prevent="onRegister">
          <el-form-item label="用户名"><el-input v-model="regForm.username" placeholder="设置用户名" size="large" /></el-form-item>
          <el-form-item label="昵称"><el-input v-model="regForm.nickname" placeholder="怎么称呼你" size="large" /></el-form-item>
          <!-- 邮箱必填：站长要联系注册用户（找回密码、发通知）时，这是他手里唯一的联系方式。
               放在密码前面，是因为它是"这个账号是谁"的一部分，而密码是"怎么保护它"。
               @keyup.enter 一起带上：用户在最后一个框里按回车提交是习惯动作，
               漏掉它的话这一栏的回车会什么都不做（登录弹窗也有同样的接线）。 -->
          <el-form-item label="邮箱">
            <el-input
              v-model="regForm.email"
              placeholder="用来联系你，不会公开"
              size="large"
              @keyup.enter="onRegister" />
          </el-form-item>
          <el-form-item label="密码"><el-input v-model="regForm.password" type="password" show-password placeholder="设置密码" size="large" @keyup.enter="onRegister" /></el-form-item>
        </el-form>
        <el-button type="primary" class="auth-submit" :loading="regLoading" @click="onRegister">注 册</el-button>
        <div class="auth-row center"><el-link type="primary" underline="never" @click="switchToLogin">已有账号？去登录</el-link></div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ElMessage } from 'element-plus'
const { login, register, logout, token, user, coolingDown, cooldownLeft } = useAuth()
const { loginVisible, registerVisible, openLogin, openRegister } = useAuthUi()
const { request } = useApi()
const themePreference = useCookie('site-theme', {
  default: () => 'night',
  maxAge: 60 * 60 * 24 * 365,
  sameSite: 'lax',
})
const themeMode = computed(() => themePreference.value === 'day' ? 'day' : 'night')
const route = useRoute()
useHead(() => ({ htmlAttrs: { 'data-theme': themeMode.value } }))
const toggleTheme = () => {
  themePreference.value = themeMode.value === 'night' ? 'day' : 'night'
}

// ---------- 登录状态提示 ----------
const isAdmin = computed(() => user.value?.role === 'ADMIN')
const displayName = computed(() => user.value?.nickname || user.value?.username || '已登录')
// The shell owns the single audio element; pages consume shared state and injected controls.
const music = useBackgroundMusic()
const { enabled: musicEnabled, toggle: toggleMusic, report: reportMusic } = music
// Client-only preferences are restored after mount.
onMounted(() => music.loadPreference())

const routeBackdrop = computed(() => {
  const path = route.path
  if (path === '/admin') return ['admin-studio-day.png', 'admin-studio-night.png']
  if (path === '/projects') return ['enchant-room-day.png', 'enchant-room-night.png']
  if (path === '/articles' || path.startsWith('/article/')) return ['article-library-day.png', 'article-library-night.png']
  if (path === '/music') return ['music-room-day.png', 'music-room-night.png']
  if (path === '/archive') return ['archive-chest-day.png', 'archive-chest-night.png']
  if (path === '/favorites') return ['brewing-room-day.png', 'brewing-room-night.png']
  if (path === '/links') return ['village-gathering-day.png', 'village-gathering-night.png']
  if (path === '/about') return ['fishing-river-day.png', 'fishing-river-night.png']
  return ['homepage-day-bg.png', 'homepage-night-clear.png']
})

const bgPosterSrc = computed(() => `/assets/${themeMode.value === 'day' ? routeBackdrop.value[0] : routeBackdrop.value[1]}`)

// Resolve the filing icon with the same media prefix.
const policeIconSrc = mediaUrl(MEDIA_FILES.policeIcon)

// Track URLs come from the API; the built-in track is the fallback.
const { tracks: musicTracks, currentTrack, activeIndex: musicActiveIndex } = useMusicTracks()
const bgMusicSrc = computed(() => currentTrack.value.url)

// ---------- Player element state ----------
/** The single audio element. */
const audioRef = ref()
/** Current position in seconds. */
const musicCurrent = ref(0)
/** Duration in seconds; zero means metadata is not ready. */
const musicDuration = ref(0)
/** Volume preference, restored on mount. */
const musicVolume = ref(1)
/** Session-only mute state. */
const musicMuted = ref(false)
/** Object URL for the embedded cover, when available. */
const musicCoverUrl = ref('')

/** Persistent volume key; mute remains session-only. */
const VOLUME_STORAGE_KEY = 'bg-music-volume'

/** Read a valid persisted volume on the client. */
const readStoredVolume = () => {
  if (!import.meta.client) return 1
  try {
    const raw = Number.parseFloat(localStorage.getItem(VOLUME_STORAGE_KEY) ?? '')
    return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : 1
  } catch {
    // Storage failures should not block playback.
    return 1
  }
}

const persistVolume = () => {
  if (!import.meta.client) return
  try {
    localStorage.setItem(VOLUME_STORAGE_KEY, String(musicVolume.value))
  } catch {
    // Keep the in-memory value when persistence is unavailable.
  }
}

/** Apply reactive audio settings to the element. */
const applyVolume = () => {
  const el = audioRef.value
  if (!el) return
  el.volume = musicVolume.value
  el.muted = musicMuted.value
}

/** 音乐页的音量滑块走这里：改 ref + 立刻应用到元素 + 落盘 */
const setMusicVolume = (value) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return
  musicVolume.value = Math.min(1, Math.max(0, parsed))
  // Changing volume is an explicit request to unmute.
  if (musicVolume.value > 0) musicMuted.value = false
  applyVolume()
  persistVolume()
}

/** Toggle mute without changing the selected volume. */
const toggleMusicMute = () => {
  musicMuted.value = !musicMuted.value
  applyVolume()
}

/** Progress percentage; zero until duration is known. */
const progressOf = (el) => (el && el.duration ? (el.currentTime / el.duration) * 100 : 0)

/**
 * 跳转到某一秒（音乐页：拖进度条、点某句歌词）。
 *
 * 【为什么上限要分两种情况】duration 在"还没读到元数据"时是 NaN：
 *   `Math.min(x, NaN)` 是 NaN，而给 currentTime 赋 NaN 在浏览器里会被**静默忽略**
 *   （元素停在原地，用户看到"点了没反应"），在 happy-dom 里则直接抛 TypeError。
 *   两种都很难查，所以这里先判断 duration 是不是有限的正数。
 */
const seekMusic = (seconds) => {
  const el = audioRef.value
  const target = Number(seconds)
  if (!el || !Number.isFinite(target)) return
  const max = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : target
  el.currentTime = Math.min(Math.max(0, target), max)
  // 立刻回写本地秒数与共享进度：不等下一次 timeupdate（最多 250ms），
  // 否则用户松开进度条之后，滑块还会"弹回去一点点"再跳过来
  musicCurrent.value = el.currentTime
  reportMusic({ progress: progressOf(el) })
}

/**
 * 进度回写的节流。
 *
 * 【为什么必须节流】`timeupdate` 是浏览器在播放过程中**反复**触发的事件
 * （规范给的是 4~66 次/秒）。`progress` 是 `useState` —— 全站共享、
 * 会参与多处渲染，每帧都写一次等于把 Vue 的响应式系统按帧号跑满
 * （首页那张卡片、音乐页的进度条、页脚……全都跟着重渲染）。
 *
 * 【策略】两个条件满足其一才写：
 *   · 距上次写入 >= 250ms（正常播放时约 4 次/秒，进度条足够顺滑）
 *   · 或者进度变化 >= 1%（拖完进度条、或浏览器一次性跳过一大段的场合，
 *     立刻写；顺带这条判断不依赖真实时钟就能测 —— 见 test/music.nuxt.spec.ts）
 */
const PROGRESS_MIN_INTERVAL = 250
const PROGRESS_MIN_DELTA = 1
let lastProgressAt = 0
let lastProgressValue = 0

const onMusicTime = () => {
  const el = audioRef.value
  if (!el) return
  // 【兜底再读一次时长 —— 不依赖事件】
  //   某些浏览器/某些时刻 `loadedmetadata` 与 `durationchange` 给出来的 duration 是
  //   NaN 或 Infinity（首次访问、还没缓冲够时很常见），而这两个事件**不一定再来一次**
  //   ⇒ 时长就一直是 0 ⇒ 音乐页那个进度条的 max 变成 1、滑块被夹到最右并且被禁用
  //   （用户报的"进度条迅速跳完、然后拖不动"）。
  //   `timeupdate` 每 250ms 就来一次，用它兜底最省事，而且不会漏 ——
  //   一旦读到有效值就不再重复读（`musicDuration.value <= 0` 这个判断就是干这个的）。
  if (musicDuration.value <= 0) onMusicDuration()
  // 秒数写的是**本地 ref**（只有音乐页在读），不必节流；
  // 共享状态里的百分比才需要（见上面那段）
  if (Number.isFinite(el.currentTime)) musicCurrent.value = el.currentTime
  const percent = progressOf(el)
  if (!Number.isFinite(percent)) return
  const now = Date.now()
  const due = now - lastProgressAt >= PROGRESS_MIN_INTERVAL
  const jumped = Math.abs(percent - lastProgressValue) >= PROGRESS_MIN_DELTA
  if (!due && !jumped) return
  lastProgressAt = now
  lastProgressValue = percent
  reportMusic({ progress: percent })
}

/**
 * 时长：只在"有限且为正"时采纳。
 *
 * ⚠️ 【读不到时**保持上一个有效值**，而不是清零 —— 这一条是用户报的
 *    "进度条在几秒内自己跑到最右、然后拖不动了"的根因】
 *   浏览器在**音源切换 / 尚未就绪 / 加载失败**时，会发一次 `duration` 为 `NaN`
 *   的 `durationchange`（换歌、接口回来之后换 `src`、音频 404 都会触发）。
 *   原来的写法把它收成 `0` ⇒ 进度条的 `max` 从 180 变成 1，
 *   而 `value`（当前秒数）还是刚才那几秒 ⇒ **滑块被浏览器夹到最右端**；
 *   同时音乐页那个 `:disabled="duration <= 0"` 把它置灰 ⇒ **"拖不动了"**。
 *   三个症状（没颜色、跑到最右、拖不动）其实是同一处。
 *
 *   语义上"保持上一个有效值"也更准：`0` 的含义是"**这一首**还没读到时长"
 *   （换歌时由下面那个 watch 显式清零），而不是"刚刚读了一次没读到"。
 *   读不出来时显示 `--:--` 的诉求也没丢：初始值本来就是 0。
 */
const onMusicDuration = () => {
  const el = audioRef.value
  if (!el) return
  const seconds = el.duration
  if (Number.isFinite(seconds) && seconds > 0) musicDuration.value = seconds
}

// 真实事件回写共享状态：浏览器可能在别的地方把音频暂停/播放了
// （系统媒体控制、来电、蓝牙断连），那时界面必须跟着变，而不是继续显示"正在播放"
const onMusicPlay = () => reportMusic({ playing: true })
const onMusicPause = () => reportMusic({ playing: false })

/**
 * 播放模式（顺序 / 随机 / 单曲循环）与"随机播放的洗牌袋"（2026-09-13 加）。
 *
 * 【袋子为什么住在这里，而不是放进共享状态】
 *   它只有一个消费者 —— 下面这个 `ended` 处理函数。共享状态里的东西都是
 *   "多个界面都要读的事实"（想不想听 / 在不在播 / 第几首 / 哪一档模式），
 *   而袋子是**算法的中间结果**：没有任何界面需要知道"这一轮还剩哪几首没放"。
 *   放进去只会让 `useState` 多一份要序列化、要清理、还要在每个用例开头复位的东西。
 *
 * 【为什么要监听变化把它清空】列表变了（后台删了/加了一首歌）之后，
 *   旧袋子里的下标可能指向另一首歌（甚至越界）——`advancePlayback` 会过滤掉越界的，
 *   但"下标语义变了"这件事过滤不掉。清空的代价只是这一轮重新洗牌。
 */
const musicMode = music.mode
let shuffleBag = []
watch([musicMode, () => musicTracks.value.length], () => { shuffleBag = [] })

/**
 * 一首放完了：按当前模式决定接下来放什么。
 *
 * 【这条路径现在是**主路径**了】改之前 `<audio>` 带着 `loop`，
 *   浏览器永远不会派发 `ended` —— 那时这个函数只是"防御性"的（见模板上的说明）。
 *   去掉 `loop` 之后它就是"自动下一首"的全部实现。
 *
 * 【四种结果，逐个说清】
 *   · `index === null`      → 顺序播放放到了最后一首：**停下**，
 *     并且要把"这一轮播放"收拾成**下次点一下就能重新开始**的样子：
 *       ① `setEnabled(false)`：把开关也关掉。
 *          ⚠️ 这一条是**在真实浏览器里发现必须加的**：原来只把 `playing` 置 false、
 *          `enabled` 留着 true，于是界面上按钮显示 ▶（没在响）而共享状态说"想听" ——
 *          用户点 ▶ 走的是 `toggle`，等于**把开关关掉**，屏幕上什么都不会发生
 *          （"点了没反应"），得再点一次才响。全站四个入口（页脚 ♣、⚙ 面板、
 *          首页卡片、音乐页按钮）都是同一个坑。
 *       ② `setTrack(0)` + `currentTime = 0`：**回到第一首**再停。
 *          这样下次按播放是从头开始放整张列表，而不是"又放一遍最后一首、
 *          放完立刻又停"（真实播放器也是这个行为）。
 *          顺序不能反：先关开关再换歌 —— 反过来的话，换歌那一刻 `enabled` 还是 true，
 *          上面那个 watch 会**立刻把第一首放起来**，白白响一下。
 *   · `index === 当前行号`  → 单曲循环（或者随机播放里只有一首歌）：
 *     把这一首从头再放。⚠️ 不能走 `setTrack` —— 下标没变它什么都不做，
 *     表现就是"单曲循环放完一首就哑了"。
 *   · 其它                  → 只改共享状态里的下标，换音源与"接着播"由上面那个
 *     watch 完成（和用户手点曲目列表走的是同一条路，两边行为不会不一致）。
 *
 * 【为什么 await play() 失败只报告 false，不再往下改别的】与那个 watch 里同款处理：
 *   自动播放被浏览器拒绝时，"想听但没响"是诚实的状态。
 */
const onMusicEnded = async () => {
  reportMusic({ playing: false, progress: 0 })

  const el = audioRef.value
  const { index, bag } = advancePlayback({
    mode: musicMode.value,
    current: musicActiveIndex.value,
    total: musicTracks.value.length,
    bag: shuffleBag,
  })
  shuffleBag = bag

  if (!el) return

  // 顺序播放放完了整张列表：收干净（见上面 ① ② 的顺序说明）
  if (index == null) {
    music.setEnabled(false)
    el.currentTime = 0
    musicCurrent.value = 0
    music.setTrack(0)
    return
  }

  if (index === musicActiveIndex.value) {
    // 这一首从头再放：位置归零、立刻接着播（等 watch 是等不到的，下标没变）
    musicCurrent.value = 0
    el.currentTime = 0
    try {
      await el.play()
      reportMusic({ playing: true })
    } catch {
      reportMusic({ playing: false })
    }
    return
  }

  music.setTrack(index)
}

/** 元素上的音量/静音被别人改动时（系统控件、将来的其它入口）同步回界面 */
const onMusicVolumeChange = () => {
  const el = audioRef.value
  if (!el) return
  if (Number.isFinite(el.volume)) musicVolume.value = el.volume
  musicMuted.value = el.muted === true
}

/**
 * 【谁真正去 play/pause、谁真正去换歌】外壳照着共享状态执行（`enabled` 与 `trackIndex`）。
 *
 * 【为什么用 watch 而不是"点按钮时直接 play"】开关可能在**别处**被改
 * （页脚的 ♫、⚙ 设置面板、首页卡片、音乐页），那时候按钮根本没被点过 ——
 * 只有 watch 才能让四处一致。换歌同理：音乐页点一行、将来的"下一首"，
 * 都只是改共享状态里的下标，真正换音源的动作必须由持有元素的外壳来做。
 *
 * 【为什么 play() 成功之后还要乐观地把 playing 置为 true】
 *   `await el.play()` 在真实浏览器里可能被自动播放策略拒绝（那时走 catch，
 *   状态回到 false，是诚实的结果）；而测试环境（happy-dom）里"播了没声音"
 *   这种事根本不存在，事件也不一定派发 —— 只靠事件驱动的话，
 *   "点了之后按钮该变成暂停图标"这条就永远测不出来。
 *   所以以**意图执行的结果**为准先置位，再由真实事件（play / pause / ended）纠正。
 *
 * 【换歌这一支为什么要等一拍、又为什么要显式把位置设成 0】
 *   `<audio :src>` 是 Vue 渲染出来的属性，**换歌到属性真的写进元素之间隔着一次 DOM 更新**；
 *   不等那一拍就 `play()`，播的还是上一首（地址还没换）。
 *   换完之后位置理论上会自动归零，但有的浏览器要等到新音源加载出元数据才重置 ——
 *   在那之前 `currentTime` 读出来还是上一首的位置（表现是"切歌后进度条停在中间"），
 *   所以这里再显式设一次（设不上也不影响：新音源就绪时浏览器自己会归零）。
 *   【切歌时正在播要接着播】`on` 没变，只是地址换了，所以下面照样走到 play() ——
 *   不会因为换歌把用户"切成暂停"。
 *
 * 【为什么要监听"地址"而不是"第几首"】换歌的实质就是**音源变了**：
 *   地址变了 → 元素必须重新加载、位置归零、封面重读。
 *   而列表本身是异步来的（接口回来之前是内置那一首），所以"第几首"这个数字
 *   在不同时刻可能指向不同的地址（例如接口回来之后第 0 首从内置那首换成了站长的第一首）——
 *   盯着地址看，这两种情况都会正确地被当成"换歌"。
 */
watch([musicEnabled, bgMusicSrc], async ([on, src], previous) => {
  const el = audioRef.value
  if (!el) return

  // previous 为 undefined = 这个 watch 的第一次执行（挂载时还没元素，上面已经 return 了）
  const trackChanged = !previous || previous[1] !== src
  if (trackChanged) {
    // 换歌 = 换一份"这首歌自己的东西"：秒数、时长、内嵌封面全部重新来
    musicCurrent.value = 0
    musicDuration.value = 0
    resetMusicCover()
    reportMusic({ progress: 0 })
    await nextTick()   // 等 :src 真的写进元素（见上面那段说明）
    el.currentTime = 0
  }

  if (!on) {
    el.pause()
    reportMusic({ playing: false })
    return
  }
  try {
    await el.play()
    reportMusic({ playing: true })
  } catch {
    reportMusic({ playing: false })
  }
  // 封面是"锦上添花"，放在播放之后去读：它不该挡着声音（见下面 ID3_HEAD_BYTES 那段）
  fetchMusicCover()
})

// ---------- 歌曲内嵌封面（ID3 APIC）----------
/**
 * 只抓文件开头这么多字节去碰封面。
 * 【为什么不是"把整首 mp3 下下来再解析"】整首 2 MB，而 ID3 标签在文件**最前面**
 *   —— 封面（如果有）在开头几百 KB 里必定已经出现了。
 * 【为什么偏偏是 128 KiB】ID3 标签通常只有几 KB（一张 500×500 的 jpg 也就 50 KB 上下）；
 *   128 KiB 足够覆盖绝大多数"标签 + 一张封面"，同时在**没有封面**的文件上
 *   （比如本站这一个）浪费也被限制在这个量级。
 * 【它仍然是浪费，这一点要说清楚】本站这个 mp3 现在**根本没有 APIC 帧**
 *   （只有 ffmpeg 写的 TXXX），所以这次抓回来的字节里一定找不到封面。
 *   为了让"从不开音乐"的访客一个字节都不为它花，抓取是**等用户真的想听音乐之后**才发起的
 *   （见上面那个 watch）—— 那种时候浏览器本来也要开始下这首歌了。
 * 【换歌之后要重新抓】封面是**每首歌自己的**，所以记录"已经为哪个地址抓过"，
 *   而不是"抓过了"（后者会让第二首歌继续顶着第一首的封面）。
 */
const ID3_HEAD_BYTES = 131072

/**
 * 这个音源地址是不是"我们自己的"（同源）。
 * 【为什么要判它】见下面 fetchMusicCover 里那段：读内嵌封面这一步是 fetch + Range，
 *   跨域时会被 CORS 预检挡住（外链基本都不放行）。同源（`/` 开头，或同源的绝对地址）
 *   才可能成功 —— 判错的代价只是"多了一个失败的请求"或者"少读到一张封面"，
 *   不影响播放，所以这里宁可写得保守一点。
 */
const isSameOrigin = (url) => {
  if (typeof url !== 'string' || !url) return false
  if (url.startsWith('/')) return true                       // 站内相对地址（/media、/uploads）
  if (!import.meta.client) return false                      // 服务端没有 location，一律当作不同源
  try {
    return new URL(url, window.location.href).origin === window.location.origin
  } catch {
    return false                                             // 坏地址：当作不可读
  }
}

/** 已经为哪个音源地址尝试过读封面（空串 = 还没试过） */
let coverAttemptedFor = ''

/** 清掉当前封面（回收 object URL）—— 换歌、卸载时都要走这里，否则就是内存泄漏 */
const resetMusicCover = () => {
  if (musicCoverUrl.value) {
    try {
      URL.revokeObjectURL(musicCoverUrl.value)
    } catch {
      // 已经失效的地址再撤销会抛错，忽略即可
    }
  }
  musicCoverUrl.value = ''
  coverAttemptedFor = ''
}

/** 读当前这首歌的内嵌封面。拿不到（没有 ID3 / 没有 APIC / 网络失败）就什么都不做，由调用方回落 */
const fetchMusicCover = async () => {
  if (!import.meta.client) return
  const src = bgMusicSrc.value
  if (!src || coverAttemptedFor === src) return   // 同一首歌只抓一次
  // 【跨域的那一步会失败，而且这是正常的】`<audio>` 播放**不需要** CORS，
  //   但我们这一步是**普通 fetch**（还带 Range 头 → 会先发 OPTIONS 预检）：
  //   外链音频的空间商基本不会为它开放 CORS，请求必然失败。
  //   所以外链曲目直接跳过这一步，用接口给的 `cover`（再没有就是占位图案）——
  //   而不是发一个注定失败的请求、然后在控制台留一堆红字。
  //   （注意别写反：**不能**放的是这一步，不是播放本身。）
  if (!isSameOrigin(src)) return
  coverAttemptedFor = src
  try {
    const head = await $fetch(src, {
      headers: { Range: `bytes=0-${ID3_HEAD_BYTES - 1}` },
      responseType: 'arrayBuffer',
    })
    const cover = parseId3v2Cover(head)
    // 【竞态护栏】等请求回来的这段时间里用户可能已经切歌了：这份封面属于上一首，
    // 直接丢掉。不加这一条的表现是"切歌之后封面闪回上一首的图"（而且很难复现）。
    if (!cover || coverAttemptedFor !== src) return
    // URL.createObjectURL 把 Blob 变成一个 <img src> 能用的地址。
    // 【为什么不在 utils 里做】它创建的地址**必须由创建方负责回收**
    // （revokeObjectURL），把"谁创建"和"谁回收"分开写是内存泄漏的经典起点；
    // 所以创建与回收都留在这个生命周期最长的组件里（见 onBeforeUnmount）。
    if (typeof URL?.createObjectURL !== 'function') return
    musicCoverUrl.value = URL.createObjectURL(cover.blob)
  } catch {
    // 网络失败 / 服务器不支持 Range / 返回值根本不是二进制：
    // 一律当作"没有内嵌封面"，页面用回落图 —— 这条路径绝不能影响页面能不能打开
  }
}

/**
 * 交给页面用的播放器接口（注入键 'bgMusicPlayer'，音乐页按同一字符串 inject）。
 * 只包含"元素自己的属性 + 几个动作"，**不含** enabled/playing/progress/trackIndex
 * ——那几样仍然只有 `useBackgroundMusic()` 一份（见本段开头的分工说明）。
 */
const bgMusicPlayer = {
  audioRef,
  currentTime: musicCurrent,
  duration: musicDuration,
  volume: musicVolume,
  muted: musicMuted,
  coverUrl: musicCoverUrl,
  seek: seekMusic,
  setVolume: setMusicVolume,
  toggleMute: toggleMusicMute,
}
provide('bgMusicPlayer', bgMusicPlayer)

// 卸载时释放 object URL。不释放的话那份图片数据会一直被浏览器攥着
// （SPA 里反复切换/热更新时就是一条稳定的内存泄漏）
onBeforeUnmount(resetMusicCover)

const onLogout = async () => {
  // 【这次修了什么】原来只清本地 token，完全没调后端 ——
  // 于是服务端签出去的那个 token 依然有效到自然过期（默认 24 小时）。
  // 现在交给 useAuth().logout()：它先去调 POST /auth/logout 把当前 token 拉黑，
  // 再清 token 与 user。接口失败也照样清（用户想退出就该让他退掉）。
  await logout()
  ElMessage.success('已退出')
  navigateTo('/')
}

// Navigation data is shared by desktop and mobile menus; CSS handles breakpoints.

/** Shared navigation entries. */
/** Site settings are fetched once for the shared shell. */
const { settings } = useSiteSettings()

/** Show the footer metadata row only when at least one field is present. */
const footerMetaVisible = computed(() => hasFooterMeta(settings.value))

const navItems = computed(() => [
  { label: '首页', to: '/', icon: 'icon-home', tip: '首页' },
  // Archive and article search are separate pages.
  { label: '归档', to: '/archive', icon: 'icon-archive', tip: '归档' },
  { label: '文章', to: '/articles', icon: 'icon-article', tip: '文章检索' },
  // Music is a real route rather than a home-page anchor.
  { label: '音乐', to: '/music', icon: 'icon-music', tip: '音乐播放器' },
  { label: '收藏', to: '/favorites', icon: 'icon-favorite', tip: '我的收藏' },
  { label: '项目', to: '/projects', icon: 'icon-project', tip: '项目档案' },
  { label: '友链', to: '/links', icon: 'icon-links', tip: '友链' },
  { label: '关于', to: '/about', icon: 'icon-about', tip: '关于本站' },
])

/** 汉堡面板开着没有 */
const navOpen = ref(false)

const closeNav = () => { navOpen.value = false }
const toggleNav = () => { navOpen.value = !navOpen.value }

/**
 * Esc 关闭：浮层类的东西一律要能用 Esc 关掉，
 * 否则键盘用户点开面板之后只能靠鼠标去点遮罩。
 */
const onNavKeydown = (event) => {
  if (event.key === 'Escape' && navOpen.value) closeNav()
}
onMounted(() => window.addEventListener('keydown', onNavKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onNavKeydown))

/**
 * 路由一变就收起面板：面板里的项点下去会跳走，跳走之后还挂着一个盖住半屏的面板，
 * 用户会以为"点坏了"。
 *
 * 【和"链接自己 @click=closeNav"是什么关系】两者**都要**，分工不同：
 *   · 链接上的 `@click="closeNav"` 管"点了面板里的项" —— 立刻收，
 *     不用等路由真的变（手机上这一下延迟都能感觉到）
 *   · 这个 watch 管**所有别的跳转路径**：浏览器后退/前进、点 Logo、代码里
 *     `navigateTo`、以后新增的入口…… 不可能靠每个调用点自觉去关面板
 */
watch(() => route.fullPath, () => closeNav())

/**
 * 打开面板时锁住 body 滚动：手机上滑面板会带着背后的页面一起滚，
 * 松手之后页面停在一个莫名其妙的位置。
 * 【为什么在卸载时要清掉】不清的话，带着 overflow:hidden 的 body 会被带到下一个页面 ——
 * 表现是整个站点突然不能滚了，而且很难联想到是"那个面板"干的。
 */
const setBodyLock = (locked) => {
  if (import.meta.client) document.body.style.overflow = locked ? 'hidden' : ''
}
watch(navOpen, (open) => setBodyLock(open))
onBeforeUnmount(() => setBodyLock(false))

/** Local state for the settings drawer. */
const settingsOpen = ref(false)

/** Open settings and close the mobile navigation first. */
const openSettings = () => {
  closeNav()
  settingsOpen.value = true
}

/** Persist the music preference through the shared composable. */
const setMusicOn = (value) => music.setEnabled(value)

const form = reactive({ username: '', password: '' })
// Keep the client-side checks aligned with the server DTO.
const regForm = reactive({ username: '', nickname: '', email: '', password: '' })
const loading = ref(false)
const regLoading = ref(false)

// Remembered login stores only the username.
const { remember, username: rememberedUsername, restore: restoreRemembered, save: saveRemembered, clear: clearRemembered } = useRememberedLogin()

onMounted(async () => {
  // Restore client-only audio preferences.
  musicVolume.value = readStoredVolume()
  applyVolume()

  // Restore the username and migrate any old cookie format.
  restoreRemembered()
  if (rememberedUsername.value) form.username = rememberedUsername.value

  // Rehydrate the current user from the token after refresh.
  if (token.value && !user.value) {
    const res = await request('/auth/me', { requiresAuth: false })
    if (res.ok) user.value = res.data
  }

  // Consume the middleware login hint on the client.
  if (route.query.login === '1') {
    openLogin()
    // Remove the hint so refresh does not reopen the dialog.
    const rest = { ...route.query }
    delete rest.login
    navigateTo({ path: route.path, query: rest }, { replace: true })
  }

})

// ---------------------------------------------------------------------
//  访问上报（后台「访问统计」的数据来源）
// ---------------------------------------------------------------------
/**
 * 每次页面访问上报一次。
 *
 * 【为什么放在 app.vue 而不是各页面里】它是**全站的**行为：
 *   首页、归档、音乐、项目、文章……每一页都算一次访问。
 *   放在外壳里只有一处实现，将来加页面也不用记得补一行。
 *   （文章详情页另有一个 POST /article/{id}/view，那个管的是"这篇文章被看了几次"，
 *    与这里管"整站每天多少人看"是两件事，不合并。）
 *
 * 【为什么在客户端 watch 而不是 onMounted 里报一次】
 *   这是个 SPA：站内点链接**不会重新挂载外壳**，onMounted 只会在首次进入时跑一次，
 *   后面的翻页全都统计不到 —— 而那恰恰是"访问情况"的主要部分。
 *   监听路由变化能覆盖首屏（immediate）与之后的每一次跳转。
 *
 * 【⚠️ 后台的访问不计入】自己的站长得天看后台，把那些算进去会把统计彻底带偏
 *   （尤其是"访客构成"那张图，会变成"管理员 100%"）。
 */
/** 上一次报过的路径：避免同一路径的重复上报（比如 query 变化触发的重新求值） */
let lastReportedPath = null

const reportVisit = async (path) => {
  // "哪些路径该报"这条规则在 utils/visitReport.ts 里（纯函数、有单测）——
  // 后台不算访问、非站内路径不算访问，两条都在那里
  if (!shouldReportVisit(path)) return
  if (path === lastReportedPath) return
  lastReportedPath = path
  try {
    await request('/visit', { method: 'POST', body: { path } })
  } catch {
    // 【为什么静默】统计是锦上添花的东西：断网、后端抖动、被限流……
    //   任何一种失败都不该让用户看到一个红条。后端那边同样是吞掉异常只记日志。
  }
}

if (import.meta.client) {
  // 【为什么传给后端的是 route.path 而不是 fullPath】查询串里可能是搜索词之类的
  //   用户输入，不该进统计表。后端也会再洗一遍（两道都在，是因为这道在前端更容易改）。
  watch(() => route.path, (path) => { reportVisit(path) }, { immediate: true })
}
const switchToRegister = () => { loginVisible.value = false; registerVisible.value = true }
const switchToLogin = () => { registerVisible.value = false; loginVisible.value = true }

// 冷却期间按钮上直接写秒数：用户知道还要等多久，就不会反复点了
const loginButtonText = computed(() => (coolingDown.value ? `请 ${cooldownLeft.value} 秒后再试` : '登 录'))

const onLogin = async () => {
  // 冷却中：连"请输入用户名和密码"的校验都不做（用户此刻做什么都没用），
  // 只告诉他还要等多久。这条兜的是"密码框回车提交"那条路 —— 按钮虽然 disabled，
  // 但回车绕得过去，所以这里必须再拦一次。
  if (coolingDown.value) return ElMessage.warning(cooldownMessage(cooldownLeft.value))
  if (!form.username || !form.password) return ElMessage.warning('请输入用户名和密码')
  loading.value = true
  const res = await login(form.username, form.password)
  loading.value = false
  if (res.ok) {
    // 勾了就只存用户名（save() 构造出来的值里除了 username 没有别的字段），
    // 没勾就把 cookie 彻底删掉 —— 不能"留着旧值只是不用它"
    if (remember.value) saveRemembered(form.username)
    else clearRemembered()
    ElMessage.success('登录成功'); loginVisible.value = false; navigateTo('/')
  } else { ElMessage.error(res.message) }
}
/**
 * 邮箱长度上限。
 * 三处必须一致：这里的预检、后端 RegisterRequest 上的 @Size(max = 100)、
 * user.email 的列宽 varchar(100)（见 V18 迁移脚本）。
 */
const REG_EMAIL_MAX = 100

/**
 * 注册表单的预检，返回 '' 表示通过、否则是给用户看的原因。
 *
 * 【为什么现在才加】在这之前这个表单一个字的校验都没有 —— 全靠后端。
 *   邮箱这次是**新加的必填项**，而它是三个字段里最容易填错的
 *   （少个 @、域名没点、多打个空格），所以先判这一个。
 *   顺带把「用户名/密码不能为空」也放进来：否则会出现
 *   "邮箱判了、用户名没判"这种看起来像漏了一半的界面。
 *
 * 【为什么用 checkXxx 这两个纯函数，而不是直接写正则】它们是后台所有表单
 *   共用的那一套（app/utils/contentForm.ts），口径已经和后端对齐过。
 *   这里面最要紧的一条是 checkEmail 要求**域名里有点** ——
 *   后端的 @Email 单独拦不住 `a@b`（实测），两边靠同一条规则保持一致。
 *
 * ⚠️ 前端校验只是为了"当场告诉他哪里不对"，**权威始终在后端**：
 *   它可以被绕过，也不会因为这里判过了就不校验。
 */
const registerError = () => {
  return checkRequiredText(regForm.username, '用户名', 64)
    || checkRequiredText(regForm.password, '密码', 20)
    || (regForm.password.length < 6 ? '密码长度需要在 6-20 之间' : '')
    || checkRequiredText(regForm.email, '邮箱', REG_EMAIL_MAX)
    || checkEmail(regForm.email, '邮箱', REG_EMAIL_MAX)
}

const onRegister = async () => {
  const invalid = registerError()
  if (invalid) return ElMessage.warning(invalid)
  regLoading.value = true
  const res = await register(regForm)
  regLoading.value = false
  if (res.ok) { ElMessage.success('注册成功，去登录'); registerVisible.value = false; switchToLogin() }
  else { ElMessage.error(res.message) }
}
</script>

<style>
:root {
  --bg: #111a14; --surface: #1a2920; --surface-2: #26392c;
  --ink: #f1f5df; --muted: #c2cfb4; --line: rgba(187,207,157,.28);
  --accent: #f2c14e; --accent-strong: #ffd96b; --cyan: #59d6e6;
  --grass: #71934d; --pixel-shadow: #0a120d; --panel: rgba(26,41,32,.96);
  --nav-surface: #17251c; --world-wash: rgba(17,26,20,.70); --world-wash-bottom: rgba(17,26,20,.91);
  --grid-ink: rgba(198,219,164,.055); --on-accent: #172016;
  color-scheme: dark;
  --el-color-primary: var(--accent);
  --el-color-primary-light-3: #f7d678;
  --el-color-primary-light-5: #f8df99;
  --el-color-primary-dark-2: #c79425;
  --el-bg-color: var(--surface);
  --el-bg-color-overlay: var(--surface-2);
  --el-fill-color-blank: var(--surface);
  --el-border-color: var(--line);
  --el-text-color-primary: var(--ink);
  --el-text-color-regular: var(--muted);
  --el-border-radius-base: 0px;
  --el-border-radius-small: 0px;
}
:root[data-theme="day"] {
  --bg: #d8e3ca; --surface: #f2f3e2; --surface-2: #e3ebd5;
  --ink: #263723; --muted: #4d6046; --line: rgba(70,97,57,.4);
  --accent: #9a6214; --accent-strong: #81500c; --cyan: #247d77;
  --grass: #557a3e; --pixel-shadow: #829271; --panel: #f2f3e2;
  --nav-surface: #edf1dc; --world-wash: transparent; --world-wash-bottom: transparent;
  --grid-ink: rgba(48,79,38,.09); --on-accent: #fff8e6;
  --el-color-primary-light-3: #c38a40;
  --el-color-primary-light-5: #d2a467;
  --el-color-primary-dark-2: #76490c;
  color-scheme: light;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font-family: "PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans SC","Segoe UI",system-ui,sans-serif; -webkit-font-smoothing: antialiased; overflow-x: hidden; }

/* ===== 布局骨架：让页脚贴住视口底部 =====
   【修的是什么】
   原来 .shell 是个普通 div（display: block），
   导航 / 内容 / 页脚就是普通文档流，一个接一个往下排。
   内容不够高时（后台页、文章页），页脚停在自己内容的下方，
   页面底部就空出一片 —— 实测：后台空 81px、文章页空 63px。

   【怎么修】经典的 "sticky footer" 三件套：
     ① 容器改成纵向 flex
     ② 容器至少占满一屏（min-height: 100vh）
     ③ 内容区 flex:1 吃掉剩余空间，自然把页脚挤到底部
   内容超出视口时行为完全不变（照常往下滚），首页那种长页面不受影响。

    背景图和遮罩是绝对定位，不参与文档流。 */
.shell { display: flex; flex-direction: column; min-height: 100vh; min-height: 100dvh; }
/* 导航是 sticky、页脚是固定高度，都不允许被 flex 压缩 */
.site-nav, .site-footer { flex-shrink: 0; }
/* 内容区：flex-basis 用 auto（按内容撑），有剩余空间时再长高把它吃满 */
.page { flex: 1 0 auto; }

/* A single document-height layer prevents background seams on long pages. */
.shell { position: relative; isolation: isolate; }
.bg-poster { position: absolute; inset: 0; z-index: -2; display: block; width: 100%; height: 100%; min-height: 100%; pointer-events: none; object-fit: cover; object-position: center top; background: #07111e; filter: none; image-rendering: auto; transition: opacity .25s ease; }
.bg-overlay { position: absolute; inset: 0; z-index: -1; min-height: 100%; pointer-events: none; background: linear-gradient(180deg, rgba(8,15,29,.58), rgba(8,15,29,.84) 62%, rgba(8,15,29,.96)); backdrop-filter: none; }

/* ===== 共享的"玻璃面板"底 =====
   【为什么放在这里（全局）而不是各页面自己的 scoped 样式里】
   这个类被首页、归档页、后台面板一起用。原来它**只在 index.vue 里以 scoped 形式定义**，
   而 scoped 样式只对本组件的模板生效 —— 于是【归档页写了 class="glass"，却没有任何规则命中】：
   那些月份卡片和三个状态块没有背景、没有边框，文字直接压在页面背景上，
   看起来就是"和背景糊在一起"。用户报的原话正是这个。
   放到全局之后：任何页面都能用，而且只有一份定义，不会再出现"用了却没定义"。

   【为什么不用 scoped】
   全局定义才可能被别的页面用到；scoped 定义天然只服务一个文件，
   一旦被别处引用就是一个静默的空样式（不报错、不警告）。

   【各页面里已有的同名副本怎么办】
   index.vue 里那份 scoped 副本与这里**取值完全一致**，留着不冲突（作用域更具体，先命中它），
   admin.vue 里那份 `.admin .glass` 同理。本次不动它们，避免改了外观却没验证。
   新页面一律直接用这个全局类。 */
.glass { background: rgba(36,54,92,.34); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); border: 1px solid rgba(180,210,245,.14); box-shadow: inset 0 1px 0 rgba(255,255,255,.08); }

.site-nav { position: sticky; top: 0; z-index: 200; display: flex; align-items: center; justify-content: space-between; height: 64px; padding: 0 32px; background: rgba(14,24,48,.62); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border-bottom: 1px solid rgba(150,190,240,.10); box-shadow: inset 0 1px 0 rgba(255,255,255,.06); }
.brand { display: flex; align-items: center; gap: 10px; text-decoration: none; }
.brand-mark { width: 32px; height: 32px; border-radius: 10px; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, var(--accent-strong), var(--accent)); color: #0a1224; font-size: 15px; font-weight: 800; box-shadow: 0 4px 16px rgba(242,193,78,.45); animation: markPulse 4s ease-in-out infinite; }
.brand-name { font-size: 18px; font-weight: 800; letter-spacing: 1px; background: linear-gradient(100deg, var(--accent-strong), #ffffff, var(--accent)); -webkit-background-clip: text; background-clip: text; color: transparent; }
.site-nav::after { content: ''; position: absolute; left: 0; right: 0; bottom: -1px; height: 1px; background: linear-gradient(90deg, transparent, var(--accent), var(--cyan), transparent); background-size: 200% 100%; animation: navline 6s linear infinite; }
@keyframes markPulse { 0%,100% { box-shadow: 0 4px 16px rgba(242,193,78,.45); } 50% { box-shadow: 0 4px 26px rgba(242,193,78,.75); } }
@keyframes navline { from { background-position: 200% 0; } to { background-position: -200% 0; } }
.nav-center { flex: 1; display: flex; align-items: center; justify-content: center; gap: 4px; }
.nv { padding: 8px 12px; border-radius: 10px; color: var(--muted); font-size: 14px; font-weight: 500; text-decoration: none; cursor: pointer; transition: .2s; }
.nv:hover { color: var(--ink); background: rgba(255,255,255,.05); }
.nv-btn { background: none; border: none; color: inherit; font: inherit; cursor: pointer; display: flex; align-items: center; gap: 4px; }
.caret { font-size: 10px; }
.dd { position: relative; }
.dd-menu { position: absolute; top: 100%; left: 0; margin-top: 6px; background: rgba(14,24,48,.95); border: 1px solid var(--line); border-radius: 12px; padding: 6px; min-width: 120px; opacity: 0; visibility: hidden; transform: translateY(6px); transition: .2s; box-shadow: 0 12px 30px rgba(0,0,0,.4); }
.dd:hover .dd-menu { opacity: 1; visibility: visible; transform: none; }
.dd-menu a { display: block; padding: 8px 12px; border-radius: 8px; color: var(--muted); font-size: 13px; cursor: pointer; white-space: nowrap; }
.dd-menu a:hover { color: var(--accent); background: rgba(242,193,78,.12); }
.nav-right { display: flex; align-items: center; gap: 8px; }
.icon-btn { width: 36px; height: 36px; border-radius: 10px; background: none; border: 1px solid transparent; color: var(--muted); font-size: 16px; cursor: pointer; transition: .2s; }
.icon-btn:hover { color: var(--accent); border-color: var(--line); }
/* 【窄屏导航：从"整块隐藏"改成汉堡菜单】（2026-09-11）
   原来这里只有 `.nav-center { display: none }` —— 于是窄屏下整个中间导航直接消失，
   而且没有任何替代入口（手机上只剩 Logo 与登录按钮）。现在两者由同一条媒体查询互换：
   桌面显示完整导航、窄屏显示汉堡按钮。
   ⚠️ 为什么必须是 CSS 而不是用 JS 量窗口宽度：SSR 首屏在服务端量不到宽度，
   用 JS 判断会出现"服务端渲染成桌面版、客户端立刻改成移动版"的一下闪烁，
   严重时还会 hydration 不一致。 */
.nav-burger { display: none; }
@media (max-width: 1000px) {
  .nav-center { display: none; }
  .nav-burger { display: inline-flex; align-items: center; justify-content: center; }
}

/* 汉堡图标：三条线；展开时上下两条转成叉。
   【为什么用 transform 画叉而不是换图标】换图标要么引一整个图标库（体积），
   要么维护两套 SVG —— 而这里只需要两条线的旋转。 */
.burger-lines { display: inline-flex; flex-direction: column; justify-content: center; gap: 4px; width: 18px; height: 18px; }
.burger-lines i { display: block; height: 2px; border-radius: 2px; background: currentColor; transition: transform .2s, opacity .2s; }
.nav-burger.on .burger-lines i:nth-child(1) { transform: translateY(6px) rotate(45deg); }
.nav-burger.on .burger-lines i:nth-child(2) { opacity: 0; }
.nav-burger.on .burger-lines i:nth-child(3) { transform: translateY(-6px) rotate(-45deg); }

/* 遮罩：盖住导航以下的部分，点一下关面板（手机上最常见的关法）。
   导航本身 z-index 是 200，所以它仍然在遮罩之上、随时点得到（再点一次汉堡就收起）。 */
.nav-scrim { position: fixed; inset: 64px 0 0; z-index: 150; background: rgba(6,12,26,.55); }

/* 窄屏导航面板：从导航条下面滑出来。玻璃底来自全局 .glass（见本文件上面那段说明） */
.nav-mobile {
  position: fixed; top: 64px; left: 0; right: 0; z-index: 160;
  display: flex; flex-direction: column; gap: 2px;
  max-height: calc(100vh - 64px); overflow-y: auto;
  padding: 10px 14px 16px;
  border-radius: 0 0 18px 18px;
  /* 只保留下边一条边：面板是贴着屏幕两侧的，左右上三条边会显得像悬浮的卡片 */
  border-left: none; border-right: none; border-top: none;
}
.nm-item, .nm-sub { padding: 12px; border-radius: 12px; color: var(--muted); font-size: 15px; text-decoration: none; cursor: pointer; }
.nm-item:hover, .nm-sub:hover { color: var(--ink); background: rgba(255,255,255,.06); }
/* 「文章」的子项缩进一层 + 一个分组标题：手机上没有 hover 展开这种东西，
   所以子项直接平铺出来，比再套一层下拉好用（手指点得到、也不用猜哪里能展开） */
.nm-group { display: flex; flex-direction: column; gap: 2px; padding-top: 6px; }
.nm-group-title { padding: 4px 12px; font-size: 12px; letter-spacing: 1px; color: var(--accent); font-weight: 700; }
.nm-sub { padding-left: 26px; font-size: 14px; }
/* 登录状态胶囊：头像首字 + 昵称 + 角色标签 */
.user-chip { display: inline-flex; align-items: center; gap: 8px; height: 34px; padding: 0 12px 0 4px; border-radius: 999px; background: rgba(255,255,255,.06); border: 1px solid var(--line); }
.uc-avatar { width: 26px; height: 26px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, var(--accent-strong), var(--accent)); color: #0a1224; font-size: 13px; font-weight: 800; }
.uc-name { font-size: 13px; font-weight: 600; color: var(--ink); max-width: 90px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.uc-role { font-size: 11px; padding: 1px 8px; border-radius: 999px; background: rgba(150,190,240,.14); color: var(--muted); }
.uc-role.is-admin { background: rgba(242,193,78,.18); color: var(--accent); font-weight: 700; }
@media (max-width: 1000px) { .uc-name { display: none; } }

.nav-admin { display: inline-flex; align-items: center; height: 32px; padding: 0 16px; border-radius: 999px; background: linear-gradient(135deg, var(--accent-strong), var(--accent)); color: #0a1224; font-weight: 700; font-size: 14px; text-decoration: none; transition: transform .2s ease, box-shadow .2s ease; }
.nav-admin:hover { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(242,193,78,.4); }
.nav-btn { font-weight: 600; }
.nav-ghost { background: rgba(255,255,255,.05); border: 1px solid var(--line); color: var(--ink) !important; backdrop-filter: blur(10px); }
.nav-ghost:hover { border-color: var(--accent); color: var(--accent) !important; }

.el-button--primary { --el-button-bg-color: var(--accent); --el-button-border-color: var(--accent); --el-button-hover-bg-color: var(--accent-strong); --el-button-hover-border-color: var(--accent-strong); --el-button-text-color: #0a1224; --el-button-hover-text-color: #0a1224; }

/* 【页脚为什么是纵向两行】见模板里那段注释：第一行是"品牌 + 音乐开关"（两侧分布），
   第二行是通栏居中的版权与备案信息。这里 flex-direction: column 就是为了让第二行
   不受第一行 space-between 的影响（否则三项会被当成第三栏、备案号跑到中间去）。 */
.site-footer { position: relative; z-index: 1; margin-top: 40px; padding: 34px 32px 40px; border-top: 1px solid rgba(150,190,240,.10); display: flex; flex-direction: column; gap: 20px; backdrop-filter: blur(16px); background: rgba(12,22,44,.32); }
.foot-top { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.foot-brand { display: flex; align-items: center; gap: 8px; font-weight: 700; color: var(--ink); letter-spacing: .5px; }
.foot-mark { color: var(--accent); }
/* 版权与备案号那一行：通栏居中，只在有内容时才渲染（三样都空时页脚与改动前完全一样）。
   ⚠️ justify-content: center 是这一行刻意与上面那行不同的地方 ——
      备案信息是一条独立的合规声明，按国内站点惯例放在最底部居中，
      而不是跟着品牌名靠左（那样看起来像品牌的一部分）。 */
.foot-meta { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 6px 16px; color: var(--muted); font-size: 12px; }
.foot-icp { color: var(--muted); text-decoration: none; transition: color .2s ease; }
.foot-icp:hover { color: var(--accent); }
/* 公安备案那一项：图标 + 备案号，两者是一个整体（间隔用 gap 5px，比上面那 16px 紧得多）。
   【为什么图标要 display: block + height 固定】img 默认是 inline，会跟着基线留出下方空隙，
   和文字并排时那一行会被撑高；给它固定高度（宽度 auto）既没有空隙，
   也保证 36×40 的原图按比例缩到 20px 高，不会被拉变形。 */
.foot-police { display: inline-flex; align-items: center; gap: 5px; color: var(--muted); text-decoration: none; transition: color .2s ease; }
.foot-police:hover { color: var(--accent); }
.foot-police-icon { display: block; height: 20px; width: auto; }
.music-toggle { display: inline-flex; align-items: center; gap: 8px; height: 40px; padding: 0 16px; border-radius: 999px; background: rgba(255,255,255,.06); border: 1px solid rgba(150,190,240,.16); color: var(--muted); cursor: pointer; backdrop-filter: blur(12px); transition: border-color .2s ease, color .2s ease, transform .2s ease; }
.music-toggle:hover { border-color: var(--accent); color: var(--ink); transform: translateY(-1px); }
.music-toggle.on { border-color: var(--accent); color: var(--accent); }
.music-toggle.on .glyph { animation: spin 4s linear infinite; }
.music-toggle .glyph { font-style: normal; font-size: 16px; }
.music-toggle .music-label { font-size: 13px; }
@keyframes spin { to { transform: rotate(360deg); } }

/* ===== ⚙ 站点设置抽屉 =====
   【为什么选择器要写成 `.el-drawer.settings-drawer`（两个类一起）】
   Element Plus 自己的 `.el-drawer` 也定了一份背景色，和我们这条一样都是"一个类"的选择器，
   优先级相同 —— 谁赢只看打包之后谁在后面，而那个顺序不受我们控制（今天对、明天可能就反了）。
   多写一个类把优先级抬上去，就与顺序无关了。下面 .set-* 那几条同理：
   带上 `.settings-drawer` 前缀既抬了优先级，也把作用范围限制在面板内部。 */
.el-drawer.settings-drawer { background: rgba(10,18,36,.72); backdrop-filter: blur(26px) saturate(150%); -webkit-backdrop-filter: blur(26px) saturate(150%); border-left: 1px solid rgba(150,190,240,.14); box-shadow: -24px 0 70px rgba(0,0,0,.5); }
.settings-drawer .el-drawer__header { margin-bottom: 0; padding: 18px 22px; color: var(--ink); font-size: 16px; font-weight: 700; letter-spacing: 1px; border-bottom: 1px solid var(--line); }
.settings-drawer .el-drawer__close-btn { color: var(--muted); }
.settings-drawer .el-drawer__close-btn:hover { color: var(--accent); }
.settings-drawer .el-drawer__body { padding: 18px 22px 26px; }
.set-sub { margin: 0 0 16px; color: var(--muted); font-size: 13px; line-height: 1.7; }
/* 每一行是一张"卡片"：玻璃底来自全局 .glass，这里只补圆角与内边距。
   两行之间用虚线分隔，而不是给每行各套一个方框 —— 那会在面板里叠出一堆框，
   看起来比背景还乱。 */
.set-card { border-radius: 16px; padding: 4px 14px; }
.set-row { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 14px 0; }
.set-row + .set-row { border-top: 1px dashed rgba(150,190,240,.16); }
.set-info { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.set-name { font-size: 14px; font-weight: 600; color: var(--ink); }
.set-desc { font-size: 12px; line-height: 1.6; color: var(--muted); }
/* 开关的配色跟上本站的调子：Element Plus 默认是蓝色，和我们这套深蓝金完全不搭。
   关闭态也要给个亮一点的颜色 —— 默认的 rgba(0,0,0,.25) 在这个深色底上几乎看不见。 */
.settings-drawer .el-switch__core { background-color: rgba(255,255,255,.16); border-color: rgba(150,190,240,.24); }
.settings-drawer .el-switch.is-checked .el-switch__core { background-color: var(--accent); border-color: var(--accent); }
.settings-drawer .el-switch.is-checked .el-switch__action { background-color: #0a1224; }
@media (prefers-reduced-transparency: reduce) { .el-drawer.settings-drawer { background: var(--surface); } }

.auth-modal { border-radius: 20px; overflow: hidden; background: rgba(10,18,36,.55); backdrop-filter: blur(26px) saturate(150%); -webkit-backdrop-filter: blur(26px) saturate(150%); border: 1px solid rgba(150,190,240,.14); box-shadow: 0 26px 90px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.08); }
.auth-modal .el-dialog__header { display: none; }
.auth-modal .el-dialog__body { padding: 0; background: transparent; }
.auth-card { padding: 36px 36px 30px; color: var(--ink); }
.brand-line { font-size: 13px; font-weight: 700; color: var(--accent); letter-spacing: 2px; margin-bottom: 18px; }
.auth-title { margin: 0 0 6px; font-size: 26px; font-weight: 800; letter-spacing: 0; }
.auth-sub { margin: 0 0 26px; color: var(--muted); font-size: 14px; }
.auth-form .el-form-item { margin-bottom: 18px; }
.auth-form .el-form-item__label { color: var(--muted); font-weight: 600; padding-bottom: 6px; }
.auth-form .el-input__wrapper { background: #0d1b38 !important; box-shadow: none !important; border: 1px solid var(--line) !important; border-radius: 0; }
.auth-form .el-input__wrapper.is-focus { box-shadow: none !important; border-color: var(--cyan) !important; }
.auth-form .el-input__inner { color: var(--ink) !important; }
.auth-form .el-input__inner::placeholder { color: var(--muted) !important; }
.auth-form .el-input__inner:-webkit-autofill, .auth-form .el-input__inner:-webkit-autofill:hover, .auth-form .el-input__inner:-webkit-autofill:focus { -webkit-box-shadow: 0 0 0 1000px #0d1b38 inset !important; -webkit-text-fill-color: var(--ink) !important; caret-color: var(--ink); transition: background-color 9999s ease-out 0s; }
.auth-row { display: flex; align-items: center; justify-content: space-between; margin: 4px 0 22px; color: var(--muted); }
.auth-row.center { justify-content: center; }
.auth-row .el-checkbox__label { color: var(--muted); }
.auth-submit { width: 100%; height: 48px; border-radius: 12px; font-weight: 700; font-size: 16px; }

.el-button { transition: transform .18s ease, box-shadow .18s ease, opacity .18s ease; }
.el-button:not(.is-text):not(.is-link):hover { transform: translateY(-1px) scale(1.02); }
.el-button:not(.is-text):not(.is-link):active { transform: translateY(0) scale(.97); }
@keyframes navIn { from { opacity: 0; transform: translateY(-14px); } to { opacity: 1; transform: none; } }
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes dialogIn { from { opacity: 0; transform: translateY(18px) scale(.96); } to { opacity: 1; transform: none; } }
.site-nav { animation: navIn .5s cubic-bezier(.16,.84,.28,1) both; }
.page { animation: fadeIn .5s ease both; position: relative; z-index: 1; }
.auth-modal { animation: dialogIn .38s cubic-bezier(.16,.84,.28,1); }
@media (prefers-reduced-transparency: reduce) { .auth-modal, .auth-form .el-input__wrapper { background: var(--surface); } }
@media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }

/* Shared voxel theme: the cookie selects a palette on <html> during SSR. */
html { scroll-padding-top: 76px; }
body { background: var(--bg); color: var(--ink); }
html, body, .shell { cursor: auto; }
button:not(:disabled), a, [role="button"], input[type="button"], input[type="submit"] { cursor: pointer; }
input, textarea, select { cursor: text; }
button:disabled, input:disabled, textarea:disabled, select:disabled { cursor: not-allowed; }
::selection { color: var(--on-accent); background: var(--accent); }
.bg-overlay {
  background:
    linear-gradient(180deg, var(--world-wash), var(--world-wash-bottom)),
    linear-gradient(to right, var(--grid-ink) 1px, transparent 1px),
    linear-gradient(to bottom, var(--grid-ink) 1px, transparent 1px);
  background-size: auto, 16px 16px, 16px 16px;
}
.bg-poster { opacity: .96; image-rendering: auto; }
.bg-poster.is-day {
  opacity: 1;
  image-rendering: auto;
  filter: none;
}
.bg-overlay { z-index: -7; background-blend-mode: multiply, normal, normal; }
.site-nav {
  background: var(--nav-surface) !important;
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
  border-bottom: 3px solid var(--grass) !important;
  box-shadow: 0 4px 0 var(--pixel-shadow) !important;
}
.site-nav::after {
  height: 4px;
  background: repeating-linear-gradient(90deg, #66894a 0 40px, #83a953 40px 56px, #d5b24d 56px 64px, #66894a 64px 104px);
  animation: none;
}
.brand-mark {
  border: 2px solid var(--accent-strong);
  border-radius: 0 !important;
  background: transparent !important;
  color: var(--ink);
  box-shadow: none !important;
  animation: none;
}
.brand-mark img { width: 34px; height: 30px; object-fit: contain; image-rendering: pixelated; display: block; }
.brand-name {
  background: none !important;
  -webkit-background-clip: border-box !important;
  color: var(--ink) !important;
  -webkit-text-fill-color: var(--ink);
  font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
}
.nav-center .nv.router-link-active,
.nav-center .nv.router-link-exact-active {
  color: var(--ink);
  background: var(--surface-2);
  box-shadow: inset 0 -3px 0 var(--accent);
}
.nav-center .nv:hover, .nm-item:hover, .nm-sub:hover { background: var(--surface-2) !important; }
.icon-btn { width: 44px; height: 44px; border-radius: 0 !important; }
.nav-admin {
  border: 2px solid var(--accent-strong);
  border-radius: 0 !important;
  background: var(--accent) !important;
  color: var(--on-accent) !important;
  box-shadow: 3px 3px 0 var(--pixel-shadow);
}
.nav-admin { gap: 7px; min-height: 40px; padding-inline: 10px; }
.pixel-ui-icon { width: 22px; height: 22px; display: inline-block; background: url('/assets/pixel-ui-icon-atlas.png') 50% 50% / 300% 300% no-repeat; image-rendering: pixelated; }
.icon-workbench { background-position: 50% 50%; }
.uc-avatar { width: 34px; height: 34px; border-radius: 0 !important; overflow: hidden; border: 2px solid var(--accent); background: var(--surface-2); box-shadow: 2px 2px 0 var(--pixel-shadow); }
.uc-avatar img { width: 100%; height: 100%; object-fit: cover; image-rendering: pixelated; }
.foot-mark { width: 22px; height: 22px; object-fit: contain; image-rendering: pixelated; vertical-align: middle; }
.brand-line { display: inline-flex; align-items: center; gap: 8px; }
.brand-line img { width: 26px; height: 24px; object-fit: contain; image-rendering: pixelated; }
.nav-ghost { background: var(--surface-2) !important; }
.theme-glyph { position: relative; display: block; width: 24px; height: 24px; margin: auto; image-rendering: pixelated; }
.theme-glyph::before,
.theme-glyph::after { content: ''; position: absolute; display: block; background: var(--accent); }
.theme-glyph.is-day::before {
  width: 8px; height: 8px; left: 8px; top: 8px;
  box-shadow:
    0 -8px 0 -2px var(--accent),
    0 8px 0 -2px var(--accent),
    -8px 0 0 -2px var(--accent),
    8px 0 0 -2px var(--accent),
    -6px -6px 0 -2px var(--accent),
    6px -6px 0 -2px var(--accent),
    -6px 6px 0 -2px var(--accent),
    6px 6px 0 -2px var(--accent);
  animation: dayGlyphPulse 2.8s steps(2, end) infinite;
}
.theme-glyph.is-day::after {
  display: block;
  width: 4px; height: 4px; left: 10px; top: 10px;
  background: var(--accent-strong);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 55%, transparent);
  animation: dayGlyphCore 2.8s steps(2, end) infinite;
}
.theme-glyph.is-night::before {
  width: 16px; height: 16px; left: 3px; top: 3px;
  clip-path: polygon(0 0, 75% 0, 75% 12.5%, 50% 12.5%, 50% 25%, 37.5% 25%, 37.5% 75%, 50% 75%, 50% 87.5%, 75% 87.5%, 75% 100%, 0 100%);
  animation: nightGlyphFloat 3.6s steps(2, end) infinite;
}
.theme-glyph.is-night::after { width: 4px; height: 4px; left: 11px; top: 3px; background: var(--nav-surface); animation: nightGlyphTwinkle 3.6s steps(2, end) infinite; }
@keyframes dayGlyphPulse {
  0%, 100% { transform: rotate(0deg) scale(1); filter: drop-shadow(0 0 0 transparent); }
  50% { transform: rotate(45deg) scale(1.08); filter: drop-shadow(0 0 4px rgba(242,193,78,.8)); }
}
@keyframes dayGlyphCore {
  0%, 100% { opacity: .72; }
  50% { opacity: 1; }
}
@keyframes nightGlyphFloat {
  0%, 100% { transform: translate(0, 0); filter: drop-shadow(0 0 0 transparent); }
  50% { transform: translate(-1px, 1px); filter: drop-shadow(0 0 4px rgba(135,206,235,.75)); }
}
@keyframes nightGlyphTwinkle { 0%, 100% { opacity: .55; } 50% { opacity: 1; } }
body .shell .glass {
  background: var(--panel) !important;
  -webkit-backdrop-filter: none !important;
  backdrop-filter: none !important;
  border: 2px solid var(--line) !important;
  border-radius: 0 !important;
  box-shadow: 4px 4px 0 var(--pixel-shadow), inset 2px 2px 0 rgba(241,245,223,.035) !important;
}
.shell .site-footer {
  border-top: 3px solid var(--grass);
  background: var(--nav-surface);
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
}
.music-toggle { border-radius: 0 !important; }
body .shell :is(button, .el-button, [role="button"], .el-input__wrapper, .el-select__wrapper, .el-textarea__inner, .el-tag) {
  border-radius: 0 !important;
}
body .shell :is(.el-input__wrapper, .el-select__wrapper, .el-textarea__inner) {
  background: var(--surface) !important;
  box-shadow: inset 0 0 0 2px var(--line) !important;
}
body .shell :is(.el-input__wrapper.is-focus, .el-select__wrapper.is-focused, .el-textarea__inner:focus) {
  box-shadow: inset 0 0 0 2px var(--cyan) !important;
}
body .shell :is(input, textarea, select) { font-size: 16px !important; }
body .shell .el-button--primary {
  --el-button-bg-color: var(--accent);
  --el-button-border-color: var(--accent);
  --el-button-hover-bg-color: var(--accent-strong);
  --el-button-hover-border-color: var(--accent-strong);
  --el-button-text-color: var(--on-accent);
  --el-button-hover-text-color: var(--on-accent);
  box-shadow: 3px 3px 0 var(--pixel-shadow);
}
body .shell .el-button--primary:hover { transform: translate(1px, 1px); box-shadow: 2px 2px 0 var(--pixel-shadow); }
body .shell .nav-btn { min-height: 40px; }
.home .profile, .home .music { border-top: 4px solid var(--grass) !important; }
.home .pf-name, .home .w-head h2, .home .mu-title, .shell :is(h1, h2, h3) {
  font-family: ui-monospace, "Cascadia Code", Consolas, "Microsoft YaHei", monospace;
  font-variant-numeric: tabular-nums;
  text-wrap: balance;
}
.home .pf-avatar, .home .pf-avatar img, .home .mascot,
.home .mu-disc, .home .mu-disc-img, .home .mu-disc-ph, .home .mu-disc-hole {
  border-radius: 0 !important;
}
.home .pf-avatar, .home .mascot { box-shadow: 4px 4px 0 var(--pixel-shadow); }
.home .pf-avatar img, .home .mascot img, .home .af-cover img { image-rendering: pixelated; }
.home .mu-disc {
  background: var(--surface-2) !important;
  border: 3px solid var(--accent);
  box-shadow: 3px 3px 0 var(--pixel-shadow), inset 2px 2px 0 rgba(241,245,223,.08);
}
.home .mu-disc-hole { border: 2px solid var(--accent); }
.home .cat, .home .tagp, .home .more-btn, .home .notice,
.home .announce, .home .af-tags .tg, .home .dock, .home .wpanel {
  border-radius: 0 !important;
}
.home .cat, .home .tagp, .home .more-btn, .home .di { box-shadow: 2px 2px 0 var(--pixel-shadow); }
.home .cat.on, .home .tagp.on, .home .mu-ctl .play, .home .mu-bar {
  background: var(--accent) !important;
  color: var(--on-accent) !important;
}
.home .af {
  background: var(--surface-2) !important;
  border: 2px solid var(--line) !important;
  border-radius: 0 !important;
  box-shadow: 4px 4px 0 var(--pixel-shadow) !important;
}
.home .af:hover { transform: translate(2px, 2px); box-shadow: 2px 2px 0 var(--pixel-shadow) !important; }
.home .af-cover { border-bottom: 2px solid var(--line); }
.home .af-tag { border-radius: 0 !important; }
.home .af-meta { font-variant-numeric: tabular-nums; }
body :is(.el-dialog, .el-message-box, .el-dropdown-menu, .el-popper, .el-message) { border-radius: 0 !important; }
body .auth-modal {
  background: var(--panel) !important;
  border: 2px solid var(--line) !important;
  box-shadow: 6px 6px 0 var(--pixel-shadow) !important;
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
}
body .auth-form .el-input__wrapper {
  border: 1px solid var(--line) !important;
  box-shadow: none !important;
}
body .auth-form .el-input__wrapper.is-focus {
  border-color: var(--accent-strong) !important;
  box-shadow: none !important;
}
body .shell :focus-visible:not(.el-input__wrapper):not(.el-input__inner) { outline: 3px solid var(--accent-strong); outline-offset: 3px; }
body .auth-form .el-input__wrapper:focus,
body .auth-form .el-input__wrapper:focus-visible,
body .auth-form .el-input__inner:focus,
body .auth-form .el-input__inner:focus-visible { outline: none !important; }
.shell :is(.icon-btn, .nav-mobile .nm-item, .nav-mobile .nm-sub) { min-height: 44px; }
@media (max-width: 900px) { .home .waterfall { columns: 2; } }
@media (max-width: 820px) {
  .home .waterfall { columns: 1; }
  .shell .site-footer { padding: 26px 20px 30px; }
}
@media (max-width: 640px) {
  .shell .site-nav { min-height: 60px; height: auto; padding: 8px 12px; gap: 6px; }
  .shell .brand { min-width: 0; gap: 7px; }
  .shell .brand-name { max-width: 118px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; }
  .shell .nav-right { gap: 4px; }
  .shell .nav-right .el-button { min-height: 38px; padding-inline: 9px; }
  .shell .user-chip { padding-right: 4px; }
  .shell .uc-role { display: none; }
  .home .search-wrap { padding: 24px 16px 8px; }
  .home .toprow { padding: 16px; gap: 14px; }
  .home .waterfall-wrap { padding: 12px 16px 32px; }
  .home .pf-stats { justify-content: space-between; gap: 12px; }
  .home .pf-stats .st b { font-size: 21px; }
  .home .w-head h2 { font-size: 20px; }
}
@media (max-width: 380px) { .shell .brand-name { max-width: 88px; } }
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }

/* Final shell geometry mirrors project-layout-demo. */
.shell .site-nav {
  min-height: 66px;
  height: auto;
  padding: 10px clamp(16px, 4vw, 48px) 16px;
  gap: 26px;
  background: var(--nav-surface) !important;
  border: 0 !important;
  box-shadow: 0 6px 0 #5d432d, 0 10px 0 var(--grass) !important;
}
.shell .site-nav::after {
  display: none;
}
.shell .brand {
  gap: 10px;
}
.shell .brand-mark {
  width: 42px;
  height: 42px;
  flex: 0 0 42px;
  border: 2px solid var(--accent-strong) !important;
  background: transparent !important;
  box-shadow: none !important;
}
.shell .brand-mark img {
  width: 36px;
  height: 30px;
}
.shell .brand-name {
  font-size: 16px;
}
.shell .nav-center {
  justify-content: flex-end;
  gap: 4px;
}
.shell .nav-center .nv {
  min-height: 42px;
  padding: 8px 12px;
  border: 2px solid transparent;
  border-radius: 0 !important;
  background: transparent;
}
.shell .nav-center .nv:hover,
.shell .nav-center .nv.router-link-active,
.shell .nav-center .nv.router-link-exact-active {
  color: var(--ink);
  background: var(--surface-2);
  border-color: var(--line);
  box-shadow: none;
}
.shell .nav-right {
  gap: 8px;
}
.shell .nav-right .icon-btn {
  width: 42px;
  height: 42px;
  border: 2px solid transparent;
}
.shell .nav-right .nav-btn,
.shell .nav-right .nav-admin {
  min-height: 42px;
  border: 2px solid var(--pixel-shadow);
  border-radius: 0 !important;
  box-shadow: 3px 3px 0 var(--pixel-shadow);
}
.shell .nav-right .nav-admin {
  padding: 8px 12px;
}
.shell .dd-menu {
  margin-top: 0;
  padding: 6px;
  border: 2px solid var(--line);
  border-radius: 0;
  background: var(--panel);
  box-shadow: 4px 4px 0 var(--pixel-shadow);
}
.shell .dd-menu a {
  border-radius: 0;
}
.shell .site-footer {
  padding-top: 24px;
  border-top: 0;
  box-shadow: inset 0 3px 0 var(--grass);
}
@media (max-width: 1000px) {
  .shell .site-nav { gap: 10px; }
  .shell .nav-center { display: none; }
}
@media (max-width: 640px) {
  .shell .site-nav {
    min-height: 60px;
    padding: 8px 12px 14px;
  }
  .shell .brand-mark { width: 38px; height: 38px; flex-basis: 38px; }
  .shell .brand-mark img { width: 32px; height: 27px; }
}

/* Final voxel pass: keep every shared shell surface on the demo palette. */
:root {
  --bg: #0d1727;
  --surface: rgba(14,31,53,.76);
  --surface-2: rgba(39,72,102,.78);
  --ink: #f3f4dc;
  --muted: #9eb1c5;
  --line: rgba(174,208,235,.22);
  --accent: #f3c65e;
  --accent-strong: #ffd979;
  --cyan: #68d2d2;
  --grass: #6e9b48;
  --pixel-shadow: #08101d;
  --panel: rgba(14,31,53,.94);
  --nav-surface: #0b192c;
  --world-wash: rgba(8,15,29,.24);
  --world-wash-bottom: rgba(8,15,29,.72);
  --on-accent: #08101d;
}
:root[data-theme="day"] {
  --bg: #dce6d3;
  --surface: rgba(243,241,218,.94);
  --surface-2: rgba(227,232,201,.96);
  --ink: #24372a;
  --muted: #4d624b;
  --line: rgba(53,79,49,.38);
  --accent: #9a6417;
  --accent-strong: #b17a22;
  --cyan: #287f7b;
  --grass: #6f9c49;
  --pixel-shadow: #8c9b7b;
  --panel: rgba(243,241,218,.98);
  --nav-surface: #edf1dc;
  --world-wash: rgba(232,240,219,.22);
  --world-wash-bottom: rgba(219,229,205,.68);
  --on-accent: #08101d;
}

html, body { background: var(--bg); color: var(--ink); }
body { font-family: "Microsoft YaHei", "PingFang SC", sans-serif; line-height: 1.55; }
.shell { background: transparent; }

/* 背景图保持原始清晰度，主题只通过图片和面板配色区分。 */
.shell .bg-overlay {
  background: transparent !important;
  background-image: none !important;
  mix-blend-mode: normal;
  opacity: 1;
}

/* Navigation */
.shell .site-nav {
  min-height: 66px;
  height: auto;
  padding: 10px clamp(16px, 4vw, 48px) 16px;
  gap: 26px;
  background: var(--nav-surface) !important;
  border-bottom: 0 !important;
  box-shadow: 0 6px 0 #5d432d, 0 10px 0 var(--grass) !important;
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
}
.shell .site-nav::after {
  height: 0;
  background: none;
  animation: none;
}
.shell .brand { gap: 12px; }
.shell .brand-mark {
  width: 42px;
  height: 42px;
  border: 2px solid var(--accent);
  border-radius: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
}
.shell .brand-name {
  font-family: ui-monospace, Consolas, monospace;
  font-size: 16px;
  font-weight: 900;
  letter-spacing: .04em;
  color: var(--ink) !important;
  -webkit-text-fill-color: var(--ink);
}
.shell .nav-center { gap: 4px; }
.shell .nv,
.shell .nv-btn {
  min-height: 42px;
  padding: 8px 12px;
  border-radius: 0 !important;
  color: var(--muted);
  background: transparent;
}
.shell .nv,
.shell .nv-btn,
.shell .dd-menu a,
.shell .nm-item,
.shell .nm-sub {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}
.shell .nv,
.shell .dd { position: relative; }
.shell [data-tip]::after {
  content: attr(data-tip);
  position: absolute;
  left: 50%;
  bottom: -8px;
  z-index: 100;
  padding: 5px 8px;
  color: var(--ink);
  background: var(--surface);
  border: 2px solid var(--accent);
  box-shadow: 3px 3px 0 var(--pixel-shadow);
  font: 12px/1.2 "Microsoft YaHei", sans-serif;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transform: translate(-50%, 100%) scale(.94);
  transition: opacity .16s ease, transform .16s ease;
}
.shell [data-tip]:hover::after,
.shell [data-tip]:focus-visible::after {
  opacity: 1;
  transform: translate(-50%, 100%) scale(1);
}
.shell .pixel-ui-icon {
  width: 22px;
  height: 22px;
  flex: 0 0 22px;
  background-image: url('/assets/pixel-ui-icon-atlas.png');
  background-size: 300% 300%;
  background-repeat: no-repeat;
  image-rendering: pixelated;
}
.shell .icon-home { background-position: 0 0; }
.shell .icon-article,
.shell .icon-archive { background-position: 50% 0; }
.shell .icon-project { background-position: 100% 0; }
.shell .icon-about { background-position: 0 50%; }
.shell .icon-workbench { background-position: 50% 50%; }
.shell .icon-music { background-position: 100% 50%; }
.shell .icon-favorite { background-position: 0 100%; }
.shell .icon-links { background-position: 50% 100%; }
.shell .nv .pixel-ui-icon { opacity: .9; }
.shell .nv:hover .pixel-ui-icon,
.shell .nv.router-link-active .pixel-ui-icon,
.shell .nm-item:hover .pixel-ui-icon { filter: brightness(1.25) saturate(1.15); }
.shell .nv:hover,
.shell .nv-btn:hover,
.shell .nav-center .nv.router-link-active,
.shell .nav-center .nv.router-link-exact-active {
  color: var(--ink);
  background: var(--surface-2) !important;
  border-color: var(--line);
}
.shell .dd-menu {
  margin-top: 2px;
  padding: 6px;
  min-width: 144px;
  border: 2px solid var(--line);
  border-radius: 0 !important;
  background: var(--surface) !important;
  box-shadow: 4px 4px 0 var(--pixel-shadow);
}
.shell .dd-menu a {
  padding: 10px 12px;
  border-radius: 0 !important;
  color: var(--muted);
}
.shell .dd-menu a:hover { color: var(--ink); background: var(--surface-2); }
.shell .icon-btn {
  width: 42px;
  height: 42px;
  border: 2px solid transparent;
  border-radius: 0 !important;
  color: var(--muted);
}
.shell .icon-btn:hover { color: var(--ink); background: var(--surface-2); border-color: var(--line); }
.shell .user-chip {
  height: 42px;
  padding: 0 10px 0 4px;
  border: 2px solid var(--line);
  border-radius: 0 !important;
  background: var(--surface) !important;
}
.shell .uc-role { border-radius: 0 !important; background: var(--surface-2); }
.shell .nav-admin,
.shell .nav-btn {
  min-height: 42px;
  border-radius: 0 !important;
  box-shadow: 4px 4px 0 var(--pixel-shadow);
}
.shell .nav-admin { border: 2px solid var(--pixel-shadow); }
.shell .nav-admin:hover { transform: translate(2px, 2px); box-shadow: 2px 2px 0 var(--pixel-shadow); }
.shell .nav-ghost { background: var(--surface-2) !important; border: 2px solid var(--line); backdrop-filter: none; }

/* Shared surfaces, footer and mobile navigation */
body .shell .glass,
body .shell .wpanel,
body .shell .dock {
  background: var(--surface) !important;
  border: 2px solid var(--line) !important;
  border-radius: 0 !important;
  box-shadow: 6px 6px 0 var(--pixel-shadow) !important;
  -webkit-backdrop-filter: none !important;
  backdrop-filter: none !important;
}
.shell .nav-mobile {
  top: 68px;
  max-height: calc(100vh - 68px);
  padding: 10px 14px 16px;
  border: 2px solid var(--line) !important;
  border-top: 0 !important;
  border-radius: 0 !important;
  box-shadow: 6px 6px 0 var(--pixel-shadow);
}
.shell .nm-item, .shell .nm-sub { border-radius: 0 !important; }
.shell .site-footer {
  margin-top: 40px;
  padding: 26px 0 44px;
  border-top: 3px solid var(--grass);
  background: var(--bg);
  backdrop-filter: none;
  box-shadow: 0 -4px 0 var(--pixel-shadow);
}
.shell .foot-top { width: min(1180px, calc(100% - 36px)); margin: 0 auto; }
.shell .foot-meta { width: min(1180px, calc(100% - 36px)); margin: 0 auto; }
.shell .music-toggle {
  min-height: 42px;
  height: auto;
  padding: 8px 12px;
  border: 2px solid var(--line);
  border-radius: 0 !important;
  background: var(--surface-2);
  backdrop-filter: none;
  box-shadow: 4px 4px 0 var(--pixel-shadow);
}
.shell .music-toggle:hover { transform: translate(2px, 2px); box-shadow: 2px 2px 0 var(--pixel-shadow); }

/* Element Plus overlays and controls */
body .el-drawer.settings-drawer,
body .auth-modal {
  background: var(--surface) !important;
  border: 2px solid var(--line) !important;
  border-radius: 0 !important;
  box-shadow: 6px 6px 0 var(--pixel-shadow) !important;
  -webkit-backdrop-filter: none !important;
  backdrop-filter: none !important;
}
body .settings-drawer .el-drawer__header { padding: 18px 22px; border-bottom: 2px solid var(--line); }
body .settings-drawer .set-card { padding: 4px 14px; border-radius: 0 !important; }
body .settings-drawer .set-row + .set-row { border-top: 2px dashed var(--line); }
body .auth-card { padding: 32px; }
body .auth-form .el-input__wrapper,
body .auth-form .el-select__wrapper,
body .auth-form .el-textarea__inner {
  background: var(--surface-2) !important;
  border-radius: 0 !important;
  border: 2px solid var(--line) !important;
  box-shadow: none !important;
}
body .auth-form .el-input__wrapper.is-focus {
  border-color: var(--accent) !important;
  box-shadow: none !important;
}
body .auth-submit { border-radius: 0 !important; box-shadow: 4px 4px 0 var(--pixel-shadow); }
body .el-popper,
body .el-dropdown-menu,
body .el-message,
body .el-message-box,
body .el-dialog { border-radius: 0 !important; }
body .shell :is(.el-button, .el-input__wrapper, .el-select__wrapper, .el-textarea__inner, .el-tag, .el-checkbox__inner) { border-radius: 0 !important; }
body .shell :is(.el-button, .el-input__wrapper, .el-select__wrapper, .el-textarea__inner) { box-shadow: 4px 4px 0 var(--pixel-shadow); }
body .shell .el-button--primary { border: 2px solid var(--pixel-shadow); }
body .shell .el-button--primary:hover { transform: translate(2px, 2px); box-shadow: 2px 2px 0 var(--pixel-shadow); }

@media (max-width: 640px) {
  .shell .site-nav { min-height: 60px; padding: 8px 12px; }
  .shell .nav-mobile { top: 60px; max-height: calc(100vh - 60px); }
  .shell .foot-top, .shell .foot-meta { width: min(100% - 36px, 1180px); }
}

/* Demo alignment */
:root[data-theme="day"] .shell .site-nav {
  background: #edf1dc !important;
  box-shadow: 0 6px 0 #8c6a42, 0 10px 0 #6f9c49 !important;
}
.shell .bg-overlay {
  z-index: -1;
  background: linear-gradient(180deg, var(--world-wash), var(--world-wash-bottom) 62%, var(--world-wash-bottom));
  background-blend-mode: normal;
}
:root[data-theme="day"] .shell .bg-overlay { background: transparent; }
.shell[data-theme="day"] .bg-overlay { display: none !important; }
.shell[data-theme="night"] .bg-overlay { display: none !important; }
.shell[data-theme="day"] .page,
.shell[data-theme="day"] .site-nav,
.shell[data-theme="day"] .site-footer { opacity: 1 !important; filter: none !important; }
.shell[data-theme="day"] {
  opacity: 1 !important;
  filter: none !important;
  background: transparent !important;
  background-image: none !important;
  mix-blend-mode: normal !important;
}
.shell .page {
  width: 100%;
  min-height: 0;
}
.shell .site-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: auto;
  padding: 24px clamp(16px, 4vw, 48px) 38px;
  color: var(--muted);
  border-top: 1px solid var(--line);
  background: var(--nav-surface) !important;
  font-size: 13px;
}
.shell .site-footer { border-top: 3px solid var(--grass); box-shadow: 0 -4px 0 var(--pixel-shadow); }
.shell[data-theme="night"] .site-footer { border-top-color: var(--accent); }

/* 日间场景保持清晰，文字区域使用浅色实面板承托。 */
.shell[data-theme="day"] .home .w-head,
.shell[data-theme="day"] :is(.ar-head, .pj-head, .fv-head, .lk-head, .ab-head, .mp-head, .list-heading) {
  padding: 14px 16px;
  border: 2px solid var(--line);
  background: var(--surface);
  box-shadow: 4px 4px 0 var(--pixel-shadow);
}
.shell[data-theme="day"] .home .w-head { margin-top: 8px; }
.shell[data-theme="day"] :is(.w-head h2, .ar-head h1, .pj-head h1, .fv-head h1, .lk-head h1, .ab-head h1, .mp-h1, .list-heading h2) {
  color: var(--ink);
  text-shadow: none;
}
.shell[data-theme="day"] .home .w-intro,
.shell[data-theme="day"] :is(.ar-sub, .pj-sub, .fv-sub, .lk-sub, .ab-sub, .hero-copy) {
  color: var(--muted);
}
.shell[data-theme="day"] .art-page .doc-head {
  padding: 18px;
  border: 2px solid var(--line);
  background: var(--surface);
  box-shadow: 4px 4px 0 var(--pixel-shadow);
}
@media (max-width: 560px) {
  .shell .site-footer { align-items: flex-start; flex-direction: column; padding-bottom: 92px; }
}
</style>
