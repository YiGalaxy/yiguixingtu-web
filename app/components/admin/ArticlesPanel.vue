<template>
  <!--
    文章管理：筛选工具栏 + 表格 + 分页，外加一个「新建 / 编辑文章」弹窗。
    【数据为什么从外面来】文章列表是**概览页的「最近文章」也要用的同一份数据**，
    所以它由父页面持有（admin.vue 的 `articles` / `artTotal` / `artLoading` / `artQuery`），
    这里只负责渲染 + 把交互变成事件抛回去：
      · v-model:query  —— 筛选条件是同一个 reactive 对象，这里改的就是父页面那份
      · refresh        —— "条件变了，重新拉一次"，父页面接的是 fetchArticles
      · refresh-tags   —— 打开弹窗要刷新标签选项，那份数据也在父页面
    这样"数据只有一个来源"，不会出现"表格里是 A、概览里是 B"。
  -->
  <header class="top">
    <h1>文章管理</h1>
    <p>共 {{ total }} 篇文章</p>
  </header>

  <!-- 搜索 / 筛选栏 -->
  <div class="toolbar glass">
    <el-input
      v-model="query.keyword" placeholder="搜索标题 / 摘要"
      clearable class="tb-item" @keyup.enter="search" />
    <el-select v-model="query.categoryId" placeholder="全部分类" clearable class="tb-item">
      <el-option v-for="c in categories" :key="c.id" :label="c.name" :value="c.id" />
    </el-select>
    <el-select v-model="query.status" placeholder="全部状态" clearable class="tb-item">
      <el-option label="已发布" :value="1" />
      <el-option label="草稿" :value="0" />
    </el-select>
    <el-button type="primary" @click="search">查询</el-button>
    <el-button @click="reset">重置</el-button>
    <el-button type="success" @click="editDialog?.openCreate()">+ 新建文章</el-button>
  </div>

  <!-- 表格 -->
  <div class="panel glass">
    <!-- 列宽合计 70+210+84+76+164+186 = 790px。
         这个数字必须 ≤ 表格可用宽度（窄窗口下约 810px），
         否则右侧 fixed 的「操作」列会压住「更新时间」—— 用户表那次的坑。 -->
    <el-table
      ref="artTableRef" v-loading="loading" :data="articles"
      empty-text="还没有文章，点右上角「新建文章」开始写吧"
      :default-sort="{ prop: 'createTime', order: 'descending' }"
      @sort-change="onArtSortChange">
      <el-table-column prop="id" label="ID" width="70" sortable="custom" />

      <el-table-column prop="title" label="标题" min-width="210" sortable="custom">
        <template #default="{ row }">
          <!-- 标题 + 标记做成一行，省掉一整个「分类」列的位置 -->
          <span class="art-title">{{ row.title }}</span>
          <el-tag v-if="row.isTop === 1" size="small" type="warning" effect="plain" class="art-tag">置顶</el-tag>
          <el-tag v-if="row.categoryName" size="small" type="info" effect="plain" class="art-tag">
            {{ row.categoryName }}
          </el-tag>
        </template>
      </el-table-column>

      <el-table-column prop="status" label="状态" width="84" sortable="custom">
        <template #default="{ row }">
          <el-tag :type="row.status === 1 ? 'success' : 'info'" effect="plain">
            {{ row.status === 1 ? '已发布' : '草稿' }}
          </el-tag>
        </template>
      </el-table-column>

      <el-table-column prop="viewCount" label="浏览" width="76" sortable="custom" />

      <el-table-column prop="updateTime" label="更新时间" min-width="164" sortable="custom">
        <template #default="{ row }">{{ formatDateTime(row.updateTime) }}</template>
      </el-table-column>

      <el-table-column label="操作" width="186" fixed="right">
        <template #default="{ row }">
          <el-button size="small" @click="editDialog?.openEdit(row)">编辑</el-button>
          <el-button
            size="small"
            :type="row.status === 1 ? 'warning' : 'success'"
            @click="toggleArticleStatus(row)">
            {{ row.status === 1 ? '下架' : '发布' }}
          </el-button>
          <el-button size="small" type="danger" @click="removeArticle(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="pager">
      <el-pagination
        background
        layout="total, sizes, prev, pager, next"
        :total="total"
        :current-page="query.page"
        :page-size="query.size"
        :page-sizes="[5, 10, 20, 50]"
        @current-change="onArtPageChange"
        @size-change="onArtSizeChange" />
    </div>
  </div>

  <!-- 新建 / 编辑弹窗。它自己扛着整张表单的状态（含 Markdown 编辑器），
       这里只通过 ref 说"打开新建" / "打开这一篇"，并通过两个事件
       要求外面"刷新文章表格"和"刷新标签选项"。 -->
  <AdminArticleEditDialog
    ref="editDialog"
    :categories="categories"
    :tags="tags"
    @refresh-tags="emit('refresh-tags')"
    @saved="emit('refresh')" />
</template>

<script setup>
import { ElMessage, ElMessageBox } from 'element-plus'

/**
 * 【query 为什么用 v-model 而不是普通 prop】
 * 筛选条件是一个 reactive 对象，父页面的 `fetchArticles()` 读的就是它。
 * 这里必须改**同一个对象**：如果组件内复制一份再往上抛，就会出现
 * "输入框里的条件"和"真正发给后端的条件"两个来源，两者一旦不同步，
 * 表现是"界面筛选了但列表没变"，而且哪一份才是对的没人说得清。
 * 用 `v-model:query` 明确表达"这个对象是父子共用的"。
 */
const query = defineModel('query', { type: Object, required: true })

/** 列表数据与分页总数由父页面持有（概览页的「最近文章」用的是同一份） */
defineProps({
  articles: { type: Array, default: () => [] },
  total: { type: Number, default: 0 },
  loading: { type: Boolean, default: false },
  /** 分类选项：与文章弹窗的分类单选、「分类管理」页共用父页面那一份 */
  categories: { type: Array, default: () => [] },
  /** 标签选项：与「标签管理」页共用父页面那一份 */
  tags: { type: Array, default: () => [] },
})

const emit = defineEmits(['refresh', 'refresh-tags'])

const { request } = useApi()

// 表格实例：重置时用来清掉表头的排序箭头
const artTableRef = ref()

// 弹窗组件的引用：它的两个"打开"方法由它自己 defineExpose 出来
const editDialog = ref()

// ---------- 筛选 / 分页 / 排序：改的是共用的那个 query 对象，然后请父页面重新拉 ----------
const search = () => { query.value.page = 1; emit('refresh') }
const reset = () => {
  query.value.keyword = ''; query.value.categoryId = null; query.value.status = null; query.value.page = 1
  query.value.sortField = ''; query.value.sortOrder = ''
  // 【clearSort 只能在组件内做】它操作的是 el-table 实例，而实例在这一层
  artTableRef.value?.clearSort()
  emit('refresh')
}
const onArtPageChange = (p) => { query.value.page = p; emit('refresh') }
const onArtSizeChange = (s) => { query.value.size = s; query.value.page = 1; emit('refresh') }
const onArtSortChange = ({ prop, order }) => {
  query.value.sortField = order ? prop : ''
  query.value.sortOrder = order === 'ascending' ? 'asc' : (order === 'descending' ? 'desc' : '')
  query.value.page = 1
  emit('refresh')
}

// ---------- 发布 / 下架 ----------
const toggleArticleStatus = async (row) => {
  const next = row.status === 1 ? 0 : 1
  const action = next === 1 ? '发布' : '下架'
  const tip = next === 1
    ? '确定要发布《' + row.title + '》吗？发布后前台立即可见。'
    : '确定要下架《' + row.title + '》吗？下架后前台立刻看不到它。'

  try {
    await ElMessageBox.confirm(tip, '确认' + action, {
      type: 'warning', confirmButtonText: '确定', cancelButtonText: '取消',
    })
  } catch { return }

  const res = await request('/admin/article/' + row.id + '/status', {
    method: 'PUT', params: { status: next },
  })
  if (res.ok) { ElMessage.success('已' + action); emit('refresh') }
}

// ---------- 删除文章 ----------
const removeArticle = async (row) => {
  try {
    await ElMessageBox.confirm(
      '确定要删除《' + row.title + '》吗？删除后前台将不再可见。',
      '危险操作',
      { type: 'error', confirmButtonText: '确认删除', cancelButtonText: '取消' }
    )
  } catch { return }

  const res = await request('/admin/article/' + row.id, { method: 'DELETE' })
  if (res.ok) { ElMessage.success('已删除'); emit('refresh') }
}
</script>
