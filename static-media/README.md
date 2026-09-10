# static-media —— 不进构建产物的「大文件」仓库

这个目录里的文件**不参与 `nuxt build`**，不会出现在 `.output` 里，
也就是说**前端镜像里没有它们**。它们只是「可复现的副本」：文件放在 git 里，
谁 clone 下来都能拿到同一份源文件，但部署时由运维/脚本单独上传到服务器。

## 里面有什么

| 文件 | 用途 | 引用方 |
|---|---|---|
| `bg-star.mp4` | 全站背景视频 | `app/app.vue` 的 `<video>` |
| `bg-music.mp3` | 首页音乐卡片的音源 | `app/pages/index.vue` 的 `<audio>` |

## 为什么要挪出 `public/`

Nuxt 会把 `public/` 下的**所有**文件原样拷进 `.output/public`，
再由 Node 服务（或 Nginx 反代）提供。这两条音视频合计约 **13.7 MiB**，
占掉的比其余全部前端产物加起来还多得多：

| | 挪出前 | 挪出后 |
|---|---|---|
| `.output/public` | 17.24 MB | 3.51 MB |
| `.output`（整体） | 29.28 MB | 15.56 MB |

（都是 `npm run build` 之后实测的字节数换算而来；`.output/public` 剩下的
3.51 MB 里有 3.35 MB 是 `_nuxt` 下的前端 JS/CSS bundle，和本次改动无关。）

代价还不只是体积：它们和前端代码的发布节奏**完全无关**（改一行 CSS 也要
重新构建、重新上传十几 MB），而且它们本来就不需要经过 Node 进程
（视频要支持 Range 请求，让 Nginx 直接读磁盘上的文件是最省事、也最高效的做法，
详见下面的「部署」）。

## 怎么部署

1. 把本目录里的文件上传到服务器的媒体目录（默认 `/var/www/media/`）：

   ```bash
   # 在服务器上（或本机传到服务器）
   sudo mkdir -p /var/www/media
   sudo cp static-media/bg-star.mp4 static-media/bg-music.mp3 /var/www/media/
   sudo chmod 644 /var/www/media/*
   ```

2. 在 Nginx 里把 `/media/` 这个前缀指到那个目录（**要放在反代到 Nuxt 的
   `location /` 之前，否则请求会被转发给 Node**）：

   ```nginx
   location /media/ {
       alias /var/www/media/;
       # 视频用 Range 请求拖动进度条，Nginx 默认就支持，不用额外配置
       add_header Cache-Control "public, max-age=604800";
       access_log off;
   }
   ```

3. 确认前端产物里的地址前缀和上面这个 location 对得上。
   默认就是 `/media`；要换前缀（或者哪天把文件挪到对象存储 / CDN）
   **不用改代码**，改运行时的环境变量即可：

   ```properties
   NUXT_PUBLIC_MEDIA_BASE=/media
   # 例：NUXT_PUBLIC_MEDIA_BASE=https://cdn.example.com/media
   ```

   前缀只在 `app/utils/media.ts` 的 `mediaUrl()` 里拼一次，页面里不出现硬编码地址，
   理由见那个文件顶部关于「dev 与 prod 的 URL 必须一致」的说明。

## 本地开发怎么办

`npm run dev` 时 Nginx 并不在，所以 Nitro 里有一个**仅开发环境生效**的路由
（`server/routes/media/[...file].get.ts`）会从这个目录读文件并流式返回，
地址同样是 `/media/bg-music.mp3`。

**所以要记得**：新增/替换这里的文件之后，dev 环境立即生效（每次请求都读磁盘），
但**服务器上要重新传一次**——`git push` 不会把文件送到生产环境。
`npm run build` 也不会。

## 不在 `public/` 里的东西

`public/` 下剩下的封面图、favicon、robots.txt 体积很小（合计不到 200 KB），
而且和前端构建的版本是绑在一起的（改一次就要一起发布），
所以它们留在 `public/` 里由构建产物直接带走，**不要**挪过来。
