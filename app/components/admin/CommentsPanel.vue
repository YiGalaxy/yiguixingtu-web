<template>
  <!--
    评论管理（审核 / 删除）。
    【为什么这一页几乎是自包含的】它有自己的分页与状态筛选、自己的计数，
    和别的面板没有交集。唯一"露出去"的是**待审核数量**：左侧菜单上的角标要显示它，
    而菜单在父页面里，所以它用 v-model:pending-count 双向绑定。
    【这个页面为什么必须存在】评论默认是【待审核】的，不点通过前台就一直看不到它。
    也就是说：没有这个页面，别人写的评论永远只有作者自己看得见 ——
    前台那句"等待审核"就成了一句空话。
  -->
  <header class="top">
    <h1>评论管理</h1>
    <p>
      共 {{ cmTotal }} 条<span v-if="cmQuery.status !== null">（当前筛选：{{ statusLabel(cmQuery.status) }}）</span>
      · 待审核 {{ pendingCount }} 条
    </p>
  </header>

  <div class="toolbar glass">
    <!-- 默认就是「待审核」：这个页面存在的主要目的就是把待审核的处理掉，
         而"全部"会让待办淹没在已通过的评论里 -->
    <el-select v-model="cmQuery.status" placeholder="全部状态" class="tb-item" @change="onCommentStatusChange">
      <el-option label="待审核" :value="COMMENT_STATUS.PENDING" />
      <el-option label="已通过" :value="COMMENT_STATUS.APPROVED" />
      <el-option label="已拒绝" :value="COMMENT_STATUS.REJECTED" />
      <!-- 【为什么不写 :value="null"（更自然的写法）】
           Element Plus 的 el-option 声明的 value 类型不含 Null，
           传 null 会在**每次渲染**时往控制台打一条
           "Invalid prop: type check failed for prop value"。
           它不影响功能，所以测试照样全绿 —— 危害恰恰在这里：
           控制台与 CI 日志被刷屏，真正的报错混在里面就被忽略了
           （和已经修掉的 el-link 废弃警告是同一类问题）。
           所以「全部」用一个界面专用的哨兵值 -1（后端的状态只有 0/1/2），
           发请求时再把它翻成"不发这个参数"。 -->
      <el-option label="全部" :value="COMMENT_STATUS_ALL" />
    </el-select>
    <el-button type="primary" @click="searchComments">查询</el-button>
    <el-button @click="fetchComments">刷新</el-button>
    <span class="tb-hint">评论默认「待审核」，不点通过的话前台一直看不到它。</span>
  </div>

  <div class="panel glass">
    <!-- 列宽说明：可伸缩的三列（内容 / 文章标题 / 邮箱）都开了
         show-overflow-tooltip，长文本不会把行撑高、也不会把别的列挤出去；
         固定的五列（昵称 / 状态 / 时间 / IP / 操作）合计 638px。
         窄窗口下表格会横向滚动，右侧 fixed 的「操作」列由 ≤900px 那条媒体查询
         补上半透明底，不会出现"字叠字"（用户表那次踩过的坑）。 -->
    <el-table v-loading="cmLoading" :data="comments" empty-text="这个状态下还没有评论">
      <el-table-column prop="nickname" label="昵称" width="110" />
      <el-table-column prop="content" label="内容" min-width="220" show-overflow-tooltip>
        <template #default="{ row }">
          <!-- 【安全关键】{{ }} 插值，不是 v-html：评论内容虽然已被后端转义过，
               但后台同样没有理由把它当 HTML 解析 —— 万无一失的写法只有一种 -->
          <span class="cm-cell">{{ row.content }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="articleTitle" label="文章" min-width="130" show-overflow-tooltip>
        <template #default="{ row }">
          <!-- 文章可能已经被删了（评论还在），这时后端给的 title 是 null -->
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
      <!-- 邮箱与 IP 只有后台接口才返回（前台那份 VO 里根本没有这两个字段）：
           它们是给管理员判断"是不是同一个人在刷评论"用的 -->
      <el-table-column prop="email" label="邮箱" min-width="150" show-overflow-tooltip>
        <template #default="{ row }">{{ row.email || '—' }}</template>
      </el-table-column>
      <el-table-column prop="ip" label="IP" width="120">
        <template #default="{ row }">{{ row.ip || '—' }}</template>
      </el-table-column>
      <el-table-column label="操作" width="176" fixed="right">
        <template #default="{ row }">
          <!-- 【为什么「通过 / 拒绝」不做二次确认，只有「删除」做】
               审核是可逆的：拒绝掉的评论在「已拒绝」里还在，随时能再通过。
               给一个可逆的操作加确认框，只会让"处理一批待审核"变成一道道弹窗。
               「删除」不可逆（后端是逻辑删除，删除后前台后台都不再显示、
               界面上也没有恢复入口），所以它要确认。 -->
          <!-- 已经是当前状态的那个按钮禁用掉：点它不会发生任何事，
               留着可点反而让人以为"点了没生效" -->
          <el-button
            size="small" type="success"
            :disabled="row.status === COMMENT_STATUS.APPROVED"
            @click="moderateComment(row, COMMENT_STATUS.APPROVED)">通过</el-button>
          <el-button
            size="small" type="warning"
            :disabled="row.status === COMMENT_STATUS.REJECTED"
            @click="moderateComment(row, COMMENT_STATUS.REJECTED)">拒绝</el-button>
          <el-button size="small" type="danger" @click="removeComment(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

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

/**
 * 【待审核数量为什么要双向绑定】它有两个使用者：
 *   · 左侧菜单上的角标（在父页面 admin.vue 里）
 *   · 这一页标题里那句"· 待审核 N 条"
 * 状态提升到父页面（那里进后台时就先查了一次，所以一进后台菜单上就有数字），
 * 这里既能读也能写：当前筛选本来就是「待审核」时，列表的 total 就是待审核总数，
 * 直接写回去可以省掉一次专门的查询。
 */
const pendingCount = defineModel('pendingCount', { type: Number, default: 0 })

/**
 * 【为什么把"待审核有多少条"交给父页面去查】那份数字与菜单角标是同一个数据源，
 * 父页面进后台时就查过一次（`fetchPendingCommentCount`）。这里再写一份一样的请求
 * 就变成两个地方各自维护"待办数"，迟早有一处是旧的 ——
 * 表现是"菜单上的角标和这一页头顶的数字对不上"。
 */
const emit = defineEmits(['refresh-pending'])

const { request } = useApi()

/**
 * 状态常量直接用 app/utils/comment.ts 里那一份，不在后台各写一套 0/1/2：
 * 两处各写一遍、改一处漏一处，就会出现"前台把 0 叫待审核、后台把 0 叫已通过"
 * 这种最难发现的错位。
 */
const commentStatus = COMMENT_STATUS

/**
 * 「全部」的哨兵值：**只存在于界面上**，永远不会发给后端。
 * 后端的状态只有 0（待审核）/ 1（已通过）/ 2（已拒绝）三个值，
 * 而这里的"全部"其实是"不按状态过滤"。
 * 【为什么不用 null 表示】见模板里那段注释（el-option 的 value 类型不含 Null）。
 */
const COMMENT_STATUS_ALL = -1

const comments = ref([])
const cmTotal = ref(0)
const cmLoading = ref(false)

const cmQuery = reactive({
  page: 1, size: 10,
  status: commentStatus.PENDING,
})

/** 状态 → 中文（后台这份文案与前台"待审核"的说法保持一致） */
const statusLabel = (status) => {
  if (status === commentStatus.PENDING) return '待审核'
  if (status === commentStatus.APPROVED) return '已通过'
  if (status === commentStatus.REJECTED) return '已拒绝'
  return '全部'
}

/** 状态 → el-tag 的类型：待审核是警示色（要看一眼），已通过是成功色 */
const statusTagType = (status) => {
  if (status === commentStatus.PENDING) return 'warning'
  if (status === commentStatus.APPROVED) return 'success'
  if (status === commentStatus.REJECTED) return 'danger'
  return 'info'
}

/**
 * 拉评论分页。
 * 【参数怎么拼】选「全部」时【不发 status 这个参数】——
 *   后端用的是 `eq(query.getStatus() != null, ...)`，不发就是不按状态过滤；
 *   发一个空串或 -1 反而会让它去比较一个不存在的状态值（结果是一条都查不到）。
 */
const fetchComments = async () => {
  cmLoading.value = true
  const res = await request('/admin/comment/page', {
    params: {
      page: cmQuery.page,
      size: cmQuery.size,
      status: cmQuery.status === COMMENT_STATUS_ALL ? undefined : cmQuery.status,
    },
  })
  cmLoading.value = false
  // 结构兜底：接口挂了 / 结构变了时列表是空的，但页面照常（不会在读 records 时抛异常）
  comments.value = res.ok && Array.isArray(res.data?.records) ? res.data.records : []
  cmTotal.value = res.ok ? (Number(res.data?.total) || 0) : 0

  // 【省一次请求】当前视图本来就是"待审核"时，列表的 total 就是待审核总数，
  // 不必再为角标单独查一次（后台每多一个请求就多一次等待）
  if (cmQuery.status === commentStatus.PENDING) pendingCount.value = cmTotal.value
}

/**
 * 审核 / 删除之后的统一刷新。
 * 【为什么角标要单独考虑】列表的 total 只代表"当前这个筛选下的条数"：
 *   在「已通过」里点一下「拒绝」，列表 total 不变，但待审核的数量 +1 ——
 *   不刷新角标的话，站长会看到菜单上的数字和实际待办对不上。
 */
const refreshComments = async () => {
  await fetchComments()
  if (cmQuery.status !== commentStatus.PENDING) emit('refresh-pending')
}

const searchComments = () => { cmQuery.page = 1; refreshComments() }
const onCommentStatusChange = () => { cmQuery.page = 1; refreshComments() }
const onCommentPageChange = (p) => { cmQuery.page = p; refreshComments() }
const onCommentSizeChange = (s) => { cmQuery.size = s; cmQuery.page = 1; refreshComments() }

/**
 * 通过 / 拒绝。
 *
 * 【为什么不做二次确认】审核是可逆的：拒绝掉的评论还在「已拒绝」里，随时能再通过。
 *   给一个可逆的操作加确认框，只会让"处理一批待审核"变成一道道弹窗。
 *   （不可逆的「删除」仍然要确认 —— 见 removeComment。）
 *
 * 【status 只能是 1 或 2】后端对 0 或 3 直接返回 400：
 *   审核只有"通过"与"拒绝"两个结果，"退回待审核"不是一个审核动作。
 */
const moderateComment = async (row, status) => {
  const res = await request('/admin/comment/' + row.id + '/status', {
    method: 'PUT',
    params: { status },
  })
  if (res.ok) {
    ElMessage.success(status === commentStatus.APPROVED ? '已通过' : '已拒绝')
    refreshComments()
    return
  }
  // 404 = 这条评论已经被别人删掉了（比如另一个管理员，或另一个标签页）
  if (res.code === 404) {
    ElMessage.warning('这条评论已经不在了，列表已刷新')
    refreshComments()
  }
}

/**
 * 删除评论（后端是逻辑删除：前台后台都不再显示，但行还在库里）。
 * 【为什么它要二次确认】它是一个"界面上没有恢复入口"的操作：
 *   误点一下，这条评论就从所有列表里消失了，站长只能进数据库改 deleted 才能救回来。
 *   确认文案里把"前台后台都不再显示"写出来 —— 只说"删除评论"的话，
 *   管理员不一定知道前台也看不到了。
 */
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

/**
 * 【为什么这一页的首次加载在这里，而不是父页面的 watch(cur) 里】
 * 父页面用 `v-if / v-else-if` 切换菜单，所以"切到评论管理"= 这个组件被挂载。
 * 挂载时刷新一次，和原来"watch 到 cur 变成 comments 就刷新一次"是同一件事，
 * 而且不用再让父页面知道"这一页靠哪个接口加载"。
 * 这里的请求还会顺手把待审核数写回父页面（见 fetchComments 里那一行），
 * 所以菜单角标也跟着更新。
 */
onMounted(refreshComments)
</script>

<style scoped>
/* 评论内容在表格里只占一列：长评论靠列的 show-overflow-tooltip 悬停查看，
   这里只保证文字颜色与主题一致、不会因为换行把行高撑起来 */
.cm-cell { color: var(--ink); }
.muted { color: var(--muted); }
</style>
