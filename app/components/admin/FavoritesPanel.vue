<template>
  <!--
    收藏管理（增删改）。
    【形状与「标签管理 / 分类管理」对齐】列表 + 新建/编辑弹窗 + 二次确认删除 ——
    三个后台内容页长得一样，管理员换一个菜单就不用重新找按钮在哪。

    【为什么这一页的数据由它自己持有（不像标签/分类那样放在 admin.vue 里）】
      标签与分类的列表有别的使用者（文章弹窗的下拉框、首页筛选条），所以那份 ref
      必须提升到父页面才能保证"两处看到的是同一批"。收藏列表只有这一页用 ——
      提到父页面只会让 admin.vue 多一份没人共用的状态与请求。
      这与「评论管理」是同一个判断（见 CommentsPanel 的文件头注释）。

    【为什么字段上限写在这些数字上（100 / 255 / 500 / 50）】
      它们抄自后端 FavoriteForm 的 @Size 注解（app/utils/contentForm.ts 里有逐条对照），
      与数据库列宽、Service 里的常量三处一致。前端 maxlength 只是"本地即时反馈"，
      真正生效的永远是后端那一层（直接调接口可以绕过前端）。
  -->
  <header class="top">
    <h1>收藏管理</h1>
    <p>共 {{ favorites.length }} 条收藏（含隐藏的；前台只显示状态为「显示」的那些）</p>
  </header>

  <div class="toolbar glass">
    <el-button type="success" @click="openCreate">+ 新建收藏</el-button>
    <el-button @click="load">刷新</el-button>
    <span class="tb-hint">「分组名」可以自己随便写（比如：工具 / 文章 / 下次再看），收藏页会按它分组显示。</span>
  </div>

  <div class="panel glass">
    <el-table
      v-loading="loading" :data="favorites"
      empty-text="还没有收藏，点左上角「新建收藏」加一条吧">
      <el-table-column prop="id" label="ID" width="70" />
      <el-table-column prop="title" label="标题" min-width="180">
        <template #default="{ row }"><span class="art-title">{{ textOf(row.title) }}</span></template>
      </el-table-column>
      <!-- 地址列：直接给一个能点开的外链。后台也遵守与前台同一套白名单
           （isExternalUrl：只认 http(s)），非法地址退化成文字 —— 后台同样没有理由
           把 `javascript:` 放进 href。 -->
      <el-table-column prop="url" label="地址" min-width="220" show-overflow-tooltip>
        <template #default="{ row }">
          <a v-if="isExternalUrl(row.url)" class="fp-link" :href="row.url" target="_blank" rel="noopener">{{ row.url }}</a>
          <span v-else class="fp-muted">{{ textOf(row.url) }}</span>
        </template>
      </el-table-column>
      <!-- 分组名可为空（后端允许"未分组"）：空的时候显示「—」而不是留白，
           留白会让人以为这一列没渲染出来 -->
      <el-table-column prop="category" label="分组" width="110">
        <template #default="{ row }">{{ textOf(row.category) }}</template>
      </el-table-column>
      <el-table-column prop="sort" label="排序" width="80" />
      <el-table-column prop="status" label="状态" width="90">
        <template #default="{ row }">
          <!-- 状态只有两个取值（0 隐藏 / 1 显示），都是确定答案，所以用 el-tag 而不是占位符 -->
          <el-tag :type="row.status === 0 ? 'info' : 'success'" size="small" effect="plain">
            {{ row.status === 0 ? '隐藏' : '显示' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="createTime" label="创建时间" width="150">
        <template #default="{ row }">{{ formatDateTime(row.createTime) }}</template>
      </el-table-column>
      <!-- 【操作列为什么用 flex + nowrap】按钮宽度跟着文字走，"把列宽调大"只是把问题
           往后推（哪天文案变长又会折行）。flex-wrap: nowrap 是结构性的保证：
           这一行永远不折，列宽不够时由表格横向滚动，而不是把按钮挤到第二行。
           （两个动作放得下，所以不需要像评论管理那样把危险动作收进「更多」下拉。） -->
      <el-table-column label="操作" width="160" fixed="right">
        <template #default="{ row }">
          <div class="fp-acts">
            <el-button size="small" @click="openEdit(row)">编辑</el-button>
            <el-button size="small" type="danger" @click="remove(row)">删除</el-button>
          </div>
        </template>
      </el-table-column>
    </el-table>
  </div>

  <!-- ==================== 新建 / 编辑收藏弹窗 ==================== -->
  <el-dialog
    v-model="editVisible" class="art-edit-modal" :title="form.id ? '编辑收藏' : '新建收藏'"
    width="min(560px, 92vw)" :close-on-click-modal="false">
    <div class="af-row">
      <span class="ed-label">标题</span>
      <el-input
        v-model="form.title" placeholder="比如：MySQL 索引原理图解"
        maxlength="100" show-word-limit @keyup.enter="save" />
    </div>

    <div class="af-row">
      <span class="ed-label">地址</span>
      <el-input
        v-model="form.url" placeholder="https://example.com/post/1"
        maxlength="255" @keyup.enter="save" />
    </div>

    <div class="af-row">
      <span class="ed-label">备注</span>
      <el-input
        v-model="form.description" type="textarea" :rows="3"
        placeholder="为什么收藏它、以后什么时候会用到（可以留空）"
        maxlength="500" show-word-limit />
    </div>

    <div class="af-row">
      <span class="ed-label">分组</span>
      <!-- 【为什么是可输入的下拉框（allow-create）而不是固定选项】
           后端 FavoriteForm 的注释写明了：分组名是自由文本，做成"从已有分组里选"
           要求先有一个分组列表接口，而分组本来就该在录入时随手新增。
           所以这里给两个能力：已有的分组直接选（避免手打错字导致同组分裂），
           新的分组直接输入（allow-create 会把输入的文字当成一个新选项）。 -->
      <el-select
        v-model="form.category" class="fp-select" filterable allow-create clearable default-first-option
        placeholder="留空 = 未分组">
        <el-option v-for="c in categoryOptions" :key="c" :label="c" :value="c" />
      </el-select>
    </div>

    <div class="af-row">
      <span class="ed-label">排序</span>
      <el-input-number v-model="form.sort" :min="0" :max="9999" controls-position="right" />
      <span class="af-hint">越小越靠前</span>
    </div>

    <div class="af-row">
      <span class="ed-label">状态</span>
      <el-select v-model="form.status" class="fp-select">
        <el-option label="显示（前台可见）" :value="1" />
        <el-option label="隐藏（前台看不到）" :value="0" />
      </el-select>
    </div>

    <!-- 【为什么失败原因要显示在弹窗里，而不是只弹一个 toast】
         地址不合法（后端 400「地址必须以 http:// 或 https:// 开头」）与地址缺失
         （400「地址不能为空」）是这个表单最常见的失败，而 toast 三秒后就消失了，
         用户那时还看着弹窗、正准备改一改再保存。把原因留在弹窗里 + 弹窗不关闭，
         用户才能当场改完重试；只弹 toast 的表现是"点保存没反应，提示一闪而过"。 -->
    <p v-if="formError" class="ed-error">{{ formError }}</p>

    <template #footer>
      <span class="af-foot-tip">标题与地址首尾的空格会被自动去掉</span>
      <el-button @click="editVisible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="save">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ElMessage, ElMessageBox } from 'element-plus'

// ================================================================
// app/components/admin/FavoritesPanel.vue
//
// 作用：后台「收藏管理」面板，对接三个接口（全部要求 ADMIN，走 useApi 自动带 token）：
//   · GET    /admin/favorite/list —— 列表（含隐藏的，不走缓存：刚点完"隐藏"就要看到效果）
//   · POST   /admin/favorite      —— 新建，返回 Result<Long>（新建出来的 id）
//   · PUT    /admin/favorite/{id} —— 编辑，返回 Result<Void>（没有 data）
//   · DELETE /admin/favorite/{id} —— 删除（后端是逻辑删除，界面上无法恢复）
//
// 【为什么保存成功之后要重新拉列表，而不是把这一条塞进本地数组】
//   · sort 是后端排的（ORDER BY sort ASC, id ASC），本地插进去的位置不一定对
//   · 后端可能在保存时归一化字段（空串 → null），本地那条和后端那份就对不上了
//   所以"成功的定义"是：弹窗关掉 + 抛一次列表刷新。
//
// 【404 为什么要自愈】删除/编辑一个已经被别人（另一个标签页、另一个管理员）删掉的
//   记录时，后端返回 code 404。这时什么都不做的话，用户看到的是"一句报错 +
//   表格里还列着它"，他会以为删除失败再点一次。**提示一句 + 重新拉列表**才是
//   能自愈的做法：那条记录自己就没了（同 TagsPanel.removeTag）。
//
// 【技术栈与关键字】
//   · textOf / isExternalUrl / asList：本批新增的共享纯函数（app/utils/contentList.ts）
//   · checkRequiredText / checkExternalUrl / checkStatus / FAVORITE_LIMITS：本批新增的
//     表单预检与字段上限（app/utils/contentForm.ts），数字来自后端 FavoriteForm 的注解
//   · formatDateTime：时间显示的唯一规则（app/utils/time.ts）
//   · ElMessageBox.confirm：Element Plus 的确认框，取消时它**抛异常**（reject），
//     所以要用 try/catch 接住 —— 接不住的话取消会让后面那行删除请求照发不误
// ================================================================

const { request } = useApi()

const favorites = ref([])
const loading = ref(false)

const editVisible = ref(false)
const saving = ref(false)
/** 保存失败时显示在弹窗里的原因（见模板里那段说明：toast 会消失，弹窗不会） */
const formError = ref('')

/** 表单：id 为 null 表示"新建"，否则是编辑 */
const form = reactive({ id: null, title: '', url: '', description: '', category: '', sort: 0, status: 1 })

/**
 * 分组建议：从当前列表里取 distinct 的分组名。
 * 【为什么不额外调一个"分组列表"接口】后端 FavoriteVO 的注释写明了：
 *   "前端要的分组下拉建议也可以直接从这份列表里取 distinct 值，不需要额外接口"。
 *   列表本来就已经拉回来了，再为一个下拉框打一次接口是白等一个往返。
 */
const categoryOptions = computed(() => {
  const set = new Set()
  for (const item of favorites.value) {
    const name = rawText(item?.category)
    if (name) set.add(name)
  }
  return [...set]
})

/** 拉列表（后台列表含隐藏的；失败或结构不对时列表为空，但页面不崩） */
const load = async () => {
  loading.value = true
  const res = await request('/admin/favorite/list')
  loading.value = false
  favorites.value = asList(res)
}

const openCreate = () => {
  form.id = null
  form.title = ''
  form.url = ''
  form.description = ''
  form.category = ''
  // 排序默认 0（后端的规则是"越小越靠前"，0 就是它的默认值）。
  // 不自动算 max+1：算出来的数字用户看不懂（"为什么是 7？"），绝大多数条目用默认值就够
  form.sort = 0
  // 新建默认"显示"：与后端一致（Favorite.STATUS_VISIBLE = 1）。
  // 默认成"隐藏"的话，用户建完之后会去前台找它，然后以为没保存成功
  form.status = 1
  formError.value = ''
  editVisible.value = true
}

const openEdit = (row) => {
  form.id = row.id
  form.title = row.title || ''
  form.url = row.url || ''
  // 可选字段可能是 null（后端把空串归一成 null 存的）。显式兜成空串：
  // 它们还会被 .trim() 用到，null 上没有这个方法
  form.description = row.description || ''
  form.category = row.category || ''
  // sort / status 同样可能是 null：el-input-number 与 el-select 拿到 null 会显示成空，
  // 用户一保存就把它们变成 0 / 未选 —— 所以显式兜成后端的默认值
  form.sort = Number(row.sort) || 0
  form.status = row.status === 0 ? 0 : 1
  formError.value = ''
  editVisible.value = true
}

/**
 * 保存（新建或编辑）。
 *
 * 【提交前必须 trim】后端在 Service 里也是先 trim 再卡长度（normalizeTitle / normalizeUrl），
 *   所以 "  abc  " 这种输入在后端算 3 个字。前端不 trim 就判长度的话，
 *   用户会因为几个空格被判超长，而他看着输入框完全不明白为什么。
 *
 * 【为什么前端也校验一遍】前端预检只是体验优化（本地即时反馈、不浪费一次往返），
 *   真正生效的永远是后端那一层。两道校验的文案刻意写成一模一样，
 *   用户看不出是哪一道拦的 —— 这正是想要的效果。
 */
const save = async () => {
  formError.value = ''

  const title = rawText(form.title)
  const url = rawText(form.url)
  const description = rawText(form.description)
  const category = rawText(form.category)
  const status = Number(form.status)

  const error = checkRequiredText(title, '标题', FAVORITE_LIMITS.title)
    || checkRequiredText(url, '地址', FAVORITE_LIMITS.url)
    // 地址是必填的（后端 FavoriteForm 上 url 有 @NotBlank）：一条没有地址的"收藏"
    // 没有任何意义 —— 它不是待办，是"以后还要再来"的入口
    || (isExternalUrl(url) ? '' : '地址必须以 http:// 或 https:// 开头')
    || checkOptionalText(description, '备注', FAVORITE_LIMITS.description)
    || checkOptionalText(category, '分组名', FAVORITE_LIMITS.category)
    || checkStatus(status)
  if (error) {
    formError.value = error
    return
  }

  // 防连点：按钮上虽然有 :loading，但两次点击落在同一帧时它还没重绘
  if (saving.value) return
  saving.value = true

  const body = { title, url, description, category, sort: Number(form.sort) || 0, status }
  const isEdit = !!form.id

  const res = isEdit
    ? await request('/admin/favorite/' + form.id, { method: 'PUT', body })
    : await request('/admin/favorite', { method: 'POST', body })

  saving.value = false

  if (res.ok) {
    // 【为什么不检查返回的 id（POST 会返回新建出来的 id）】前端拿到它没有任何用处：
    // 列表要重新拉，而"新 id 是几"这件事在列表刷新之后自然就看到了。
    // 为它单独写一条分支，等于凭空多一个永远不会被用到的变量。
    ElMessage.success(isEdit ? '已保存' : '收藏已创建')
    editVisible.value = false
    load()
    return
  }

  // 【404 = 这条收藏已经被别人删掉了】自愈：提示一句 + 关掉弹窗 + 重新拉列表。
  //   弹窗必须关：用户正在编辑的那条记录已经不存在了，留着弹窗让他继续改、
  //   再点一次保存只会再撞一次 404。
  if (res.code === 404) {
    ElMessage.warning('这条收藏已经不在了，列表已刷新')
    editVisible.value = false
    load()
    return
  }

  // 【其它失败：弹窗留着 + 把后端的原因写在弹窗里】
  //   useApi 已经弹过一次 toast（那句话就是后端的原文），这里再显示一遍是为了
  //   "留在用户眼前" —— 他要做的动作是改一下再点一次保存，而 toast 三秒后就消失了。
  formError.value = res.message || '保存失败，请稍后再试'
}

/**
 * 删除（后端是逻辑删除：前台后台都不再显示，但行还在库里）。
 * 【为什么要二次确认】界面上没有恢复入口 —— 误点一下，这条收藏就从所有列表里消失了。
 * 【取消时一个请求都不发】ElMessageBox.confirm 在用户点"取消"时是 reject 的，
 *   所以必须 try/catch 之后 **return**：漏了这一步的话，用户点了取消，
 *   下面的删除请求照样发出去（这是"确认框形同虚设"最典型的写法）。
 */
const remove = async (row) => {
  try {
    await ElMessageBox.confirm(
      `确定要删除收藏「${textOf(row.title)}」吗？删除后前台与后台都不再显示，界面上无法恢复。`,
      '危险操作',
      { type: 'error', confirmButtonText: '确认删除', cancelButtonText: '取消' },
    )
  } catch { return }

  const res = await request('/admin/favorite/' + row.id, { method: 'DELETE' })
  if (res.ok) {
    ElMessage.success('已删除')
    load()
    return
  }
  // 404：别人已经删过了。提示 + 重拉列表（那条记录自己就没了），
  // 而不是让用户对着"报错 + 表格里还列着它"再点一次
  if (res.code === 404) {
    ElMessage.warning('这条收藏已经不在了，列表已刷新')
    load()
  }
}

// 挂载时拉一次：父页面用 v-if 切换菜单，"切到收藏管理"= 本组件被挂载
onMounted(load)
</script>

<style scoped>
/* 操作列里的按钮排一行、永不折行（理由见模板里那段注释） */
.fp-acts { display: flex; align-items: center; gap: 8px; flex-wrap: nowrap; }

/* 地址列的外链：与表格文字同色但带下划线，一眼能看出"这里可以点"——
   后台的地址是拿来核对/打开核对的，做成看不出可点的纯文本会让人以为它只是数据 */
.fp-link { color: var(--accent); text-decoration: none; }
.fp-link:hover { text-decoration: underline; }

/* 拿不到合法地址时那一格：弱化色，和可点的外链在观感上区分开 */
.fp-muted { color: var(--muted); }

/* 弹窗里的两个下拉框固定宽度：不固定的话它们会跟着弹窗宽度撑满，
   和上面那几个输入框的左边缘对不齐 */
.fp-select { width: 240px; }
</style>
