<template>
  <!--
    站点设置（**只有保存，没有新建、没有删除**）。
    【为什么是一个表单而不是列表】这份数据只有一份（后端 site_setting 表永远只有
    id = 1 那一行）：没有"新建"（后端根本没有 POST /admin/setting，发了会 405），
    也没有"删除"（不要了就改回默认值）。所以按钮只有「保存」与「重新载入」。

    【它读的是**公开**的 GET /setting】与关于管理同一个判断：前台那个 GET 就是这份
    数据的唯一读法（字段与这里一模一样），而且保存会推进缓存版本号、缓存立刻失效 ——
    后台读到的一定是最新的。再开一个"后台专用读"只是多一处要维护、要写测试的东西。

    【⚠️ 这些字段各自影响页面上很不一样的一处 —— 所以每一项都要写清"它管哪里"】
      站点名     → 页眉、页脚、首页个人卡片、后台侧栏、浏览器标题后缀（`标题 · 站点名`）、
                   og:site_name、以及"没有自己摘要的页面"的默认描述开头
      首页公告   → 首页顶部那一条（留空则整块不渲染）
      评论总开关 → 文章页的评论区（关掉之后不再显示评论框）
      每页条数   → 首页文章瀑布流一次显示几篇
      页脚两行   → 页脚的版权与备案号（各自留空则各自不渲染）

    【字段上限 50 / 500 / 50 / 200 与 1~50】抄自后端 SettingForm 的 @Size / @Min / @Max
    （app/utils/siteSettings.ts 的 SETTING_LIMITS 是同一份数字，两边对照着看）。
    前端拦一道只是本地即时反馈，真正的校验在后端。
  -->
  <header class="top">
    <h1>设置</h1>
    <p>站点设置只有一份：这里只能保存，没有新建与删除。</p>
  </header>

  <div class="toolbar glass">
    <el-button type="primary" :loading="saving" @click="save">保存</el-button>
    <el-button :loading="loading" @click="load">重新载入</el-button>
    <span class="tb-hint">保存后会立刻刷新前台的站点外壳（页眉页脚、公告、评论开关），不用手动刷新页面。</span>
  </div>

  <div class="panel glass">
    <!-- 【为什么提示留在这里而不是只弹 toast】保存失败时用户要做的动作是"改一改
         再点一次保存"，而 toast 三秒就消失了 —— 那时他还在这个表单上。
         三种颜色各有语义：'info' 是说明、'ok' 是成功、'error' 才是要处理的问题。 -->
    <p v-if="notice" class="st-notice" :class="`is-${noticeKind}`">{{ notice }}</p>

    <div class="af-row">
      <span class="ed-label">站点名</span>
      <el-input v-model="form.siteName" placeholder="比如：亿轨星途" :maxlength="SETTING_LIMITS.siteName" show-word-limit />
      <span class="af-hint">出现在页眉、页脚、浏览器标题（`标题 · 站点名`）与分享卡片上。</span>
    </div>

    <div class="af-row">
      <span class="ed-label">首页公告</span>
      <el-input
        v-model="form.announcement" type="textarea" :rows="3"
        placeholder="留空则首页不显示公告条" :maxlength="SETTING_LIMITS.announcement" show-word-limit />
      <span class="af-hint">只有一行的短通知（最多 500 字）。要写长内容应该去发一篇文章。</span>
    </div>

    <div class="af-row st-switch-row">
      <span class="ed-label">评论</span>
      <el-switch v-model="form.commentEnabled" active-text="开启" inactive-text="关闭" />
      <!-- 【说清"关闭"到底关掉了什么】这是最容易被误解的一项：
           关掉之后**已有的评论仍然可见**，只是不再显示发表评论的表单。
           不说清的话，站长会以为"关掉评论"是把已有评论也删了，于是不敢点。 -->
      <span class="af-hint">
        关闭后文章页不再显示「发表评论」表单；<b>已有的评论仍然可见</b>，
        后端也会拒绝新的提交（不是"前端藏起来"而已）。
      </span>
    </div>

    <div class="af-row st-switch-row">
      <span class="ed-label">每页条数</span>
      <el-input-number v-model="form.pageSize" :min="PAGE_SIZE_MIN" :max="PAGE_SIZE_MAX" :step="1" />
      <!-- 上限必须与文章接口的分页上限一致（都是 50）：接口那边超出会被静默夹到 50，
           这里若允许更大的值，站长会得到一个"保存成功但首页还是只列 50 篇"的开关。 -->
      <span class="af-hint">首页文章区一次显示几篇（{{ PAGE_SIZE_MIN }} ~ {{ PAGE_SIZE_MAX }}，上限与接口的分页上限一致）。</span>
    </div>

    <div class="af-row">
      <span class="ed-label">页脚版权</span>
      <el-input v-model="form.copyright" placeholder="比如：© 2026 亿轨星途（留空则不显示）" :maxlength="SETTING_LIMITS.copyright" />
    </div>

    <div class="af-row">
      <span class="ed-label">ICP 备案号</span>
      <el-input v-model="form.icpNumber" placeholder="比如：京ICP备12345678号-1（留空则不显示）" :maxlength="SETTING_LIMITS.icpNumber" />
      <!-- 【为什么这里不校验格式】备案号的编号形态有好几种（工信部备案 / 公安联网备案 /
           各省的编号规则也不完全一样），加正则只会挡住正当输入 —— 后端也只卡长度。
           【为什么不用填链接】显示时它会被链到工信部的备案查询页（ICP_LINK 写死），
           站长没有理由填别的地址，让它可以填只会多出"填错/填成别处"的可能。 -->
      <span class="af-hint">
        填了就会出现在页脚，并自动链接到<a :href="ICP_LINK" target="_blank" rel="noopener noreferrer">工信部备案系统</a>；
        只填号本身，不用填链接（备案号是国家要求展示的信息）。
      </span>
    </div>

    <p class="st-foot">
      这些设置决定的是整站外壳（每一页都会读它），所以保存后前台会立刻跟着变 ——
      页眉的站名、页脚的版权与备案号、首页的公告，都不需要重新部署。
    </p>
  </div>
</template>

<script setup>
// ================================================================
// app/components/admin/SettingsPanel.vue
//
// 作用：后台「设置」面板，只对接两个接口：
//   · GET /setting         —— 读（公开接口，但这就是这份数据的唯一读法）
//   · PUT /admin/setting   —— 保存（单条更新，返回 Result<Void>：**没有 data**）
//
// 【为什么保存成功之后要重新读一次，而不是把表单值当成"已保存的内容"】
//   与关于管理同一条理由：后端保存时会做归一化（空串 → null、trim），
//   所以"我提交的"和"库里现在是什么"不一定完全一样。重读一次拿到的才是真实状态。
//
// 【⚠️ 保存之后还要让前台的站点外壳重新取一次数据】
//   app.vue（页眉页脚）与首页读的是同一个 key 的 useAsyncData。
//   不刷新的话，站长刚把站点名改掉、抬头一看页眉还是旧名字 —— 他会以为保存没生效，
//   然后再点一次保存（于是审计里多一条无意义的记录）。
//   所以下面 save() 里调了 refreshNuxtData('site-settings')。
//
// 【技术栈与关键字】
//   · useApi().request    —— 统一请求入口（自动带 token、判 401/403、带追踪号）
//   · refreshNuxtData     —— Nuxt 提供的"按 key 重新取 useAsyncData"，
//                            这里用它把外壳那份设置刷新掉
//   · SETTING_LIMITS / PAGE_SIZE_MIN / PAGE_SIZE_MAX / DEFAULT_SITE_SETTINGS
//                            —— app/utils/siteSettings.ts 里的常量，与后端注解同一套数字
//   · 站点设置的归一化（空串→null、条数夹取）在 app/utils/siteSettings.ts，
//     不在这个组件里：它是纯函数、有单测，读它的还有外壳与页面
// ================================================================

import {
  DEFAULT_SITE_SETTINGS,
  ICP_LINK,
  PAGE_SIZE_MAX,
  PAGE_SIZE_MIN,
  SETTING_LIMITS,
  normalizeSiteSettings,
} from '~/utils/siteSettings'

const { request } = useApi()

const loading = ref(false)
const saving = ref(false)

/** 面板上那句话（三种语义，与关于管理同一套：info 说明 / ok 成功 / error 要处理） */
const notice = ref('')
const noticeKind = ref('info')

const setNotice = (text, kind = 'info') => {
  notice.value = text
  noticeKind.value = kind
}

/**
 * 表单。字段名与后端 SettingForm **逐字一致**
 * （siteName / announcement / commentEnabled / icpNumber / copyright / pageSize）——
 * 名字写错时后端拿不到值，而它不会报错，只会把那一栏存成空（最像"界面坏了"的一种失败）。
 *
 * 【为什么初值取自 DEFAULT_SITE_SETTINGS】那一行还没读回来时表单不该是空的
 * （用户可能已经看到表单并开始填）；用"上线前的站点表现"当初值最不容易误导。
 * commentEnabled 与 pageSize 在这里是**原生类型**（boolean / number），
 * 因为 el-switch 与 el-input-number 用的就是它们，不用再转一层。
 */
const form = reactive({
  siteName: DEFAULT_SITE_SETTINGS.siteName,
  announcement: '',
  commentEnabled: DEFAULT_SITE_SETTINGS.commentEnabled,
  icpNumber: '',
  copyright: '',
  pageSize: DEFAULT_SITE_SETTINGS.pageSize,
})

/** 后端给的更新时间（保存成功重读之后刷新），拿不到就整句不渲染 */
const updatedAt = ref('')

/** 把接口返回的内容填进表单：先过一遍归一化，再逐字段铺开 */
const fillForm = (data) => {
  const s = normalizeSiteSettings(data)
  form.siteName = s.siteName
  // 归一化把 null 变成了 null，而输入框需要空串（null 会让 el-input 显示成 "null"）
  form.announcement = s.announcement ?? ''
  form.commentEnabled = s.commentEnabled
  form.icpNumber = s.icpNumber ?? ''
  form.copyright = s.copyright ?? ''
  form.pageSize = s.pageSize
  updatedAt.value = data?.updateTime ? formatDateTime(data.updateTime) : ''
}

/**
 * 读一次站点设置。
 *
 * 【失败时保留表单里已有的内容，只提示一句】把表单清空的话，用户会以为
 * "我填的东西丢了"，而实际上只是这一次请求没成功。
 *
 * @param {{silent?: boolean}} [options] silent = 成功时不改面板上那句话
 *   （保存流程里会用到：那时该显示的是"保存成功"，而不是"已读取" —— 见 save 里的说明）
 * @returns {Promise<boolean>} 读到了没有（保存流程据此决定要显示哪句话）
 */
const load = async ({ silent = false } = {}) => {
  loading.value = true
  try {
    const res = await request('/setting')
    if (res.ok && res.data) {
      fillForm(res.data)
      if (!silent) setNotice('已读取当前的站点设置。', 'info')
      return true
    }
    // 读不到时**不动表单**：那里面可能正是用户刚填了一半的内容
    setNotice('读取站点设置失败，表单里显示的还是上一次读到的内容。', 'error')
    return false
  } finally {
    // finally：不管成功失败都收掉 loading，否则一次异常会让按钮永久转圈
    loading.value = false
  }
}

/**
 * 保存。
 *
 * 【为什么站点名空着时一个请求都不发】它是必填（后端 @NotBlank），
 * 空着提交必然被拒；本地先拦一道能让用户立刻看到原因，而不是等一个来回。
 * 拦下之后**必须把原因写在面板上**，不能只弹 toast —— 不然用户会以为保存按钮坏了。
 */
const save = async () => {
  const siteName = form.siteName.trim()
  if (!siteName) {
    setNotice('站点名不能为空：它会出现在页眉页脚与浏览器标题里。', 'error')
    return
  }

  saving.value = true
  try {
    const res = await request('/admin/setting', {
      method: 'PUT',
      // 【为什么逐字段写而不是直接把 form 传过去】多传的字段后端会忽略，
      // 但显式列出来能让"到底提交了什么"在这段代码里一眼看全，
      // 也避免以后 form 里加了纯界面用的字段（比如 isDirty）被顺手提交上去
      body: {
        siteName,
        announcement: form.announcement,
        commentEnabled: form.commentEnabled,
        icpNumber: form.icpNumber,
        copyright: form.copyright,
        pageSize: form.pageSize,
      },
    })

    if (!res.ok) {
      // 后端会给出具体原因（比如"每页条数最多 50"），原样显示比笼统一句有用得多
      setNotice(res.message || '保存失败，请检查填写的内容。', 'error')
      return
    }

    // 重读一次：拿到的才是库里的真实状态（后端做了归一化）。
    // ⚠️ silent：这一步**不能**覆盖"保存成功"那句话 —— 用户刚点完保存，
    //    第一眼要看到的是"存进去了"。第一版没加这个参数，
    //    结果是保存成功后提示变成了"已读取当前的站点设置"（用例抓到的）。
    const reloaded = await load({ silent: true })
    setNotice(
      reloaded
        ? '保存成功，前台已经跟着变了。'
        : '保存成功，但重新读取失败了 —— 表单里显示的还是上一次读到的内容。',
      'ok',
    )
    // toast 与面板上那句话都要有：toast 给"我这一下点成功了"的即时反馈，
    // 面板上那句留给"用户回头再看这个表单时"（toast 三秒就没了）
    ElMessage.success('保存成功')

    // 让前台的站点外壳（页眉页脚 / 公告 / 评论开关 / 每页条数）立刻重新取一次。
    // 【为什么单独 try/catch】刷新外壳失败不该让"保存成功"变成一个错误提示 ——
    // 数据已经存进去了，那才是用户关心的事；外壳最迟下次刷新页面也会跟上。
    // 把刷新失败说成"保存失败"，用户会再点一次保存（于是审计里多一条无意义的记录）。
    try {
      await refreshNuxtData('site-settings')
    } catch {
      // 只影响"立刻看到变化"，不影响数据是否保存成功，所以不打扰用户
    }
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<style scoped>
/*
  【为什么这些样式写在面板里，而 .panel / .toolbar / .af-row / .ed-label 不写】
    admin.vue 里有一段"被多个面板共用的展示规则"（.panel / .toolbar / .top 等），
    那些是**跨面板一致**的东西，写在页面级才是对的。
    这里只放这一页独有的：提示条与"标签 + 控件 + 说明"那一列的对齐。
*/
.st-notice {
  margin: 0 0 18px; padding: 10px 14px; border-radius: 10px;
  font-size: 13px; line-height: 1.7;
}
.st-notice.is-info { color: var(--muted); background: rgba(150, 190, 240, .10); }
.st-notice.is-ok { color: var(--accent); background: rgba(242, 193, 78, .12); }
.st-notice.is-error { color: #f56c6c; background: rgba(245, 108, 108, .12); }

/* 开关 / 数字框那两行：控件不拉伸，说明单独占一行 */
.st-switch-row { align-items: flex-start; }
.st-switch-row .af-hint { margin-top: 6px; }
.st-switch-row .el-switch, .st-switch-row .el-input-number { flex: 0 0 auto; }

.st-foot { color: var(--muted); font-size: 12px; line-height: 1.7; margin: 8px 0 0; }
</style>
