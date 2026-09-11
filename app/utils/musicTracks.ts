// ============================================================
// app/utils/musicTracks.ts
//
// 作用：把「后端音乐接口给的数据」变成「播放器能直接用的曲目数组」，
//       以及**那一首内置的兜底曲目**（站长一首都没上传时也放得出声音）。
//
// 【2026-09-11 重大改动：曲目不再由前端写死】
//   改之前这里是一张**手写**的 `MUSIC_TRACKS` 常量表（加歌 = 改代码）。
//   现在曲目由**后台上传**：`GET /music/list` 返回列表，前台只负责渲染。
//   所以这个文件里剩下的只有三件事：归一化、兜底、越界保护 —— 都是纯逻辑，有单测。
//
// 【契约（后端按这个做，前端按这个接，两边都不许自己改字段名）】
//   · `GET /music/list` → `Result<List<MusicVO>>`，**不分页**，只返回 `status = 1`
//   · VO 字段：id / title / artist / url / cover / lyrics / sort / status / createTime
//     · `url`       音频地址：可能是 `/uploads/xxx.mp3`、`/media/xxx.mp3` 或**完整外链**
//     · `cover`     封面图片地址（可能为 null）
//     · `lyrics`    **LRC 原文文本**（不是文件路径；可能为 null）
//     · `artist`    可能为 null
//   · **顺序就是后端给的顺序**（`sort ASC, id ASC`）。前端**一次都不重排** ——
//     这是本站一贯的契约（归档页那段注释里也是同一条理由）：
//     前端再排一次，等于把排序规则复制成两份，哪天后端改成"置顶优先"，
//     前端这份会把它盖掉，而页面上看起来一切正常（只是顺序不对）。
//
// 【为什么不假设 url 在 /media/ 下】`url` 是完整地址或 `/` 开头，
//   直接就能当 `<audio src>` 用（`/uploads/...` 是后台上传的目录，和 `/media/` 不是一回事）。
//   只有"内置兜底那一首"才需要 `mediaUrl()` 去拼前缀（它的文件在 static-media/ 里）。
//
// 【技术栈与关键字】
//   · 显式 import（而不是靠 Nuxt 自动导入）：这个模块**不依赖 Nuxt 运行时**，
//     于是可以在纯 node 环境的单测里直接引用（test/musicTracks.spec.ts）。
//   · `mediaUrl()` 用 try/catch 包着读运行时配置（见 app/utils/media.ts），
//     所以在没有 Nuxt 上下文的地方调用它也只会回落到默认前缀，不会抛。
// ============================================================

import { MEDIA_FILES, mediaUrl } from './media'

/**
 * 内置兜底曲目：**唯一一条**，在"接口挂了 / 还没上传任何歌"时显示。
 *
 * 【为什么要有这一条，而不是显示空列表或者"读不到"】
 *   背景音乐是**次要功能**：它不该被一个接口带着一起崩。
 *   站长一首都没上传时，播放器照样要能放 —— 也就是今天的行为
 *   （放 `static-media/bg-music.mp3`）。所以这条路是**产品要求**，有用例钉着。
 * 【为什么是函数而不是常量】它的两个地址要走 `mediaUrl()`（前缀来自运行时配置），
 *   而运行时配置只能在运行时读；写成常量会在模块加载时就把前缀定死。
 * 【它的标题是「背景音乐」——不编造】这个音频文件的 ID3 里没有 TIT2/TPE1
 *   （没有曲名、没有歌手），所以只能由一个不撒谎的名字代表它：
 *   它在这站里的作用就是背景音乐。`artist` 是空串 → 界面上整个不渲染歌手那一行。
 */
export const builtinTrack = () => ({
  /** 内置曲目没有数据库 id（它不在 `music` 表里） */
  id: null,
  title: '背景音乐',
  artist: '',
  url: builtinMusicUrl(),
  cover: mediaUrl(MEDIA_FILES.musicCover),
  lyrics: '',
  /** 标记：界面上不需要区分，但用例与"歌词文件回落"的规则要认它 */
  builtin: true,
})

/** 内置那一首的音源地址（`/media/bg-music.mp3`）。也用来判断"这首歌的歌词文件是不是它" */
export const builtinMusicUrl = () => mediaUrl(MEDIA_FILES.backgroundMusic)

/**
 * 内置那一首的歌词文件地址（`/media/bg-music.lrc`）。
 * 【它只属于内置那一首】这个文件是 `bg-music.mp3` 的歌词；
 *   把它显示在**别的歌**下面等于给用户看错的歌词（比"没有歌词"糟得多）。
 *   所以只有当曲目的音源就是内置那一首时，才会用它回落（见 selectLyricsFallback）。
 */
export const builtinLyricsUrl = () => mediaUrl(MEDIA_FILES.musicLyrics)

/**
 * 归一化接口返回的曲目数组。
 *
 * @param {unknown} data `GET /music/list` 的 `data`（可能是数组、可能是 null、也可能结构变了）
 * @returns {Array<object>} 归一化后的曲目；**保持接口给的顺序**；脏数据跳过
 *
 * 【为什么每个字段都要判类型】接口返回的东西不受我们控制：结构可能变、字段可能缺。
 *   直接渲染 `raw.title` 的后果是页面上出现 `undefined` 或者整页渲染报错。
 *   这里定死形状之后，模板里一个兜底都不用写。
 * 【为什么没有 url 的曲目直接跳过】没有音源地址的曲目放不了：留着它会渲染出一行
 *   "点了没反应"的按钮（用户只会觉得播放器坏了）。跳过它，其余的照常放。
 * 【为什么标题为空不编一个"未命名"】本项目的底线是"要么真数据、要么不显示"。
 *   后台的表单本来就要求填曲名，真的空着就如实空着（不编）。见模板注释。
 */
export const normalizeMusicList = (data) => {
  if (!Array.isArray(data)) return []

  const tracks = []
  for (const raw of data) {
    if (!raw || typeof raw !== 'object') continue
    const url = typeof raw.url === 'string' ? raw.url.trim() : ''
    if (!url) continue
    tracks.push({
      id: raw.id ?? null,
      title: typeof raw.title === 'string' ? raw.title.trim() : '',
      // artist / cover 可能是 null：统一成空串，模板里就只需要判"空不空"
      artist: typeof raw.artist === 'string' ? raw.artist.trim() : '',
      url,
      cover: typeof raw.cover === 'string' ? raw.cover.trim() : '',
      // 歌词是**原文文本**：保留原样（换行、空行都有意义，trim 会把末尾换行吃掉也无妨，
      // 但中间一个字都不能动 —— 那是歌词）
      lyrics: typeof raw.lyrics === 'string' ? raw.lyrics : '',
      builtin: false,
    })
  }
  return tracks
}

/**
 * 【页面唯一该用的入口】接口数据 → 真正要渲染的曲目数组。
 *
 * 规则：能归一化出至少一首就用接口的；否则（接口失败 / 返回非数组 / 空数组 /
 * 全是没音源的脏数据）**回落成内置那一首**（长度恰好 1）。
 * 于是"列表永远至少有一行、永远有东西可放"这件事由这一行保证，
 * 页面里不需要再判"列表是不是空的"。
 */
export const resolveMusicTracks = (data) => {
  const tracks = normalizeMusicList(data)
  return tracks.length ? tracks : [builtinTrack()]
}

/**
 * 取下标的曲目。**永远不会返回 undefined**。
 *
 * 【为什么必须夹一道】下标来自共享状态（可能是旧版本留下的、或者列表变短了之后的），
 *   越界返回 undefined 的后果是**播放器整个空掉**：`<audio src=undefined>` 不报错、
 *   但什么都不放，用户看到的是"音乐页坏了"。回落到第一首，最差只是"放的不是你想听的"。
 *
 * @param {Array} tracks 曲目数组（空数组也会被兜成内置那一首）
 * @param {number} index 下标
 */
export const trackAt = (tracks, index) => {
  const list = Array.isArray(tracks) && tracks.length ? tracks : [builtinTrack()]
  const i = Number(index)
  return Number.isInteger(i) && i >= 0 && i < list.length ? list[i] : list[0]
}

/**
 * 这首歌的歌词要不要用"内置歌词文件"回落？返回文件地址，不需要回落时返回空串。
 *
 * 【规则】只有**音源就是内置那一首**（`/media/bg-music.mp3`）时才回落 ——
 *   因为 `bg-music.lrc` 是那个音频文件的歌词。
 *   把它显示在别的歌下面是**错的歌词**，比"暂无歌词"糟得多。
 * 【为什么不是"内置标记"就够了】站长也可能在后台把同一首歌（bg-music.mp3）
 *   登记成一条数据库曲目，那时它照样应该用这个歌词文件。
 *
 * @param {{ lyrics?: string, url?: string }} track
 * @returns {string} 歌词文件地址（'' = 不用回落）
 */
export const lyricsFallbackUrl = (track) => {
  if (!track) return ''
  if (track.lyrics) return ''                      // 接口已经给了歌词原文，不需要文件
  return track.url === builtinMusicUrl() ? builtinLyricsUrl() : ''
}
