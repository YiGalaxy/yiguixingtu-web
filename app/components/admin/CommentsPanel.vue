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
         固定的五列（昵称 110 / 状态 92 / 时间 140 / IP 120 / 操作 200）合计 662px。
         窄窗口下表格会横向滚动，右侧 fixed 的「操作」列由 ≤900px 那条媒体查询
         补上半透明底，不会出现"字叠字"（用户表那次踩过的坑）。
         ⚠️ 操作列从 176 加到 200 是 2026-09-11 修"按钮堆"的一部分：
         三个小按钮并排放不下 176px，第三个会被挤到第二行（详见下面那段注释）。 -->
    <el-table v-loading="cmLoading" :data="comments" empty-text="这个状态下还没有评论">
      <el-table-column prop="nickname" label="昵称" width="110" />
      <el-table-column prop="content" label="内容" min-width="220" show-overflow-tooltip>
        <template #default="{ row }">
          <!-- 【安全关键】{{ }} 插值，不是 v-html：评论内容虽然已被后端转义过，
               但后台同样没有理由把它当 HTML 解析 —— 万无一失的写法只有一种 -->
          <!-- 【超长评论为什么还要给一个「详情」】（2026-09-11 按用户反馈加）
               这一列只有 220px，长评论被 CSS 截断成一行，鼠标悬停才有一个 tooltip。
               而管理员的真实工作是"判断这条评论该不该通过"，长评论恰恰最需要看全 ——
               靠悬停读一段一屏长的文字非常难受。所以超过阈值就给一个弹窗。 -->
          <span class="cm-cell">{{ row.content }}</span>
          <el-button
            v-if="isLongComment(row.content)"
            link type="primary" size="small" class="cm-detail"
            @click="openDetail(row)">详情</el-button>
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
      <el-table-column label="操作" width="200" fixed="right">
        <template #default="{ row }">
          <!-- 【为什么「通过 / 拒绝」不做二次确认，只有「删除」做】
               审核是可逆的：拒绝掉的评论在「已拒绝」里还在，随时能再通过。
               给一个可逆的操作加确认框，只会让"处理一批待审核"变成一道道弹窗。
               「删除」不可逆（后端是逻辑删除，删除后前台后台都不再显示、
               界面上也没有恢复入口），所以它要确认。 -->
          <!-- 【为什么把「删除」收进「更多」菜单里】（2026-09-11 修用户报的"按钮堆"）
               原来这一列宽 176px，里面并排放三个小按钮：
               每个小按钮的宽度是「2 个汉字 + 左右各 11px 内边距 + 边框」≈ 48px，
               加上 Element Plus 给相邻按钮的 12px 外边距与单元格左右各 12px 内边距，
               合计约 186px —— **比列宽还宽**，于是第三个按钮被挤到第二行，
               看起来就是"按钮堆在一起"。
               现在：两个审核按钮留在外面（它们是最常用的动作，点一下就完成），
               不可逆的「删除」收进「更多」里 —— 既解决了宽度，也让"危险动作"
               多一道门槛（菜单 + 二次确认）。
               .cm-acts 用 flex + nowrap 再兜一道：无论文字怎么变，都不会再折行。 -->
          <div class="cm-acts">
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

    <!-- 评论详情：长评论看全貌的地方（短评论不提供入口，见 isLongComment 的说明）。
         【为什么内容用 {{ }} 而不是 v-html】和表格里那条理由完全一样 ——
         评论内容是用户输入，后台没有任何理由把它当 HTML 解析。
         【为什么带上邮箱 / IP / 文章这些元信息】判断"这条是不是同一个人在刷评论"
         靠的正是它们，而表格里那几列在窄屏下会被横向滚动藏起来；
         把上下文和全文放在一起，管理员不用来回滚。 -->
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
        <!-- pre-wrap：评论里的换行是作者真正的排版意图，压成一行会读不懂 -->
        <div class="dd-content">{{ detailRow.content }}</div>
      </div>
      <template #footer>
        <!-- 【为什么详情里也放「通过 / 拒绝」】看完全文接着就要做决定 ——
             让用户关掉弹窗、再去表格里找那一行点按钮，是白跑一趟。
             这两个动作和表格里那两个按钮走的是**同一个方法**（moderateComment），
             所以状态参数、刷新逻辑、角标更新全都一致，不存在两套行为。
             ⚠️ 这里**没有**"退回待审核"：后端只认 1(通过) / 2(拒绝)，
             发 status=0 会被拒（`状态只能是 1(通过) 或 2(拒绝)`）——
             不给一个点了必然报错的按钮。 -->
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
 * 超过这个长度才给「详情」入口。
 *
 * 【为什么按长度决定给不给】短评论（"联调用的一条评论"）在表格里一眼就看得完，
 * 每行都挂一个「详情」按钮只是噪音，还会把"内容"这一列挤窄。
 * 【40 是怎么定的】表格里那一列的可视宽度大约能放下 20 个汉字（宽屏更多），
 * 40 个字是"两行以上、悬停 tooltip 也开始不好读"的量级 —— 到这个长度，
 * 悬停看 tooltip 已经不如点开一个正经的弹窗舒服了。
 * 【代价说清楚】这是个**显示层**的阈值，不影响任何数据：短评论的内容在 DOM 里**依然是完整的**，
 * 只是不提供"详情"入口 —— 所以即使以后有人把它调大，也不会"看不到内容"。
 */
const DETAIL_THRESHOLD = 40

/** 该不该给这一条「详情」入口（content 可能为 null/非字符串，先兜一道） */
const isLongComment = (text) => typeof text === 'string' && text.length > DETAIL_THRESHOLD

/**
 * 详情弹窗里"正在看的那一条"。
 * 【为什么用一个 row 对象 + computed 的 v-model，而不是一个 boolean + 一个 row】
 *   两份状态一定会不同步：关掉弹窗忘了清 row，下次打开的就是**上一条**的内容 ——
 *   而那种错法看起来"弹窗是好的"，只是内容不对，非常难发现。
 *   这里用"row 为 null 就是关着"这一个事实派生可见性，从根上不可能不同步。
 */
const detailRow = ref(null)
const detailVisible = computed({
  get: () => detailRow.value !== null,
  set: (visible) => { if (!visible) detailRow.value = null },
})
const openDetail = (row) => { detailRow.value = row }

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

/**
 * 详情弹窗里的「通过 / 拒绝」。
 *
 * 【为什么还要过一手，而不是在弹窗里直接调 moderateComment】
 *   审核逻辑本身不写第二套（状态参数、刷新、角标更新全都复用同一个方法），
 *   这里只解决"弹窗什么时候关"这一件事：
 *   ① **只有确实处理成功了才关**。失败（比如被限流、后端 500）时弹窗要留着 ——
 *      用户正在读的那段长评论还在眼前，可以直接再点一次；关掉的话他得重新找到那一行、
 *      再点一次「详情」，白跑一趟
 *   ② 关掉是因为 `detailRow` 是一条**快照**：处理完还留着它，用户对着一条已处理的评论
 *      继续点，只会撞上没意义的报错
 *   `moderateComment` 因此返回一个布尔值表示"这次操作已经了结"（成功，或 404 这种自愈场景），
 *   而不是把"要不要关弹窗"的判断散在两处。
 */
const moderateFromDetail = async (status) => {
  const row = detailRow.value
  if (!row) return
  const settled = await moderateComment(row, status)
  if (settled) detailRow.value = null
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

/* 【操作列为什么用 flex + nowrap】按钮的宽度是跟着文字走的（中文两个字 + 内边距），
   靠"把列宽调大"只是把问题往后推：哪天文案变成三个字又会折行。
   flex-wrap: nowrap 是**结构性**的保证：这一行永远不折，列宽不够时由表格横向滚，
   而不是把第三个按钮挤到第二行（用户报的就是那个样子）。 */
.cm-acts { display: flex; align-items: center; gap: 8px; flex-wrap: nowrap; }

/* 「更多」的箭头：与导航里那个 .caret 同样的大小观感，这里单独写一份小尺寸，
   免得依赖别的文件的样式（全局样式改了会连带影响这里） */
.cm-more .caret { margin-left: 2px; font-size: 10px; opacity: .75; }

/* 「删除评论」这一项用危险色：删除是不可逆的，和上面两个审核按钮在观感上区分开，
   让人在点之前就意识到"这个跟前两个不一样"。
   【为什么 scoped 样式对 teleport 出去的下拉菜单也有效】Vue 的 scope 属性是**渲染时打在元素上**的，
   跟这个元素最后挂在哪个父节点（这里是 body）无关 —— 所以菜单虽然被 el-dropdown
   teleport 到了 body，这条规则照样命中。
   ⚠️ 这条类名是必须定义的：`test/styleContract.spec.ts` 会检查"模板里用到的静态类都有定义"，
   我第一版就是只写了 class 没写规则，被它当场拦下来了。 */
.cm-danger { color: var(--el-color-danger); }

/* 「详情」入口：跟在被截断的内容后面，做成链接式按钮（不要第二个实心按钮，
   否则又回到"这一列按钮太挤"的老问题上） */
.cm-detail { margin-left: 6px; vertical-align: baseline; }

/* ===== 评论详情弹窗的内容 =====
   弹窗容器本身的样式（背景、圆角）写在 admin.vue 的全局块里（见那里的 .cm-detail-modal），
   因为 el-dialog 会被 teleport 到 body；
   而下面这几条是**弹窗内容**的样式，这些元素是由本组件渲染的（scope 属性照样打在它们身上），
   所以写在 scoped 块里是有效的。 */
.dd-body { display: flex; flex-direction: column; gap: 12px; }
/* 元信息两列排：窄屏下自动变成一列（这里用 auto-fit，不用写媒体查询） */
.dd-meta {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 6px 16px; font-size: 13px; color: var(--muted);
}
.dd-meta b { display: inline-block; min-width: 38px; margin-right: 6px; color: var(--ink); font-weight: 600; }
/* 正文：pre-wrap 保住作者原本的换行（评论里的换行是真实的排版意图，
   压成一行会读不懂）；max-height + 滚动是为了超长评论不把弹窗顶出屏幕 */
.dd-content {
  white-space: pre-wrap; word-break: break-word;
  max-height: 46vh; overflow-y: auto;
  padding: 12px 14px; border-radius: 10px;
  background: rgba(0,0,0,.18); border: 1px solid var(--line);
  color: var(--ink); font-size: 14px; line-height: 1.7;
}
</style>
