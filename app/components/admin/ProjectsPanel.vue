<template>
  <!--
    项目管理（增删改）。
    【形状与「收藏管理 / 标签管理」对齐】列表 + 新建/编辑弹窗 + 二次确认删除。
    【它和友链管理唯一的实质差别在表单里】项目的 url（在线演示）与 repo（代码仓库）
    **至少要填一个** —— 这条规则在后端 Service 里（跨字段，注解表达不了），
    前端也拦一道（见 save()）。其余字段的可选性照后端 Form 来。

    【为什么字段上限是 100 / 500 / 255 / 200】抄自后端 ProjectForm 的 @Size 注解
    （app/utils/contentForm.ts 里有逐条对照），与数据库列宽、Service 常量三处一致。
  -->
  <header class="top">
    <h1>项目管理</h1>
    <p>共 {{ projects.length }} 个项目（含隐藏的；前台只显示状态为「显示」的那些）</p>
  </header>

  <div class="toolbar glass">
    <el-button type="success" @click="openCreate">+ 新建项目</el-button>
    <el-button @click="load">刷新</el-button>
    <span class="tb-hint">在线地址与仓库地址至少要填一个，否则项目卡片上没有任何能点的地方。</span>
  </div>

  <div class="panel glass">
    <el-table
      v-loading="loading" :data="projects"
      empty-text="还没有项目，点左上角「新建项目」加一个吧">
      <el-table-column prop="id" label="ID" width="70" />
      <el-table-column prop="name" label="项目名称" min-width="160">
        <template #default="{ row }"><span class="art-title">{{ textOf(row.name) }}</span></template>
      </el-table-column>
      <!-- 技术栈在库里是逗号分隔的字符串（后端有意这样存）：这里原样显示，
           没有就显示「—」。空字符串会渲染成一格空白，看起来像这一行没数据 -->
      <el-table-column prop="tech" label="技术栈" min-width="150" show-overflow-tooltip>
        <template #default="{ row }">{{ textOf(row.tech) }}</template>
      </el-table-column>
      <!-- 两个地址各自可选，所以两个链接都可能不存在：
           只渲染存在的那个，而不是给一个 href="" 的空链接（点了会跳到本站首页） -->
      <el-table-column label="地址" width="160">
        <template #default="{ row }">
          <div class="pp-links">
            <a v-if="isExternalUrl(row.url)" class="pp-link" :href="row.url" target="_blank" rel="noopener">在线</a>
            <a v-if="isExternalUrl(row.repo)" class="pp-link is-repo" :href="row.repo" target="_blank" rel="noopener">仓库</a>
            <span v-if="!isExternalUrl(row.url) && !isExternalUrl(row.repo)" class="pp-muted">—</span>
          </div>
        </template>
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
      <!-- 操作列 flex + nowrap：按钮永远排一行，列宽不够时由表格横向滚动（理由同收藏管理） -->
      <el-table-column label="操作" width="160" fixed="right">
        <template #default="{ row }">
          <div class="pp-acts">
            <el-button size="small" @click="openEdit(row)">编辑</el-button>
            <el-button size="small" type="danger" @click="remove(row)">删除</el-button>
          </div>
        </template>
      </el-table-column>
    </el-table>
  </div>

  <!-- ==================== 新建 / 编辑项目弹窗 ==================== -->
  <el-dialog
    v-model="editVisible" class="art-edit-modal" :title="form.id ? '编辑项目' : '新建项目'"
    width="min(600px, 92vw)" :close-on-click-modal="false">
    <div class="af-row">
      <span class="ed-label">名称</span>
      <el-input
        v-model="form.name" placeholder="比如：亿轨星途博客系统"
        maxlength="100" show-word-limit @keyup.enter="save" />
    </div>

    <div class="af-row">
      <span class="ed-label">简介</span>
      <el-input
        v-model="form.description" type="textarea" :rows="3"
        placeholder="说清做了什么、用了什么（可以留空）"
        maxlength="500" show-word-limit />
    </div>

    <div class="af-row">
      <span class="ed-label">在线地址</span>
      <el-input v-model="form.url" placeholder="https://example.com（与仓库地址至少填一个）" maxlength="255" />
    </div>

    <div class="af-row">
      <span class="ed-label">仓库地址</span>
      <el-input v-model="form.repo" placeholder="https://github.com/you/repo（与在线地址至少填一个）" maxlength="255" />
    </div>

    <div class="af-row">
      <span class="ed-label">封面图</span>
      <!-- 【上传与手填两种都要能用 —— 这是有意的，不是没删干净】
           · 上传：照文章弹窗那一套（el-upload + auto-upload=false + on-change → useUpload），
             封面很少有现成外链，多数时候是本地一张图，点按钮传完就不用管地址了
           · 手填：有人就是想贴一个外链地址（图已经在 CDN 上、或者要引用别的站的图），
             把输入框拿掉会逼他先下载再上传一遍 —— 所以两种入口都留着。
             上传成功后地址会回填到这个输入框里，用户看得见、也能接着手改。
           详情见下面 onCoverChosen 的注释。 -->
      <div class="cover-field">
        <img v-if="form.cover" :src="form.cover" class="cover-preview" alt="封面预览">
        <el-input
          v-model="form.cover" class="cover-input"
          placeholder="/uploads/cover.png 或 https://…（也可以点上传）" maxlength="255" />
        <div class="cover-btns">
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
      <span class="ed-label">技术栈</span>
      <!-- 【为什么是一个输入框而不是标签选择器】后端把 tech 存成逗号分隔的字符串
           （ProjectForm 的注释写明了理由：提交什么字符串、列表就返回什么字符串，
           最不容易出错）。前端做成标签选择器就要在这里把它拼回字符串，
           还得为"空项"定规则 —— 代价比"让用户自己打逗号"大得多。
           前台的项目卡片会用 split(',') 渲染成一行小标签。 -->
      <el-input v-model="form.tech" placeholder="Spring Boot,MySQL,Redis（逗号分隔）" maxlength="200" show-word-limit />
    </div>

    <div class="af-row">
      <span class="ed-label">排序</span>
      <el-input-number v-model="form.sort" :min="0" :max="9999" controls-position="right" />
      <span class="af-hint">越小越靠前</span>
    </div>

    <div class="af-row">
      <span class="ed-label">状态</span>
      <el-select v-model="form.status" class="pp-select">
        <el-option label="显示（前台可见）" :value="1" />
        <el-option label="隐藏（前台看不到）" :value="0" />
      </el-select>
    </div>

    <!-- 失败原因留在弹窗里（toast 三秒就消失，而用户此刻正看着弹窗准备改） -->
    <p v-if="formError" class="ed-error">{{ formError }}</p>

    <template #footer>
      <span class="af-foot-tip">名称首尾的空格会被自动去掉</span>
      <el-button @click="editVisible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="save">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ElMessage, ElMessageBox } from 'element-plus'

// ================================================================
// app/components/admin/ProjectsPanel.vue
//
// 作用：后台「项目管理」面板，对接四个接口（全部要求 ADMIN，走 useApi 自动带 token）：
//   · GET    /admin/project/list —— 列表（含隐藏的，不走缓存）
//   · POST   /admin/project      —— 新建，返回 Result<Long>
//   · PUT    /admin/project/{id} —— 编辑，返回 Result<Void>
//   · DELETE /admin/project/{id} —— 删除（逻辑删除）
//
// 【这一页最要紧的一条：在线地址与仓库地址至少要填一个】
//   这条规则在后端 ProjectServiceImpl.requireAtLeastOneAddress 里（跨两个字段，
//   单字段注解表达不了）。两个都空的项目卡片在前台【点不出任何东西】——
//   访客看到一张写着名字的卡片，点哪儿都没反应，只会以为它坏了。
//   前端也拦一道，文案与后端一字不差（把两个字段名都写出来，
//   只说"地址不能为空"的话，用户看着两个地址框会不知道说哪一个）。
//   ⚠️ 注意后端是"整份表单覆盖式提交"：编辑时没传的字段 = 用户把它清空了，
//   所以这条校验在编辑时同样要跑（前端这里也是把表单整份提交）。
//
// 【技术栈与关键字】
//   · asList / isExternalUrl / textOf：本批新增的共享纯函数（app/utils/contentList.ts）
//   · PROJECT_LIMITS / checkRequiredText / checkOptionalText / checkExternalUrl /
//     checkImageUrl / checkStatus / requireAtLeastOneProjectAddress：
//     本批新增的表单预检（app/utils/contentForm.ts），数字来自后端 ProjectForm 的注解
//   · formatDateTime：时间显示的唯一规则（app/utils/time.ts）
// ================================================================

const { request } = useApi()

const projects = ref([])
const loading = ref(false)

const editVisible = ref(false)
const saving = ref(false)
/** 保存失败时显示在弹窗里的原因（toast 会消失，弹窗不会） */
const formError = ref('')

/** 表单：id 为 null 表示"新建"，否则是编辑 */
const form = reactive({
  id: null, name: '', description: '', url: '', repo: '', cover: '', tech: '', sort: 0, status: 1,
})

// ---------- 封面上传 ----------
// 【为什么不自己写上传，也不自己拼 FormData】
//   上传的全部逻辑（类型/大小的前端预检、FormData 的字段名、POST /upload 的调用、
//   `data.url` 的解析、错误文案）都在 app/composables/useUpload.ts 里，
//   而它已经有一整套用例（test/useUpload.nuxt.spec.ts）。
//   这里再写一套的后果是"两套上传规则迟早不一致"（比如大小上限改了只改一处）——
//   和标签/分类面板共用同一份校验函数是同一个道理。
//   这里只负责把界面上发生的事转成调用，并把结果反馈给用户。
const { upload: uploadCover, ALLOWED_EXTENSIONS, MAX_SIZE_TEXT } = useUpload()
const coverUploading = ref(false)

/**
 * el-upload 选中文件后的回调（`:auto-upload="false"` 时由它接管上传）。
 *
 * 【注意这里拿的是 uploadFile.raw】el-upload 的 on-change 给的是一个包装对象，
 *   真正的浏览器 File 在 `.raw` 上。直接把它当 File 用（比如读 .size）会得到 undefined。
 *
 * 【为什么用 el-upload 而不是自己写 <input type="file">】照抄文章弹窗的选择，
 *   两个理由：① 它自带"同一个文件再选一次也会触发 change"这些细节处理；
 *   ② 【绝不能用 el-upload 的 action 属性直传】那样它不会带上 Authorization 头，
 *   后端会返回 401（它走的是自己的一套 XHR，绕过了 useApi）。
 *
 * 【失败时为什么不动 form.cover】只有成功才赋值 —— 原来的地址必须留着：
 *   上传失败（网络抖动、后端拒了这个格式）时把字段清空，用户会以为"我那张图丢了"，
 *   而且一保存就把项目封面真的清掉了。
 */
const onCoverChosen = async (uploadFile) => {
  const file = uploadFile?.raw
  if (!file) return

  coverUploading.value = true
  try {
    const res = await uploadCover(file)
    if (res.ok && res.url) {
      // 后端返回的是 Result<{ url, ... }>：地址在 data.url 上，
      // 而 useUpload 已经把它解析出来放在 res.url 里（见 useUpload.upload 的最后一行）
      form.cover = res.url
      ElMessage.success('封面上传成功')
    } else {
      // 用后端/预检给的具体原因（"只支持 jpg / jpeg…"、"图片不能超过 5MB"），
      // 而不是笼统的"上传失败"—— 用户看着提示才知道该怎么改
      ElMessage.error(res.message || '封面上传失败')
    }
  } finally {
    // 放在 finally 里：不管成功失败都要把 loading 收掉，
    // 否则一次异常就会让按钮永久转圈
    coverUploading.value = false
  }
}

/** 拉列表（失败或结构不对时列表为空，但页面不崩） */
const load = async () => {
  loading.value = true
  const res = await request('/admin/project/list')
  loading.value = false
  projects.value = asList(res)
}

const openCreate = () => {
  form.id = null
  form.name = ''
  form.description = ''
  form.url = ''
  form.repo = ''
  form.cover = ''
  form.tech = ''
  form.sort = 0
  // 新建默认"显示"：与后端一致（Project.STATUS_VISIBLE = 1）
  form.status = 1
  formError.value = ''
  editVisible.value = true
}

const openEdit = (row) => {
  form.id = row.id
  form.name = row.name || ''
  // 可选字段可能是 null（后端把空串归一成 null 存的），显式兜成空串：
  // 它们还会被 .trim() 用到，null 上没有这个方法
  form.description = row.description || ''
  form.url = row.url || ''
  form.repo = row.repo || ''
  form.cover = row.cover || ''
  form.tech = row.tech || ''
  // sort / status 可能是 null：数字控件与下拉框拿到 null 会显示成空，
  // 用户一保存就把它们变成 0 / 未选 —— 显式兜成后端的默认值
  form.sort = Number(row.sort) || 0
  form.status = row.status === 0 ? 0 : 1
  formError.value = ''
  editVisible.value = true
}

/**
 * 保存（新建或编辑）。
 *
 * 【校验顺序是有意的】先必填、再长度与格式、最后跨字段规则 ——
 *   与后端的两道防线顺序一致。用户一次只会看到第一条错误，
 *   所以"最该先改的那条"要排在前面（名字都没填就先说地址格式，只会让人困惑）。
 */
const save = async () => {
  formError.value = ''

  const name = rawText(form.name)
  const description = rawText(form.description)
  const url = rawText(form.url)
  const repo = rawText(form.repo)
  const cover = rawText(form.cover)
  const tech = rawText(form.tech)
  const status = Number(form.status)

  const error = checkRequiredText(name, '项目名称', PROJECT_LIMITS.name)
    || checkOptionalText(description, '项目简介', PROJECT_LIMITS.description)
    || checkExternalUrl(url, '在线地址', { maxLength: PROJECT_LIMITS.url })
    || checkExternalUrl(repo, '仓库地址', { maxLength: PROJECT_LIMITS.repo })
    || checkImageUrl(cover, '封面图地址', { maxLength: PROJECT_LIMITS.cover })
    || checkOptionalText(tech, '技术栈', PROJECT_LIMITS.tech)
    || checkStatus(status)
    // ⚠️ 跨字段规则放最后：前面任何一条不通时，先说清那一条更具体的问题
    || requireAtLeastOneProjectAddress(url, repo)
  if (error) {
    formError.value = error
    return
  }

  // 防连点：按钮上虽然有 :loading，但两次点击落在同一帧时它还没重绘
  if (saving.value) return
  saving.value = true

  // 整份表单覆盖式提交（与后端"缺字段 = 清空"的语义一致）：
  // 传空串而不是不传，才是"这些字段现在就是空的"的准确表达
  const body = { name, description, url, repo, cover, tech, sort: Number(form.sort) || 0, status }
  const isEdit = !!form.id

  const res = isEdit
    ? await request('/admin/project/' + form.id, { method: 'PUT', body })
    : await request('/admin/project', { method: 'POST', body })

  saving.value = false

  if (res.ok) {
    // 重新拉列表：sort 是后端排的，本地插进去的位置不一定对
    ElMessage.success(isEdit ? '已保存' : '项目已创建')
    editVisible.value = false
    load()
    return
  }

  // 【404 = 这个项目已经被别人删掉了】自愈：提示 + 关弹窗 + 重拉列表。
  //   留着弹窗只会让用户对着一条不存在的记录继续点保存，再撞一次 404
  if (res.code === 404) {
    ElMessage.warning('这个项目已经不在了，列表已刷新')
    editVisible.value = false
    load()
    return
  }

  // 其它失败：弹窗留着 + 把后端的原因写在弹窗里（多半是"地址必须以 http…"这类）
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
      `确定要删除项目「${textOf(row.name)}」吗？删除后前台与后台都不再显示，界面上无法恢复。`,
      '危险操作',
      { type: 'error', confirmButtonText: '确认删除', cancelButtonText: '取消' },
    )
  } catch { return }

  const res = await request('/admin/project/' + row.id, { method: 'DELETE' })
  if (res.ok) {
    ElMessage.success('已删除')
    load()
    return
  }
  // 404：别人已经删过了 —— 提示 + 重拉列表（自愈），而不是让用户对着一句报错再点一次
  if (res.code === 404) {
    ElMessage.warning('这个项目已经不在了，列表已刷新')
    load()
  }
}

// 挂载时拉一次：父页面用 v-if 切换菜单，"切到项目管理"= 本组件被挂载
onMounted(load)
</script>

<style scoped>
/* 操作列里的按钮排一行、永不折行 */
.pp-acts { display: flex; align-items: center; gap: 8px; flex-wrap: nowrap; }

/* 地址列的单元格：两个链接并排（在线 / 仓库），不折行 ——
   折行的表现是"有的行一行、有的行两行"，表格的行高会变得参差不齐 */
.pp-links { display: flex; align-items: center; gap: 10px; flex-wrap: nowrap; }
.pp-link { color: var(--accent); text-decoration: none; }
.pp-link:hover { text-decoration: underline; }
/* 仓库用青色与"在线"区分：两个都是外链，但去的地方不同，
   颜色一致的话用户得靠读两个字才知道区别 */
.pp-link.is-repo { color: var(--cyan); }

.pp-muted { color: var(--muted); }

/* 弹窗里的状态下拉框固定宽度：不固定会撑满弹窗，与上面输入框的左边缘对不齐 */
.pp-select { width: 240px; }

/* ---------- 封面：预览 + 手填地址 + 上传按钮 ---------- */
/* flex-wrap：窄屏时按钮自动换到预览图下面，而不是把布局挤变形 */
.cover-field { flex: 1; display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
/* 固定高度 + object-fit: cover：不同长宽比的封面在这里都显示成统一大小的缩略图，
   不用去裁剪原图，也不会把表单撑高 */
.cover-preview {
  height: 64px; width: 96px; object-fit: cover; border-radius: 8px;
  border: 1px solid rgba(150,190,240,.18); background: #0d1b38;
}
/* 手填地址的输入框：吃掉剩下的宽度，但有个下限（窄屏时整体换行）。
   min-width: 0 是 flex 子项能被压窄的前提（默认 min-width:auto 会让长地址撑破这一行）。 */
.cover-input { flex: 1 1 200px; min-width: 0; }
.cover-btns { display: flex; align-items: center; gap: 8px; }
</style>
