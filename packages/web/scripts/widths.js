import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { checkWidths } from '@opengewerk/platform-web/tools/widths'

/**
 * Every screen of this application at the widths of the board "Breiten und
 * Auflösungen", light and dark, measured by the foundation's tool (ADR 0010
 * in the repository opengewerk) against the preview (`pnpm run preview`,
 * #29), where every request counts as one person of a sample operator. What
 * the tool cannot find by following links, this application names.
 */
await checkWidths({
  report: resolve(dirname(fileURLToPath(import.meta.url)), '..', 'widths-report'),

  /**
   * Where the walk starts: the office and the entry on site, the account
   * and the area of the instance, which are behind the menu under the name
   * and not behind a link on any page.
   */
  entries: ['/', '/m/', '/konto', '/instanz'],

  /**
   * The buttons that lead to a form no link leads to: the form a property is
   * made with and the one it is changed with (#85). A page that has one is
   * checked a second time as a kind of its own, with the button pressed.
   * Found by its name, so that the next record with the same button is
   * checked as well.
   */
  openers: ['Neue Liegenschaft', 'Bearbeiten'],
})
