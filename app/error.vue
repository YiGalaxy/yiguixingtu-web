<template>
  <div class="err-page">
    <!-- 背景：用 CSS 渐变画星空，不引背景视频 ——
         404 是边缘路径，没必要为它加载一个 12MB 的视频。
         站点主色 #0e1a36 + 主题金 #f2c14e 保持不变，观感是连贯的。 -->
    <div class="err-bg"/>

    <div class="err-box">
      <div class="err-brand"><span class="mk">✦</span> 亿轨星途</div>

      <div class="err-code">{{ code }}</div>
      <h1 class="err-title">{{ title }}</h1>
      <p class="err-msg">{{ message }}</p>

      <div class="err-actions">
        <button class="btn primary" @click="goHome">回到首页</button>
        <button class="btn" @click="goBack">返回上一页</button>
      </div>
    </div>
  </div>
</template>

<script setup>
/*
 * =====================================================================
 * 全局错误页。
 *
 * 【它是怎么被触发的？】
 * 两个途径：
 *   ① 代码里主动抛：throw createError({ statusCode: 404, ... })
 *      —— 比如文章详情页发现这篇文章不存在 / 是草稿 / 已删除
 *   ② 路由没匹配上：访问一个根本不存在的地址，Nuxt 自动抛 404
 *
 * 【为什么要有它？】
 * 不写的话，Nuxt 会用自带的默认错误页 —— 一个白底黑字的简陋页面，
 * 和博客的暗金星空风格完全不搭，看起来像"网站挂了"。
 *
 * 【注意】error.vue 会【整体替换】app.vue，所以：
 *   · 顶部导航、背景视频都不会出现（这就是这里要自己画背景的原因）
 *   · 它是一个独立的、必须自包含的页面
 *
 * 出参：props.error 就是那个被抛出来的错误对象
 * =====================================================================
 */
const props = defineProps({
  error: { type: Object, default: () => ({}) },
})

const code = computed(() => props.error?.statusCode || 500)

const title = computed(() => {
  switch (code.value) {
    case 404: return '这条轨道上没有东西'
    case 403: return '你没有权限进入这里'
    case 401: return '需要先登录'
    default:  return '出了点问题'
  }
})

const message = computed(() => {
  switch (code.value) {
    case 404: return '页面不存在，或者它已经被删掉了。检查一下地址有没有输错？'
    case 403: return '这个页面只对管理员开放。'
    case 401: return '请先登录后再访问。'
    default:  return props.error?.statusMessage || '服务器开小差了，稍后再试试。'
  }
})

/** 回首页。clearError 会把错误状态清掉，否则页面会一直卡在错误态。 */
const goHome = () => clearError({ redirect: '/' })

/** 回上一页；没有历史记录时退回首页 */
const goBack = () => {
  if (import.meta.client && window.history.length > 1) {
    window.history.back()
  } else {
    clearError({ redirect: '/' })
  }
}

useHead({ title: computed(() => code.value + ' · 亿轨星途') })
</script>

<style scoped>
.err-page {
  position: relative;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 24px;
  overflow: hidden;
}

/* 星空底：两层径向渐变当"星云"，再叠一层线性渐变定基调 */
.err-bg {
  position: fixed;
  inset: 0;
  z-index: 0;
  background:
    radial-gradient(900px 500px at 20% 15%, rgba(89,214,230,.10), transparent 60%),
    radial-gradient(800px 600px at 80% 80%, rgba(242,193,78,.10), transparent 62%),
    linear-gradient(160deg, #0e1a36 0%, #0a1226 60%, #070d1c 100%);
}
/* 一点点星点，用重复径向渐变做，不额外加载图片 */
.err-bg::after {
  content: '';
  position: absolute;
  inset: 0;
  background-image:
    radial-gradient(1.5px 1.5px at 12% 22%, rgba(255,255,255,.85), transparent),
    radial-gradient(1.5px 1.5px at 68% 12%, rgba(255,255,255,.6), transparent),
    radial-gradient(1.5px 1.5px at 84% 46%, rgba(255,255,255,.75), transparent),
    radial-gradient(1.5px 1.5px at 32% 74%, rgba(255,255,255,.55), transparent),
    radial-gradient(1.5px 1.5px at 55% 88%, rgba(255,255,255,.7), transparent),
    radial-gradient(1.5px 1.5px at 92% 86%, rgba(255,255,255,.5), transparent);
  opacity: .8;
}

.err-box {
  position: relative;
  z-index: 1;
  max-width: 520px;
  width: 100%;
  text-align: center;
  padding: 56px 40px 48px;
  border-radius: 26px;
  background: rgba(16, 26, 48, .72);
  border: 1px solid rgba(180, 210, 245, .14);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .07), 0 30px 80px rgba(0, 0, 0, .5);
}

.err-brand {
  display: inline-flex; align-items: center; gap: 8px;
  font-weight: 800; font-size: 15px; letter-spacing: 1px;
  color: var(--ink, #e8f0fb); margin-bottom: 26px;
}
.err-brand .mk { color: var(--accent, #f2c14e); }

.err-code {
  font-size: 84px; font-weight: 900; line-height: 1;
  background: linear-gradient(135deg, #f2c14e, #59d6e6);
  -webkit-background-clip: text; background-clip: text; color: transparent;
  margin-bottom: 8px;
}

.err-title { font-size: 22px; font-weight: 800; color: var(--ink, #e8f0fb); margin: 0 0 14px; }
.err-msg { color: var(--muted, #9db0cc); font-size: 14px; line-height: 1.8; margin: 0 0 32px; }

.err-actions { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
.btn {
  background: rgba(255, 255, 255, .06);
  border: 1px solid rgba(180, 210, 245, .2);
  color: var(--ink, #e8f0fb);
  padding: 11px 28px; border-radius: 999px; cursor: pointer;
  font-size: 14px; font-weight: 600;
  transition: transform .2s, border-color .2s, color .2s, box-shadow .2s;
}
.btn:hover { transform: translateY(-2px); border-color: rgba(242,193,78,.55); color: var(--accent, #f2c14e); }
.btn.primary {
  background: linear-gradient(135deg, #f2c14e, #e0a92f);
  border-color: transparent; color: #0a1224;
}
.btn.primary:hover { color: #0a1224; box-shadow: 0 12px 30px rgba(242,193,78,.3); }

@media (max-width: 560px) {
  .err-box { padding: 40px 24px 36px; border-radius: 20px; }
  .err-code { font-size: 64px; }
}
</style>
