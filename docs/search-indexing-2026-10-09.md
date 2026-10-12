# 搜索收录检查与修复（2026-10-09）

正式地址：`https://www.yigalaxy.xin`。通过本机 SSH 配置中的 `blog` 别名连接服务器。

## 已确认的情况

- 反向 DNS 与正向 DNS 双向核验后，日志中存在真实 Googlebot、Bingbot 的成功抓取。Google 读取过 Java 系列文章，Bing 在 10 月 8 日读取过 `/article/23`。抓取成功不能证明已经收录或获得关键词排名。
- 11 篇已发布文章具有服务端渲染正文、独立标题和正式域名 canonical，均返回 HTTP 200。
- 原来的 HTTP IP 地址跳到了 HTTPS IP，证书与 IP 不匹配；HTTPS 裸域名也返回重复内容。
- 旧文章 `/posts/post-mpuhcl0t` 在新站返回 404，当前公开文章中没有确认的迁移对应项。
- 用户尚未验证 Google Search Console 或 Bing Webmaster Tools，因此不能读取平台的收录诊断。

## 已部署的修复

- HTTP IP、HTTP 域名统一 301 到 `https://www.yigalaxy.xin`，保留路径与查询参数。
- HTTPS 裸域名 301 到 www。保留 ACME 续期入口、媒体服务、接口限流与管理端点保护。
- 首页标题为“Java 编程学习笔记与技术实践 · 亿轨星途”，首页与文章列表摘要说明实际 Java 系列内容。
- 站点地图补入 `/articles` 与 `/music`，共 19 个网址，其中 11 篇文章。文章仍由后端分页接口动态生成。
- 部署稳定的公开 IndexNow 验证文件，并提交了 19 个正式网址。接口返回 **202**：收到网址，密钥验证待处理；不代表已经收录。该密钥用于公开网站所有权校验，不是私密凭据。
- 旧 IP 文章地址现在通过正常 TLS 跳到正式域名的 404，便于搜索引擎刷新旧结果。没有将已删除文章批量跳到首页。

## 验证

- `npm test -- test/seo.nuxt.spec.ts test/sitemap.nuxt.spec.ts`：69 项通过。
- 对变更的源码、测试与提交脚本运行 ESLint，通过；Nuxt 生产构建成功。
- 逐一验证线上 11 篇文章的 HTTP 200 与 canonical；验证首页、文章列表、音乐、robots、sitemap、RSS、公开文章接口；无效文章与旧文章返回 404；受保护 actuator 入口仍返回 404。
- 前端容器健康。构建在本机完成，服务器只将产物装入镜像；保留旧客户端资源供已经打开的页面使用。

## 用户需要完成的网站验证

1. 登录 [Google Search Console](https://search.google.com/search-console/)，添加“网址前缀”资源 `https://www.yigalaxy.xin/`。可选择 HTML 文件验证，下载平台给出的验证文件并交给维护者部署；不能使用 IndexNow 文件替代 Google 的验证文件。
2. 验证后提交站点地图 `https://www.yigalaxy.xin/sitemap.xml`。在“网址检查”中输入真实文章地址，例如 `https://www.yigalaxy.xin/article/23`，查看收录状态、Google 选择的 canonical 和未收录原因，需要时申请编入索引。
3. 登录 [Bing Webmaster Tools](https://www.bing.com/webmasters/)，添加网站并验证，或从已经验证的 Google Search Console 导入，再提交相同站点地图。

无法从服务器直接保证搜索排名，也无法替代用户登录站长平台。旧结果消退与新文章收录取决于搜索引擎重新抓取和处理。

## 后续主动提交

发布或实质性更新文章后，在前端仓库运行：

```powershell
node scripts/submit-indexnow.mjs
node scripts/submit-indexnow.mjs --submit
```

第一条预览并检查站点地图与密钥，第二条实际提交。不需要重新构建站点地图。此脚本不是自动定时任务，也不调用 Google Indexing API（普通博客文章不适用）。

## 部署备份与回滚

- 线上 Nginx：`/etc/nginx/sites-available/yiguixingtu.conf`。
- 可复用配置保存于后端仓库 `deploy/nginx/yiguixingtu.conf`；部署前确认域名、证书与媒体目录适用于目标环境。
- Nginx 备份：`/srv/backup/seo-20261009-004808/yiguixingtu.conf`。恢复前执行 `nginx -t`，通过后 reload。
- 当前前端镜像：`yiguixingtu-frontend:seo-20261009`，同时标记为 Compose 使用的 `yiguixingtu-frontend:local`。
- 原前端镜像：`yiguixingtu-frontend:pre-seo-20261009`。
- 本次产物目录：`/srv/deploy_frontend/seo-20261009`；提交脚本另存于 `/srv/deploy_frontend/submit-indexnow.mjs`。

前端回滚命令（在服务器上执行）：

```sh
docker tag yiguixingtu-frontend:pre-seo-20261009 yiguixingtu-frontend:local
docker compose -f /srv/yiguixingtu/docker-compose.prod.yaml -f /srv/yiguixingtu/docker-compose.images.yaml up -d --no-deps --no-build frontend
```
