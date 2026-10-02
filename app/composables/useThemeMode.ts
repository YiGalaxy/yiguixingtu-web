export const useThemeMode = () => {
  const preference = useCookie('site-theme', {
    default: () => 'night',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  })
  const themeMode = computed(() => (preference.value === 'day' ? 'day' : 'night'))
  const toggleTheme = () => {
    preference.value = themeMode.value === 'night' ? 'day' : 'night'
  }
  return { themePreference: preference, themeMode, toggleTheme }
}
