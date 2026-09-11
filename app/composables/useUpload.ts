// ============================================================
// app/composables/useUpload.ts
// 作用：文件上传。后端接口是 POST /upload（仅管理员），返回 { url }。
//
// 【三种上传形态：图片 / 音频 / 附件】
//   同一个接口按 `?type=` 区分，但三者的白名单与大小上限完全不同
//   （图片 10MB、音频 20MB、附件 100MB）。所以这里把它做成
//   **一张规则表 + 一个 mode 参数**，而不是在调用处各写一遍 if：
//     · useUpload()              → 图片模式（默认，行为与加这个参数之前一模一样）
//     · useUpload('audio')       → 音频模式（只收 .mp3、上限 20MB）
//     · useUpload('attachment')  → 附件模式（文档 / 压缩包 / 音视频、上限 100MB）
//   写成"两套函数"或者"在调用处判断"的后果是：大小上限改了要改好几处，
//   漏掉的那一处不会有任何报错 —— 只会让某个入口静默地放行一个超大文件。
//
// 【为什么单独抽一个 composable，而不是直接写在 admin.vue 里】
//   1. admin.vue 已经有 1000 行，再把上传的校验与请求塞进去更难维护
//   2. 抽出来之后可以【单独写测试】：admin.vue 是页面组件，
//      而这里是可以直接调用、直接断言的普通函数
//   3. 图片 / 音频两种形态共用同一套"预检 + 拼 FormData + 发请求"的逻辑
//
// 【它和 useApi 的分工】
//   useApi 负责"怎么发请求"（带 token、判 code、处理 401/403）；
//   这里负责"传什么、能不能传"（类型与大小的前端预检 + 拼 FormData）。
//   ——注意前端的校验只是【体验优化】，真正生效的是后端那一层，
//     因为前端代码可以被绕过（直接调接口）。两边都做，但定位不同。
// ============================================================

/**
 * 两种形态的规则表。
 *
 * 【为什么用 Object.freeze 冻两层】它是一份"与后端配置对齐"的约定
 * （后端 app.upload.allowed-extensions / max-size）：数组被就地 push 一个
 * 扩展名、或者上限被改一个数字，都会让前端预检与后端校验悄悄分叉 ——
 * 冻上之后这种改动会当场报错，而不是等到某天有人传了个后端不收的文件。
 *
 * 【typeParam 是什么】音频要走 `POST /upload?type=audio`（后端据此决定落到哪个目录、
 * 以及按哪套白名单校验）；图片不需要这个参数，所以它是 null。
 */
const UPLOAD_MODES = Object.freeze({
  image: Object.freeze({
    label: '图片',
    extensions: Object.freeze(['jpg', 'jpeg', 'png', 'gif', 'webp']),
    // 【2026-09-11 从 5MB 提到 10MB】站长要求：正文插图经常是手机直出的大图，
    // 5MB 会频繁拦下正常使用。⚠️ 改这个数字必须同时改后端 app.upload.max-size
    // （那才是真正生效的一层），以及 README 里那份限额说明
    maxSize: 10 * 1024 * 1024,
    maxSizeText: '10MB',
    // 超限提示里的主语：图片就是「图片」，音频是「单个音频」
    // （后端给的措辞是「单个音频不超过 20MB」，前端提示要与它一致 ——
    //   写小了用户会被前端白拦一次，写大了会白跑一趟后端）
    sizeSubject: '图片',
    typeParam: null,
  }),
  audio: Object.freeze({
    label: '音频',
    // 只放行 mp3：前台播放器用的是 <audio>，浏览器对 mp3 的支持最广；
    // 想加 m4a / wav 时要连同后端那一份白名单一起改
    extensions: Object.freeze(['mp3']),
    // 20MB 的依据写在后端注释里：320kbps × 5 分钟 ≈ 12MB，留了余量
    maxSize: 20 * 1024 * 1024,
    maxSizeText: '20MB',
    sizeSubject: '单个音频',
    // 【音频才有的查询参数】后端 `POST /upload?type=audio`；
    // 不传（或 type=image）走图片那一套。传了别的值后端会 400「不支持的上传类型」，
    // 不会悄悄回落到图片 —— 所以这里绝不能写成别的值
    typeParam: 'audio',
  }),
  /**
   * 附件（文章的可下载文件）。2026-09-11 新增。
   *
   * 【为什么白名单里【没有】html / svg / xml / js】这是这个类型最要紧的一条：
   *   附件由后端 `/uploads/**` 在**同域**下提供，而浏览器是按扩展名决定
   *   "就地打开还是下载"的 —— 一旦放行 html/svg，用户点开附件就等于在你域名下
   *   执行了一段别人写的网页脚本（同源 XSS，能读 cookie、能冒充用户调接口）。
   *   所以这里只放**文档 / 压缩包 / 音视频**，与后端 attachmentAllowedExtensions 一致；
   *   后端那边另外会强制 `Content-Disposition: attachment` 兜第二道。
   */
  attachment: Object.freeze({
    label: '附件',
    extensions: Object.freeze([
      'pdf', 'zip', '7z', 'rar',
      'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
      'txt', 'md', 'csv', 'json',
      'mp3', 'mp4',
    ]),
    maxSize: 100 * 1024 * 1024,
    maxSizeText: '100MB',
    sizeSubject: '单个附件',
    typeParam: 'attachment',
  }),
})

/**
 * @param {'image'|'audio'|'attachment'} mode 上传形态；默认 image。
 *   传了不认识的模式时回落到 image（宁可让图片那套更严的规则生效，
 *   也不要因为一个拼错的字符串变成"什么都能传"）。
 */
export const useUpload = (mode = 'image') => {
  const { request } = useApi()

  const rules = UPLOAD_MODES[mode] || UPLOAD_MODES.image

  /** 与后端 app.upload.allowed-extensions 保持一致（图片 5 种 / 音频只有 mp3） */
  const ALLOWED_EXTENSIONS = rules.extensions

  /** 与后端 app.upload.max-size 保持一致（图片 5MB / 音频 20MB） */
  const MAX_SIZE = rules.maxSize
  const MAX_SIZE_TEXT = rules.maxSizeText

  /**
   * 前端预检：在把文件发出去之前先拦一道。
   *
   * 【为什么明明后端也会校验，前端还要再校验一次】
   *   因为等后端返回 400 再提示，用户已经白等了一次网络往返；
   *   而且传一个 50MB 的文件上来，浪费的是用户的上行带宽。
   *   本地的、瞬时的检查能立刻给出反馈，体验差别很明显。
   *
   * @param {File} file 用户选中的文件
   * @returns {string} 空串表示通过；否则是给用户看的错误文案
   */
  const validateFile = (file) => {
    if (!file) {
      return `请选择要上传的${rules.label}`
    }

    // 取扩展名：文件名可能带路径、可能是大写，统一处理
    const name = String(file.name || '')
    const dotIndex = name.lastIndexOf('.')
    const extension = dotIndex >= 0 ? name.slice(dotIndex + 1).toLowerCase() : ''

    if (!ALLOWED_EXTENSIONS.includes(extension)) {
      return `只支持 ${ALLOWED_EXTENSIONS.join(' / ')} 格式的${rules.label}`
    }

    // file.size 是字节数，由浏览器提供，不需要读文件内容
    if (file.size > MAX_SIZE) {
      return `${rules.sizeSubject}不能超过 ${MAX_SIZE_TEXT}`
    }

    if (file.size === 0) {
      return '不能上传空文件'
    }

    return ''
  }

  /**
   * 上传文件。
   *
   * 【为什么用 FormData 而不是自己拼 multipart 报文】
   *   FormData 是浏览器原生 API，会自动按 multipart/form-data 规范
   *   拼出边界（boundary）与各部分头部 —— 手写这些极易出错，
   *   而且边界串必须和请求头里的 boundary 一致。
   *
   * 【为什么不用手动设置 Content-Type】
   *   设了反而会坏事：boundary 是浏览器生成的一串随机值，
   *   如果自己写死 `Content-Type: multipart/form-data` 而不带 boundary，
   *   后端解析不出表单，会报 400。
   *   交给浏览器/fetch 自己加，它会带上正确的 boundary。
   *   （useApi 里也没有覆盖 Content-Type，所以这里能正常工作）
   *
   * @param {File} file 用户选中的文件
   * @returns {Promise<{ok: boolean, url?: string, message?: string}>}
   */
  const upload = async (file) => {
    const invalidReason = validateFile(file)
    if (invalidReason) {
      // 预检没过就不发请求了，直接把原因返回给调用方去提示
      return { ok: false, message: invalidReason }
    }

    const formData = new FormData()
    // 字段名必须叫 file —— 后端是 @RequestParam("file") MultipartFile file
    formData.append('file', file)

    // 【音频多一个查询参数】图片模式【不传 params 这个键】，
    // 让发出去的请求与加音频模式之前完全一样（既有用例钉着这一点）
    const options = { method: 'POST', body: formData }
    if (rules.typeParam) {
      options.params = { type: rules.typeParam }
    }

    const res = await request('/upload', options)

    if (!res.ok) {
      // useApi 已经把后端的 message 透出来了（比如"只允许上传 xxx 格式的图片"），
      // 这里原样带上，不要自己编一句笼统的"上传失败"
      return { ok: false, message: res.message || '上传失败' }
    }

    return {
      ok: true,
      url: res.data?.url,
      // 【附件要用到 name 与 size】后台的附件列表要显示"文件名 + 大小"。
      // 优先用后端回的（它才是真正落库的那份），没有就回落到本地 File ——
      // 这两个值本来就来自这次选择，回落到 File 不会失真。
      name: res.data?.name || file.name,
      size: Number.isFinite(res.data?.size) ? res.data.size : file.size,
    }
  }

  return { upload, validateFile, MAX_SIZE, MAX_SIZE_TEXT, ALLOWED_EXTENSIONS }
}
