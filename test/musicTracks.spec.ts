// @vitest-environment node
// =====================================================================
// test/musicTracks.spec.ts
//
// 作用：守住「接口数据 → 播放器能用的曲目数组」这一段纯逻辑
//       （`app/utils/musicTracks.ts`）：归一化、兜底、越界保护、歌词文件回落的规则。
//
// 【为什么这一份用 node 环境】它们是纯函数（不碰 Vue、不碰网络、不碰 Nuxt 上下文），
//   不需要建一整个 Nuxt 应用（vitest.config.ts 里那条注释专门说了纯工具函数走 node 更快）。
//   `musicTracks.ts` 里那两行显式 import（`./media`）就是为了让它在任何环境里都能被引用。
//
// 【这一份守的是"接口怎么坏都不该把播放器带崩"】
//   后端还没做这个接口（此刻就是这样），所以"返回 null / 不是数组 / 空数组 / 脏数据"
//   这几种情况**一定**会发生。它们的共同要求是：**回落成内置那一首**，
//   而不是空列表 —— 背景音乐是次要功能，不该被一个接口带崩。
//   这一层是纯函数，正好可以在毫秒级的用例里把这四种输入全过一遍。
// =====================================================================

import { describe, expect, it } from 'vitest'
import {
  builtinTrack,
  builtinLyricsUrl,
  normalizeMusicList,
  resolveMusicTracks,
  lyricsFallbackUrl,
  trackAt,
} from '../app/utils/musicTracks'

/** 接口真实会返回的形状（照 `MusicVO` 抄的：artist/cover/lyrics 都可能是 null） */
const API_TRACKS = [
  { id: 7, title: '  第一首  ', artist: '甲', url: '/uploads/a.mp3', cover: '/uploads/a.png', lyrics: '[00:01.00]甲词', sort: 1, status: 1 },
  { id: 9, title: '第二首', artist: null, url: '/media/b.mp3', cover: null, lyrics: null, sort: 2, status: 1 },
  { id: 3, title: '第三首', url: 'https://cdn.example.com/c.mp3', artist: '丙', cover: 'https://cdn.example.com/c.png', lyrics: '', sort: 3, status: 1 },
]

describe('音乐曲目 · normalizeMusicList（接口数据 → 曲目）', () => {
  it('正常数组_should逐条映射，并把字段收拾成模板好用的形状', () => {
    const tracks = normalizeMusicList(API_TRACKS)

    expect(tracks).toHaveLength(3)
    expect(tracks[0]).toMatchObject({ id: 7, title: '第一首', artist: '甲', url: '/uploads/a.mp3', cover: '/uploads/a.png' })
    // 曲名两边的空格去掉（后台复制粘贴很容易带上）
    expect(tracks[0].title).toBe('第一首')
    // null 的字段统一成空串：模板里只需要判"空不空"，不用处理 null/undefined 两种
    expect(tracks[1].artist).toBe('')
    expect(tracks[1].cover).toBe('')
    expect(tracks[1].lyrics).toBe('')
    // 外链地址原样保留（不拼任何前缀）
    expect(tracks[2].url).toBe('https://cdn.example.com/c.mp3')
    expect(tracks[2].cover).toBe('https://cdn.example.com/c.png')
  })

  it('顺序_should与接口给的完全一致（**前端一次都不重排**）', () => {
    // 【这条守的是契约】后端按 `sort ASC, id ASC` 排好再返回。
    // 这里故意喂一个 sort/id 都乱序的数组：如果哪天有人在归一化里顺手排了一下，
    // 这条用例会红 —— 而排序规则一旦有两份，"后端改成置顶优先"时前端就会把它盖掉，
    // 页面上看起来一切正常（只是顺序不对，没人会当成 bug 报上来）。
    const shuffled = [
      { id: 30, title: 'C', url: '/c.mp3', sort: 3 },
      { id: 10, title: 'A', url: '/a.mp3', sort: 1 },
      { id: 20, title: 'B', url: '/b.mp3', sort: 2 },
    ]
    expect(normalizeMusicList(shuffled).map(t => t.title)).toEqual(['C', 'A', 'B'])
  })

  it('没有音源地址的脏数据_should跳过（留着就是一行点了没反应的按钮）', () => {
    const tracks = normalizeMusicList([
      { id: 1, title: '正常', url: '/a.mp3' },
      { id: 2, title: '没有 url' },
      { id: 3, title: 'url 不是字符串', url: 123 },
      { id: 4, title: 'url 是空白', url: '   ' },
      null,
      'not-an-object',
    ])

    expect(tracks.map(t => t.title)).toEqual(['正常'])
  })

  it('非数组输入_should返回空数组（调用方据此走兜底），绝不抛异常', () => {
    for (const bad of [null, undefined, 42, 'x', {}, { records: [] }, []]) {
      expect(() => normalizeMusicList(bad)).not.toThrow()
      expect(normalizeMusicList(bad)).toEqual([])
    }
  })

  it('歌词是原文文本_should原样保留（中间的字一个都不能动）', () => {
    const lyrics = '[ti:歌]\n\n[00:01.00]第一句\n[00:05.00]第二句'
    const [track] = normalizeMusicList([{ id: 1, title: 'T', url: '/a.mp3', lyrics }])

    expect(track.lyrics).toBe(lyrics)
  })
})

describe('音乐曲目 · resolveMusicTracks（兜底）', () => {
  it('接口有曲目_should用接口的', () => {
    const tracks = resolveMusicTracks(API_TRACKS)

    expect(tracks).toHaveLength(3)
    expect(tracks.every(t => t.builtin === false)).toBe(true)
  })

  it('接口失败 / 非数组 / 空数组 / 全是脏数据_should都回落成内置那一首（数量恰好 1）', () => {
    // 【这是产品要求】接口此刻还没做、站长也可能一首都没上传：
    //   这两种情况下播放器都要能用（放内置那一首），而不是空列表或者"读不到"。
    for (const data of [null, undefined, { code: 500 }, [], 'nope', [{ id: 1, title: '没有 url' }]]) {
      const tracks = resolveMusicTracks(data)
      expect(tracks).toHaveLength(1)
      expect(tracks[0].builtin).toBe(true)
      expect(tracks[0].title).toBe('背景音乐')
    }
  })
})

describe('音乐曲目 · builtinTrack', () => {
  it('内置那一首_should指向 static-media 里的真实文件，并且不编歌手', () => {
    const track = builtinTrack()

    expect(track.url).toBe('/media/bg-music.mp3')
    expect(track.cover).toBe('/media/cover-1.png')
    expect(track.title).toBe('背景音乐')
    // 【不许编歌手】文件里没有 TPE1，界面上就整行不渲染歌手（而不是"未知歌手"）
    expect(track.artist).toBe('')
    // 接口给的歌词原文它没有（它的歌词走 /media/bg-music.lrc 那个文件）
    expect(track.lyrics).toBe('')
  })
})

describe('音乐曲目 · trackAt（越界保护）', () => {
  const tracks = resolveMusicTracks(API_TRACKS)

  it('合法下标_should返回对应的那一首', () => {
    expect(trackAt(tracks, 1)).toBe(tracks[1])
  })

  it('越界 / 非法下标_should回落到第一首，而不是 undefined', () => {
    // 【为什么绝不允许 undefined】`<audio :src="undefined">` 不报错但什么都不放，
    //   用户看到的是"音乐页坏了"；回落到第一首最差只是"放的不是你想听的"。
    for (const bad of [3, 99, -1, 1.5, NaN, 'abc', null, undefined, {}]) {
      expect(trackAt(tracks, bad)).toBe(tracks[0])
    }
  })

  it('列表是空数组_should兜成内置那一首（永远有一首可放）', () => {
    expect(trackAt([], 0).builtin).toBe(true)
    expect(trackAt(null, 5).builtin).toBe(true)
  })
})

describe('音乐曲目 · lyricsFallbackUrl（歌词文件回落的规则）', () => {
  it('接口给了歌词原文_should不需要文件回落', () => {
    expect(lyricsFallbackUrl({ lyrics: '[00:01.00]x', url: '/media/bg-music.mp3' })).toBe('')
  })

  it('音源就是内置那一首（且没有歌词原文）_should回落到 /media/bg-music.lrc', () => {
    // 内置那首歌的歌词只有那个文件里有
    expect(lyricsFallbackUrl({ lyrics: '', url: '/media/bg-music.mp3' })).toBe(builtinLyricsUrl())
    expect(lyricsFallbackUrl({ lyrics: '', url: builtinTrack().url })).toBe('/media/bg-music.lrc')
    // 后台把同一首歌登记成一条数据库曲目时，它照样该用这个歌词文件（音源是同一个人）
    expect(lyricsFallbackUrl({ lyrics: null, url: '/media/bg-music.mp3' })).toBe('/media/bg-music.lrc')
  })

  it('别的歌没有歌词_should**不**回落（那个文件是别的歌的歌词）', () => {
    // 【这一条比"有没有回落"重要得多】把 bg-music.lrc 显示在另一首歌下面
    //   就是给用户看错的歌词 —— 比「暂无歌词」糟得多。
    expect(lyricsFallbackUrl({ lyrics: '', url: '/uploads/other.mp3' })).toBe('')
    expect(lyricsFallbackUrl({ lyrics: '', url: 'https://cdn.example.com/x.mp3' })).toBe('')
    expect(lyricsFallbackUrl(null)).toBe('')
  })
})
