<template>
  <div class="shell">
    <!-- 背景视频：地址由 mediaUrl() 拼出来（前缀可配），页面里不写死 /bg-star.mp4。
         这个文件不在 public/ 里 —— 线上由 Nginx 的 /media/ 提供、dev 由 Nitro 的
         开发路由提供，理由见 app/utils/media.ts 与 static-media/README.md。

         【v-if 而不是 v-show】⚙ 设置面板里关掉「背景视频」之后，这个元素要**从 DOM 里去掉**：
         留着它（哪怕 display:none）浏览器照样会解码视频、照样占着显存。
         v-if 会销毁元素，解码与下载一起停 —— 这才对得起"关掉更省电"那句话。 -->
    <video v-if="videoOn" ref="bgVideo" class="bg-video" autoplay muted loop playsinline preload="auto">
      <source :src="bgVideoSrc" type="video/mp4" >
    </video>
    <div class="bg-overlay"/>

    <!-- ============ 背景音乐：全站**唯一**的 <audio> 实例（2026-09-11 从首页卡片挪到这里）============
         【为什么必须放在外壳里】
           改之前它住在首页那张音乐卡片里。而页面是随路由卸载的 ——
           于是"在首页点了播放，点进归档/文章/音乐页"音乐立刻没了，回来还得再点一次。
           背景音乐本来就该跨页面一直响：它的生命周期属于外壳，不属于某一页。
           挪上来还顺手堵死了另一个更难查的问题：**同时存在两个播放器**。
           留在页面里的话，"首页卡片一个 + 音乐页一个"就是两个 <audio> 抢同一首歌
           （两个都在响、或者一个在响而另一个的进度条永远停在 0），
           而共享状态里只有一份 playing/progress —— 两个实例会互相覆盖写，
           用户看到的是"两个页面显示的进度不一样"。
         【preload 为什么是 metadata 而不是 auto/none】
           · `auto`：每个访客一进首页就开始下整首 2 MB 的 mp3 —— 而音乐**默认是关的**
             （浏览器不许无手势自动播放），也就是说绝大部分人白下 2 MB。
           · `none`：一个字都不读。后果是进度条拿不到总时长，一上来显示 `--:--`，
             用户点了播放之后进度条还要等一次往返才开始动。
           · `metadata`：只读文件头（几十 KB 以内），拿到总时长，不碰音频数据。
             代价是"点播放到出声"多一次往返 —— 这个代价换掉 2 MB 的浪费，值。
         【为什么不用 v-if="enabled" 进一步省掉这个元素】
           那样确实能让"从不开音乐"的访客一个字节都不下，但会带来一个明确的体验退化：
           关掉再打开时元素被销毁重建，**播放位置会丢**（同一首歌从头开始）。
           暂停和"关掉"在用户眼里是同一件事，位置就不该丢。
         【loop：为什么是"单曲循环"而不是"播完停下"】
           这是**背景音乐**，曲目只有一首。播完就永久安静，用户会以为"音乐坏了/自己停了"，
           而重新点一次播放是件很别扭的事（尤其用户根本不知道它播完了）。
           代价是 `ended` 事件在浏览器里不会触发 —— 下面那个处理函数是**防御性**的：
           它是为了"哪天去掉 loop（比如要支持'播完停'）时状态仍然有主"，
           不是当前的主要路径（测试里对应那条用例也如实标注了这一点）。
         【src 从哪来】和背景视频一样由 mediaUrl() 拼（前缀可配、名字来自 MEDIA_FILES），
           页面里不写死 /media/bg-music.mp3，理由见 app/utils/media.ts 的头注释。 -->
    <audio
      ref="audioRef"
      :src="bgMusicSrc"
      preload="metadata"
      loop
      @timeupdate="onMusicTime"
      @durationchange="onMusicDuration"
      @loadedmetadata="onMusicDuration"
      @play="onMusicPlay"
      @pause="onMusicPause"
      @ended="onMusicEnded"
      @volumechange="onMusicVolumeChange"/>

    <header class="site-nav">
      <NuxtLink to="/" class="brand">
        <span class="brand-mark">✦</span>
        <span class="brand-name">亿轨星途</span>
      </NuxtLink>
      <nav class="nav-center">
        <!-- 导航项来自 navItems（唯一一份定义，窄屏面板渲染的是同一个数组）。
             这里不再一项项手写：手写两份迟早只剩一份是对的，而漏改**不会报错**。 -->
        <template v-for="item in navItems" :key="item.label">
          <!-- 有子项的（目前只有「文章」）：桌面沿用 hover 展开的下拉，交互没动。
               子项现在是**真链接**（NuxtLink）—— 它们指向 `/?categoryId=N`，
               也就是首页那套筛选：能爬、可中键新开、点完 URL 与列表标题都会跟着变。 -->
          <div v-if="item.children" class="nv dd">
            <button class="nv-btn">{{ item.label }} <span class="caret">▾</span></button>
            <div class="dd-menu">
              <NuxtLink v-for="child in item.children" :key="child.label" :to="child.to">{{ child.label }}</NuxtLink>
            </div>
          </div>
          <!-- 真链接：NuxtLink 渲染成 <a href>，可爬、可中键新开。
               导航里现在**每一项**都是上面两种之一（下拉或真链接）——
               F5 之后已经没有"点了弹开发中"的入口了，所以那个兜底分支被删掉了：
               留着一个永远不会走到的分支，只会让人以为还有没做完的入口。 -->
          <NuxtLink v-else :to="item.to" class="nv">{{ item.label }}</NuxtLink>
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
        <button class="icon-btn" aria-haspopup="dialog" aria-label="打开站点设置" title="站点设置" @click="openSettings">⚙</button>
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
          <!-- 与桌面下拉**同一批**子项，而且同样是真链接：手机上点完直接跳走，
               顺手把面板收起来（不收的话跳完还挂着一块盖住半屏的面板） -->
          <NuxtLink v-for="child in item.children" :key="child.label" :to="child.to" class="nm-sub" @click="closeNav">{{ child.label }}</NuxtLink>
        </div>
        <!-- 与桌面完全一样：下拉（分类）或真链接，没有第三种 -->
        <NuxtLink v-else :to="item.to" class="nm-item" @click="closeNav">{{ item.label }}</NuxtLink>
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

    <!-- ============ ⚙ 站点设置面板（右上角那个齿轮） ============
         【为什么用 el-drawer 而不是自己搭一个浮层】抽屉自带这几件本来就该有的东西：
         遮罩、Esc 关闭、锁住背景滚动、**焦点陷阱**（打开后按 Tab 不会跑到背后的页面上），
         以及 role="dialog" + aria-modal。自己写一遍只会写得比它差。
         窄屏导航那个面板是自己搭的（它更像"从导航条里滑出来的一块菜单"，
         而这里是标准对话框语义），两者的取舍不同。

         【为什么 size 写的是 min(380px, 88vw)】Element Plus 把 size 原样写进 width
         （`addUnit()`：字符串就原样用），所以这里能直接给一个 CSS 表达式 ——
         桌面 380px、窄屏不超过 88vw（手机上留一点边：让人看得出"背后还有一页"，
         也暗示点遮罩能关掉）。

         【为什么面板里的说明文字要写"只存在你这台设备上"】这两个开关都只改本机偏好，
         既不上传也不跟随账号。不写清楚的话，用户会以为换台电脑登录就该还是关的。 -->
    <el-drawer
      v-model="settingsOpen"
      class="settings-drawer"
      title="站点设置"
      direction="rtl"
      size="min(380px, 88vw)">
      <p class="set-sub">这两个开关只影响你这台设备上的显示与声音，不会同步到账号。</p>
      <div class="set-card glass">
        <div class="set-row">
          <div class="set-info">
            <span class="set-name">背景视频</span>
            <span class="set-desc">首页那层流动的星空。关掉更省电、也更省流量</span>
          </div>
          <!-- 【为什么不是 v-model】v-model 只会改到一个 ref 上，而"关掉"这件事
               还得写进 cookie（服务端下次渲染时才知道）—— 所以统一走 setVideoOn()。
               aria-label 是给读屏软件的：开关本身没有可读的文字（名字在旁边的 span 里）。 -->
          <el-switch
            :model-value="videoOn"
            aria-label="背景视频"
            @update:model-value="setVideoOn" />
        </div>
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
 * =====================================================================
 *  背景音乐：**全站唯一那个播放器的家**（2026-09-11 从首页卡片挪到这里）
 * =====================================================================
 *
 * 【为什么挪到外壳】见模板里那段长注释（页面会随路由卸载 → 音乐跟着断；
 *   两个页面各自的 <audio> → 两个实例互相覆盖状态）。这里只说**分工**：
 *
 *   · `useBackgroundMusic()`（共享状态，本次一行未改）
 *       `enabled`  用户想不想听（持久化在 localStorage）
 *       `playing`  是不是真的在响（浏览器有自动播放限制，所以与 enabled 必须分开）
 *       `progress` 进度百分比（给进度条用）
 *     页脚开关、⚙ 设置面板、首页卡片、音乐页，四处用的都是这一份 ——
 *     这才是"点了播放，四处一起变"的原因。
 *
 *   · 本文件（外壳）
 *       真正持有 <audio>；照着 `enabled` 去 play/pause，并把**真实**状态写回 `playing`；
 *       另外管"播放器自身"的那几件事：当前秒数、总时长、音量、内嵌封面。
 *       为什么这些不放共享状态里：`currentTime` 每 250ms 就变一次，
 *       塞进 useState 等于让全站共享状态每秒抖四次（下面有节流实现与理由）；
 *       而音量、封面是"这台设备上这个元素"的属性，本来就只有播放器自己知道。
 *
 *   · 首页卡片 / 音乐页（页面）
 *       纯 UI：从共享状态读 `playing` / `progress`，点按钮调 `toggle`。
 *       **不再各自持有 <audio>**（这正是"一离开首页音乐就没了"的病根）。
 *       音乐页还要读秒数/时长/音量、要跳转进度，通过下面这个 `provide` 拿：
 *       页面是外壳里 `<NuxtPage/>` 渲染出来的**后代**，provide/inject 天然送到。
 *
 * 【为什么是 provide 一个"播放器对象"，而不是再开一份 useState】
 *   再开一份就是**第二份真相**：同一个当前秒数存两处，只要有一处忘了同步，
 *   音乐页上的时间就会慢慢跑偏（而且不报错）。这里传出去的只有
 *   "元素 + 它自己的几个属性 + 几个动作"，播放状态仍然只有共享状态那一份。
 *   【注入键 'bgMusicPlayer' 在 app/pages/music.vue 里按同一个字符串 inject ——
 *    这是两个文件之间唯一的约定，改一处必须改另一处，所以两边都写了注释。】
 *
 * 【为什么音乐页不直接用 useBackgroundMusic 里的 progress 就够，还要秒数】
 *   `progress` 是百分比，它是给"细长进度条"用的（四舍五入到小数点后两位没人看得出来）；
 *   而歌词高亮需要**秒**（要和歌词时间戳比较），时间文字也要显示 `1:23 / 3:05`。
 */
const music = useBackgroundMusic()
const { enabled: musicEnabled, toggle: toggleMusic, report: reportMusic } = music
// 偏好读一次就够（服务端读不到 localStorage，所以只能在客户端做）
onMounted(() => music.loadPreference())

// 【背景视频的地址】在 setup 里算一次，模板里直接用。
// 为什么不把 mediaUrl(...) 直接写进模板：模板里调用会在**每次渲染时**重新执行
// （useRuntimeConfig 也就会被反复读），而它是个常量，没必要参与响应式。
// 文件名来自 MEDIA_FILES 常量表，前缀来自运行时配置，这里是唯一的拼接点。
const bgVideoSrc = mediaUrl(MEDIA_FILES.backgroundVideo)

/**
 * 【音频地址：跟着当前曲目走】（2026-09-11 加曲目列表时改成 computed，
 * 同一天晚些时候又改成"读接口的曲目"）
 *   · 曲目列表来自 `GET /music/list`（见 app/composables/useMusicTracks.ts），
 *     接口挂了 / 站长还没上传 → 列表就是**内置那一首**（static-media/bg-music.mp3），
 *     所以这个 computed 任何情况下都能拿到一个地址；
 *   · 于是**换歌 = 改共享状态里的下标**，这个 computed 自己就会变成新地址，
 *     `<audio :src>` 跟着变 —— 页面里没有任何一处自己拼地址。
 * 【为什么不拼 /media/ 前缀】接口给的 `url` 已经是**完整地址或 `/` 开头**
 *   （`/uploads/xxx.mp3` 是后台上传的目录，和 `/media/` 不是一回事；
 *   将来也可能是完整外链）。所以这里直接用，只有内置那一首的地址是 mediaUrl() 拼的。
 * 【关于跨域，别写反】`<audio>` 播放**不需要** CORS —— 外链音频没有 CORS 头也照常能响。
 *   需要 CORS 的是我们"额外读文件头解析内嵌封面"那一步（下面 fetchMusicCover），
 *   那是普通 fetch 请求、还带 Range 头（会触发 preflight），所以外链基本读不到封面：
 *   这种情况下用接口给的 `cover`，再没有就显示占位图案。
 */
const { currentTrack } = useMusicTracks()
const bgMusicSrc = computed(() => currentTrack.value.url)

// ---------- <audio> 元素的引用与它的几个属性 ----------
/** 模板里那个唯一 <audio> 的引用。所有对播放器的直接操作都从这里拿到元素 */
const audioRef = ref()
/** 当前播放到第几秒。**本地 ref**（不是 useState）—— 只有音乐页在读它 */
const musicCurrent = ref(0)
/** 总时长（秒）。**0 表示"还不知道"**：读元数据之前 duration 是 NaN，必须收成有限值 */
const musicDuration = ref(0)
/** 参考音量（0~1）。初值给 1，真的偏好等挂载后再从 localStorage 读（理由见下面那段） */
const musicVolume = ref(1)
/** 静音开关。**不持久化**（理由见下面 VOLUME_STORAGE_KEY 的注释） */
const musicMuted = ref(false)
/** 歌曲**内嵌**的封面地址（object URL）。空串 = 没读到，调用方用回落图 */
const musicCoverUrl = ref('')

/**
 * 音量的持久化 key。
 * 【为什么音量持久化、静音不持久化】
 *   音量是**长期偏好**：用户把音量调到 30% 是"我就想这么听"，下次进站还得是 30%。
 *   静音是**临时动作**：用户往往只是"先安静一下"（接个电话、开会），
 *   下次打开站点还是静音会让人以为"又坏了"。所以静音只活在本次会话里。
 * 【为什么服务端读不到（初值给 1）】localStorage 在服务端不存在，
 *   如果在这里同步读，服务端渲染出来是 1、客户端一挂载立刻变成 0.3 ——
 *   那正是 hydration 不一致（控制台一阵告警，滑块的初始位置还会闪一下）。
 *   所以和 `enabled` 一样：**挂载后在客户端读**。
 */
const VOLUME_STORAGE_KEY = 'bg-music-volume'

/** 读上一次存的音量（只在客户端调用）。读不到 / 被禁 / 值不合法都回落到 1 */
const readStoredVolume = () => {
  if (!import.meta.client) return 1
  try {
    const raw = Number.parseFloat(localStorage.getItem(VOLUME_STORAGE_KEY) ?? '')
    return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : 1
  } catch {
    // 隐私模式 / 存储被禁用：音量是可有可无的东西，读不到就用默认值，不影响页面能不能开
    return 1
  }
}

const persistVolume = () => {
  if (!import.meta.client) return
  try {
    localStorage.setItem(VOLUME_STORAGE_KEY, String(musicVolume.value))
  } catch {
    // 同上：存不进去就算了，本次会话里音量仍然是对的
  }
}

/**
 * 把音量与静音**落实到元素上**。
 * 【为什么每次都要重新赋值】`el.volume` / `el.muted` 是元素的属性，
 *   我们的 ref 只是"界面上的那一份"。两者之间必须有一个明确的落点，
 *   否则会出现"滑块看着在 30%、声音还是满的"。
 */
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
  // 拖音量 = 明确"我想听"：顺手取消静音。不这么做的话，
  // 用户会遇到"我把音量拖上去了，怎么还是没声音"（因为 muted 还挂着）
  if (musicVolume.value > 0) musicMuted.value = false
  applyVolume()
  persistVolume()
}

/** 静音开关：只切换 muted，不动用户选的音量（取消静音后要回到原来的音量） */
const toggleMusicMute = () => {
  musicMuted.value = !musicMuted.value
  applyVolume()
}

/** 进度百分比。duration 未知时返回 0（而不是 NaN —— NaN 写进进度条会变成非法宽度） */
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

/** 时长：只在"有限且为正"时采纳。读不出来就一直保持 0，界面显示 `--:--`（比显示 NaN 好） */
const onMusicDuration = () => {
  const el = audioRef.value
  if (!el) return
  musicDuration.value = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0
}

// 真实事件回写共享状态：浏览器可能在别的地方把音频暂停/播放了
// （系统媒体控制、来电、蓝牙断连），那时界面必须跟着变，而不是继续显示"正在播放"
const onMusicPlay = () => reportMusic({ playing: true })
const onMusicPause = () => reportMusic({ playing: false })
/**
 * 【`loop` 生效时，浏览器不会触发这个事件】
 * 留着它是**防御性**的：哪天去掉 loop（比如要支持"播完停下"），
 * 状态仍然有主，不会停在"显示在播、其实已经结束"。测试里那一条是手工 dispatch
 * 出来的，注释里也如实写了这一点 —— 它不是当前的主要路径。
 */
const onMusicEnded = () => reportMusic({ playing: false, progress: 0 })

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
 *   「文章」下拉里的分类也是一个道理：分类是从接口来的，两处各拉一遍迟早不一致。
 *
 * 【为什么是 computed】「文章」的子项**来自接口**（`GET /category/list`，见
 *   `useCategoryList`），分类变了导航要跟着变，所以这里不能是一个写死的数组。
 *
 * 字段含义：
 *   · `to`       —— 真链接（NuxtLink），可爬、可中键新开
 *   · `children` —— 有子项的（目前只有「文章」，桌面是 hover 展开的下拉，子项是真分类）
 *
 * 【`dev: true` 这个字段已经没有了】（2026-09-11）它原来标"还没做的入口"，
 *   点了弹一句「该页面开发中」。F5 把最后四个入口（收藏 / 项目 / 友链 / 关于）
 *   接成真页面之后，导航里**每一项都是真链接**，所以那个字段、那个兜底分支
 *   以及对应的 `onDev()` 一起删掉了 —— 留着一个永远不会走到的分支，
 *   只会让人以为还有没做完的入口。
 */
const { categories: navCategories } = useCategoryList()

/**
 * 「文章」这一项：**有分类就是下拉（子项 = 真分类），一个都没有就退化成指向首页的链接**。
 *
 * 【为什么有分类时子项指向 `/?categoryId=N` 而不是给每个分类做一个页面】
 *   首页本来就是文章列表，而且它已经带着一整套分类筛选（点分类 → 请求参数、
 *   地址栏、列表标题三处同步）。给每个分类再做一个页面等于把同一件事做两遍，
 *   还会多出"两套筛选逻辑谁对"的问题。`?categoryId=` 这个地址是可分享、可爬、
 *   刷新后状态还在的。
 *
 * 【为什么没有分类时不是"空下拉"】空下拉点开是一片空白，用户只会觉得坏了。
 *   而首页是文章列表，正是这一项最合理的去处（接口挂了、或者站里还没建分类时都会走到这里）。
 *   过滤掉 `id` / `name` 缺项的脏数据，是因为它们会渲染出一个点不动的链接（`?categoryId=undefined`）。
 */
const articleNavItem = () => {
  const children = navCategories.value
    .filter(c => c && c.id != null && c.name)
    .map(c => ({ label: c.name, to: `/?categoryId=${c.id}` }))
  return children.length ? { label: '文章', children } : { label: '文章', to: '/' }
}

const navItems = computed(() => [
  { label: '首页', to: '/' },
  // 归档做成【顶层导航】而不是塞进「文章」下拉框里：那是独立的一页，
  // 而「文章」下拉里是"按分类看"，两件事。混在一起用户根本分不清点哪个。
  { label: '归档', to: '/archive' },
  articleNavItem(),
  // 【音乐从 "首页的锚点" 变成了真页面】（2026-09-11）
  //   改之前这一项指的是 '/#music' —— 首页那张卡片上的锚点。也就是说"音乐"
  //   其实只是"滚到首页某个位置"，而首页那张卡片只有一个播放键：点进来的用户
  //   看到的还是同一张卡片，感觉自己没进任何页面（这正是用户报的"音乐点进去没有东西"）。
  //   现在它是一个**真页面** /music（旋转唱片 + 歌词 + 完整控制条），
  //   NuxtLink 渲染成 <a href="/music">：可爬、可中键新开、刷新后还在这一页。
  { label: '音乐', to: '/music' },
  // 【收藏 / 项目 / 友链 / 关于：F5 的四页，2026-09-11 从"还没做"接成真页面】
  //   在这之前它们都是 `dev: true` —— 点了只弹一句「该页面开发中」。
  //   现在四个模块后端各有一张表、一套公开接口与后台管理面板，所以这里都是真链接。
  //
  // 【关于为什么不再指 '/#profile'】那是首页那张个人卡片的锚点。四页做完之后
  //   "关于"有自己的一页（站长资料 + 自我介绍），首页那张卡片是**简述**，
  //   点「关于」应该是去看完整的那一份，而不是滚回首页。
  //   锚点本身留着（老的 `/#profile` 链接仍然落到那张卡片上），只是导航不再指向它。
  { label: '收藏', to: '/favorites' },
  { label: '项目', to: '/projects' },
  { label: '友链', to: '/links' },
  { label: '关于', to: '/about' },
])

/** 汉堡面板开着没有 */
const navOpen = ref(false)
const route = useRoute()

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

// =====================================================================
//  ⚙ 站点设置面板（右上角那个齿轮，2026-09-11 新加）
//
//  【修的是什么】那个按钮原来写的是 `@click="onDev"` —— 点下去只弹一句
//  「该页面开发中」。面板里现在有两个开关：背景视频、背景音乐。
//
//  【两个开关各自的状态放在哪，为什么不一样】
//    · 背景视频 → **cookie**（`useCookie`）
//    · 背景音乐 → localStorage（`useBackgroundMusic` 里）
//    这不是随手选的，是因为两者的诉求不同：
//
//    视频这个偏好**必须在服务端渲染时就知道**。视频元素只要进了首屏 HTML，
//    浏览器立刻就会去下 `bg-star.mp4`（`preload="auto"`）并开始解码 ——
//    于是"特意把视频关掉"的用户每次打开页面都还会白下一段视频，
//    还得看它闪一下再被抹掉，那个开关等于白关。localStorage 服务端读不到，
//    cookie 能从请求头里读到，所以这里只能用 cookie。
//
//    音乐不需要这样：它无论如何都得等用户手势才能播（浏览器自动播放限制），
//    服务端渲染成什么样都不影响结果 —— 那就不必让每个请求都多背一个 cookie。
// =====================================================================

/**
 * 背景视频偏好。**null（cookie 不存在）= 默认开**，只有用户显式关掉才写 false。
 * 重新打开时写 null —— useCookie 收到 null 会把 cookie 删掉，
 * 这样"没设置"与"设置成开"不会变成两种表达同一件事的值。
 * maxAge 给 180 天：不给的话它是会话 cookie，用户关掉浏览器再进来视频又回来了。
 */
const videoPref = useCookie('bg-video-enabled', { maxAge: 60 * 60 * 24 * 180 })
const videoOn = computed(() => videoPref.value !== false)
const setVideoOn = (value) => { videoPref.value = value ? null : false }

/** 设置面板开着没有。只有 app.vue 用得到，所以不做成共享状态 */
const settingsOpen = ref(false)

/**
 * 打开设置面板。顺手把窄屏导航面板收起来 ——
 * 两个浮层叠在一起时，Esc 与点遮罩都只能关掉一个，剩下那个还盖着半屏，
 * 用户的感受就是"没关上"（设置那个齿轮在窄屏下也在导航条右侧，很容易两个都开着）。
 */
const openSettings = () => {
  closeNav()
  settingsOpen.value = true
}

/**
 * 面板里的音乐开关：只把"用户的意图"写给共享状态。
 * 【为什么不能直接 v-model="musicEnabled"】那样只改了内存里那个 ref，
 * 不会落盘（写 localStorage 的动作在 useBackgroundMusic().setEnabled 里）——
 * 刷新一下偏好就没了，而这种"当时生效、下次失效"的 bug 极难被注意到。
 */
const setMusicOn = (value) => music.setEnabled(value)

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
  // 音量的偏好：和 `enabled` 一样只能在客户端读（服务端没有 localStorage），
  // 读完立刻应用到元素上 —— 否则用户上次调的 30% 要等到他动一下滑块才生效
  musicVolume.value = readStoredVolume()
  applyVolume()

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
