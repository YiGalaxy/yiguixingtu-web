// ============================================================
// 文件名：app/composables/useAuth.ts
// 作用：登录/注册的"大脑"。把"登录、注册、退出"这套逻辑集中写在这里，
//       页面只调用它、看结果，不用管请求细节。
// 核心思想：逻辑与界面分离（就跟后端把逻辑放 Service 一样）。
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

    // ----------【3】登录 ----------
    // 关键词：
    //   async  = 声明此函数是"异步"的（因为要发请求、等后端）。
    //   (username, password) = 参数：页面把用户填的用户名、密码传进来。
    // 为什么：把"登录"写成函数，接收账号密码，准备交给后端核对。
    const login = async (username, password) => {

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
            })

            // 关键词：res = 后端返回的结果，一个对象 { code, message, data }。
            //   if (res.code === 200) = 判断成功(200)还是失败。
            //   token.value = res.data.token = 成功就把通行证存进 cookie。
            // 为什么：拿到结果分两种情况——成功就存 token、告诉页面"成功"；
            //         失败就把原因(message)带给页面显示。
            if (res.code === 200) {
                token.value = res.data.token      // 登录成功 → 存 token
                user.value = res.data              // 存用户信息（含 role，供判断管理员）
                return { ok: true }               // 告诉页面：成功
            }

            // 关键词：res.message || '默认文案' = 后端没说原因，就用默认这句话。
            // 为什么：code ≠ 200（如密码错），把后端给的 message 显示给用户。
            return { ok: false, message: res.message || '用户名或密码错误' }

        } catch {
            // 为什么：走到这 = 网络/后端出问题了，给个不吓人的提示。
            return { ok: false, message: '登录失败，请稍后再试' }
        }
    }

    // ----------【4】注册（和登录几乎一样，只是接口不同、参数多了昵称）----------
    // 关键词：data = 一个对象 { username, password, nickname }（注册比登录多个昵称）。
    // 为什么：逻辑和登录一样，只是注册完还没登录、不存 token。
    const register = async (data) => {
        try {
            const res = await $fetch('/auth/register', {
                baseURL: config.public.apiBase,
                method: 'POST',
                body: data,                        // 直接把整个数据发给后端
            })
            if (res.code === 200) return { ok: true }
            return { ok: false, message: res.message || '注册失败' }
        } catch {
            return { ok: false, message: '注册失败，请稍后再试' }
        }
    }

    // ----------【5】退出登录 ----------
    // 关键词：token.value = null 清空通行证；navigateTo('...') 跳转到某页面。
    // 为什么：退出 = 扔掉通行证 + 回登录页。
    const logout = () => {
        token.value = null              // 清空 token（= 注销）
        navigateTo('/login')            // 跳回登录页
    }

    // ----------【6】出口：把这个文件的功能交出去 ----------
    // 为什么：页面用 const { login, register, logout, token } = useAuth()
    //         就能拿到它们。这个文件"只负责登录逻辑"，到此为止。
    return { token, user, login, register, logout }
}