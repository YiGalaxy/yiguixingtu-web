import { describe, it, expect } from 'vitest'

// =====================================================================
// 评论的纯规则（app/utils/comment.ts）
//
// 【为什么这些规则要单独抽出来测】
//   校验的错法全都是"看起来没事"：
//     · 长度上限写成 500 → 用户的长评论被静默截断（他不会知道自己的话少了一半）
//     · 邮箱正则写得比后端**更严** → 合法邮箱被前端挡在门外，而用户
//       **没有任何办法绕过前端**，只能换邮箱或者放弃评论
//     · 邮箱为空时发一个空串 → 库里存的是 ""，而"没填"应该是 null
//   这三条都不会报错、也不会在界面上留下痕迹，只能靠断言钉住。
//
// 【为什么是纯函数测试、不挂组件】规则本身与界面无关；
//   挂组件测的话，一个"上限写错了"的问题会被一堆渲染细节盖住。
// =====================================================================

/** 造一个长度正好为 n 的字符串（验证边界用） */
const repeat = (char, n) => char.repeat(n)

describe('评论 · 长度上限与状态常量', () => {
  it('上限_should与后端 CommentForm 的校验注解一致（50 / 100 / 1000）', () => {
    // 这三个数字必须和后端 @Size(max=...) 逐字对齐：
    // 前端比后端大 → 前端让填、后端拒了（白跑一次）；
    // 前端比后端小 → 用户明明能发的内容发不出去
    expect(COMMENT_LIMITS).toEqual({ nickname: 50, email: 100, content: 1000 })
  })

  it('上限对象_should被冻结（它是一份约定，被就地改掉会让校验悄悄失效）', () => {
    expect(Object.isFrozen(COMMENT_LIMITS)).toBe(true)
  })

  it('状态常量_should是 comment 表里那三个数字（0 待审核 / 1 已通过 / 2 已拒绝）', () => {
    expect(COMMENT_STATUS).toEqual({ PENDING: 0, APPROVED: 1, REJECTED: 2 })
    // 提示语里必须出现"审核"两个字：只写"提交成功"的话，
    // 用户会去上面的列表里找自己的评论，找不到就以为没发出去
    expect(COMMENT_PENDING_NOTICE).toContain('审核')
  })
})

describe('评论 · validateCommentForm', () => {
  /** 一份合法的表单，用例里只改需要测的那一项 */
  const good = { nickname: '路过的读者', email: 'reader@example.com', content: '写得很清楚，收藏了' }

  it('全部合法_should返回 null', () => {
    expect(validateCommentForm(good)).toBeNull()
  })

  it('什么都不传_should报昵称不能为空（不是抛异常）', () => {
    expect(validateCommentForm()).toEqual({ field: 'nickname', message: '昵称不能为空' })
    expect(validateCommentForm({}).field).toBe('nickname')
  })

  it('昵称只有空格_should当成没填（后端 @NotBlank 的语义）', () => {
    expect(validateCommentForm({ ...good, nickname: '   ' }).field).toBe('nickname')
  })

  it('昵称正好 50 字_should通过，51 字才拒（边界不能差一位）', () => {
    expect(validateCommentForm({ ...good, nickname: repeat('昵', 50) })).toBeNull()
    const over = validateCommentForm({ ...good, nickname: repeat('昵', 51) })
    expect(over.field).toBe('nickname')
    // 提示里要有具体数字，用户才知道要删多少
    expect(over.message).toContain('50')
  })

  it('昵称首尾带空格_should先 trim 再算长度（trim 后正好 50 字要通过）', () => {
    const padded = `  ${repeat('昵', 50)}  `
    expect(validateCommentForm({ ...good, nickname: padded })).toBeNull()
  })

  it('邮箱留空_should直接通过（它是选填的）', () => {
    expect(validateCommentForm({ ...good, email: '' })).toBeNull()
    expect(validateCommentForm({ ...good, email: undefined })).toBeNull()
    expect(validateCommentForm({ ...good, email: '   ' })).toBeNull()
  })

  it('邮箱没写 @_should拦下来', () => {
    expect(validateCommentForm({ ...good, email: 'reader.example.com' }).field).toBe('email')
  })

  it('邮箱只有 @_should拦下来（两侧都得有东西）', () => {
    expect(validateCommentForm({ ...good, email: '@example.com' }).field).toBe('email')
    expect(validateCommentForm({ ...good, email: 'reader@' }).field).toBe('email')
  })

  it('邮箱里有空格_should拦下来', () => {
    expect(validateCommentForm({ ...good, email: 're ader@example.com' }).field).toBe('email')
  })

  it('邮箱正好 100 字_should通过，101 字才拒', () => {
    // local part 撑到 100 字：a...a@b.com
    const local = repeat('a', 100 - '@b.com'.length)
    expect(validateCommentForm({ ...good, email: `${local}@b.com` })).toBeNull()
    expect(validateCommentForm({ ...good, email: `x${local}@b.com` }).field).toBe('email')
  })

  it('邮箱校验_should故意比后端松（宁可多一次往返，也不能把合法邮箱挡在门外）', () => {
    // 后端用的是 Jakarta @Email（规则很宽）。这几个在真实世界里都存在，
    // 前端如果写"必须带点、必须是常见后缀"那类严格正则，就会把它们挡掉 ——
    // 而用户完全没有办法绕过前端。所以这里的规则只拦"明显不是邮箱"的输入。
    for (const mail of ['a@b', 'reader+tag@example.com', '中文@example.com', "o'brien@example.com"]) {
      expect(validateCommentForm({ ...good, email: mail }), `不该拦下 ${mail}`).toBeNull()
    }
  })

  it('内容为空或只有空格_should拦下来', () => {
    expect(validateCommentForm({ ...good, content: '' }).field).toBe('content')
    expect(validateCommentForm({ ...good, content: '  \n ' }).field).toBe('content')
  })

  it('内容正好 1000 字_should通过，1001 字才拒', () => {
    expect(validateCommentForm({ ...good, content: repeat('字', 1000) })).toBeNull()
    const over = validateCommentForm({ ...good, content: repeat('字', 1001) })
    expect(over.field).toBe('content')
    expect(over.message).toContain('1000')
  })

  it('多处都不合法_should只返回第一个（昵称 → 邮箱 → 内容）', () => {
    // 表单只有一个提交按钮，用户一次只能改一处；一次列三条只会把提示区撑满
    expect(validateCommentForm({ nickname: '', email: 'bad', content: '' }).field).toBe('nickname')
    expect(validateCommentForm({ nickname: 'ok', email: 'bad', content: '' }).field).toBe('email')
  })

  it('字段类型是数字 / null_should也不抛异常', () => {
    expect(validateCommentForm({ nickname: 123, email: null, content: null }).field).toBe('nickname')
  })
})

describe('评论 · normalizeCommentForm（表单 → 请求体）', () => {
  it('邮箱没填_should【整条字段都不出现】而不是发一个空串', () => {
    const body = normalizeCommentForm({ nickname: '读者', email: '', content: '你好' }, 12)
    // 发空串的话后端会真的存一个 ""，而"没填"在数据上应该是 null
    expect(Object.keys(body)).not.toContain('email')
    expect(body).toEqual({ articleId: 12, nickname: '读者', content: '你好' })
  })

  it('邮箱填了_should trim 之后带上', () => {
    const body = normalizeCommentForm({ nickname: '读者', email: '  a@b.com  ', content: '你好' }, 12)
    expect(body.email).toBe('a@b.com')
  })

  it('昵称与内容_should都 trim 之后再发（前后端算的长度才会是同一个值）', () => {
    const body = normalizeCommentForm({ nickname: '  读者  ', email: '', content: '  你好  ' }, 12)
    expect(body.nickname).toBe('读者')
    expect(body.content).toBe('你好')
  })

  it('articleId 是字符串_should转成数字（后端按 Long 绑定）', () => {
    expect(normalizeCommentForm({ nickname: 'a', content: 'b' }, '12').articleId).toBe(12)
    expect(typeof normalizeCommentForm({ nickname: 'a', content: 'b' }, '12').articleId).toBe('number')
  })

  it('字段缺失或整个表单没传_should不抛异常', () => {
    expect(() => normalizeCommentForm(undefined, 12)).not.toThrow()
    expect(normalizeCommentForm({}, 12)).toEqual({ articleId: 12, nickname: '', content: '' })
  })

  it('邮箱只有空格_should也当成没填（不能发出一个全是空格的邮箱）', () => {
    expect(Object.keys(normalizeCommentForm({ nickname: 'a', email: '   ', content: 'b' }, 1)))
      .not.toContain('email')
  })
})

describe('评论 · normalizeCommentPage（接口返回 → 页面能用的形状）', () => {
  const okPage = { ok: true, data: { records: [{ id: 1 }], total: 3, pages: 1 } }

  it('正常返回_should原样取出 records 与 total', () => {
    expect(normalizeCommentPage(okPage)).toEqual({ records: [{ id: 1 }], total: 3 })
  })

  it('接口失败（ok:false）_should整成空列表 + 0，而不是把异常抛给页面', () => {
    expect(normalizeCommentPage({ ok: false, code: 500 })).toEqual({ records: [], total: 0 })
  })

  it('data 是 null / response 本身是 undefined_should都不崩', () => {
    expect(normalizeCommentPage({ ok: true, data: null })).toEqual({ records: [], total: 0 })
    expect(normalizeCommentPage(undefined)).toEqual({ records: [], total: 0 })
  })

  it('records 不是数组_should当成空列表（v-for 拿到对象会直接崩掉整个评论区）', () => {
    expect(normalizeCommentPage({ ok: true, data: { records: null, total: 5 } }).records).toEqual([])
    expect(normalizeCommentPage({ ok: true, data: { records: { a: 1 } } }).records).toEqual([])
  })

  it('total 缺失 / 不是数字 / 负数_should都收成 0', () => {
    // total 只用来判断"还有没有下一页"，兜成 0 的后果是按钮不出现，
    // 而不是无限翻页（那会把后端一直打下去）
    for (const total of [undefined, null, 'abc', NaN, -3, {}]) {
      expect(normalizeCommentPage({ ok: true, data: { records: [], total } }).total).toBe(0)
    }
  })

  it('total 是数字字符串_should照样能用来判断分页', () => {
    expect(normalizeCommentPage({ ok: true, data: { records: [], total: '12' } }).total).toBe(12)
  })
})
