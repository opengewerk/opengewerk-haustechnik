import { byKey } from './texts.js'

/** The chapters of the manual for whoever runs the instance. */
export const manualTexts = byKey(
  import.meta.glob<string>('../../help/manual/**/*.md', {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
  'manual',
)
