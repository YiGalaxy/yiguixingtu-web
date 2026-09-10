// ============================================================
// 文件名：app/composables/useAuth.ts
// 作用：登录/注册的"大脑"。把"登录、注册、退出"这套逻辑集中写在这里，
//       页面只调用它、看结果，不用管请求细节。
// 核心思想：逻辑与界面分离（就跟后端把逻辑放 Service 一样）。
//
// 【登录限流（429）与冷却】后端对 /auth/login 有 Resilience4j 的应用层限流：
//   5 次/分钟。配额用完时后端返回**真正的 HTTP 429** + {code:429, message:"请求过于频繁，请稍后再试"}。
//   注意这时 $fetch 会【抛异常】（HTTP 非 2xx），而不是像业务失败那样
//   返回一个 code≠200 的对象 —— 所以原来的 catch 会把"被限流"统一成
//   「登录失败，请稍后再试」，用户完全看不出真正的原因（服务端好好的，
//   只是让他等一会儿），会以为是密码错了或者网站坏了，于是接着点，
//   而每点一次都在往限流窗口里再记一次。
//   现在这里做两件事：① 认得出 429 并给出专门的提示；
//   ② 触发一段冷却（见 LOGIN_COOLDOWN_SECONDS 的说明），冷却期间不再发请求。
// ============================================================

// 定义一个可复用的函数 useAuth（Nuxt 约定：可复用逻辑都以 use 开头）。
// 页面以后这样用：const { login, token } = useAuth()
export const useAuth = () => {

    // ----------【1】token：登录成功的"通行证" ----------
    // 关键词：useCookie('token') = 读/写浏览器里名为 token 的 cookie。
    // 为什么：登录成功后，后端发来一个 token（代表"你已登录"）。
    //         我们得存起来，这样刷新页面、切换页面都还记得"你登录过"。
    //         cookie 是浏览器专门"长期记住小块数据"的地方，刷新还在。
    // 注意：它返回的是一个"响应式盒子"(ref)，取值要写 token.value（加 .value）。
    const token = useCookie('token')
    // 登录后的用户信息（含 role），用来判断是否管理员
    const user = useState('user', () => null)

    // ----------【2】后端地址：从配置里取 ----------
    // 关键词：useRuntimeConfig() = 取回 nuxt.config.ts 里配的 runtimeConfig。
    //         config.public.apiBase = 就是那里写的 http://localhost:8082。
    // 为什么：前端要知道后端在哪。我们不把地址写死在各处请求里，
    //         而是配在一处、代码统一取 —— 将来改地址只改一处。
    const config = useRuntimeConfig()

    // ----------【2.5】登录冷却：被限流之后先别让用户再点 ----------
    // 关键词：
    //   ref / computed  = Vue 的响应式数据与派生值（模板里靠它们自动更新）
    //   setInterval     = 每隔固定时间执行一次（这里用来走倒计时）
    // 为什么要有它：
    //   后端登录限流是 5 次/分钟，而用户被拦下之后的第一个反应就是"再点一次"。
    //   不拦着的话，那一次点击只会再撞一次 429（还占掉限流窗口里的一个位置），
    //   用户看到的现象是"点了没反应、提示反复出现"。给按钮一段冷却，
    //   把"等一会儿"这件事变成界面上看得见的状态，比反复弹提示有用得多。
    const cooldownLeft = ref(0)                                  // 剩余秒数
    const coolingDown = computed(() => cooldownLeft.value > 0)   // 模板用它禁用按钮
    let cooldownTimer = null

    /** 停掉倒计时并清零。冷却结束、或组件卸载时调用 */
    const stopCooldown = () => {
        if (cooldownTimer) {
            clearInterval(cooldownTimer)   // 不清的话这个定时器会一直跑下去（内存/日志里都能看到）
            cooldownTimer = null
        }
        cooldownLeft.value = 0
    }

    /**
     * 开始一段冷却（默认 LOGIN_COOLDOWN_SECONDS 秒）。
     * 先 stopCooldown 再开新的：重复触发时不会留下两个定时器一起倒数，
     * 那种情况下按钮上的秒数会跳着掉（两个 interval 各减一次）。
     */
    const startCooldown = (seconds = LOGIN_COOLDOWN_SECONDS) => {
        stopCooldown()
        cooldownLeft.value = Math.max(1, Math.trunc(seconds))
        cooldownTimer = setInterval(() => {
            cooldownLeft.value -= 1
            if (cooldownLeft.value <= 0) stopCooldown()
        }, 1000)
    }

    // 【为什么在这里清定时器】useAuth() 是在 app.vue 的 setup 里调用的，
    // 组件卸载（测试里就是 wrapper.unmount()）时如果定时器还活着，
    // 它会继续改一个已经没人看的 ref，测试环境里还会报"有句柄没释放"。
    // getCurrentScope() 是为了在没有组件作用域时（比如直接在单测里
    // 调用 useAuth()）不报 "onScopeDispose() is called when there is no
    // active effect scope" 的警告。
    if (getCurrentScope()) onScopeDispose(stopCooldown)

    // ----------【3】登录 ----------
    // 关键词：
    //   async  = 声明此函数是"异步"的（因为要发请求、等后端）。
    //   (username, password) = 参数：页面把用户填的用户名、密码传进来。
    // 为什么：把"登录"写成函数，接收账号密码，准备交给后端核对。
    const login = async (username, password) => {

        // 【冷却期间直接拒绝，连请求都不发】
        // 为什么在 composable 里也拦一道，而不只靠按钮 disabled：
        //   登录弹窗里提交有三条路 —— 点按钮、密码框回车（@keyup.enter）、
        //   表单 submit（@submit.prevent）。按钮 disabled 只挡得住第一条，
        //   回车照样能把请求发出去。拦在最里面这一层才是真的拦住了。
        if (coolingDown.value) {
            return { ok: false, rateLimited: true, cooldownLeft: cooldownLeft.value, message: cooldownMessage(cooldownLeft.value) }
        }

        // 【追踪号】登录失败时，提示里带上后端的 X-Trace-Id，用户报给站长就能定位。
        // 为什么这里要自己记：useAuth 为了少一层封装直接用了 $fetch，
        // 而 $fetch 正常返回时只给 body（拿不到响应头），所以用 ofetch 的
        // onResponse / onResponseError 钩子把这次请求的响应头记在闭包里
        // （useApi 里是同样的写法，两处的理由一样）。
        let traceId = ''
        const captureTraceId = (context) => {
            const id = readTraceId(context?.response?.headers)
            if (id) traceId = id
        }

        // 关键词：try { ... } 尝试执行；catch { ... } 出错就跳这里兜底。
        // 为什么：发网络请求可能失败（后端没启动、断网）。
        //         包一层 try/catch，失败时页面不崩，而是给友好提示。
        try {

            // 关键词：await = 等待（等后端回话）；$fetch = 发请求的工具。
            //   baseURL = 后端根地址
            //   method: 'POST' = 提交数据（登录就是提交账号密码；GET 是取数据）
            //   body = 发送的内容(JSON)：要交给后端的 用户名+密码
            // 为什么：这就是"真正的登录动作"——把账号密码通过 POST 发给后端 /auth/login，
            //         并 await 等后端核对完、把结果发回来。
            const res = await $fetch('/auth/login', {
                baseURL: config.public.apiBase,    // 后端地址(8082)
                method: 'POST',                    // 提交数据
                body: { username, password },      // 要发送的账号密码
                onResponse: captureTraceId,        // 正常响应（含业务失败）也能拿到响应头
                onResponseError: captureTraceId,   // 非 2xx：在 $fetch 抛异常之前被调用
            })

            // 关键词：res = 后端返回的结果，一个对象 { code, message, data }。
            //   if (res.code === 200) = 判断成功(200)还是失败。
            //   token.value = res.data.token = 成功就把通行证存进 cookie。
            // 为什么：拿到结果分两种情况——成功就存 token、告诉页面"成功"；
            //         失败就把原因(message)带给页面显示。
            if (res.code === 200) {
                token.value = res.data.token      // 登录成功 → 存 token
                user.value = res.data              // 存用户信息（含 role，供判断管理员）
                // 【为什么成功时也要清冷却】看着像多余（冷却期间上面那道
                // 守卫根本不让人登录），但它挡的是一个真实的竞态：
                // 用户连点两下，两次请求都通过了守卫 —— 一次撞上 429 把冷却
                // 打开了，另一次却成功登录。这时候如果不清，用户明明已经登录成功，
                // 界面却还要空等 10 秒（而且冷却状态会跟着他进到下一个页面）。
                stopCooldown()
                return { ok: true }               // 告诉页面：成功
            }

            // 关键词：res.message || '默认文案' = 后端没说原因，就用默认这句话。
            // 为什么：code ≠ 200（如密码错），把后端给的 message 显示给用户。
            return { ok: false, message: withTraceId(res.message || '用户名或密码错误', traceId) }

        } catch (err) {
            // 【被限流（HTTP 429）要和"网络/后端出问题"分开说】
            // 走到 catch 的可能是三种完全不同的情况，用户该做的事也不同：
            //   · 被限流 → 等一会儿（服务端好好的，是我们问得太勤）
            //   · 网络/后端故障 → 检查网络或稍后重试
            //   · 其它 → 未知
            // 原来三者统一成「登录失败，请稍后再试」，等于什么都没说；
            // 而"限流"这件事的提示必须具体，因为用户等 10 秒就真的能用。
            // 追踪号取自钩子里记下的那个，拿不到就再看异常里带的响应头
            // （断网时两者都没有，提示就原样，不会出现空括号）。
            const errTrace = traceId || readTraceId(err?.response?.headers)

            if (isRateLimited(err)) {
                startCooldown()
                // 优先后端 message（它就是「请求过于频繁，请稍后再试」），
                // 万一代理层给了一个没有 body 的 429，就用我们自己的兜底文案
                return {
                    ok: false,
                    rateLimited: true,
                    cooldownLeft: cooldownLeft.value,
                    message: withTraceId(pickMessage(readBackendMessage(err), RATE_LIMITED_MESSAGE), errTrace),
                }
            }

            // 为什么：走到这 = 网络/后端出问题了，给个不吓人的提示。
            return { ok: false, message: withTraceId('登录失败，请稍后再试', errTrace) }
        }
    }

    // ----------【4】注册（和登录几乎一样，只是接口不同、参数多了昵称）----------
    // 关键词：data = 一个对象 { username, password, nickname }（注册比登录多个昵称）。
    // 为什么：逻辑和登录一样，只是注册完还没登录、不存 token。
    const register = async (data) => {
        // 追踪号的处理与 login 完全相同（理由见上面）
        let traceId = ''
        const captureTraceId = (context) => {
            const id = readTraceId(context?.response?.headers)
            if (id) traceId = id
        }

        try {
            const res = await $fetch('/auth/register', {
                baseURL: config.public.apiBase,
                method: 'POST',
                body: data,                        // 直接把整个数据发给后端
                onResponse: captureTraceId,
                onResponseError: captureTraceId,
            })
            if (res.code === 200) return { ok: true }
            return { ok: false, message: withTraceId(res.message || '注册失败', traceId) }
        } catch (err) {
            return {
                ok: false,
                message: withTraceId('注册失败，请稍后再试', traceId || readTraceId(err?.response?.headers)),
            }
        }
    }

    // ----------【5】退出登录 ----------
    // 【这次修了什么】原来是两行：
    //     token.value = null
    //     navigateTo('/login')      ← 死代码：项目里根本没有 /login 页面
    //   而且完全【没有调用后端】——于是后端签出去的那个 token 依然有效直到自然过期
    //   （默认 24 小时）。前端把 cookie 删了看着像"退出了"，
    //   但要是这个 token 已经被人截获，拿到的人还能继续用。
    //   后端为此加了 Redis 黑名单（POST /auth/logout 会把当前 token 拉黑），
    //   前端必须真的去调它，否则那个功能等于白做。
    //
    // 【为什么失败也要清本地状态】
    //   用户点"退出"是想离开。如果因为网络抖动导致接口失败就不给退，
    //   反而是把人困在里面。所以这里的顺序是：
    //     先尽力通知后端（失败只忽略），再无条件清掉本地登录态。
    //   代价是"后端那次没成功的话，token 在服务端仍有效到过期"——
    //   这个风险比"点了退出退不掉"小得多，而且日志里能查到。
    const logout = async () => {
        // 【没有 token 就不用调后端】没什么可拉黑的，省一次无用请求。
        // 注意不能因此报错：用户可能本来就没登录（或者 cookie 已过期），
        // 他点"退出"依然应该得到一个成功的结果。
        if (token.value) {
            try {
                await $fetch('/auth/logout', {
                    baseURL: config.public.apiBase,
                    method: 'POST',
                    // 带上当前 token：后端要靠它解析出 jti 才能精确拉黑这一个 token
                    headers: { Authorization: `Bearer ${token.value}` },
                })
            } catch {
                // 刻意忽略：见上面"为什么失败也要清本地状态"
            }
        }

        token.value = null              // 清空 token（= 注销）
        user.value = null               // 【必须一起清】否则顶栏还显示着昵称，
                                        // 看起来像没退成功；而且 isAdmin 之类的判断
                                        // 会继续拿着旧角色走
        return { ok: true }
    }

    // ----------【6】出口：把这个文件的功能交出去 ----------
    // 为什么：页面用 const { login, register, logout, token } = useAuth()
    //         就能拿到它们。这个文件"只负责登录逻辑"，到此为止。
    // cooldownLeft / coolingDown 给页面用来禁用登录按钮并显示倒计时；
    // stopCooldown 也导出，是为了让调用方（以及测试）能主动结束冷却，
    // 而不用等满 10 秒。
    return { token, user, login, register, logout, cooldownLeft, coolingDown, startCooldown, stopCooldown }
}