<template>
  <div class="shell" :data-theme="themeMode">
    <img
      class="bg-poster"
      :class="`is-${themeMode}`"
      :src="bgPosterSrc"
      alt=""
      aria-hidden="true">

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
        <template v-for="item in navItems" :key="item.label">
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
          <div class="user-chip" :title="'当前登录：' + displayName">
            <span class="uc-avatar"><img :src="profile.avatar" alt=""></span>
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
      <div class="foot-top">
        <div class="foot-brand">
          <img class="foot-mark" src="/assets/brand-minecraft-pixel-transparent.png" alt=""> {{ settings.siteName }}
        </div>

        <button class="music-toggle" :class="{ on: musicEnabled }" :aria-label="musicEnabled ? '关闭背景音乐' : '播放背景音乐'" @click="toggleMusic">
          <span class="glyph">♫</span>
          <span class="music-label">{{ musicEnabled ? '关闭背景音乐' : '播放背景音乐' }}</span>
        </button>
      </div>

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
          <el-checkbox v-model="remember">记住用户名</el-checkbox>
          <el-link type="primary" underline="never" @click="openRegister">去注册</el-link>
        </div>
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
        <div class="auth-row center"><el-link type="primary" underline="never" @click="openLogin">已有账号？去登录</el-link></div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
const {
  token, isAdmin, displayName,
  loginVisible, registerVisible, openLogin, openRegister,
  form, regForm, remember, loading, regLoading,
  coolingDown, loginButtonText, onLogin, onRegister, onLogout,
} = useShellAuth()
const { navItems, navOpen, closeNav, toggleNav } = useSiteNavigation()
useVisitReporting()

const { themeMode, toggleTheme } = useThemeMode()
const { profile } = useSiteProfile()
const route = useRoute()
useHead(() => ({ htmlAttrs: { 'data-theme': themeMode.value } }))

const music = useBackgroundMusic()
const { enabled: musicEnabled, toggle: toggleMusic } = music
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
const bgPosterSrc = computed(() => '/assets/' + (themeMode.value === 'day' ? routeBackdrop.value[0] : routeBackdrop.value[1]))
const policeIconSrc = mediaUrl(MEDIA_FILES.policeIcon)

const {
  audioRef,
  src: bgMusicSrc,
  onTime: onMusicTime,
  onDuration: onMusicDuration,
  onPlay: onMusicPlay,
  onPause: onMusicPause,
  onEnded: onMusicEnded,
  onVolumeChange: onMusicVolumeChange,
} = useGlobalMusicPlayer(music)

const { settings } = useSiteSettings()
const footerMetaVisible = computed(() => hasFooterMeta(settings.value))
const settingsOpen = ref(false)
const openSettings = () => {
  closeNav()
  settingsOpen.value = true
}
const setMusicOn = value => music.setEnabled(value)
</script>
