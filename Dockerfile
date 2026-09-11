# =====================================================================
# 前端镜像（Nuxt 4 SSR，多阶段构建）
#
# 【为什么要多阶段】
#   构建 Nuxt 需要 node_modules（几百 MB）和源码；
#   而运行 SSR 服务其实只需要 `nuxt build` 产出的 .output 目录 + 一个 Node 运行时。
#   多阶段把这两件事分开，最终镜像里没有源码、没有 node_modules、没有 devDependencies，
#   体积小得多，也少了一大堆"用不到但可能被利用"的包。
#
# 【为什么用 SSR 而不是 SSG（nuxt generate）】
#   站点的文章详情页靠服务端渲染把正文写进 HTML（对 SEO 是决定性的），
#   而且内容是随时更新的，用 SSR 不需要每次发文都重新构建一遍站点。
#
# 【构建命令】
#   docker build -t yiguixingtu-web .
# =====================================================================


# ---------------------------------------------------------------------
# 阶段一：构建
#
# Node 版本与本地验证时保持一致（本地是 24）：
# 跨 Node 版本的行为差异（尤其是构建工具链）是最难查的一类问题，
# 所以这里锁 24，而不是写一个自己没验证过的版本去赌。
# ---------------------------------------------------------------------
FROM node:24-alpine AS builder

WORKDIR /build

# 【先只拷 package.json + lock，单独装依赖，再拷源码】
#   Docker 是分层的：只要这两个文件没变，改业务代码不会触发重新装依赖。
#   前端依赖安装本来就慢，这一步能省掉大量重复等待。
COPY package.json package-lock.json ./

# 【npm 依赖走国内镜像 —— 与后端 Dockerfile 里那个 Maven 镜像源同一个套路】
#
#   ⚠️ 实测（服务器上，2026-09-11）：
#     `curl -o /dev/null -w '%{time_total}' https://registry.npmjs.org/nuxt` → **3.5 秒**
#     一次元数据请求就要 3.5 秒，而 `npm ci` 要拉几百个包、合计几百 MB。
#     在 2 核 2G 的机器上，这会把构建时间拖到不可接受，而且中途失败的概率明显上升
#     （失败时只有一句 "network timeout"，看不出是镜像源的问题）。
#
#   【为什么换镜像源是安全的】package-lock.json 里每个包都带 integrity（sha512），
#   npm 装完会逐个校验。镜像站只能决定"从哪里下"，换不掉包的内容 ——
#   校验不通过会直接报错，而不是悄悄装上一个被改过的包。
#   这一条和"不要用不知名的 Docker 加速站"不一样：那个换的是镜像层，没有等价的校验。
#
#   想换别的源 / 想验证是否真是源的问题：构建时传 --build-arg NPM_REGISTRY=...
#   （传 https://registry.npmjs.org 即回到官方源）
ARG NPM_REGISTRY=https://registry.npmmirror.com

# 用 npm ci 而不是 npm install：严格按 lock 文件安装，
# 保证"镜像里装的依赖"和"本地验证过的依赖"完全一致
RUN npm config set registry "$NPM_REGISTRY" && npm ci

COPY . .

# 生产构建。
# ⚠️ 注意这里【不需要】后端在运行：nuxt build 只做静态分析与打包，不发任何后端请求。
RUN npm run build


# ---------------------------------------------------------------------
# 阶段二：运行
# ---------------------------------------------------------------------
FROM node:24-alpine

WORKDIR /app

# Nuxt 的构建产物是一个自带的 Node 服务：
#   .output/server/index.mjs
# 它同时负责渲染页面和提供静态资源，所以【不需要】再装 nginx 到镜像里
# （对外统一由宿主机上的 Nginx 反代）。
COPY --from=builder /build/.output ./.output

ENV NODE_ENV=production
# 【必须是 0.0.0.0】容器里监听 127.0.0.1 的话，只有容器自己连得上，
# 宿主机的 Nginx 反代会连不上 —— 这是容器化部署最常见的坑之一
ENV HOST=0.0.0.0
ENV PORT=3000

EXPOSE 3000

# node 官方镜像自带一个非 root 的 node 用户（uid 1000），直接用它，
# 不必像后端那样自己 useradd。容器默认以 root 跑，应用被攻破时
# 攻击者拿到的就是容器内 root，切换成无特权用户是成本最低的一道纵深防御。
USER node

CMD ["node", ".output/server/index.mjs"]
