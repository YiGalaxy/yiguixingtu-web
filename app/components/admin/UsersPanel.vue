<template>
  <!--
    用户管理。
    【为什么这一页整个（含状态与逻辑）都能搬进组件】它用的是自己的分页查询条件、
    自己的表格数据，和别处没有任何共享 —— 唯一从外面来的是 `myId`
    （"不能对自己操作"那三个按钮靠它禁用）。所以这里不需要往父页面抛数据，
    只把"当前登录用户是谁"当只读 prop 收下来。
  -->
  <header class="top">
    <h1>用户管理</h1>
    <p>共 {{ total }} 位注册用户</p>
  </header>

  <!-- 搜索 / 筛选栏 -->
  <div class="toolbar glass">
    <el-input
      v-model="query.keyword" placeholder="搜索用户名 / 昵称"
      clearable class="tb-item" @keyup.enter="search" />
    <el-select v-model="query.role" placeholder="全部角色" clearable class="tb-item">
      <el-option label="管理员" value="ADMIN" />
      <el-option label="游客" value="GUEST" />
    </el-select>
    <el-select v-model="query.status" placeholder="全部状态" clearable class="tb-item">
      <el-option label="正常" :value="1" />
      <el-option label="禁用" :value="0" />
    </el-select>
    <el-button type="primary" @click="search">查询</el-button>
    <el-button @click="reset">重置</el-button>
  </div>

  <!-- 表格 -->
  <div class="panel glass">
    <!-- 排序说明：sortable="custom" 表示【由后端排序】而不是前端本地排。
         因为我们是分页查询，只排当前页是错的 —— 必须让后端排完再分页。
         点表头会触发 @sort-change，我们把字段和方向发给后端。 -->
    <el-table
      ref="tableRef" v-loading="loading" :data="users" empty-text="暂无用户数据"
      :default-sort="{ prop: 'createTime', order: 'descending' }"
      @sort-change="onSortChange">
      <!-- 列宽合计必须 ≤ 表格可用宽度，否则 el-table 会横向溢出，
           而右侧 fixed 的「操作」列会被钉在容器右边缘、压住「创建时间」。
           当前合计：76+104+94+86+86+164+200 = 810px
           注：ID 列不能更窄了 —— 表头「ID」+ 排序箭头实测需要 39px，
           64px 的列只剩 1px 余量，换个缩放比例就可能被切掉，所以留到 76px。 -->
      <el-table-column prop="id" label="ID" width="76" sortable="custom" />
      <el-table-column prop="username" label="用户名" min-width="104" sortable="custom" />
      <el-table-column prop="nickname" label="昵称" min-width="94" sortable="custom" />

      <el-table-column prop="role" label="角色" width="86" sortable="custom">
        <template #default="{ row }">
          <el-tag :type="row.role === 'ADMIN' ? 'warning' : 'info'" effect="dark">
            {{ row.role === 'ADMIN' ? '管理员' : '游客' }}
          </el-tag>
        </template>
      </el-table-column>

      <el-table-column prop="status" label="状态" width="86" sortable="custom">
        <template #default="{ row }">
          <el-tag :type="row.status === 1 ? 'success' : 'danger'" effect="plain">
            {{ row.status === 1 ? '正常' : '禁用' }}
          </el-tag>
        </template>
      </el-table-column>

      <el-table-column prop="createTime" label="创建时间" min-width="164" sortable="custom">
        <template #default="{ row }">{{ formatDateTime(row.createTime) }}</template>
      </el-table-column>

      <el-table-column label="操作" width="200" fixed="right">
        <template #default="{ row }">
          <el-button size="small" :disabled="row.id === myId" @click="openEdit(row)">编辑</el-button>
          <el-button
            size="small"
            :type="row.status === 1 ? 'warning' : 'success'"
            :disabled="row.id === myId"
            @click="toggleStatus(row)">
            {{ row.status === 1 ? '禁用' : '启用' }}
          </el-button>
          <el-button
            size="small" type="danger"
            :disabled="row.id === myId"
            @click="removeUser(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- 分页 -->
    <div class="pager">
      <el-pagination
        background
        layout="total, sizes, prev, pager, next"
        :total="total"
        :current-page="query.page"
        :page-size="query.size"
        :page-sizes="[5, 10, 20, 50]"
        @current-change="onPageChange"
        @size-change="onSizeChange" />
    </div>
  </div>

  <!-- ==================== 编辑用户弹窗 ==================== -->
  <!-- 【弹窗为什么放在这个组件里，而不是留在 admin.vue】它只被"编辑"这一个按钮打开、
       只操作这一页的表格数据，没有任何跨面板的用途。而且 scoped 样式对
       teleport 到 body 的弹层同样有效（data-v 属性是渲染时打在元素上的，
       跟元素最后被放到哪个父节点无关），所以弹窗自己的样式也能跟着它走。 -->
  <el-dialog
    v-model="editVisible" class="user-edit-modal" title="编辑用户"
    width="420px" :close-on-click-modal="false">
    <div class="ed-row">
      <span class="ed-label">用户名</span>
      <span class="ed-static">{{ editForm.username }}</span>
    </div>

    <div class="ed-row">
      <span class="ed-label">角色权限</span>
      <el-select v-model="editForm.role" style="width:100%">
        <el-option label="管理员（可进后台、可管理）" value="ADMIN" />
        <el-option label="游客（只能浏览）" value="GUEST" />
      </el-select>
    </div>

    <div class="ed-row">
      <span class="ed-label">新密码</span>
      <el-input
        v-model="editForm.password" type="password" show-password
        placeholder="留空则不修改密码（6-20 位）" />
    </div>

    <p class="ed-tip">提示：角色和密码只填需要改的那一项，留空 / 未变动则不会提交。</p>

    <template #footer>
      <el-button @click="editVisible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="saveEdit">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ElMessage, ElMessageBox } from 'element-plus'

/**
 * 【myId 是唯一的入参】它来自父页面的 `useAuth().user.id`，
 * 用来禁用"对自己操作"的三个按钮（改自己的角色 / 禁自己 / 删自己）。
 * 为什么用 prop 而不是在这里自己读一次 `useAuth()`：
 *   父页面还会在挂载时用 `GET /auth/me` 把用户信息补回来（刷新页面后
 *   `useState('user')` 是 null，见 admin.vue 的 ensureUser），
 *   两边各读一次就有两个来源，其中一个是空的、按钮就禁不住了。
 * 类型写成 `[Number, String]`：id 走 JSON 回来是数字，
 * 但两边类型一旦不一致，`row.id === myId` 就会恒为 false（表现是"能把自己禁掉"），
 * 所以这里放宽类型、不做隐式转换，由父页面保证 id 的原样传递。
 */
defineProps({
  myId: { type: [Number, String], default: null },
})

const { request } = useApi()

const users = ref([])
const total = ref(0)
const loading = ref(false)

// sortField / sortOrder：点表头排序时发给后端（后端有字段白名单校验）
const query = reactive({
  page: 1, size: 10,
  keyword: '', role: '', status: null,
  sortField: '', sortOrder: '',
})

// 表格实例：重置时用来清掉表头的排序箭头
const tableRef = ref()

// ---------- 拉列表 ----------
const fetchUsers = async () => {
  loading.value = true
  const res = await request('/user/page', {
    params: {
      page: query.page,
      size: query.size,
      keyword: query.keyword || undefined,
      role: query.role || undefined,
      status: query.status === null ? undefined : query.status,
      sortField: query.sortField || undefined,
      sortOrder: query.sortOrder || undefined,
    },
  })
  loading.value = false
  if (!res.ok) return
  users.value = res.data.records || []
  total.value = Number(res.data.total) || 0
}

const search = () => { query.page = 1; fetchUsers() }
const reset = () => {
  query.keyword = ''; query.role = ''; query.status = null; query.page = 1
  query.sortField = ''; query.sortOrder = ''
  tableRef.value?.clearSort()      // 清掉表头的排序箭头，回到默认排序
  fetchUsers()
}
const onPageChange = (p) => { query.page = p; fetchUsers() }
const onSizeChange = (s) => { query.size = s; query.page = 1; fetchUsers() }

// ---------- 点表头排序 ----------
// Element Plus 给的是 order: 'ascending' | 'descending' | null
// 我们转成后端约定的 'asc' / 'desc'，空字符串代表"不排序"（后端会用默认排序）
const onSortChange = ({ prop, order }) => {
  query.sortField = order ? prop : ''
  query.sortOrder = order === 'ascending' ? 'asc' : (order === 'descending' ? 'desc' : '')
  query.page = 1                   // 换排序后回到第 1 页
  fetchUsers()
}

// ---------- 启用 / 禁用 ----------
const toggleStatus = async (row) => {
  const next = row.status === 1 ? 0 : 1
  const action = next === 1 ? '启用' : '禁用'
  try {
    await ElMessageBox.confirm('确定要' + action + '用户「' + row.username + '」吗？', '确认操作', {
      type: 'warning', confirmButtonText: '确定', cancelButtonText: '取消',
    })
  } catch { return }

  const res = await request('/user/' + row.id + '/status', {
    method: 'PUT', params: { status: next },
  })
  if (res.ok) { ElMessage.success('已' + action); fetchUsers() }
}

// ---------- 删除用户 ----------
const removeUser = async (row) => {
  try {
    await ElMessageBox.confirm(
      '确定要删除用户「' + row.username + '」吗？删除后该账号将无法再登录。',
      '危险操作',
      { type: 'error', confirmButtonText: '确认删除', cancelButtonText: '取消' }
    )
  } catch { return }

  const res = await request('/user/' + row.id, { method: 'DELETE' })
  if (res.ok) { ElMessage.success('已删除'); fetchUsers() }
}

// ---------- 编辑弹窗 ----------
const editVisible = ref(false)
const saving = ref(false)
const editForm = reactive({ id: null, username: '', role: 'GUEST', password: '' })

const openEdit = (row) => {
  editForm.id = row.id
  editForm.username = row.username
  editForm.role = row.role
  editForm.password = ''          // 每次打开都清空，避免误改
  editVisible.value = true
}

const saveEdit = async () => {
  const row = users.value.find(u => u.id === editForm.id)
  const roleChanged = row && row.role !== editForm.role
  const pwdChanged = !!editForm.password

  if (!roleChanged && !pwdChanged) {
    ElMessage.info('没有需要保存的修改')
    editVisible.value = false
    return
  }

  saving.value = true
  let allOk = true

  // ① 改角色
  if (roleChanged) {
    const r = await request('/user/' + editForm.id + '/role', {
      method: 'PUT', params: { role: editForm.role },
    })
    if (!r.ok) allOk = false
  }

  // ② 改密码
  if (pwdChanged) {
    const r = await request('/user/' + editForm.id + '/password', {
      method: 'PUT', body: { password: editForm.password },
    })
    if (!r.ok) allOk = false
  }

  saving.value = false
  if (allOk) {
    ElMessage.success('保存成功')
    editVisible.value = false
    fetchUsers()
  }
}

/**
 * 【为什么这一页的首次加载在这里，而不是父页面的 onMounted 里】
 * 用户管理是后台的**默认菜单**（admin.vue 里 `cur = ref('users')`），
 * 所以父页面一挂载它就跟着挂载了 —— 在这里拉一次，等于原来"父页面挂载时拉一次"，
 * 一次不多一次不少。而"不能操作自己"那三个按钮靠的是 `myId` 这个 prop：
 * 父页面的 `/auth/me` 回来之后它才会变成真实 id，那时按钮会自动从禁用变成可用
 * （props 是响应式的，不需要谁再通知谁）。
 */
onMounted(fetchUsers)
</script>

<style scoped>
/* 弹窗内的行（用户编辑弹窗专有） */
.ed-row { display: flex; align-items: center; gap: 12px; margin-bottom: 18px; }
.ed-label { width: 72px; flex-shrink: 0; color: var(--muted); font-size: 13px; }
.ed-static { color: var(--ink); font-weight: 600; }
.ed-tip { color: var(--muted); font-size: 12px; margin: 4px 0 0; line-height: 1.6; }
</style>
