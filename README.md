# yiguixingtu-web — 个人博客前端

<!--
  CI 徽章：等这个仓库有了 GitHub 远程地址之后，把下面这行取消注释、
  并把 <用户名>/<仓库名> 换成实际的，即可显示 CI 状态。
  现在先不写死，是因为仓库还没有 remote，写上去只会显示一个坏掉的图片。

  [![CI](https://github.com/<用户名>/<仓库名>/actions/workflows/ci.yml/badge.svg)](https://github.com/<用户名>/<仓库名>/actions/workflows/ci.yml)
-->

> 基于 Nuxt 4 + Vue 3 + Element Plus 的个人博客前端
> 后端为独立仓库 `yiguixingtu`（Spring Boot 4，默认跑在 `localhost:8082`）
>
> **121 个测试用例 + ESLint + 生产构建，全部在 CI 里自动跑**（见下文「持续集成」）

## 项目简介

这是个人博客 **忆轨星途** 的前端站点，包含**前台展示**和**后台管理**两部分：

- **前台**：首页文章信息流（分页 + 关键词防抖搜索 + 分类筛选，筛选条件同步到地址栏）、
  文章详情（Markdown 渲染），个人卡片的文章数 / 浏览量 / 分类数来自站点统计接口
- **后台**：登录后进入 `/admin`，可管理用户（分页 / 启用禁用 / 改角色 / 重置密码 / 删除）
  与文章（Markdown 编辑器 / 草稿与发布 / 下架 / 删除），概览页显示全站汇总数字

站点采用深色星空视觉，带背景视频与音乐播放器。

## 技术栈

| 类别 | 技术 |
|------|------|
| 框架 | Nuxt 4（`^4.5.2`） |
| 视图 | Vue 3（`^3.5.42`） |
| 路由 | vue-router 5 |
| UI 组件库 | Element Plus 2.14 |
| Markdown 编辑器 | md-editor-v3 |
| 语言 | TypeScript |
| 包管理 | npm |
| 测试 | Vitest 5 + `@nuxt/test-utils` 4（nuxt 环境）+ `@vue/test-utils` |
| 代码检查 | ESLint 10 + `@nuxt/eslint` 1.17（扁平配置） |
| 持续集成 | GitHub Actions（`.github/workflows/ci.yml`） |

## 目录结构

```
yiguixingtu-web
├── app
│   ├── app.vue                      # 应用外壳：全局布局、登录/注册弹窗、背景视频与音乐
│   ├── error.vue                    # 全局错误页（404 / 403 / 401 / 500 分类文案）
│   ├── pages
│   │   ├── index.vue                # 首页：文章信息流 + 搜索（防抖）+ 分类筛选 + 加载更多
│   │   ├── admin.vue                # 后台：用户管理 + 文章管理 + Markdown 编辑器
│   │   └── article/[id].vue         # 文章详情（SSR + Markdown 渲染 + 软 404）
│   ├── composables
│   │   ├── useApi.ts                # 统一请求封装：带 token、判 body.code、401/403 处理
│   │   ├── useArticleFilter.ts      # 首页筛选条件：关键词防抖 + 分类 + 与地址栏双向同步
│   │   ├── useSiteStats.ts          # 站点统计（文章数 / 浏览量 / 分类数）与失败降级
│   │   ├── useAuth.ts               # 登录 / 注册 / 当前用户
│   │   ├── useAuthUi.ts             # 登录弹窗开关状态
│   │   └── useReveal.ts             # 滚动入场动画
│   ├── middleware
│   │   └── admin.ts                 # 后台路由守卫（未登录 → 弹登录框 + 回首页）
│   └── plugins
│       └── element-plus.ts          # Element Plus 注册
├── public                           # 静态资源（背景视频/音乐、封面图、favicon、robots.txt）
├── nuxt.config.ts                   # Nuxt 配置（含后端 API 地址）
└── .env.example                     # 环境变量示例
```

## 快速开始

### 1. 环境要求

- Node.js 20+
- npm
- **后端服务已启动**（见后端仓库 `yiguixingtu` 的 README；默认 `http://localhost:8082`）
  - 后端依赖 MySQL 与 Redis，需要先 `docker compose up -d`

### 2. 安装依赖

```bash
npm install
```

### 3. 配置后端地址

复制环境变量示例文件并修改：

```bash
cp .env.example .env
```

默认内容：

```properties
NUXT_PUBLIC_API_BASE=http://localhost:8082
NUXT_API_BASE_SERVER=http://localhost:8082
```

> Nuxt 的 `runtimeConfig` 按名字自动读取环境变量
> （`NUXT_PUBLIC_API_BASE` → `runtimeConfig.public.apiBase`，
> `NUXT_API_BASE_SERVER` → `runtimeConfig.apiBaseServer`），
> 所以改地址**不需要动代码**。

#### 为什么是两个地址，不是一个

**服务端和浏览器要用的后端地址经常不是同一个。**

| | 用哪个 | 为什么 |
|---|---|---|
| **浏览器** | `NUXT_PUBLIC_API_BASE`（会打进产物，**不能放密钥**） | 必须是对外可访问的地址，否则用户浏览器请求不到 |
| **服务端渲染** | `NUXT_API_BASE_SERVER`（不会打进产物） | SSR 的请求发生在服务器上，去请求自己的公网域名等于绕一圈 DNS + Nginx 再回到同一台机器，白白多几十毫秒；域名没配好时 SSR 还会直接失败 |

本地开发时两者都是 `http://localhost:8082`，看起来没区别；
但部署时就分开了，例如：

```properties
# 服务器上：浏览器走域名，SSR 直连内网容器
NUXT_PUBLIC_API_BASE=https://你的域名/api
NUXT_API_BASE_SERVER=http://backend:8082
```

> 选地址的逻辑在 `app/composables/useApi.ts` 的 `resolveApiBase()`。
> 它被单独抽成一个纯函数，是因为 `import.meta.server` 是**编译期常量**，
> 测试里没法两种情形都跑到；抽出来之后传一个布尔值就能把两条分支都测到
> （见 `test/useApi.nuxt.spec.ts` 的 5 个用例）。

### 4. 启动开发服务器

```bash
npm run dev
```

访问 `http://localhost:3000`。

> ⚠️ **前端必须跑在 3000 端口**：后端 CORS 白名单目前写死
> `http://localhost:3000`（后端 `SecurityConfig.java`），换端口就会跨域失败。

### 5. 构建与预览

```bash
npm run build      # 生产构建
npm run preview    # 本地预览生产构建
npm run generate   # 生成静态站点
```

### 6. 运行测试

```bash
npm run test         # 跑一遍（vitest run）
npm run test:watch   # 监听模式，改代码自动重跑
```

**不需要启动后端** —— 测试会把请求层 mock 掉，所以断网、后端没起也能跑。

### 7. 代码检查

```bash
npm run lint         # 检查（eslint .）
npm run lint:fix     # 自动修掉能修的部分
```

用 **`@nuxt/eslint`** 的扁平配置（Nuxt 官方推荐的那套），
在 `eslint.config.mjs` 里做了少量覆盖，每一条覆盖都写了为什么。

> **当前 lint 是干净的（0 error / 0 warning）**，所以 CI 上这一步是有意义的门槛；
> 如果放着几十条 warning 不管，大家很快就会习惯性忽略它。

### 8. 持续集成

`.github/workflows/ci.yml`，在 **push 到 master** 和 **PR** 时触发，三步依次执行：

| 步骤 | 命令 | 为什么单独一步 |
|------|------|---------------|
| 代码检查 | `npm run lint` | 串成一条命令的话，Actions 页面只会显示一句 exit 1，看不出是哪一步挂的 |
| 运行测试 | `npm run test` | 121 个用例；**不需要后端与数据库**，CI 里不用起任何服务 |
| 生产构建 | `npm run build` | 保证"测试过了但build 不过"这种情况不会漏到线上 |

用 `npm ci` 而不是 `npm install`：它严格按 `package-lock.json` 安装，
装不出锁文件之外的东西，所以"CI 绿了、别人 clone 下来却跑不起来"不会发生。

> ⚠️ **本仓库目前还没有 GitHub 远程地址**，所以工作流文件已就位但还没真正跑过。
> 建好远程仓库、推上去之后，README 顶部的 CI 徽章按注释里的说明替换 URL 即可。

## 部署

### 方式一：交给后端仓库的 compose 统一编排（推荐）

本仓库提供了 `Dockerfile`（多阶段构建的 Nuxt 4 SSR 镜像）。
上线时**不需要单独起它** —— 后端仓库的 `docker-compose.prod.yaml` 里已经包含
一个 `frontend` 服务，会构建本镜像，并和后端、数据库一起编排：

```bash
# 默认假设两个仓库是同级目录，例如 /srv/yiguixingtu 与 /srv/yiguixingtu-web
cd /srv/yiguixingtu
# 准备好 .env（变量清单见后端仓库 README 的「部署」章节）
docker compose -f docker-compose.prod.yaml up -d --build
```

一次就把 4 个容器都起起来（mysql / redis / backend / frontend），
并且在同一个内网里 —— 前端用服务名 `backend` 直接访问后端。

> 前端仓库不在同级目录时，在 `.env` 里指定 `FRONTEND_DIR=/你的/实际/路径`。

### 方式二：单独构建与运行

```bash
docker build -t yiguixingtu-web .

docker run -d --name yiguixingtu-web \
  -p 3000:3000 \
  -e NUXT_PUBLIC_API_BASE=https://你的域名/api \
  -e NUXT_API_BASE_SERVER=http://后端地址:8082 \
  yiguixingtu-web
```

### 两个环境变量的分工（**部署时最要紧的一点**）

镜像只构建一次，两个地址在**运行时**用环境变量注入：

| 变量 | 谁在用 | 填什么 |
|---|---|---|
| `NUXT_PUBLIC_API_BASE` | **浏览器** | 对外可访问的后端地址，例如 `https://你的域名/api`。它会打进前端产物，**不能放密钥** |
| `NUXT_API_BASE_SERVER` | **服务端渲染** | 后端的内网地址，例如 `http://backend:8082`。SSR 直连内网，不用绕公网域名 |

**为什么必须分开**：文章详情页是 SSR 的，请求发生在服务器上。
如果那时也去请求公开域名，等于绕一圈 DNS + Nginx 再回到同一台机器，
白白多几十毫秒；域名没配好时 SSR 还会直接失败。
（选地址的逻辑在 `app/composables/useApi.ts` 的 `resolveApiBase()`。）

**镜像里没有 nginx**：Nuxt 的构建产物 `.output/server/index.mjs` 本身就是
一个 Node 服务，同时负责渲染页面和提供静态资源，对外统一由宿主机的 Nginx 反代。

### 上线前的检查

| # | 检查项 |
|---|---|
| 1 | `NUXT_PUBLIC_API_BASE` 是真实域名，且与后端的 `CORS_ALLOWED_ORIGINS` 对得上 |
| 2 | 浏览器打开站点，F12 里没有跨域报错 |
| 3 | 文章详情页"查看源代码"能看到正文（说明 SSR 生效，对 SEO 很重要） |
| 4 | 后端地址用的是服务名/内网地址，不是 `localhost`（容器里的 `localhost` 指容器自己） |


**测试环境**：Vitest 5 + `@nuxt/test-utils` 4，跑在 **nuxt 环境**而不是裸的 jsdom。

> **为什么必须用 nuxt 环境？** 被测代码用的是 Nuxt 自动导入的 API
> （`useRuntimeConfig` / `useCookie` / `useState` / `$fetch`），
> 这些在裸 node / jsdom 里根本不存在。用 nuxt 环境测的是"代码在 Nuxt 里的真实行为"，
> 而不是把所有依赖都 mock 掉自己骗自己。

**当前 9 个测试文件、121 个用例：**

| 测试文件 | 用例数 | 覆盖 |
|---------|:---:|------|
| `test/useApi.nuxt.spec.ts` | 17 | 请求封装的**四条失败分支**（业务 code≠200 / 401 / 403 / 网络异常）、token 是否带上、baseURL 与参数透传、`resolveApiBase` 服务端与浏览器两种地址 |
| `test/useAuth.nuxt.spec.ts` | 6 | 登出链路：**会调用后端** `POST /auth/logout`、带上当前 token、清空 `token` 与 `user`、接口失败也照样清本地、不再跳到不存在的 `/login` |
| `test/useAuthUi.nuxt.spec.ts` | 6 | 登录/注册弹窗开关的**互斥**、`closeAll`、跨组件共享同一份状态 |
| `test/useUpload.nuxt.spec.ts` | 16 | 图片上传：扩展名白名单（含大写、无扩展名、脚本文件）、大小边界（正好等于上限 / 超一字节）、空文件；以及请求拼装——**字段名必须是 `file`**、**不能手动设 Content-Type**（设了会丢 boundary）、401 不抛异常 |
| `test/useArticleFilter.nuxt.spec.ts` | 28 | 首页筛选条件：地址栏 → 状态的解析（非法 `categoryId`、重复键、trim）、状态 → 地址栏的序列化（空值不写）、状态 → 后端参数的拼装；以及**防抖**（299ms 不生效 / 300ms 生效、连续输入只生效最后一次）与**双向同步**（后退同步回状态且不反向写一次、连点同一分类不重复写） |
| `test/index.nuxt.spec.ts` | 15 | 挂载整个首页：分类按钮渲染与高亮、点分类后**请求参数 + 地址栏 + 标题**三处同步、筛选变化回到第 1 页、**带 `?keyword=&categoryId=` 的地址打开等于刷新**（输入框回填、首屏请求就带条件）、输入防抖（299ms 不发请求）、分类接口失败/返回非数组时**不崩只是不显示筛选条**；以及个人卡片的三个数字来自 `GET /article/stats`（列表里两篇浏览量合计只有 8，卡片显示 28 才说明不是当前页求和）、统计接口失败显示「—」而不是 0 |
| `test/useSiteStats.nuxt.spec.ts` | 17 | 站点统计：请求路径与参数、三个字段的**归一化**（`data` 为 null / 缺字段 / 字符串 / 负数一律收成能显示的数量，不能出现 NaN）、**失败降级**（业务 code≠200 / HTTP 500 / 请求层直接抛异常都不抛给页面，数字保持 0 并立起 failed）、成功后再次失败**保留旧数字**、失败后重试能恢复 |
| `test/admin.nuxt.spec.ts` | 8 | 挂载整个后台：进入 `/admin` 就**主动**请求统计接口（不用先点「概览」菜单）、概览四张卡片显示真实数字、文章数标明"已发布"口径且不再有写死的「标签 0」、切到概览会再拉一次、在用户管理里筛选**不影响**概览的用户数、统计接口失败/抛异常时显示「—」且页面其余部分照常 |

**为什么先测这几个**：
- `useApi` 是全部请求的唯一出口，页面自己不做错误处理，全靠它返回的 `ok` / `code`。
  它一旦写错，表现是"页面没反应"或"提示文不对题"——比如把 401 当成网络异常，
  用户永远只看到"网络异常"，真正的原因（登录过期）不显示。
- `useAuthUi` 只有 20 行，但两个弹窗的互斥是它唯一且关键的不变量，
  坏了会出现两个弹窗叠在一起，肉眼回归很容易漏。
- `useUpload` 的两个坑在界面上都表现为一句"上传失败"，看不出原因：
  字段名写错后端收不到文件；手动设了 `Content-Type` 会丢掉 boundary 导致解析失败。
  用断言把"发出去的请求长什么样"钉住，改坏了立刻红。
- `useArticleFilter` 的三类错误（不防抖 → 按字发请求、只同步一个方向 → 地址栏和输入框
  各说各话、空值照写 → 地址栏里全是 `?keyword=`）在界面上都不显眼，
  但都会被用户直接感受到，所以用时间可控的假时钟把边界卡死。
- `index.nuxt.spec.ts` 是**第一个组件测试**：组合式函数测的是"逻辑对不对"，
  它测的是"页面把逻辑接上去了没有"——v-model 绑错变量、按钮忘了传参这类问题
  编译器管不了，只测 composable 也管不了。
- `useSiteStats` 的两个行为在界面上都看不出来（接口一直正常的话永远遇不到）：
  失败时到底是显示 0 还是占位、接口给了 null / 字符串 / 负数时会不会在页面上
  印出 NaN。数字不对是最难被发现的一类 bug，所以用断言钉死。
- `admin.nuxt.spec.ts` 守的是**页面接线**：概览的数字必须来自独立请求，
  而不是"你点过哪些菜单、筛过什么条件"。这种"看着有数、其实是别的数"的问题
  只能靠挂载整个页面来测。

> 组件测试用 `mountSuspended(组件, { route: '/?keyword=nuxt' })` 造"刷新页面"的场景；
> 断言地址栏时不能只 `await flushPromises()`——`router.replace()` 还要过一遍导航守卫
> （Nuxt 的 navigation-repaint 插件会在里面等一次 `requestAnimationFrame`），
> 所以测试里有一个 `settleRoute()` 专门多等一个宏任务。

## 页面与功能

| 页面 | 路由 | 说明 | 需要登录 |
|------|------|------|:---:|
| 首页 | `/` | 文章信息流、关键词搜索（300ms 防抖）、分类筛选、筛选条件同步到地址栏、加载更多分页；个人卡片的文章数 / 浏览量 / 分类数来自 `GET /article/stats` | 否 |
| 文章详情 | `/article/:id` | Markdown 正文渲染，已发布文章可访问 | 否 |
| 后台 | `/admin` | 用户管理 + 文章管理；概览显示全站汇总数字（进入页面即主动加载） | **是（ADMIN）** |

首页的**搜索与分类筛选**是一套状态、一次请求：
关键词与分类一起写进地址栏（`/?keyword=nuxt&categoryId=2`），也一起发给后端
（`GET /article/page?page=&size=&keyword=&categoryId=`）。
带着这样的地址刷新、或者把链接发给别人，打开时筛选状态会原样恢复。
细节见下文「搜索与分类筛选为什么要这么写」。

后台文章编辑弹窗里的**封面是上传的**（不是填 URL）：
点"上传封面"选图 → 前端先做类型与大小预检 → 传到 `POST /upload` →
把返回的 URL 回填到表单 → 保存文章时一起提交。右侧有预览和"移除"。

> 前端预检只是**体验优化**（本地即时反馈、不浪费用户的上行带宽），
> 真正生效的是后端那一层——前端代码可以被绕过（直接调接口）。
> 两边的规则保持一致：`jpg / jpeg / png / gif / webp`，单张 ≤ 5MB。

全局交互：

- 首页右上角可打开**登录 / 注册弹窗**
- 未登录访问 `/admin` 会被路由守卫拦下并弹登录框
- 顶部导航栏在登录后显示昵称，可退出登录

### 几个刻意的实现细节

**应用外壳（`app.vue`）**

- **它才是真正的外壳**，不是每个页面各自搭一遍导航：导航栏、页脚、登录/注册弹窗、
  背景视频都在这里，页面只管内容区
- **刷新页面后能恢复登录态**：`useState('user')` 刷新后是 null，但 cookie 里的 token 还在，
  所以挂载时用 `GET /auth/me` 把用户信息补回来，顶部才能正确显示昵称和角色
- **sticky footer**：外壳是纵向 flex + `min-height: 100vh`，内容区 `flex: 1`，
  这样内容不足一屏时（后台页、文章页）页脚也贴在底部，不会在下面空出一片
- **背景视频在标签页切到后台时暂停**（监听 `visibilitychange`），
  避免看不见的时候还一直占用 CPU / GPU

**文章详情（`app/pages/article/[id].vue`）**

- **服务端渲染**：用 `useAsyncData` 而不是 `onMounted` + `ref`，
  服务端会**等数据回来再渲染**，所以 HTML 里直接带着正文 —— 这对 SEO 是决定性的
- **安全**：正文用 `md-editor-v3` 的**只读渲染组件 `MdPreview` 渲染，不是自己 `v-html`**。
  它内部接了 xss 白名单过滤，危险标签和属性会被清掉；
  自己拼 `v-html` 就是把用户/文章内容当代码执行
- **软 404**：文章不存在或未发布时 `throw createError({ statusCode: 404 })`，
  交给 `error.vue` 渲染成正常的错误页（而不是浏览器默认的报错页）
- 只读渲染组件比编辑器组件体积小得多，所以详情页不引入 `MdEditor`

**全局错误页（`error.vue`）**

- 按状态码给不同文案：404 / 403 / 401 / 500 各自说明"发生了什么、可以怎么办"，
  而不是统一一句"页面出错了"
- `useHead` 会把状态码写进页面标题（如「404 · 亿轨星途」）

**搜索与分类筛选为什么要这么写（`useArticleFilter.ts` + `index.vue`）**

筛选条件只有两个（关键词、分类），但坑都在细节里：

- **关键词在输入框里和在请求里是两个变量**：`keywordInput`（输入框即时显示，打字不卡）
  与 `keyword`（生效中）。防抖只在"输入 → 生效"这一步做一次，请求、地址栏、标题
  全都读 `keyword`。
  第一版只把"写地址栏"防抖、请求却盯着输入框，结果**每敲一个字照样发一次请求** ——
  防抖等于没做（后端对 `/article/page` 还有 300 次/分钟的限流）。
- **筛选条件写进地址栏，且用 `replace` 而不是 `push`**：搜索是连续微调的操作，
  每个中间状态都进历史记录的话，用户按一次后退只退回上一个关键词，想离开首页要按十几次。
- **双向同步**：浏览器前进/后退（或别处改了 query）也会把地址栏同步回状态，
  否则输入框和地址栏各说各话，用户会觉得"后退失灵"。同步时有一道
  「地址栏已经等于目标值就不写」的判断，否则会形成"后退 → 再往前写一次"的循环。
- **空值不写进地址栏**：不出现 `?keyword=&categoryId=`，让"什么都没筛"只有一种表示。
- **点分类时先把待生效的关键词落地**：用户"打完字还没停手就点了分类"时，
  两个条件要在同一次写入、同一次请求里生效，而不是先按旧关键词拉一遍、300ms 后再拉一遍。
- **回到第 1 页**：筛选条件一变就重置页码。否则会出现"第 3 页 + 新关键词"这种
  后端并不存在的组合，用户只会看到空列表。
- **分类拿不到就不显示筛选条**：接口失败、或者返回的不是数组时（`.find` 会直接抛错
  把首页渲染带崩），一律当成空分类 —— 一排空按钮比没有更糟。

**站点统计为什么必须走后端接口（`useSiteStats.ts`）**

首页个人卡片与后台概览的数字都来自 `GET /article/stats`，而不是前端自己算：

- **口径只能有一个地方定**：改之前首页的文章数是 `/article/page` 的 `total`
  （加了筛选就变成"符合条件的篇数"）、浏览量是已加载文章的 `reduce` 求和
  （点一次「加载更多」数字就变）、分类数是当前页列表长度 —— 三个数字三种口径。
  现在合并成后端一条聚合 SQL，前端只负责显示；以后要改口径也是改后端。
- **成本更低**：前端求和得先把文章全拉回来；聚合查询只回一行。
- **失败必须降级**：这三个数字出现在首屏，接口挂掉绝不能连累整页渲染。
  `useSiteStats` 不抛异常，失败时把数字留成 0（或上一回的值）、把 `failed` 立起来，
  由页面显示「—」。**为什么不用 0 代替**：0 是一个"确定的答案"，
  访客会以为站点真的没有文章；「—」才是诚实的"暂时读不到"。
- **失败时保留旧数字**：有上一回成功的数据时，宁可真值 + 占位，也不要清零。
- **后台概览的用户数是独立的一次 `page=1&size=1` 查询**，
  不复用用户表格的 `total` —— 那个会被管理员在用户管理页设的筛选条件影响，
  而概览要的是"全站有多少用户"。`size=1` 是因为只要 `total` 这个总数，
  不需要真把那一页数据拉回来。
- **进页面就主动加载**：概览的数字不再依赖"你点开过哪些菜单"；
  切到「概览」菜单时再刷新一次，这样刚发布完文章回到概览看到的是新数字。

## 依赖的后端接口

前端共调用后端 **20 个接口中的 20 个**：

| 页面 | 调用的接口 |
|------|-----------|
| 首页 | `GET /article/page`、`GET /article/stats`、`GET /category/list` |
| 文章详情 | `GET /article/{id}` |
| 登录 / 注册 | `POST /auth/login`、`POST /auth/register`、`GET /auth/me`、`POST /auth/logout` |
| 后台 · 概览 | `GET /article/stats`、`GET /user/page` |
| 后台 · 用户管理 | `GET /user/page`、`PUT /user/{id}/status`、`PUT /user/{id}/role`、`PUT /user/{id}/password`、`DELETE /user/{id}` |
| 后台 · 文章管理 | `GET /admin/article/page`、`GET /admin/article/{id}`、`POST /admin/article`、`PUT /admin/article/{id}`、`PUT /admin/article/{id}/status`、`DELETE /admin/article/{id}` |
| 后台 · 封面上传 | `POST /upload` |

> 20 个接口全部用上了。`GET /article/stats` 是后端最近新增的公开接口，
> 首页个人卡片与后台概览都用它，口径（**只统计已发布文章**）由后端一条聚合 SQL 决定；
> `POST /auth/logout` 见下方「已知待办」里的说明。

## 已知待办

以下是当前版本明确存在、已列入计划的问题（详见后端仓库的 `TECH_ROADMAP.md`）：

**认证与状态**

- **「记住密码」把明文密码存在 Cookie 里** —— 应该只记用户名，或改成"记住登录状态"标记
- 刷新页面后靠 `GET /auth/me` 恢复登录态（`useState('user')` 刷新会丢），
  这一步是必要的；但 `/auth/me` 会额外查一次库，后端把它去掉更好

> ✅ 曾经的「退出登录没有调用后端」已经修好了：现在 `useAuth().logout()` 会先调
> `POST /auth/logout`（后端按 `jti` 把当前 token 拉黑，**旧 token 立刻失效**），
> 再清空 `token` 与 `user`，最后才跳回首页。接口失败也照样清本地 ——
> 用户点退出就是想离开，不能因为网络抖动把他困住。
> 同时删掉了原来指向不存在页面 `/login` 的死代码。

**数据不真实**

- 首页有**三处硬编码的假数据**，都藏在需要点开的面板里（所以直接看首页 HTML 不一定发现）：
  | 位置 | 假在哪 |
  |---|---|
  | 侧边「留言」浮窗 | 两条留言「访客A」「访客B」是写死的数组，不是真评论（后端还没有评论模块） |
  | 顶部在线人数 | 「1 人正在看」是写死的字符串 |
  | 音乐播放器 | 三首曲目名（雨落星轨 / 夜航 / 星际漫游）是写死的，实际只有一个音频文件 |
- GitHub / 邮箱 / RSS 按钮尚未接真实地址
- 导航栏的「技术 / 读书 / 随笔 / 收藏 / 项目 / 友链」六个入口点了只弹"该页面开发中"

> ✅ 曾经的「首页统计数字不真实」已经修好了：个人卡片的文章数 / 浏览量 / 分类数
> 改成走后端 `GET /article/stats`（口径：只统计已发布文章，由后端一条聚合 SQL 算好）。
> 改之前三个数字各有各的口径——文章数是"当前筛选条件下的篇数"、浏览量是
> "已加载的 12 篇之和"（点一次「加载更多」数字就变）、分类数是当前页列表长度。
> 接口失败时显示「—」而不是 0（0 会被访客当成"站点真的没有文章"）。

> ✅ 曾经的「后台概览数字不可靠」也已经修好了：概览的四个数字改成**独立请求**
> （文章 / 浏览量 / 分类走 `GET /article/stats`，用户数走一次 `page=1&size=1` 的
> `/user/page` 只取总数），进入 `/admin` 就并行拉好、切到「概览」菜单再刷新一次。
> 改之前它们取的是用户表格 / 文章表格 / 分类列表的变量，而那些表格是"点开哪个菜单
> 才加载"的——直接进后台点概览，四个数字全是 0；在用户管理里筛了"禁用"，
> 概览的用户数又变成禁用用户数。
> 同时删掉了写死的「标签 0」那张卡片（后端还没有标签模块，摆一个永远不变的数字
> 只会让人误以为有这个功能），并把「后台骨架已就绪，等你对接后端接口」这句
> 开发期占位文案换成了对数据口径的说明。

**工程**

- **端到端（Playwright）测试还没有**：目前是组合式函数单测 + 首页组件测试
  （组件测试覆盖了"页面把逻辑接上去了没有"，但跨页面跳转、真实后端联调还测不到）
- **仓库还没有 GitHub 远程地址**，CI 工作流已就位但尚未真正跑过一次
- `app/pages/admin.vue` 单文件 **1001 行**，用户表格 / 文章表格 / 编辑器弹窗都挤在一个文件里
- Element Plus 是全量引入（`app/plugins/element-plus.ts`），没有按需加载
- 用了 Element Plus 的 `el-dialog` 但**没有注入 z-index / id provider**，
  服务端渲染时控制台会刷一大堆 `ZIndexInjection` / `IdInjection` 警告
  （不影响功能，但把真正的报错淹掉了，该修）

## 许可证

尚未指定许可证。若计划开源，建议补充一份 MIT 的 `LICENSE` 文件。
