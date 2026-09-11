<template>
  <!--
    标签管理（增删改）。
    【列表数据为什么从外面来】标签在文章弹窗里是多选框的选项，两处必须看到同一批标签
    （刚在这里建的标签，切到文章管理打开弹窗就得能选到）。所以那份 ref 由父页面持有，
    这里只读它、只抛"刷新"事件。弹窗表单、保存中状态、失败原因都是这一页自己的事。
  -->
  <header class="top">
    <h1>标签管理</h1>
    <p>共 {{ tags.length }} 个标签（「已发布文章数」只统计已发布的文章，草稿不计入）</p>
  </header>

  <div class="toolbar glass">
    <el-button type="success" @click="openTagCreate">+ 新建标签</el-button>
    <el-button @click="emit('refresh')">刷新</el-button>
    <!-- 这句提示是必要的：标签全靠这里建，而文章弹窗的下拉框只能"选"不能"加" -->
    <span class="tb-hint">标签在文章弹窗里是多选框的选项，这里建完立刻就能选到。</span>
  </div>

  <div class="panel glass">
    <el-table
      v-loading="loading" :data="tags"
      empty-text="还没有标签，点左上角「新建标签」建一个吧">
      <el-table-column prop="name" label="标签名" min-width="200">
        <template #default="{ row }"><span class="art-title">{{ row.name }}</span></template>
      </el-table-column>
      <el-table-column prop="sort" label="排序" width="90" />
      <el-table-column prop="articleCount" label="已发布文章数" width="130">
        <template #default="{ row }">
          <!-- 【0 也要显示成 0，不能显示成「—」】这里的 0 是后端算出来的确定答案
               （一条 GROUP BY 的结果，没有文章就是 0，不是"读不到"）；
               这类数字显示成占位符反而会让人以为接口坏了。 -->
          {{ row.articleCount ?? 0 }}
        </template>
      </el-table-column>
      <!-- 操作列宽度只放一个「编辑」一个「删除」，170px 够；
           列宽合计 90+130+170=390，很窄，常见宽度下一屏就能看全。
           ⚠️ 2026-09-11 起这里【没有】固定列了：即使窗口更窄、需要横向滚动，
           也只是整张表一起滚（滚动条常显），不会出现"某一列压住相邻列"。 -->
      <el-table-column label="操作" width="170">
        <template #default="{ row }">
          <el-button size="small" @click="openTagEdit(row)">编辑</el-button>
          <el-button size="small" type="danger" @click="removeTag(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>

  <!-- ==================== 新建 / 编辑标签弹窗 ==================== -->
  <el-dialog
    v-model="tagEditVisible" class="art-edit-modal" :title="tagForm.id ? '编辑标签' : '新建标签'"
    width="min(460px, 92vw)" :close-on-click-modal="false">
    <div class="af-row">
      <span class="ed-label">标签名</span>
      <!-- maxlength 与后端 @Size(max=30) 对齐：前端拦一道只是体验（本地即时反馈），
           真正生效的仍然是后端那一层（直接调接口可以绕过前端） -->
      <el-input
        v-model="tagForm.name" placeholder="比如：Vue、部署、读书笔记"
        maxlength="30" show-word-limit @keyup.enter="saveTag" />
    </div>

    <div class="af-row">
      <span class="ed-label">排序</span>
      <el-input-number v-model="tagForm.sort" :min="0" :max="9999" controls-position="right" />
      <span class="af-hint">越小越靠前</span>
    </div>

    <!-- 【为什么失败原因要显示在弹窗里，而不是只弹一个 toast】
         重名（后端返回 400「标签名已存在」）是这个表单最常见的失败，
         而 toast 三秒后自己就消失了，用户那时还在看弹窗、正准备点第二次保存。
         把原因留在弹窗里 + 弹窗不关闭，用户才能当场改名重试；
         只弹 toast 的表现是"点保存没反应，提示一闪而过"。 -->
    <p v-if="tagFormError" class="ed-error">{{ tagFormError }}</p>

    <template #footer>
      <span class="af-foot-tip">名字首尾的空格会被自动去掉</span>
      <el-button @click="tagEditVisible = false">取消</el-button>
      <el-button type="primary" :loading="tagSaving" @click="saveTag">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ElMessage, ElMessageBox } from 'element-plus'

defineProps({
  /** 列表数据：与文章弹窗的标签多选共用父页面那一份 */
  tags: { type: Array, default: () => [] },
  /** 列表 loading 由父页面控制（它同时负责"切到本菜单时带 loading 刷新一次"） */
  loading: { type: Boolean, default: false },
})

/**
 * 【为什么是 refresh 而不是把列表传回来】数据源在父页面（见文件顶部）。
 * 这里凡是"改完要重新读一遍列表"的地方都抛这个事件，
 * 由父页面决定用哪种刷新（切菜单时带 loading，改完不带）。
 */
const emit = defineEmits(['refresh'])

const { request } = useApi()

const tagSaving = ref(false)
const tagEditVisible = ref(false)
/** 保存失败时显示在弹窗里的原因（见模板里那段说明：toast 会消失，弹窗不会） */
const tagFormError = ref('')

const tagForm = reactive({ id: null, name: '', sort: 0 })

const openTagCreate = () => {
  tagForm.id = null
  tagForm.name = ''
  // 排序默认 0：后端的排序规则是"越小越靠前"，0 是它的默认值。
  // 这里不自动算 max+1 —— 自动算出来的数字用户看不懂（"为什么是 7？"），
  // 而绝大多数标签用默认值就够了，想调的人自己会去改。
  tagForm.sort = 0
  tagFormError.value = ''
  tagEditVisible.value = true
}

const openTagEdit = (row) => {
  tagForm.id = row.id
  tagForm.name = row.name || ''
  // sort 可能是 null（后端允许不传）。el-input-number 拿到 null 会显示成空，
  // 用户一保存就把排序变成 0 —— 所以这里显式兜成 0
  tagForm.sort = Number(row.sort) || 0
  tagFormError.value = ''
  tagEditVisible.value = true
}

/**
 * 保存标签（新建或编辑）。
 *
 * 【提交前必须 trim】后端会 trim 之后再查重（"工作" 与 " 工作 " 是同一个名字），
 *   而这里是"同一套规则的显示端"：不 trim 的话，用户输入 " 工作 " 时
 *   我们会把带空格的字符串发上去（后端能处理，但请求体和日志里都是脏数据），
 *   而且 maxlength=30 会因为空格而提前截断一个本来合法的名字。
 *
 * 【为什么前端也校验一遍长度和必填】和封面那套一样，前端预检只是体验优化
 *   （本地即时反馈、不浪费一次往返），真正生效的永远是后端那一层。
 */
const saveTag = async () => {
  tagFormError.value = ''

  const name = tagForm.name.trim()
  if (!name) {
    tagFormError.value = '标签名不能为空'
    return
  }
  if (name.length > 30) {
    tagFormError.value = '标签名最长 30 字'
    return
  }
  // 防连点：按钮上虽然有 :loading，但两次点击落在同一帧时它还没重绘
  if (tagSaving.value) return

  tagSaving.value = true
  const body = { name, sort: Number(tagForm.sort) || 0 }
  const isEdit = !!tagForm.id

  const res = isEdit
    ? await request('/admin/tag/' + tagForm.id, { method: 'PUT', body })
    : await request('/admin/tag', { method: 'POST', body })

  tagSaving.value = false

  if (res.ok) {
    ElMessage.success(isEdit ? '已保存' : '标签已创建')
    tagEditVisible.value = false
    // 重新拉列表（而不是把新的这一条塞进本地数组）：sort 是后端排的，
    // 本地插进去的位置不一定对；而且 articleCount 只有后端算得准
    emit('refresh')
    return
  }

  // 【失败：弹窗留着 + 把后端的原因写在弹窗里】
  //   最典型的就是重名：后端返回 400 + 「标签名已存在」。
  //   useApi 已经弹过一次 toast（那句话就是后端的原文），这里再显示一遍是为了
  //   "留在用户眼前" —— 重名时他要做的动作是改名字再点一次保存，
  //   而 toast 三秒后消失，那时他还在看这个弹窗。
  tagFormError.value = res.message || '保存失败，请稍后再试'
}

/**
 * 删除标签。
 *
 * 【二次确认里必须说清"会同时解除文章关联"】
 *   后端这个删除是【物理删除】：标签行删掉，同时把它与文章的所有关联一起删掉
 *   （文章本身不会消失，只是少了这个标签）。用户在列表上看到的就是一个名字，
 *   不告诉他的话很容易以为"只是从标签库里去掉了，文章上的标签还在"。
 *   所以确认框里把影响写全：有几篇已发布文章也报出来（articleCount 就是为这个准备的）。
 */
const removeTag = async (row) => {
  const count = Number(row.articleCount) || 0
  const impact = count > 0
    ? `它下面还有 ${count} 篇已发布文章，删除后会同时解除这些文章与它的关联（文章本身不会被删除）。`
    : '目前没有文章使用它。'

  try {
    await ElMessageBox.confirm(
      `确定要删除标签「${row.name}」吗？${impact}删除后无法恢复。`,
      '危险操作',
      { type: 'error', confirmButtonText: '确认删除', cancelButtonText: '取消' },
    )
  } catch { return }

  const res = await request('/admin/tag/' + row.id, { method: 'DELETE' })
  if (res.ok) {
    ElMessage.success('已删除')
    emit('refresh')
    return
  }
  // 【404 = 别人（或另一个标签页）已经把它删掉了】
  //   这时什么都不做的话，用户看到的是一条"标签不存在"的报错 + 一个还列着它的表格，
  //   他会以为删除失败、再点一次。刷新列表才是能自愈的做法：表格里那条自己就没了。
  if (res.code === 404) {
    ElMessage.warning('这个标签已经不在了，列表已刷新')
    emit('refresh')
  }
}
</script>
