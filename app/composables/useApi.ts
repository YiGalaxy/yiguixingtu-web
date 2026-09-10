// ============================================================
// app/composables/useApi.ts
// 作用：后台所有请求的统一入口，自动做三件事：
//   1. 自动带上 Authorization: Bearer <token>
//   2. 自动判断后端返回的 code（非 200 当失败，弹出后端的 message）
//   3. 自动处理 401（token 过期 → 清 token 并弹登录框）和 403（无权限）
//
// 另外还管着两件"不写出来就会踩坑"的事：
//   · 【重试策略】显式关掉 ofetch 对 429 的自动重试（见 API_RETRY_STATUS_CODES）：
//     $fetch 默认会对 GET 自动重试一次，而它的默认重试集合里包含 429 ——
//     后端正在限流时前端再打一次，正好与限流的目的相反，用户还要多等一个往返。
//   · 【追踪号】见下面「关于追踪号」。
//
// 为什么不用直接 $fetch？
//   若每个页面都自己写，那"带 token""判 401"要重复几十遍，改一处要改几十处。
//   封装成一处后，页面只管写 request('/user/page')。
//
// 【关于"两种 429"】见 app/utils/apiError.ts 的说明：
//   HTTP 429 = 真被限流（等一下就好），HTTP 200 + body.code=429 = 重复提交
//   （别重复点）。两者提示必须不同，所以这里分成两个分支，
//   而且【绝不】让 429 掉进最后的"网络异常"兜底分支 ——
//   对限流说成网络故障，用户会以为网络坏了，反复重试，越试越糟。
//
// 【关于追踪号】每条错误提示都会带上后端的 X-Trace-Id（有才带）：
//   用户把提示里的那串号报给站长，站长在日志里搜它就能看到这次请求的全貌。
//   见 app/utils/apiError.ts 里的 TRACE_ID_HEADER 与 withTraceId。
// ============================================================

import { ElMessage } from 'element-plus'

/**
 * 选后端地址：服务端渲染时走内网地址，浏览器里走公开地址。
 *
 * 【为什么单独抽成一个函数】
 *   import.meta.server 是【编译期常量】——构建时就被替换成 true / false 了，
 *   在测试里没法两种情形都跑到（Nuxt 测试环境里它固定是客户端那一侧）。
 *   抽成纯函数之后，只要传一个布尔值就能把两条分支都测到，
 *   而 useApi 里仍然是"用真实标志调用"，没有为了测试而改变生产行为。
 *
 * @param {boolean} isServer 是否在服务端渲染
 * @param {object}  config   useRuntimeConfig() 的结果
 */
export const resolveApiBase = (isServer, config) =>
  isServer ? config.apiBaseServer : config.public.apiBase

export const useApi = () => {
  // 这几个必须在 setup 阶段取好；放进 request 内部调用会丢 Nuxt 上下文
  const config = useRuntimeConfig()
  // 【服务端与浏览器用不同的地址】
  //   · SSR（文章详情页那种）在服务器上发请求 → 走 apiBaseServer（内网/本机），
  //     不必绕一圈公网域名再回到同一台机器
  //   · 浏览器里 → 走 public.apiBase（对外可访问的那个地址）
  const apiBase = resolveApiBase(import.meta.server, config)
  const token = useCookie('token')           // 登录通行证
  const { openLogin } = useAuthUi()          // 401 时弹登录框用

  /**
   * 【SSR 关键】弹提示必须只在浏览器端做。
   *
   * ElMessage 内部要创建 DOM 节点，而服务端渲染时根本没有 document。
   * 直接调用会抛 "document is not defined" —— 而且是在 try 块里抛，
   * 会被下面的 catch 当成"网络异常"吞掉，导致：
   *   · 真正的错误信息（比如"文章不存在"）丢失
   *   · useAsyncData 拿到的是 undefined 而不是业务结果
   *   · 页面该返回 404 却返回 200
   *
   * 客户端有 document，一切正常 —— 所以这个坑【只在 SSR 下暴露】，
   * 首页、后台那种纯客户端渲染的页面完全测不出来。
   */
  const toast = (msg) => {
    if (import.meta.client) ElMessage.error(msg)
  }

  /**
   * 发请求
   * @param {string} url      后端路径，如 '/user/page'
   * @param {object} options  { method, body, params }，同 $fetch
   * @returns {Promise<{ok:boolean, code:number, message?:string, data?:any}>}
   */
  const request = async (url, options = {}) => {
    // ---- 1. 拼请求头：有 token 就带上 ----
    const headers = { ...(options.headers || {}) }
    if (token.value) {
      headers.Authorization = `Bearer ${token.value}`
    }

    // ---- 1.5 追踪号：这次请求的 X-Trace-Id ----
    // 【为什么不能只在 catch 里读】追踪号在**响应头**上，而 $fetch 正常返回时
    // 只给我们 body（后面那个 {code,message,data}），拿不到头。
    // 而"接口报错"里有一大半是 HTTP 200 + body.code≠200（业务失败），
    // 只在 catch 里读的话，这些最需要追踪号的错误反而没有号。
    // 【怎么拿到】ofetch 提供了两个钩子：onResponse（正常响应）与
    // onResponseError（非 2xx，在抛异常之前调用），两个都会收到带 response 的 context，
    // 于是把这次请求的追踪号记在闭包里，三种分支都读同一个变量。
    let traceId = ''
    const captureTraceId = (context) => {
      const id = readTraceId(context?.response?.headers)
      if (id) traceId = id
    }

    /** 出错时取追踪号：钩子里拿到的优先，其次直接看异常里带的响应头 */
    const errorTraceId = (err) => traceId || readTraceId(err?.response?.headers)

    try {
      // ---- 2. 发请求 ----
      const res = await $fetch(url, {
        baseURL: apiBase,                 // 服务端/浏览器各自解析出来的地址
        // ---- 2.1 重试策略：429 不重试（其余保持 ofetch 默认） ----
        // ofetch 默认会对 GET 自动重试 1 次，而它的默认集合里**包含 429** ——
        // 也就是"后端正在限流"时前端会立刻再打一次，正好和限流的目相反
        // （详见 app/utils/apiError.ts 里 API_RETRY_STATUS_CODES 的推导）。
        // 这里显式传一份"去掉 429"的数组：5xx/408/425 那种临时性故障仍然重试一次。
        // ⚠️ 必须是【数组】：ofetch 内部用 Array.isArray 判断，传 Set 之类的类型
        // 会静默回落到它自己的默认集合（429 又被重试），配置等于没写。
        retryStatusCodes: API_RETRY_STATUS_CODES,
        // 【放在 ...options 之前】调用方显式传自己的钩子/选项时以调用方为准，
        // 我们这只是"顺手记一下追踪号、顺手定一个重试底线"，
        // 不该覆盖别人真正想做的事
        onResponse: captureTraceId,
        onResponseError: captureTraceId,
        ...options,
        headers,
      })

      // ---- 3. 后端统一返回 { code, message, data } ----
      // 注意：业务失败时 HTTP 仍是 200，错误信息在 body 的 code / message 里
      if (res && typeof res === 'object' && 'code' in res) {
        if (res.code === 200) {
          return { ok: true, code: 200, data: res.data }
        }
        // 【分支 ⑤-a：HTTP 200 + body.code=429 = 幂等键命中"另一个相同请求正在处理中"】
        // 这不是"被限流"，而是用户（或网络重试）把同一个提交动作发了两遍。
        // 后端返回的 message 就是「请求正在处理中，请勿重复提交」，
        // 所以正常情况下用它；万一没带 message（或只有空白），
        // 也必须落到这句上，而不是通用的「操作失败」——
        // 用户看到"操作失败"会以为第一次没成功，于是再点一下，正好又撞一次幂等键。
        if (res.code === HTTP_STATUS_TOO_MANY_REQUESTS) {
          const message = withTraceId(pickMessage(res.message, DUPLICATE_SUBMIT_MESSAGE), traceId)
          toast(message)
          return { ok: false, code: HTTP_STATUS_TOO_MANY_REQUESTS, message, data: res.data, duplicateSubmit: true, traceId }
        }
        // 【这里为什么要分 rawMessage 与 message 两个变量】
        //   弹出提示需要一句"总要能显示"的话（没原文就用「操作失败」兜底），
        //   但**返回值**必须原样保留后端有没有给原文这件事：
        //   调用方会自己兜底得更具体 —— 比如 useUpload 写的是
        //   `ElMessage.error(res.message || '封面上传失败')`，
        //   我们要是塞一个「操作失败」进去，用户看到的提示反而变笼统了
        //   （这条是原来 useUpload 的用例守着的契约）。
        const rawMessage = typeof res.message === 'string' ? res.message.trim() : ''
        const toastMessage = withTraceId(rawMessage || '操作失败', traceId)
        toast(toastMessage)
        return {
          ok: false,
          code: res.code,
          message: rawMessage ? toastMessage : undefined,
          data: res.data,
          traceId,
        }
      }
      return { ok: true, code: 200, data: res }

    } catch (err) {
      // ---- 4. 走到这说明 HTTP 层出错（401 / 403 / 429 / 500 / 断网）----
      // 状态码统一从 readHttpStatus 里读：不同形态的异常把它放在
      // err.status / err.statusCode / err.response.status 三个地方，
      // 原来在这里手写 `err?.status || err?.statusCode || err?.response?.status`，
      // 抽到 app/utils/apiError.ts 之后 useAuth 也能用同一份判断，
      // 不会出现"这里认得 429、那里不认得"的错位
      const status = readHttpStatus(err)
      // 每条错误分支都带上追踪号（有才带，没有就原样）。
      // 【为什么连 401/403 也带】规则统一才不会有"某些错误有号、某些没有"的错位；
      // 而且真遇到"这个管理员账号为什么没权限"这类问题，号一样有用。
      // 拿不到的情况（断网、请求被取消）自然就没有号 —— 那时也确实没法看日志。
      const trace = errorTraceId(err)

      if (status === 401) {
        token.value = null            // 通行证失效 → 清掉
        openLogin()                   // 弹登录框
        const message = withTraceId('登录已过期，请重新登录', trace)
        toast(message)
        return { ok: false, code: 401, message, traceId: trace }
      }
      if (status === 403) {
        const message = withTraceId('无权限访问', trace)
        toast(message)
        return { ok: false, code: 403, message, traceId: trace }
      }
      // 【分支 ⑤-b：真正的 HTTP 429 = 被应用层限流拦下】
      // Resilience4j 的 RateLimiter 配额用完时会抛 RequestNotPermitted，
      // 后端把它翻译成 HTTP 429 + {code:429, message:"请求过于频繁，请稍后再试"}。
      // 必须单独一个分支：这条是最容易被写成"网络异常"的 ——
      // 因为它长得就是个"请求失败了"，而真实原因和网络无关（服务端好好的，
      // 只是让等一会儿），提示成网络异常会引导用户去查网线/重启路由器，方向全错。
      // 返回 rateLimited: true，调用方（比如登录按钮）可以据此做冷却倒计时。
      if (status === HTTP_STATUS_TOO_MANY_REQUESTS) {
        const message = withTraceId(pickMessage(readBackendMessage(err), RATE_LIMITED_MESSAGE), trace)
        toast(message)
        return { ok: false, code: HTTP_STATUS_TOO_MANY_REQUESTS, message, rateLimited: true, traceId: trace }
      }
      const message = withTraceId('网络异常，请稍后再试', trace)
      toast(message)
      return { ok: false, code: -1, message, traceId: trace }
    }
  }

  return { request }
}
