// ============================================================
// app/utils/comment.ts
// 作用：评论区那些"纯规则"——长度上限、校验、以及提交前把表单整成请求体。
//       抽成纯函数是为了能脱离页面直接断言（见 test/comment.nuxt.spec.ts）：
//       校验这种东西的错法全是"看起来没事"——上限写成 500 会静默截断用户的
//       长评论，邮箱正则写太严会把合法邮箱挡在门外（用户完全没法绕过）。
//
// 【为什么上限要写在这里、而不是散在模板里】
//   这些数字必须和后端的校验注解**逐字对齐**（CommentForm 里的
//   @Size(max=50) 昵称、@Size(max=1000) 内容、@Size(max=100) 邮箱）。
//   分散在 maxlength="50" 这种地方的话，改了一处漏一处：表现为
//   "前端让填、后端拒了"，或者更糟——"前端截断了、用户不知道自己的话被切掉了"。
//
// 关键词：
//   · 纯函数 = 同样的输入永远得到同样的输出，不依赖网络/时间/DOM
//   · 首尾空白 trim = 去掉字符串两端的空格与换行，中间的保留
// ============================================================

/**
 * 与后端 CommentForm 的校验注解一一对应的上限。
 * 【为什么导出成一个对象而不是三个常量】调用方（页面）需要同时用它们来设
 * `maxlength`，一个对象更好整体传递与断言。
 */
export const COMMENT_LIMITS = Object.freeze({
  nickname: 50,
  email: 100,
  content: 1000,
})

/**
 * 评论状态：0 待审核 / 1 已通过 / 2 已拒绝（与 comment 表里的取值一致）。
 * 【为什么前端也要这三个常量】前台列表接口只会返回"已通过"，
 * 但【提交】接口返回的那条 status 是 0 —— 正是靠它，前端才能说出
 * "评论已提交，等待审核"这句话。写死成数字的话，读代码的人得回去翻后端。
 */
export const COMMENT_STATUS = Object.freeze({
  PENDING: 0,
  APPROVED: 1,
  REJECTED: 2,
})

/** 提交成功后的提示语（页面与用例共用同一份文案，避免两处各写一句） */
export const COMMENT_PENDING_NOTICE = '评论已提交，等待审核'

/**
 * 邮箱的**宽松**校验：只要有 @、两侧都非空、且不含空白字符就算通过。
 *
 * 【为什么故意比后端松 —— 这是有意的取舍】
 *   · 后端用的是 Jakarta Validation 的 @Email（Hibernate 的实现），规则很宽，
 *     而且只有"填了"的时候才校验。
 *   · 前端如果写一个更严的正则（比如必须带点、必须像 xxx@yyy.zzz），
 *     就会把后端本来接受的地址挡在门外 —— 而用户**没有任何办法绕过前端**，
 *     只能换一个邮箱或者放弃评论。这种"我比你严"的错误是单向的、且无法自救的。
 *   · 反过来，前端松一点最坏的结果只是"多一次往返 + 后端返回一句
 *     「邮箱格式不正确」" —— 用户看得见、改得动。
 *   结论：**权限交给后端**，前端只拦最明显的错误（写了中文、漏了 @、带空格）。
 */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/

/**
 * 校验评论表单，返回第一个问题；没问题时返回 null。
 *
 * 【为什么返回"第一个"而不是一个错误数组】
 *   表单只有一个提交按钮，用户一次只能改一处；一次列五个错只会把提示区撑满。
 *   所以按"昵称 → 邮箱 → 内容"的顺序返回最先遇到的那个。
 *
 * @returns {{field: 'nickname'|'email'|'content', message: string}|null}
 */
export const validateCommentForm = ({ nickname, email, content } = {}) => {
  // 【昵称】trim 之后再判：只敲了几个空格也算没填（后端 @NotBlank 的语义）
  const nick = typeof nickname === 'string' ? nickname.trim() : ''
  if (!nick) return { field: 'nickname', message: '昵称不能为空' }
  if (nick.length > COMMENT_LIMITS.nickname) {
    return { field: 'nickname', message: `昵称最长 ${COMMENT_LIMITS.nickname} 字` }
  }

  // 【邮箱】选填：留空直接跳过，只有填了才校验（和后端 @Email 只作用于非空值一致）
  const mail = typeof email === 'string' ? email.trim() : ''
  if (mail) {
    if (mail.length > COMMENT_LIMITS.email) {
      return { field: 'email', message: `邮箱最长 ${COMMENT_LIMITS.email} 字` }
    }
    if (!EMAIL_PATTERN.test(mail)) {
      return { field: 'email', message: '邮箱格式不正确' }
    }
  }

  // 【内容】同样先 trim：全是空格的评论没有任何意义，而后端 @NotBlank 也会拒
  const text = typeof content === 'string' ? content.trim() : ''
  if (!text) return { field: 'content', message: '评论内容不能为空' }
  if (text.length > COMMENT_LIMITS.content) {
    return { field: 'content', message: `评论最长 ${COMMENT_LIMITS.content} 字` }
  }

  return null
}

/**
 * 表单 → 发往 `POST /comment` 的请求体。
 *
 * 【为什么邮箱为空时要整条字段去掉，而不是发一个空串】
 *   后端的 @Email 只在"填了"的时候才校验，但一个空的 email 会被当成"填了空值"
 *   走到转义与入库那一步 —— 库里就会存一个空字符串，而"没填"和"填了个空串"
 *   在数据上是两回事（前者是 null）。所以这里显式不带这个字段。
 *
 * 【为什么昵称与内容要 trim 之后再发】
 *   后端也会 trim，但前端先 trim 能让"长度校验"与"真正提交的值"是同一个值 ——
 *   否则会出现"前端说正好 1000 字通过、后端 trim 后也通过"这种巧合，
 *   一旦有人把前端的校验去掉，就会变成"两边算的长度不一样"。
 *
 * @param {{nickname:string,email:string,content:string}} form 表单值
 * @param {number|string} articleId 文章 id（评论必须挂在某篇文章下）
 */
export const normalizeCommentForm = (form = {}, articleId) => {
  const payload = {
    articleId: Number(articleId),
    nickname: String(form.nickname ?? '').trim(),
    content: String(form.content ?? '').trim(),
  }

  const mail = String(form.email ?? '').trim()
  if (mail) payload.email = mail

  return payload
}

/**
 * 把 `GET /comment/list` 的返回整成页面能直接用的形状。
 *
 * 【为什么要兜一道】评论列表会被 v-for 用到，接口挂了 / 结构变了
 * （比如后端把 records 改名）时直接读 `data.records` 会抛错，
 * 而这条错误会把整个评论区打挂。兜成"空列表 + 总数 0"最差只是没评论可看。
 *
 * @returns {{records: Array, total: number}}
 */
export const normalizeCommentPage = (response) => {
  const data = response?.ok ? response.data : null
  return {
    records: Array.isArray(data?.records) ? data.records : [],
    // total 缺失或不是数字时当成 0：它只用来判断"还有没有下一页"，
    // 兜成 0 的后果是"加载更多"按钮不出现，而不是无限翻页
    total: Number(data?.total) > 0 ? Number(data.total) : 0,
  }
}
