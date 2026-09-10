import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// =====================================================================
// useArticleFilter 的单元测试
//
// 【这个 composable 为什么值得测】
//   它管的是首页的筛选条件，出错的表现全都是「看起来正常、其实不对」：
//     · 防抖写错 → 每敲一个字发一次请求（后端对 /article/page 有 300 次/分钟限流）
//     · 双向同步只做一个方向 → 地址栏和输入框各说各话，后退像失灵
//     · 空值照写 → 地址栏出现 ?keyword=&categoryId=，历史记录里全是废地址
//     · 漏掉 tagId → 标签筛了却不生效（或者换了标签还显示上一批文章）
//   这些都是界面上不容易一眼看出来的，用断言钉住最省事。
//
// 【标签这一批用例守的是"它真的并进了同一套同步机制"】
//   如果谁为了图省事给标签另写一个 ref + watch + router.replace，
//   上面那三条（防抖、双向同步、空值不写）在标签这一维度上就全都没有了：
//   比如"后退之后标签高亮还亮着、列表却已经是别的了"。所以这里对 tagId
//   重复了分类那一套边界断言 —— 重复本身就是在守住"两套逻辑不许分家"。
//
// 【怎么测的：注入依赖，不 mock Nuxt】
//   createArticleFilter() 把「读 query」「写 query」做成了参数，
//   所以这里可以注入一个 ref + 一个 spy，直接在 Node 里跑，
//   不需要 mock 路由、也不需要挂载组件。
//
//   ⚠️【踩过的坑，写下来】最初想用 mockNuxtImport('useRouter') 直接换掉路由器，
//   结果整个测试文件起不来：
//       TypeError: router.beforeResolve is not a function
//         at node_modules/nuxt/dist/app/plugins/navigation-repaint.client.js:8
//   原因：mockNuxtImport 换的是 Nuxt 的【自动导入】本身，
//   Nuxt 自己的内部插件（navigation-repaint）也会 useRouter()，
//   于是它拿到了这个只有 replace 的假对象，在 onNuxtReady 时调用 beforeResolve 就炸了。
//   把「读写 URL」做成注入点之后，这条路完全不需要走。
//
// 【时间怎么控】防抖是时间相关逻辑，用 vi.useFakeTimers() 把时钟捏在手里，
//   断言「299ms 时不写、300ms 时写」这种边界；真实等待 300ms 会让用例又慢又飘。
// =====================================================================

/**
 * 造一个被测实例：query 用一个 ref 模拟（外部改动它就等于地址栏变了），
 * replaceUrl 用 spy 模拟。
 *
 * 【为什么 replaceUrl 除了记录调用，还要真的改 queryRef —— 这次踩到的坑】
 *   真实的 router.replace() 会把地址栏改成新值，下一次调用时
 *   createArticleFilter 读到的 querySource 就是【已经更新过的】那份。
 *   最初这里只写 `vi.fn()`（不更新 ref），于是"再点一次已选中的标签 = 取消"
 *   这条用例挂了：第二次点标签时被问到的地址栏还是初始的 {}，
 *   内部的"地址栏已经等于目标值就不写"判断命中，取消操作被静默吞掉。
 *   这是**测试台不真实**造成的假失败 —— 真实浏览器里地址栏早就变了。
 *   所以现在让 spy 顺手把新 query 写回 queryRef，和 router.replace 一致。
 *   （它同时也让"连续两次操作"这类用例测的是真实行为，而不是过期快照。）
 *
 * 【为什么用 effectScope 包一层】
 *   createArticleFilter 内部有 watch 和 onScopeDispose —— 它们都需要一个
 *   「当前作用域」，直接裸调用 Vue 会警告「no active effect scope」，
 *   而且用例跑完 watch 也不会被回收，互相污染。
 *   effectScope 就是 Vue 给「组件之外的一坨响应式逻辑」准备的作用域容器。
 */
const setup = (options = {}) => {
  const queryRef = ref(options.query || {})
  // 记录每一次写入（断言用），同时把值写回 queryRef（模拟真的改地址栏）
  const replaceUrl = vi.fn((next) => { queryRef.value = next })
  const scope = effectScope()

  const filter = scope.run(() => createArticleFilter({
    // 这里用「函数」而不是直接给 ref，顺带把 MaybeRefOrGetter 里 getter 那条路也跑通
    querySource: () => queryRef.value,
    replaceUrl,
    debounceMs: options.debounceMs,
  }))

  return { queryRef, replaceUrl, filter, scope }
}

/** 让 watch 的回调先跑一遍（Vue 的 watch 是异步 flush 的） */
const flush = async () => { await nextTick() }

describe('useArticleFilter', () => {
  // ---------------------------------------------------------------
  // 一、纯函数：地址栏 ⇄ 状态 ⇄ 后端参数
  // ---------------------------------------------------------------
  describe('parseArticleFilter（地址栏 → 状态）', () => {
    it('没有参数_should得到空条件', () => {
      expect(parseArticleFilter({})).toEqual({ keyword: '', categoryId: null, tagId: null })
    })

    it('query 整个是 undefined_should不崩（首次渲染时 route.query 可能是空的）', () => {
      expect(parseArticleFilter(undefined)).toEqual({ keyword: '', categoryId: null, tagId: null })
    })

    it('正常参数_should解析出关键词、分类与标签', () => {
      expect(parseArticleFilter({ keyword: 'nuxt', categoryId: '2' }))
        .toEqual({ keyword: 'nuxt', categoryId: 2, tagId: null })
      // 三个条件可以同时出现（后端按 AND 叠加）
      expect(parseArticleFilter({ keyword: 'nuxt', categoryId: '2', tagId: '7' }))
        .toEqual({ keyword: 'nuxt', categoryId: 2, tagId: 7 })
    })

    it('关键词首尾有空格_should去掉（否则和没空格的会被当成两个不同的条件）', () => {
      expect(parseArticleFilter({ keyword: '  nuxt  ' }).keyword).toBe('nuxt')
    })

    it('分类ID 是非法值_should当成没选分类而不是崩掉', () => {
      // categoryId 用户可以随手改地址栏，传 'abc' 下去后端解析 Long 会 400
      for (const bad of ['abc', '0', '-1', '1.5', '', '  ']) {
        expect(parseArticleFilter({ categoryId: bad }).categoryId).toBeNull()
      }
    })

    it('标签ID 是非法值_should当成没选标签而不是崩掉', () => {
      // 和 categoryId 完全同一套规则：tagId 也是地址栏里可以随手改的正整数
      for (const bad of ['abc', '0', '-1', '1.5', '', '  ', 'null', 'NaN']) {
        expect(parseArticleFilter({ tagId: bad }).tagId).toBeNull()
      }
    })

    it('同一个键出现两次（?keyword=a&keyword=b）_should取第一个而不是把数组漏下去', () => {
      expect(parseArticleFilter({ keyword: ['a', 'b'] }).keyword).toBe('a')
      expect(parseArticleFilter({ categoryId: ['3', '4'] }).categoryId).toBe(3)
      expect(parseArticleFilter({ tagId: ['5', '6'] }).tagId).toBe(5)
    })
  })

  describe('toArticleQuery（状态 → 地址栏）', () => {
    it('没有筛选条件_should不写任何参数（别出现 ?keyword=&categoryId=&tagId=）', () => {
      expect(toArticleQuery({ keyword: '', categoryId: null, tagId: null })).toEqual({})
    })

    it('关键词与分类都在_should都写进去且分类是字符串', () => {
      expect(toArticleQuery({ keyword: 'nuxt', categoryId: 2 }))
        .toEqual({ keyword: 'nuxt', categoryId: '2' })
    })

    it('只有分类_should只写 categoryId', () => {
      expect(toArticleQuery({ keyword: '', categoryId: 3 })).toEqual({ categoryId: '3' })
    })

    it('只有标签_should只写 tagId，而且必须是字符串', () => {
      // route.query 的值只有 string / string[]，写数字进去 vue-router 也会转成字符串；
      // 这里显式转，免得测试断言和真实地址栏对不上
      expect(toArticleQuery({ keyword: '', categoryId: null, tagId: 7 })).toEqual({ tagId: '7' })
    })

    it('三个条件都在_should一起写进地址栏（缺一个就是"筛了却不生效"）', () => {
      expect(toArticleQuery({ keyword: 'nuxt', categoryId: 2, tagId: 7 }))
        .toEqual({ keyword: 'nuxt', categoryId: '2', tagId: '7' })
    })

    it('关键词带空格_should先 trim 再写', () => {
      expect(toArticleQuery({ keyword: '  nuxt ', categoryId: null })).toEqual({ keyword: 'nuxt' })
    })
  })

  describe('toArticleParams（状态 → 后端 /article/page 的参数）', () => {
    it('没有筛选条件_should只带分页参数', () => {
      expect(toArticleParams({ keyword: '', categoryId: null, tagId: null, page: 1, size: 12 }))
        .toEqual({ page: 1, size: 12 })
    })

    it('有筛选条件_should带上 keyword 与数字类型的 categoryId', () => {
      const params = toArticleParams({ keyword: 'nuxt', categoryId: 2, page: 2, size: 12 })
      expect(params).toEqual({ page: 2, size: 12, keyword: 'nuxt', categoryId: 2 })
      // 必须是数字：$fetch 会序列化成 ?categoryId=2，后端按 Long 绑定
      expect(typeof params.categoryId).toBe('number')
    })

    it('选了标签_should把 tagId 作为数字发给后端（后端按 Long 绑定）', () => {
      const params = toArticleParams({ keyword: '', categoryId: null, tagId: 7, page: 1, size: 12 })
      expect(params).toEqual({ page: 1, size: 12, tagId: 7 })
      expect(typeof params.tagId).toBe('number')
    })

    it('关键词只有空格_should不发 keyword（等价于没筛，别让后端多走一次 LIKE）', () => {
      expect(toArticleParams({ keyword: '   ', categoryId: null, page: 1, size: 12 }))
        .toEqual({ page: 1, size: 12 })
    })
  })

  // ---------------------------------------------------------------
  // 二、防抖 + 双向同步
  // ---------------------------------------------------------------
  describe('createArticleFilter（防抖与 URL 同步）', () => {
    beforeEach(() => { vi.useFakeTimers() })
    afterEach(() => { vi.useRealTimers() })

    it('打开带参数的地址（刷新/别人分享的链接）_should从地址栏恢复筛选状态', () => {
      const { filter } = setup({ query: { keyword: 'nuxt', categoryId: '2', tagId: '7' } })

      // 输入框与"生效中"的关键词都要恢复，否则输入框是空的、请求却带着条件
      expect(filter.keywordInput.value).toBe('nuxt')
      expect(filter.keyword.value).toBe('nuxt')
      expect(filter.categoryId.value).toBe(2)
      expect(filter.tagId.value).toBe(7)
      expect(filter.isFiltered.value).toBe(true)
    })

    it('刷新带标签的地址_should只恢复标签（标签自己也算"有筛选"）', async () => {
      const { filter, replaceUrl } = setup({ query: { tagId: '7' } })
      await flush()

      expect(filter.tagId.value).toBe(7)
      expect(filter.categoryId.value).toBeNull()
      // 恢复出来的状态和地址栏本来就一致，不该再反向写一次
      expect(replaceUrl).not.toHaveBeenCalled()
    })

    it('刚挂载时_should不主动改地址栏（恢复出来的状态和地址栏本来就是一致的）', async () => {
      const { filter, replaceUrl } = setup({ query: { keyword: 'nuxt' } })
      await flush()
      await vi.advanceTimersByTimeAsync(1000)

      expect(filter.keyword.value).toBe('nuxt')
      expect(replaceUrl).not.toHaveBeenCalled()
    })

    it('输入关键词_should在防抖到点之前【既不写地址栏也不生效】（299ms 时还没生效）', async () => {
      const { filter, replaceUrl } = setup()

      filter.keywordInput.value = 'nu'
      await flush()

      // 输入框是即时的（打字不能卡），但"生效中"的关键词还没动
      expect(filter.keywordInput.value).toBe('nu')
      await vi.advanceTimersByTimeAsync(299)
      expect(filter.keyword.value).toBe('')
      expect(replaceUrl).not.toHaveBeenCalled()
    })

    it('输入关键词停下 300ms_should生效并写进地址栏', async () => {
      const { filter, replaceUrl } = setup()

      filter.keywordInput.value = 'nu'
      await flush()
      await vi.advanceTimersByTimeAsync(300)

      expect(filter.keyword.value).toBe('nu')
      expect(filter.isFiltered.value).toBe(true)
      expect(replaceUrl).toHaveBeenCalledTimes(1)
      expect(replaceUrl).toHaveBeenCalledWith({ keyword: 'nu' })
    })

    it('连续输入_should只让最后一次生效（前面几次的定时器都要被清掉）', async () => {
      const { filter, replaceUrl } = setup()

      filter.keywordInput.value = 'n'
      await flush()
      await vi.advanceTimersByTimeAsync(100)
      filter.keywordInput.value = 'nu'
      await flush()
      await vi.advanceTimersByTimeAsync(100)
      filter.keywordInput.value = 'nux'
      await flush()
      await vi.advanceTimersByTimeAsync(300)

      expect(filter.keyword.value).toBe('nux')
      expect(replaceUrl).toHaveBeenCalledTimes(1)
      expect(replaceUrl).toHaveBeenCalledWith({ keyword: 'nux' })
    })

    it('关键词首尾带空格_should先 trim 再生效，别让地址栏出现 %20', async () => {
      const { filter, replaceUrl } = setup()

      filter.keywordInput.value = '  nuxt  '
      await flush()
      await vi.advanceTimersByTimeAsync(300)

      expect(filter.keyword.value).toBe('nuxt')
      expect(replaceUrl).toHaveBeenCalledWith({ keyword: 'nuxt' })
    })

    it('按回车_should立刻生效，不等防抖', async () => {
      const { filter, replaceUrl } = setup()

      filter.keywordInput.value = 'nuxt'
      await flush()
      filter.applyKeywordNow()
      await flush()

      expect(filter.keyword.value).toBe('nuxt')
      expect(replaceUrl).toHaveBeenCalledWith({ keyword: 'nuxt' })
    })

    it('点分类_should立刻写地址栏（分类是离散操作，不需要防抖）', async () => {
      const { filter, replaceUrl } = setup()

      filter.selectCategory(2)
      await flush()

      expect(replaceUrl).toHaveBeenCalledTimes(1)
      expect(replaceUrl).toHaveBeenCalledWith({ categoryId: '2' })
    })

    it('刚打完字防抖还没到点_should点分类时把关键词一起落地（一次写入、一次请求）', async () => {
      const { filter, replaceUrl } = setup()

      // 模拟"输完 100ms 就立刻点了分类"：关键词的定时器还在等
      filter.keywordInput.value = 'nuxt'
      await flush()
      await vi.advanceTimersByTimeAsync(100)

      filter.selectCategory(2)
      await flush()

      // 两个条件必须【同一次】写进去：先按旧关键词拉一遍、300ms 后再拉一遍，
      // 用户会看到列表闪一下并多一次网络请求
      expect(filter.keyword.value).toBe('nuxt')
      expect(replaceUrl).toHaveBeenCalledTimes(1)
      expect(replaceUrl).toHaveBeenCalledWith({ keyword: 'nuxt', categoryId: '2' })
    })

    // ---------------------------------------------------------------
    // 标签：并进同一套同步机制之后，下面这几条和分类那几条是【对称】的
    // ---------------------------------------------------------------

    it('点标签_should立刻写地址栏（离散操作，不需要防抖）', async () => {
      const { filter, replaceUrl } = setup()

      filter.selectTag(7)
      await flush()

      expect(filter.tagId.value).toBe(7)
      expect(filter.isFiltered.value).toBe(true)
      expect(replaceUrl).toHaveBeenCalledTimes(1)
      expect(replaceUrl).toHaveBeenCalledWith({ tagId: '7' })
    })

    it('刚打完字防抖还没到点_should点标签时也把关键词一起落地（和点分类同一套）', async () => {
      const { filter, replaceUrl } = setup()

      filter.keywordInput.value = 'nuxt'
      await flush()
      await vi.advanceTimersByTimeAsync(100)

      filter.selectTag(7)
      await flush()

      expect(filter.keyword.value).toBe('nuxt')
      expect(replaceUrl).toHaveBeenCalledTimes(1)
      expect(replaceUrl).toHaveBeenCalledWith({ keyword: 'nuxt', tagId: '7' })
    })

    it('标签与分类叠加_should两个条件同时留在地址栏（后端按 AND 过滤）', async () => {
      const { filter, replaceUrl } = setup()

      filter.selectCategory(2)
      await flush()
      filter.selectTag(7)
      await flush()

      expect(replaceUrl).toHaveBeenLastCalledWith({ categoryId: '2', tagId: '7' })
    })

    it('再点一次已选中的标签_should取消标签筛选（标签条上没有「全部」按钮）', async () => {
      const { filter, replaceUrl } = setup()

      filter.selectTag(7)
      await flush()
      filter.selectTag(7)
      await flush()

      expect(filter.tagId.value).toBeNull()
      expect(filter.isFiltered.value).toBe(false)
      expect(replaceUrl).toHaveBeenLastCalledWith({})
    })

    it('点另一个标签_should直接换过去，不是叠加成两个标签', async () => {
      const { filter, replaceUrl } = setup()

      filter.selectTag(7)
      await flush()
      filter.selectTag(9)
      await flush()

      // 后端 /article/page 的 tagId 是【单个】Long，不是一个 id 列表
      // （一个标签页=点一个标签看一批文章），所以后点的那个要覆盖前一个
      expect(filter.tagId.value).toBe(9)
      expect(replaceUrl).toHaveBeenLastCalledWith({ tagId: '9' })
    })

    it('重复点同一个标签两次（一次选中一次取消）_should只写两次地址栏，不多写', async () => {
      const { filter, replaceUrl } = setup({ query: { tagId: '7' } })

      filter.selectTag(7)
      await flush()

      expect(filter.tagId.value).toBeNull()
      expect(replaceUrl).toHaveBeenCalledTimes(1)
    })

    it('清除筛选_should把三个参数一起从地址栏去掉', async () => {
      const { filter, replaceUrl } = setup({ query: { keyword: 'nuxt', categoryId: '2', tagId: '7' } })

      filter.clearAll()
      await flush()

      expect(filter.keywordInput.value).toBe('')
      expect(filter.keyword.value).toBe('')
      expect(filter.categoryId.value).toBeNull()
      expect(filter.tagId.value).toBeNull()
      expect(filter.isFiltered.value).toBe(false)
      expect(replaceUrl).toHaveBeenLastCalledWith({})
    })

    it('清除筛选后_should清掉还在等的新关键词定时器（不然 300ms 后又自己搜起来了）', async () => {
      const { filter, replaceUrl } = setup()

      filter.keywordInput.value = 'nuxt'
      await flush()
      await vi.advanceTimersByTimeAsync(100)

      filter.clearAll()
      await flush()
      await vi.advanceTimersByTimeAsync(1000)

      // 清完之后既不能生效，也不能偷偷把"nuxt"写进地址栏
      expect(filter.keyword.value).toBe('')
      expect(filter.keywordInput.value).toBe('')
      expect(replaceUrl).not.toHaveBeenCalled()
    })

    it('重复点同一个分类_should只写一次地址栏', async () => {
      const { filter, replaceUrl } = setup()

      filter.selectCategory(2)
      await flush()
      filter.selectCategory(2)
      await flush()

      expect(replaceUrl).toHaveBeenCalledTimes(1)
    })

    it('输入框里的字被打成和已生效的一样_should不产生多余的写入', async () => {
      const { filter, replaceUrl } = setup({ query: { keyword: 'nuxt' } })

      filter.keywordInput.value = ' nuxt '
      await flush()
      await vi.advanceTimersByTimeAsync(300)

      // trim 之后和生效中的值相同 → keyword 没变 → 地址栏不必再写一次
      expect(filter.keywordInput.value).toBe('nuxt')
      expect(replaceUrl).not.toHaveBeenCalled()
    })

    it('地址栏被外部改掉（浏览器后退）_should同步回状态，并且不再反向写一次', async () => {
      const { queryRef, filter, replaceUrl } = setup({ query: { keyword: 'nuxt', categoryId: '2', tagId: '7' } })

      queryRef.value = { keyword: '', categoryId: '3' }
      await flush()
      await vi.advanceTimersByTimeAsync(300)

      expect(filter.keyword.value).toBe('')
      expect(filter.keywordInput.value).toBe('')
      expect(filter.categoryId.value).toBe(3)
      // 【标签尤其容易漏】后退之后地址栏里已经没有 tagId 了，
      // 状态里要是还留着 7，胶囊会继续亮着、而列表已经是"分类 3"那批 ——
      // 用户看到的是"高亮的标签和列表对不上"，却找不到原因
      expect(filter.tagId.value).toBeNull()
      // 关键：后退之后不能再往前写一次，否则用户会感觉"退不回去"
      expect(replaceUrl).not.toHaveBeenCalled()
    })

    it('组件卸载后_should清掉还没触发的定时器（别往已销毁的组件上写状态）', async () => {
      const { filter, replaceUrl, scope } = setup()

      filter.keywordInput.value = 'nuxt'
      await flush()
      scope.stop()

      await vi.advanceTimersByTimeAsync(1000)
      expect(replaceUrl).not.toHaveBeenCalled()
    })
  })
})
