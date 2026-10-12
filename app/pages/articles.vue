<template>
  <main class="articles-page">
    <section class="articles-hero glass">
      <div>
        <p class="eyebrow">ARTICLE ARCHIVE</p>
        <h1>文章图鉴</h1>
        <p class="hero-copy">阅读 Java 编程学习笔记与技术实践，按关键词、分类和标签寻找文章。</p>
      </div>
      <div class="hero-count" aria-label="文章总数">
        <strong>{{ total }}</strong>
        <span>篇已发布</span>
      </div>
    </section>

    <section class="filter-panel glass" aria-label="文章筛选">
      <label class="searchbox">
        <span aria-hidden="true">⌕</span>
        <input v-model="keywordInput" placeholder="搜索标题或摘要" @keyup.enter="applyKeywordNow">
        <button v-if="keywordInput" type="button" aria-label="清除关键词" @click="clearAll">×</button>
      </label>
      <div v-if="categories.length" class="filter-row">
        <span class="filter-label">分类</span>
        <button class="filter-chip" :class="{ active: categoryId === null }" type="button" @click="selectCategory(null)">全部</button>
        <button v-for="category in categories" :key="category.id" class="filter-chip" :class="{ active: categoryId === category.id }" type="button" @click="selectCategory(category.id)">{{ category.name }}</button>
      </div>
      <div v-if="tags.length" class="filter-row">
        <span class="filter-label">标签</span>
        <button v-for="tag in tags" :key="tag.id" class="filter-chip tag-chip" :class="{ active: tagId === tag.id }" type="button" @click="selectTag(tag.id)">#{{ tag.name }}</button>
      </div>
    </section>

    <div class="list-heading">
      <div>
        <p class="eyebrow">QUEST LOG</p>
        <h2>{{ listTitle }}</h2>
      </div>
      <button v-if="isFiltered" class="clear-filter" type="button" @click="clearAll">清除筛选</button>
    </div>

    <div v-if="pending && !articles.length" class="state-panel glass">读取文章中…</div>
    <div v-else-if="!articles.length" class="state-panel glass">
      <span>{{ isFiltered ? '没有找到符合条件的文章' : '还没有发布任何文章' }}</span>
      <button v-if="isFiltered" type="button" @click="clearAll">查看全部文章</button>
    </div>
    <section v-else class="article-grid" aria-label="文章列表">
      <NuxtLink v-for="(article, index) in articles" :key="article.id" class="article-card glass" :to="`/article/${article.id}`" :prefetch="false">
        <div class="card-cover">
          <img :src="coverOf(article, index)" :alt="article.title" loading="lazy">
          <span class="card-index">{{ String(index + 1).padStart(2, '0') }}</span>
        </div>
        <div class="card-body">
          <div class="card-meta"><span>{{ article.categoryName || '未分类' }}</span><time>{{ formatDate(article.createTime) }}</time></div>
          <h3>{{ article.title }}</h3>
          <p v-if="article.summary">{{ article.summary }}</p>
          <div class="card-foot"><span>{{ article.viewCount || 0 }} 次浏览</span><span class="read-link">打开文章 →</span></div>
        </div>
      </NuxtLink>
    </section>

    <div v-if="hasMore" class="load-more">
      <button type="button" :disabled="loadingMore" @click="loadMore">{{ loadingMore ? '加载中…' : '加载更多文章' }}</button>
    </div>
  </main>
</template>

<script setup>
const { request } = useApi()
const { keyword, keywordInput, categoryId, tagId, isFiltered, selectCategory, selectTag, clearAll, applyKeywordNow } = useArticleFilter()
const { categories, ready: categoriesReady } = useCategoryList()
const { settings, ready: settingsReady } = useSiteSettings()

const tagsAsync = useAsyncData('articles-tags', async () => {
  const response = await request('/tag/list')
  return response.ok && Array.isArray(response.data) ? response.data : []
})

await settingsReady
const size = computed(() => settings.value.pageSize)
const requestArticles = (page) => request('/article/page', {
  params: toArticleParams({ keyword: keyword.value, categoryId: categoryId.value, tagId: tagId.value, page, size: size.value }),
})

const articlesAsync = useAsyncData(
  () => `articles:${keyword.value || '-'}:${categoryId.value ?? '-'}:${tagId.value ?? '-'}:${size.value}`,
  () => requestArticles(1),
)
await Promise.all([articlesAsync, categoriesReady, tagsAsync])

const { data: firstPage, pending } = articlesAsync
const tags = computed(() => Array.isArray(tagsAsync.data.value) ? tagsAsync.data.value : [])
const firstArticles = computed(() => firstPage.value?.ok ? (firstPage.value.data?.records || []) : [])
const total = computed(() => firstPage.value?.ok ? Number(firstPage.value.data?.total) || 0 : 0)
const moreArticles = ref([])
const page = ref(1)
const loadingMore = ref(false)
let filterVersion = 0
const articles = computed(() => [...firstArticles.value, ...moreArticles.value])
const hasMore = computed(() => articles.value.length < total.value)

const listTitle = computed(() => {
  const category = categories.value.find(item => item.id === categoryId.value)
  const tag = tags.value.find(item => item.id === tagId.value)
  const scope = [category && `「${category.name}」分类`, tag && `「${tag.name}」标签`].filter(Boolean).join('与')
  if (keyword.value && scope) return `「${keyword.value}」在${scope}下的结果`
  if (keyword.value) return `「${keyword.value}」的搜索结果`
  if (scope) return `${scope}下的文章`
  return '最新文章'
})

watch([keyword, categoryId, tagId], () => {
  filterVersion += 1
  page.value = 1
  moreArticles.value = []
})

const loadMore = async () => {
  if (loadingMore.value || !hasMore.value) return
  const version = filterVersion
  loadingMore.value = true
  const next = page.value + 1
  try {
    const response = await requestArticles(next)
    if (!response.ok || version !== filterVersion) return
    page.value = next
    moreArticles.value = [...moreArticles.value, ...(response.data?.records || [])]
  } finally {
    loadingMore.value = false
  }
}

const DEFAULT_COVERS = ['/cover-1.png', '/cover-2.png', '/cover-3.png']
const coverOf = (article, index) => article.cover || DEFAULT_COVERS[index % DEFAULT_COVERS.length]
const formatDate = value => value ? String(value).replace('T', ' ').slice(0, 10) : '未记录日期'

useSeoMetaFor(() => ({ path: '/articles', title: '文章图鉴 · Java 编程学习笔记', description: '浏览亿轨星途的 Java 编程系列与技术文章，涵盖基础语法、面向对象、集合、多线程、IO 与网络编程，支持按关键词、分类和标签筛选。', type: 'website' }))
</script>

<style scoped>
.articles-page { position: relative; isolation: isolate; max-width: 1120px; margin: 0 auto; padding: 34px 28px 64px; }
.articles-page::before,
.articles-page::after { display: none; }
.glass { background: rgba(20, 35, 54, .56); border: 1px solid rgba(170, 210, 226, .2); box-shadow: 5px 5px 0 rgba(7, 15, 25, .38), inset 0 1px 0 rgba(255, 255, 255, .08); }
.articles-hero { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; min-height: 190px; padding: 30px; position: relative; overflow: hidden; }
.eyebrow { margin: 0 0 8px; color: var(--accent); font: 700 11px/1.2 monospace; letter-spacing: 2px; }
h1, h2, h3, p { margin-top: 0; }
.articles-hero h1 { margin-bottom: 10px; font-size: clamp(30px, 5vw, 48px); letter-spacing: 1px; text-shadow: 3px 3px 0 rgba(0, 0, 0, .36); }
.hero-copy { max-width: 520px; margin-bottom: 0; color: var(--muted); }
.hero-count { display: grid; gap: 2px; min-width: 120px; padding: 14px; text-align: right; border-left: 2px solid var(--accent); background: rgba(4, 11, 19, .28); }
.hero-count strong { color: var(--accent); font: 800 32px/1 monospace; }
.hero-count span { color: var(--muted); font-size: 12px; }
.filter-panel { display: grid; gap: 14px; margin-top: 18px; padding: 18px; }
.searchbox { display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 0 12px; border: 1px solid rgba(170, 210, 226, .18); background: rgba(4, 12, 21, .36); }
.searchbox span { color: var(--accent); font-size: 20px; }
.searchbox input { flex: 1; min-width: 0; border: 0; outline: 0; color: var(--ink); background: transparent; }
.searchbox button, .clear-filter { border: 0; color: var(--accent); background: transparent; cursor: pointer; }
.filter-row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.filter-label { width: 42px; color: var(--muted); font: 700 12px monospace; }
.filter-chip { min-height: 30px; padding: 3px 11px; border: 1px solid rgba(170, 210, 226, .2); color: var(--muted); background: rgba(13, 28, 43, .7); cursor: pointer; font-size: 12px; }
.filter-chip:hover, .filter-chip.active { border-color: var(--accent); color: #101b22; background: var(--accent); }
.tag-chip { border-style: dashed; }
.list-heading { display: flex; align-items: end; justify-content: space-between; gap: 16px; margin: 40px 0 18px; }
.list-heading h2 { margin-bottom: 0; font-size: 25px; }
.article-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; }
.article-card { display: flex; flex-direction: column; min-width: 0; overflow: hidden; color: var(--ink); text-decoration: none; transition: transform .2s ease, border-color .2s ease; }
.article-card:hover { transform: translate(-3px, -3px); border-color: var(--accent); }
.card-cover { position: relative; aspect-ratio: 16 / 10; overflow: hidden; background: rgba(0, 0, 0, .2); }
.card-cover img { width: 100%; height: 100%; object-fit: cover; transition: transform .35s ease; }
.article-card:hover .card-cover img { transform: scale(1.06); }
.card-index { position: absolute; right: 8px; bottom: 8px; padding: 4px 6px; color: var(--accent); background: rgba(4, 11, 19, .72); font: 700 11px monospace; }
.card-body { display: flex; flex: 1; flex-direction: column; padding: 15px; }
.card-meta, .card-foot { display: flex; justify-content: space-between; gap: 10px; color: var(--muted); font-size: 11px; }
.card-meta span { color: var(--accent); }
.card-body h3 { display: -webkit-box; margin: 10px 0 8px; overflow: hidden; font-size: 17px; line-height: 1.45; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.card-body p { display: -webkit-box; min-height: 40px; margin-bottom: 14px; overflow: hidden; color: var(--muted); font-size: 12px; line-height: 1.65; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.card-foot { align-items: center; margin-top: auto; }
.read-link { color: var(--accent); font-weight: 700; }
.state-panel { display: grid; place-items: center; gap: 14px; min-height: 200px; padding: 28px; color: var(--muted); text-align: center; }
.state-panel button, .load-more button { padding: 10px 18px; border: 1px solid var(--accent); color: var(--accent); background: rgba(8, 18, 29, .7); cursor: pointer; }
.load-more { display: flex; justify-content: center; margin-top: 28px; }
.load-more button:disabled { opacity: .6; cursor: wait; }
@media (max-width: 800px) { .article-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 560px) { .articles-page { padding: 22px 15px 44px; } .articles-hero { min-height: 165px; padding: 22px; } .hero-count { min-width: 88px; } .hero-count strong { font-size: 24px; } .article-grid { grid-template-columns: 1fr; } .list-heading { margin-top: 28px; } }

/* Keep the article index on the same voxel grid as the homepage demo. */
.articles-page { width: min(1120px, calc(100% - 32px)); padding: 34px 0 64px; }
.articles-page .glass,
.articles-page .articles-hero,
.articles-page .filter-panel,
.articles-page .article-card,
.articles-page .state-panel {
  border: 2px solid var(--line);
  border-radius: 0;
  background: var(--surface);
  box-shadow: 6px 6px 0 var(--pixel-shadow);
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
}
.articles-page .articles-hero {
  min-height: 190px;
  border-top: 5px solid var(--grass);
}
.articles-page .filter-panel { padding: 16px; }
.articles-page .searchbox,
.articles-page .filter-chip,
.articles-page .state-panel button,
.articles-page .load-more button {
  border: 2px solid var(--line);
  border-radius: 0;
  background: var(--surface-2);
  box-shadow: 3px 3px 0 var(--pixel-shadow);
}
.articles-page .filter-chip:hover,
.articles-page .filter-chip.active,
.articles-page .state-panel button:hover,
.articles-page .load-more button:hover { border-color: var(--accent); color: var(--on-accent); background: var(--accent); }
.articles-page .article-card:hover { transform: translate(2px, -2px); border-color: var(--accent); box-shadow: 4px 4px 0 var(--pixel-shadow); }
.articles-page .card-index { border: 2px solid var(--accent); border-radius: 0; }
@media (max-width: 560px) { .articles-page { width: calc(100% - 24px); padding: 22px 0 44px; } }
</style>
