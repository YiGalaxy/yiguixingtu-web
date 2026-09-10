// ============================================================
// app/utils/apiError.ts
//
// 作用：把后端"限流 / 重复提交"这两件事的**判断依据与提示文案**集中在一处，
//       给 useApi（统一请求封装）和 useAuth（登录）共用。
//
// 【为什么必须把这两件事分开 —— 它们是完全不同的两种情况】
//   后端有两种"429"，语义相反，用户该做的事也相反：
//     ① 真正的 HTTP 429：Resilience4j 的应用层限流拦下了这次请求
//        （登录 5 次/分钟、前台文章列表 300 次/分钟）。
//        用户该做的是【等一下】—— 提示「请求过于频繁，请稍后再试」。
//     ② HTTP 200 + body.code = 429：幂等键命中"另一个相同请求正在处理中"，
//        也就是用户把提交按钮点了两下（或网络重试）。
//        用户该做的是【别重复提交】—— 提示「请求正在处理中，请勿重复提交」。
//   两者的 body.code 都是 429，只能靠"HTTP 状态码"区分：
//   前者走 $fetch 的异常分支（HTTP 层就失败了），后者走正常返回分支。
//   混成一句话的后果不是"不好看"，而是把用户往错的方向指：
//   明明点了两下，却告诉他"稍后再试"，他会以为第一次没成功，再点一下。
//
// 【技术栈与关键字】
//   · ofetch（Nuxt 的 $fetch）在 HTTP 非 2xx 时抛 FetchError，
//     它有两个属性：`response`（原始 Response，能读 headers）与 `data`（解析后的 body）
//   · 二进制 status 的多种读取方式：不同形态的异常里状态码分别在
//     err.status / err.statusCode / err.response.status —— 这里统一成一个函数，
//     免得每处各写一遍、各漏一种（useApi 里原来就写漏过，见那里的注释）
// ============================================================

/** 真正被限流时后端返回的 HTTP 状态码 */
export const HTTP_STATUS_TOO_MANY_REQUESTS = 429

/**
 * 被限流时的兜底提示。
 * 【为什么后端已经给了 message 还要留一份】后端 429 的 body 里确实有
 * 「请求过于频繁，请稍后再试」，正常情况下会优先用它；但如果哪天后端
 * 改了文案、或者代理层（Nginx 的 limit_req）直接返回了一个没有 body 的 429，
 * 这里必须还有一句话可说 —— 否则用户看到的就是通用的「网络异常」，
 * 而限流恰恰是"等几秒就好"的事，提示成网络故障会让人反复重试、越试越糟。
 */
export const RATE_LIMITED_MESSAGE = '请求过于频繁，请稍后再试'

/**
 * 幂等键命中"另一个相同请求正在处理中"时的兜底提示。
 * 【为什么它和 HTTP 429 共用 code 429 却要说不同的话】见文件头 ①② 的说明：
 * 这种情况用户只要不重复点就行了，等一下下（几十毫秒）就自动好了。
 */
export const DUPLICATE_SUBMIT_MESSAGE = '请求正在处理中，请勿重复提交'

/**
 * 登录失败后的冷却秒数。
 *
 * 【为什么是 10 秒而不是 1 秒、也不做指数退避】
 *   · 后端登录限流是 **5 次/分钟**（window 60 秒、每次放 5 个）。被人连续
 *     试错触发之后，1 秒的冷却等于没冷却，用户接着点还是 429，只会更烦躁。
 *   · 10 秒能挡住"脚本式连点 / 手速试密码"，又不至于让正常用户觉得卡死；
 *     60 秒那种长度对"手滑输错几次密码"的正常人惩罚过重。
 *   · 不做指数退避：这是一个前端提示性的冷却，不是真正的防护
 *     （防护在后端，前端拦不住脚本）；做得太复杂，用户反而看不懂
 *     "为什么这次要等 40 秒"。
 *   所以取一个"够让 1 分钟窗口滑过去一部分、又不折磨人"的中间值。
 */
export const LOGIN_COOLDOWN_SECONDS = 10

/**
 * 从各种异常形态里取出 HTTP 状态码。
 * 【为什么要试三种写法】ofetch 抛出的 FetchError 上状态码在 `status`，
 * 但它内部包装过的一些错误放在 `statusCode`（h3/Nitro 的风格），
 * 而原始 Response 上的才是唯一权威的 `response.status`。
 * 少读一种的表现是"某个分支永远进不去"，而且不报错 ——
 * 比如 429 掉进兜底分支，用户看到「网络异常」（这正是这次要修的问题）。
 *
 * @returns {number|undefined} 拿不到时返回 undefined（不是 0，0 会和"成功"混淆）
 */
export const readHttpStatus = (err) => {
  const status = err?.status ?? err?.statusCode ?? err?.response?.status
  return Number.isFinite(status) ? Number(status) : undefined
}

/** 是不是被真正的限流拦下了（HTTP 429） */
export const isRateLimited = (err) => readHttpStatus(err) === HTTP_STATUS_TOO_MANY_REQUESTS

/**
 * 读出后端 body 里的 message（拿不到就返回空串）。
 * 【为什么返回空串而不是 undefined】调用方统一写成
 * `pickMessage(readBackendMessage(err), RATE_LIMITED_MESSAGE)`，
 * 空串会被 pickMessage 判成"没有"，少一层 if。
 */
export const readBackendMessage = (err) => {
  const message = err?.data?.message
  return typeof message === 'string' ? message.trim() : ''
}

/**
 * 选一句能显示的文案：候选值有内容就用它，否则用兜底。
 * 【为什么要 trim 之后再判】后端 message 是 `" "`（空白）这种脏数据时，
 * 提示框里会出现一个空白的错误条 —— 看着像 bug，其实就是少了一次 trim。
 */
export const pickMessage = (candidate, fallback) =>
  typeof candidate === 'string' && candidate.trim() ? candidate.trim() : fallback

/**
 * 冷却期间的提示文案（带剩余秒数）。
 * 【为什么要把秒数写出来】只说"稍后再试"的话，用户不知道要等多久，
 * 只能靠反复点击来试探；写上"请 7 秒后再试"，等待就有了预期。
 */
export const cooldownMessage = (seconds) => `请求过于频繁，请 ${Math.max(1, Math.trunc(seconds))} 秒后再试`

// ============================================================
// 追踪号（traceId）
//
// 【前端为什么要显示它】
//   后端给每个请求分配一个 traceId，同一次请求的所有日志行都带同一个值，
//   并且由 TraceResponseHeaderFilter 写进响应头 X-Trace-Id。
//   用户遇到"操作失败"时只会说"它坏了"，站长拿到追踪号就能在日志里
//   搜这一个号、看到那次请求的全貌（参数、异常栈、耗时），
//   而不用靠时间点去猜是哪一条。
//
// 【⚠️ 头名字是自定义的 X-Trace-Id，不是 X-B3-TraceId】
//   后端用的是 Micrometer Tracing + Brave，跨进程传播确实走 B3 那套头
//   （X-B3-TraceId），但**回给浏览器的**是自定义的 `X-Trace-Id`：
//   Brave 自带的 TracingFilter 负责写头的 sender 在那个链路里轮不到执行。
//   CORS 里也配了 addExposedHeader("X-Trace-Id")，否则浏览器读不到它。
//   写错名字的表现是"永远没有追踪号"，而且不报错 —— 所以这里把名字写成常量。
//
// 【为什么只在错误提示里带】成功提示带一串十六进制只会变成噪音。
// ============================================================

/** 后端回给浏览器的追踪号响应头 */
export const TRACE_ID_HEADER = 'X-Trace-Id'

/**
 * 追踪号看起来应该是什么样：一串十六进制（也容忍 - _ .）。
 * 【为什么要卡形状】这个值会被**直接显示给用户**，
 * 而且是"响应头里来的外部字符串"。卡一道形状，
 * 就算哪天头被中间层塞进奇怪的内容，也只会表现为"没有追踪号"，而不是把它印到界面上。
 */
const TRACE_ID_PATTERN = /^[A-Za-z0-9._-]{4,64}$/

/**
 * 从响应头里读追踪号。
 *
 * 【为什么要兼容三种形态】调用方拿到的 headers 可能是：
 *   · Headers 实例（fetch / ofetch 的 response.headers —— 它的 get() 本身不分大小写）
 *   · 普通对象（测试里手写的假响应、某些中间层的包装）
 *   · undefined（没有响应：断网、请求被取消）
 * 只认一种的话，最容易出现的问题不是报错，而是**静默地永远读不到**。
 *
 * @returns {string} 读不到或不合法时返回空串（调用方据此决定"不显示追踪号"）
 */
export const readTraceId = (headers) => {
  if (!headers) return ''

  let value = ''
  if (typeof headers.get === 'function') {
    value = headers.get(TRACE_ID_HEADER) || ''
  } else if (typeof headers === 'object') {
    const lower = TRACE_ID_HEADER.toLowerCase()
    for (const [key, headerValue] of Object.entries(headers)) {
      if (key.toLowerCase() === lower && typeof headerValue === 'string') value = headerValue
    }
  }

  const trimmed = typeof value === 'string' ? value.trim() : ''
  return TRACE_ID_PATTERN.test(trimmed) ? trimmed : ''
}

/**
 * 把追踪号拼进提示文案。
 *
 * 【没有追踪号时必须原样返回】不能拼出「操作失败（追踪号：，报给站长）」这种
 * 空括号 —— 那比不显示更糟：用户会以为界面坏了，还会照着一句没有内容的话去反馈。
 * 【为什么连"括号"一起省掉，而不是写「追踪号：无」】同理：
 * 没有这一项就不提这一项，才不占地方。
 */
export const withTraceId = (message, traceId) => {
  const id = typeof traceId === 'string' ? traceId.trim() : ''
  return id ? `${message}（追踪号：${id}，报给站长可快速定位）` : message
}
