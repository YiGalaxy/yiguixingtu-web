// 前端预检规则与后端 DTO/UrlPatterns 对齐；服务端是最终校验。

import { rawText } from './contentList'

export const LINK_LIMITS = Object.freeze({
  name: 50,
  url: 255,
  avatar: 255,
  description: 200,
})

export const ATTACHMENT_LIMITS = Object.freeze({
  count: 20,
  name: 100,
  url: 500,
})

export const PROJECT_LIMITS = Object.freeze({
  name: 100,
  description: 500,
  url: 255,
  repo: 255,
  cover: 255,
  tech: 200,
})

export const FAVORITE_LIMITS = Object.freeze({
  title: 100,
  url: 255,
  description: 500,
  category: 50,
})

export const ABOUT_LIMITS = Object.freeze({
  nickname: 50,
  avatar: 255,
  bio: 5000,
  email: 100,
  github: 255,
  wechat: 50,
  qq: 30,
})

export const MUSIC_LIMITS = Object.freeze({
  title: 100,
  artist: 100,
  url: 500,
  cover: 255,
  lyrics: 20000,
})

export const EXTERNAL_URL_PATTERN = /^(?:https?:\/\/\S+)?$/

export const IMAGE_URL_PATTERN = /^(?:https?:\/\/\S+|\/\S*)?$/

export const EXTERNAL_URL_MESSAGE = '地址必须以 http:// 或 https:// 开头'

export const IMAGE_URL_MESSAGE = '图片地址必须是 http(s):// 开头的完整地址，或以 / 开头的站内路径'

// 图片与媒体地址当前规则相同，保留各自的入口供独立调整。
export const MEDIA_URL_PATTERN = /^(?:https?:\/\/\S+|\/\S*)?$/

export const MEDIA_URL_MESSAGE = '音频地址必须是 http(s):// 开头的完整地址，或以 / 开头的站内路径'

export const checkRequiredText = (value, label, maxLength) => {
  const text = rawText(value)
  if (!text) return `${label}不能为空`
  if (text.length > maxLength) return `${label}最长 ${maxLength} 字`
  return ''
}

export const checkOptionalText = (value, label, maxLength) => {
  const text = rawText(value)
  if (text.length > maxLength) return `${label}最长 ${maxLength} 字`
  return ''
}

export const checkExternalUrl = (value, label, { maxLength, required = false } = {}) => {
  const text = rawText(value)
  if (!text) return required ? `${label}不能为空` : ''
  if (Number.isFinite(maxLength) && text.length > maxLength) return `${label}最长 ${maxLength} 字`
  if (!EXTERNAL_URL_PATTERN.test(text)) return `${label}必须以 http:// 或 https:// 开头`
  return ''
}

export const checkImageUrl = (value, label, { maxLength } = {}) => {
  const text = rawText(value)
  if (!text) return ''
  if (Number.isFinite(maxLength) && text.length > maxLength) return `${label}最长 ${maxLength} 字`
  if (!IMAGE_URL_PATTERN.test(text)) return `${label}${IMAGE_URL_MESSAGE.replace('图片地址', '')}`
  return ''
}

export const checkMediaUrl = (value, label, { maxLength, required = true } = {}) => {
  const text = rawText(value)
  if (!text) return required ? `${label}不能为空` : ''
  if (Number.isFinite(maxLength) && text.length > maxLength) return `${label}最长 ${maxLength} 字`
  if (!MEDIA_URL_PATTERN.test(text)) return `${label}${MEDIA_URL_MESSAGE.replace('音频地址', '')}`
  return ''
}

// 邮箱预检保持宽松，避免错误拦截后端接受的地址。
export const checkEmail = (value, label, maxLength) => {
  const text = rawText(value)
  if (!text) return ''
  if (Number.isFinite(maxLength) && text.length > maxLength) return `${label}最长 ${maxLength} 字`
  if (/\s/.test(text) || !/^[^@]+@[^@.]+(\.[^@.]+)+$/.test(text)) return `${label}格式不正确`
  return ''
}

export const checkStatus = (status) =>
  (status === 0 || status === 1) ? '' : '状态只能是 0(隐藏) 或 1(显示)'

export const requireAtLeastOneProjectAddress = (url, repo) =>
  (rawText(url) || rawText(repo)) ? '' : '在线地址和仓库地址至少要填一个，否则项目卡片点不出任何东西'
