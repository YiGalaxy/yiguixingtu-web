<template>
  <!--
    分类管理（增删改）。
    【形状刻意与「标签管理」对齐】都是列表 + 新建/编辑弹窗 + 二次确认删除 ——
    两边长得不一样的话，管理员每换一个菜单都要重新找一遍按钮在哪。
    【差异见下方两处注释】分类多一个「描述」字段，而且**删除可能被拒**。
    【数据从外面来】分类是文章筛选下拉框、文章弹窗的单选下拉框与这一页共用的那一份
    （新建完切到文章管理就能选到），所以 ref 在父页面，这里只读 + 抛 refresh。
  -->
  <header class="top">
    <h1>分类管理</h1>
    <p>共 {{ categories.length }} 个分类（一篇文章属于一个分类，分类下还有文章时无法删除）</p>
  </header>

  <div class="toolbar glass">
    <el-button type="success" @click="openCategoryCreate">+ 新建分类</el-button>
    <el-button @click="emit('refresh')">刷新</el-button>
    <!-- 和标签那句提示同一个作用：说清"这里和别处的关系"。
         分类与标签不同 —— 文章弹窗里的分类是【单选】，而且只选不改 -->
    <span class="tb-hint">文章弹窗里的分类是单选下拉框，这里建完立刻就能选到。</span>
  </div>

  <div class="panel glass">
    <!-- 【删除被拒的原因留在这里，而不是只弹一个 toast】
         toast 三秒后就消失了，而"还有 N 篇文章在用这个分类"是用户**唯一**能据此
         行动的信息（去文章管理把那几篇改到别的分类）。只弹 toast 的表现是
         "点了删除、报了一句错、然后没有然后了"，用户既不知道有几篇，
         也不知道该去哪儿改。所以这句话会一直留在页面上，
         直到下一次（成功或失败的）操作把它替换掉。 -->
    <div v-if="categoryNotice" class="panel-note is-error">
      {{ categoryNotice }}
      <!-- 【这句为什么写成"如果…"】它能出现在任何一种删除失败下面（超时、500、
           以及最主要的"还有文章在用"）。写成"要删掉它，先去文章管理…"的话，
           在 500 那种情况下就是一去不回的错误指引；写成条件句才在任何分支下都成立。 -->
      <span class="pn-hint">如果是因为"分类下还有文章"：先去「文章管理」把这几篇改到别的分类（或删掉），再回来删。</span>
    </div>

    <el-table
      v-loading="loading" :data="categories"
      empty-text="还没有分类，点左上角「新建分类」建一个吧">
      <el-table-column prop="id" label="ID" width="80" />
      <el-table-column prop="name" label="分类名" min-width="180">
        <template #default="{ row }"><span class="art-title">{{ row.name }}</span></template>
      </el-table-column>
      <el-table-column prop="sort" label="排序" width="90" />
      <!-- 描述可能很长（上限 255 字），用 show-overflow-tooltip：
           不然它会把行撑成好几行、把操作列挤到看不见的地方。
           描述为 null 时后端不给这个字段，这里显示「—」而不是空白 -->
      <el-table-column prop="description" label="描述" min-width="260" show-overflow-tooltip>
        <template #default="{ row }">{{ row.description || '—' }}</template>
      </el-table-column>
      <el-table-column label="操作" width="170">
        <template #default="{ row }">
          <el-button size="small" @click="openCategoryEdit(row)">编辑</el-button>
          <el-button size="small" type="danger" @click="removeCategory(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>

  <!-- ==================== 新建 / 编辑分类弹窗 ====================
       【形状与标签弹窗一致，只多一个「描述」字段】
       一致的地方：标题随"新建/编辑"变、失败原因留在弹窗里、取消与保存的措辞。
       多出来的地方：描述（可选，最长 255 字）——
       后端 CategoryForm 的 @Size(max=255) 与数据库列宽对齐，
       前端 maxlength 跟着写 255，超长时在本地就提示（而不是让后端截断或报错）。 -->
  <el-dialog
    v-model="categoryEditVisible" class="art-edit-modal" :title="categoryForm.id ? '编辑分类' : '新建分类'"
    width="min(520px, 92vw)" :close-on-click-modal="false">
    <div class="af-row">
      <span class="ed-label">分类名</span>
      <!-- maxlength 与后端 @Size(max=50) 对齐；前端拦一道只是体验（本地即时反馈），
           真正生效的仍然是后端那一层（直接调接口可以绕过前端） -->
      <el-input
        v-model="categoryForm.name" placeholder="比如：技术笔记、项目复盘"
        maxlength="50" show-word-limit @keyup.enter="saveCategory" />
    </div>

    <div class="af-row">
      <span class="ed-label">排序</span>
      <el-input-number v-model="categoryForm.sort" :min="0" :max="9999" controls-position="right" />
      <span class="af-hint">越小越靠前</span>
    </div>

    <div class="af-row">
      <span class="ed-label">描述</span>
      <!-- 可选字段：留空就存 null（后端把空串也归一成 null），列表里显示成「—」。
           这一行的样式与文章弹窗的「摘要」那一行完全相同（都是 .af-row + textarea） -->
      <el-input
        v-model="categoryForm.description" type="textarea" :rows="3"
        placeholder="这个分类收什么文章（可以留空）"
        maxlength="255" show-word-limit />
    </div>

    <!-- 【失败原因留在弹窗里，理由与标签弹窗完全相同】
         重名（后端 400「分类名已存在」）是最常见的一种，
         而 toast 三秒后自己就消失了，用户那时还看着弹窗、正准备改个名字再保存。 -->
    <p v-if="categoryFormError" class="ed-error">{{ categoryFormError }}</p>

    <template #footer>
      <span class="af-foot-tip">名字首尾的空格会被自动去掉</span>
      <el-button @click="categoryEditVisible = false">取消</el-button>
      <el-button type="primary" :loading="categorySaving" @click="saveCategory">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ElMessage, ElMessageBox } from 'element-plus'

defineProps({
  /** 列表数据：与文章筛选下拉框、文章弹窗的分类单选共用父页面那一份 */
  categories: { type: Array, default: () => [] },
  /** 列表 loading 由父页面控制（切到本菜单时会带 loading 刷新一次） */
  loading: { type: Boolean, default: false },
})

const emit = defineEmits(['refresh'])

const { request } = useApi()

const categorySaving = ref(false)
const categoryEditVisible = ref(false)
/** 保存失败时显示在弹窗里的原因（与标签管理同一个考虑：toast 会消失，弹窗不会） */
const categoryFormError = ref('')
/**
 * 删除被拒后**留在页面上**的那句话（不是 toast）。
 *
 * 【为什么这条必须留在页面上】删除被拒是分类页最主要的一种失败，
 *   而后端那句话（"还有 N 篇文章在用这个分类，请先调整这些文章的分类"）
 *   是用户唯一能据此行动的信息 —— 它既告诉你有几篇、也告诉你该做什么。
 *   toast 三秒后消失，用户看到的是"点了一下、报了个错、没了"，
 *   既不知道有几篇、也不知道去哪儿改。所以它一直留着，
 *   直到下一次操作（不管成功还是失败）把它替换掉。
 */
const categoryNotice = ref('')

/** 表单：id 为 null 表示"新建"，否则是编辑 */
const categoryForm = reactive({ id: null, name: '', description: '', sort: 0 })

const openCategoryCreate = () => {
  categoryForm.id = null
  categoryForm.name = ''
  categoryForm.description = ''
  // 排序默认 0（后端的规则是"越小越靠前"，0 就是它的默认值）。
  // 不自动算 max+1：算出来的数字用户看不懂（"为什么是 7？"），而绝大多数分类用默认值就够
  categoryForm.sort = 0
  categoryFormError.value = ''
  categoryNotice.value = ''
  categoryEditVisible.value = true
}

const openCategoryEdit = (row) => {
  categoryForm.id = row.id
  categoryForm.name = row.name || ''
  // 描述可能是 null（后端把空串归一成 null 存的）。el-input 拿到 null 会当成空字符串，
  // 但显式兜一道：它还会被 .trim() 用到，null 上没有这个方法
  categoryForm.description = row.description || ''
  // sort 同样可能是 null：el-input-number 拿到 null 会显示成空，
  // 用户一保存就把排序变成 0 —— 所以显式兜成 0
  categoryForm.sort = Number(row.sort) || 0
  categoryFormError.value = ''
  categoryNotice.value = ''
  categoryEditVisible.value = true
}

/**
 * 保存分类（新建或编辑）。
 *
 * 【提交前必须 trim】后端是 trim 之后再查重与落库（"技术" 与 " 技术 " 是同一个名字），
 *   这里是"同一套规则的显示端"：不 trim 的话请求体与日志里都是脏数据，
 *   而且 maxlength=50 会因为空格提前截断一个本来合法的名字。
 *
 * 【为什么描述也要 trim，而且留空就发空串】后端会把没有内容的描述归一成 null
 *   （存 "" 与存 null 在库里是两个值，展示上却是同一个意思 —— 统一成 null 少一种状态）。
 *   前端不替它做这件事：原样把用户的输入交出去，归一化的规则只在后端一处。
 *
 * 【为什么前端也校验一遍必填与长度】和封面、标签那两套一样，前端预检只是体验优化
 *   （本地即时反馈、不浪费一次往返），真正生效的永远是后端那一层。
 */
const saveCategory = async () => {
  categoryFormError.value = ''

  const name = categoryForm.name.trim()
  if (!name) {
    categoryFormError.value = '分类名不能为空'
    return
  }
  if (name.length > 50) {
    categoryFormError.value = '分类名最长 50 字'
    return
  }
  const description = (categoryForm.description || '').trim()
  if (description.length > 255) {
    categoryFormError.value = '分类描述最长 255 字'
    return
  }
  // 防连点：按钮上虽然有 :loading，但两次点击落在同一帧时它还没重绘
  if (categorySaving.value) return

  categorySaving.value = true
  const body = { name, description, sort: Number(categoryForm.sort) || 0 }
  const isEdit = !!categoryForm.id

  const res = isEdit
    ? await request('/admin/category/' + categoryForm.id, { method: 'PUT', body })
    : await request('/admin/category', { method: 'POST', body })

  categorySaving.value = false

  if (res.ok) {
    ElMessage.success(isEdit ? '已保存' : '分类已创建')
    categoryEditVisible.value = false
    categoryNotice.value = ''
    // 重新拉列表（而不是把这一条塞进本地数组）：sort 是后端排的，
    // 本地插进去的位置不一定对
    emit('refresh')
    return
  }

  // 【失败：弹窗留着 + 把后端的原因写在弹窗里】
  //   最典型的是重名：后端返回 400 + 「分类名已存在」。
  //   useApi 已经弹过一次 toast（那句话就是后端的原文），这里再显示一遍是为了
  //   "留在用户眼前" —— 重名时他要做的动作是改个名字再点一次保存。
  categoryFormError.value = res.message || '保存失败，请稍后再试'
}

/**
 * 删除分类。
 *
 * 【为什么二次确认的措辞与标签不一样】
 *   标签的删除是"物理删除 + 解除关联"，确认框里能报出"还有 N 篇已发布文章"
 *   （后端在列表里给了 articleCount）。
 *   分类**没有**这个数字：CategoryVO 里只有 id/name/description/sort。
 *   所以这里不能像标签那样报出篇数，只能说明"分类下还有文章时会被拒绝"——
 *   真正有几篇，由后端在拒绝时说（那句话是唯一准确的来源）。
 *
 * 【为什么不在点删除前自己查一次"有几篇在用"】
 *   查得到（`/admin/article/page?categoryId=N` 的 total 就是），但那是**另一套口径**：
 *   后端的 countArticlesByCategoryId() 数的是该分类下**所有未删除的文章**
 *   （草稿也算），而文章列表接口是分前台/后台两份的，前端自己数出来的数字
 *   随时可能和后端拒绝时说的数字对不上 —— 两个不一样的数字同时出现在屏幕上，
 *   比不给数字更让人迷惑。所以这里只做一次确认，篇数以**后端拒绝时那句话**为准。
 *
 * 【删除被拒（还有文章在用）时：把后端那句话原样留在页面上】
 *   后端返回 HTTP 200 + code 400 + message「还有 N 篇文章在用这个分类，
 *   请先调整这些文章的分类」。这句话必须原样显示，不能替换成"删除失败"——
 *   "还有 N 篇"是用户唯一能据此行动的信息（去哪几篇、改到别的分类）。
 */
const removeCategory = async (row) => {
  try {
    await ElMessageBox.confirm(
      `确定要删除分类「${row.name}」吗？如果还有文章用着这个分类，删除会被拒绝（会告诉你还有几篇）。删除后无法恢复。`,
      '危险操作',
      { type: 'error', confirmButtonText: '确认删除', cancelButtonText: '取消' },
    )
  } catch { return }

  const res = await request('/admin/category/' + row.id, { method: 'DELETE' })
  if (res.ok) {
    categoryNotice.value = ''
    ElMessage.success('已删除')
    emit('refresh')
    return
  }

  // 【404 = 别人（或另一个标签页）已经把它删掉了】
  //   这时什么都不做的话，用户看到的是"报错 + 表格里还列着它"，会以为删除失败再点一次。
  //   刷新列表才是能自愈的做法：表格里那条自己就没了。
  if (res.code === 404) {
    categoryNotice.value = ''
    ElMessage.warning('这个分类已经不在了，列表已刷新')
    emit('refresh')
    return
  }

  // 【其它失败（最主要的就是"还有 N 篇在用"）】留一句话在页面上
  categoryNotice.value = res.message
    ? `删除「${row.name}」失败：${res.message}`
    : `删除「${row.name}」失败，请稍后再试`
}
</script>

<style scoped>
/* 面板顶部的一行说明。
   用左边一条竖线而不是纯文字：它需要被看见，但不需要抢标题的位置。
   【is-error 是"这条不是说明、是一条要处理的问题"】删除被拒的原因就属于这种 ——
   它必须比一般说明更显眼（用户此刻正卡在"为什么删不掉"上），
   所以换成错误色 + 更实的竖线，而不是沿用金色那条"提示"。 */
.panel-note {
  color: var(--muted); font-size: 13px; line-height: 1.7;
  border-left: 3px solid rgba(242,193,78,.5); padding: 2px 0 2px 12px; margin-bottom: 18px;
}
.panel-note strong { color: var(--accent); }
.panel-note.is-error {
  color: var(--el-color-danger, #f56c6c);
  border-left-color: var(--el-color-danger, #f56c6c);
}
/* 跟在错误原因后面的"下一步该去哪"：比原因本身弱一档，但必须在同一块里
   （分开放的话，用户读完那句话还是不知道去哪儿改） */
.panel-note .pn-hint { display: block; margin-top: 4px; color: var(--muted); font-size: 12px; }
</style>
