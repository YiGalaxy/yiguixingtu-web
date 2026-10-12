import { computed, ref, watch, type Ref } from 'vue'
import { useApi } from '~/composables/useApi'
import { toArticleParams } from '~/composables/useArticleFilter'

type FeedFilters = {
  keyword: Ref<string>
  categoryId: Ref<number | null>
  tagId: Ref<number | null>
  size: Ref<number>
}

/** Loads the SSR first page and appends later pages for the home article list. */
export const useHomeArticleFeed = ({ keyword, categoryId, tagId, size }: FeedFilters) => {
  const { request } = useApi()
  const page = ref(1)
  const moreArticles = ref([])
  const loadingMore = ref(false)
  let filterVersion = 0

  const requestArticles = (pageNo: number) => request('/article/page', {
    params: toArticleParams({
      keyword: keyword.value,
      categoryId: categoryId.value,
      tagId: tagId.value,
      page: pageNo,
      size: size.value,
    }),
  })

  const firstPage = useAsyncData(
    () => ['home-articles', keyword.value || '-', categoryId.value ?? '-', tagId.value ?? '-', size.value].join(':'),
    () => requestArticles(1),
  )

  const articles = computed(() => [
    ...(firstPage.data.value?.ok ? (firstPage.data.value.data?.records ?? []) : []),
    ...moreArticles.value,
  ])
  const total = computed(() => firstPage.data.value?.ok ? Number(firstPage.data.value.data?.total) || 0 : 0)
  const loading = computed(() => firstPage.pending.value || loadingMore.value)
  const hasMore = computed(() => articles.value.length < total.value)

  watch([keyword, categoryId, tagId], () => {
    filterVersion += 1
    page.value = 1
    moreArticles.value = []
  })

  const loadMore = async () => {
    if (loadingMore.value || !hasMore.value) return
    const version = filterVersion
    const next = page.value + 1
    loadingMore.value = true
    try {
      const res = await requestArticles(next)
      if (!res.ok || version !== filterVersion) return
      page.value = next
      moreArticles.value = [...moreArticles.value, ...(res.data?.records ?? [])]
    } finally {
      loadingMore.value = false
    }
  }

  return { articles, loading, hasMore, loadMore, ready: firstPage }
}
