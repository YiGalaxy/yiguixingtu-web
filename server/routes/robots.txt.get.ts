// ============================================================
// server/routes/robots.txt.get.ts
//
// 作用：GET /robots.txt —— 允许抓取、指向 sitemap、挡掉后台。
//
// 【为什么从 public/robots.txt 改成运行时路由】
//   原来那个文件只有两行（`User-Agent: *` + 空的 `Disallow:`），而且有两个问题：
//     · 没有 Sitemap 指向：爬虫仍然会去猜 /sitemap.xml，但那是"猜"，
//       写明了才会稳定来取
//     · 它是【静态文件】，所以内容里没法带站点域名 —— 而 Sitemap 那一行
//       按协议必须是绝对地址。用运行时路由之后，域名从 runtimeConfig 读
//       （NUXT_PUBLIC_SITE_URL），本地 / 测试 / 正式域名各写各的，不用改代码
//   两条路由（本文件与 sitemap.xml.get.ts）共用同一份 buildRobotsTxt()/站点地址，
//   所以 "robots 里指的 sitemap" 和 "sitemap 里写的域名" 不可能对不上。
//
// 【⚠️ 部署注意】它们现在是 Nitro 的**运行时路由**，不是 .output/public 里的静态文件：
//   Nginx 必须把 /robots.txt 与 /sitemap.xml 也转发给 Node（也就是落在
//   `location /` 的反代里）。哪天有人为了"省一次反代"把静态目录直出，
//   这两个地址会 404 —— 而 404 的 robots.txt 会让爬虫退回到"默认全允许、
//   没有 sitemap"，通常不会有人发现。
//
// 【后台为什么既在 robots.txt 里 Disallow、页面上又 noindex】
//   两者挡的不是一回事：Disallow 只挡住"抓取这个地址"，
//   但别处有链接指向它时，搜索结果里仍然可能出现这个地址（只是没有摘要）；
//   noindex（见 app/pages/admin.vue 的 useSeoMetaFor）才是"别收录"。所以要一起用。
// ============================================================

import { buildRobotsTxt } from '../utils/sitemap'

export default defineEventHandler((event) => {
  const config = useRuntimeConfig()

  // robots.txt 的 MIME 用 text/plain（charset 写明，免得中文注释在某些爬虫那里变成乱码）
  setResponseHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
  // 内容几乎不变（只有域名可能变），可以缓存久一点
  setResponseHeader(event, 'Cache-Control', 'public, max-age=3600')

  return buildRobotsTxt(config.public.siteUrl)
})
