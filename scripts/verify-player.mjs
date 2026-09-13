// =====================================================================
// scripts/verify-player.mjs
//
// 作用：在**真实浏览器**（headless Edge）里把音乐播放器的三档模式跑一遍，
//       一条一条打印 PASS / FAIL。
//
// 【为什么需要它 —— 单测覆盖不到的那一块】
//   三档模式的核心假设是"`<audio>` 不带 `loop` 时，浏览器会在放完后派发 `ended`"。
//   而单测（happy-dom）里的 `ended` 是**手工 dispatch 出来的**：那套环境不解码音频、
//   没有时间线，所以"真的放完会发生什么"它答不了。这个脚本把进度拖到接近结尾、
//   等真实的 `ended` 事件，再读 `paused / currentSrc / 高亮行`。
//   ⚠️ 它就是这么发现一个真 bug 的：一轮播完停下之后界面显示 ▶ 而共享状态还说"想听"，
//   于是点 ▶ 等于**把开关关掉** —— "点了没反应"（修复见 README 的播放模式那一节）。
//
// 【怎么跑】
//   1. 先用调试端口起一个浏览器，并打开要测的页面：
//        msedge --headless=new --disable-gpu --mute-audio \
//               --remote-debugging-port=9222 --user-data-dir=<临时目录> \
//               --autoplay-policy=no-user-gesture-required \
//               https://你的域名/music
//      （`--autoplay-policy=no-user-gesture-required` 是必需的：脚本里的点击是合成的，
//        没有这个开关浏览器会拒绝 `play()`，后面就永远等不到 `ended`）
//   2. `node scripts/verify-player.mjs`（`ws` 从本仓库的 node_modules 解析）
//
// 【它测的是线上当前跑的那一版】页面地址由启动参数决定，脚本自己不导航。
//
// 【这个脚本自己踩过的两个坑，写在这里免得下次再犯】
//   ① 判断"切到目标模式没有"时**同步**读 `textContent` —— Vue 的 DOM 更新是异步的，
//      于是它一口气点满 3 次、从顺序播放点回顺序播放，把"随机播放"测成了顺序播放。
//      ⇒ 必须"点一下 → 等一会儿 → 再读"。
//   ② "确保在播"写成"如果 paused 就点一下 ▶" —— 而前一步 `rows[0].click()` 已经把
//      音乐打开了，这一点又把它**关掉**（▶ 是开关，不是播放）。
//      ⇒ 这个播放器的按钮是"开关"，脚本必须先读状态再动手。
// =====================================================================
import WebSocket from 'ws'

const PORT = 9222
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function findPage() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json())
      const page = list.find(t => t.type === 'page' && t.url.startsWith('http'))
      if (page?.webSocketDebuggerUrl) return page
    } catch { /* 还没起来 */ }
    await sleep(500)
  }
  throw new Error('找不到可调试的页面')
}

const { ws, ready, send } = await (async () => {
  const socket = new WebSocket((await findPage()).webSocketDebuggerUrl, { perMessageDeflate: false })
  let id = 0
  const pending = new Map()
  socket.on('message', (raw) => {
    const msg = JSON.parse(raw.toString())
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
  })
  const isReady = new Promise((resolve, reject) => { socket.on('open', resolve); socket.on('error', reject) })
  const sendCmd = (method, params = {}) => new Promise((resolve) => {
    const myId = ++id
    pending.set(myId, resolve)
    socket.send(JSON.stringify({ id: myId, method, params }))
  })
  return { ws: socket, ready: isReady, send: sendCmd }
})()
await ready
await send('Runtime.enable')

const evaluate = async (expression) => {
  const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (res.result?.exceptionDetails) throw new Error(JSON.stringify(res.result.exceptionDetails))
  return res.result?.result?.value
}

const SNAPSHOT = `(() => {
  const audio = document.querySelector('audio')
  const rows = [...document.querySelectorAll('.mp-tr-row')]
  return {
    mode: document.querySelector('.mp-mode')?.textContent?.trim(),
    src: audio.getAttribute('src'),
    shortSrc: (audio.getAttribute('src') || '').split('/').pop(),
    duration: Number.isFinite(audio.duration) ? Math.round(audio.duration) : null,
    currentTime: Math.round(audio.currentTime * 10) / 10,
    paused: audio.paused,
    currentRow: rows.findIndex(r => r.classList.contains('is-cur')),
    rowCount: rows.length,
    title: document.querySelector('.mp-title')?.textContent?.trim(),
    playBtn: document.querySelector('.mp-play')?.textContent?.trim(),
    hasLoop: audio.hasAttribute('loop'),
  }
})()`

/** 点模式按钮直到切到 target：**点一下 → 等渲染 → 再读**（同步读会点过头） */
const setMode = async (target) => {
  const label = { sequence: '顺序播放', shuffle: '随机播放', 'repeat-one': '单曲循环' }[target]
  for (let i = 0; i < 4; i++) {
    if (await evaluate(`document.querySelector('.mp-mode').textContent.trim()`) === label) break
    await evaluate(`document.querySelector('.mp-mode').click()`)
    await sleep(300)
  }
  return evaluate(`document.querySelector('.mp-mode').textContent.trim()`)
}

/** 确保真的在播：读状态 → 没在播才点 ▶ → 再读（不盲点，▶ 是开关） */
const ensurePlaying = async () => {
  for (let i = 0; i < 5; i++) {
    const snap = await evaluate(SNAPSHOT)
    if (!snap.paused) return snap
    await evaluate(`document.querySelector('.mp-play').click()`)
    await sleep(1200)
  }
  return evaluate(SNAPSHOT)
}

const waitDuration = `new Promise((resolve) => {
  const audio = document.querySelector('audio')
  let waited = 0
  const tick = () => {
    if (Number.isFinite(audio.duration) && audio.duration > 0) return resolve(Math.round(audio.duration))
    waited += 300
    if (waited > 25000) return resolve('timeout')
    setTimeout(tick, 300)
  }
  tick()
})`

/** 拖到结尾并等 ended（等到了再给界面 900ms 反应） */
const waitEnded = `new Promise((resolve) => {
  const audio = document.querySelector('audio')
  if (!Number.isFinite(audio.duration) || audio.duration <= 0 || audio.paused) {
    return resolve(audio.paused ? 'not-playing' : 'no-duration')
  }
  audio.currentTime = Math.max(0, audio.duration - 0.5)
  const done = (why) => { cleanup(); setTimeout(() => resolve(why), 900) }
  const onEnded = () => done('ended')
  const timer = setTimeout(() => done('timeout'), 20000)
  const cleanup = () => { audio.removeEventListener('ended', onEnded); clearTimeout(timer) }
  audio.addEventListener('ended', onEnded, { once: true })
})`

const clickRow = (index) => evaluate(`(() => {
  const rows = [...document.querySelectorAll('.mp-tr-row')]
  rows[${index}].click(); return rows.length
})()`)

const checks = []
const check = (name, ok, detail = '') => {
  checks.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`)
}

console.log('页面：', await evaluate('location.href'))
console.log('初始：', JSON.stringify(await evaluate(SNAPSHOT)))

// ---------------------------------------------------------------- 准备：回到第一首并确保在播
await clickRow(0)
await sleep(1200)
const start = await ensurePlaying()
check('准备：音频真的在播', start.paused === false, `paused=${start.paused}`)
check('准备：元素上没有 loop（去掉它 ended 才会来）', start.hasLoop === false)
check('准备：曲目数 > 1（只有一首歌时三档模式分不出来）', start.rowCount > 1, `${start.rowCount} 首`)

// ---------------------------------------------------------------- ① 单曲循环
console.log('\n--- ① 单曲循环：放完应当重放同一首 ---')
console.log('切到单曲循环 →', await setMode('repeat-one'))
await evaluate(waitDuration)
const beforeLoop = await evaluate(SNAPSHOT)
console.log('等它放完 →', await evaluate(waitEnded))
const afterLoop = await evaluate(SNAPSHOT)
console.log('结果：', JSON.stringify(afterLoop))
check('单曲循环放完仍是同一首', afterLoop.src === beforeLoop.src, `${beforeLoop.shortSrc} → ${afterLoop.shortSrc}`)
check('单曲循环放完仍在播', afterLoop.paused === false, `paused=${afterLoop.paused}`)
check('单曲循环放完位置回到开头', afterLoop.currentTime < 5, `currentTime=${afterLoop.currentTime}`)

// ---------------------------------------------------------------- ② 顺序播放：往下走
console.log('\n--- ② 顺序播放：放完一首应当切到下一首 ---')
console.log('切到顺序播放 →', await setMode('sequence'))
await clickRow(0)
await sleep(1200)
const seqStart = await ensurePlaying()
await evaluate(waitDuration)
console.log('等它放完 →', await evaluate(waitEnded))
const seqNext = await evaluate(SNAPSHOT)
console.log('结果：', JSON.stringify(seqNext))
check('顺序播放放完切到下一首', seqNext.currentRow === seqStart.currentRow + 1 && seqNext.src !== seqStart.src,
  `${seqStart.shortSrc} → ${seqNext.shortSrc}`)
check('顺序播放切歌之后仍在播', seqNext.paused === false, `paused=${seqNext.paused}`)

// ---------------------------------------------------------------- ③ 随机播放：换另一首
console.log('\n--- ③ 随机播放：放完应当换到另一首 ---')
console.log('切到随机播放 →', await setMode('shuffle'))
await clickRow(0)
await sleep(1200)
const shufStart = await ensurePlaying()
await evaluate(waitDuration)
console.log('等它放完 →', await evaluate(waitEnded))
const shufNext = await evaluate(SNAPSHOT)
console.log('结果：', JSON.stringify(shufNext))
check('随机播放放完换了另一首', shufNext.src !== shufStart.src && shufNext.currentRow !== shufStart.currentRow,
  `${shufStart.shortSrc} → ${shufNext.shortSrc}`)
check('随机播放换歌之后仍在播', shufNext.paused === false, `paused=${shufNext.paused}`)

// ---------------------------------------------------------------- ④ 顺序播放放到最后一首 = 停下
console.log('\n--- ④ 顺序播放：最后一首放完应当停下，并且"收拾干净" ---')
console.log('切到顺序播放 →', await setMode('sequence'))
await clickRow((await evaluate(SNAPSHOT)).rowCount - 1)   // 最后一行
await sleep(1200)
const lastStart = await ensurePlaying()
await evaluate(waitDuration)
console.log('最后一首：', JSON.stringify(lastStart))
check('停在最后一首上', lastStart.currentRow === lastStart.rowCount - 1, `row=${lastStart.currentRow}`)

console.log('等它放完 →', await evaluate(waitEnded))
const afterLast = await evaluate(SNAPSHOT)
console.log('结果：', JSON.stringify(afterLast))
check('顺序播放最后一首放完停下', afterLast.paused === true, `paused=${afterLast.paused}`)
check('停下时按钮回到 ▶', afterLast.playBtn === '▶', `btn=${afterLast.playBtn}`)
check('停下时进度归零', afterLast.currentTime < 1, `currentTime=${afterLast.currentTime}`)
check('停下时回到第一首', afterLast.currentRow === 0, `row=${afterLast.currentRow}`)

// ---------------------------------------------------------------- ⑤ 停下之后点 ▶ 真的重新开始
console.log('\n--- ⑤ 停下之后点一下 ▶ 应当真的从第一首重新开始（真机验证发现的坑） ---')
await evaluate(`document.querySelector('.mp-play').click()`)
await sleep(2000)
const resumed = await evaluate(SNAPSHOT)
console.log('结果：', JSON.stringify(resumed))
check('停下之后点 ▶ 真的重新开始', resumed.paused === false, `paused=${resumed.paused}`)
check('重新开始时在第一首、位置从头', resumed.currentRow === 0 && resumed.currentTime < 6,
  `row=${resumed.currentRow} currentTime=${resumed.currentTime}`)

const failed = checks.filter(c => !c.ok)
console.log(`\n=== 共 ${checks.length} 条，失败 ${failed.length} 条 ===`)
failed.forEach(f => console.log('  FAILED:', f.name))
ws.close()
process.exit(failed.length ? 1 : 0)
