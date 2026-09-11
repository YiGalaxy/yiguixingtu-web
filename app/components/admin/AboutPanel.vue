<template>
  <!--
    关于页管理（**只有保存，没有新建、没有删除**）。
    【为什么界面上没有「新建关于」这种按钮】
      关于页的数据只有一份（后端 about 表永远只有 id = 1 那一行）：
        · 没有"新建"——那一行由数据库迁移脚本插好，而且"再建一条关于信息"没有语义；
          后端**根本没有 POST /admin/about**（发了会真的返回 405）
        · 没有"删除"——不要了就清空字段。真删了前台会打开一个空页面，
          而站长又没有任何入口把它建回来
      所以这一页是一个**表单**（不是列表 + 弹窗），按钮只有「保存」与「重新载入」。
      这一条在测试里有用例守着（断言不出现"新建"按钮、且不发 POST）。

    【它读的是**公开**的 GET /about，而不是某个后台专用读接口】
      后端 AdminAboutController 的注释写明了：前台那个 GET 就是这份数据的唯一读法，
      它返回的字段与这里的表单一模一样，而且保存会推进缓存版本号、缓存立刻失效 ——
      后台读到的一定是最新的。再开一个"后台专用读"只是多一处要维护、要写测试的东西。

    【字段上限 50 / 255 / 5000 / 100 / 255 / 50 / 30】抄自后端 AboutForm 的 @Size 注解
    （app/utils/contentForm.ts 里有逐条对照）。bio 是长文本（上限 5000），
    且存的是 Markdown 原文 —— 后台这里用多行输入框原样编辑，不做 Markdown 预览，
    因为"渲染出来长什么样"由前台的关于页负责（用 MdPreview），
    这里多一套预览就等于多一套可能与前台不一致的规则。
  -->
  <header class="top">
    <h1>关于管理</h1>
    <p>关于页只有一份内容：这里只能保存，没有新建与删除。</p>
  </header>

  <div class="toolbar glass">
    <el-button type="primary" :loading="saving" @click="save">保存</el-button>
    <el-button :loading="loading" @click="load">重新载入</el-button>
    <span class="tb-hint">清空某一栏并保存，页面上就不再显示它（是保存成功了，不是没生效）。</span>
  </div>

  <div class="panel glass">
    <!-- 【为什么提示留在这里，而不是只弹一个 toast】
         保存失败（比如昵称超长、GitHub 地址格式不对）时用户要做的动作是
         "改一改再点一次保存"，而 toast 三秒后就消失了 —— 那时他还在看这个表单。
         这一页没有弹窗（它本身就是一张表单：没有"另一条记录"需要弹窗装），
         所以这句话就留在面板上，直到下一次操作把它替换掉
         （分类管理里"还有 N 篇文章在用"那句也是同样的处理）。
         ⚠️ 昵称必填这条尤其靠它：空着点保存时**一个请求都不发**，
         如果只弹 toast，用户很容易以为"保存按钮坏了"。
         【为什么有三种颜色】'info' 是说明（比如"现在还是空的"）、
         'ok' 是保存成功、'error' 才是需要处理的问题 —— 把"空内容"说成 error
         会吓人（那是后端有意放宽的正当状态，不是故障）。 -->
    <p v-if="notice" class="ab-notice" :class="`is-${noticeKind}`">{{ notice }}</p>

    <div class="af-row">
      <span class="ed-label">昵称</span>
      <!-- maxlength 与后端 @Size(max=50) 对齐；前端拦一道只是本地即时反馈 -->
      <el-input v-model="form.nickname" placeholder="比如：别太在亿啦" maxlength="50" show-word-limit />
    </div>

    <div class="af-row">
      <span class="ed-label">头像</span>
      <!-- 【上传与手填两种都要能用 —— 有意的，不是没删干净】
           · 上传：照文章弹窗那一套（el-upload + auto-upload=false + on-change → useUpload）
           · 手填：站长可能想把头像放在自己的图床 / CDN 上（那里已经有现成地址），
             把输入框拿掉会逼人先下载再上传一遍 —— 所以两种入口都留着。
             上传成功后地址会回填到这个输入框里，用户看得见、也能接着手改。
           详情见下面 onAvatarChosen 的注释。 -->
      <div class="cover-field">
        <img v-if="form.avatar" :src="form.avatar" class="cover-preview" alt="头像预览">
        <el-input
          v-model="form.avatar" class="cover-input"
          placeholder="/avatar.png 或 https://…（也可以点上传）" maxlength="255" />
        <div class="cover-btns">
          <el-upload
            :show-file-list="false"
            :auto-upload="false"
            accept="image/jpeg,image/png,image/gif,image/webp"
            :on-change="onAvatarChosen"
          >
            <el-button :loading="avatarUploading">
              {{ form.avatar ? '更换头像' : '上传头像' }}
            </el-button>
          </el-upload>
          <el-button v-if="form.avatar" plain @click="form.avatar = ''">移除</el-button>
        </div>
        <span class="af-hint">
          支持 {{ ALLOWED_EXTENSIONS.join(' / ') }}，单张不超过 {{ MAX_SIZE_TEXT }}；也可以直接粘贴图片地址
        </span>
      </div>
    </div>

    <div class="af-row ab-bio-row">
      <span class="ed-label">自我介绍</span>
      <!-- bio 上限 5000（后端 @Size(max=5000)），存 Markdown 原文。
           rows=10 是"写一段自我介绍够用、又不至于把弹窗顶出屏幕"的高度 -->
      <el-input
        v-model="form.bio" type="textarea" :rows="10"
        placeholder="支持 Markdown（比如 ## 小标题、- 列表、`代码`），关于页上会按这个样式显示"
        maxlength="5000" show-word-limit />
    </div>

    <div class="af-row">
      <span class="ed-label">邮箱</span>
      <el-input v-model="form.email" placeholder="me@example.com（可以留空）" maxlength="100" />
    </div>

    <div class="af-row">
      <span class="ed-label">GitHub</span>
      <el-input v-model="form.github" placeholder="https://github.com/you（可以留空）" maxlength="255" />
    </div>

    <div class="af-row">
      <span class="ed-label">微信</span>
      <!-- 微信/QQ 只是纯文字（后端刻意不做格式校验）：不会被渲染成链接，
           所以这里也不做格式预检，只卡长度 -->
      <el-input v-model="form.wechat" placeholder="可以留空" maxlength="50" />
    </div>

    <div class="af-row">
      <span class="ed-label">QQ</span>
      <el-input v-model="form.qq" placeholder="可以留空" maxlength="30" />
    </div>

    <p class="ab-foot">
      邮箱与 GitHub 在关于页上会变成可点的链接，所以要填成完整地址；
      <template v-if="updatedAt">最后更新：{{ updatedAt }}。</template>
    </p>
  </div>
</template>

<script setup>
import { ElMessage } from 'element-plus'

// ================================================================
// app/components/admin/AboutPanel.vue
//
// 作用：后台「关于管理」面板，只对接两个接口：
//   · GET /about         —— 读（公开接口，但这就是这份数据的唯一读法，见模板注释）
//   · PUT /admin/about   —— 保存（单条更新，返回 Result<Void>：**没有 data**）
//
// 【为什么保存成功之后要重新读一次 GET /about，而不是把表单值当成"已保存的内容"】
//   后端在保存时会做归一化（空串 → null、trim），所以"我提交的"和"库里现在是什么"
//   不一定完全一样。重读一次拿到的就是库里的真实状态 —— 这也是后端刻意让保存接口
//   只返回 Result<Void> 的配套做法（要回显就再 GET 一次，别为这一条接口多一种返回形状）。
//
// 【为什么没有 POST / 没有 DELETE】
//   单条记录的语义不存在"再建一条"。后端也没有 POST /admin/about（发了会 405），
//   所以界面上绝不能出现"新建关于"这种点了必然报错的按钮。
//
// 【技术栈与关键字】
//   · asObject / rawText：本批新增的共享纯函数（app/utils/contentList.ts）——
//     asObject 用来取"一个对象"（它会排除数组：万一接口改成返回数组，
//     这里会回落到 null 而不是把数组当对象用）
//   · ABOUT_LIMITS / checkRequiredText / checkOptionalText / checkImageUrl /
//     checkExternalUrl / checkEmail：本批新增的表单预检（app/utils/contentForm.ts），
//     数字来自后端 AboutForm 的注解
//   · formatDateTime：时间显示的唯一规则（app/utils/time.ts）
// ================================================================

const { request } = useApi()

const loading = ref(false)
const saving = ref(false)

/**
 * 面板上的那句话。
 * 【为什么要 kind 而不是一个 boolean】这里有**三种**语义完全不同的情况：
 *   · 'info'  —— 说明（"关于页现在是空的，填好点保存就会写回去"）：这是后端
 *                有意放宽的**正当状态**，不是故障；说成红字会让人以为站坏了
 *   · 'ok'    —— 保存成功
 *   · 'error' —— 需要用户处理的问题（后端拒绝的原因、真的读不到）
 * 只用一个 boolean 时，"空内容"会被迫二选一，两种都错：
 * 说成成功是假话，说成失败是吓人。
 */
const notice = ref('')
const noticeKind = ref('info')

/**
 * 表单。字段名与后端 AboutForm **逐字一致**（nickname / avatar / bio / email /
 * github / wechat / qq）—— 名字写错时后端拿不到值，而它不会报错，
 * 只会把那一栏保存成空（最像"界面坏了"的一种失败）。
 */
const form = reactive({ nickname: '', avatar: '', bio: '', email: '', github: '', wechat: '', qq: '' })

/** 后端给的更新时间（保存成功重读之后会刷新），拿不到就整句不渲染 */
const updatedAt = ref('')

// ---------- 头像上传 ----------
// 【为什么不自己写上传，也不自己拼 FormData】类型/大小的前端预检、FormData 的字段名、
//   POST /upload 的调用与 `data.url` 的解析都在 app/composables/useUpload.ts 里，
//   它已经有一整套用例。这里再写一套的后果是两套规则迟早不一致。
const { upload: uploadAvatar, ALLOWED_EXTENSIONS, MAX_SIZE_TEXT } = useUpload()
const avatarUploading = ref(false)

/**
 * el-upload 选中文件后的回调（`:auto-upload="false"` 时由它接管上传）。
 * 【注意 uploadFile.raw】on-change 给的是包装对象，真正的浏览器 File 在 `.raw` 上。
 * 【绝不能用 el-upload 的 action 直传】那条路不带 Authorization 头，后端会 401。
 * 【失败时不动 form.avatar】只有成功才赋值 —— 原来的头像 URL 必须留着：
 *   清空的话用户会以为"我的头像丢了"，而且一保存就真的把头像清掉了。
 */
const onAvatarChosen = async (uploadFile) => {
  const file = uploadFile?.raw
  if (!file) return

  avatarUploading.value = true
  try {
    const res = await uploadAvatar(file)
    if (res.ok && res.url) {
      // 后端返回 Result<{ url, ... }>：地址在 data.url 上，useUpload 已经解析成 res.url
      form.avatar = res.url
      ElMessage.success('头像上传成功')
    } else {
      ElMessage.error(res.message || '头像上传失败')
    }
  } finally {
    // finally：不管成功失败都收掉 loading，否则一次异常会让按钮永久转圈
    avatarUploading.value = false
  }
}

/** 把接口返回的对象填进表单（null 与缺字段一律兜成空串：它们还会被 .trim() 用到） */
const fillForm = (data) => {
  form.nickname = data?.nickname || ''
  form.avatar = data?.avatar || ''
  form.bio = data?.bio || ''
  form.email = data?.email || ''
  form.github = data?.github || ''
  form.wechat = data?.wechat || ''
  form.qq = data?.qq || ''
  updatedAt.value = data?.updateTime ? formatDateTime(data.updateTime) : ''
}

/**
 * 读一次关于信息。
 *
 * 【失败时保留表单里已有的内容，只提示一句】把表单清空的话，用户会以为
 * "关于页的内容丢了"，而实际上只是这一次请求没成功 —— 保留旧值最多是旧了几分钟。
 *
 * 【"接口失败"与"接口答了但没内容"必须分开说 —— 这是这一页最容易说假话的地方】
 *   后端对这张单条表有一处**有意放宽**（见 AboutServiceImpl 的注释）：
 *   那一行被人物理删掉时，读接口返回一个"壳"（只带 id 与占位昵称）；
 *   真要是一点内容都没有（`data` 为 null，或者哪天接口形状变了），
 *   正确表现是【一张可以填的空表单】+ 一句说明 —— 因为保存会自动把那一行写回来。
 *   说成"读取失败/暂时读不到"是错的：它既不是故障，也会把用户吓得不敢填。
 *   所以下面按两个条件分支：`!res.ok` 才是真读不到；`res.ok` 但没有对象 = 空内容。
 *
 * 【keepNotice 这个参数为什么必须存在 —— 这是一个真实踩到的顺序坑】
 *   保存成功后我们要"重新读一次拿库里的真实状态"，而这一读会走到本函数的成功分支。
 *   成功分支如果无条件清掉面板上那句话，顺序就变成：
 *   `notice = '已保存。'` → `load()` → 立刻被清空，
 *   于是用户点完保存**什么都没看到**，和"点了没反应"长得一模一样。
 *   所以保存那条路径传 keepNotice: true，把成功提示留住；
 *   而「重新载入」按钮不传 —— 它本来就不该留着上一次的提示。
 */
const load = async ({ keepNotice = false } = {}) => {
  loading.value = true
  const res = await request('/about')
  loading.value = false

  // ① 接口本身失败（HTTP 层出错、或 body.code 不是 200）：这才是"读不到"。
  //    无论如何都要提示（"读不到"必须让人看见，哪怕覆盖掉上一次的提示 —— 那条已经过期了）
  if (!res.ok) {
    notice.value = '关于页暂时读不到，请稍后再试（表单里保留的是上一次读到的内容）。'
    noticeKind.value = 'error'
    return
  }

  const data = asObject(res)
  if (!data) {
    // ② 接口答了 200，但不是一个对象（data 为 null / 变成了数组）：
    //    这是"现在没有内容"，不是故障。给一张空表单，并说清"保存就会写回去"。
    fillForm(null)
    notice.value = '关于页现在还没有内容。填好之后点「保存」就可以。'
    noticeKind.value = 'info'
    return
  }

  fillForm(data)
  // 成功时只有在调用方没要求保留提示的情况下才清空（见上面那段说明）
  if (!keepNotice) {
    notice.value = ''
    noticeKind.value = 'info'
  }
}

/**
 * 保存。
 *
 * 【校验顺序】先必填、再长度与格式 —— 用户一次只会看到第一条错误，
 *   所以"最该先改的那条"排在前面（昵称都没填就先说 GitHub 格式，只会让人困惑）。
 *
 * 【为什么前端也校验一遍】前端预检只是体验优化（本地即时反馈、不浪费一次往返），
 *   真正生效的永远是后端那一层。两道校验的文案刻意写成一模一样，
 *   用户看不出是哪一道拦的 —— 这正是想要的效果。
 */
const save = async () => {
  notice.value = ''

  const nickname = rawText(form.nickname)
  const avatar = rawText(form.avatar)
  const bio = rawText(form.bio)
  const email = rawText(form.email)
  const github = rawText(form.github)
  const wechat = rawText(form.wechat)
  const qq = rawText(form.qq)

  const error = checkRequiredText(nickname, '昵称', ABOUT_LIMITS.nickname)
    // bio 是长文本：**不 trim 内容本身**（Markdown 里的换行与缩进是有意义的，
    // 前后空白由 rawText 去掉就够，中间一个字都不能动）
    || checkOptionalText(bio, '自我介绍', ABOUT_LIMITS.bio)
    || checkImageUrl(avatar, '头像地址', { maxLength: ABOUT_LIMITS.avatar })
    || checkEmail(email, '邮箱', ABOUT_LIMITS.email)
    // GitHub 会被渲染成链接，所以走外链那一档白名单（后端 @Pattern 也是这一档）
    || checkExternalUrl(github, 'GitHub 地址', { maxLength: ABOUT_LIMITS.github })
    || checkOptionalText(wechat, '微信', ABOUT_LIMITS.wechat)
    || checkOptionalText(qq, 'QQ', ABOUT_LIMITS.qq)
  if (error) {
    notice.value = error
    noticeKind.value = 'error'
    return
  }

  // 防连点：按钮上虽然有 :loading，但两次点击落在同一帧时它还没重绘
  if (saving.value) return
  saving.value = true

  // 整份表单覆盖式提交（后端 AboutForm 的注释：没传的字段按清空处理）。
  // 传空串而不是不传，才是"这一栏现在就是空的"的准确表达 —— 后端会把空串归一成 null。
  const body = { nickname, avatar, bio, email, github, wechat, qq }

  const res = await request('/admin/about', { method: 'PUT', body })

  saving.value = false

  if (res.ok) {
    // 注意：这里**不读 res.data** —— /admin/about 的保存返回的是 Result<Void>（没有 data）。
    // 想回显就重新读一次 GET /about（见文件头那段说明）。
    // 这一读同时把"那一行本来不存在、保存时被后端自愈写回"这种情况也覆盖了：
    // 重读之后表单里就是库里的真实内容。
    notice.value = '已保存。'
    noticeKind.value = 'ok'
    ElMessage.success('已保存')
    // keepNotice: true —— 否则这次重读会把刚写下的「已保存。」立刻清掉
    // （用户点完保存什么都没看到，与"点了没反应"长得一模一样）
    load({ keepNotice: true })
    return
  }

  // 【失败】把后端那句话（"昵称最长 50 字" / "邮箱格式不正确" …）留在面板上。
  // useApi 已经弹过一次 toast，这里再显示一遍是为了"留在用户眼前"
  notice.value = res.message || '保存失败，请稍后再试'
  noticeKind.value = 'error'
}

// 挂载时读一次：父页面用 v-if 切换菜单，"切到关于管理"= 本组件被挂载
onMounted(load)
</script>

<style scoped>
/* 面板顶部的那句话（三种语义：说明 / 成功 / 失败）。
   说明是金色竖线（中性），失败换成错误色 + 更实的竖线 —— 失败必须比一般说明更显眼
   （用户此刻正卡在"为什么保存不了"上）；而"现在还是空的"属于说明，
   用红字会让人以为站坏了。 */
.ab-notice {
  color: var(--muted); font-size: 13px; line-height: 1.7;
  border-left: 3px solid rgba(242,193,78,.5); padding: 2px 0 2px 12px; margin: 0 0 18px;
}
.ab-notice.is-info { color: var(--muted); border-left-color: rgba(150,190,240,.45); }
.ab-notice.is-error {
  color: var(--el-color-danger, #f56c6c);
  border-left-color: var(--el-color-danger, #f56c6c);
}
.ab-notice.is-ok { color: var(--accent); border-left-color: var(--accent); }

/* 表单底部那句说明：它解释的是"哪两个字段必须是合法地址"，
   是给即将点保存的人看的，所以用弱化色放在最后一行 */
.ab-foot { color: var(--muted); font-size: 12px; line-height: 1.7; margin: 4px 0 0; }

/* 自我介绍那一行特殊：它是 10 行的多行输入框，如果沿用 .af-row 的
   align-items:center，标签会垂直居中在输入框的正中间 —— 而它标注的是
   输入框的**顶部**内容，看起来会像标错了位置。所以这一行改成顶部对齐。 */
.ab-bio-row { align-items: flex-start; }

/* ---------- 头像：预览 + 手填地址 + 上传按钮 ---------- */
/* flex-wrap：窄屏时按钮换到预览图下面，而不是把布局挤变形 */
.cover-field { flex: 1; display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
/* 固定尺寸 + object-fit: cover：头像是方的，所以用 72×72 的圆角方块
   （与前台关于页显示头像的尺寸相近，所见即所得） */
.cover-preview {
  height: 72px; width: 72px; object-fit: cover; border-radius: 12px;
  border: 1px solid rgba(150,190,240,.18); background: #0d1b38;
}
/* 手填地址的输入框：吃掉剩下的宽度，但有个下限（窄屏时整体换行）。
   min-width: 0 是 flex 子项能被压窄的前提（默认 min-width:auto 会让长地址撑破这一行）。 */
.cover-input { flex: 1 1 200px; min-width: 0; }
.cover-btns { display: flex; align-items: center; gap: 8px; }
</style>
