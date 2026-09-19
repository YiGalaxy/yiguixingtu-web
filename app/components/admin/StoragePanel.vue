<template>
  <!--
    存储管理：磁盘上有什么、谁在用它、删掉没人用的。
    【为什么这个页面存在】上传改成内容寻址之后，"同一份内容只存一份"是自动的，
    但**孤儿文件**不是：上传了却没保存进文章、或者某篇文章删掉后留下的图，
    都会一直躺在磁盘上占着空间 —— 而总量护栏（5GB）满了之后，
    站长收到的提示是"上传空间不足"，看不出原因是一堆没人引用的文件。

    【它和「设置」的关系】那一页管站点文案与开关，这一页管磁盘上的实物。
    分开是因为它们的操作频率与风险完全不同：改个文案随时可以改，
    删文件是不可逆的。
  -->
  <header class="top">
    <h1>存储管理</h1>
    <p>共 {{ files.length }} 个文件，其中 {{ orphanCount }} 个没有任何地方引用</p>
  </header>

  <div class="toolbar glass">
    <el-button @click="load">刷新</el-button>
    <!-- 【为什么"清理"要做成独立按钮】它是这一页唯一会批量删东西的动作，
         而它删的正是"没人用"的那些 —— 这类动作值得有一个明确的入口与二次确认，
         而不是让站长自己在表格里一个个勾。没有任何孤儿时按钮禁用，
         省得他点一下、确认一次、然后什么也没发生。 -->
    <el-button
      type="danger" :disabled="!orphanCount || loading"
      @click="cleanOrphans">
      清理无人引用的文件（{{ orphanCount }}）
    </el-button>
    <span class="tb-hint">
      「无人引用」= 全站没有任何一处的正文、封面、附件、头像等地方写着这个地址。
    </span>
  </div>

  <!-- 占用概览：与上传时那道总容量护栏读的是同一个数（后端 usedBytes） -->
  <div class="panel glass sp-usage">
    <div class="sp-usage-head">
      <span class="sp-usage-label">已用空间</span>
      <span class="sp-usage-num">{{ formatFileSize(usedBytes) }} / {{ formatFileSize(maxTotalBytes) }}</span>
    </div>
    <el-progress
      :percentage="usedPercent" :stroke-width="10"
      :status="usedPercent >= 90 ? 'exception' : undefined" :show-text="false" />
  </div>

  <div class="toolbar glass">
    <el-input
      v-model="keyword" class="sp-search" clearable
      placeholder="搜文件名或路径（比如 cover、.png）" />
    <el-select v-model="category" class="sp-filter">
      <el-option label="全部类型" value="" />
      <el-option label="图片（cover）" value="cover" />
      <el-option label="音频（music）" value="music" />
      <el-option label="附件（attachment）" value="attachment" />
    </el-select>
    <el-select v-model="refFilter" class="sp-filter">
      <el-option label="全部文件" value="" />
      <el-option label="有引用的" value="referenced" />
      <el-option label="无人引用的" value="orphan" />
    </el-select>
  </div>

  <div class="panel glass">
    <el-table
      v-loading="loading" :data="visibleFiles"
      empty-text="没有符合条件的文件">
      <!-- 预览：图片直接缩略图（点开看原图）；音频与附件给一个类型标签，
           它们本来就没有可视的缩略图，硬做一个图标反而占地方 -->
      <el-table-column label="预览" width="96">
        <template #default="{ row }">
          <a :href="row.url" target="_blank" rel="noopener" class="sp-thumb-link">
            <img v-if="row.category === 'cover'" :src="row.url" class="sp-thumb" alt="预览" >
            <span v-else class="sp-thumb-text">{{ row.category === 'music' ? '♪' : '📄' }}</span>
          </a>
        </template>
      </el-table-column>
      <!-- 文件名是内容哈希，本身没什么可读性，但它是这个文件在磁盘上的唯一标识；
           完整路径放在 title 里（列宽装不下） -->
      <el-table-column label="文件" min-width="220" show-overflow-tooltip>
        <template #default="{ row }">
          <div class="sp-name">{{ row.name }}</div>
          <div class="sp-key">{{ row.key }}</div>
        </template>
      </el-table-column>
      <el-table-column label="类型" width="110">
        <template #default="{ row }">
          <el-tag size="small" effect="plain">{{ categoryLabel(row.category) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="大小" width="100">
        <template #default="{ row }">{{ formatFileSize(row.size) }}</template>
      </el-table-column>
      <el-table-column label="修改时间" width="150">
        <template #default="{ row }">{{ formatDateTime(row.lastModified) }}</template>
      </el-table-column>
      <!-- 【这一列是整页的重点】被哪些地方用着。
           每一条都能点开对应的前台页面 —— 站长看到"这张图被某篇文章用了"之后，
           下一步一定是去那篇文章看看（改掉它、或者确认可以删）。 -->
      <el-table-column label="被引用的地方" min-width="260">
        <template #default="{ row }">
          <div v-if="row.references.length" class="sp-refs">
            <a
              v-for="(ref, i) in row.references" :key="`${ref.type}-${ref.targetId}-${ref.field}-${i}`"
              class="sp-ref" :href="refUrl(ref, row)" target="_blank" rel="noopener">
              {{ refLabel(ref) }}
            </a>
          </div>
          <el-tag v-else type="warning" size="small" effect="plain">无人引用</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="100">
        <template #default="{ row }">
          <div class="sp-acts">
            <el-button
              size="small" type="danger" :disabled="row.references.length > 0"
              @click="removeOne(row)">删除</el-button>
          </div>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script setup>
import { ElMessage, ElMessageBox } from 'element-plus'

/**
 * 存储管理面板。
 *
 * 【接口形状】GET /admin/upload/storage 一次返回整份清单（后端注释里写了为什么不分页）：
 *   { usedBytes, maxTotalBytes, fileCount, orphanCount, files: [{ key, url, name,
 *     category, size, lastModified, references: [{ type, targetId, title, field }] }] }
 *
 * 【筛选为什么放在前端做】清单本来就已经整份拿回来了（引用索引是一次全量构建的，
 * 分页反而要多缓存一层状态），那筛选就没有理由再跑一趟后端 ——
 * 而且"按是否被引用筛"这件事后端也答不了：那个判断的输入就是整份清单。
 */
const { request } = useApi()

const loading = ref(false)
const files = ref([])
const orphanCount = ref(0)
const usedBytes = ref(0)
const maxTotalBytes = ref(0)

const keyword = ref('')
const category = ref('')
const refFilter = ref('')

const usedPercent = computed(() => {
  if (!maxTotalBytes.value) return 0
  // 夹到 100：护栏是"超过就拒绝"，所以理论上到不了 100 以上；
  // 但手工往上传目录里塞过文件（或者并发上传挤过去）时可能超，
  // 那时进度条画出 >100 会让 el-progress 直接报错
  return Math.min(100, Math.round((usedBytes.value / maxTotalBytes.value) * 100))
})

const visibleFiles = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  return files.value.filter((f) => {
    if (category.value && f.category !== category.value) return false
    if (refFilter.value === 'referenced' && !f.references.length) return false
    if (refFilter.value === 'orphan' && f.references.length) return false
    if (kw && !`${f.name} ${f.key}`.toLowerCase().includes(kw)) return false
    return true
  })
})

const CATEGORY_LABELS = { cover: '图片', music: '音频', attachment: '附件' }
const categoryLabel = (c) => CATEGORY_LABELS[c] || c || '—'

/** 引用方类型 → 显示用的名字 */
const TYPE_LABELS = {
  ARTICLE: '文章', ATTACHMENT: '附件', MUSIC: '音乐',
  ABOUT: '关于页', FRIEND_LINK: '友链', PROJECT: '项目', FAVORITE: '收藏',
}

/**
 * 一条引用显示成什么。
 * 【为什么要带上字段名】同一个文件被同一篇文章引用了两次（封面 + 正文）时会有两条，
 *   只显示"《某文》"的话两条一模一样，站长没法判断该去改哪里。
 */
const refLabel = (ref) => {
  const type = TYPE_LABELS[ref.type] || ref.type
  if (ref.type === 'ABOUT') return `关于页 · ${ref.field}`
  const title = ref.title ? `《${ref.title}》` : `#${ref.targetId}`
  return `${type}${title} · ${ref.field}`
}

/**
 * 引用点开之后去哪 —— **前台页面**，而不是后台编辑器。
 * 【为什么是前台】点开这一下的目的通常是"看看这张图到底用在哪了"，
 *   前台页面正好是这个问题的答案（而且是新窗口，不打断当前的清理工作）。
 *   要改的话再回对应的管理页 —— 后台面板之间的跳转需要一整套"切菜单 + 打开某条记录"
 *   的接线，为这一个链接不值当。
 * 【草稿文章没有前台页面】后端返回的是文章 id，草稿在 /article/{id} 上会 404 ——
 *   但那也好过给一个假的链接误导人（站长会以为是站点坏了）。
 */
const refUrl = (ref) => {
  switch (ref.type) {
    case 'ARTICLE':
    case 'ATTACHMENT':   // 附件那条的 targetId 是它所属文章的 id
      return `/article/${ref.targetId}`
    case 'MUSIC': return '/music'
    case 'ABOUT': return '/about'
    case 'FRIEND_LINK': return '/links'
    case 'PROJECT': return '/projects'
    case 'FAVORITE': return '/favorites'
    default: return '#'
  }
}

const load = async () => {
  loading.value = true
  const res = await request('/admin/upload/storage')
  loading.value = false
  if (!res.ok || !res.data) {
    // 读失败时把清单清空但保留页面（不要因为一次接口抖动就让表格停留在旧数据上 ——
    // 那些旧数据里的"无人引用"可能已经不成立了）
    files.value = []
    orphanCount.value = 0
    ElMessage.error(res.message || '读取存储清单失败')
    return
  }
  files.value = Array.isArray(res.data.files) ? res.data.files : []
  orphanCount.value = Number(res.data.orphanCount) || 0
  usedBytes.value = Number(res.data.usedBytes) || 0
  maxTotalBytes.value = Number(res.data.maxTotalBytes) || 0
}

/**
 * 删掉若干个 key，并把结果说清楚。
 * 【为什么要把报告拼成一句话给用户看】后端会区分"删掉了 / 因为仍被引用而跳过 /
 *   删除失败"三种结果。笼统说一句"操作完成"的话，站长勾了 10 个，
 *   回头一看还剩 3 个，会以为功能坏了。
 */
const deleteKeys = async (keys, successPrefix) => {
  const res = await request('/admin/upload/delete-files', {
    method: 'POST',
    body: { keys },
  })
  if (!res.ok) {
    ElMessage.error(res.message || '删除失败')
    return false
  }
  const { deleted = [], skippedReferenced = [], failed = [] } = res.data || {}
  const parts = [`${successPrefix}${deleted.length} 个`]
  if (skippedReferenced.length) parts.push(`${skippedReferenced.length} 个仍被引用已保留`)
  if (failed.length) parts.push(`${failed.length} 个删除失败`)
  // 有没能删掉的就用警告色，全删掉了才是成功色 —— 颜色本身也是一条信息
  if (skippedReferenced.length || failed.length) ElMessage.warning(parts.join('，'))
  else ElMessage.success(parts.join('，'))
  await load()
  return true
}

const removeOne = async (row) => {
  try {
    await ElMessageBox.confirm(
      `确定删除「${row.name}」吗？此操作不可撤销。`,
      '删除文件',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
  } catch {
    return   // 用户点了取消
  }
  await deleteKeys([row.key], '已删除 ')
}

const cleanOrphans = async () => {
  const orphans = files.value.filter(f => !f.references.length)
  if (!orphans.length) return
  const totalSize = orphans.reduce((sum, f) => sum + (Number(f.size) || 0), 0)
  try {
    await ElMessageBox.confirm(
      `将删除 ${orphans.length} 个没有任何地方引用的文件，可释放约 ${formatFileSize(totalSize)}。`
      + '此操作不可撤销。',
      '清理无人引用的文件',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  await deleteKeys(orphans.map(f => f.key), '已清理 ')
}

onMounted(load)
</script>

<style scoped>
/* 占用概览：与表格分开一块，因为它回答的是"还剩多少"这个与清单不同的问题 */
.sp-usage { padding: 16px 20px; }
.sp-usage-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 10px; }
.sp-usage-label { color: var(--muted); font-size: 13px; }
.sp-usage-num { color: var(--text); font-size: 15px; font-weight: 600; }

.sp-search { width: 260px; }
.sp-filter { width: 160px; }
/* 三个筛选控件之间留点缝：toolbar 是 flex，贴在一起会分不清哪个是哪个 */
.sp-search + .sp-filter { margin-left: 10px; }
.sp-filter + .sp-filter { margin-left: 10px; }

.sp-thumb-link { display: block; line-height: 0; }
/* 缩略图固定尺寸 + object-fit：不同长宽比的图在这里都显示成统一大小，
   否则一张竖图会把整行撑高（与文章封面预览同一个做法） */
.sp-thumb {
  width: 56px; height: 56px; object-fit: cover;
  border-radius: 6px; border: 1px solid rgba(150, 190, 240, .18);
}
.sp-thumb-text { display: inline-block; font-size: 24px; line-height: 56px; text-align: center; width: 56px; }

.sp-name { color: var(--text); font-size: 13px; word-break: break-all; }
.sp-key { color: var(--muted); font-size: 12px; margin-top: 2px; word-break: break-all; }

/* 引用清单：换行排列，条数多时不会把行高撑得离谱 */
.sp-refs { display: flex; flex-wrap: wrap; gap: 6px; }
.sp-ref {
  color: var(--accent); font-size: 12px; text-decoration: none;
  padding: 1px 8px; border-radius: 999px;
  background: rgba(242, 193, 78, .10); border: 1px solid rgba(242, 193, 78, .25);
}
.sp-ref:hover { background: rgba(242, 193, 78, .18); }

/* 操作列：flex + nowrap，按钮永远排一行（与其它面板一致） */
.sp-acts { display: flex; flex-wrap: nowrap; }
</style>
