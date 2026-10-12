import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useApi } from '~/composables/useApi'
import { useAuth } from '~/composables/useAuth'
import { useAuthUi } from '~/composables/useAuthUi'
import { useRememberedLogin } from '~/composables/useRememberedLogin'
import { cooldownMessage } from '~/utils/apiError'
import { checkEmail, checkRequiredText } from '~/utils/contentForm'

const REG_EMAIL_MAX = 100

/** Connects the shell's auth dialogs to session state and form submissions. */
export const useShellAuth = () => {
  const { login, register, logout, token, user, coolingDown, cooldownLeft } = useAuth()
  const { loginVisible, registerVisible, openLogin, openRegister } = useAuthUi()
  const { request } = useApi()
  const route = useRoute()
  const isAdmin = computed(() => user.value?.role === 'ADMIN')
  const displayName = computed(() => user.value?.nickname || user.value?.username || '已登录')

  const form = reactive({ username: '', password: '' })
  const regForm = reactive({ username: '', nickname: '', email: '', password: '' })
  const loading = ref(false)
  const regLoading = ref(false)
  const { remember, username: rememberedUsername, restore: restoreRemembered, save: saveRemembered, clear: clearRemembered } = useRememberedLogin()
  const loginButtonText = computed(() => coolingDown.value ? '请 ' + cooldownLeft.value + ' 秒后再试' : '登 录')

  onMounted(async () => {
    restoreRemembered()
    if (rememberedUsername.value) form.username = rememberedUsername.value

    if (token.value && !user.value) {
      const res = await request('/auth/me', { requiresAuth: false })
      if (res.ok) user.value = res.data
    }

    if (route.query.login === '1') {
      openLogin()
      const query = { ...route.query }
      delete query.login
      navigateTo({ path: route.path, query }, { replace: true })
    }
  })

  const onLogout = async () => {
    await logout()
    ElMessage.success('已退出')
    navigateTo('/')
  }

  const registerError = () =>
    checkRequiredText(regForm.username, '用户名', 64)
    || checkRequiredText(regForm.password, '密码', 20)
    || (regForm.password.length < 6 ? '密码长度需要在 6-20 之间' : '')
    || checkRequiredText(regForm.email, '邮箱', REG_EMAIL_MAX)
    || checkEmail(regForm.email, '邮箱', REG_EMAIL_MAX)

  const onLogin = async () => {
    if (coolingDown.value) return ElMessage.warning(cooldownMessage(cooldownLeft.value))
    if (!form.username || !form.password) return ElMessage.warning('请输入用户名和密码')
    loading.value = true
    const res = await login(form.username, form.password)
    loading.value = false
    if (!res.ok) return ElMessage.error(res.message)

    if (remember.value) saveRemembered(form.username)
    else clearRemembered()
    ElMessage.success('登录成功')
    loginVisible.value = false
    navigateTo('/')
  }

  const onRegister = async () => {
    const invalid = registerError()
    if (invalid) return ElMessage.warning(invalid)
    regLoading.value = true
    const res = await register(regForm)
    regLoading.value = false
    if (!res.ok) return ElMessage.error(res.message)

    ElMessage.success('注册成功，去登录')
    openLogin()
  }

  return {
    token, isAdmin, displayName,
    loginVisible, registerVisible, openLogin, openRegister,
    form, regForm, remember, loading, regLoading,
    coolingDown, loginButtonText, onLogin, onRegister, onLogout,
  }
}
