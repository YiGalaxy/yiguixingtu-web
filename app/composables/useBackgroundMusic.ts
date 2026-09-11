// ============================================================
// app/composables/useBackgroundMusic.ts
//
// 作用：**背景音乐的唯一一份状态** —— 页脚的开关、⚙ 设置面板里的开关、
//       首页那张音乐卡片，用的都是这里这一份。
//
// 【为什么必须做成共享状态，而不是各自一个 ref】
//   它们散在组件树的三个地方：页脚与设置面板在 `app.vue`（外壳），
//   音乐卡片在首页页面（`pages/index.vue`，是外壳里 `<NuxtPage/>` 渲染出来的子页面）。
//   父子关系传不过去（页面不是页脚的子组件），所以只能靠共享状态。
//   两处各写一份 `ref` 一定会打架，最典型的症状是：
//   **页脚显示"播放背景音乐"、卡片上的按钮却显示成暂停图标**（或者反过来）——
//   用户看到的就是"点了没反应"。用例里专门有一条把这两个 UI 绑在一起断言。
//
// 【为什么用 useState 而不是模块级的 ref】
//   项目里共享状态的既有写法就是 `useState`（见 `useAuthUi`）：
//   同一个 key 全局共享一份，而且是 SSR 安全的（跨请求不会互相污染，
//   模块级的 ref 在服务端渲染时是所有请求共用的，那是个很难查的坑）。
//   SSR 期间这里读不到 localStorage，所以偏好只能在客户端读 —— 见 `loadPreference`。
//
// 【为什么播放器元素不放在这里】`<audio>` 元素是 DOM，不能塞进 `useState`
//   （Nuxt 会尝试把它序列化进 payload）。所以这一份状态只管**意图与展示**：
//   · `enabled`    —— 用户想不想听（持久化在 localStorage）
//   · `playing`    —— 现在是不是真的在播
//   · `progress`   —— 播放进度（0~100，给进度条用）
//   · `trackIndex` —— 现在放的是第几首（曲目表下标，见 app/utils/musicTracks.ts，2026-09-11 加）
//   真正持有 `<audio>` 的那个组件（现在**只有**应用外壳 app.vue 一处）负责
//   "照着 `enabled` 去 play/pause、照着 `trackIndex` 换音源"，
//   并把真实状态写回 `playing` / `progress`。
//   【为什么播放器只能有一处】页面会随路由卸载，播放器放页面里就"一离开音乐就断"；
//   两个页面各放一个则会出现两个实例抢同一首歌、互相覆盖 `playing` / `progress`。
// ============================================================

/** localStorage 的 key。改名等于把老用户的偏好丢掉，所以名字定死 */
const STORAGE_KEY = 'bg-music-enabled'

export const useBackgroundMusic = () => {
  /**
   * 用户的意图：要不要听背景音乐。**持久化** —— 下次打开站点还照这个来。
   * 【和 `playing` 的区别】`enabled` 是"想听"，`playing` 是"真的在响"：
   *   浏览器有自动播放限制（没有用户手势时 `play()` 会被拒绝），
   *   所以完全可能出现"想听但没响"。把这两件事合成一个变量的话，
   *   用户点了开关、图标亮了、可什么声音都没有，而界面却理直气壮地说在播。
   */
  const enabled = useState('bgMusicEnabled', () => false)
  /** 现在是不是真的在播（由持有播放器的组件按真实事件写回） */
  const playing = useState('bgMusicPlaying', () => false)
  /** 播放进度百分比（0~100），给进度条用 */
  const progress = useState('bgMusicProgress', () => 0)

  /**
   * 当前是第几首（曲目列表里的下标；列表来自 `GET /music/list`，见 useMusicTracks）。
   *
   * 【为什么这份状态放在这里，而不是另开一个组合式函数】
   *   它和 `enabled` / `playing` / `progress` 是同一种东西：**全站只有一个 `<audio>`，
   *   所以"现在放的是哪一首"这个事实也只能有一份**。
   *   壳里的播放器靠它决定 `<audio src>` 指向哪个文件；音乐页靠它高亮列表里的一行、
   *   去取这一首对应的歌词；首页那张迷你卡片靠它显示曲名 —— 三处读的必须是同一个数。
   *   另开一个共享组合式函数的技术后果是：外壳为了放一首歌要同时订阅两处状态，
   *   而"切歌"横跨两边（一处改下标、一处换 src），漏掉一半就是
   *   "列表高亮了、歌却没换"这种自相矛盾的界面 —— 而它看起来两边都是对的。
   *   【曲目的数据仍然不在这里】有哪些歌、每首叫什么、歌词与封面各是哪个文件，
   *   都在 `app/utils/musicTracks.ts`；这里只存"现在是第几首"这一个数字。
   *
   * 【为什么下标不持久化】刷新之后回到第一首，是播放器最不容易让人意外的行为
   *   （和"音量持久化、播放位置不持久化"是同一个取舍）。
   */
  const trackIndex = useState('bgMusicTrackIndex', () => 0)

  /** 从 localStorage 读偏好。【只在客户端调用】服务端没有 localStorage */
  const loadPreference = () => {
    if (!import.meta.client) return
    try {
      enabled.value = localStorage.getItem(STORAGE_KEY) === '1'
    } catch {
      // 隐私模式 / 存储被禁用时 localStorage 会抛异常。
      // 偏好读不到就用默认值（不播），**不能让整个站点挂掉** ——
      // 背景音乐是可有可无的东西，它不该有能力影响页面能不能打开。
      enabled.value = false
    }
  }

  const savePreference = () => {
    if (!import.meta.client) return
    try {
      localStorage.setItem(STORAGE_KEY, enabled.value ? '1' : '0')
    } catch {
      // 同上：存不进去就算了，本次会话里状态仍然是对的
    }
  }

  /** 设置偏好并落盘（开关、卡片按钮都走这里，保证"改一处、三处都变"） */
  const setEnabled = (value) => {
    enabled.value = Boolean(value)
    savePreference()
  }

  const toggle = () => setEnabled(!enabled.value)

  /**
   * 切到第几首。**只改下标 + 把进度清 0**，不碰 `enabled`/`playing`。
   *
   * 【为什么这里不负责"真的换音源"】换 src、把播放位置归零，都需要**元素**，
   *   而元素在外壳里（`app.vue` 监视这个下标去换 src）。这里越权去动元素的话，
   *   就又变成两处都在操作播放器了 —— 那正是当初把播放器收进外壳要解决的问题。
   * 【为什么下标没变时什么都不做】点了正在播的那一行，界面预期是"从头再放一遍"，
   *   这件事由调用方用已有的 `seek(0)` 完成（页面里就是这么写的）。
   *   在这里把 progress 清 0 反而会出现一个自相矛盾的瞬间：
   *   进度条回到 0、声音却还在原来的位置，直到下一次 timeupdate 才纠正过来。
   * 【不校验上界】越界的下标由 `trackAt(tracks, index)` 兜住
   *   （它保证永远返回一首真实的曲子，见 app/utils/musicTracks.ts），
   *   这里多存一个数字没有代价；而在这一层引曲目数据会让"状态"和"内容"缠在一起。
   */
  const setTrack = (index) => {
    const next = Number(index)
    if (!Number.isInteger(next) || next < 0) return
    if (next === trackIndex.value) return
    trackIndex.value = next
    // 换歌等于"这一首从头开始"：在元素真的换完音源之前，先把进度条归零，
    // 免得它在下一次 timeupdate 之前一直显示上一首的进度
    progress.value = 0
  }

  /** 播放器组件把真实状态写回来（播放/暂停/进度/播完） */
  const report = ({ playing: isPlaying, progress: percent } = {}) => {
    if (typeof isPlaying === 'boolean') playing.value = isPlaying
    if (typeof percent === 'number' && Number.isFinite(percent)) progress.value = percent
  }

  return {
    enabled,
    playing,
    progress,
    trackIndex,
    loadPreference,
    setEnabled,
    toggle,
    setTrack,
    report,
  }
}
