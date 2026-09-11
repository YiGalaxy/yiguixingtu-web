import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { join } from 'node:path'

// =====================================================================
// 媒体地址（app/utils/media.ts）与 dev 媒体路由的纯逻辑（server/utils/mediaFile.ts）
//
// 【为什么这两块要合在一个文件里测】
//   它们守的是同一条规矩："/media/<文件名>" 这个约定在前后端是同一份"。
//   前端负责拼出这个地址，服务端（dev 路由）负责按这个地址找到文件。
//   两边一旦对不上，表现是首页背景视频 / 音乐 404 —— 而这种事本地可能
//   一直看不到（如果只在配置里改了一边）。放在一起测，改坏哪一边都会红。
//
// 【为什么非法文件名要一个个列出来断言】
//   路径穿越（../）不是"功能没做完"，而是"能读到不该读的文件"。
//   这类判断正则在正常输入下永远看起来是对的，只有在边界输入上才会暴露，
//   所以把能想到的变形都写进用例：斜杠、反斜杠、URL 编码、双点、
//   隐藏文件、"看起来对但扩展名换了"。
// =====================================================================

// 服务端那部分逻辑是纯函数，直接引入即可（它不进 app/ 的自动导入范围）
import { parseRangeHeader, resolveMediaFile } from '../server/utils/mediaFile'

describe('mediaUrl：媒体地址的唯一拼接点', () => {
  // 用例里会改运行时配置（模拟"换前缀"），跑完必须还原，
  // 否则会污染同一个文件里后面的用例。
  //
  // 【为什么原始值不能写在 describe 体里直接读】
  //   describe 体在"收集用例"阶段执行，那时还没有 Nuxt 上下文，
  //   useRuntimeConfig() 会抛 NUXT_E1001（nuxt instance unavailable）。
  //   放进 beforeAll 之后才是在 Nuxt 上下文里跑 —— 这也是 app/utils/media.ts
  //   里 getMediaBase() 要包一层 try/catch 的同一个原因。
  let originalBase
  beforeAll(() => {
    originalBase = useRuntimeConfig().public.mediaBase
  })
  afterEach(() => {
    useRuntimeConfig().public.mediaBase = originalBase
  })

  // ---------------------------------------------------------------
  // 一、前缀必须是对的
  // ---------------------------------------------------------------

  it('默认前缀_should是 /media（与 Nginx 的 location /media/ 一致）', () => {
    expect(mediaUrl('bg-music.mp3')).toBe('/media/bg-music.mp3')
  })

  it('两个真实存在的媒体文件_should都能拼出正确地址', () => {
    // 断言的是"页面上真正用到的地址"，而不是随便编一个文件名：
    // 这两个常量是 app.vue 的 <video> 与 index.vue 的 <audio> 用的那一份
    expect(mediaUrl(MEDIA_FILES.backgroundVideo)).toBe('/media/bg-star.mp4')
    expect(mediaUrl(MEDIA_FILES.backgroundMusic)).toBe('/media/bg-music.mp3')
  })

  it('地址里_should不再出现 public 时代的裸路径', () => {
    // 这条防的是"改漏一处"：public/ 时代地址是 /bg-music.mp3，
    // 搬走之后如果还有哪处写死了旧路径，线上就是 404（dev 也许碰巧能过）
    expect(mediaUrl(MEDIA_FILES.backgroundMusic)).not.toBe('/bg-music.mp3')
    expect(mediaUrl(MEDIA_FILES.backgroundVideo).startsWith('/media/')).toBe(true)
  })

  it('前缀结尾多一个斜杠_should不会拼出双斜杠', () => {
    // 运维在环境变量里写 /media/（带尾斜杠）是很正常的手滑
    expect(joinMediaUrl('/media/', 'bg-music.mp3')).toBe('/media/bg-music.mp3')
    expect(joinMediaUrl('/media', 'bg-music.mp3')).toBe('/media/bg-music.mp3')
  })

  // ---------------------------------------------------------------
  // 二、前缀可以被运行时配置覆盖
  // ---------------------------------------------------------------

  it('运行时配置改了前缀_should按新前缀拼接（代码里没有第二处硬编码）', () => {
    // 这条对应"哪天把大文件挪到 OSS / CDN"：只改配置，不改代码
    useRuntimeConfig().public.mediaBase = 'https://cdn.example.com/media'

    expect(getMediaBase()).toBe('https://cdn.example.com/media')
    expect(mediaUrl('bg-music.mp3')).toBe('https://cdn.example.com/media/bg-music.mp3')
  })

  it('prefix 为空串或非字符串_should回到默认前缀而不是拼出坏地址', () => {
    // 覆盖成一个空值比不覆盖更糟：会拼出 /bg-music.mp3（少了前缀，
    // 而那个地址在 public/ 里已经不存在了），所以这里必须回落到默认值
    useRuntimeConfig().public.mediaBase = ''
    expect(mediaUrl('bg-music.mp3')).toBe('/media/bg-music.mp3')

    useRuntimeConfig().public.mediaBase = undefined
    expect(mediaUrl('bg-music.mp3')).toBe('/media/bg-music.mp3')
  })

  // ---------------------------------------------------------------
  // 三、非法文件名一律拒绝（前端侧的第一道、也是唯一一道拼接入口）
  // ---------------------------------------------------------------

  it('带路径分隔符的文件名_should被拒绝', () => {
    expect(() => mediaUrl('../bg-music.mp3')).toThrow()
    expect(() => mediaUrl('a/bg-music.mp3')).toThrow()
    expect(() => mediaUrl('a\\bg-music.mp3')).toThrow()
  })

  it('用 URL 编码伪装的穿越_should被拒绝', () => {
    // %2e%2e%2f 解出来就是 ../；虽然 mediaUrl 不做解码，
    // 但"含 % 的字符串"本来就不该出现在一个文件名里
    expect(() => mediaUrl('%2e%2e%2fbg-music.mp3')).toThrow()
  })

  it('隐藏文件与空名字_should被拒绝', () => {
    expect(() => mediaUrl('.env')).toThrow()
    expect(() => mediaUrl('')).toThrow()
    expect(() => mediaUrl(undefined)).toThrow()
  })

  it('合法的文件名_should被接受（拒绝规则不能误伤正常输入）', () => {
    expect(() => mediaUrl('bg-music_v2.mp3')).not.toThrow()
    expect(() => mediaUrl('BG.MP4')).not.toThrow()
  })
})

describe('resolveMediaFile：请求文件名 → 磁盘路径（dev 路由的穿越防护）', () => {
  // 用一个假的媒体目录，测试就不依赖仓库里那两个大文件到底在不在。
  // 【为什么用 join(process.cwd(), ...) 而不是写死 "D:\\..."】
  //   CI 跑在 Linux 上，写死 Windows 路径在那边会直接失败 ——
  //   测试不该挑平台。join 出来的路径两边都对，断言里也不出现分隔符字面量。
  const dir = join(process.cwd(), 'fake-static-media')

  it('白名单里的文件名_should解析到媒体目录下并带出 Content-Type', () => {
    const music = resolveMediaFile('bg-music.mp3', dir)
    expect(music.fileName).toBe('bg-music.mp3')
    expect(music.filePath.startsWith(dir)).toBe(true)
    expect(music.contentType).toBe('audio/mpeg')

    const video = resolveMediaFile('bg-star.mp4', dir)
    expect(video.contentType).toBe('video/mp4')

    // 【音乐页的两个文件，2026-09-11 加进白名单】它们线上由 Nginx 直接读磁盘，
    // 只有本地这条 dev 路由在管白名单 —— 漏掉的话会出现"线上好了、本地还是占位图
    // 与「暂无歌词」"，本地一测就以为功能没做（这条断言就是钉住这一点）。
    const cover = resolveMediaFile('cover-1.png', dir)
    expect(cover.contentType).toBe('image/png')

    const lyrics = resolveMediaFile('bg-music.lrc', dir)
    // 歌词是纯文本：**必须**带 charset，且绝不能是 text/html
    // （当成 HTML 解析等于给 XSS 开门）
    expect(lyrics.contentType).toBe('text/plain; charset=utf-8')
  })

  it('大写扩展名_should也能识别（三端行为一致，否则本机能播服务器 404）', () => {
    expect(resolveMediaFile('BG-MUSIC.MP3', dir).contentType).toBe('audio/mpeg')
  })

  it.each([
    ['上跳一层', '../bg-music.mp3'],
    ['上跳到系统目录', '../../../../etc/passwd'],
    ['子目录', 'sub/bg-music.mp3'],
    ['Windows 反斜杠', '..\\bg-music.mp3'],
    ['URL 编码的上跳', '..%2Fbg-music.mp3'],
    ['编码后的点号上跳', '%2e%2e%2fbg-music.mp3'],
    ['隐藏文件', '.env'],
    ['换扩展名读其它文件', 'bg-music.mp3.txt'],
    ['可执行文件', 'bg-music.exe'],
    // 【为什么补这三条】白名单在 2026-09-11 加了 .png / .lrc（音乐页的封面与歌词）。
    // 加白名单这件事本身很容易被后来的人改成"黑名单"或者干脆删掉判断，
    // 所以这里额外钉住三类**必须继续被拒**的东西：网页 / 脚本 / 能让浏览器执行的东西。
    ['网页', 'evil.html'],
    ['脚本', 'evil.js'],
    ['SVG（能被当 HTML 执行）', 'evil.svg'],
    ['没有扩展名', 'bg-music'],
    ['空字符串', ''],
    ['空字节截断', 'bg-music.mp3\u0000.png'],
  ])('非法输入「%s」_should被拒绝', (_label, name) => {
    expect(() => resolveMediaFile(name, dir)).toThrow()
  })

  it('非字符串输入_should被拒绝（路由参数拿不到时是 undefined）', () => {
    expect(() => resolveMediaFile(undefined, dir)).toThrow()
    expect(() => resolveMediaFile(null, dir)).toThrow()
  })

  it('解析结果_should永远落在媒体目录里面', () => {
    // 这是最后一道防线（"判结果"而不是"判形状"）：
    // 就算前面的形状判断哪天被改松了，这条断言仍然守得住
    const { filePath } = resolveMediaFile('bg-star.mp4', dir)
    expect(filePath).toBe(join(dir, 'bg-star.mp4'))
  })
})

describe('parseRangeHeader：视频拖动进度条靠它', () => {
  const size = 1000

  it('没有 Range 头_should返回 null（调用方按 200 发整个文件）', () => {
    expect(parseRangeHeader(undefined, size)).toBe(null)
    expect(parseRangeHeader('', size)).toBe(null)
  })

  it('bytes=0-99_should解析出闭区间的起止', () => {
    expect(parseRangeHeader('bytes=0-99', size)).toEqual({ start: 0, end: 99 })
  })

  it('只写起点（bytes=100-）_should一直取到文件末尾', () => {
    // 这是播放器最常用的一种写法：从某处开始播到结束
    expect(parseRangeHeader('bytes=100-', size)).toEqual({ start: 100, end: size - 1 })
  })

  it('后缀写法（bytes=-500）_should取最后 500 字节', () => {
    expect(parseRangeHeader('bytes=-500', size)).toEqual({ start: 500, end: size - 1 })
  })

  it('终点超出文件大小_should截断到文件末尾（而不是回 416）', () => {
    // 浏览器习惯要"一大段"，终点越界是正常的，硬回 416 会让视频直接播不了
    expect(parseRangeHeader('bytes=0-999999', size)).toEqual({ start: 0, end: size - 1 })
  })

  it('起点越界_should标成 unsatisfiable（调用方回 416）', () => {
    expect(parseRangeHeader('bytes=5000-', size)).toEqual({ unsatisfiable: true })
  })

  it('起点大于终点_should标成 unsatisfiable', () => {
    expect(parseRangeHeader('bytes=500-100', size)).toEqual({ unsatisfiable: true })
  })

  it('不认识的头_should当作没有 Range（宁可整段返回，也不要报错）', () => {
    // 多区间（bytes=0-9,20-29）响应的拼装是 multipart 那套，复杂且浏览器很少用；
    // 当作普通请求处理，客户端拿到完整文件照样能播
    expect(parseRangeHeader('bytes=0-9,20-29', size)).toBe(null)
    expect(parseRangeHeader('items=0-9', size)).toBe(null)
    expect(parseRangeHeader('bytes=abc', size)).toBe(null)
  })

  it('文件长度不是正数_should当作没有 Range（避免算出 -1 这种结束位置）', () => {
    expect(parseRangeHeader('bytes=0-99', 0)).toBe(null)
    expect(parseRangeHeader('bytes=0-99', Number.NaN)).toBe(null)
  })
})
