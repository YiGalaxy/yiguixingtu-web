import { describe, expect, it } from 'vitest'
import { groupFavorites } from '../app/utils/contentList'

describe('groupFavorites', () => {
  it('groups empty categories under an empty key while preserving first-seen order', () => {
    const first = { id: 1, category: 'Tools' }
    const ungrouped = { id: 2, category: '  ' }
    const second = { id: 3, category: 'Tools' }
    const later = { id: 4, category: 'Articles' }

    expect(groupFavorites([first, ungrouped, second, later])).toEqual([
      { key: 'Tools', label: 'Tools', items: [first, second] },
      { key: '', label: '未分组', items: [ungrouped] },
      { key: 'Articles', label: 'Articles', items: [later] },
    ])
  })

  it('keeps category text distinct from ungrouped items', () => {
    const ungrouped = { id: 1, category: '' }
    const named = { id: 2, category: '\u0000ungrouped' }

    expect(groupFavorites([ungrouped, named])).toEqual([
      { key: '', label: '未分组', items: [ungrouped] },
      { key: '\u0000ungrouped', label: '\u0000ungrouped', items: [named] },
    ])
  })
})
