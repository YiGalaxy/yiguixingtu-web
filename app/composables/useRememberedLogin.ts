// ============================================================
// app/composables/useRememberedLogin.ts
//
// 作用：管理登录弹窗上那个「记住密码」勾选框对应的 cookie（名字是 rememberMe）。
//
// 【这个文件存在的唯一理由：明文密码曾经被写进 cookie】
//   原来的实现是两行：
//       回填：form.password = remember.value.password
//       保存：remember.value = { username, password }
//   于是**明文密码被写进了浏览器 cookie** —— 安全审查里的 🔴 那一条。这比看起来更糟：
//     · cookie 会随每一个请求发给同域的服务端与反向代理，日志、抓包里都能看到
//     · 它不是 httpOnly，任何一段注入到页面里的脚本（XSS）读一下 document.cookie 就拿到了
//     · 用户"记住密码"通常意味着这个密码和别处一样，一次泄露往往牵连多个站点
//   而后端根本不需要它：登录接口本来就是每次校验账号密码，
//   没有任何"用已记住的密码自动登录"的接口。也就是说这个密码存下来
//   【除了给自己留一个泄露点之外，什么功能都没实现】。
//   现在只记住用户名（表单里少打几个字），密码一律不落任何客户端存储。
//
// 【老 cookie 必须主动清掉】
//   只改代码是不够的：老用户浏览器里那个带着密码的 cookie 不会自己消失，
//   而且它还有可能长期存在（等于"修完了但漏洞还在"）。
//   所以挂载时会读一次 cookie，只要发现里面带着 username 之外的字段（尤其是 password），
//   就立刻把它换写成只含 username 的新值（restore() 里的 migrated 分支）。
//
// 【技术栈与关键字】
//   · useCookie(name)：Nuxt 的 cookie 读写 API，返回一个 ref。对象值会被序列化
//     （读出来可能是对象，也可能是没有解码的 JSON 字符串 —— 两种都要能处理）
//   · 本文件里的判断与拼装都写成纯函数，好在测试里直接断言"写进 cookie 的东西长什么样"
// ============================================================

/** cookie 名。单独提出来是因为测试与"清理历史遗留"都要引它 */
export const REMEMBER_COOKIE_NAME = 'rememberMe'

/**
 * 用户名长度上限。
 * 【为什么要有】cookie 是个自带 4KB 上限的东西，而且每一个请求都会把它带上。
 * 正常的用户名远短于这个数，这里只是防止有人往这个字段里塞一长串东西
 * （值来自用户自己的输入框，属于"外部输入"）。
 */
const USERNAME_MAX_LENGTH = 64

/** 新 cookie 里【允许】出现的字段：只有这一个 */
const ALLOWED_KEYS = Object.freeze(['username'])

/**
 * 把 cookie 里读到的东西统一成一个对象。
 * 【为什么要兼容三种形态】
 *   · 对象：useCookie 正常解码出来的样子（也是我们自己写进去的样子）
 *   · JSON 字符串：某些版本/环境下 useCookie 不做 JSON 解码，值就是原文
 *   · 普通字符串：更早的版本可能只存了一串用户名
 * 三种都收进来，是为了让"清理历史遗留"这一步对老数据也能生效 ——
 * 只认一种形态的话，另一种形态的老 cookie 就会带着密码继续躺着。
 */
export const parseRememberCookie = (raw) => {
  if (!raw) return null
  if (typeof raw === 'object') return raw
  if (typeof raw !== 'string') return null

  const text = raw.trim()
  if (!text) return null
  if (!text.startsWith('{')) {
    // 不是 JSON，就当成"直接存了用户名"
    return { username: text }
  }
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    // 残缺的 JSON（手工改过 / 写入过程中断）当作没有这个 cookie，
    // 而不是抛出去把整个登录弹窗带崩
    return null
  }
}

/** 从 cookie 值里取出用户名（拿不到就返回空串） */
export const readRememberedUsername = (raw) => {
  const name = parseRememberCookie(raw)?.username
  return typeof name === 'string' ? name.trim().slice(0, USERNAME_MAX_LENGTH) : ''
}

/**
 * 这个 cookie 是不是"老版本留下的"（即带有用户名之外的字段）。
 *
 * 【为什么不是只判 password】判 password 能覆盖绝大多数情况，但白名单更彻底：
 * 只要出现了我们不再需要的字段，就说明它是旧格式，一律重写。
 * 以后万一有人又往里加"手机号"之类的东西，这条判断也会提示它需要清理。
 */
export const hasLegacyFields = (raw) => {
  const parsed = parseRememberCookie(raw)
  if (!parsed) return false
  return Object.keys(parsed).some((key) => !ALLOWED_KEYS.includes(key))
}

/**
 * 生成要写进 cookie 的值 —— **只含 username，别的什么都没有**。
 *
 * 【为什么用"构造"而不是"从旧对象里删字段"】
 *   删字段（delete legacy.password）依赖"我知道旧格式有哪些字段"；
 *   而构造只依赖"新格式里有什么"，无论旧 cookie 里多过什么，
 *   写出去的值都只可能是 { username }。少想一件事，就少一个漏掉的可能。
 *
 * @returns {{username: string}|null} 用户名为空时返回 null（= 删除这个 cookie）
 */
export const buildRememberCookie = (username) => {
  const name = typeof username === 'string' ? username.trim().slice(0, USERNAME_MAX_LENGTH) : ''
  return name ? { username: name } : null
}

/**
 * 「记住用户名」的读写入口。
 *
 * 【为什么不直接把 cookie 逻辑留在 app.vue 里】
 *   这几件事都容易写错且出错时界面上看不出来：只记用户名、兼容老格式、
 *   发现老 cookie 就重写、不写空值。抽出来之后能脱离页面直接断言
 *   "最后写进 cookie 的到底是什么"，而 app.vue 只负责把勾选框绑上去。
 */
export const useRememberedLogin = () => {
  // 不设 maxAge = 会话级 cookie（浏览器关掉就没了）—— 与改动前保持一致。
  // 【为什么不顺手改成"30 天"】那是另一个决定（要不要长期记住这个用户名），
  // 不该夹在"把明文密码摘掉"这一次改动里做。
  const cookie = useCookie(REMEMBER_COOKIE_NAME)

  /** 勾选框的状态（v-model 用） */
  const remember = ref(false)
  /** 记住的用户名（回填输入框用） */
  const username = ref('')

  /**
   * 页面挂载时调一次：把用户名读回来，并**顺手清理老 cookie**。
   *
   * @returns {{username: string, remember: boolean, migrated: boolean}}
   *   migrated = 这次调用是否改写了 cookie（发现了老格式，或者发现值是 JSON 字符串）
   */
  const restore = () => {
    const name = readRememberedUsername(cookie.value)
    const legacy = hasLegacyFields(cookie.value)
    // 值还是 JSON 字符串形态时也要重写一次：让它回到"对象"这个正常形态，
    // 否则下一次读到的又是一串需要解析的文本（每次都得兜着走）
    const plainString = typeof cookie.value === 'string' && name !== ''

    username.value = name
    remember.value = name !== ''

    if (legacy || plainString) {
      // 【必须写回，而不是"只清内存里的"】cookie 是浏览器里的东西，
      // 不写回去它就一直躺在那里；而这里的写回用的是构造出来的
      // { username }，所以老 cookie 里的密码在这一刻真正消失
      cookie.value = buildRememberCookie(name)
    }

    return { username: name, remember: name !== '', migrated: legacy || plainString }
  }

  /** 登录成功且勾了「记住用户名」时调用 */
  const save = (name) => {
    const value = buildRememberCookie(name)
    cookie.value = value
    username.value = value ? value.username : ''
    remember.value = Boolean(value)
  }

  /** 没勾（或用户主动清掉）时调用：把 cookie 删干净 */
  const clear = () => {
    cookie.value = null
    username.value = ''
    remember.value = false
  }

  return { remember, username, restore, save, clear }
}
