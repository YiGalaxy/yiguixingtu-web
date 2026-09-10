// ============================================================
// app/composables/useReveal.ts —— 滚动"进场"动画
// 作用：给带 .reveal 的元素加上"滚动到它就淡入上浮"的效果。
// 原理：IntersectionObserver 监听元素是否进入视口，进入就加 .in 类。
// ============================================================
export const useReveal = () => {
  const reveal = (selector = '.reveal') => {
    // 前端才有 document（SSR 服务端没有）
    if (typeof window === 'undefined') return
    const els = document.querySelectorAll<HTMLElement>(selector)
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add('in')
          io.unobserve(e.target)   // 已显示，不再监听
        }
      })
    }, { threshold: 0.12 })
    els.forEach(el => io.observe(el))
  }
  return { reveal }
}
