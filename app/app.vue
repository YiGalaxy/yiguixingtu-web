<template>
  <div class="shell">
    <!-- 背景视频：地址由 mediaUrl() 拼出来（前缀可配），页面里不写死 /bg-star.mp4。
         这个文件不在 public/ 里 —— 线上由 Nginx 的 /media/ 提供、dev 由 Nitro 的
         开发路由提供，理由见 app/utils/media.ts 与 static-media/README.md。 -->
    <video ref="bgVideo" class="bg-video" autoplay muted loop playsinline preload="auto">
      <source :src="bgVideoSrc" type="video/mp4" >
    </video>
    <div class="bg-overlay"/>

    <header class="site-nav">
      <NuxtLink to="/" class="brand">
        <span class="brand-mark">✦</span>
        <span class="brand-name">亿轨星途</span>
      </NuxtLink>
      <nav class="nav-center">
        <!-- 导航项来自 navItems（唯一一份定义，窄屏面板渲染的是同一个数组）。
             这里不再一项项手写：手写两份迟早只剩一份是对的，而漏改**不会报错**。 -->
        <template v-for="item in navItems" :key="item.label">
          <!-- 有子项的（目前只有「文章」）：桌面沿用 hover 展开的下拉，交互没动 -->
          <div v-if="item.children" class="nv dd">
            <button class="nv-btn">{{ item.label }} <span class="caret">▾</span></button>
            <div class="dd-menu">
              <a v-for="child in item.children" :key="child.label" @click="onChildNav(child)">{{ child.label }}</a>
            </div>
          </div>
          <!-- 真链接：NuxtLink 渲染成 <a href>，可爬、可中键新开 -->
          <NuxtLink v-else-if="item.to" :to="item.to" class="nv">{{ item.label }}</NuxtLink>
          <!-- 还没做的入口：给提示（做到哪一批就换成真链接） -->
          <span v-else class="nv" @click="onDev">{{ item.label }}</span>
        </template>
      </nav>
      <nav class="nav-right">
        <!-- 汉堡按钮：只在窄屏出现（显隐由 CSS 负责，不用 JS 量宽度 —— 见 script 里的说明）。
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
        <button class="icon-btn" @click="onDev">⚙</button>
        <template v-if="token">
          <!-- 登录状态提示：头像首字 + 昵称 + 角色标签 -->
          <div class="user-chip" :title="'当前登录：' + displayName">
            <span class="uc-avatar">{{ avatarText }}</span>
            <span class="uc-name">{{ displayName }}</span>
            <span class="uc-role" :class="{ 'is-admin': isAdmin }">{{ isAdmin ? '管理员' : '游客' }}</span>
          </div>
          <NuxtLink v-if="isAdmin" to="/admin" class="nav-admin">后台</NuxtLink>
          <el-button type="primary" round class="nav-btn" @click="onLogout">退出</el-button>
        </template>
        <template v-else>
          <el-button type="primary" round class="nav-btn" @click="openLogin">登录</el-button>
          <el-button round class="nav-btn nav-ghost" @click="openRegister">注册</el-button>
        </template>
      </nav>
    </header>

    <!-- ============ 窄屏导航面板（汉堡菜单） ============
         只在 ≤1000px 用得到；桌面导航在上面那个 .nav-center 里照常显示。
         · 用 v-show 而不是 v-if：面板常驻 DOM（所以 aria-controls 指向的那个 id 一直存在），
           收起时是 display:none —— 读屏软件与 Tab 键都不会走到里面
         · 遮罩点一下也能关（手机上最常见的关法）
         · 面板里的链接是**同一个 navItems**，所以桌面与手机永远不会有"少一个入口"的差别 -->
    <div v-if="navOpen" class="nav-scrim" @click="closeNav" />
    <nav v-show="navOpen" id="site-mobile-nav" class="nav-mobile glass">
      <template v-for="item in navItems" :key="item.label">
        <div v-if="item.children" class="nm-group">
          <div class="nm-group-title">{{ item.label }}</div>
          <a v-for="child in item.children" :key="child.label" class="nm-sub" @click="onDevFromNav">{{ child.label }}</a>
        </div>
        <NuxtLink v-else-if="item.to" :to="item.to" class="nm-item" @click="closeNav">{{ item.label }}</NuxtLink>
        <span v-else class="nm-item" @click="onDevFromNav">{{ item.label }}</span>
      </template>
    </nav>

    <main class="page">
      <NuxtRouteAnnouncer />
      <NuxtPage />
    </main>

    <footer class="site-footer">
      <div class="foot-brand">
        <span class="foot-mark">✦</span> 亿轨星途
      </div>
      <button class="music-toggle" :class="{ on: musicEnabled }" :aria-label="musicEnabled ? '关闭背景音乐' : '播放背景音乐'" @click="toggleMusic">
        <span class="glyph">♫</span>
        <span class="music-label">{{ musicEnabled ? '关闭背景音乐' : '播放背景音乐' }}</span>
      </button>
    </footer>

    <el-dialog v-model="loginVisible" class="auth-modal" :show-close="false" width="400px" :close-on-click-modal="true">
      <div class="auth-card">
        <div class="brand-line">✦ 亿轨星途</div>
        <h2 class="auth-title">欢迎回来</h2>
        <p class="auth-sub">登录后，继续绘制你的星图</p>
        <el-form label-position="top" class="auth-form" @submit.prevent="onLogin">
          <el-form-item label="用户名"><el-input v-model="form.username" placeholder="请输入用户名" size="large" /></el-form-item>
          <el-form-item label="密码"><el-input v-model="form.password" type="password" show-password placeholder="请输入密码" size="large" @keyup.enter="onLogin" /></el-form-item>
        </el-form>
        <div class="auth-row">
          <!-- 【原来是「记住密码」，现在是「记住用户名」】
               改前的实现把**明文密码**写进了 rememberMe 这个 cookie（安全审查的 🔴）。
               后端没有任何"用记住的密码自动登录"的接口，所以存这个密码
               除了给自己留一个泄露点（XSS 读得到、随请求发给代理与日志）之外，
               什么功能都没实现。现在只记住用户名，密码不落任何客户端存储。 -->
          <el-checkbox v-model="remember">记住用户名</el-checkbox>
          <!-- 【为什么是 underline="never" 而不是 :underline="false"】
               Element Plus 2.14 起，underline 这个 prop 的**布尔值**形态已经废弃，
               每次渲染都会往控制台打一段 ElementPlusError（不影响功能，
               但会把真正的报错淹掉）。新 API 是三个字符串：
                 'never' 永不显示下划线 / 'hover' 悬停才显示 / 'always' 一直显示
               两者行为**完全等价**：组件内部就是
                 isBoolean(underline) ? (underline ? 'hover' : 'never') : underline
               也就是说这里只是把"它替我们做的转换"写成了显式值。
               旧对象配置 el-config-provider 的 link.underline 同理，也都换字符串。 -->
          <el-link type="primary" underline="never" @click="switchToRegister">去注册</el-link>
        </div>
        <!-- 登录按钮：被限流之后 disabled + 显示倒计时。
             为什么要禁用而不是只弹一句提示：被 429 拦下之后用户的第一个反应是
             "再点一次"，而每点一次都会再撞一次限流（还占掉 1 分钟窗口里的一个位置），
             点了没反应会让人以为按钮坏了。禁用 + 秒数把"要等一会儿"变成看得见的状态。
             注意 disabled 只挡得住点击，挡不住"密码框回车提交"，
             所以真正的拦截在 useAuth().login() 里面（那边也会拒绝）。 -->
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
        <div class="brand-line">✦ 亿轨星途</div>
        <h2 class="auth-title">创建账号</h2>
        <p class="auth-sub">开始记录你的第一篇</p>
        <el-form label-position="top" class="auth-form" @submit.prevent="onRegister">
          <el-form-item label="用户名"><el-input v-model="regForm.username" placeholder="设置用户名" size="large" /></el-form-item>
          <el-form-item label="昵称"><el-input v-model="regForm.nickname" placeholder="怎么称呼你" size="large" /></el-form-item>
          <el-form-item label="密码"><el-input v-model="regForm.password" type="password" show-password placeholder="设置密码" size="large" /></el-form-item>
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

// ---------- 登录状态提示 ----------
const isAdmin = computed(() => user.value?.role === 'ADMIN')
const displayName = computed(() => user.value?.nickname || user.value?.username || '已登录')
const avatarText = computed(() =>
  String(user.value?.nickname || user.value?.username || '?').slice(0, 1).toUpperCase()
)

const bgVideo = ref()

/**
 * 【背景音乐的状态来自共享组合式函数】（2026-09-11 改）
 *
 * 改之前这里是一个本地 `ref(false)`，而且它的作用是把**背景视频取消静音**：
 *     const toggleMusic = () => { musicOn.value = !musicOn.value
 *                                 bgVideo.value.muted = !musicOn.value }
 * 两个问题：
 *   ① 它管的根本不是"背景音乐"。本站的背景音乐是 `static-media/bg-music.mp3`
 *      （首页那张音乐卡片在放它），而背景视频是**装饰性的、按设计一直静音** ——
 *      给它取消静音只会让视频自己的音轨盖在音乐上
 *   ② 状态是**局部的**，所以页脚这个开关和首页卡片上的按钮**互不知道对方**：
 *      页脚显示"关闭背景音乐"时，卡片可能正显示着暂停图标，用户看到的就是"点了没反应"
 *
 * 现在状态统一放在 `useBackgroundMusic()` 里（`enabled` = 用户想不想听，持久化到 localStorage），
 * 页脚的开关、⚙ 设置面板里的开关、首页音乐卡片的按钮都用这一份。
 * 【谁真正放音】`<audio>` 元素在首页的音乐卡片里（F3 之后音乐页也会有），
 * 它照着 `enabled` 去 play/pause，并把真实状态写回 `playing`。
 *   也就是说：`enabled` 是"想听"，`playing` 是"真的在响"——浏览器有自动播放限制，
 *   没有用户手势时 `play()` 会被拒绝，这两件事就必须分开，不能合成一个变量。
 */
const music = useBackgroundMusic()
const { enabled: musicEnabled, toggle: toggleMusic } = music
// 偏好读一次就够（服务端读不到 localStorage，所以只能在客户端做）
onMounted(() => music.loadPreference())

// 【背景视频的地址】在 setup 里算一次，模板里直接用。
// 为什么不把 mediaUrl(...) 直接写进模板：模板里调用会在**每次渲染时**重新执行
// （useRuntimeConfig 也就会被反复读），而它是个常量，没必要参与响应式。
// 文件名来自 MEDIA_FILES 常量表，前缀来自运行时配置，这里是唯一的拼接点。
const bgVideoSrc = mediaUrl(MEDIA_FILES.backgroundVideo)

// ---------- 背景视频性能优化 ----------
// 页面切到后台（切标签页 / 最小化窗口）时暂停视频，避免白白占用 CPU 和显卡
const onVisibilityChange = () => {
  if (!bgVideo.value) return
  if (document.hidden) bgVideo.value.pause()
  else bgVideo.value.play().catch(() => {})
}
onBeforeUnmount(() => document.removeEventListener('visibilitychange', onVisibilityChange))
const onLogout = async () => {
  // 【这次修了什么】原来只清本地 token，完全没调后端 ——
  // 于是服务端签出去的那个 token 依然有效到自然过期（默认 24 小时）。
  // 现在交给 useAuth().logout()：它先去调 POST /auth/logout 把当前 token 拉黑，
  // 再清 token 与 user。接口失败也照样清（用户想退出就该让他退掉）。
  await logout()
  ElMessage.success('已退出')
  navigateTo('/')
}
const onDev = () => ElMessage.info('该页面开发中')

// =====================================================================
//  导航（2026-09-11：窄屏从"整块隐藏"改成汉堡菜单）
//
//  【修的是什么】原来这里只有一行 CSS：
//      `@media (max-width: 1000px) { .nav-center { display: none; } }`
//    也就是说窄屏（手机、平板、或者只是把窗口拖窄）下**整个中间导航直接消失**，
//    而且**没有任何替代入口** —— 手机上只剩左上角 Logo 和右边登录按钮，
//    归档 / 音乐 / 关于 这些页面在手机上根本进不去。用户报的就是这个。
//    注意它和"标签被挤窄"是两件事：这里不是挤，是**整块被藏掉**。
//
//  【做法】窄屏显示一个汉堡按钮（`.nav-burger`），点开一个面板，
//    里面是**同一批导航项**。显隐一律由 CSS 媒体查询控制，
//    **不用 JS 去量窗口宽度** —— SSR 首屏在服务端量不到宽度，
//    用 JS 判断会出现"服务端渲染成桌面版、客户端立刻改成移动版"的一下闪烁，
//    严重时还会 hydration 不一致。CSS 没有这个问题。
// =====================================================================

/**
 * 导航项：**只有这一份定义**，桌面导航（≥1000px）与窄屏的汉堡面板都渲染它。
 *
 * 【为什么必须是一份】两处各写一遍的话，加一个入口就要改两个地方，
 *   而漏改的那一处**什么都不报**：桌面点得到、手机上就是没那个入口（或者反过来）。
 *   这一批后面还要往导航里加东西（「文章」下拉要接真实分类、还会加四个内容页），
 *   所以先把"只有一份"这件事定下来。
 *
 * 字段含义：
 *   · `to`       —— 真链接（NuxtLink），可爬、可中键新开
 *   · `children` —— 有子项的（目前只有「文章」，桌面是 hover 展开的下拉）
 *   · `dev:true` —— 还没做的入口，点了给"该页面开发中"提示（做到哪一批就换成真链接）
 */
const navItems = [
  { label: '首页', to: '/' },
  // 归档做成【顶层导航】而不是塞进「文章」下拉框里：下拉框里那三项现在点下去还是
  // "该页面开发中"，把唯一一个真能用的入口混在里面，用户根本不会去点它。
  { label: '归档', to: '/archive' },
  {
    label: '文章',
    children: [
      { label: '技术', dev: true },
      { label: '读书', dev: true },
      { label: '随笔', dev: true },
    ],
  },
  { label: '音乐', to: '/#music' },
  { label: '收藏', dev: true },
  { label: '项目', dev: true },
  { label: '友链', dev: true },
  { label: '关于', to: '/#profile' },
]

/** 汉堡面板开着没有 */
const navOpen = ref(false)
const route = useRoute()

const closeNav = () => { navOpen.value = false }
const toggleNav = () => { navOpen.value = !navOpen.value }

/**
 * 窄屏面板里点"还没做"的入口：给完提示**要把面板收起来** ——
 * 不收的话提示会弹在面板底下（面板是覆盖层），用户只看到"点了没反应"。
 */
const onDevFromNav = () => {
  onDev()
  closeNav()
}

/** 下拉项（目前都是 dev 项，等它们真有页面了就直接用 child.to 跳） */
const onChildNav = (child) => {
  if (child.dev) onDev()
}

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

const form = reactive({ username: '', password: '' })
const regForm = reactive({ username: '', nickname: '', password: '' })
const loading = ref(false)
const regLoading = ref(false)

// 「记住用户名」：逻辑全在 useRememberedLogin 里（只记用户名、清理老 cookie、
// 为什么不许存密码 —— 见那个文件的头注释）。这里只负责接线：
//   remember —— 勾选框（v-model）
//   rememberedUsername —— 挂载时回填输入框用
const { remember, username: rememberedUsername, restore: restoreRemembered, save: saveRemembered, clear: clearRemembered } = useRememberedLogin()

onMounted(async () => {
  // 回填「记住的用户名」，并【顺手清理老版本留下的 cookie】：
  // 只改代码是不够的 —— 老用户浏览器里那个带着明文密码的 rememberMe
  // 不会自己消失，restore() 会在发现老格式时立刻把它改写成只含用户名的值。
  // 注意这里【不再回填密码】：密码不回填、不存储，用户每次自己输。
  restoreRemembered()
  if (rememberedUsername.value) form.username = rememberedUsername.value

  // 刷新页面后 useState('user') 会变回 null，但 cookie 里的 token 还在。
  // 用 /auth/me 把用户信息补回来，顶部才能正确显示昵称和角色。
  if (token.value && !user.value) {
    const res = await request('/auth/me')
    if (res.ok) user.value = res.data
  }

  // 绑定"切到后台就暂停背景视频"
  document.addEventListener('visibilitychange', onVisibilityChange)
})
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
const onRegister = async () => {
  regLoading.value = true
  const res = await register(regForm)
  regLoading.value = false
  if (res.ok) { ElMessage.success('注册成功，去登录'); registerVisible.value = false; switchToLogin() }
  else { ElMessage.error(res.message) }
}
</script>

<style>
:root {
  --bg: #0e1a36; --surface: #16264a; --surface-2: #1f345c;
  --ink: #f6faff; --muted: #b6c8e0; --line: rgba(150,190,240,.14);
  --accent: #f2c14e; --accent-strong: #ffd96b; --cyan: #59d6e6;
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

   顺带说：背景视频和遮罩是 position: fixed，
   它们【不参与】文档流，所以不会变成 flex 子项来捣乱。 */
.shell { display: flex; flex-direction: column; min-height: 100vh; min-height: 100dvh; }
/* 导航是 sticky、页脚是固定高度，都不允许被 flex 压缩 */
.site-nav, .site-footer { flex-shrink: 0; }
/* 内容区：flex-basis 用 auto（按内容撑），有剩余空间时再长高把它吃满 */
.page { flex: 1 0 auto; }

/* 视频每帧都要跑一遍 filter，所以只保留必要的 brightness。
   原来的 contrast + saturate 去掉，能明显减少每帧的 GPU 开销。 */
.bg-video { position: fixed; inset: 0; width: 100%; height: 100%; object-fit: cover; z-index: -10; pointer-events: none; filter: brightness(1.35); transform: translateZ(0); will-change: transform; }
.bg-overlay { position: fixed; inset: 0; z-index: -9; pointer-events: none; background: rgba(6,12,26,.12); backdrop-filter: blur(0); }

/* ===== 共享的"玻璃面板"底 =====
   【为什么放在这里（全局）而不是各页面自己的 scoped 样式里】
   这个类被首页、归档页、后台面板一起用。原来它**只在 index.vue 里以 scoped 形式定义**，
   而 scoped 样式只对本组件的模板生效 —— 于是【归档页写了 class="glass"，却没有任何规则命中】：
   那些月份卡片和三个状态块没有背景、没有边框，文字直接压在背景视频上，
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

.site-footer { position: relative; z-index: 1; margin-top: 40px; padding: 34px 32px 40px; border-top: 1px solid rgba(150,190,240,.10); display: flex; align-items: center; justify-content: space-between; gap: 16px; backdrop-filter: blur(16px); background: rgba(12,22,44,.32); }
.foot-brand { display: flex; align-items: center; gap: 8px; font-weight: 700; color: var(--ink); letter-spacing: .5px; }
.foot-mark { color: var(--accent); }
.music-toggle { display: inline-flex; align-items: center; gap: 8px; height: 40px; padding: 0 16px; border-radius: 999px; background: rgba(255,255,255,.06); border: 1px solid rgba(150,190,240,.16); color: var(--muted); cursor: pointer; backdrop-filter: blur(12px); transition: border-color .2s ease, color .2s ease, transform .2s ease; }
.music-toggle:hover { border-color: var(--accent); color: var(--ink); transform: translateY(-1px); }
.music-toggle.on { border-color: var(--accent); color: var(--accent); }
.music-toggle.on .glyph { animation: spin 4s linear infinite; }
.music-toggle .glyph { font-style: normal; font-size: 16px; }
.music-toggle .music-label { font-size: 13px; }
@keyframes spin { to { transform: rotate(360deg); } }

.auth-modal { border-radius: 20px; overflow: hidden; background: rgba(10,18,36,.55); backdrop-filter: blur(26px) saturate(150%); -webkit-backdrop-filter: blur(26px) saturate(150%); border: 1px solid rgba(150,190,240,.14); box-shadow: 0 26px 90px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.08); }
.auth-modal .el-dialog__header { display: none; }
.auth-modal .el-dialog__body { padding: 0; background: transparent; }
.auth-card { padding: 36px 36px 30px; color: var(--ink); }
.brand-line { font-size: 13px; font-weight: 700; color: var(--accent); letter-spacing: 2px; margin-bottom: 18px; }
.auth-title { margin: 0 0 6px; font-size: 26px; font-weight: 800; letter-spacing: 0; }
.auth-sub { margin: 0 0 26px; color: var(--muted); font-size: 14px; }
.auth-form .el-form-item { margin-bottom: 18px; }
.auth-form .el-form-item__label { color: var(--muted); font-weight: 600; padding-bottom: 6px; }
.auth-form .el-input__wrapper { background: #0d1b38 !important; box-shadow: 0 0 0 1px var(--line) inset !important; border-radius: 12px; }
.auth-form .el-input__wrapper.is-focus { box-shadow: 0 0 0 1.5px var(--cyan) inset !important; }
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
</style>
