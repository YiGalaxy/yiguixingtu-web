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
//   · `enabled`  —— 用户想不想听（持久化在 localStorage）
//   · `playing`  —— 现在是不是真的在播
//   · `progress` —— 播放进度（0~100，给进度条用）
//   真正持有 `<audio>` 的那个组件（目前是首页的音乐卡片，F3 之后还有音乐页）
//   负责"照着 `enabled` 去 play/pause"，并把真实状态写回 `playing` / `progress`。
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

  /** 播放器组件把真实状态写回来（播放/暂停/进度/播完） */
  const report = ({ playing: isPlaying, progress: percent } = {}) => {
    if (typeof isPlaying === 'boolean') playing.value = isPlaying
    if (typeof percent === 'number' && Number.isFinite(percent)) progress.value = percent
  }

  return {
    enabled,
    playing,
    progress,
    loadPreference,
    setEnabled,
    toggle,
    report,
  }
}
