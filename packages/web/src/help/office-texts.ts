import { byKey } from './texts.js'

/** The texts of the pages of the office, each under the address it belongs to. */
export const officeTexts = byKey(
  import.meta.glob<string>('../../help/office/**/*.md', {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
  'office',
)
