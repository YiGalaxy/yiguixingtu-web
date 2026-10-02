# 近期变更

## 2026-10-02

- 统一首页、文章、项目、音乐、归档、收藏、友链和关于页面的像素风格背景。
- 首页夜间背景改用 `public/assets/homepage-night-clear.png` 高清静态图。
- 修复背景层高度导致页面底部出现空白的问题。
- 游客访问公开接口时不再因失效 token 弹出登录过期提示。
- 登录和注册输入框改为单层像素边框。
- 更新站点 favicon、Apple touch icon 和页眉品牌图标。
- 后台 Redis 本地 Compose 端口固定为 `6380`。

## 验证

前端已通过 `npm run lint`、`npm run build` 和 `git diff --check`。
