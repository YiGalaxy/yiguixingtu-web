import { watch } from 'vue'
import { useApi } from '~/composables/useApi'
import { shouldReportVisit } from '~/utils/visitReport'

/** Reports each public pathname once per navigation, including the initial route. */
export const useVisitReporting = () => {
  if (!import.meta.client) return

  const route = useRoute()
  const { request } = useApi()
  let lastReportedPath: string | null = null
  watch(() => route.path, async path => {
    if (!shouldReportVisit(path) || path === lastReportedPath) return
    lastReportedPath = path
    try {
      await request('/visit', { method: 'POST', body: { path } })
    } catch {
      // Visit analytics must not interrupt navigation.
    }
  }, { immediate: true })
}
