// @vitest-environment node
// =====================================================================
// test/dockerBuild.spec.ts
//
// 作用：守住前端镜像【构建阶段】这条契约 —— 「跑 `nuxt build` 的那一层，
//       必须给 Node 一个内存上限，而且这个上限要明显小于宿主机的物理内存」。
//
// 【为什么要有这个测试：它是被一次真实的服务器卡死逼出来的】
//   部署时（2026-09-11）在服务器上执行
//   `docker compose -f docker-compose.prod.yaml build frontend`，
//   构建停在 Nitro 那一步之后，**整台机器失去响应**：
//     · SSH 能连上但拿不到提示符 —— sshd 连自己的 banner 都发不出来
//     · 443 的 TLS 握手 18 秒拿不到一个字节；80 端口一个纯跳转从 20ms 级涨到 1.4 秒
//     · 阿里云控制台的「远程连接」也超时（它同样是新建一个 SSH 会话）
//   最后只能从控制台强制重启。事后确认：磁盘没满（40G 只用了 11G）、
//   一个容器都没在跑 —— 就是 `nuxt build` 自己把 1.6G 物理内存 + 4G swap 吃光，
//   整机进入 swap 抖动（进程卡在不可中断 I/O 上，连 OOM killer 都杀不动）。
//
//   ⚠️ 根因是一个**很容易漏掉的前提**：
//     后端仓库 compose 里给前端服务写的 `mem_limit: 240m` 只管【运行时容器】，
//     **管不到 `docker build`** —— 构建容器没有 cgroup 内存限额。
//     所以 compose 里那句"Node 会读 cgroup 限额，不用手工配
//     max-old-space-size"是对的，但它只对运行时成立；构建阶段必须单独装刹车。
//
// 【这类问题为什么必须用测试守】
//   它的失败方式非常不直观：构建**不报错**，只是把宿主机一起拖死，
//   而且现场（dmesg）会随着强制重启一起消失 —— 想回头查都没有证据。
//   而"哪天有人把这行 ENV 删了"是完全可能的（它看起来像一句可有可无的配置）。
//
// 【为什么这个文件用 node 环境】
//   它只读 `Dockerfile` 这个文本文件、做字符串分析，不需要 Vue 运行时、
//   不需要建整个 Nuxt 应用（与 styleContract.spec.ts 同理，会快得多）。
//
// 【关键字】ARG = 构建期参数（只在构建时存在，不进最终镜像）；
//          ENV = 环境变量（写进层的元数据，运行时也会继承给子进程）；
//          NODE_OPTIONS = Node 读取的命令行参数；
//          --max-old-space-size=N 限制 V8【老生代】堆的上限，单位 MB。
// =====================================================================

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()

/**
 * 构建宿主机的**实测**物理内存（MB）。
 * ⚠️ 刻意用实测值而不是标称的"2 核 2G"：那台机器 `free -h` 显示的是 1.6Gi。
 * 内存预算按标称值算会偏乐观 —— 后端仓库 docker-compose.prod.yaml 顶部
 * 专门用一段讲了这件事（上限之和一度超过真实物理内存，而护栏测试还是绿的）。
 */
const HOST_MEMORY_MB = 1638

/**
 * 构建阶段允许的最大堆上限（MB）：把物理内存对半分。
 * 它不是"调优建议"，而是这次故障留下的不变式 —— 堆上限逼近物理内存时，
 * 换来的不是"构建更快"，而是磁盘换页抖动。
 */
const MAX_BUILD_HEAP_MB = Math.floor(HOST_MEMORY_MB / 2)

const dockerfile = readFileSync(join(ROOT, 'Dockerfile'), 'utf8')

/** 一行里第一个匹配的行号（找不到返回 -1） */
const lineIndexOf = (source, pattern) =>
  source.split(/\r?\n/).findIndex(line => pattern.test(line))

/**
 * 只留代码行、去掉整行注释。
 * 【为什么要去掉】这些断言找的是"配置项"，而注释里会**引用**同样的字眼
 * （本文件的 Dockerfile 注释里就写着 `--build-arg NODE_HEAP_MB=1536` 这样的例子）。
 * 不剥掉的话，注释本身就足以让"配置存在"这条断言为真 —— 那是最典型的假绿。
 */
const codeOnly = (source) =>
  source.split(/\r?\n/).filter(line => !/^\s*#/.test(line)).join('\n')

/**
 * 切出一个具名构建阶段：`FROM xxx AS <名字>` 到下一个 `FROM` 之间。
 * 返回 null 表示这个阶段不存在（这时调用方应当直接失败，而不是静默通过）。
 */
const extractStage = (source, name) => {
  const lines = source.split(/\r?\n/)
  const start = lineIndexOf(source, new RegExp(`^\\s*FROM\\s+\\S+\\s+AS\\s+${name}\\s*$`, 'i'))
  if (start === -1) return null
  const rest = lines.slice(start + 1)
  const end = rest.findIndex(line => /^\s*FROM\s+/i.test(line))
  return (end === -1 ? rest : rest.slice(0, end)).join('\n')
}

/** 最后一个构建阶段（本仓库里就是运行阶段：`FROM node:24-alpine`，不带 AS） */
const lastStage = (source) => {
  const lines = source.split(/\r?\n/)
  const lastFrom = lines.reduce((acc, line, i) => (/^\s*FROM\s+/i.test(line) ? i : acc), -1)
  return lines.slice(lastFrom).join('\n')
}

/**
 * 解析"构建阶段实际会用到的堆上限（MB）"，没写就返回 null。
 * 支持两种写法：直接写数字，或写 `${NODE_HEAP_MB}` 再从上面的 ARG 默认值里取 ——
 * 后者是仓库现在的写法（默认值安全、换机器时可用 --build-arg 覆盖）。
 */
const resolveHeapLimitMb = (stageSource) => {
  const env = stageSource.match(/^\s*ENV\s+NODE_OPTIONS=.*--max-old-space-size=(\S+)\s*$/im)
  if (!env) return null
  const raw = env[1]
  if (/^\d+$/.test(raw)) return Number(raw)
  const argName = raw.match(/^\$\{(\w+)\}$/)?.[1]
  if (!argName) return null
  const arg = stageSource.match(new RegExp(`^\\s*ARG\\s+${argName}=(\\d+)\\s*$`, 'm'))
  return arg ? Number(arg[1]) : null
}

/** 构建阶段（去掉注释后的代码），后面的断言都只看它 */
const builderCode = codeOnly(extractStage(dockerfile, 'builder') ?? '')

/** 运行阶段（去掉注释后的代码） */
const runtimeCode = codeOnly(lastStage(dockerfile))

/** 这几条是"构建阶段有没有装刹车"的判据，抽出来是为了让对照组能复用同一套判据 */
const hasHeapArg = (code) => lineIndexOf(code, /^\s*ARG\s+NODE_HEAP_MB=\d+\s*$/) > -1
const hasHeapEnv = (code) =>
  lineIndexOf(code, /^\s*ENV\s+NODE_OPTIONS=--max-old-space-size=\$\{NODE_HEAP_MB\}\s*$/) > -1
const envBeforeBuild = (code) => {
  const env = lineIndexOf(code, /^\s*ENV\s+NODE_OPTIONS=/)
  const build = lineIndexOf(code, /^\s*RUN\s+npm run build\s*$/)
  return env > -1 && build > -1 && env < build
}

describe('前端镜像的 Dockerfile：构建阶段必须给 Node 装内存刹车', () => {
  it('构建阶段存在，并且声明了带默认值的 NODE_HEAP_MB', () => {
    expect(extractStage(dockerfile, 'builder')).not.toBeNull()
    expect(hasHeapArg(builderCode)).toBe(true)
  })

  it('构建阶段把 NODE_OPTIONS 设成 --max-old-space-size=${NODE_HEAP_MB}', () => {
    expect(hasHeapEnv(builderCode)).toBe(true)
  })

  it('默认堆上限是合法的正整数，而且不超过物理内存的一半', () => {
    const limit = resolveHeapLimitMb(builderCode)
    expect(limit).not.toBeNull()
    expect(Number(limit)).toBeGreaterThan(0)
    expect(Number(limit)).toBeLessThanOrEqual(MAX_BUILD_HEAP_MB)
  })

  it('ENV 必须出现在 npm run build 之前（写在后面等于没生效）', () => {
    expect(envBeforeBuild(builderCode)).toBe(true)
  })

  it('ARG 放在 npm ci 之后（否则调一次内存数字就要重装几百个包）', () => {
    const ci = lineIndexOf(builderCode, /^\s*RUN\s+npm config set registry/)
    const arg = lineIndexOf(builderCode, /^\s*ARG\s+NODE_HEAP_MB=\d+\s*$/)
    expect(ci).toBeGreaterThan(-1)
    expect(arg).toBeGreaterThan(ci)
  })

  it('运行阶段不继承这个上限（运行时的内存由 mem_limit/cgroup 决定）', () => {
    // 【为什么这条也要守】运行阶段是 Node 的 SSR 服务，它跑在 compose 给它的
    // mem_limit 里；再手工压一个更小的 max-old-space-size，只会把
    // "容器被限额约束"变成"渲染某个页面时进程直接崩"（访问者看到 500），反而更糟。
    // 而构建阶段的 ENV 是**不会**自动流到下一个阶段的（每个 FROM 从零开始），
    // 这条用例钉的就是这个前提。
    expect(runtimeCode).not.toContain('--max-old-space-size')
    expect(runtimeCode).not.toContain('NODE_HEAP_MB')
  })

  // -------------------------------------------------------------------
  // 对照组：证明上面这套判据真的抓得住"没装刹车"的 Dockerfile。
  // 没有这几条的话，一个永远返回 true 的检查器（比如正则写错、恒真）
  // 会让整组契约永远为真 —— 那就是假绿。
  // -------------------------------------------------------------------
  const WITHOUT_BRAKE = [
    'FROM node:24-alpine AS builder',
    'WORKDIR /build',
    'RUN npm run build',
    '',
    'FROM node:24-alpine',
    'CMD ["node", ".output/server/index.mjs"]',
  ].join('\n')

  const BRAKE_AFTER_BUILD = [
    'FROM node:24-alpine AS builder',
    'WORKDIR /build',
    'ARG NODE_HEAP_MB=768',
    'RUN npm run build',
    'ENV NODE_OPTIONS=--max-old-space-size=${NODE_HEAP_MB}',
  ].join('\n')

  const OVER_BUDGET = [
    'FROM node:24-alpine AS builder',
    'ARG NODE_HEAP_MB=4096',
    'ENV NODE_OPTIONS=--max-old-space-size=${NODE_HEAP_MB}',
    'RUN npm run build',
  ].join('\n')

  it('对照组：完全没有 ENV 的构建阶段必须被判为"没装刹车"', () => {
    const code = codeOnly(extractStage(WITHOUT_BRAKE, 'builder') ?? '')
    expect(hasHeapEnv(code)).toBe(false)
    expect(resolveHeapLimitMb(code)).toBeNull()
  })

  it('对照组：ENV 写在 npm run build 之后的必须被判为"没生效"', () => {
    const code = codeOnly(extractStage(BRAKE_AFTER_BUILD, 'builder') ?? '')
    // 上限本身是写得出来的（所以只断言"有没有 ENV"是不够的）
    expect(resolveHeapLimitMb(code)).toBe(768)
    // 但它在构建那一步之后，等于没生效 —— 这一条必须被判为假
    expect(envBeforeBuild(code)).toBe(false)
  })

  it('对照组：默认值超过物理内存一半的必须被抓住', () => {
    const code = codeOnly(extractStage(OVER_BUDGET, 'builder') ?? '')
    expect(hasHeapArg(code)).toBe(true)
    expect(hasHeapEnv(code)).toBe(true)
    expect(Number(resolveHeapLimitMb(code))).toBeGreaterThan(MAX_BUILD_HEAP_MB)
  })
})
