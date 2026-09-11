<template>
  <!--
    友链管理（增删改）。
    【形状与「收藏管理 / 项目管理」对齐】列表 + 新建/编辑弹窗 + 二次确认删除。
    【这一页唯一值得单独说明的字段是 avatar】后端允许两种形态：
    http(s) 外链（上传接口返回的绝对地址），或 `/` 开头的站内路径
    （图直接放在前端仓库的 public 目录里）—— 所以这里的格式预检用的是
    checkImageUrl 那一档（比外链宽），而不是只认 http(s)。

    【为什么字段上限是 50 / 255 / 255 / 200】抄自后端 FriendLinkForm 的 @Size 注解
    （app/utils/contentForm.ts 里有逐条对照），与数据库列宽、Service 常量三处一致。
  -->
  <header class="top">
    <h1>友链管理</h1>
    <p>共 {{ links.length }} 个友链（含隐藏的；前台只显示状态为「显示」的那些）</p>
  </header>

  <div class="toolbar glass">
    <el-button type="success" @click="openCreate">+ 新建友链</el-button>
    <el-button @click="load">刷新</el-button>
    <span class="tb-hint">「隐藏」会让这个站点立刻从前台消失；数据还在，改成「显示」就回来了。</span>
  </div>

  <div class="panel glass">
    <el-table
      v-loading="loading" :data="links"
      empty-text="还没有友链，点左上角「新建友链」加一个吧">
      <el-table-column prop="id" label="ID" width="70" />
      <el-table-column prop="name" label="站点名称" min-width="160">
        <template #default="{ row }"><span class="art-title">{{ textOf(row.name) }}</span></template>
      </el-table-column>
      <!-- 后台也遵守与前台同一套白名单（isExternalUrl：只认 http(s)），
           非法地址退化成文字 —— 后台同样没有理由把 javascript: 放进 href -->
      <el-table-column prop="url" label="站点地址" min-width="180" show-overflow-tooltip>
        <template #default="{ row }">
          <a v-if="isExternalUrl(row.url)" class="lp-link" :href="row.url" target="_blank" rel="noopener">{{ row.url }}</a>
          <span v-else class="lp-muted">{{ textOf(row.url) }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="description" label="简介" min-width="150" show-overflow-tooltip>
        <template #default="{ row }">{{ textOf(row.description) }}</template>
      </el-table-column>
      <el-table-column prop="sort" label="排序" width="80" />
      <el-table-column prop="status" label="状态" width="90">
        <template #default="{ row }">
          <el-tag :type="row.status === 0 ? 'info' : 'success'" size="small" effect="plain">
            {{ row.status === 0 ? '隐藏' : '显示' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="createTime" label="创建时间" width="150">
        <template #default="{ row }">{{ formatDateTime(row.createTime) }}</template>
      </el-table-column>
      <!-- 操作列 flex + nowrap：按钮永远排一行（理由同收藏管理） -->
      <el-table-column label="操作" width="160" fixed="right">
        <template #default="{ row }">
          <div class="lp-acts">
            <el-button size="small" @click="openEdit(row)">编辑</el-button>
            <el-button size="small" type="danger" @click="remove(row)">删除</el-button>
          </div>
        </template>
      </el-table-column>
    </el-table>
  </div>

  <!-- ==================== 新建 / 编辑友链弹窗 ==================== -->
  <el-dialog
    v-model="editVisible" class="art-edit-modal" :title="form.id ? '编辑友链' : '新建友链'"
    width="min(560px, 92vw)" :close-on-click-modal="false">
    <div class="af-row">
      <span class="ed-label">名称</span>
      <el-input
        v-model="form.name" placeholder="比如：某某的博客"
        maxlength="50" show-word-limit @keyup.enter="save" />
    </div>

    <div class="af-row">
      <span class="ed-label">地址</span>
      <el-input
        v-model="form.url" placeholder="https://example.com"
        maxlength="255" @keyup.enter="save" />
    </div>

    <div class="af-row">
      <span class="ed-label">头像</span>
      <!-- 【上传与手填两种都要能用 —— 有意的，不是没删干净】
           · 上传：照文章弹窗那一套（el-upload + auto-upload=false + on-change → useUpload）
           · 手填：友链的头像常常就是**对方站点现成的图标地址**（贴过来最省事），
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
          支持 {{ ALLOWED_EXTENSIONS.join(' / ') }}，单张不超过 {{ MAX_SIZE_TEXT }}
        </span>
      </div>
    </div>

    <div class="af-row">
      <span class="ed-label">简介</span>
      <el-input
        v-model="form.description" type="textarea" :rows="3"
        placeholder="一句话介绍这个站点（可以留空）"
        maxlength="200" show-word-limit />
    </div>

    <div class="af-row">
      <span class="ed-label">排序</span>
      <el-input-number v-model="form.sort" :min="0" :max="9999" controls-position="right" />
      <span class="af-hint">越小越靠前</span>
    </div>

    <div class="af-row">
      <span class="ed-label">状态</span>
      <el-select v-model="form.status" class="lp-select">
        <el-option label="显示（前台可见）" :value="1" />
        <el-option label="隐藏（前台看不到）" :value="0" />
      </el-select>
    </div>

    <!-- 失败原因留在弹窗里：toast 三秒就消失，而用户此刻正看着弹窗准备改 -->
    <p v-if="formError" class="ed-error">{{ formError }}</p>

    <template #footer>
      <span class="af-foot-tip">名称与地址首尾的空格会被自动去掉</span>
      <el-button @click="editVisible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="save">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ElMessage, ElMessageBox } from 'element-plus'

// ================================================================
// app/components/admin/LinksPanel.vue
//
// 作用：后台「友链管理」面板，对接四个接口（全部要求 ADMIN，走 useApi 自动带 token）：
//   · GET    /admin/link/list —— 列表（含隐藏的，不走缓存）
//   · POST   /admin/link      —— 新建，返回 Result<Long>
//   · PUT    /admin/link/{id} —— 编辑，返回 Result<Void>
//   · DELETE /admin/link/{id} —— 删除（逻辑删除）
//
// 【"隐藏"到底做了什么 —— 值得在代码里写清楚】
//   前台 GET /link/list 的过滤写在**后端的 SQL 层**（status = 1，见后端 LinkController 注释）。
//   所以这里的"隐藏"是真的不让接口返回它，而不是"前台拿到但不渲染"——
//   后一种做法会让"暂时不想公开的站点"出现在 DevTools 的响应里，
//   而且任何一个忘了过滤的消费方都会让隐藏失效。前端这边什么都不用做。
//
// 【技术栈与关键字】
//   · asList / isExternalUrl / textOf：本批新增的共享纯函数（app/utils/contentList.ts）
//   · LINK_LIMITS / checkRequiredText / checkOptionalText / checkExternalUrl /
//     checkImageUrl / checkStatus：本批新增的表单预检（app/utils/contentForm.ts），
//     数字来自后端 FriendLinkForm 的注解
//   · formatDateTime：时间显示的唯一规则（app/utils/time.ts）
// ================================================================

const { request } = useApi()

const links = ref([])
const loading = ref(false)

const editVisible = ref(false)
const saving = ref(false)
/** 保存失败时显示在弹窗里的原因（toast 会消失，弹窗不会） */
const formError = ref('')

/** 表单：id 为 null 表示"新建"，否则是编辑 */
const form = reactive({ id: null, name: '', url: '', avatar: '', description: '', sort: 0, status: 1 })

// ---------- 头像上传 ----------
// 【为什么不自己写上传，也不自己拼 FormData】类型/大小的前端预检、FormData 的字段名、
//   POST /upload 的调用与 `data.url` 的解析都在 app/composables/useUpload.ts 里，
//   它已经有一整套用例。这里再写一套的后果是两套规则迟早不一致
//   （大小上限改了只改一处，另一处静默放行）。这里只负责"转成调用 + 反馈结果"。
const { upload: uploadAvatar, ALLOWED_EXTENSIONS, MAX_SIZE_TEXT } = useUpload()
const avatarUploading = ref(false)

/**
 * el-upload 选中文件后的回调（`:auto-upload="false"` 时由它接管上传）。
 * 【注意 uploadFile.raw】on-change 给的是包装对象，真正的浏览器 File 在 `.raw` 上。
 * 【绝不能用 el-upload 的 action 直传】那条路不带 Authorization 头，后端会 401
 *   （它走自己的 XHR，绕过了 useApi）。
 * 【失败时不动 form.avatar】只有成功才赋值 —— 原来的地址必须留着：
 *   清空的话用户会以为"我那张图丢了"，而且一保存就把友链头像真的清掉了。
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

/** 拉列表（失败或结构不对时列表为空，但页面不崩） */
const load = async () => {
  loading.value = true
  const res = await request('/admin/link/list')
  loading.value = false
  links.value = asList(res)
}

const openCreate = () => {
  form.id = null
  form.name = ''
  form.url = ''
  form.avatar = ''
  form.description = ''
  form.sort = 0
  // 新建默认"显示"：与后端一致（FriendLink.STATUS_VISIBLE = 1）
  form.status = 1
  formError.value = ''
  editVisible.value = true
}

const openEdit = (row) => {
  form.id = row.id
  form.name = row.name || ''
  form.url = row.url || ''
  // 可选字段可能是 null（后端把空串归一成 null 存的），显式兜成空串：
  // 它们还会被 .trim() 用到，null 上没有这个方法
  form.avatar = row.avatar || ''
  form.description = row.description || ''
  // sort / status 可能是 null：控件拿到 null 会显示成空，用户一保存就把它们变成 0 / 未选
  form.sort = Number(row.sort) || 0
  form.status = row.status === 0 ? 0 : 1
  formError.value = ''
  editVisible.value = true
}

/**
 * 保存（新建或编辑）。
 *
 * 【提交前必须 trim】后端 Service 也是先 trim 再卡长度与查重（"某某的博客" 与
 *   "某某的博客 " 在后端是同一个名字），前端是"同一套规则的显示端"：
 *   不 trim 的话请求体与日志里都是脏数据，而且 maxlength 会因为空格提前截断
 *   一个本来合法的名字。
 *
 * 【avatar 为什么用 checkImageUrl 而不是 checkExternalUrl】
 *   后端 UrlPatterns.IMAGE_URL 比外链那一档多允许一种形态：`/` 开头的站内路径
 *   （图放在前端仓库的 public 目录里是正当用法）。用外链那一档判会把它判成非法 ——
 *   用户会遇到"界面不让保存、后端其实能收"这种无从下手的情况。
 */
const save = async () => {
  formError.value = ''

  const name = rawText(form.name)
  const url = rawText(form.url)
  const avatar = rawText(form.avatar)
  const description = rawText(form.description)
  const status = Number(form.status)

  const error = checkRequiredText(name, '站点名称', LINK_LIMITS.name)
    || checkRequiredText(url, '站点地址', LINK_LIMITS.url)
    // 地址是必填的（后端 @NotBlank）：友链没有地址就没有意义
    || (isExternalUrl(url) ? '' : '站点地址必须以 http:// 或 https:// 开头')
    || checkImageUrl(avatar, '头像地址', { maxLength: LINK_LIMITS.avatar })
    || checkOptionalText(description, '简介', LINK_LIMITS.description)
    || checkStatus(status)
  if (error) {
    formError.value = error
    return
  }

  // 防连点：按钮上虽然有 :loading，但两次点击落在同一帧时它还没重绘
  if (saving.value) return
  saving.value = true

  // 空串由后端归一化成 null（"没有值"只有一种表示），前端不替它做这件事：
  // 归一化的规则只在后端一处
  const body = { name, url, avatar, description, sort: Number(form.sort) || 0, status }
  const isEdit = !!form.id

  const res = isEdit
    ? await request('/admin/link/' + form.id, { method: 'PUT', body })
    : await request('/admin/link', { method: 'POST', body })

  saving.value = false

  if (res.ok) {
    // 重新拉列表：sort 是后端排的，本地插进去的位置不一定对
    ElMessage.success(isEdit ? '已保存' : '友链已创建')
    editVisible.value = false
    load()
    return
  }

  // 【404 = 这个友链已经被别人删掉了】自愈：提示 + 关弹窗 + 重拉列表
  //   （留着弹窗只会让用户对着一条不存在的记录再点一次保存，又撞一次 404）
  if (res.code === 404) {
    ElMessage.warning('这个友链已经不在了，列表已刷新')
    editVisible.value = false
    load()
    return
  }

  // 其它失败：弹窗留着 + 把后端的原因写在弹窗里
  formError.value = res.message || '保存失败，请稍后再试'
}

/**
 * 删除（后端是逻辑删除：前台后台都不再显示，界面上无法恢复）。
 * 【取消时一个请求都不发】ElMessageBox.confirm 在用户点"取消"时 reject，
 *   必须 try/catch 之后 return —— 漏了这一步，用户点了取消，删除请求照样发。
 */
const remove = async (row) => {
  try {
    await ElMessageBox.confirm(
      `确定要删除友链「${textOf(row.name)}」吗？删除后前台与后台都不再显示，界面上无法恢复。`,
      '危险操作',
      { type: 'error', confirmButtonText: '确认删除', cancelButtonText: '取消' },
    )
  } catch { return }

  const res = await request('/admin/link/' + row.id, { method: 'DELETE' })
  if (res.ok) {
    ElMessage.success('已删除')
    load()
    return
  }
  // 404：别人已经删过了 —— 提示 + 重拉列表（自愈）
  if (res.code === 404) {
    ElMessage.warning('这个友链已经不在了，列表已刷新')
    load()
  }
}

// 挂载时拉一次：父页面用 v-if 切换菜单，"切到友链管理"= 本组件被挂载
onMounted(load)
</script>

<style scoped>
/* 操作列里的按钮排一行、永不折行 */
.lp-acts { display: flex; align-items: center; gap: 8px; flex-wrap: nowrap; }

/* 站点地址列的外链：与表格文字区分开，一眼能看出可以点 */
.lp-link { color: var(--accent); text-decoration: none; }
.lp-link:hover { text-decoration: underline; }

.lp-muted { color: var(--muted); }

/* 弹窗里的状态下拉框固定宽度（不固定会撑满弹窗，左边缘与上面的输入框对不齐） */
.lp-select { width: 240px; }

/* ---------- 头像：预览 + 手填地址 + 上传按钮 ---------- */
/* flex-wrap：窄屏时按钮换到预览图下面，而不是把布局挤变形 */
.cover-field { flex: 1; display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
/* 固定尺寸 + object-fit: cover：不同长宽比的头像都显示成统一大小的缩略图。
   头像是方的，所以这里做成 64×64 的圆角方块（不是文章封面那种 96×64） */
.cover-preview {
  height: 64px; width: 64px; object-fit: cover; border-radius: 8px;
  border: 1px solid rgba(150,190,240,.18); background: #0d1b38;
}
/* 手填地址的输入框：吃掉剩下的宽度，但有个下限（窄屏时整体换行）。
   min-width: 0 是 flex 子项能被压窄的前提（默认 min-width:auto 会让长地址撑破这一行）。 */
.cover-input { flex: 1 1 200px; min-width: 0; }
.cover-btns { display: flex; align-items: center; gap: 8px; }
</style>
