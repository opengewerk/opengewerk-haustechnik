import { byKey } from './texts.js'

/** The quick guides to the core flows, the same in the office and on site. */
export const guideTexts = byKey(
  import.meta.glob<string>('../../help/guides/**/*.md', {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
  'guides',
)
