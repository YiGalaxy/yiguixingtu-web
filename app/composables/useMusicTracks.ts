// ============================================================
// app/composables/useMusicTracks.ts
//
// 作用：**曲目列表的唯一一份来源** —— 音乐页的曲目列表、首页那张迷你卡片上的曲名、
//       外壳里那个 `<audio>` 的音源地址，用的都是这里这一份。
//
// 【数据从哪来】`GET /music/list`（公开接口，不分页，只返回 status = 1，
//   顺序就是后端给的 `sort ASC, id ASC`）。曲目由**后台上传**，前台不再写死任何歌。
//
// 【为什么用 useAsyncData，而不是 onMounted 里发请求 —— 这条最要紧】
//   和 `useCategoryList` 完全同一个理由：useAsyncData 在**服务端渲染时就会去取**
//   （内部注册 onServerPrefetch），服务端要把数据拿完才输出 HTML。于是：
//     · 音乐页首屏的 HTML 里**就有曲目列表**，不是"先空一下再刷出来"
//     · 首页那张卡片上的曲名也在 HTML 里（对内容页来说这是最差的观感问题）
//   留在 onMounted 里的话，爬虫拿到的是一个没有曲目的空壳。
//
// 【为什么外壳（app.vue）也调它，而不是只有音乐页调】
//   外壳要拿"当前这一首的 url"去设置 `<audio src>`，首页卡片要拿"当前曲名"——
//   它们和音乐页必须是**同一份**数据。同 key 的 useAsyncData 就是同一份，
//   所以外壳 + 页面一起调也只打一次接口（这正是下面 getCachedData 那段要解决的）。
//
// 【关键：接口挂了也不能让播放器崩】
//   归一化与兜底都在 `app/utils/musicTracks.ts` 里（纯函数，有单测）：
//   接口失败 / 返回非数组 / 空数组 → 回落成**内置那一首**（`static-media/bg-music.mp3`），
//   于是"列表永远至少有一行、播放器永远有东西可放"。背景音乐是次要功能，
//   它不该被一个接口带着一起崩 —— 这条是产品要求，有用例钉着。
// ============================================================
export const useMusicTracks = () => {
  const { request } = useApi()

  const asyncData = useAsyncData('music-tracks', async () => {
    const res = await request('/music/list')
    // 失败时传 `null` 进去（而不是抛）：`resolveMusicTracks` 会把它兜成内置那一首，
    // 页面因此永远有东西可渲染。抛出去只会变成一张错误页。
    // 【归一化与兜底都在这一个纯函数里】这样它们能被 node 环境的单测直接覆盖
    // （见 test/musicTracks.spec.ts），而不用挂载页面。
    return res.ok ? resolveMusicTracks(res.data) : resolveMusicTracks(null)
  }, {
    // Reuse data within an SSR request and during hydration; refreshes fetch anew.
    getCachedData: (key, nuxtApp, ctx) => {
      if (ctx?.cause === 'refresh:manual' || ctx?.cause === 'refresh:hook') return undefined
      // Hydration must reuse SSR data; later page mounts fetch the current list.
      if (import.meta.client && !nuxtApp.isHydrating) return undefined
      return nuxtApp.payload.data[key] ?? nuxtApp.static.data[key]
    },
  })

  /**
   * 界面上真正要渲染的曲目。
   * 正常情况下这就是接口给的（或兜底后的）那一份；这里的判空是**防御性**的一层：
   * 数据还没到手（SSR 之前、客户端首次渲染）时 payload 里是 null，
   * 那时也要能渲染出内置那一首，而不是一个空列表。
   */
  const tracks = computed(() => (Array.isArray(asyncData.data.value) && asyncData.data.value.length
    ? asyncData.data.value
    : [builtinTrack()]))

  /** 现在放的是第几首（共享状态里的下标，可能是旧值 → `trackAt` 会夹住） */
  const { trackIndex } = useBackgroundMusic()

  /** 当前曲目。**永远是一首真实的曲子**（越界时回落到第一首） */
  const currentTrack = computed(() => trackAt(tracks.value, trackIndex.value))

  /**
   * 当前曲目在列表里的行号。
   * 【为什么不直接用共享状态里的下标】那个下标可能是旧的（列表换了、变短了），
   *   直接比会造成"播着第一首、列表里一行都没高亮"。这里按**对象身份**回到行号，
   *   永远落在真实存在的一行上。
   */
  const activeIndex = computed(() => {
    const index = tracks.value.indexOf(currentTrack.value)
    return index >= 0 ? index : 0
  })

  return { tracks, currentTrack, activeIndex, ready: asyncData }
}
