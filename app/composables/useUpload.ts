// ============================================================
// app/composables/useUpload.ts
// 作用：图片上传。后端接口是 POST /upload（仅管理员），返回 { url }。
//
// 【为什么单独抽一个 composable，而不是直接写在 admin.vue 里】
//   1. admin.vue 已经有 1000 行，再把上传的校验与请求塞进去更难维护
//   2. 抽出来之后可以【单独写测试】：admin.vue 是页面组件，
//      而这里是可以直接调用、直接断言的普通函数
//   3. 将来别处要传图（头像、评论配图）可以直接复用
//
// 【它和 useApi 的分工】
//   useApi 负责"怎么发请求"（带 token、判 code、处理 401/403）；
//   这里负责"传什么、能不能传"（类型与大小的前端预检 + 拼 FormData）。
//   ——注意前端的校验只是【体验优化】，真正生效的是后端那一层，
//     因为前端代码可以被绕过（直接调接口）。两边都做，但定位不同。
// ============================================================

export const useUpload = () => {
  const { request } = useApi()

  /** 与后端 app.upload.allowed-extensions 保持一致 */
  const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp']

  /** 与后端 app.upload.max-size 保持一致（5MB） */
  const MAX_SIZE = 5 * 1024 * 1024
  const MAX_SIZE_TEXT = '5MB'

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
      return '请选择要上传的图片'
    }

    // 取扩展名：文件名可能带路径、可能是大写，统一处理
    const name = String(file.name || '')
    const dotIndex = name.lastIndexOf('.')
    const extension = dotIndex >= 0 ? name.slice(dotIndex + 1).toLowerCase() : ''

    if (!ALLOWED_EXTENSIONS.includes(extension)) {
      return `只支持 ${ALLOWED_EXTENSIONS.join(' / ')} 格式的图片`
    }

    // file.size 是字节数，由浏览器提供，不需要读文件内容
    if (file.size > MAX_SIZE) {
      return `图片不能超过 ${MAX_SIZE_TEXT}`
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

    const res = await request('/upload', { method: 'POST', body: formData })

    if (!res.ok) {
      // useApi 已经把后端的 message 透出来了（比如"只允许上传 xxx 格式的图片"），
      // 这里原样带上，不要自己编一句笼统的"上传失败"
      return { ok: false, message: res.message || '上传失败' }
    }

    return { ok: true, url: res.data?.url }
  }

  return { upload, validateFile, MAX_SIZE, MAX_SIZE_TEXT, ALLOWED_EXTENSIONS }
}
