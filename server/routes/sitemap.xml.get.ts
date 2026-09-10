// ============================================================
// server/routes/sitemap.xml.get.ts
//
// 作用：GET /sitemap.xml —— **运行时**生成的站点地图（首页 + 所有已发布文章）。
//
// 【为什么是运行时路由，而不是构建时生成一个静态文件】
//   见 server/utils/sitemap.ts 开头的两条理由（docker build 里连不上后端；
//   新文章发布后 sitemap 应当很快更新）。这里只强调一条：
//   构建时生成的话，发布流程会变成"发文章 → 还得重新构建镜像"，
//   而很多人（包括站长自己）不会想到这一步，结果是 sitemap 长期停在旧内容上。
//
// 【取数用的是内网地址】runtimeConfig.apiBaseServer（NUXT_API_BASE_SERVER）：
//   容器里去访问自己的公网域名等于绕一圈 DNS + Nginx 再回到同一台机器；
//   域名没配好时直接失败，sitemap 会默默降级成"只有首页"——很难发现。
//
// 【失败了也不能 500、更不能空 body】接口挂掉、被限流、返回结构不对时，
//   仍然返回一份含静态页面的**合法** sitemap：爬虫对 500 或空 body 的反应是
//   反复重试甚至认为站点整体不可用，而"暂时少收录一些文章"轻得多。
//   降级由 server/utils/sitemap.ts 的 collectAllArticles() 负责，
//   这里只把结果交给 buildSitemapXml()。
//
// 【技术栈与关键字】
//   · defineEventHandler / setResponseHeader：h3（Nitro 的 HTTP 框架）
//   · $fetch（ofetch）：Nitro 里可直接用（服务端侧没有 Cookie / CORS 的限制）
//   · retry: 0：**不自动重试**。sitemap 是一次后台任务，失败就降级；
//     而且这条链路会翻很多页，重试等于把压力翻倍 ——
//     与 app/utils/apiError.ts 里"429 不重试"的取舍是同一个道理，
//     只是这里更保守：sitemap 少几条没有用户会当场受影响
// ============================================================

import { collectAllArticles, buildSitemapXml, SITEMAP_CONTENT_TYPE, ARTICLE_PAGE_SIZE } from '../utils/sitemap'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const siteUrl = config.public.siteUrl
  // 【服务端必须走内网地址】见文件头说明
  const apiBase = config.apiBaseServer

  const { articles } = await collectAllArticles({
    fetchPage: (page, size) => $fetch('/article/page', {
      baseURL: apiBase,
      params: { page, size },
      retry: 0,
    }).then(body => ({
      // 后端的统一包装是 { code, message, data }；这里照着 useApi 的判断口径收成 { ok, data }
      ok: body && typeof body === 'object' && body.code === 200,
      data: body?.data,
    })).catch(() => ({ ok: false })),
    pageSize: ARTICLE_PAGE_SIZE,
  })

  setResponseHeader(event, 'Content-Type', SITEMAP_CONTENT_TYPE)
  // 短缓存：新文章发布后 sitemap 要能较快跟上，所以不用"一天"这种长缓存；
  // 但也不能不缓存 —— 爬虫可能反复来取，而每次都是一次翻页循环
  setResponseHeader(event, 'Cache-Control', 'public, max-age=300')

  return buildSitemapXml({ siteUrl, articles })
})
