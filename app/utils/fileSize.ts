/**
 * 文件大小的显示规则（后台附件列表、以及将来的其它地方都用它）。
 *
 * 【为什么单独抽一个纯函数】附件大小来自接口的**字节数**，直接显示会变成
 * `1048576` 这种没人读得懂的数字。而它要在后台编辑弹窗与其它地方用**同一套**规则：
 * 各写一份的话，一处显示 `1.0 MB`、另一处显示 `1024 KB`，
 * 用户会以为"这是两个不同的文件"。抽成纯函数之后还能单独写测试把边界钉住。
 *
 * 【为什么按 1024 而不是 1000 进制】文件系统与浏览器都用 1024（这也是 KiB 的语义）。
 * 用 1000 的话，界面上写「不超过 100MB」而上传一个 100MB 的文件被拒，
 * 用户去"文件属性"里看却是 95.4 MB —— 这种对不上最容易让人以为系统有 bug。
 *
 * 【为什么拿不到数字时返回「—」而不是空串】空白单元格会让人以为"页面没加载出来"；
 * 而「—」在本项目里是统一的"这一格没有值"符号（与 formatDateTime 一致）。
 *
 * @param {number} bytes 字节数
 * @returns {string} 形如 `1.2 MB` / `512 KB` / `980 B`；非法输入时是「—」
 */
export const formatFileSize = (bytes) => {
  // ⚠️ 【为什么不能只写 Number.isFinite(Number(bytes))】这是第一版的 bug：
  //    Number(null) === 0、Number('') === 0、Number([]) === 0 —— 于是"没有值"
  //    会被显示成 `0 B`。而 0 字节的文件在上传时就被拦下了
  //    （见 useUpload.validateFile 里那条 "不能上传空文件"），
  //    所以 `0 B` 这个显示结果本身就是错的：用户看到"一个 0 字节的文件"只会困惑。
  //    规则：**只接受数字本身与非空数字字符串**（接口把 Long 回成字符串是见过的），
  //    其余一律是「—」（本文件与 formatDateTime 统一的"这一格没有值"）。
  const isNumericText = typeof bytes === 'string' && bytes.trim() !== ''
  if (typeof bytes !== 'number' && !isNumericText) return '—'

  const n = Number(bytes)
  if (!Number.isFinite(n) || n < 0) return '—'
  if (n < 1024) return `${n} B`
  const kb = n / 1024
  if (kb < 1024) return `${Math.round(kb)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(1)} MB`
  return `${(mb / 1024).toFixed(2)} GB`
}
