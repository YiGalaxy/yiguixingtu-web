// ============================================================
// app/utils/playMode.ts
//
// 作用：**播放模式的唯一一份定义与算法**（纯函数、无副作用、不碰 DOM）。
//       三档模式 —— 顺序播放 / 随机播放 / 单曲循环 —— 以及最要紧的那个问题：
//       **这一首放完了，下一首放谁？**
//
// 【为什么把这段逻辑单独抽成一个纯函数文件】
//   它本来可以直接写在 `app.vue` 的 `ended` 处理里（那里才有 `<audio>`），
//   但"下一首是谁"这件事有三个分支 × 若干边界（只有一首歌、列表变了、
//   洗牌袋里剩下的是刚放完的那首……），塞在事件处理里就只能靠**真的播完一首歌**
//   来验证 —— 一首歌几分钟，测试里根本等不到。
//   抽成纯函数之后，喂几个数字就能把每条分支跑一遍（见 test/playMode.spec.ts），
//   而 `app.vue` 那边只剩下"照着结果换音源"这一件事。
//
// 【三档模式的语义（这就是产品定义，别改错）】
//   · `sequence`   顺序播放：按曲目列表往下走，**最后一首放完就停**。
//                  停下来的含义是"不再自动播下一首"，不是把播放器弄坏：
//                  界面回到 ▶，用户点一下还能从当前这首重新开始。
//                  【为什么不循环回第一首】那是另一个模式（列表循环）；
//                  这里刻意与"单曲循环"区分开：一个管"往下走"，一个管"原地打转"。
//   · `shuffle`    随机播放：**一轮之内不重复**（洗牌袋算法，见下），
//                  一轮放完重新洗牌再开一轮 —— 所以它不会停，也基本不会
//                  "刚放完 A 又抽到 A"。
//                  ⚠️ 边界：曲目只有一首时，"洗牌"没有意义，直接原曲重放
//                  （否则用户会看到"随机播放放完一首就哑了"，那更像是坏了）。
//   · `repeat-one` 单曲循环：一直放当前这一首。
//
// 【随机播放为什么不是"每首放完就 Math.random() 抽一个"】
//   纯随机会出现两种用户能立刻察觉的毛病：① 刚放完的歌马上又被抽中（听着像卡住了）；
//   ② 某一首运气不好，一整晚都抽不到（用户会以为"我加的那首歌丢了"）。
//   洗牌袋（shuffle bag）是通行做法：把"还没放过的下标"装进一个袋子、洗乱，
//   每次从袋子里取一个；袋子空了再重新装一轮。
//   于是 N 首歌恰好每 N 首一轮、每轮内不重复 —— 看起来是随机的，但不会漏播。
//
// 【random 为什么是参数而不是直接用 Math.random】
//   这样测试可以喂一个确定的伪随机序列，把"洗牌结果"钉死
//   （否则"随机"这件事根本没法断言，只能断言"结果在这几个数里"，等于没测）。
// ============================================================

/** 三档播放模式，**顺序就是按钮循环切换的顺序** */
export const MUSIC_MODES = Object.freeze(['sequence', 'shuffle', 'repeat-one'])

/** 模式 → 界面上给用户看的名字。按钮上直接写这个（不用图标，理由见 music.vue） */
export const MUSIC_MODE_LABEL = Object.freeze({
  sequence: '顺序播放',
  shuffle: '随机播放',
  'repeat-one': '单曲循环',
})

/** 默认：顺序播放 —— 行为最好预测的那一档（也最接近"没有这个功能"之前的样子） */
export const DEFAULT_MUSIC_MODE = 'sequence'

/** 是不是一个认识的模式（从 localStorage 读回来的值必须先过这一关） */
export const isMusicMode = (value) => MUSIC_MODES.includes(value)

/**
 * 循环切到下一档：顺序 → 随机 → 单曲循环 → 顺序……
 * 【非法值怎么办】当作"还没设过"，从第一档开始 ——
 *   旧版存下的值、用户手改的 localStorage、将来删掉某个模式，都会走到这里。
 */
export const nextMusicMode = (mode) => {
  const index = MUSIC_MODES.indexOf(mode)
  return MUSIC_MODES[(index + 1) % MUSIC_MODES.length]
}

/**
 * 洗一轮牌：返回一个包含 `total` 个下标、**不含 `exclude`** 的乱序数组。
 *
 * 【为什么把 exclude 摘掉，而不是洗完再判断"第一个是不是它"】
 *   摘掉之后返回值天然满足"下一个不是刚放完的那一首"，
 *   调用方不用再做一次"重抽"，也就不会有"重抽到天荒地老"的可能性。
 *
 * 【为什么是 Fisher-Yates，而不是 sort(() => Math.random() - 0.5)】
 *   后者看着短，但它**不是均匀分布**（比较函数不自洽，结果偏向原顺序附近），
 *   而且不同引擎的排序实现不同 —— 一个"随机播放"如果每次顺序都差不多，
 *   用户是会发现的。Fisher-Yates 是 O(n) 且严格均匀的标准做法。
 */
export const createShuffleBag = (total, exclude, random = Math.random) => {
  const pool = []
  for (let i = 0; i < total; i++) {
    if (i !== exclude) pool.push(i)
  }
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    const tmp = pool[i]
    pool[i] = pool[j]
    pool[j] = tmp
  }
  return pool
}

/**
 * 一首放完了：算出下一首该放哪一个。
 *
 * @param {object}   options
 * @param {string}   options.mode    当前播放模式（`MUSIC_MODES` 之一）
 * @param {number}   options.current 刚放完的那一首在列表里的行号
 * @param {number}   options.total   曲目总数
 * @param {number[]} [options.bag]   上一轮剩下的洗牌袋（顺序/单曲循环模式下会清空）
 * @param {Function} [options.random] 随机源（测试用）
 * @returns {{ index: number|null, bag: number[] }}
 *   `index === null` 表示**放完了、停下来**（只有顺序播放的最后一首会这样）；
 *   `index === current` 表示**把当前这首重头再放**（单曲循环，或者只有一首歌）；
 *   其余情况调用方切到那个行号即可。
 *
 * 【为什么把 bag 一起返回，而不是让调用方自己维护】
 *   袋子是"这次随机会话"的状态，但它的**变化规则**属于算法本身
 *   （什么时候重新洗、什么时候清空）。放在这里，调用方只需要
 *   `({ index, bag } = advancePlayback(...))` 原样存回去，
 *   不会出现"忘了把新袋子存回来"这种只会在第二轮随机时才暴露的问题。
 */
export const advancePlayback = ({ mode, current, total, bag = [], random = Math.random }) => {
  const count = Number(total)
  if (!Number.isInteger(count) || count <= 0) return { index: null, bag: [] }

  const cur = (Number.isInteger(current) && current >= 0 && current < count) ? current : 0

  if (mode === 'repeat-one') {
    // 单曲循环：袋子用不上，顺手清掉 —— 免得用户切了一圈模式回来之后，
    // 拿到一个几分钟前（列表还是旧的时候）装的袋子
    return { index: cur, bag: [] }
  }

  if (mode === 'sequence') {
    const next = cur + 1
    return { index: next < count ? next : null, bag: [] }
  }

  // ---- 随机播放 ----
  // 只有一首歌时没有"下一首"可选，原曲重放（见文件头那段边界说明）
  if (count === 1) return { index: 0, bag: [] }

  // 袋子里的脏数据要过滤掉：列表可能被后台改短了（下标越界），
  // 也可能装着"正在放完的这一首"（用户在随机播放中途手动点过它）
  const rest = (Array.isArray(bag) ? bag : []).filter(
    i => Number.isInteger(i) && i >= 0 && i < count && i !== cur,
  )
  const pool = rest.length ? rest : createShuffleBag(count, cur, random)

  return { index: pool[0], bag: pool.slice(1) }
}
