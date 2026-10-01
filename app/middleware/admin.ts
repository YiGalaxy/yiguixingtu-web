export default defineNuxtRouteMiddleware(() => {
  const token = useCookie('token')
  if (!token.value) return navigateTo({ path: '/', query: { login: '1' } })

  // This is an experience-level guard only. The backend remains the security boundary.
  // Avoid an implicit /auth/me request here: middleware also runs during SSR and tests.
  const user = useState('user')
  if (user.value && user.value.role !== 'ADMIN') return navigateTo('/')
})
