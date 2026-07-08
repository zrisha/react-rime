import type { RimeLanguage } from './types'

/** Picks the most-preferred Chinese locale from the browser's language list. */
export function getLanguage(): RimeLanguage {
  // SSR: this runs during render (schema metadata), so it must not touch
  // browser globals unguarded.
  if (typeof navigator === 'undefined' || !navigator.languages) {
    return 'zh-CN'
  }
  let language: RimeLanguage | undefined
  let index = 0
  const candidates: RimeLanguage[] = ['zh-CN', 'zh-TW', 'zh-HK', 'zh-SG']
  for (const lang of candidates) {
    const i = navigator.languages.indexOf(lang)
    if (i >= 0 && (!language || i < index)) {
      language = lang
      index = i
    }
  }
  return language || 'zh-CN'
}
