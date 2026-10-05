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
   * made with, the one it is changed with, and the form in the card of the
   * people to talk to there, which stands in the narrow column of the page
   * (#85); the forms a building, a floor and a room are made with, and
   * "Bearbeiten" on each of their pages (#86); and the three dialogs of
   * "Zugänge" (#84): a new access, the access of the person the preview
   * answers as, whose button carries their name, and a new substitution; and
   * the three dialogs of "Bereiche" (#84): a new area, another name for one
   * and the question before one goes, whose buttons carry its name. A
   * page that has one is checked a second time as a kind of its own, with the
   * button pressed. Found by its name, so that the next record with the same
   * button is checked as well.
   */
  openers: [
    'Neue Liegenschaft',
    'Bearbeiten',
    'Hinzufügen',
    'Neues Gebäude',
    'Geschoss anlegen',
    'Neuer Raum',
    'Zugang anlegen',
    'Vorschau bearbeiten',
    'Vertretung anlegen',
    'Bereich anlegen',
    'Bereich Nord umbenennen',
    'Bereich Nord entfernen',
  ],
})
