<template>
  <!--
    音乐管理（增删改）。
    【形状与另外四个内容模块（收藏 / 项目 / 友链 / 关于）完全对齐】列表 + 新建/编辑
    弹窗 + 二次确认删除 —— 后台里五个内容页长得一样，管理员换一个菜单就不用重新
    找按钮在哪。它自己的两个特点写在下面：
      · 音频是"大文件"（上限 20MB，比封面的 5MB 大得多），所以上传按钮旁边必须
        留着手填地址（换服务器/换域名时要改地址，只有上传框就只能重传一遍）
      · 歌词是**长文本**，直接粘贴 LRC 原文，不做成"上传 .lrc 文件"
       （站长手上通常就是一段文本；做成文件上传还要多一次"读文件"的动作，
        而读文件之后照样得让他在编辑器里改错别字）

    【为什么这一页的数据由它自己持有】音乐列表只有这一页用（不像标签/分类要喂
    文章弹窗的下拉框），所以列表 ref、loading 与"什么时候刷新"全都留在面板内部
    （挂载时自己拉一次）。这与收藏 / 项目 / 友链 / 关于那四个面板是同一个判断。

    【字段上限 100 / 100 / 500 / 255 / 20000】与其它四个模块一样收敛在共享的
    app/utils/contentForm.ts（MUSIC_LIMITS），逐条抄自后端 MusicForm 的 @Size 注解。
    前端 maxlength 只是"本地即时反馈"，真正生效的永远是后端那一层（直接调接口可以绕过前端）。
  -->
  <header class="top">
    <h1>音乐管理</h1>
    <p>共 {{ musics.length }} 首歌（含隐藏的；前台播放器只放状态为「显示」的那些）</p>
  </header>

  <div class="toolbar glass">
    <el-button type="success" @click="openCreate">+ 新建歌曲</el-button>
    <el-button @click="load">刷新</el-button>
    <span class="tb-hint">「隐藏」会让这首歌立刻从前台播放器列表里消失；数据还在，改成「显示」就回来了。</span>
  </div>

  <div class="panel glass">
    <el-table
      v-loading="loading" :data="musics"
      empty-text="还没有歌曲，点左上角「新建歌曲」加一首吧">
      <!-- 封面缩略图：没有封面时显示「—」而不是留一格空白
           （空白看起来像"这一行没加载出来"） -->
      <el-table-column label="封面" width="80">
        <template #default="{ row }">
          <img v-if="row.cover" class="mp-thumb-img" :src="row.cover" alt="封面缩略图" loading="lazy">
          <span v-else class="mp-thumb-none">—</span>
        </template>
      </el-table-column>
      <el-table-column prop="title" label="曲名" min-width="160">
        <template #default="{ row }"><span class="art-title">{{ textOf(row.title) }}</span></template>
      </el-table-column>
      <!-- 歌手是可选的：没填就显示「—」，而不是留一格空白 -->
      <el-table-column prop="artist" label="歌手" width="120">
        <template #default="{ row }">{{ textOf(row.artist) }}</template>
      </el-table-column>
      <!-- 【为什么不显示时长】后端没有这个字段（时长要么在读音频文件时算出来、
           要么在浏览器里加载一遍音频才知道），前端自己算就要把每个音频都下载一次 ——
           不值得。宁可少一列，也不要显示一个猜出来的数字。 -->
      <el-table-column prop="sort" label="排序" width="80" />
      <el-table-column prop="status" label="状态" width="90">
        <template #default="{ row }">
          <el-tag :type="row.status === 0 ? 'info' : 'success'" size="small" effect="plain">
            {{ row.status === 0 ? '隐藏' : '显示' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="createTime" label="创建时间" width="150">
        <template #default="{ row }">{{ formatDateTime(row.createTime) }}</template>
      </el-table-column>
      <!-- 操作列 flex + nowrap：按钮永远排一行，列宽不够时由表格横向滚动
           （理由同收藏管理：靠调大列宽只是把折行问题往后推） -->
      <el-table-column label="操作" width="160">
        <template #default="{ row }">
          <div class="mp-acts">
            <el-button size="small" @click="openEdit(row)">编辑</el-button>
            <el-button size="small" type="danger" @click="remove(row)">删除</el-button>
          </div>
        </template>
      </el-table-column>
    </el-table>
  </div>

  <!-- ==================== 新建 / 编辑歌曲弹窗 ==================== -->
  <el-dialog
    v-model="editVisible" class="art-edit-modal" :title="form.id ? '编辑歌曲' : '新建歌曲'"
    width="min(640px, 92vw)" :close-on-click-modal="false">
    <div class="af-row">
      <span class="ed-label">曲名</span>
      <el-input
        v-model="form.title" placeholder="比如：夜航星"
        maxlength="100" show-word-limit @keyup.enter="save" />
    </div>

    <div class="af-row">
      <span class="ed-label">歌手</span>
      <el-input v-model="form.artist" placeholder="比如：某某乐队（可以留空）" maxlength="100" />
    </div>

    <div class="af-row">
      <span class="ed-label">音频地址</span>
      <!-- 【上传与手填两种都要能用】
           · 上传：POST /upload?type=audio（走 useUpload('audio')：只收 mp3、上限 20MB）
           · 手填：换服务器 / 换域名时要改地址、图省事的也可以直接贴站内路径
             （比如 /media/bg-music.mp3，这个文件本来就在站点的媒体目录里）
           上传成功会把返回的地址填进这个输入框，用户看得见、也能接着改。 -->
      <div class="mp-field">
        <el-input
          v-model="form.url" class="mp-input"
          placeholder="/media/bg-music.mp3 或 https://…（也可以点上传）" maxlength="500" />
        <div class="cover-btns">
          <el-upload
            :show-file-list="false"
            :auto-upload="false"
            accept="audio/mpeg"
            :on-change="onAudioChosen"
          >
            <el-button :loading="audioUploading">
              {{ form.url ? '更换音频' : '上传音频' }}
            </el-button>
          </el-upload>
        </div>
        <span class="af-hint">
          支持 {{ AUDIO_EXTENSIONS.join(' / ') }}，单个音频不超过 {{ AUDIO_MAX_SIZE_TEXT }}
        </span>
      </div>
    </div>

    <div class="af-row">
      <span class="ed-label">封面</span>
      <!-- 封面与另外三个面板同款：预览 + 手填 + 上传 + 移除 -->
      <div class="cover-field">
        <img v-if="form.cover" :src="form.cover" class="cover-preview" alt="封面预览">
        <el-input
          v-model="form.cover" class="cover-input"
          placeholder="/uploads/cover.png 或 https://…（也可以点上传）" maxlength="255" />
        <div class="cover-btns">
          <el-upload
            :show-file-list="false"
            :auto-upload="false"
            accept="image/jpeg,image/png,image/gif,image/webp"
            :on-change="onCoverChosen"
          >
            <el-button :loading="coverUploading">
              {{ form.cover ? '更换封面' : '上传封面' }}
            </el-button>
          </el-upload>
          <el-button v-if="form.cover" plain @click="form.cover = ''">移除</el-button>
        </div>
        <span class="af-hint">
          支持 {{ IMAGE_EXTENSIONS.join(' / ') }}，单张不超过 {{ IMAGE_MAX_SIZE_TEXT }}
        </span>
      </div>
    </div>

    <div class="af-row ab-bio-row">
      <span class="ed-label">歌词</span>
      <!-- 【为什么是文本框而不是"上传 .lrc 文件"】站长手上通常是浏览器里复制来的
           一段 LRC 文本，粘贴最直接；做成文件上传之后，他照样得打开编辑器改错别字，
           等于多一步。歌词存的是 LRC 原文，前台按 [mm:ss.xx] 标签渲染。 -->
      <el-input
        v-model="form.lyrics" type="textarea" :rows="8"
        placeholder="直接粘贴 LRC 歌词，留空则前台显示「暂无歌词」"
        maxlength="20000" show-word-limit />
    </div>

    <div class="af-row">
      <span class="ed-label">排序</span>
      <el-input-number v-model="form.sort" :min="0" :max="9999" controls-position="right" />
      <span class="af-hint">越小越靠前</span>
    </div>

    <div class="af-row">
      <span class="ed-label">状态</span>
      <el-select v-model="form.status" class="mp-select">
        <el-option label="显示（前台播放器里能看到）" :value="1" />
        <el-option label="隐藏（前台看不到）" :value="0" />
      </el-select>
    </div>

    <!-- 【为什么失败原因要显示在弹窗里，而不是只弹一个 toast】
         地址不合法、曲名为空这类失败是最常见的，而 toast 三秒后就消失了，
         用户那时还看着弹窗、正准备改一改再保存。把原因留在弹窗里 + 弹窗不关闭，
         用户才能当场改完重试；只弹 toast 的表现是"点保存没反应，提示一闪而过"。 -->
    <p v-if="formError" class="ed-error">{{ formError }}</p>

    <template #footer>
      <span class="af-foot-tip">曲名与地址首尾的空格会被自动去掉</span>
      <el-button @click="editVisible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="save">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ElMessage, ElMessageBox } from 'element-plus'

// ================================================================
// app/components/admin/MusicPanel.vue
//
// 作用：后台「音乐管理」面板，对接四个接口（全部要求 ADMIN，走 useApi 自动带 token）：
//   · GET    /admin/music/list —— 列表（含隐藏的、不分页，后端按 sort ASC, id ASC 给）
//   · POST   /admin/music      —— 新建，返回 Result<Long>（新建出来的 id）
//   · PUT    /admin/music/{id} —— 编辑，返回 Result<Void>（没有 data）
//   · DELETE /admin/music/{id} —— 删除（后端是逻辑删除，界面上无法恢复）
//   音频文件走 POST /upload?type=audio（由 useUpload('audio') 负责拼这个参数）。
//
// 【为什么保存成功之后要重新拉列表，而不是把这一条塞进本地数组】
//   · sort 是后端排的（ORDER BY sort ASC, id ASC），本地插进去的位置不一定对
//   · 后端会在保存时归一化字段（空串 → null），本地那条就和后端那份对不上了
//   所以"成功的定义"是：弹窗关掉 + 重新拉一次列表。
//
// 【404 为什么要自愈】删除/编辑一首已经被别人（另一个标签页、另一个管理员）删掉的
//   歌时，后端返回 **HTTP 200 + body.code = 404**（MUSIC_NOT_FOUND）。
//   这时什么都不做的话，用户看到的是"一句报错 + 表格里还列着它"，会以为删除失败
//   再点一次。而这一次它仍然要靠**后端返回的 code** 来判断（HTTP 状态码是 200，
//   拿状态码判会永远进不去这条分支）。
//
// 【技术栈与关键字】
//   · asList / textOf / rawText / isExternalUrl：共享纯函数（app/utils/contentList.ts）
//   · MUSIC_LIMITS / checkRequiredText / checkOptionalText / checkMediaUrl /
//     checkImageUrl / checkStatus：共享的表单上限与预检（app/utils/contentForm.ts）——
//     音乐的这套规则和另外四个模块放在同一个文件里，改上限时只需要改一处；
//     它们都是**自动导入**的，所以这个文件里看不到 import 语句
//   · useUpload('audio') / useUpload()：同一个 composable 的两种形态
//     （音频只收 mp3、上限 20MB、请求带 ?type=audio；图片那套行为一字未改）
//   · formatDateTime：时间显示的唯一规则（app/utils/time.ts）
//   · ElMessageBox.confirm：取消时它 **reject**，所以必须 try/catch 之后 return ——
//     接不住的话用户点了取消，删除请求照样发出去
// ================================================================

const { request } = useApi()

/**
 * 字段上限与音频地址预检都来自共享的 app/utils/contentForm.ts
 * （`MUSIC_LIMITS` / `checkMediaUrl`），和另外四个内容模块（收藏 / 项目 / 友链 / 关于）
 * 的 LIMITS 与校验函数放在一起，理由：**同一类规则只该有一处放法** ——
 * 分散成"面板内部一份 + 共享文件一份"之后，下一个人改上限时很容易只改到一处，
 * 而漏改的那一处不会报错，只会让界面与后端悄悄打架。
 *
 * 【为什么音频地址是 checkMediaUrl 而不是 checkImageUrl】
 *   两者接受的形态目前相同（外链 / `/` 开头的站内路径），但后端是**两个常量**
 *   （`MEDIA_URL` 与 `IMAGE_URL`）、两句提示文案。合并复用的后果是：
 *   哪天后端只把其中一条改宽/改严，另一边会跟着错位且不报错 ——
 *   完整理由写在 contentForm.ts 里那个函数的注释上（照抄后端 UrlPatterns 的推导）。
 *
 * 【提示语里的字段名为什么是「音频地址」而不是「歌曲地址」】
 *   后端 MusicForm 的消息主语就是「音频地址不能为空」/「音频地址最长 500 字」，
 *   而本项目的一条约定是"两道校验的文案一模一样，用户看不出是哪一道拦的"。
 *   所以校验用的 label 与后端对齐（弹窗里的行标题也一并改成「音频地址」，统一叫法）。
 */

const musics = ref([])
const loading = ref(false)

const editVisible = ref(false)
const saving = ref(false)
/** 保存失败时显示在弹窗里的原因（toast 会消失，弹窗不会） */
const formError = ref('')

/** 表单：id 为 null 表示"新建"，否则是编辑。字段名与后端 MusicForm 逐字一致 */
const form = reactive({
  id: null, title: '', artist: '', url: '', cover: '', lyrics: '', sort: 0, status: 1,
})

// ---------- 音频上传（useUpload 的音频模式） ----------
// 【为什么是 useUpload('audio') 而不是再造一套】同一个 /upload 接口，两种形态的差别
//   只有"白名单、大小上限、要不要带 ?type=audio"三件事，这些全部收在 useUpload 的
//   规则表里（那边有注释说明为什么做成表）。这里复用的是同一套预检与请求拼装。
const { upload: uploadAudio, ALLOWED_EXTENSIONS: AUDIO_EXTENSIONS, MAX_SIZE_TEXT: AUDIO_MAX_SIZE_TEXT } = useUpload('audio')
const audioUploading = ref(false)

/** 图片（封面）仍用默认的图片模式：5 种格式、上限 5MB */
const { upload: uploadCover, ALLOWED_EXTENSIONS: IMAGE_EXTENSIONS, MAX_SIZE_TEXT: IMAGE_MAX_SIZE_TEXT } = useUpload()
const coverUploading = ref(false)

/**
 * el-upload 选中音频后的回调（`:auto-upload="false"` 时由它接管上传）。
 *
 * 【注意 uploadFile.raw】on-change 给的是一个包装对象，真正的浏览器 File 在 `.raw` 上。
 * 【绝不能用 el-upload 的 action 直传】那条路不带 Authorization 头（它走自己的 XHR，
 *   绕过了 useApi），后端会返回 401；而且它也不会带 ?type=audio。
 * 【失败时不动 form.url】只有成功才赋值 —— 原来的地址必须留着：
 *   清空的话用户会以为"我刚填的地址被弄丢了"，而且一保存就把这首歌的地址真的清掉。
 */
const onAudioChosen = async (uploadFile) => {
  const file = uploadFile?.raw
  if (!file) return

  audioUploading.value = true
  try {
    const res = await uploadAudio(file)
    if (res.ok && res.url) {
      // 后端返回 Result<{ url, ... }>：地址在 data.url 上，useUpload 已经解析成 res.url
      form.url = res.url
      ElMessage.success('音频上传成功')
    } else {
      ElMessage.error(res.message || '音频上传失败')
    }
  } finally {
    // finally：不管成功失败都收掉 loading，否则一次异常会让按钮永久转圈
    audioUploading.value = false
  }
}

/** 封面（图片）上传：与另外四个面板逐条相同 */
const onCoverChosen = async (uploadFile) => {
  const file = uploadFile?.raw
  if (!file) return

  coverUploading.value = true
  try {
    const res = await uploadCover(file)
    if (res.ok && res.url) {
      form.cover = res.url
      ElMessage.success('封面上传成功')
    } else {
      ElMessage.error(res.message || '封面上传失败')
    }
  } finally {
    coverUploading.value = false
  }
}

/** 拉列表（失败或结构不对时列表为空，但页面不崩） */
const load = async () => {
  loading.value = true
  const res = await request('/admin/music/list')
  loading.value = false
  musics.value = asList(res)
}

const openCreate = () => {
  form.id = null
  form.title = ''
  form.artist = ''
  form.url = ''
  form.cover = ''
  form.lyrics = ''
  // 排序默认 0（后端的规则是"越小越靠前"，0 就是它的默认值）
  form.sort = 0
  // 新建默认"显示"：与后端一致。默认成"隐藏"的话，用户建完之后会去前台找它，
  // 然后以为没保存成功
  form.status = 1
  formError.value = ''
  editVisible.value = true
}

const openEdit = (row) => {
  form.id = row.id
  form.title = row.title || ''
  // 可选字段可能是 null（后端把空串归一成 null 存的），显式兜成空串：
  // 它们还会被 .trim() 用到，null 上没有这个方法
  form.artist = row.artist || ''
  form.url = row.url || ''
  form.cover = row.cover || ''
  // 【歌词必须原样回显，不能 trim 掉中间的东西】LRC 的换行与缩进就是它的格式，
  // 压成一行之后歌词就废了（rawText 只去掉首尾空白，这正是我们想要的）
  form.lyrics = row.lyrics || ''
  // sort / status 可能是 null：数字控件与下拉框拿到 null 会显示成空，
  // 用户一保存就把它们变成 0 / 未选 —— 显式兜成后端的默认值
  form.sort = Number(row.sort) || 0
  form.status = row.status === 0 ? 0 : 1
  formError.value = ''
  editVisible.value = true
}

/**
 * 保存（新建或编辑）。
 *
 * 【校验顺序是有意的】先必填（曲名、地址）、再长度与格式、最后状态 ——
 *   用户一次只会看到第一条错误，所以"最该先改的那条"排在前面。
 *
 * 【为什么前端也校验一遍】前端预检只是体验优化（本地即时反馈、不浪费一次往返），
 *   真正生效的永远是后端那一层。两道校验的文案刻意写成一模一样，
 *   用户看不出是哪一道拦的 —— 这正是想要的效果。
 */
const save = async () => {
  formError.value = ''

  const title = rawText(form.title)
  const artist = rawText(form.artist)
  const url = rawText(form.url)
  const cover = rawText(form.cover)
  // 歌词只去首尾空白：中间一个字符都不动（见 openEdit 里那段说明）
  const lyrics = rawText(form.lyrics)
  const status = Number(form.status)

  const error = checkRequiredText(title, '曲名', MUSIC_LIMITS.title)
    || checkOptionalText(artist, '歌手', MUSIC_LIMITS.artist)
    || checkMediaUrl(url, '音频地址', { maxLength: MUSIC_LIMITS.url })
    || checkImageUrl(cover, '封面地址', { maxLength: MUSIC_LIMITS.cover })
    || checkOptionalText(lyrics, '歌词', MUSIC_LIMITS.lyrics)
    || checkStatus(status)
  if (error) {
    formError.value = error
    return
  }

  // 防连点：按钮上虽然有 :loading，但两次点击落在同一帧时它还没重绘
  if (saving.value) return
  saving.value = true

  // 整份表单覆盖式提交（与后端"缺字段 = 清空"的语义一致）：
  // 传空串而不是不传，才是"这些字段现在就是空的"的准确表达
  const body = { title, artist, url, cover, lyrics, sort: Number(form.sort) || 0, status }
  const isEdit = !!form.id

  const res = isEdit
    ? await request('/admin/music/' + form.id, { method: 'PUT', body })
    : await request('/admin/music', { method: 'POST', body })

  saving.value = false

  if (res.ok) {
    // 【为什么不检查 POST 返回的 id】前端拿到它没有任何用处：列表要重新拉，
    // 而"新 id 是几"这件事在列表刷新之后自然就看到了。
    ElMessage.success(isEdit ? '已保存' : '歌曲已创建')
    editVisible.value = false
    load()
    return
  }

  // 【404 = 这首歌已经被别人删掉了】自愈：提示 + 关弹窗 + 重拉列表。
  //   弹窗必须关：用户正在编辑的那条记录已经不存在了，留着弹窗让他继续改、
  //   再点一次保存只会再撞一次 404
  if (res.code === 404) {
    ElMessage.warning('这首歌已经不在了，列表已刷新')
    editVisible.value = false
    load()
    return
  }

  // 其它失败：弹窗留着 + 把后端的原因写在弹窗里
  formError.value = res.message || '保存失败，请稍后再试'
}

/**
 * 删除（后端是逻辑删除：前台后台都不再显示，界面上无法恢复）。
 * 【确认文案为什么说"前台播放器列表"】用户看到的是一首歌不见了 ——
 *   得让他知道影响范围是"前台播放器里也不再放它了"，而不是以为只是从后台列表里去掉。
 * 【取消时一个请求都不发】ElMessageBox.confirm 在用户点"取消"时是 reject 的，
 *   所以必须 try/catch 之后 **return**：漏了这一步，用户点了取消，删除请求照样发出去
 *   （这是"确认框形同虚设"最典型的写法）。
 */
const remove = async (row) => {
  try {
    await ElMessageBox.confirm(
      `确定要删除歌曲「${textOf(row.title)}」吗？删掉之后这首歌会立刻从前台播放器列表里消失，界面上无法恢复。`,
      '危险操作',
      { type: 'error', confirmButtonText: '确认删除', cancelButtonText: '取消' },
    )
  } catch { return }

  const res = await request('/admin/music/' + row.id, { method: 'DELETE' })
  if (res.ok) {
    ElMessage.success('已删除')
    load()
    return
  }
  // 404：别人已经删过了。提示 + 重拉列表（那条记录自己就没了），
  // 而不是让用户对着"报错 + 表格里还列着它"再点一次
  if (res.code === 404) {
    ElMessage.warning('这首歌已经不在了，列表已刷新')
    load()
  }
}

// 挂载时拉一次：父页面用 v-if 切换菜单，"切到音乐管理"= 本组件被挂载
onMounted(load)
</script>

<style scoped>
/* 操作列里的按钮排一行、永不折行 */
.mp-acts { display: flex; align-items: center; gap: 8px; flex-wrap: nowrap; }

/* ---------- 表格里的封面缩略图 ---------- */
/* 固定尺寸 + object-fit: cover：不同长宽比的封面都显示成统一大小的小图，
   不会把行高撑起来（表格里最怕行高参差不齐） */
.mp-thumb-img {
  width: 44px; height: 44px; object-fit: cover; border-radius: 8px; display: block;
  border: 1px solid rgba(150,190,240,.18); background: #0d1b38;
}
/* 没有封面时的占位符：弱化色，和"这一格有图"在观感上区分开 */
.mp-thumb-none { color: var(--muted); }

/* ---------- 音频地址那一行（手填 + 上传） ---------- */
/* flex-wrap：窄屏时上传按钮换到输入框下面，而不是把这一行挤变形 */
.mp-field { flex: 1; display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
/* min-width: 0 是 flex 子项能被压窄的前提（默认 min-width:auto 会让长地址撑破这一行） */
.mp-input { flex: 1 1 240px; min-width: 0; }

/* ---------- 封面：预览 + 手填地址 + 上传按钮（与另外四个面板同款） ---------- */
.cover-field { flex: 1; display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.cover-preview {
  height: 64px; width: 96px; object-fit: cover; border-radius: 8px;
  border: 1px solid rgba(150,190,240,.18); background: #0d1b38;
}
.cover-input { flex: 1 1 200px; min-width: 0; }
.cover-btns { display: flex; align-items: center; gap: 8px; }

/* 歌词那一行特殊：它是 8 行的多行输入框，沿用 .af-row 的 align-items:center 会让
   标签垂直居中在输入框正中间 —— 而它标注的是输入框的**顶部**内容，看起来像标错了位置 */
.ab-bio-row { align-items: flex-start; }

/* 弹窗里的状态下拉框固定宽度（不固定会撑满弹窗，左边缘与上面的输入框对不齐） */
.mp-select { width: 260px; }
</style>
