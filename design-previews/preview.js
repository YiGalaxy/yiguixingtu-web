(() => {
  const saved = localStorage.getItem('preview-theme') || 'night'
  document.documentElement.dataset.theme = saved
  const label = document.querySelector('[data-theme-label]')
  const button = document.querySelector('[data-theme-toggle]')
  const setTheme = (theme) => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('preview-theme', theme)
    if (label) label.textContent = theme === 'night' ? '切换白天' : '切换夜晚'
    if (button) button.setAttribute('aria-label', label?.textContent || '')
  }
  setTheme(saved)
  button?.addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'night' ? 'day' : 'night'))
  document.querySelectorAll('[data-demo-button]').forEach((item) => item.addEventListener('click', () => {
    item.textContent = item.dataset.active === 'true' ? '收起' : '已加入收藏'
    item.dataset.active = item.dataset.active === 'true' ? 'false' : 'true'
  }))
})()
