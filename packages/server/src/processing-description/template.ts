import { readFileSync } from 'node:fs'

/**
 * The template of the description of the processing (#357), shipped beside
 * `dist` in `templates/`. Read once; it changes only with the version of the
 * application.
 */
const location = new URL('../../templates/processing-description.md', import.meta.url)
let template: string | null = null

export function processingTemplate(): string {
  template ??= readFileSync(location, 'utf8')

  return template
}
