// ============================================================
// app/utils/siteSettings.ts
//
// 站点设置的【形状 + 归一化】，以及表单要用的长度限制。
//
// 【为什么归一化要单独拿出来当纯函数】
//   站点设置是"后端可能给不全、还可能整个读不到"的一份数据：
//   后端那一行被人删掉时会返回 null 字段，接口挂掉时前端拿到的是空。
//   如果每个用到它的地方各自 `settings?.siteName || '...'` 地兜，
//   兜法一定会不一致 —— 最典型的是**评论开关**：一处按"读不到就当成开"、
//   另一处按"读不到就当成关"，于是在接口抖一下的时候评论框就忽隐忽现。
//   所以：一处归一化，拿到的地方拿到的永远是**形状完整**的对象，
//   每条回落规则都写在下面，并且都有单测钉着（test/siteSettings.spec.ts）。
// ============================================================

import { SITE_NAME } from './seo'

/** 每页文章条数的下界（与后端 DTO 的 @Min(1) 一致） */
export const PAGE_SIZE_MIN = 1

/**
 * 每页文章条数的上界。
 * ⚠️ 必须与后端的 `ArticleQuery.MAX_PAGE_SIZE`（50）一致：
 *    文章接口会把超出的 size **静默夹到 50**，前端若允许更大的值，
 *    站长会看到一个"设置了但不生效"的开关。
 *    后端那边也是同一个常量在管（见 SettingForm 的 @Max），两边都指向"50 这个事实"。
 */
export const PAGE_SIZE_MAX = 50

/**
 * 首页每页文章条数的默认值。
 * 【为什么是 12】首页的文章区是 3 列瀑布流，12 = 正好 4 行 —— 这是**排版决策**，
 * 所以它属于前端，后端不重复写一份（后端只在缺行时返回 null）。
 */
export const DEFAULT_PAGE_SIZE = 12

/**
 * 备案号要链到的地址：工信部备案管理系统。
 * 【为什么写死、不让站长填】备案号按规范必须链到工信部的查询页，站长没有理由填别的；
 * 让它可以配置只会多出"填错/填成别处"的可能。数据库里也只存号本身。
 */
export const ICP_LINK = 'https://beian.miit.gov.cn/'

/**
 * 公安备案要链到的平台：公安部「全国互联网安全管理服务平台」。
 *
 * 【为什么和 ICP 那个常量分成两个，而不是共用一个"备案链接"】
 *   它们是**两个不同的备案体系**，由不同机关发证、查询入口也完全不同：
 *     · ICP 备案 → 工信部，一个固定的查询页，谁的号都链到同一个地址
 *     · 公安网安备案 → 公安部平台，查询要**带上这个站的备案编号**
 *   所以 ICP 只需要一个常量，公安这边还需要下面那个"按号拼地址"的函数。
 */
export const POLICE_LINK = 'https://beian.mps.gov.cn/'

/**
 * 由公安备案号拼出它的查询链接。
 *
 * 【为什么要从号里"抠出数字"】公安备案号是「川公网安备 51090002000169号」这种形态：
 *   前面的省份简称与后面的「号」都只是给人看的，平台查询页要的参数是**中间那串数字**
 *   （`#/query/webSearch?code=51090002000169`）。让站长再单独填一遍数字，
 *   只会多出"两个字段对不上"的可能，所以这里从号里取数字部分。
 *
 * 【一个数字都没有时怎么办（比如站长手滑填了乱码）】
 *   回落到平台首页，而不是拼出一个 `code=` 空参数的死链 ——
 *   合规要求是"页脚要能链到公安备案平台"，落到平台首页仍然满足这一点，
 *   而空 code 的地址点开只会是一片空白。
 */
export const policeQueryUrl = (policeNumber: string): string => {
  const code = String(policeNumber ?? '').replace(/\D/g, '')
  return code ? `${POLICE_LINK}#/query/webSearch?code=${code}` : POLICE_LINK
}

/** 表单里各字段的长度上限，与后端 DTO 的 @Size、数据库列长度三处一致 */
export const SETTING_LIMITS = {
  siteName: 50,
  announcement: 500,
  icpNumber: 50,
  policeNumber: 50,
  copyright: 200,
} as const

/** 归一化之后的站点设置：**形状永远完整**，用的人不用再判空 */
export interface SiteSettings {
  /** 站点名：永远有值（读不到时回落到 seo.ts 的 SITE_NAME，见下面那条说明） */
  siteName: string
  /** 首页公告：null 表示"不显示这一块"（而不是显示一个空条） */
  announcement: string | null
  /** 评论总开关：读不到时回落到 true（见下面那条说明） */
  commentEnabled: boolean
  /** ICP 备案号：null 表示页脚不显示备案信息 */
  icpNumber: string | null
  /** 公安网安备案号：null 表示页脚不显示公安备案那一项（与 icpNumber 各自独立） */
  policeNumber: string | null
  /** 页脚版权：null 表示页脚不显示版权行 */
  copyright: string | null
  /** 每页文章条数：永远在 1~50 之间 */
  pageSize: number
}

/**
 * 读不到任何设置时用的默认值 —— 它就是"上线这个功能之前"的站点表现。
 * 【站点名为什么能回落成常量】`SITE_NAME` 本来就是这个站的默认站点名
 * （SEO 标题、RSS 标题都在用它）。后端在缺行时刻意返回 null 而不是自己编一个站名，
 * 就是为了让"默认站点名"只有这一处定义（改站名不会漏掉后端那一份）。
 */
export const DEFAULT_SITE_SETTINGS: SiteSettings = {
  siteName: SITE_NAME,
  announcement: null,
  commentEnabled: true,
  icpNumber: null,
  policeNumber: null,
  copyright: null,
  pageSize: DEFAULT_PAGE_SIZE,
}

/** 空白字符串 → null（后端的可选字段也是这个语义：空 = 没有，而不是空串） */
const text = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * 每页条数：
 *   · 不是数字 / 不是有限值 / 小于 1 → 回落默认值
 *   · 大于上界 → **夹到上界**（而不是回落）：值大得离谱时，用户显然是想"多显示一些"，
 *     给他 50 比给他 12 更接近他的意图
 *   · 小数（比如 12.7）→ 取整
 */
const toPageSize = (value: unknown): number => {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n < PAGE_SIZE_MIN) return DEFAULT_PAGE_SIZE
  return Math.min(Math.floor(n), PAGE_SIZE_MAX)
}

/**
 * 把接口返回的原始值收拾成形状完整的 {@link SiteSettings}。
 * 传 null / undefined / 任何非对象都安全 —— 这是它存在的意义（见文件头）。
 */
export const normalizeSiteSettings = (raw: unknown): SiteSettings => {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    // 【站点名为什么用 ?? 而不是"空就回落"】text() 已经把空串变成 null 了，
    // 所以这里一个 ?? 就同时覆盖了"null"和"空串"两种情况
    siteName: text(src.siteName) ?? DEFAULT_SITE_SETTINGS.siteName,
    announcement: text(src.announcement),
    // 【⚠️ 评论开关读不到时按"开启"处理】这是这条归一化里最要紧的一条：
    //   · 它在"配置读不到"时保持现状（评论一直是开着的），不会因为接口抖一下
    //     就把全站的评论框藏起来 —— 那属于"配置缺失升级成功能消失"
    //   · 只有后端明确给 false 时才关（后端那边存的是 0/1，接口层转成布尔）
    commentEnabled: typeof src.commentEnabled === 'boolean'
      ? src.commentEnabled
      : DEFAULT_SITE_SETTINGS.commentEnabled,
    icpNumber: text(src.icpNumber),
    policeNumber: text(src.policeNumber),
    copyright: text(src.copyright),
    pageSize: toPageSize(src.pageSize),
  }
}

/** ICP 备案信息是否该显示（有号才显示，空串与 null 都算没有） */
export const hasIcp = (settings: SiteSettings): boolean => settings.icpNumber !== null

/** 公安网安备案信息是否该显示（与 ICP 各自独立：填了哪个显示哪个） */
export const hasPolice = (settings: SiteSettings): boolean => settings.policeNumber !== null

/**
 * 页脚最底下那一行（版权 / ICP / 公安备案）**整行**该不该渲染。
 *
 * 【为什么要把"三选一"抽成函数，而不是在模板里写 `a || b || c`】
 *   这一行是"有一项就渲染整行、一项都没有就整行不存在"的结构，
 *   而"哪些项算有"这件事已经被归一化统一成了"非 null"。
 *   把它写进模板的话，下一个加字段的人（比如再加个"增值电信业务经营许可证号"）
 *   很容易只加 `<a>` 却忘了改那个 `||` —— 表现是"填了但不显示"，而且不报任何错。
 *   抽成函数之后，新字段只要进这里一次，模板那边不用动。
 */
export const hasFooterMeta = (settings: SiteSettings): boolean =>
  hasIcp(settings) || hasPolice(settings) || settings.copyright !== null
