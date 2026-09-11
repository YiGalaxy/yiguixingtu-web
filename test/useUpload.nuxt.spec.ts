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
      // 上限是 5MB，这里给 5MB + 1 字节：边界要卡准
      expect(validateFile(fakeFile('big.png', 5 * 1024 * 1024 + 1))).toContain('不能超过')
    })

    it('正好等于上限_should通过（边界不能写错）', () => {
      const { validateFile } = useUpload()
      expect(validateFile(fakeFile('exact.png', 5 * 1024 * 1024))).toBe('')
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
  // 【为什么值得单独一组】同一个 /upload 接口，两种形态的差别只有三件事：
  //   白名单（图片 5 种 / 音频只有 mp3）、大小上限（5MB / 20MB）、
  //   以及音频要多带一个 `?type=audio`。这三件事各自写错的后果都是"静默的"：
  //     · 少了 type 参数 → 后端按图片白名单校验，一个正常的 mp3 会被拒
  //     · 上限串味（音频用 5MB）→ 用户传一个 8MB 的歌被界面拦下，而后端明明收
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

    it('图片模式的超限提示_should仍然是「图片不能超过 5MB」（措辞没被音频带偏）', () => {
      const { validateFile } = useUpload()
      expect(validateFile(fakeFile('big.png', 5 * 1024 * 1024 + 1))).toBe('图片不能超过 5MB')
    })

    it('正好 20MB_should通过（边界不能写错）', () => {
      const { validateFile } = useUpload('audio')
      expect(validateFile(fakeFile('exact.mp3', 20 * 1024 * 1024, 'audio/mpeg'))).toBe('')
    })

    it('6MB 的音频_should通过（图片那一档的 5MB 不适用于音频）', () => {
      const { validateFile } = useUpload('audio')
      expect(validateFile(fakeFile('mid.mp3', 6 * 1024 * 1024, 'audio/mpeg'))).toBe('')
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
      expect(image.MAX_SIZE).toBe(5 * 1024 * 1024)
      expect(image.MAX_SIZE_TEXT).toBe('5MB')
      expect(image.ALLOWED_EXTENSIONS).toEqual(['jpg', 'jpeg', 'png', 'gif', 'webp'])
    })

    it('传了不认识的方式_should回落到图片那一档（不要变成"什么都能传"）', () => {
      const fallback = useUpload('video')
      expect(fallback.ALLOWED_EXTENSIONS).toEqual(['jpg', 'jpeg', 'png', 'gif', 'webp'])
      expect(fallback.validateFile(fakeFile('clip.mp4', 1024, 'video/mp4'))).not.toBe('')
    })
  })
})
