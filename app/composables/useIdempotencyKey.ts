// ============================================================
// app/composables/useIdempotencyKey.ts
//
// 作用：为"一次提交动作"生成并持有一个幂等键（Idempotency-Key）。
//
// 【为什么单独抽成一个 composable，而不是写在 admin.vue 里】
//   两点考虑：
//     ① 它是纯逻辑（生成一个随机串、什么时候换新的），和界面无关。
//        留在页面组件里就只能靠"跑整个页面"来测，而抽出来之后
//        可以直接断言"同一个动作里键不变、换动作后键变了"。
//     ② admin.vue 已经一千多行（路线图 web-7 要把"新建/编辑文章"这块拆出去），
//        新加的逻辑不该继续往里堆。
//
// 【这个键的语义，是它能不能防住重复提交的关键】
//   · 一次"提交动作" = 用户从打开新建弹窗到保存成功（或放弃）的整个过程
//   · 这个过程中的所有重复点击 / 重试，都带【同一个键】→ 后端只认第一次
//   · 用户真要再写一篇时会重新点「新建文章」→ rotate() 换一个新键
//
//   反过来说：如果每次点保存都生成新键，用户点两下就是两个不同的键，
//   后端会当成两次不同的创建请求，照样写出两篇文章 —— 那就白做了。
// ============================================================

/**
 * 生成一个幂等键。
 *
 * 【为什么用 crypto.randomUUID()】
 *   浏览器内置，不需要引 uuid 之类的第三方包。UUID v4 的随机性
 *   足够保证"不同用户的键不会撞在一起"，而幂等键正是需要这一点。
 *
 * 【为什么要留兜底分支】
 *   crypto.randomUUID 只在【安全上下文】（https / localhost）里存在。
 *   本地开发是 localhost、线上是 https，都在安全上下文内；
 *   但万一将来有人用 http + IP 直接访问（比如内网演示），
 *   这里会静默变成 undefined 然后抛错。留个兜底分支更稳。
 *   兜底值不承担安全职责 —— 幂等键只是去重标记，不是密钥。
 */
export const generateIdempotencyKey = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `idem-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

/**
 * 持有"当前这次提交动作"的幂等键。
 *
 * @returns {{ key: import('vue').Ref<string>, rotate: () => string }}
 *   key    —— 当前键（第一次访问时自动生成，不用手动初始化）
 *   rotate —— 换一个新键（新的一次提交动作开始时调用），返回新键
 */
export const useIdempotencyKey = () => {
  const key = ref('')

  /** 换一个新键；返回新值是为了让调用方不用再多读一次 ref */
  const rotate = () => {
    key.value = generateIdempotencyKey()
    return key.value
  }

  /** 确保有值：还没生成过就先生成一个（这样调用方不必关心初始化时机） */
  const ensure = () => {
    if (!key.value) rotate()
    return key.value
  }

  return { key, rotate, ensure }
}
