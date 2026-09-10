# yiguixingtu-web — 个人博客前端

> 基于 Nuxt 4 + Vue 3 + Element Plus 的个人博客前端
> 后端为独立仓库 `yiguixingtu`（Spring Boot 4，默认跑在 `localhost:8082`）

## 项目简介

这是个人博客 **忆轨星途** 的前端站点，包含**前台展示**和**后台管理**两部分：

- **前台**：首页文章信息流（分页 + 关键词搜索）、文章详情（Markdown 渲染）
- **后台**：登录后进入 `/admin`，可管理用户（分页 / 启用禁用 / 改角色 / 重置密码 / 删除）
  与文章（Markdown 编辑器 / 草稿与发布 / 下架 / 删除）

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

## 目录结构

```
yiguixingtu-web
├── app
│   ├── app.vue                      # 应用外壳：全局布局、登录/注册弹窗、背景视频与音乐
│   ├── error.vue                    # 全局错误页（404 / 403 / 401 / 500 分类文案）
│   ├── pages
│   │   ├── index.vue                # 首页：文章信息流 + 搜索 + 加载更多
│   │   ├── admin.vue                # 后台：用户管理 + 文章管理 + Markdown 编辑器
│   │   └── article/[id].vue         # 文章详情（SSR + Markdown 渲染 + 软 404）
│   ├── composables
│   │   ├── useApi.ts                # 统一请求封装：带 token、判 body.code、401/403 处理
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
```

> Nuxt 的 `runtimeConfig` 会自动把 `NUXT_PUBLIC_API_BASE` 映射到
> `runtimeConfig.public.apiBase`，所以改地址**不需要动代码**。

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

## 页面与功能

| 页面 | 路由 | 说明 | 需要登录 |
|------|------|------|:---:|
| 首页 | `/` | 文章信息流、关键词搜索、加载更多分页 | 否 |
| 文章详情 | `/article/:id` | Markdown 正文渲染，已发布文章可访问 | 否 |
| 后台 | `/admin` | 用户管理 + 文章管理 | **是（ADMIN）** |

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

## 依赖的后端接口

前端共调用后端 **18 个接口中的 17 个**：

| 页面 | 调用的接口 |
|------|-----------|
| 首页 | `GET /article/page`、`GET /category/list` |
| 文章详情 | `GET /article/{id}` |
| 登录 / 注册 | `POST /auth/login`、`POST /auth/register`、`GET /auth/me` |
| 后台 · 用户管理 | `GET /user/page`、`PUT /user/{id}/status`、`PUT /user/{id}/role`、`PUT /user/{id}/password`、`DELETE /user/{id}` |
| 后台 · 文章管理 | `GET /admin/article/page`、`GET /admin/article/{id}`、`POST /admin/article`、`PUT /admin/article/{id}`、`PUT /admin/article/{id}/status`、`DELETE /admin/article/{id}` |

> 唯一没被调用的 `POST /auth/logout` —— 原因见下方「已知待办」。

## 已知待办

以下是当前版本明确存在、已列入计划的问题（详见后端仓库的 `TECH_ROADMAP.md`）：

**认证与状态**

- **退出登录没有调用后端**，也没有清空本地用户状态（所以顶栏的昵称还在，要刷新才消失）。
  后端 `POST /auth/logout` 目前也是空实现，两边都要补
- **「记住密码」把明文密码存在 Cookie 里** —— 应该只记用户名，或改成"记住登录状态"标记

**数据不真实**

- 首页统计数据由**当前已加载的列表**本地求和得出，不是全站数字
- 首页有**三处硬编码的假数据**，都藏在需要点开的面板里（所以直接看首页 HTML 不一定发现）：
  | 位置 | 假在哪 |
  |---|---|
  | 侧边「留言」浮窗 | 两条留言「访客A」「访客B」是写死的数组，不是真评论（后端还没有评论模块） |
  | 顶部在线人数 | 「1 人正在看」是写死的字符串 |
  | 音乐播放器 | 三首曲目名（雨落星轨 / 夜航 / 星际漫游）是写死的，实际只有一个音频文件 |
- **后台「概览」的四个数字都不可靠**，各不相同的问题：
  | 指标 | 当前取自 | 问题 |
  |---|---|---|
  | 文章 | `artTotal` | 是**当前筛选条件下**的文章数，不是全站 |
  | 用户 | `total` | 同上，且 1 页只有 10 条时分页总数与"用户总数"含义不同 |
  | 分类 | `categories.length` | 取到了真实数据，但它是**按当前页**的列表长度 |
  | 标签 | 写死的 `0` | 后端还没有标签模块 |
  而且进入后台默认停在「用户管理」，概览要**点了菜单才有数据**——数字取决于你点过哪些菜单
- 概览页那句「后台骨架已就绪，等你对接后端接口」是开发期的占位文案，现在早就对接完了，
  文案没跟着改
- GitHub / 邮箱 / RSS 按钮尚未接真实地址
- 导航栏的「技术 / 读书 / 随笔 / 收藏 / 项目 / 友链」六个入口点了只弹"该页面开发中"

**工程**

- 分类数据已经拉取但**还没有筛选 UI**
- 后端地址目前写在 `nuxt.config.ts` 里，尚未按环境区分
- **尚未接入前端测试与 CI**
- `app/pages/admin.vue` 单文件 **1001 行**，用户表格 / 文章表格 / 编辑器弹窗都挤在一个文件里
- Element Plus 是全量引入（`app/plugins/element-plus.ts`），没有按需加载

## 许可证

尚未指定许可证。若计划开源，建议补充一份 MIT 的 `LICENSE` 文件。
