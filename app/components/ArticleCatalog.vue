<template>
  <aside v-if="headings.length" class="article-catalog" :class="{ 'is-open': open, 'is-borderless': borderless }" aria-label="文章目录">
    <div class="catalog-toolbar">
      <button
        class="catalog-toggle" type="button" :aria-expanded="open" aria-controls="article-catalog-links"
        @click="open = !open"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
          <path d="M9 6h12M9 12h12M9 18h12M3 6h1M3 12h1M3 18h1" />
        </svg>
        <span>{{ open ? '文章目录' : '目录' }}</span>
        <span class="catalog-count">{{ headings.length }}</span>
        <span aria-hidden="true">{{ open ? '−' : '+' }}</span>
      </button>
      <button
        v-if="open" type="button" class="catalog-border-toggle" :aria-pressed="borderless"
        :title="borderless ? '显示边框' : '隐藏边框'" @click="borderless = !borderless"
      >{{ borderless ? '显示边框' : '隐藏边框' }}</button>
    </div>
    <nav v-show="open" id="article-catalog-links" aria-label="文章章节" class="catalog-nav">
      <ol>
        <li v-for="heading in headings" :key="heading.id">
          <a
            :href="`#${heading.id}`" :title="heading.text" :aria-current="activeId === heading.id ? 'location' : undefined"
            :style="{ paddingLeft: `${12 + (heading.level - minLevel) * 12}px` }"
            @click="jumpTo($event, heading.id)"
          >{{ heading.text || '未命名章节' }}</a>
        </li>
      </ol>
    </nav>
  </aside>
</template>

<script setup lang="ts">
type Heading = { id: string, text: string, level: number }
const props = defineProps<{ headings: Heading[] }>()
const open = ref(false)
const borderless = ref(false)
const activeId = ref('')
const minLevel = computed(() => Math.min(...props.headings.map(heading => heading.level)))
let frame = 0
let desktop: MediaQueryList | undefined

const updateActive = () => {
  frame = 0
  let current = props.headings[0]?.id || ''
  for (const heading of props.headings) {
    const target = document.getElementById(heading.id)
    if (target && target.getBoundingClientRect().top <= 104) current = heading.id
  }
  activeId.value = current
}
const scheduleUpdate = () => {
  if (!frame) frame = window.requestAnimationFrame(updateActive)
}
const adaptToViewport = () => { open.value = desktop?.matches ?? false }

const jumpTo = (event: MouseEvent, id: string) => {
  // 保留中键、新标签页等原生链接行为。
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
  const target = document.getElementById(id)
  if (!target) return
  event.preventDefault()
  if (!desktop?.matches) open.value = false
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  target.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' })
  // 让键盘阅读位置跟随跳转，同时保留可复制的章节地址。
  target.setAttribute('tabindex', '-1')
  target.focus({ preventScroll: true })
  window.history.replaceState(window.history.state, '', `#${id}`)
  activeId.value = id
}

watch(() => props.headings, () => nextTick(scheduleUpdate))
onMounted(() => {
  desktop = window.matchMedia('(min-width: 1440px)')
  adaptToViewport()
  desktop.addEventListener('change', adaptToViewport)
  window.addEventListener('scroll', scheduleUpdate, { passive: true })
  window.addEventListener('resize', scheduleUpdate, { passive: true })
  scheduleUpdate()
})
onBeforeUnmount(() => {
  desktop?.removeEventListener('change', adaptToViewport)
  window.removeEventListener('scroll', scheduleUpdate)
  window.removeEventListener('resize', scheduleUpdate)
  window.cancelAnimationFrame(frame)
})
</script>

<style scoped>
.article-catalog {
  position: fixed; top: 96px; right: 16px; z-index: 120;
  max-width: calc(100vw - 32px); background: var(--panel);
  color: var(--ink); border: 2px solid var(--line);
  box-shadow: 4px 4px 0 var(--pixel-shadow);
}
.article-catalog.is-open { width: 224px; }
.article-catalog.is-borderless { border-color: transparent; box-shadow: none; }
.catalog-toolbar { display: flex; flex-wrap: wrap; align-items: center; padding: 4px; }
.catalog-toggle {
  display: flex; flex: 1; gap: 8px; align-items: center; justify-content: space-between;
  min-height: 44px; padding: 8px; border: 0; background: transparent;
  color: var(--ink); font: inherit; font-size: 14px; font-weight: 700; cursor: pointer;
}
.catalog-count { font-size: 12px; color: var(--muted); font-weight: 400; }
.catalog-border-toggle {
  min-height: 44px; width: 100%; padding: 8px 12px; border: 0;
  background: transparent; color: var(--muted); font: inherit; font-size: 12px;
  text-align: right; cursor: pointer;
}
.catalog-nav { max-height: min(60vh, calc(100dvh - 224px)); overflow-y: auto; overscroll-behavior: contain; padding: 0 8px 8px; }
.catalog-nav ol { list-style: none; padding: 0; margin: 0; }
.catalog-nav a {
  display: flex; align-items: center; min-height: 44px; padding: 8px 12px;
  border-left: 2px solid transparent; color: var(--muted);
  text-decoration: none; font-size: 13px; line-height: 1.5; overflow-wrap: anywhere;
  transition: color .15s, background-color .15s;
}
.catalog-nav a[aria-current] { border-left-color: var(--accent); color: var(--accent); background: var(--surface-2); font-weight: 700; }
.catalog-nav a:hover, .catalog-toggle:hover, .catalog-border-toggle:hover { color: var(--accent); background: var(--surface-2); }
.article-catalog :is(a, button):focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
@media (min-width: 1440px) {
  .article-catalog { right: max(24px, calc((100vw - 1208px) / 2 + 24px)); }
}
@media (prefers-reduced-motion: reduce) {
  .catalog-nav a { transition: none; }
}
</style>
