import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { generateIdempotencyKey, useIdempotencyKey } from '../app/composables/useIdempotencyKey'

// =====================================================================
// useIdempotencyKey 的单元测试
//
// 【为什么这个小东西值得单独测】
//   "防重复提交"能不能真的生效，全靠这个键的【切换时机】：
//     · 同一次提交动作里的重复点击必须带【同一个键】——否则后端当成两次请求，
//       照样写出两篇文章，等于白做；
//     · 换一次新建动作必须换【新键】——否则用户想写第二篇时会被后端
//       当成重复请求直接拦掉，看起来像"发布没反应"。
//   这两条都是"写错了在界面上完全看不出来"的错误：
//   前者偶发（要点得快才复现），后者要等用户写第二篇才发现。
//   所以用断言把这两个语义钉住。
//
// 【为什么这个测试不需要 mockNuxtImport】
//   这个 composable 只用了 Nuxt 自动导入的 ref()，没碰 $fetch / useCookie。
//   直接 import 真身来测最接近生产行为。
// =====================================================================

describe('generateIdempotencyKey', () => {
  it('生成的应当是非空字符串', () => {
    const key = generateIdempotencyKey()
    expect(typeof key).toBe('string')
    expect(key.length).toBeGreaterThan(0)
  })

  it('连续生成多次都不该重复', () => {
    // 幂等键如果会重复，两个不同的提交动作就会互相顶掉 ——
    // 表现是"第二篇文章发布后不见了"，而且极难排查。
    const keys = new Set()
    for (let i = 0; i < 200; i++) keys.add(generateIdempotencyKey())
    expect(keys.size).toBe(200)
  })

  describe('crypto.randomUUID 不可用时（http 等非安全上下文）', () => {
    beforeEach(() => {
      // 【为什么用 vi.stubGlobal 而不是直接赋值 globalThis.crypto】
      //   在 Node 里 globalThis.crypto 是【只有 getter】的属性，
      //   直接 `globalThis.crypto = {...}` 会抛
      //   "Cannot set property crypto of #<Object> which has only a getter"。
      //   （第一版就是这么写的，跑出来两个红。）
      //   vi.stubGlobal 内部用 defineProperty 覆盖，并且能用
      //   unstubAllGlobals() 干净地还原，是更合适的做法。
      vi.stubGlobal('crypto', { randomUUID: undefined })
    })

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('应当走兜底分支，而不是抛错', () => {
      // 这里守的是"部署到 http 上时，保存按钮不会直接报错"
      expect(() => generateIdempotencyKey()).not.toThrow()
      expect(generateIdempotencyKey().length).toBeGreaterThan(0)
    })

    it('兜底分支生成的键也不该重复', () => {
      const keys = new Set()
      for (let i = 0; i < 200; i++) keys.add(generateIdempotencyKey())
      expect(keys.size).toBe(200)
    })
  })
})

describe('useIdempotencyKey（一次提交动作持有的键）', () => {
  it('rotate() 应当换出一个新键，并且返回它', () => {
    const { key, rotate } = useIdempotencyKey()

    const first = rotate()
    expect(key.value).toBe(first)

    const second = rotate()
    expect(second).not.toBe(first)
    expect(key.value).toBe(second)
  })

  it('同一轮里反复 ensure() 必须拿到【同一个】键', () => {
    // 这条就是"连点两下只创建一篇文章"的核心：
    // 两次点击调用 ensure() 拿到的必须是同一个键。
    const { ensure } = useIdempotencyKey()

    const a = ensure()
    const b = ensure()
    const c = ensure()

    expect(a).toBe(b)
    expect(b).toBe(c)
  })

  it('rotate() 之后 ensure() 应当返回新键', () => {
    // 换了一次新建动作（用户点了「新建文章」）之后，
    // 之前的键不能再用 —— 否则第二篇文章会被后端当成重复请求拦掉
    const { rotate, ensure } = useIdempotencyKey()

    const first = ensure()
    rotate()
    const second = ensure()

    expect(second).not.toBe(first)
  })

  it('还没生成过就先 ensure() -> 应当自动补一个，而不是返回空串', () => {
    // 传空字符串的 Idempotency-Key 等价于"没带"，后端不会启用幂等 ——
    // 那种"看起来做了防护其实没做"的状态最危险，所以这里断言非空
    const { key, ensure } = useIdempotencyKey()
    expect(key.value).toBe('')

    expect(ensure().length).toBeGreaterThan(0)
    expect(key.value.length).toBeGreaterThan(0)
  })
})
