// Field limits must match the backend CommentForm constraints.
export const COMMENT_LIMITS = Object.freeze({
  nickname: 50,
  email: 100,
  content: 1000,
})

// Status values match the backend comment table.
export const COMMENT_STATUS = Object.freeze({
  PENDING: 0,
  APPROVED: 1,
  REJECTED: 2,
})

export const COMMENT_PENDING_NOTICE = '评论已提交，等待审核'

// Keep client-side email validation permissive; the backend validates the final value.
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/

/** Return the first validation error, or null. */
export const validateCommentForm = ({ nickname, email, content } = {}) => {
  const nick = typeof nickname === 'string' ? nickname.trim() : ''
  if (!nick) return { field: 'nickname', message: '昵称不能为空' }
  if (nick.length > COMMENT_LIMITS.nickname) {
    return { field: 'nickname', message: `昵称最长 ${COMMENT_LIMITS.nickname} 字` }
  }

  const mail = typeof email === 'string' ? email.trim() : ''
  if (mail) {
    if (mail.length > COMMENT_LIMITS.email) {
      return { field: 'email', message: `邮箱最长 ${COMMENT_LIMITS.email} 字` }
    }
    if (!EMAIL_PATTERN.test(mail)) {
      return { field: 'email', message: '邮箱格式不正确' }
    }
  }

  const text = typeof content === 'string' ? content.trim() : ''
  if (!text) return { field: 'content', message: '评论内容不能为空' }
  if (text.length > COMMENT_LIMITS.content) {
    return { field: 'content', message: `评论最长 ${COMMENT_LIMITS.content} 字` }
  }

  return null
}

/** Trim fields and omit an empty optional email. */
export const normalizeCommentForm = (form = {}, articleId) => {
  const payload = {
    articleId: Number(articleId),
    nickname: String(form.nickname ?? '').trim(),
    content: String(form.content ?? '').trim(),
  }

  const mail = String(form.email ?? '').trim()
  if (mail) payload.email = mail

  return payload
}

/** Return a safe empty page when the response is unavailable. */
export const normalizeCommentPage = (response) => {
  const data = response?.ok ? response.data : null
  return {
    records: Array.isArray(data?.records) ? data.records : [],
    // total 缺失或不是数字时当成 0：它只用来判断"还有没有下一页"，
    // 兜成 0 的后果是"加载更多"按钮不出现，而不是无限翻页
    total: Number(data?.total) > 0 ? Number(data.total) : 0,
  }
}
