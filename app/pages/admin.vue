<template>
  <div class="admin">
    <!-- ==================== 左侧菜单 ==================== -->
    <aside class="side glass">
      <div class="side-brand"><span class="mk">✦</span> 亿轨星途 · 后台</div>
      <nav class="side-nav">
        <a v-for="m in menus" :key="m.key"
           :class="{ active: cur === m.key }"
           @click="cur = m.key">{{ m.label }}</a>
      </nav>
    </aside>

    <div class="main">

      <!-- ==================== ① 概览 ==================== -->
      <template v-if="cur === 'overview'">
        <header class="top">
          <h1>概览</h1>
          <p>后台骨架已就绪，等你对接后端接口。</p>
        </header>
        <div class="stats">
          <div class="stat glass"><span>文章</span><b>{{ artTotal }}</b></div>
          <div class="stat glass"><span>用户</span><b>{{ total }}</b></div>
          <div class="stat glass"><span>分类</span><b>{{ categories.length }}</b></div>
          <div class="stat glass"><span>标签</span><b>0</b></div>
        </div>
        <div class="panel glass">
          <div class="panel-head">最近文章</div>
          <div v-if="articles.length === 0" class="empty">还没有文章，去「文章管理」写第一篇吧</div>
          <ul v-else class="recent">
            <li v-for="a in articles.slice(0, 5)" :key="a.id">
              <span class="r-title">{{ a.title }}</span>
              <span class="r-meta">
                <el-tag :type="a.status === 1 ? 'success' : 'info'" size="small" effect="plain">
                  {{ a.status === 1 ? '已发布' : '草稿' }}
                </el-tag>
                {{ fmtTime(a.createTime) }}
              </span>
            </li>
          </ul>
        </div>
      </template>

      <!-- ==================== ② 文章管理 ==================== -->
      <template v-else-if="cur === 'articles'">
        <header class="top">
          <h1>文章管理</h1>
          <p>共 {{ artTotal }} 篇文章</p>
        </header>

        <!-- 搜索 / 筛选栏 -->
        <div class="toolbar glass">
          <el-input v-model="artQuery.keyword" placeholder="搜索标题 / 摘要"
                    clearable class="tb-item" @keyup.enter="searchArticles" />
          <el-select v-model="artQuery.categoryId" placeholder="全部分类" clearable class="tb-item">
            <el-option v-for="c in categories" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
          <el-select v-model="artQuery.status" placeholder="全部状态" clearable class="tb-item">
            <el-option label="已发布" :value="1" />
            <el-option label="草稿" :value="0" />
          </el-select>
          <el-button type="primary" @click="searchArticles">查询</el-button>
          <el-button @click="resetArticles">重置</el-button>
          <el-button type="success" @click="openCreate">+ 新建文章</el-button>
        </div>

        <!-- 表格 -->
        <div class="panel glass">
          <!-- 列宽合计 70+210+84+76+164+186 = 790px。
               这个数字必须 ≤ 表格可用宽度（窄窗口下约 810px），
               否则右侧 fixed 的「操作」列会压住「更新时间」—— 用户表那次的坑。 -->
          <el-table ref="artTableRef" :data="articles" v-loading="artLoading"
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
              <template #default="{ row }">{{ fmtTime(row.updateTime) }}</template>
            </el-table-column>

            <el-table-column label="操作" width="186" fixed="right">
              <template #default="{ row }">
                <el-button size="small" @click="openArticleEdit(row)">编辑</el-button>
                <el-button size="small"
                           :type="row.status === 1 ? 'warning' : 'success'"
                           @click="toggleArticleStatus(row)">
                  {{ row.status === 1 ? '下架' : '发布' }}
                </el-button>
                <el-button size="small" type="danger" @click="removeArticle(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>

          <div class="pager">
            <el-pagination background
              layout="total, sizes, prev, pager, next"
              :total="artTotal"
              :current-page="artQuery.page"
              :page-size="artQuery.size"
              :page-sizes="[5, 10, 20, 50]"
              @current-change="onArtPageChange"
              @size-change="onArtSizeChange" />
          </div>
        </div>
      </template>

      <!-- ==================== ③ 用户管理 ==================== -->
      <template v-else-if="cur === 'users'">
        <header class="top">
          <h1>用户管理</h1>
          <p>共 {{ total }} 位注册用户</p>
        </header>

        <!-- 搜索 / 筛选栏 -->
        <div class="toolbar glass">
          <el-input v-model="query.keyword" placeholder="搜索用户名 / 昵称"
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
          <el-table ref="tableRef" :data="users" v-loading="loading" empty-text="暂无用户数据"
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
              <template #default="{ row }">{{ fmtTime(row.createTime) }}</template>
            </el-table-column>

            <el-table-column label="操作" width="200" fixed="right">
              <template #default="{ row }">
                <el-button size="small" @click="openEdit(row)" :disabled="row.id === myId">编辑</el-button>
                <el-button size="small"
                           :type="row.status === 1 ? 'warning' : 'success'"
                           :disabled="row.id === myId"
                           @click="toggleStatus(row)">
                  {{ row.status === 1 ? '禁用' : '启用' }}
                </el-button>
                <el-button size="small" type="danger"
                           :disabled="row.id === myId"
                           @click="removeUser(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>

          <!-- 分页 -->
          <div class="pager">
            <el-pagination background
              layout="total, sizes, prev, pager, next"
              :total="total"
              :current-page="query.page"
              :page-size="query.size"
              :page-sizes="[5, 10, 20, 50]"
              @current-change="onPageChange"
              @size-change="onSizeChange" />
          </div>
        </div>
      </template>

      <!-- ==================== ④ 其他模块占位 ==================== -->
      <template v-else>
        <header class="top"><h1>{{ curLabel }}</h1><p>该模块开发中。</p></header>
        <div class="panel glass"><div class="empty">该模块开发中 · 敬请期待</div></div>
      </template>

    </div>

    <!-- ==================== 编辑用户弹窗 ==================== -->
    <el-dialog v-model="editVisible" class="user-edit-modal" title="编辑用户"
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
        <el-input v-model="editForm.password" type="password" show-password
                  placeholder="留空则不修改密码（6-20 位）" />
      </div>

      <p class="ed-tip">提示：角色和密码只填需要改的那一项，留空 / 未变动则不会提交。</p>

      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveEdit">保存</el-button>
      </template>
    </el-dialog>

    <!-- ==================== 新建 / 编辑文章弹窗 ==================== -->
    <!-- destroy-on-close：关掉时销毁内容。编辑器是个重组件，
         不销毁的话每次打开都会累积一个 CodeMirror 实例，写久了会卡。 -->
    <el-dialog v-model="artEditVisible" class="art-edit-modal"
               :title="artForm.id ? '编辑文章' : '新建文章'"
               width="min(1080px, 92vw)" top="4vh"
               :close-on-click-modal="false" destroy-on-close>

      <div class="af-row">
        <span class="ed-label">标题</span>
        <el-input v-model="artForm.title" placeholder="给你的文章起个标题"
                  maxlength="200" show-word-limit />
      </div>

      <div class="af-row">
        <span class="ed-label">分类</span>
        <el-select v-model="artForm.categoryId" placeholder="选择分类（也可以不选）"
                   clearable style="width:100%">
          <el-option v-for="c in categories" :key="c.id" :label="c.name" :value="c.id" />
        </el-select>
      </div>

      <div class="af-row">
        <span class="ed-label">封面</span>
        <el-input v-model="artForm.cover" placeholder="封面图 URL（可不填）" />
      </div>

      <div class="af-row">
        <span class="ed-label">摘要</span>
        <el-input v-model="artForm.summary" type="textarea" :rows="2"
                  placeholder="留空则自动从正文截取前 120 字"
                  maxlength="500" show-word-limit />
      </div>

      <div class="af-row">
        <span class="ed-label">选项</span>
        <div class="af-opts">
          <el-switch v-model="artForm.isTop" :active-value="1" :inactive-value="0"
                     active-text="置顶" />
          <el-switch v-model="artForm.status" :active-value="1" :inactive-value="0"
                     active-text="已发布" inactive-text="草稿" />
          <!-- 这条提示很重要：草稿是安全的默认值，不点这个开关就不会发出去 -->
          <span class="af-hint">{{ artForm.status === 1 ? '保存后前台立即可见' : '存为草稿，前台看不到' }}</span>
        </div>
      </div>

      <div class="af-editor">
        <MdEditor v-model="artForm.content"
                  theme="dark"
                  :language="zh_CN"
                  :toolbarsExclude="['github', 'fullscreen', 'preview-html']" />
      </div>

      <template #footer>
        <span class="af-foot-tip">正文用 Markdown 写，右侧实时预览</span>
        <el-button @click="artEditVisible = false">取消</el-button>
        <el-button type="primary" :loading="artSaving" @click="saveArticle">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ElMessage, ElMessageBox } from 'element-plus'
// Markdown 编辑器。zh_CN 是官方中文语言包（工具栏的鼠标提示、字数统计等都会变中文）
// 样式必须单独引一次 —— 这个库不带自动注入 CSS
import { MdEditor, zh_CN } from 'md-editor-v3'
import 'md-editor-v3/lib/style.css'

// 路由守卫：没登录就弹登录框并回首页
definePageMeta({ middleware: 'admin' })

const { request } = useApi()
const { user } = useAuth()

// 当前登录用户 ID：用来禁用「操作自己」的按钮
const myId = computed(() => user.value?.id)

// ---------- 左侧菜单 ----------
const menus = [
  { key: 'overview', label: '概览' },
  { key: 'articles', label: '文章管理' },
  { key: 'users',    label: '用户管理' },
  { key: 'taxonomy', label: '分类 / 标签' },
  { key: 'settings', label: '设置' },
]
const cur = ref('users')
const curLabel = computed(() => menus.find(m => m.key === cur.value)?.label || '')

// ---------- 列表数据 ----------
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

// ---------- 刷新登录用户信息 ----------
// useState('user') 刷新页面后会变回 null，此时 myId 是 undefined，
// 「不能操作自己」的按钮就会失效，所以用 /auth/me 补一次
const ensureUser = async () => {
  if (user.value?.id) return
  const res = await request('/auth/me')
  if (res.ok) user.value = res.data
}

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

// ================================================================
//  文章管理
// ================================================================

const articles = ref([])
const artTotal = ref(0)
const artLoading = ref(false)
const artTableRef = ref()

// 分类列表：筛选下拉框 + 编辑弹窗里的分类选择都靠它
const categories = ref([])

const artQuery = reactive({
  page: 1, size: 10,
  keyword: '', categoryId: null, status: null,
  sortField: '', sortOrder: '',
})

// ---------- 拉分类（公开接口，不需要 token）----------
const fetchCategories = async () => {
  const res = await request('/category/list')
  if (res.ok) categories.value = res.data || []
}

// ---------- 拉文章列表 ----------
// 【注意这里打的是 /admin/article/page，不是前台的 /article/page】
// 区别：后台接口带 token 且要求 ADMIN，能看见草稿；前台接口一律隐藏草稿。
// 管理后台当然要看得见自己没写完的草稿，所以走后台接口。
const fetchArticles = async () => {
  artLoading.value = true
  const res = await request('/admin/article/page', {
    params: {
      page: artQuery.page,
      size: artQuery.size,
      keyword: artQuery.keyword || undefined,
      categoryId: artQuery.categoryId === null ? undefined : artQuery.categoryId,
      status: artQuery.status === null ? undefined : artQuery.status,
      sortField: artQuery.sortField || undefined,
      sortOrder: artQuery.sortOrder || undefined,
    },
  })
  artLoading.value = false
  if (!res.ok) return
  articles.value = res.data.records || []
  artTotal.value = Number(res.data.total) || 0
}

const searchArticles = () => { artQuery.page = 1; fetchArticles() }
const resetArticles = () => {
  artQuery.keyword = ''; artQuery.categoryId = null; artQuery.status = null; artQuery.page = 1
  artQuery.sortField = ''; artQuery.sortOrder = ''
  artTableRef.value?.clearSort()
  fetchArticles()
}
const onArtPageChange = (p) => { artQuery.page = p; fetchArticles() }
const onArtSizeChange = (s) => { artQuery.size = s; artQuery.page = 1; fetchArticles() }
const onArtSortChange = ({ prop, order }) => {
  artQuery.sortField = order ? prop : ''
  artQuery.sortOrder = order === 'ascending' ? 'asc' : (order === 'descending' ? 'desc' : '')
  artQuery.page = 1
  fetchArticles()
}

// ---------- 新建 / 编辑弹窗 ----------
const artEditVisible = ref(false)
const artSaving = ref(false)

const artForm = reactive({
  id: null, title: '', summary: '', content: '', cover: '',
  categoryId: null,
  status: 0,      // 默认草稿 —— 安全默认值，避免半成品被直接发出去
  isTop: 0,
})

const resetArtForm = () => {
  artForm.id = null
  artForm.title = ''
  artForm.summary = ''
  artForm.content = ''
  artForm.cover = ''
  artForm.categoryId = null
  artForm.status = 0
  artForm.isTop = 0
}

const openCreate = () => {
  resetArtForm()
  artEditVisible.value = true
}

// 打开编辑：这里有个容易踩的坑 ——
// 列表接口【不返回正文】(后端特意排除了 content 这个大字段，为了省带宽)，
// 所以点开编辑时必须再单独拉一次详情，否则编辑器里是空的，
// 一保存就把正文清空了。
const openArticleEdit = async (row) => {
  resetArtForm()
  artForm.id = row.id
  artForm.title = row.title
  artForm.summary = row.summary || ''
  artForm.cover = row.cover || ''
  artForm.categoryId = row.categoryId
  artForm.status = row.status
  artForm.isTop = row.isTop

  const res = await request('/admin/article/' + row.id)
  if (res.ok) artForm.content = res.data.content || ''

  artEditVisible.value = true
}

const saveArticle = async () => {
  if (!artForm.title.trim()) {
    ElMessage.warning('标题不能为空')
    return
  }

  artSaving.value = true

  // 空字符串一律转成 null 提交：
  // 后端 update 用的是显式 SET，传 null 会真的把该字段清空，
  // 传 '' 则会往库里写一个空字符串。语义上"没填"应该是 null。
  const body = {
    title: artForm.title.trim(),
    summary: artForm.summary || null,
    content: artForm.content || null,
    cover: artForm.cover || null,
    categoryId: artForm.categoryId,
    status: artForm.status,
    isTop: artForm.isTop,
  }

  const isEdit = !!artForm.id
  const res = isEdit
    ? await request('/admin/article/' + artForm.id, { method: 'PUT', body })
    : await request('/admin/article', { method: 'POST', body })

  artSaving.value = false

  if (res.ok) {
    ElMessage.success(isEdit ? '已保存' : '文章已创建')
    artEditVisible.value = false
    fetchArticles()
  }
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
  if (res.ok) { ElMessage.success('已' + action); fetchArticles() }
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
  if (res.ok) { ElMessage.success('已删除'); fetchArticles() }
}

// ---------- 时间格式化 ----------
const fmtTime = (t) => (t ? String(t).replace('T', ' ').slice(0, 19) : '—')

// 切到文章管理时如果还没加载过，补一次
watch(cur, (v) => {
  if (v === 'articles' && articles.value.length === 0) fetchArticles()
})

onMounted(async () => {
  // 三件事互不依赖，并行发出去（Promise.all 而不是三次 await，省两个来回的网络时间）
  await ensureUser()
  await Promise.all([fetchUsers(), fetchCategories(), fetchArticles()])
})
</script>

<style scoped>
.admin { display: flex; gap: 24px; max-width: 1440px; margin: 0 auto; padding: 32px; min-height: 70vh; }
/* 毛玻璃降档：blur 14->10 并去掉 saturate()，减轻背景视频播放时的每帧开销 */
.glass { background: rgba(36,54,92,.34); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); border: 1px solid rgba(180,210,245,.14); box-shadow: inset 0 1px 0 rgba(255,255,255,.08); }

.side { width: 220px; flex-shrink: 0; border-radius: 20px; padding: 24px 18px; height: fit-content; }
.side-brand { display: flex; align-items: center; gap: 8px; font-weight: 800; font-size: 15px; margin-bottom: 24px; }
.side-brand .mk { color: var(--accent); }
.side-nav { display: flex; flex-direction: column; gap: 6px; }
.side-nav a { padding: 10px 14px; border-radius: 12px; color: var(--muted); cursor: pointer; transition: background .2s, color .2s; }
.side-nav a:hover { color: var(--ink); background: rgba(255,255,255,.05); }
.side-nav a.active { color: var(--accent); background: rgba(242,193,78,.12); font-weight: 600; }

.main { flex: 1; min-width: 0; }
.top { margin-bottom: 24px; }
.top h1 { font-size: 30px; font-weight: 800; margin: 0 0 8px; }
.top p { color: var(--muted); margin: 0; }

.stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px; }
.stat { border-radius: 18px; padding: 22px; display: flex; flex-direction: column; gap: 10px; }
.stat span { color: var(--muted); font-size: 13px; }
.stat b { font-size: 34px; font-weight: 800; color: var(--accent); }

.panel {
  border-radius: 20px;
  padding: 24px;
  /* 排序箭头图标，见下方「排序箭头」一节。
     用 data URI 内联一个 16x16 的 SVG，配合 mask 使用。
     %20 是空格的 URL 编码（data URI 里空格必须转义），解码后的真面目是：
       <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'>
         <path d='M8 13.5V3.8M8 3.8L3.9 7.9M8 3.8L12.1 7.9'
               fill='none' stroke='black' stroke-width='2.1'
               stroke-linecap='round' stroke-linejoin='round'/>
       </svg>
     就是【一条竖线 + 一个箭头帽】。配合 mask 用而不是直接当图片，
     是因为这样才能用 background-color 自由改颜色，跟着主题走。 */
  --sort-arrow: url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2016%2016'%3E%3Cpath%20d='M8%2013.5V3.8M8%203.8L3.9%207.9M8%203.8L12.1%207.9'%20fill='none'%20stroke='black'%20stroke-width='2.1'%20stroke-linecap='round'%20stroke-linejoin='round'/%3E%3C/svg%3E");
}
.panel-head { font-weight: 700; margin-bottom: 18px; }
.empty { color: var(--muted); text-align: center; padding: 40px 0; font-size: 14px; }

.toolbar { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; border-radius: 18px; padding: 16px 18px; margin-bottom: 20px; }
.tb-item { width: 180px; }
.pager { display: flex; justify-content: flex-end; margin-top: 18px; }

/* 编辑弹窗内的行 */
.ed-row { display: flex; align-items: center; gap: 12px; margin-bottom: 18px; }
.ed-label { width: 72px; flex-shrink: 0; color: var(--muted); font-size: 13px; }
.ed-static { color: var(--ink); font-weight: 600; }
.ed-tip { color: var(--muted); font-size: 12px; margin: 4px 0 0; line-height: 1.6; }

/* ===== 文章管理 ===== */
/* 标题和「置顶」「分类」两个小标签挤在一行，省掉一整个「分类」列的位置 */
.art-title { color: var(--ink); font-weight: 600; }
.art-tag { margin-left: 8px; }

/* 文章编辑弹窗的表单行：标签固定宽度，输入框吃掉剩余空间 */
.af-row { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
.af-row .ed-label { width: 56px; }
.af-row > .el-input,
.af-row > .el-select { flex: 1; }

.af-opts { display: flex; align-items: center; gap: 28px; flex-wrap: wrap; }
.af-hint { color: var(--muted); font-size: 12px; }
.af-editor { margin-top: 8px; }
/* 编辑器这一块不参与 .af-row 的垂直居中对齐 */
.af-editor .md-editor { border: 1px solid rgba(150,190,240,.18); }

/* 弹窗底部：提示语靠左，按钮靠右 */
.af-foot-tip { color: var(--muted); font-size: 12px; margin-right: auto; }

/* 概览页的「最近文章」 */
.recent { list-style: none; margin: 0; padding: 0; }
.recent li {
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding: 12px 4px; border-bottom: 1px solid rgba(150,190,240,.10);
}
.recent li:last-child { border-bottom: none; }
.r-title { color: var(--ink); font-weight: 600; }
.r-meta { display: flex; align-items: center; gap: 12px; color: var(--muted); font-size: 12px; }

/* ===== Element Plus 暗色适配 ===== */
.panel, .toolbar, .user-edit-modal {
  --el-bg-color: transparent;
  --el-fill-color-blank: rgba(255,255,255,.06);
  --el-text-color-primary: var(--ink);
  --el-text-color-regular: var(--ink);
  --el-text-color-placeholder: var(--muted);
  --el-border-color: rgba(150,190,240,.18);
  --el-border-color-light: rgba(150,190,240,.14);
  --el-table-bg-color: transparent;
  --el-table-tr-bg-color: transparent;
  --el-table-header-bg-color: rgba(255,255,255,.05);
  --el-table-text-color: var(--ink);
  --el-table-header-text-color: var(--muted);
  --el-table-border-color: rgba(150,190,240,.14);
  --el-table-row-hover-bg-color: rgba(242,193,78,.10);
  --el-pagination-bg-color: rgba(255,255,255,.06);
  --el-pagination-text-color: var(--muted);
  --el-pagination-button-color: var(--muted);
  --el-pagination-button-bg-color: rgba(255,255,255,.06);
  --el-pagination-hover-color: var(--accent);
}
.panel :deep(.el-table) { background: transparent; font-size: 13px; }
.panel :deep(.el-table__inner-wrapper::before) { display: none; }
.panel :deep(.el-table th.el-table__cell),
.panel :deep(.el-table td.el-table__cell) { background: transparent; }

/* ===== 排序箭头：单箭头 + 旋转动画 =====
   Element Plus 默认是"上下两个小三角"叠着放，信息量小、还占 24px 宽度。
   这里换成【单个箭头】：升序朝上、降序朝下（原地转 180°），切换时带旋转动画。

   为什么纯 CSS 就能做到、不用改模板：
   EP 会把当前排序状态直接写成 th 上的 class ——
     未排序：th 上没有任何状态类
     升    序：th 带 .ascending
     降    序：th 带 .descending
   所以我们只要盯住这两个类，就能驱动箭头的样子。 */

/* ① 干掉 EP 默认的两个小三角 */
.panel :deep(.el-table th .sort-caret) { display: none; }

/* ② 把箭头容器收成 16x16 的居中盒子（原来 24px 宽，省下 8px 给列内容） */
.panel :deep(.el-table th .caret-wrapper) {
  width: 16px;
  height: 16px;
  padding: 0;
  margin-left: 3px;
  justify-content: center;
  background: none;   /* 它其实是个 <button>，清掉浏览器默认底色和边框 */
  border: none;
}

/* ③ 用 ::before 画出箭头本身 */
.panel :deep(.el-table th .caret-wrapper::before) {
  content: '';
  width: 13px;
  height: 13px;
  /* 颜色由 background-color 决定，形状由 mask 从 SVG 里"抠"出来 */
  background-color: rgba(190,210,240,.45);      /* 未排序：淡淡的灰蓝 */
  -webkit-mask: var(--sort-arrow) center / contain no-repeat;
  mask: var(--sort-arrow) center / contain no-repeat;
  /* 旋转动画：cubic-bezier 带一点点回弹，转起来更有"手感"，
     而不是生硬地一下转过去。
     注意这里【不加】 translateZ(0)：现代浏览器做 transform 过渡时会自动上合成层，
     手动强制提层反而会让 mask 出来的图形被栅格化、边缘发虚。 */
  transition: transform .34s cubic-bezier(.34,1.4,.64,1), background-color .25s;
  transform: rotate(0deg);
}

/* ④ 鼠标悬停时提亮，暗示"这里可以点"
   注意 :not(.ascending):not(.descending) —— 必须排掉正在生效的列。
   因为 CSS 里 :hover 这条规则的选择器类数比第⑤条多，
   优先级更高；不排除的话，鼠标停在已排序列上会把金色盖成灰色。 */
.panel :deep(.el-table th.is-sortable:hover:not(.ascending):not(.descending) .caret-wrapper::before) {
  background-color: rgba(190,210,240,.9);
}

/* ⑤ 当前正在生效的列，箭头点亮成主题金 */
.panel :deep(.el-table th.ascending .caret-wrapper::before),
.panel :deep(.el-table th.descending .caret-wrapper::before) {
  background-color: var(--accent);
}

/* ⑥ 降序 = 把升序的箭头原地旋转 180°（配合上面的 transition 就是动画） */
.panel :deep(.el-table th.descending .caret-wrapper::before) {
  transform: rotate(180deg);
}

/* ⑦ 尊重系统的"减少动态效果"设置：开了就取消旋转动画，直接切换 */
@media (prefers-reduced-motion: reduce) {
  .panel :deep(.el-table th .caret-wrapper::before) { transition: none; }
}

/* ===== 表格列宽 / 固定列修复 =====
   现象：右侧「操作」列的按钮和「创建时间」的文字叠在一起。
   根因有两层，缺一不可：
     ① 列宽合计 980px 超过了表格可用宽度 842px —— 表格横向溢出，
        而 fixed="right" 的「操作」列会被【钉在容器右边缘】，
        正好压在「创建时间」列上（实测重叠 138px）；
     ② 上面的暗色主题把表格背景设成了 transparent，固定列因此没有
        不透明底色，下层文字直接透上来 —— 看起来就是"字叠字"。
   所以两手都要抓：收窄列宽治本，给固定列补底色兜底。 */
.panel :deep(.el-table .el-button + .el-button) { margin-left: 8px; }
.panel :deep(.el-table .el-button--small) { padding: 5px 10px; }

/* 固定列兜底：只在【真的会溢出】的窄窗口下才给固定列加底色。
   为什么：桌面宽度下表格已经装得下，固定列根本没压住任何内容，
           这时再给它加底色，反而会凭空多出一个色块，和毛玻璃面板格格不入。
   何时需要：实测窗口 < 900px 时，容器会小于 798px 的列宽合计，表格开始横向滚动，
           「操作」列就会压住「创建时间」—— 这时必须挡住下层文字。
   注意【不能写死纯色】：面板是半透明叠在背景视频上的，底色每帧都在变，
           写死颜色必然对不上。用「半透明底 + 背景模糊」，它跟着背景一起变，永远吻合。 */
@media (max-width: 900px) {
  .panel :deep(.el-table-fixed-column--left),
  .panel :deep(.el-table-fixed-column--right) {
    background: rgba(18,30,56,.78) !important;
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
  }
}

/* 中等宽度：收窄侧边栏和内边距，把空间让给表格 */
@media (max-width: 1300px) {
  .admin { padding: 24px; }
  .side { width: 176px; }
}

/* 窄于 1180px：侧边栏改成横向顶栏，把整幅宽度让给表格。
   原来只在 820px 才折叠，导致 1000~1180px 这段窗口表格仍然装不下，
   「操作」列会重新压到「创建时间」上。 */
@media (max-width: 1180px) {
  .admin { flex-direction: column; padding: 20px; }
  .side { width: 100%; }
  .side-nav { flex-direction: row; flex-wrap: wrap; }
}

@media (max-width: 820px) {
  .admin { padding: 20px; }
  .stats { grid-template-columns: repeat(2,1fr); }
  .tb-item { width: 100%; }
}
</style>

<!-- 全局样式：teleport 到 body 的弹层（下拉框 / 确认框 / 弹窗） -->
<style>
.el-select-dropdown {
  background: #16264a !important;
  border: 1px solid rgba(150,190,240,.18) !important;
}
.el-select-dropdown__item { color: var(--muted) !important; }
.el-select-dropdown__item.is-hovering { background: rgba(242,193,78,.12) !important; color: var(--ink) !important; }
.el-select-dropdown__item.is-selected { color: var(--accent) !important; font-weight: 700; }
.el-popper__arrow::before { background: #16264a !important; border-color: rgba(150,190,240,.18) !important; }

.el-message-box {
  background: #16264a !important;
  border: 1px solid rgba(150,190,240,.18) !important;
}
.el-message-box__title, .el-message-box__content { color: var(--ink) !important; }

.el-dialog.user-edit-modal {
  background: #16264a !important;
  border: 1px solid rgba(150,190,240,.18) !important;
  border-radius: 18px;
}
.user-edit-modal .el-dialog__title { color: var(--ink) !important; }
.user-edit-modal .el-dialog__body { color: var(--ink) !important; padding-top: 8px; }

/* ==================== 文章编辑弹窗 ==================== */
.el-dialog.art-edit-modal {
  background: #16264a !important;
  border: 1px solid rgba(150,190,240,.18) !important;
  border-radius: 18px;
}
.art-edit-modal .el-dialog__title { color: var(--ink) !important; }
.art-edit-modal .el-dialog__body { color: var(--ink) !important; padding-top: 8px; }
/* 底部改成 flex，这样「正文用 Markdown 写」的提示能靠左、按钮靠右 */
.art-edit-modal .el-dialog__footer { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }

/* ==================== 弹窗高度自适应 ====================
   【为什么必须做这件事】
   原来的弹窗内容是写死高度的（表单 5 行 + 编辑器 460px ≈ 840px）。
   实测：视口 900px 时「保存」按钮在 827~859，勉强可见；
        视口 800px 时跑到 823~855 —— 已经在屏幕外了。
   笔记本不最大化窗口（768~800px 高）就会踩到，用户得滚动才能点保存，
   很容易以为"没保存按钮"。

   解法：让弹窗自己不超过视口，正文区内部滚动，
   标题栏和底部按钮固定不动 —— 保存按钮永远在视野里。 */
.el-dialog.art-edit-modal {
  display: flex;
  flex-direction: column;
  max-height: 92vh;
  /* EP 默认给弹窗底部留 50px 外边距，加上 4vh 的顶部间距会顶出视口，
     这里压到 2vh。注意要 !important，因为 EP 是用简写 margin 设的。 */
  margin-bottom: 2vh !important;
}
.art-edit-modal .el-dialog__body {
  flex: 1;
  min-height: 0;          /* flex 子项默认 min-height:auto，不归零的话内部滚不起来 */
  overflow-y: auto;
}
/* 编辑器高度跟着视口走：clamp(最小, 期望, 最大)
   期望值 = 视口高 - 400px（表单行 + 标题栏 + 底栏的固定开销）
   视口高 1200 → 560（撞上限）；1000 → 520；800 → 400；700 → 300；再矮保底 240

   【这个库自带 .md-editor { height: 500px } 默认值，必须覆盖掉，否则永远是 500px】

   注意这里【不能写 :deep()】！
   :deep() 是 Vue SFC 的编译期语法，只在 <style scoped> 里被处理。
   写在全局 <style> 块里，它会原样保留在 CSS 里 —— 浏览器不认识 :deep 这个伪类，
   整条规则会被静默丢弃，怎么调都不生效（这次就踩了这个坑：高度一直卡在 500px）。 */
.af-editor .md-editor {
  height: clamp(240px, calc(92vh - 400px), 560px);
}

/* ==================== md-editor-v3 暗色适配 ====================
   这个库自带一套暗色主题（.md-editor-dark），默认是偏中性的灰黑。
   这里把它的主题变量换成博客的暗金蓝，让它和面板融为一体。
   --md-* 是它公开的主题变量，改这些比去覆盖内部类名稳妥得多
   （内部类名会随版本变，而这两个变量是它的公开 API）。 */
.md-editor-dark {
  --md-bk-color: #101d38;                              /* 编辑区底色 */
  --md-bk-color-outstand: rgba(255,255,255,.05);       /* 工具栏底色 */
  --md-bk-hover-color: rgba(242,193,78,.12);           /* 悬停高亮 */
  --md-border-color: rgba(150,190,240,.18);
  --md-border-hover-color: rgba(242,193,78,.45);
  --md-border-active-color: #f2c14e;                   /* 当前激活的工具栏按钮 = 主题金 */
  --md-color: var(--ink);
  --md-hover-color: #ffffff;
  --md-scrollbar-bg-color: rgba(255,255,255,.04);
  --md-scrollbar-thumb-color: rgba(150,190,240,.28);
  border-radius: 14px;
  overflow: hidden;
}
</style>
