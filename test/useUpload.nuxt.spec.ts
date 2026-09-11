import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'

// =====================================================================
// useUpload 的单元测试
//
// 【为什么这个 composable 值得测】
//   它有两个容易出错、又不容易在界面上发现的地方：
//     ① 前端预检的边界：扩展名大小写、没有扩展名、空文件、正好等于上限
//     ② 上传请求的拼装：FormData 的字段名必须叫 file，
//        而且【不能手动设 Content-Type】（设了会丢 boundary，后端解析不出表单）
//   ② 尤其麻烦：它写错了在浏览器里表现为"上传失败"，看不出原因；
//      这里用断言把"发出去的请求长什么样"钉住，改坏了立刻红。
//
// 【为什么一份测试要覆盖三种形态】同一个 /upload 接口靠 `?type=` 分成三档
//   （图片 10MB / 音频 20MB / 附件 100MB，规则表在 app/composables/useUpload.ts）。
//   三档之间"串味"（哪一档的上限/白名单漏到另一档去）的表现全是"界面拒绝了后端明明收的文件"，
//   而**默认那一档（图片）最容易被改动波及** —— 所以每加一档，
//   都要把"默认那一档没有被动过"重新断言一遍（见音频组最后一条）。
//
// 【怎么拦截请求】
//   和 useApi 的测试一样用 mockNuxtImport 替换 $fetch ——
//   因为 $fetch 是 Nuxt 自动导入的，vi.stubGlobal 拦不住（见 useApi 测试里的说明）。
//   另外 useApi 内部还会调 useCookie，这里也一并替换成普通 ref，
//   理由同 useApi 的测试（cookie 的写入时机是 Nuxt 内部实现，不该进断言）。
// =====================================================================

const { fetchMock, tokenRef } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  tokenRef: { value: null },
}))
mockNuxtImport('$fetch', () => fetchMock)
mockNuxtImport('useCookie', () => () => tokenRef)

const { errorSpy } = vi.hoisted(() => ({ errorSpy: vi.fn() }))
vi.mock('element-plus', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, ElMessage: { ...actual.ElMessage, error: errorSpy } }
})

/** 造一个假的 File 对象：只用到 name / size / type 三个属性 */
const fakeFile = (name, size = 1024, type = 'image/png') => ({ name, size, type })

describe('useUpload', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    errorSpy.mockReset()
    tokenRef.value = null
  })

  // ---------------------------------------------------------------
  // 一、前端预检
  // ---------------------------------------------------------------

  describe('validateFile（发出请求之前先拦一道）', () => {
    it('合法的 png_should通过', () => {
      const { validateFile } = useUpload()
      expect(validateFile(fakeFile('cover.png'))).toBe('')
    })

    it('扩展名大写_should也能通过（别把 .PNG 当成非法）', () => {
      const { validateFile } = useUpload()
      expect(validateFile(fakeFile('COVER.PNG'))).toBe('')
    })

    it('不允许的扩展名_should被拒并提示支持哪些格式', () => {
      const { validateFile } = useUpload()
      const msg = validateFile(fakeFile('evil.exe'))
      expect(msg).toContain('只支持')
      expect(msg).toContain('png')
    })

    it('可执行脚本_should被拒（白名单只放行图片）', () => {
      const { validateFile } = useUpload()
      expect(validateFile(fakeFile('shell.jsp', 10, 'image/jpeg'))).not.toBe('')
    })

    it('没有扩展名_should被拒', () => {
      const { validateFile } = useUpload()
      expect(validateFile(fakeFile('noextension'))).not.toBe('')
    })

    it('超过大小上限_should被拒', () => {
      const { validateFile } = useUpload()
      // 上限是 10MB（2026-09-11 从 5MB 提上来的），这里给 10MB + 1 字节：边界要卡准
      expect(validateFile(fakeFile('big.png', 10 * 1024 * 1024 + 1))).toContain('不能超过')
    })

    it('6MB 的图片_should通过（提到 10MB 之后，旧的那一档不再拦它）', () => {
      // 【为什么专门来一条 6MB】5MB→10MB 这种改动最容易只改一半：
      //   提示文案改成 10MB、上限数字还是 5MB。页面上看起来完全正常，
      //   只有用户传一张 6MB 的手机直出图被拒时才会发现 —— 而那正是这次改动的起因。
      //   6MB 落在"旧上限之上、新上限之下"，是这两档之间唯一能分辨出对错的地方。
      const { validateFile } = useUpload()
      expect(validateFile(fakeFile('photo.jpg', 6 * 1024 * 1024))).toBe('')
    })

    it('正好等于上限_should通过（边界不能写错）', () => {
      const { validateFile } = useUpload()
      // 写成 `>=` 就会把"正好 10MB"也拦下 —— 用户会以为自己的图刚好超了一点
      expect(validateFile(fakeFile('exact.png', 10 * 1024 * 1024))).toBe('')
    })

    it('空文件_should被拒', () => {
      const { validateFile } = useUpload()
      expect(validateFile(fakeFile('empty.png', 0))).not.toBe('')
    })

    it('没有选文件_should给出提示而不是崩溃', () => {
      const { validateFile } = useUpload()
      expect(validateFile(null)).not.toBe('')
    })
  })

  // ---------------------------------------------------------------
  // 二、上传请求的拼装
  // ---------------------------------------------------------------

  describe('upload（把请求发对）', () => {
    it('预检不通过时_should直接返回错误_不发请求', async () => {
      const { upload } = useUpload()
      const res = await upload(fakeFile('evil.exe'))

      expect(res.ok).toBe(false)
      expect(res.message).toContain('只支持')
      // 【关键】不该浪费一次网络往返
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('正常上传_should发到 /upload 且请求体是 FormData', async () => {
      fetchMock.mockResolvedValue({ code: 200, data: { url: 'http://x/uploads/cover/1.png' } })

      const { upload } = useUpload()
      const res = await upload(fakeFile('cover.png'))

      expect(res.ok).toBe(true)
      expect(res.url).toBe('http://x/uploads/cover/1.png')

      const [url, options] = fetchMock.mock.calls[0]
      expect(url).toBe('/upload')
      expect(options.method).toBe('POST')
      // 后端是 @RequestParam("file")，字段名必须叫 file —— 写成别的后端会收不到文件
      expect(options.body).toBeInstanceOf(FormData)
      expect(options.body.get('file')).toBeTruthy()
    })

    it('上传时【不能】手动设置 Content-Type（设了会丢 boundary，后端解析不出表单）', async () => {
      fetchMock.mockResolvedValue({ code: 200, data: { url: 'http://x/a.png' } })

      const { upload } = useUpload()
      await upload(fakeFile('cover.png'))

      const options = fetchMock.mock.calls[0][1]
      // 让浏览器/fetch 自己去加 multipart 的 Content-Type 与随机的 boundary
      expect(options.headers['Content-Type']).toBeUndefined()
      expect(options.headers['content-type']).toBeUndefined()
    })

    it('后端返回业务错误_should把后端的原文透出来', async () => {
      fetchMock.mockResolvedValue({ code: 400, message: '只允许上传 jpg / png 格式的图片' })

      const { upload } = useUpload()
      const res = await upload(fakeFile('cover.png'))

      expect(res.ok).toBe(false)
      // 不要自己编一句笼统的"上传失败" —— 后端的话更具体、对用户更有用
      expect(res.message).toBe('只允许上传 jpg / png 格式的图片')
    })

    it('后端没给 message 时_should有兜底文案', async () => {
      fetchMock.mockResolvedValue({ code: 500 })

      const { upload } = useUpload()
      const res = await upload(fakeFile('cover.png'))

      expect(res.ok).toBe(false)
      expect(res.message).toBe('上传失败')
    })

    it('未登录（401）_should返回失败而不是抛异常', async () => {
      fetchMock.mockRejectedValue({ status: 401 })

      const { upload } = useUpload()
      const res = await upload(fakeFile('cover.png'))

      // 这条守的是"页面上不会出现未捕获的异常导致白屏"
      expect(res.ok).toBe(false)
      expect(res.message).toBeTruthy()
    })

    it('登录后上传_should带上 Authorization 请求头', async () => {
      fetchMock.mockResolvedValue({ code: 200, data: { url: 'http://x/a.png' } })
      tokenRef.value = 'fake-token'

      const { upload } = useUpload()
      await upload(fakeFile('cover.png'))

      const options = fetchMock.mock.calls[0][1]
      expect(options.headers.Authorization).toBe('Bearer fake-token')
    })
  })

  // ---------------------------------------------------------------
  // 三、音频模式（useUpload('audio')）
  //
  // 【为什么值得单独一组】同一个 /upload 接口，几种形态的差别只有三件事：
  //   白名单（图片 5 种 / 音频只有 mp3）、大小上限（图片 10MB / 音频 20MB）、
  //   以及音频要多带一个 `?type=audio`。这三件事各自写错的后果都是"静默的"：
  //     · 少了 type 参数 → 后端按图片白名单校验，一个正常的 mp3 会被拒
  //     · 上限串味（音频用图片那一档的 10MB）→ 用户传一个 12MB 的歌被界面拦下，而后端明明收
  //     · 白名单串味（音频放行 png）→ 白跑一次后端才被拒
  //   所以下面逐条钉住，并且【图片模式一个断言都没动】。
  // ---------------------------------------------------------------

  describe('音频模式（useUpload(\'audio\')）', () => {
    it('mp3_should通过', () => {
      const { validateFile } = useUpload('audio')
      expect(validateFile(fakeFile('song.mp3', 1024, 'audio/mpeg'))).toBe('')
    })

    it('扩展名大写_should也能通过（别把 .MP3 当成非法）', () => {
      const { validateFile } = useUpload('audio')
      expect(validateFile(fakeFile('SONG.MP3', 1024, 'audio/mpeg'))).toBe('')
    })

    it('图片扩展名_should被拒（音频模式不放行 png）', () => {
      const { validateFile } = useUpload('audio')
      const msg = validateFile(fakeFile('cover.png'))
      expect(msg).toContain('只支持')
      expect(msg).toContain('mp3')
    })

    it('没有扩展名_should被拒', () => {
      const { validateFile } = useUpload('audio')
      expect(validateFile(fakeFile('song'))).not.toBe('')
    })

    it('超过 20MB_should被拒，并且提示里写明上限是 20MB', () => {
      const { validateFile } = useUpload('audio')
      const msg = validateFile(fakeFile('big.mp3', 20 * 1024 * 1024 + 1, 'audio/mpeg'))
      expect(msg).toContain('不能超过')
      // 【提示里必须写清数字与主语】只说"太大了"的话，用户不知道要压到多少；
      // 措辞与后端一致（「单个音频不超过 20MB」）—— 写小了用户会被前端白拦一次
      expect(msg).toBe('单个音频不能超过 20MB')
    })

    it('图片模式的超限提示_should仍然是「图片不能超过 10MB」（措辞没被音频带偏）', () => {
      const { validateFile } = useUpload()
      expect(validateFile(fakeFile('big.png', 10 * 1024 * 1024 + 1))).toBe('图片不能超过 10MB')
    })

    it('正好 20MB_should通过（边界不能写错）', () => {
      const { validateFile } = useUpload('audio')
      expect(validateFile(fakeFile('exact.mp3', 20 * 1024 * 1024, 'audio/mpeg'))).toBe('')
    })

    it('12MB 的音频_should通过（图片那一档的 10MB 不适用于音频）', () => {
      // 【为什么是 12MB】它必须落在"图片上限之上、音频上限之下"才有力气：
      //   原来这条用的是 6MB（当时图片那档是 5MB），图片提到 10MB 之后 6MB 两边都合法，
      //   这条用例就变成了永远为真 —— 上限如果哪天串味成图片那一档，它也照样绿。
      const { validateFile } = useUpload('audio')
      expect(validateFile(fakeFile('mid.mp3', 12 * 1024 * 1024, 'audio/mpeg'))).toBe('')
    })

    it('空文件_should被拒', () => {
      const { validateFile } = useUpload('audio')
      expect(validateFile(fakeFile('empty.mp3', 0, 'audio/mpeg'))).not.toBe('')
    })

    it('没有选文件_should给出提示而不是崩溃', () => {
      const { validateFile } = useUpload('audio')
      expect(validateFile(null)).not.toBe('')
    })

    it('上传_should发到 /upload 并带上 type=audio 查询参数', async () => {
      fetchMock.mockResolvedValue({ code: 200, data: { url: 'http://x/uploads/audio/1.mp3' } })

      const { upload } = useUpload('audio')
      const res = await upload(fakeFile('song.mp3', 1024, 'audio/mpeg'))

      expect(res.ok).toBe(true)
      expect(res.url).toBe('http://x/uploads/audio/1.mp3')

      const [url, options] = fetchMock.mock.calls[0]
      expect(url).toBe('/upload')
      expect(options.method).toBe('POST')
      // 【少了这个参数后端会按图片的白名单校验】一个正常 mp3 会被拒
      expect(options.params).toEqual({ type: 'audio' })
      expect(options.body).toBeInstanceOf(FormData)
      expect(options.body.get('file')).toBeTruthy()
    })

    it('图片模式_should【不】带 type 参数（两种形态的请求要能区分开）', async () => {
      fetchMock.mockResolvedValue({ code: 200, data: { url: 'http://x/a.png' } })

      const { upload } = useUpload()
      await upload(fakeFile('cover.png'))

      const options = fetchMock.mock.calls[0][1]
      expect(options.params).toBeUndefined()
    })

    it('预检不通过时_should不发请求（音频也一样）', async () => {
      const { upload } = useUpload('audio')
      const res = await upload(fakeFile('evil.exe'))

      expect(res.ok).toBe(false)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('后端返回业务错误_should把后端的原文透出来（音频也一样）', async () => {
      fetchMock.mockResolvedValue({ code: 400, message: '只允许上传 mp3 格式的音频' })

      const { upload } = useUpload('audio')
      const res = await upload(fakeFile('song.mp3', 1024, 'audio/mpeg'))

      expect(res.ok).toBe(false)
      expect(res.message).toBe('只允许上传 mp3 格式的音频')
    })

    it('返回的规则_should是音频那一档（上限文案与白名单都不能串味）', () => {
      const audio = useUpload('audio')
      expect(audio.MAX_SIZE).toBe(20 * 1024 * 1024)
      expect(audio.MAX_SIZE_TEXT).toBe('20MB')
      expect(audio.ALLOWED_EXTENSIONS).toEqual(['mp3'])

      // 图片那一档必须保持原样（这条同时是"没把默认形态改坏"的护栏）
      const image = useUpload()
      expect(image.MAX_SIZE).toBe(10 * 1024 * 1024)
      expect(image.MAX_SIZE_TEXT).toBe('10MB')
      expect(image.ALLOWED_EXTENSIONS).toEqual(['jpg', 'jpeg', 'png', 'gif', 'webp'])
    })

    it('传了不认识的方式_should回落到图片那一档（不要变成"什么都能传"）', () => {
      const fallback = useUpload('video')
      expect(fallback.ALLOWED_EXTENSIONS).toEqual(['jpg', 'jpeg', 'png', 'gif', 'webp'])
      expect(fallback.validateFile(fakeFile('clip.mp4', 1024, 'video/mp4'))).not.toBe('')
    })
  })

  // ---------------------------------------------------------------
  // 四、附件模式（useUpload('attachment')）—— 2026-09-11 新增
  //
  // 【这一组最要紧的一条是白名单里【没有】什么，而不是有什么】
  //   附件是"用户传上来、别的访客点开"的文件，而后端把它们放在**同域**的
  //   `/uploads/**` 下。浏览器是按扩展名决定"就地打开还是下载"的：
  //   一旦放行 html / svg，任何一个访客点开那个附件，就等于在我们域名下
  //   执行了一段别人写的脚本（同源 XSS：能读 cookie、能拿访客的身份调后台接口）。
  //   这条错法在界面上**完全看不出来** —— 上传成功、列表正常、点开也"能打开"，
  //   所以只能用断言把"html / svg 必须被拒"单独钉住（各一条，见下）。
  //
  // 【第二要紧的是 100MB 这个上限】它是三档里最大的一个，而"上限写小了"的表现是
  //   用户传一个正常的课程视频被界面拦下（后端其实收）—— 用户没法绕过前端，
  //   所以他只会认为"这站不让传大文件"，然后放弃。边界要卡在一个字节上。
  // ---------------------------------------------------------------

  describe('附件模式（useUpload(\'attachment\')）', () => {
    it('白名单里的扩展名_should全部放行（文档 / 压缩包 / 音视频三个家族各抽代表）', () => {
      const { validateFile } = useUpload('attachment')
      // 三个家族各挑几个代表：文档 pdf / docx、压缩包 zip / 7z / rar、
      // 表格演示 xls / ppt、纯文本 md / csv / json、音视频 mp3 / mp4。
      // 【为什么合成一条用例】它们走的是同一行代码（`ALLOWED_EXTENSIONS.includes`），
      //   一条条拆开只会让"白名单少了谁"更难看出来；这里失败时信息里带着文件名。
      const samples = [
        'report.pdf', 'contract.docx', 'legacy.doc',
        'pack.zip', 'pack.7z', 'pack.rar',
        'table.xls', 'table.xlsx', 'slides.ppt', 'slides.pptx',
        'notes.txt', 'readme.md', 'data.csv', 'config.json',
        'podcast.mp3', 'lesson.mp4',
      ]
      for (const name of samples) {
        expect(validateFile(fakeFile(name, 1024, 'application/octet-stream')), name).toBe('')
      }
    })

    it('扩展名大写_should也能通过（别把 .PDF 当成非法）', () => {
      const { validateFile } = useUpload('attachment')
      expect(validateFile(fakeFile('REPORT.PDF'))).toBe('')
    })

    it('⚠️ html_should被拒（同源 XSS 入口，这一条比其余所有白名单都重要）', () => {
      // 【为什么单独一条】一个 html 附件被放到同域的 /uploads/ 下、
      //   访客点开就是"在我们域名下执行别人的网页脚本"。
      //   传 html 的人不一定是攻击者（"导出的报告"就经常是 html），
      //   但结果一样：谁点开谁中招。所以这里钉住"它必须被拒"。
      const { validateFile } = useUpload('attachment')
      const msg = validateFile(fakeFile('report.html', 1024, 'text/html'))
      expect(msg).not.toBe('')
      expect(msg).toContain('只支持')
    })

    it('⚠️ svg_should被拒（svg 里能内联 script / onload，同样是同源 XSS）', () => {
      // 很多人把 svg 当"图片"，所以它最容易被好心加进白名单 ——
      // 而 svg 是**可以带脚本的 XML**：<svg onload="alert(1)"> 直接在
      // 我们域名下执行。它必须和 html 一样被拒（图注里想插图请走图片上传那条路）。
      const { validateFile } = useUpload('attachment')
      const msg = validateFile(fakeFile('logo.svg', 1024, 'image/svg+xml'))
      expect(msg).not.toBe('')
      expect(msg).toContain('只支持')
    })

    it('可执行文件与其它脚本（exe / js / jsp / xml）_should一并被拒', () => {
      const { validateFile } = useUpload('attachment')
      const msg = validateFile(fakeFile('evil.exe', 10))
      expect(msg).toContain('只支持')
      // 提示里要把"到底支持哪些"说清楚，否则用户只能一个个试
      expect(msg).toContain('pdf')
      expect(msg).toContain('zip')
      for (const name of ['shell.js', 'shell.jsp', 'data.xml']) {
        expect(validateFile(fakeFile(name, 10)), name).not.toBe('')
      }
    })

    it('没有扩展名_should被拒', () => {
      const { validateFile } = useUpload('attachment')
      expect(validateFile(fakeFile('noextension'))).not.toBe('')
    })

    it('正好 100MB_should通过（边界不能写错）', () => {
      const { validateFile } = useUpload('attachment')
      expect(validateFile(fakeFile('big.zip', 100 * 1024 * 1024))).toBe('')
    })

    it('超过 100MB 一个字节_should被拒，且提示里写明「单个附件不超过 100MB」', () => {
      const { validateFile } = useUpload('attachment')
      const msg = validateFile(fakeFile('big.zip', 100 * 1024 * 1024 + 1))
      // 【提示里必须有主语与数字】只说"太大了"的话，用户不知道要压到多少；
      // 措辞与后端一致（「单个附件不超过 100MB」）——
      // 写小了用户会被前端白拦一次，写大了会白跑一趟后端（上传还要白等一场）
      expect(msg).toBe('单个附件不能超过 100MB')
    })

    it('空文件_should被拒（0 字节的附件点开是坏文件）', () => {
      const { validateFile } = useUpload('attachment')
      expect(validateFile(fakeFile('empty.zip', 0))).not.toBe('')
    })

    it('没有选文件_should给出提示而不是崩溃，并且主语是「附件」', () => {
      const { validateFile } = useUpload('attachment')
      // 主语与形态对上，用户才知道是哪一栏出了问题（页面上有好几个上传按钮）
      expect(validateFile(null)).toBe('请选择要上传的附件')
    })

    it('上传_should发到 /upload 并带上 type=attachment 查询参数', async () => {
      fetchMock.mockResolvedValue({ code: 200, data: { url: 'http://x/uploads/attachment/1.pdf' } })

      const { upload } = useUpload('attachment')
      const res = await upload(fakeFile('report.pdf', 1024, 'application/pdf'))

      expect(res.ok).toBe(true)
      expect(res.url).toBe('http://x/uploads/attachment/1.pdf')

      const [url, options] = fetchMock.mock.calls[0]
      expect(url).toBe('/upload')
      expect(options.method).toBe('POST')
      // 【少了这个参数后端会按图片的白名单校验】一个正常的 pdf 会被拒；
      // 传成别的值后端会 400「不支持的上传类型」，不会悄悄回落
      expect(options.params).toEqual({ type: 'attachment' })
      expect(options.body).toBeInstanceOf(FormData)
      expect(options.body.get('file')).toBeTruthy()
    })

    it('预检不通过时_should不发请求（附件也一样）', async () => {
      const { upload } = useUpload('attachment')
      const res = await upload(fakeFile('evil.html', 1024, 'text/html'))

      expect(res.ok).toBe(false)
      // 一个 100MB 的文件白传一次，浪费的是用户的上行带宽 —— 本地拦下最值钱
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('后端返回业务错误_should把后端的原文透出来（附件也一样）', async () => {
      fetchMock.mockResolvedValue({ code: 400, message: '附件地址不属于本站，已拒绝' })

      const { upload } = useUpload('attachment')
      const res = await upload(fakeFile('report.pdf', 1024, 'application/pdf'))

      expect(res.ok).toBe(false)
      expect(res.message).toBe('附件地址不属于本站，已拒绝')
    })

    it('返回的规则_should是附件那一档（上限文案与白名单都不能串味）', () => {
      const attachment = useUpload('attachment')
      expect(attachment.MAX_SIZE).toBe(100 * 1024 * 1024)
      expect(attachment.MAX_SIZE_TEXT).toBe('100MB')
      expect(attachment.ALLOWED_EXTENSIONS).toContain('pdf')
      expect(attachment.ALLOWED_EXTENSIONS).toContain('zip')
      // 最要紧的反向断言：这一档里【不许】出现那两个同源 XSS 入口
      expect(attachment.ALLOWED_EXTENSIONS).not.toContain('html')
      expect(attachment.ALLOWED_EXTENSIONS).not.toContain('svg')
      // 图片与音频那两档也不能被附件这一档带跑
      expect(useUpload().MAX_SIZE).toBe(10 * 1024 * 1024)
      expect(useUpload('audio').MAX_SIZE).toBe(20 * 1024 * 1024)
    })

    it('图片模式放行的 jpg_should【不】被附件这一档收下（附件只收"可下载的文件"）', () => {
      // 这一条同时说明"附件"与"图片"是两个用途：正文插图请走图片上传那条路
      // （那条路会做 10MB 与图片白名单的校验），不要因为"附件上限大"就把插图传成附件
      const { validateFile } = useUpload('attachment')
      expect(validateFile(fakeFile('photo.jpg', 1024, 'image/jpeg'))).not.toBe('')
    })
  })

  // ---------------------------------------------------------------
  // 五、upload() 的返回值里 name / size 从哪来
  //
  // 【为什么这两条必须各有一条用例】后台的附件清单要显示"文件名 + 大小"，
  //   而这两个值有两个来源：后端返回的（真正落库的那一份）、以及本地 File 的
  //   （用户刚选中的那一份）。"哪个优先"这件事**没有任何其它东西守着**：
  //     · 写反了（本地 File 优先）→ 后端做了转名/去重（`report(1).pdf`）时，
  //       界面显示的名字与实际下载到的文件对不上，用户会以为下错了文件
  //     · 忘了回落 → 后端不回 name / size 的部署（或者某个老接口）下，
  //       清单里会显示 `undefined` 与「—」，用户根本不知道传的是什么
  //   两条各钉一侧，改动立刻红。
  // ---------------------------------------------------------------

  describe('upload() 的返回值（name / size 谁优先）', () => {
    it('后端回了 name 与 size_should用后端的（它才是真正落库的那一份）', async () => {
      fetchMock.mockResolvedValue({
        code: 200,
        data: { url: 'http://x/uploads/attachment/9.pdf', name: '最终定稿-第二版.pdf', size: 2048 },
      })

      const { upload } = useUpload('attachment')
      const res = await upload(fakeFile('本地叫这个名字.pdf', 999))

      expect(res.ok).toBe(true)
      expect(res.name).toBe('最终定稿-第二版.pdf')
      expect(res.size).toBe(2048)
    })

    it('后端没回 name 与 size_should回落到本地 File（否则清单里会显示 undefined）', async () => {
      // 后端只回 url 的部署（或者将来的某个精简接口）下，这一条是唯一还兜得住的地方
      fetchMock.mockResolvedValue({ code: 200, data: { url: 'http://x/uploads/attachment/9.pdf' } })

      const { upload } = useUpload('attachment')
      const res = await upload(fakeFile('report.pdf', 123456))

      expect(res.name).toBe('report.pdf')
      expect(res.size).toBe(123456)
    })

    it('后端把 size 回成字符串_should回落到本地 File（宁可回落，也不要把不可用的值显示出去）', async () => {
      // 后端正常给的是数字；JSON 里出现 `"size": "2048"` 这种形状时，
      // 直接用它的结果是一个字符串大小 —— 显示、比较、排序都会出岔子。
      // 这里的规矩是"不是有限数字就不认"，回落到这一次选中的那个 File 的大小。
      fetchMock.mockResolvedValue({ code: 200, data: { url: 'http://x/a.pdf', name: 'a.pdf', size: '2048' } })

      const { upload } = useUpload('attachment')
      const res = await upload(fakeFile('a.pdf', 4096))

      expect(res.size).toBe(4096)
    })

    it('图片模式也带上 name / size（三档共用同一段返回值，不许只给附件加）', async () => {
      // 【为什么这条要留在图片这一档】返回值是三个形态共用的一段代码；
      //   如果哪天有人为了附件把它改成"只有 type=attachment 才带上"，
      //   封面那几处调用就会悄悄退化。这里从默认那一档正面钉住。
      fetchMock.mockResolvedValue({ code: 200, data: { url: 'http://x/uploads/cover/1.png', name: 'cover.png', size: 512 } })

      const { upload } = useUpload()
      const res = await upload(fakeFile('cover.png', 1024))

      expect(res.name).toBe('cover.png')
      expect(res.size).toBe(512)
    })
  })
})
