<template>
  <header class="top">
    <h1>评论管理</h1>
    <p>
      共 {{ cmTotal }} 条<span v-if="cmQuery.status !== null">（当前筛选：{{ statusLabel(cmQuery.status) }}）</span>
      · 待审核 {{ pendingCount }} 条
    </p>
  </header>

  <div class="toolbar glass">
    <el-select v-model="cmQuery.status" placeholder="全部状态" class="tb-item" @change="onCommentStatusChange">
      <el-option label="待审核" :value="COMMENT_STATUS.PENDING" />
      <el-option label="已通过" :value="COMMENT_STATUS.APPROVED" />
      <el-option label="已拒绝" :value="COMMENT_STATUS.REJECTED" />
      <!-- Element Plus options cannot use null; -1 means all statuses only in this UI. -->
      <el-option label="全部" :value="COMMENT_STATUS_ALL" />
    </el-select>
    <el-button type="primary" @click="searchComments">查询</el-button>
    <el-button @click="fetchComments">刷新</el-button>
    <span class="tb-hint">评论默认「待审核」，不点通过的话前台一直看不到它。</span>
  </div>

  <div class="panel glass">
    <!-- The table scrolls horizontally on narrow screens. -->
    <el-table v-loading="cmLoading" :data="comments" empty-text="这个状态下还没有评论">
      <el-table-column prop="nickname" label="昵称" width="110" />
      <el-table-column prop="content" label="内容" min-width="220" show-overflow-tooltip>
        <template #default="{ row }">
          <!-- Render user comments as text, never HTML. -->
          <!-- Long comments can be opened in the detail dialog. -->
          <span class="cm-cell">{{ row.content }}</span>
          <el-button
            v-if="isLongComment(row.content)"
            link type="primary" size="small" class="cm-detail"
            @click="openDetail(row)">详情</el-button>
        </template>
      </el-table-column>
      <el-table-column prop="articleTitle" label="文章" min-width="130" show-overflow-tooltip>
        <template #default="{ row }">
          <span :class="{ muted: !row.articleTitle }">{{ row.articleTitle || '（文章已删除）' }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="status" label="状态" width="92">
        <template #default="{ row }">
          <el-tag :type="statusTagType(row.status)" size="small" effect="plain">
            {{ statusLabel(row.status) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="createTime" label="时间" width="140">
        <template #default="{ row }">{{ formatDateTime(row.createTime) }}</template>
      </el-table-column>
      <el-table-column prop="email" label="邮箱" min-width="150" show-overflow-tooltip>
        <template #default="{ row }">{{ row.email || '—' }}</template>
      </el-table-column>
      <el-table-column prop="ip" label="IP" width="120">
        <template #default="{ row }">{{ row.ip || '—' }}</template>
      </el-table-column>
      <el-table-column label="操作" width="200">
        <template #default="{ row }">
          <!-- Moderation is reversible; deletion requires confirmation. -->
          <div class="cm-acts">
            <el-button
              size="small" type="success"
              :disabled="row.status === COMMENT_STATUS.APPROVED"
              @click="moderateComment(row, COMMENT_STATUS.APPROVED)">通过</el-button>
            <el-button
              size="small" type="warning"
              :disabled="row.status === COMMENT_STATUS.REJECTED"
              @click="moderateComment(row, COMMENT_STATUS.REJECTED)">拒绝</el-button>
            <el-dropdown trigger="click">
              <el-button size="small" class="cm-more">更多<span class="caret">▾</span></el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item class="cm-danger" @click="removeComment(row)">删除评论</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
        </template>
      </el-table-column>
    </el-table>

    <!-- Show the full comment and context without interpreting user text as HTML. -->
    <el-dialog v-model="detailVisible" title="评论详情" width="560px" class="cm-detail-modal">
      <div v-if="detailRow" class="dd-body">
        <div class="dd-meta">
          <span><b>昵称</b>{{ detailRow.nickname }}</span>
          <span><b>状态</b>{{ statusLabel(detailRow.status) }}</span>
          <span><b>时间</b>{{ formatDateTime(detailRow.createTime) }}</span>
          <span><b>邮箱</b>{{ detailRow.email || '—' }}</span>
          <span><b>IP</b>{{ detailRow.ip || '—' }}</span>
          <span><b>文章</b>{{ detailRow.articleTitle || '（文章已删除）' }}</span>
        </div>
        <!-- Preserve line breaks in the comment body. -->
        <div class="dd-content">{{ detailRow.content }}</div>
      </div>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
        <el-button
          v-if="detailRow && detailRow.status !== commentStatus.APPROVED"
          type="success"
          @click="moderateFromDetail(commentStatus.APPROVED)">通过</el-button>
        <el-button
          v-if="detailRow && detailRow.status !== commentStatus.REJECTED"
          type="warning"
          @click="moderateFromDetail(commentStatus.REJECTED)">拒绝</el-button>
      </template>
    </el-dialog>

    <div class="pager">
      <el-pagination
        background
        layout="total, sizes, prev, pager, next"
        :total="cmTotal"
        :current-page="cmQuery.page"
        :page-size="cmQuery.size"
        :page-sizes="[5, 10, 20, 50]"
        @current-change="onCommentPageChange"
        @size-change="onCommentSizeChange" />
    </div>
  </div>
</template>

<script setup>
import { ElMessage, ElMessageBox } from 'element-plus'

// Share the pending count with the admin sidebar.
const pendingCount = defineModel('pendingCount', { type: Number, default: 0 })

const emit = defineEmits(['refresh-pending'])

const { request } = useApi()

const commentStatus = COMMENT_STATUS

// Only longer comments need a detail dialog.
const DETAIL_THRESHOLD = 40

const isLongComment = (text) => typeof text === 'string' && text.length > DETAIL_THRESHOLD

// A null detail row also closes the dialog.
const detailRow = ref(null)
const detailVisible = computed({
  get: () => detailRow.value !== null,
  set: (visible) => { if (!visible) detailRow.value = null },
})
const openDetail = (row) => { detailRow.value = row }

// The all-status sentinel is never sent to the backend.
const COMMENT_STATUS_ALL = -1

const comments = ref([])
const cmTotal = ref(0)
const cmLoading = ref(false)
let latestCommentsRequest = 0

const cmQuery = reactive({
  page: 1, size: 10,
  status: commentStatus.PENDING,
})

const statusLabel = (status) => {
  if (status === commentStatus.PENDING) return '待审核'
  if (status === commentStatus.APPROVED) return '已通过'
  if (status === commentStatus.REJECTED) return '已拒绝'
  return '全部'
}

const statusTagType = (status) => {
  if (status === commentStatus.PENDING) return 'warning'
  if (status === commentStatus.APPROVED) return 'success'
  if (status === commentStatus.REJECTED) return 'danger'
  return 'info'
}

// Omit status for all comments; -1 exists only in the UI.
const fetchComments = async () => {
  const requestId = ++latestCommentsRequest
  const status = cmQuery.status
  cmLoading.value = true
  const res = await request('/admin/comment/page', {
    params: {
      page: cmQuery.page,
      size: cmQuery.size,
      status: status === COMMENT_STATUS_ALL ? undefined : status,
    },
  })
  if (requestId !== latestCommentsRequest) return false
  cmLoading.value = false
  // 结构兜底：接口挂了 / 结构变了时列表是空的，但页面照常（不会在读 records 时抛异常）
  comments.value = res.ok && Array.isArray(res.data?.records) ? res.data.records : []
  cmTotal.value = res.ok ? (Number(res.data?.total) || 0) : 0

  // 【省一次请求】当前视图本来就是"待审核"时，列表的 total 就是待审核总数，
  // 不必再为角标单独查一次（后台每多一个请求就多一次等待）
  if (status === commentStatus.PENDING) pendingCount.value = cmTotal.value
  return true
}

// Other filters need a separate pending-count refresh.
const refreshComments = async () => {
  const status = cmQuery.status
  const applied = await fetchComments()
  if (applied && status !== commentStatus.PENDING) emit('refresh-pending')
}

const searchComments = () => { cmQuery.page = 1; refreshComments() }
const onCommentStatusChange = () => { cmQuery.page = 1; refreshComments() }
const onCommentPageChange = (p) => { cmQuery.page = p; refreshComments() }
const onCommentSizeChange = (s) => { cmQuery.size = s; cmQuery.page = 1; refreshComments() }

// Moderation is reversible; the backend accepts approved or rejected.
const moderateComment = async (row, status) => {
  const res = await request('/admin/comment/' + row.id + '/status', {
    method: 'PUT',
    params: { status },
  })
  if (res.ok) {
    ElMessage.success(status === commentStatus.APPROVED ? '已通过' : '已拒绝')
    refreshComments()
    // 返回"这件事了结了"，给详情弹窗用（见 moderateFromDetail）
    return true
  }
  // 404 = 这条评论已经被别人删掉了（比如另一个管理员，或另一个标签页）
  if (res.code === 404) {
    ElMessage.warning('这条评论已经不在了，列表已刷新')
    refreshComments()
    // 评论已经不存在了，同样算"了结"：留着详情弹窗只会让用户对一条消失的评论继续点
    return true
  }
  // 其它失败（限流 / 500 / 网络）：没有刷新列表，让详情弹窗留在原地好让用户重试
  return false
}

// Close detail only after success or when the comment no longer exists.
const moderateFromDetail = async (status) => {
  const row = detailRow.value
  if (!row) return
  const settled = await moderateComment(row, status)
  if (settled) detailRow.value = null
}

// Deletion has no recovery action in the UI, so confirm it.
const removeComment = async (row) => {
  try {
    await ElMessageBox.confirm(
      `确定要删除「${row.nickname}」的这条评论吗？删除后前台与后台都不再显示，界面上无法恢复。`,
      '危险操作',
      { type: 'error', confirmButtonText: '确认删除', cancelButtonText: '取消' },
    )
  } catch { return }

  const res = await request('/admin/comment/' + row.id, { method: 'DELETE' })
  if (res.ok) {
    ElMessage.success('已删除')
    refreshComments()
    return
  }
  // 自愈：别人已经删过了，提示一句并把列表刷新（那条评论自然就没了）
  if (res.code === 404) {
    ElMessage.warning('这条评论已经不在了，列表已刷新')
    refreshComments()
  }
}

onMounted(refreshComments)
</script>

<style scoped>
.cm-cell { color: var(--ink); }
.muted { color: var(--muted); }

/* Keep action buttons on one line. */
.cm-acts { display: flex; align-items: center; gap: 8px; flex-wrap: nowrap; }

.cm-more .caret { margin-left: 2px; font-size: 10px; opacity: .75; }

/* Scoped styles still apply to teleported dropdown content. */
.cm-danger { color: var(--el-color-danger); }

.cm-detail { margin-left: 6px; vertical-align: baseline; }

/* Dialog content can stay scoped; the teleported container is styled globally. */
.dd-body { display: flex; flex-direction: column; gap: 12px; }
.dd-meta {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 6px 16px; font-size: 13px; color: var(--muted);
}
.dd-meta b { display: inline-block; min-width: 38px; margin-right: 6px; color: var(--ink); font-weight: 600; }
/* Preserve comment line breaks and constrain long content. */
.dd-content {
  white-space: pre-wrap; word-break: break-word;
  max-height: 46vh; overflow-y: auto;
  padding: 12px 14px; border-radius: 10px;
  background: rgba(0,0,0,.18); border: 1px solid var(--line);
  color: var(--ink); font-size: 14px; line-height: 1.7;
}
</style>
