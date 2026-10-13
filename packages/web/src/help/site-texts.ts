import { byKey } from './texts.js'

/** The texts of the screens on site, each under the address it belongs to. */
export const siteTexts = byKey(
  import.meta.glob<string>('../../help/site/**/*.md', {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
  'site',
)
