// ============================================================
// server/routes/feed.xml.get.ts
//
// 作用：GET /feed.xml —— **运行时**生成的 RSS 2.0 订阅源（最近 20 篇已发布文章）。
//
// 【与 sitemap.xml / robots.txt 是同一套路】文件名定路由（Nitro）、
//   内容生成在 server/utils/feed.ts（纯函数，有单测）、失败降级成"合法但只有站点信息"。
//   三份文件都从 runtimeConfig.public.siteUrl 取域名，所以 canonical、sitemap、
//   feed、robots 里写的域名**不可能不一致**。
//
// 【取数用的是内网地址】runtimeConfig.apiBaseServer（NUXT_API_BASE_SERVER）：
//   容器里去请求自己的公网域名等于绕一圈 DNS + Nginx 再回到同一台机器；
//   域名没配好时直接失败，feed 会静默降级成"只有站点信息"——
//   而订阅器看到的是一个**合法**的、只是没有新文章的源，站长很难发现。
//
// 【失败了也不能 500、更不能空 body】
//   订阅器对 500 或空 body 的反应是"这个源坏了"：有些会直接把它标成失效、
//   有些会停止抓取，恢复后也不会自动回来（要用户手动重新订阅）。
//   而"暂时只有站点信息、没有文章"轻得多。降级由 buildFeedXml() 负责：
//   传空数组给它，返回的仍然是一份结构完整的合法 feed。
//
// 【为什么 retry: 0】feed 是一次后台抓取任务，失败就降级；
//   重试只会让一个已经出问题的后端再多挨一次（与 sitemap 的取舍一致，
//   也和 app/utils/apiError.ts 里"429 不重试"是同一个道理）。
// ============================================================

import { FEED_CONTENT_TYPE, buildFeedXml, normalizeFeedArticles } from '../utils/feed'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const siteUrl = config.public.siteUrl
  // 【服务端必须走内网地址】见文件头说明
  const apiBase = config.apiBaseServer

  // 后端的统一包装是 { code, message, data }；这里照着 useApi 的判断口径收成 { ok, data }，
  // 并且**任何异常都吞掉**（接口挂了、被限流、返回的不是 JSON）——
  // 下面传给 buildFeedXml 的永远是一个数组（最坏是空数组）
  const res = await $fetch('/article/rss', {
    baseURL: apiBase,
    retry: 0,
  }).then(body => ({
    ok: body && typeof body === 'object' && body.code === 200,
    data: body?.data,
  })).catch(() => ({ ok: false, data: null }))

  setResponseHeader(event, 'Content-Type', FEED_CONTENT_TYPE)
  // 短缓存：新文章发布后订阅里要能较快跟上（爬取方会频繁来取，每次都打一遍后端列表）
  setResponseHeader(event, 'Cache-Control', 'public, max-age=300')

  return buildFeedXml({
    siteUrl,
    articles: res.ok ? normalizeFeedArticles(res.data) : [],
  })
})
