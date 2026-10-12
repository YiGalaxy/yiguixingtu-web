import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const navItems = [
  { label: '首页', to: '/', icon: 'icon-home', tip: '首页' },
  { label: '归档', to: '/archive', icon: 'icon-archive', tip: '归档' },
  { label: '文章', to: '/articles', icon: 'icon-article', tip: '文章检索' },
  { label: '音乐', to: '/music', icon: 'icon-music', tip: '音乐播放器' },
  { label: '收藏', to: '/favorites', icon: 'icon-favorite', tip: '我的收藏' },
  { label: '项目', to: '/projects', icon: 'icon-project', tip: '项目档案' },
  { label: '友链', to: '/links', icon: 'icon-links', tip: '友链' },
  { label: '关于', to: '/about', icon: 'icon-about', tip: '关于本站' },
]

/** Owns the shared navigation entries and the mobile panel lifecycle. */
export const useSiteNavigation = () => {
  const route = useRoute()
  const navOpen = ref(false)
  const closeNav = () => { navOpen.value = false }
  const toggleNav = () => { navOpen.value = !navOpen.value }
  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && navOpen.value) closeNav()
  }

  onMounted(() => window.addEventListener('keydown', onKeydown))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
  watch(() => route.fullPath, closeNav)
  watch(navOpen, open => {
    if (import.meta.client) document.body.style.overflow = open ? 'hidden' : ''
  })
  onBeforeUnmount(() => {
    if (import.meta.client) document.body.style.overflow = ''
  })

  return { navItems, navOpen, closeNav, toggleNav }
}
