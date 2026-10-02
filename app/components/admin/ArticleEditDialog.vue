<template>
  <!-- New/edit article dialog. The editor is destroyed on close. -->
  <el-dialog
    v-model="visible" class="art-edit-modal"
    :title="form.id ? '编辑文章' : '新建文章'"
    width="min(1080px, 92vw)" top="4vh"
    :close-on-click-modal="false" destroy-on-close>

    <div class="af-row">
      <span class="ed-label">标题</span>
      <el-input
        v-model="form.title" placeholder="给你的文章起个标题"
        maxlength="200" show-word-limit />
    </div>

    <div class="af-row">
      <span class="ed-label">分类</span>
      <el-select
        v-model="form.categoryId" placeholder="选择分类（也可以不选）"
        clearable style="width:100%">
        <el-option v-for="c in categories" :key="c.id" :label="c.name" :value="c.id" />
      </el-select>
    </div>

    <!-- Tags are refreshed when the dialog opens and always submit tagIds. -->
    <div class="af-row">
      <span class="ed-label">标签</span>
      <el-select
        v-model="form.tagIds" multiple collapse-tags collapse-tags-tooltip
        :max-collapse-tags="4"
        :placeholder="tags.length ? '选择标签（可以不选）' : '还没有标签，去「标签管理」新建'"
        style="width:100%">
        <el-option v-for="t in tags" :key="t.id" :label="t.name" :value="t.id" />
      </el-select>
      <span class="af-hint">一个都不选就是「没有标签」</span>
    </div>

    <div class="af-row">
      <span class="ed-label">封面</span>
      <div class="cover-field">
        <img v-if="form.cover" :src="form.cover" class="cover-preview" alt="封面预览" >
        <div class="cover-btns">
          <!--
            用 el-upload 但关掉它自带的请求（auto-upload=false + on-change）：
            真正的上传逻辑在 useUpload 里，这样上传规则可以单独写测试，
            也不会因为 Element Plus 的版本差异而影响业务逻辑。
            另外不要用 el-upload 的 action 属性直接传 URL ——
            那样它不会带上 Authorization 头，后端会返回 401。
          -->
          <el-upload
            :show-file-list="false"
            :auto-upload="false"
            accept="image/jpeg,image/png,image/gif,image/webp"
            :on-change="onCoverChosen"
          >
            <el-button :loading="coverUploading">
              {{ form.cover ? '更换封面' : '上传封面' }}
            </el-button>
          </el-upload>
          <el-button v-if="form.cover" plain @click="form.cover = ''">移除</el-button>
        </div>
        <span class="af-hint">
          支持 {{ ALLOWED_EXTENSIONS.join(' / ') }}，单张不超过 {{ MAX_SIZE_TEXT }}
        </span>
      </div>
    </div>

    <div class="af-row">
      <span class="ed-label">摘要</span>
      <el-input
        v-model="form.summary" type="textarea" :rows="2"
        placeholder="留空则自动从正文截取前 120 字"
        maxlength="500" show-word-limit />
    </div>

    <div class="af-row">
      <span class="ed-label">选项</span>
      <div class="af-opts">
        <el-switch
          v-model="form.isTop" :active-value="1" :inactive-value="0"
          active-text="置顶" />
        <el-switch
          v-model="form.status" :active-value="1" :inactive-value="0"
          active-text="已发布" inactive-text="草稿" />
        <!-- 这条提示很重要：草稿是安全的默认值，不点这个开关就不会发出去 -->
        <span class="af-hint">{{ form.status === 1 ? '保存后前台立即可见' : '存为草稿，前台看不到' }}</span>
      </div>
    </div>

    <div class="af-row">
      <span class="ed-label">附件</span>
      <div class="af-attach">
        <el-upload
          :show-file-list="false"
          :auto-upload="false"
          :accept="attachmentAccept"
          :on-change="onAttachmentChosen"
        >
          <el-button :loading="attachmentUploading">上传附件</el-button>
        </el-upload>
        <!-- 【为什么附件只是"待提交的清单"、不立刻落库】
             新建文章时它还没有 id，上传即落库会产生一条挂不到任何文章的孤儿记录；
             所以这里与标签（tagIds）同一个思路：先攒在表单里，保存文章时整体提交，
             后端按提交内容【整体替换】这篇文章的附件。 -->
        <!-- 【key 为什么要带上 index】2026-09 上传改成内容寻址之后，
             同一个文件被选两次会拿到【完全相同的 url】—— 只用 url 当 key
             会出现重复 key：Vue 会警告，而且列表 patch 时可能复用错行
             （点"移除"删的是数组里的那一项，DOM 却只更新了一处）。 -->
        <ul v-if="form.attachments.length" class="af-attach-list">
          <li v-for="(item, index) in form.attachments" :key="`${item.url}-${index}`">
            <span class="af-attach-name" :title="item.name">{{ item.name }}</span>
            <span class="af-attach-size">{{ formatFileSize(item.size) }}</span>
            <el-button link type="danger" @click="removeAttachment(index)">移除</el-button>
          </li>
        </ul>
      </div>
      <span class="af-hint">
        支持 {{ ATTACHMENT_EXTENSIONS.join(' / ') }}，单个不超过 {{ ATTACHMENT_MAX_SIZE_TEXT }}，
        最多 {{ ATTACHMENT_LIMITS.count }} 个；保存后读者可在文章页下载。
      </span>
    </div>

    <div class="af-editor">
      <MdEditor
        v-model="form.content"
        theme="dark"
        language="zh-CN"
        :toolbars-exclude="['github', 'fullscreen', 'preview-html']"
        @on-upload-img="onEditorUploadImg" />
    </div>

    <template #footer>
      <span class="af-foot-tip">正文用 Markdown 写，右侧实时预览；工具栏的图片按钮可直接上传插图</span>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="saveArticle">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ElMessage } from 'element-plus'
// Markdown 编辑器。语言通过语言代码选择官方中文文案
// 样式必须单独引一次 —— 这个库不带自动注入 CSS
import { MdEditor } from 'md-editor-v3'
import 'md-editor-v3/lib/style.css'

// Categories and tags are owned by the parent so all admin views share one source.
defineProps({
  categories: { type: Array, default: () => [] },
  tags: { type: Array, default: () => [] },
})

// The parent owns both refreshes and the shared article list.
const emit = defineEmits(['refresh-tags', 'saved'])

const { request } = useApi()

const visible = ref(false)
const saving = ref(false)

/**
 * 本次「新建」动作的幂等键。
 *
 * 【为什么是"打开弹窗时生成一次"，而不是"每次点保存生成一次"】
 *   这两者的区别决定了它能不能真正防住重复提交：
 *     · 每次点保存都生成新键 → 用户点两下得到两个不同的键，
 *       后端会认为是两次不同的创建请求，照样写出两篇文章。**拦不住**。
 *     · 打开弹窗时生成一次、保存成功后换新 → 用户点两下带的是【同一个键】，
 *       后端第二次直接返回第一次的结果，只产生一篇文章。**这才拦得住**。
 *   而且还顺带覆盖另一种情况：请求超时了、用户没关弹窗又点了一次保存 ——
 *   同样是同一个键，不会写出第二篇。
 *   用户真想再写一篇时会关掉弹窗重新点「新建文章」，那时才换新键。
 *
 * 【键的生成逻辑在 useIdempotencyKey 里】抽出去是为了能单独测
 *   （"同一个动作里键不变、换动作后键变了"这两条正是它要保证的语义）。
 */
const { rotate: rotateIdempotencyKey, ensure: ensureIdempotencyKey } = useIdempotencyKey()

const form = reactive({
  id: null, title: '', summary: '', content: '', cover: '',
  categoryId: null,
  // 选中的标签 id 数组。空数组 = 这篇文章没有标签（不是"不改标签"，见 saveArticle）
  tagIds: [],
  /**
   * 附件清单（一篇文章多条）。每一项是 `{ name, url, size }`。
   * 【为什么是"待提交的清单"而不是上传即落库】新建文章时它还没有 id，
   * 上传即落库会产生挂不到任何文章的孤儿记录 —— 与标签同一个思路：
   * 攒在表单里，保存时整体提交，后端按提交内容整体替换（见 saveArticle）。
   */
  attachments: [],
  status: 0,      // 默认草稿 —— 安全默认值，避免半成品被直接发出去
  isTop: 0,
})

// ---------- 封面上传 ----------
// 逻辑都在 useUpload 里（含类型/大小的前端预检），这里只负责
// "把界面上发生的事转成调用 + 把结果反馈给用户"
const { upload: uploadCover, ALLOWED_EXTENSIONS, MAX_SIZE_TEXT } = useUpload()

// ---------- 附件上传 ----------
// 与封面走同一套 useUpload，只是换成 attachment 形态：白名单是文档/压缩包/音视频，
// 单文件上限 100MB（封面那套是图片、10MB）。三个数字都在 useUpload 的规则表里，
// 与后端 app.upload 的配置一一对应。
const {
  upload: uploadAttachment,
  ALLOWED_EXTENSIONS: ATTACHMENT_EXTENSIONS,
  MAX_SIZE_TEXT: ATTACHMENT_MAX_SIZE_TEXT,
} = useUpload('attachment')
const attachmentUploading = ref(false)

/**
 * 文件选择框的 `accept`：用**扩展名**列表而不是 MIME 类型。
 * 【为什么用扩展名】附件里有 zip / 7z / rar / md / csv 这些各平台 MIME 不一致的格式，
 * 写 MIME 会漏、而且不同系统给的值还不一样；扩展名最稳。
 * 【它只是"选择框默认筛掉什么"】用户可以切到"所有文件"照样选 ——
 * 真正的白名单校验在 useUpload 里（选错了会被拦下并说明原因）。
 */
const attachmentAccept = ATTACHMENT_EXTENSIONS.map(ext => '.' + ext).join(',')

/**
 * 编辑器工具栏「上传图片」的回调（md-editor-v3 的 `onUploadImg`）。
 *
 * 【⚠️ 为什么必须有这个函数】不接它，工具栏那个图片按钮**点了没有任何反应** ——
 *   不报错、也不提示。站长只会以为"这个功能没做"（用户就是这么反馈的）。
 *
 * 【为什么是 files 数组 + callback，而不是我们自己往正文里拼 Markdown】
 *   md-editor-v3 支持一次选多张，它把选中的文件交给我们，等我们传完再调
 *   `callback(urls)` —— 由它负责插入：**保留光标位置、以及"选中一段文字后插图片"
 *   这种把选中内容替换成图片的语义**。自己拼 `![](url)` 会丢掉这些，
 *   而且在光标不在末尾时会插到错误的位置。
 *
 * 【为什么一张都没成功也要 callback([])】不回调的话，编辑器会一直停在
 *   "上传中"，工具栏从此不可用。
 */
const onEditorUploadImg = async (files, callback) => {
  const list = Array.isArray(files) ? files : [files]
  const urls = []
  for (const file of list) {
    // 复用封面那套图片规则（白名单与 10MB 上限都在 useUpload 里）
    const res = await uploadCover(file)
    if (res.ok && res.url) urls.push(res.url)
    else ElMessage.error(res.message || '图片上传失败')
  }
  callback(urls)
}

/**
 * 选中附件（el-upload 关掉自动上传后由这个回调接管）。
 * 【注意 uploadFile.raw】el-upload 给的是包装对象，真正的 File 在 `.raw` 上。
 */
const onAttachmentChosen = async (uploadFile) => {
  const file = uploadFile?.raw
  if (!file) return

  // 数量上限在前端先拦一道（后端也会拦）：到上限时直接提示，
  // 不浪费用户一次 100MB 的上传
  if (form.attachments.length >= ATTACHMENT_LIMITS.count) {
    ElMessage.warning(`一篇文章最多 ${ATTACHMENT_LIMITS.count} 个附件`)
    return
  }

  attachmentUploading.value = true
  try {
    const res = await uploadAttachment(file)
    if (res.ok && res.url) {
      form.attachments.push({ name: res.name || file.name, url: res.url, size: res.size ?? file.size })
      ElMessage.success('附件上传成功，保存文章后生效')
    } else {
      ElMessage.error(res.message || '附件上传失败')
    }
  } finally {
    attachmentUploading.value = false
  }
}

/** 从清单里移除一个附件（真正删文件发生在保存时：后端按提交内容整体替换） */
const removeAttachment = (index) => {
  form.attachments.splice(index, 1)
}
const coverUploading = ref(false)

/**
 * el-upload 选中文件后的回调（auto-upload 关掉时由这个回调接管上传）。
 *
 * 【注意这里拿的是 uploadFile.raw】
 *   el-upload 的 on-change 给的是一个包装对象，真正的浏览器 File 在 .raw 上。
 *   直接把它当 File 用（比如读 .size）会得到 undefined。
 */
const onCoverChosen = async (uploadFile) => {
  const file = uploadFile?.raw
  if (!file) return

  coverUploading.value = true
  try {
    const res = await uploadCover(file)
    if (res.ok && res.url) {
      // 上传成功：把返回的 URL 回填到表单，保存文章时一起提交
      form.cover = res.url
      ElMessage.success('封面上传成功')
    } else {
      // 失败时提示后端给的具体原因（比如"只允许上传 xxx 格式的图片"），
      // 而不是笼统的"上传失败"—— 用户看着提示才知道该怎么改
      ElMessage.error(res.message || '封面上传失败')
    }
  } finally {
    // 放在 finally 里：不管成功失败都要把 loading 收掉，
    // 否则一次异常就会让按钮永久转圈
    coverUploading.value = false
  }
}

const resetForm = () => {
  form.id = null
  form.title = ''
  form.summary = ''
  form.content = ''
  form.cover = ''
  form.categoryId = null
  // 新建时是空数组（"还没打标签"），不是上一篇文章的标签 ——
  // 不清的话会出现"新建的文章莫名其妙带着上一篇的标签"
  form.tagIds = []
  // 附件同理：不清的话"新建的文章"会莫名其妙带着上一篇的附件
  form.attachments = []
  form.status = 0
  form.isTop = 0
}

/**
 * 把接口给的 tags（对象数组）转成表单要的 id 数组。
 * 【为什么要过滤一遍】表单里只需要 id，而 tags 里还带着 name/sort/articleCount；
 * 顺手把非数字的项丢掉，避免一个脏数据让 el-select 回显不出来
 * （那种情况的表现是"标签明明有，弹窗里却是空的"，最难查）。
 */
const tagIdsOf = (list) => (Array.isArray(list) ? list.map(t => t?.id).filter(id => Number.isInteger(id)) : [])

/** 打开「新建」（由「文章管理」面板通过 ref 调用，见下面的 defineExpose） */
const openCreate = () => {
  resetForm()
  // 每次「新建」都换一个新幂等键：这一次动作里的所有重复点击共用它。
  rotateIdempotencyKey()
  // 打开弹窗顺手刷新标签选项：用户很可能刚在「标签管理」里建完标签就来写文章。
  // 不 await —— 下拉框的数据晚几十毫秒到没关系，不该因此拖慢弹窗出现
  emit('refresh-tags')
  visible.value = true
}

/** Open edit mode after loading the full article detail. */
const openEdit = async (row) => {
  resetForm()
  form.id = row.id
  form.title = row.title
  form.summary = row.summary || ''
  form.cover = row.cover || ''
  form.categoryId = row.categoryId
  form.status = row.status
  form.isTop = row.isTop
  // 列表项其实也带着 tags，先用它回显，这样即使详情接口慢了/挂了，
  // 下拉框里也是这篇真实的标签，而不是空着（空着会让用户以为"这篇没标签"，
  // 一保存就把标签全清了）
  form.tagIds = tagIdsOf(row.tags)

  // Refresh options in parallel; wait for the detail before opening the editor.
  emit('refresh-tags')
  const detail = await request('/admin/article/' + row.id)

  // Do not open an incomplete form: saving it could clear content and attachments.
  if (!detail.ok) {
    ElMessage.error(detail.message || '文章详情读取失败，已取消打开编辑器（避免保存时清空正文与附件）')
    return
  }

  form.content = detail.data.content || ''
  // Prefer fresh tags from the detail response when present.
  if (Array.isArray(detail.data.tags)) form.tagIds = tagIdsOf(detail.data.tags)
  // Attachments exist only on the detail response; preserve unknown sizes as null.
  form.attachments = Array.isArray(detail.data.attachments)
    ? detail.data.attachments.map(a => ({ name: a?.name || '', url: a?.url || '', size: a?.size ?? null }))
    : []

  visible.value = true
}

/** 保存（新建或编辑） */
const saveArticle = async () => {
  if (!form.title.trim()) {
    ElMessage.warning('标题不能为空')
    return
  }

  // Guard against same-frame double clicks before the button re-renders.
  if (saving.value) return

  saving.value = true

  // 空字符串一律转成 null 提交：
  // 后端 update 用的是显式 SET，传 null 会真的把该字段清空，
  // 传 '' 则会往库里写一个空字符串。语义上"没填"应该是 null。
  const body = {
    title: form.title.trim(),
    summary: form.summary || null,
    content: form.content || null,
    cover: form.cover || null,
    categoryId: form.categoryId,
    // Tags use replacement semantics, so always send the complete id list.
    tagIds: [...form.tagIds],
    // Attachments are also replacement-based; send the full current list.
    attachments: form.attachments.map(a => ({ name: a.name, url: a.url, size: a.size })),
    status: form.status,
    isTop: form.isTop,
  }

  const isEdit = !!form.id

  // New articles carry an idempotency key; PUT edits are already idempotent.
  const res = isEdit
    ? await request('/admin/article/' + form.id, { method: 'PUT', body })
    : await request('/admin/article', {
        method: 'POST',
        body,
        headers: { 'Idempotency-Key': ensureIdempotencyKey() },
      })

  saving.value = false

  if (res.ok) {
    ElMessage.success(isEdit ? '已保存' : '文章已创建')
    // 保存成功后才换新键：这样"这一篇"的整个提交过程（含各种重试）
    // 都共用同一个键，下一次新建才是新的动作
    if (!isEdit) rotateIdempotencyKey()
    visible.value = false
    // 表格数据在父页面那边，抛上去让它重新拉一次
    emit('saved')
  }
}

// Keep create/edit orchestration inside the dialog; the parent only triggers it.
defineExpose({ openCreate, openEdit })
</script>

<style scoped>
/* 文章编辑弹窗的表单行：标签固定宽度，输入框吃掉剩余空间 */
.af-row { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
.af-row .ed-label { width: 56px; }
.af-row > .el-input,
.af-row > .el-select { flex: 1; }

.af-opts { display: flex; align-items: center; gap: 28px; flex-wrap: wrap; }
.af-hint { color: var(--muted); font-size: 12px; }

/* ---------- 封面：预览 + 上传按钮 ---------- */
/* 用 flex-wrap 让窄屏时按钮自动换到预览图下面，而不是把布局挤变形 */
.cover-field { flex: 1; display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
/* 固定高度 + object-fit: cover：不同长宽比的封面在这里都显示成统一大小的缩略图，
   不用去裁剪原图，也不会把表单撑高 */
.cover-preview { height: 64px; width: 96px; object-fit: cover; border-radius: 8px;
  border: 1px solid rgba(150,190,240,.18); background: #0d1b38; }
.cover-btns { display: flex; align-items: center; gap: 8px; }

.af-editor { margin-top: 8px; }
/* 编辑器这一块不参与 .af-row 的垂直居中对齐 */
/* 附件清单：每行「文件名 + 大小 + 移除」。
   文件名要能截断（用户可能传一个很长的名字），所以每层都写 min-width: 0 ——
   flex 子项的默认 min-width 是 auto，不写的话长名字会把整行撑破，而不是变成省略号。 */
.af-attach { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.af-attach-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.af-attach-list li { display: flex; align-items: center; gap: 10px; min-width: 0; }
.af-attach-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink); font-size: 13px; }
.af-attach-size { flex: 0 0 auto; color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
.af-editor .md-editor { border: 1px solid rgba(150,190,240,.18); }

/* 弹窗底部：提示语靠左，按钮靠右 */
.af-foot-tip { color: var(--muted); font-size: 12px; margin-right: auto; }
</style>
