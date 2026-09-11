// ============================================================
// app/utils/media.ts
//
// 作用：把「不进构建产物的大文件」的地址集中约定在一处。
//
// 【背景：为什么这两个文件要挪出 public/】
//   bg-star.mp4（背景视频）与 bg-music.mp3（背景音乐）合计约 13.7 MiB。
//   放在 public/ 里，Nuxt 会把它们原样拷进 .output/public —— 构建产物从
//   3.5 MB 变成 17.2 MB，而且**每次改一行前端代码都要重新构建、重新上传这十几 MB**，
//   发布节奏被两个和代码无关的文件绑架。它们的部署形态也完全不同：
//   视频要靠 Nginx 直接读磁盘（支持 Range 拖动进度条），没必要绕 Node 进程。
//   所以它们被移到仓库根目录的 static-media/，部署时上传到服务器 /var/www/media/，
//   由 Nginx 用 location /media/ 直接提供（见 static-media/README.md）。
//
// 【为什么必须有一个统一的前缀（而不是各页面各写一份）】
//   dev 和 prod 的 URL 必须**完全一样**：浏览器里写死的地址只有一份，
//   如果开发时是 /bg-music.mp3、线上是 /media/bg-music.mp3，
//   结果就是「本地能播、线上 404」—— 而且首页背景视频炸掉这种事，
//   本地开发时完全看不到（dev 下 Nitro 有一个同路径的开发路由顶着）。
//   所以地址只在这里拼一次，页面只写「哪个文件」，不写前缀、也不写绝对 URL。
//
// 【技术栈与关键字】
//   · 这是 Nuxt 的 app/utils 目录：里面的导出会被**自动导入**，
//     页面里直接写 mediaUrl(...) 即可，不需要 import。
//   · useRuntimeConfig() 是 Nuxt 的运行时配置读取 API：
//     nuxt.config.ts 里的 runtimeConfig.public.mediaBase 可以用环境变量
//     NUXT_PUBLIC_MEDIA_BASE 覆盖（Nuxt 按变量名自动映射），
//     所以「换前缀 / 换到 CDN」是改配置，不是改代码。
//   · MEDIA_FILES 用 Object.freeze 冻结：它是一份常量表，
//     冻结是为了让「不小心改了它」立刻报错，而不是让两个页面用上不同的文件名。
// ============================================================

/** 默认的媒体地址前缀。与 Nginx 的 `location /media/`、dev 路由的路径一致 */
export const DEFAULT_MEDIA_BASE = '/media'

/**
 * 站点里用到的媒体文件名，集中在这里登记。
 * 【为什么不直接在页面里写 'bg-star.mp4'】
 *   文件名和地址前缀是同一件事的两半（都在描述"这个文件从哪取"）。
 *   前缀收在 mediaUrl 里，文件名收在这里，页面里就只剩「哪个媒体」这一层语义；
 *   将来文件改名也只需要改这一个地方，不会出现"页面改了一半"。
 */
export const MEDIA_FILES = Object.freeze({
  /** 全站背景视频（app.vue 的 <video>） */
  backgroundVideo: 'bg-star.mp4',
  /**
   * 背景**底图**：背景视频被关掉 / 还没就位 / 加载失败时，露出来的那一张静态背景。
   *
   * 【它从哪来】2026-09-11 用 ffmpeg 从 `bg-star.mp4` 的第 10 秒抽的一帧：
   *   `ffmpeg -ss 10 -i bg-star.mp4 -frames:v 1 -q:v 3 bg-star.jpg`（960×540 / 47 KB）。
   *   从视频里抽、而不是另找一张图，是为了让"关掉视频"前后的观感**连续** ——
   *   换一张风格不搭的图，用户会以为页面坏了。
   *
   * 【为什么挑第 10 秒那一帧（这一段是暗色的油画风景：山坡、树、土路）】
   *   · **够暗** —— 它会铺满整页、垫在所有内容后面，正文压在上面必须照样读得清
   *   · **整幅铺满画面** —— 视频开头那 3 秒几乎全黑、正中只有一幅小画框，
   *     而页面内容正好居中，等于把画面里唯一有东西的地方盖住了（"看起来什么都没变"）
   *   · 避开 30 秒之后那几帧：天空与麦田很亮，文字压上去要另加遮罩才看得清
   *
   * 【为什么也走 /media/（不进构建产物）】与其它 media 文件同一条理由；
   *   而且它和视频是**同一段素材的两半**，必须一起换、一起传。
   */
  backgroundPoster: 'bg-star.jpg',
  /** 背景音乐的源（app.vue 里那个**唯一的** <audio>；首页卡片与音乐页都只是它的遥控器） */
  backgroundMusic: 'bg-music.mp3',
  /**
   * 背景音乐的歌词（LRC 纯文本）。
   * 【为什么歌词也放在这里】它和音频是"同一首歌的两半"：文件改名、换目录、
   *   换 CDN 前缀时两者必须一起动。登记在这一处之后，音乐页只写"要歌词"，
   *   地址由 mediaUrl() 拼 —— 不会出现"音频搬了、歌词还指着老地址"这种半截改动。
   * 【拿不到怎么办】404 / 空文件一律显示「暂无歌词」，**绝不编歌词**
   *   （本项目的底线：要么真数据，要么不显示）。
   */
  musicLyrics: 'bg-music.lrc',
  /**
   * 唱片的封面回落图：歌曲**没有**内嵌 ID3 封面时用它。
   * 【为什么回落图也走 /media/ 而不是 public/】它是"这首歌的封面"，
   *   和音频一起换、一起传；放在 public/ 里的话改一次封面就要重新构建前端。
   * 【它现在真的存在了】2026-09-11 把 public/cover-1.png 复制了一份到 static-media/
   *   （同一张图，逐字节一致）——在那之前 static-media/ 里没有它，
   *   所以音乐页**永远**走的是 `<img>` 的 onerror 那条路。
   *   ⚠️ 现在仍然保留 onerror 兜底：文件可能被误删、CDN 可能抽风、部署时可能忘了传 ——
   *   那时候页面要显示一个不难看的占位图案，而不是浏览器的破图图标
   *   （见音乐页的 .mp-cover-ph）。
   */
  musicCover: 'cover-1.png',
  /**
   * 公安网安备案的那张小图标（蓝底警徽，36×40）。
   * 【为什么它也走 /media/ 而不是 public/】和前两个文件是同一条理由，
   *   但这里还多一层：**它必须和备案号一起换**。备案号是站点主体相关的信息，
   *   页脚那两项永远是一起改的；把图标放进构建产物，等于"改一次备案展示
   *   就要重新构建并上传一次前端镜像"（这台服务器构建前端很贵）。
   * 【它从哪来】备案通过后由公安部平台提供，本项目放在 static-media/beian.png，
   *   部署时随 static-media/ 一起上传到 /var/www/media/（见 static-media/README.md）。
   */
  policeIcon: 'beian.png',
})

/**
 * 文件名白名单：只允许「字母 / 数字 / 点 / 下划线 / 中划线」，且必须以字母或数字开头。
 *
 * 【为什么要有这条正则，而不是直接拼接】
 *   mediaUrl 是"把外部字符串拼进 URL"的地方，这类拼接是路径穿越（../）
 *   最常见的入口。这里的调用方虽然全是本仓库写死的常量，但：
 *     ① 规范化一次的成本比出事之后排查低得多；
 *     ② 服务端那个 dev 路由用的是同一套规则（见 server/utils/mediaFile.ts），
 *        两边一致才不会出现"前端敢拼、服务端不认"的错位。
 *   以字母/数字开头顺便挡掉了 ..、. 和隐藏文件（.env 这种）。
 */
const SAFE_MEDIA_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/**
 * 判断一个文件名能不能安全地拼进媒体地址。
 * 【为什么还要额外挡 '..'】正则里已经不允许以点开头，正常输入不可能命中；
 *   但"文件名中间出现 .."（如 a/../../../x、a..b）这种边界上，
 *   显式再判一次比依赖正则的细节更不容易被后来的修改破坏。
 */
export const isSafeMediaName = (name) =>
  typeof name === 'string' && SAFE_MEDIA_NAME.test(name) && !name.includes('..')

/**
 * 校验文件名，不合法就抛错。
 *
 * 【为什么是"抛错"而不是返回空串或原样返回】
 *   调用方传进来的名字来自上面的 MEDIA_FILES 常量，不来自用户输入 ——
 *   也就是说，不合法只可能是**我们自己写错了**（或者有人试图把用户输入拼进来）。
 *   这种情况静默返回一个坏 URL 会变成线上一个查半天的 404；
 *   抛错则在开发阶段就炸在眼前。这里失败得快，比失败得安静好。
 */
export const assertSafeMediaName = (name) => {
  if (!isSafeMediaName(name)) {
    throw new Error(`[media] 非法的媒体文件名：${String(name)}（只允许字母数字点下划线中划线，且不以点开头）`)
  }
  return name
}

/**
 * 把前缀收拾整齐：去空白、去掉结尾多余的斜杠。
 * 【为什么允许整串是完整 URL】现在媒体由本机 Nginx 提供，前缀是 `/media` 这样的
 *   站点内路径；但哪天文件挪到 OSS / CDN，前缀就变成 `https://.../media`。
 *   这一步只做"拼接前的规范化"，两种形态都能直接用，不用改代码。
 * 空值 / 非字符串一律回到 DEFAULT_MEDIA_BASE：宁可回到默认前缀，
 * 也不要拼出 `/bg-music.mp3`（少了前缀）或者 `undefined/bg-music.mp3` 这种地址。
 */
export const normalizeMediaBase = (base) => {
  if (typeof base !== 'string' || !base.trim()) return DEFAULT_MEDIA_BASE
  return base.trim().replace(/\/+$/, '')
}

/**
 * 纯函数：前缀 + 文件名 → 完整地址。测试里可以直接调用它，
 * 不需要 Nuxt 上下文（那是 mediaUrl 才需要的）。
 */
export const joinMediaUrl = (base, name) => `${normalizeMediaBase(base)}/${assertSafeMediaName(name)}`

/**
 * 取当前生效的媒体前缀（运行时配置优先）。
 *
 * 【为什么要包一层 try/catch】
 *   useRuntimeConfig() 依赖 Nuxt 上下文，在纯粹的函数单测（或将来在非 Nuxt
 *   环境里复用这段代码）里调用会直接抛「nuxt instance unavailable」。
 *   这里不希望"读不到配置"升级成"页面炸掉"：读不到就回落到默认前缀，
 *   也就是和 nuxt.config.ts 里的默认值完全一致的那个值，行为可预期。
 */
export const getMediaBase = () => {
  try {
    return normalizeMediaBase(useRuntimeConfig()?.public?.mediaBase)
  } catch {
    return DEFAULT_MEDIA_BASE
  }
}

/**
 * 【页面唯一该用的出口】按约定取媒体地址。
 *
 * 用法（在 <script setup> 里取一次，模板里不要再拼字符串）：
 *   const bgMusicSrc = mediaUrl(MEDIA_FILES.backgroundMusic)   // → /media/bg-music.mp3
 *
 * @param {string} name static-media/ 下的文件名
 * @returns {string} 形如 /media/bg-music.mp3 的地址
 */
export const mediaUrl = (name) => joinMediaUrl(getMediaBase(), name)
