# static-media —— 不进构建产物的「大文件」仓库

这个目录里的文件**不参与 `nuxt build`**，不会出现在 `.output` 里，
也就是说**前端镜像里没有它们**。它们只是「可复现的副本」：文件放在 git 里，
谁 clone 下来都能拿到同一份源文件，但部署时由运维/脚本单独上传到服务器。

## 里面有什么

| 文件 | 用途 | 引用方 |
|---|---|---|
| `bg-star.mp4` | 全站背景视频 | `app/app.vue` 的 `<video>` |
| `bg-music.mp3` | 背景音乐的音源 | `app/app.vue` 里**唯一**的那个 `<audio>`（2026-09-11 从首页卡片挪进外壳：页面会随路由卸载，放在卡片里等于"一离开首页音乐就断"，而且音乐页出现后会变成两个播放器抢同一首歌。首页卡片与音乐页现在都只是它的遥控器） |
| `cover-1.png` | 唱片的**封面回落图**（音频里没有内嵌 ID3 封面时用它） | `app/pages/music.vue`，经 `MEDIA_FILES.musicCover` 取地址 |
| `beian.png` | 页脚**公安网安备案**那一项前面的官方图标（蓝底警徽，36×40） | `app/app.vue` 的页脚，经 `MEDIA_FILES.policeIcon` 取地址 |

> ⚠️ **`beian.png` 为什么也在这里，而不是 `public/`**：它和备案号是**一起换的**
> （备案号是站点主体相关的信息，换主体/换域名时两者同时失效）。
> 放进 `public/` 就等于"改一次备案展示就要重新构建并上传一次前端镜像"，
> 而这台服务器构建前端很贵（见 `Dockerfile` 里那段内存上限的说明）。
> 它只有 1.4 KB，放在这里既不占构建产物，也能和备案材料一起管理。
> （本地开发时 `/media/` 由 Nitro 的开发路由提供，`.png` 已在扩展名白名单里，不需要额外改动。）

> ⚠️ **`cover-1.png` 在 `public/` 里也有一份**（同名同内容，逐字节一致），
> 那不是重复放错了：`public/` 那份是**文章卡片的封面兜底图**，它要跟着构建产物走
> （体积只有 15 KB，和前端版本绑在一起发布最省事）；而 `static-media/` 这份是
> **唱片封面**，它和音频是"同一首歌的两半"，要跟着音频一起换、一起传，
> 放 `public/` 里的话改一次封面就要重新构建前端。
> 两处的用途不同、发布节奏不同，所以刻意各留一份（改图时**两个都要换**）。

## 音乐播放器还需要上传的一个文件（**现在还不在这个目录里**）

音乐页（`app/pages/music.vue`）与首页那张音乐卡片上会显示歌词，它对应一个文件。
名字登记在 `app/utils/media.ts` 的 `MEDIA_FILES` 里（文件名只在那一个地方定义），
所以只要按下面的名字放进来、上传到服务器，页面就会自动用上，**不需要改代码**：

| 文件 | 用途 | `MEDIA_FILES` 里的键 | 现状 |
|---|---|---|---|
| `bg-music.lrc` | 歌词（LRC 纯文本格式）。页面上「当前歌词 + 歌词列表 + 点某句跳转」全部来自它 | `musicLyrics` | **尚未上传** |

它缺失时的表现（**也就是现在线上/本地的表现**）：歌词区显示「暂无歌词」。
**页面上不会出现任何编造的歌词**——拿不到就是拿不到。

### 本地开发也能拿到这两个文件（2026-09-11 已修）

原本有个坑：`/media/` 在 `npm run dev` 下由 Nitro 的开发路由
（`server/routes/media/[...file].get.ts`）提供，而它复用的扩展名白名单
（`server/utils/mediaFile.ts` 的 `ALLOWED_MEDIA_EXTENSIONS`）**当时只有 `.mp4` 与 `.mp3`**。
线上由 Nginx 的 `location /media/` 直接读磁盘、没有这层白名单 ——
于是会出现一种最难查的现象：**把 `cover-1.png` / `bg-music.lrc` 放进本目录、也传上了服务器，
线上好了，本地却仍然是占位图与「暂无歌词」**，本地一测就以为功能没做。

现在白名单补上了 `.png` 与 `.lrc`（`.lrc` 用 `text/plain; charset=utf-8` 发，
**绝不能**当成 HTML 解析 —— 那才是真的给 XSS 开门），两种环境提供同一批文件。
白名单本身没有变松：`../` 上跳、隐藏文件、换扩展名、可执行文件、无扩展名仍然一律拒绝，
`test/media.nuxt.spec.ts` 里连 `evil.html` / `evil.js` / `evil.svg` 都各钉了一条。

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
   # 必需的四个（背景视频 + 背景音乐 + 唱片封面回落图 + 公安备案图标）
   sudo cp static-media/bg-star.mp4 static-media/bg-music.mp3 static-media/cover-1.png static-media/beian.png /var/www/media/
   # 可选的一个（歌词）。**不放也不会报错**：歌词区显示「暂无歌词」，其余功能照常
   sudo cp static-media/bg-music.lrc /var/www/media/   # 有这个文件时才执行
   sudo chmod 644 /var/www/media/*
   ```
   ⚠️ `cp` 会把本目录的 `README.md` 也一起复制过去（`static-media/*` 通配）——
   无害但没必要，所以上面的命令是逐个点名而不是用 `*`。
   ⚠️ **漏传 `beian.png` 的表现很隐蔽**：页脚那行备案信息照常显示、链接也能点，
   只是图标位置是一个破图（浏览器的小裂图）。备案的合规要求是"备案号**与图标**一起展示"，
   所以它算"必需的四个"之一。

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

> 唯一的例外是 `cover-1.png`：它在两边各有一份（理由见文件开头那张表下面的 ⚠️）——
> `public/` 那份给文章卡片兜底、`static-media/` 那份给唱片当封面。
> 其余任何图片都没有这个必要，**别照着它把 `cover-2.png` / `cover-3.png` 也复制过来**
> （那两张只是首页装饰用的吉祥物图，跟着构建产物走就行）。
