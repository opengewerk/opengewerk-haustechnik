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
   * and not behind a link on any page, and the address on a label with a QR
   * code (#98), which only a scan reaches: with a code no label carries, it
   * is the page that says so.
   */
  entries: ['/', '/m/', '/konto', '/instanz', `/a/${'0'.repeat(16)}`],

  /**
   * The buttons that lead to a form no link leads to: the form a property is
   * made with, the one it is changed with, and the form in the card of the
   * people to talk to there, which stands in the narrow column of the page
   * (#85); the forms a building, a floor and a room are made with, and
   * "Bearbeiten" on each of their pages (#86); and the three dialogs of
   * "Zugänge" (#84): a new access, the access of the person the preview
   * answers as, whose button carries their name, and a new substitution; and
   * the three dialogs of "Bereiche" (#84): a new area, another name for one
   * and the question before one goes, whose buttons carry its name; and
   * what an asset is made and changed with (#88): the form of a new asset
   * and of a component, and at its file the dialogs that move it, say what it
   * supplies and enter a state of its life cycle; and the dialog that says
   * who answers for a duty, at the page of the duty (#101), whose button says
   * "ändern" where somebody is named and "benennen" where nobody is; and
   * the dialog a document is filed with (#97), on "Dokumente" and in the card
   * "Dokumente" of an asset, a room and a property; and the dialog that
   * prints labels (#98), at the register of assets and at a building; and
   * what taking stock on site opens from the page of a place (#99): the form
   * of an asset at a building and a room, the form of a room at a floor, and
   * the label of an asset, whose camera a browser without one refuses; and
   * the plans of the rounds (#113): a new plan, and the dialog that hands out
   * the rounds of a plan in a week; and the handing in of a round on site
   * (#114), which the last point of a round leads to; and at the page of a
   * measuring point (#119) the card a reading is entered with and the
   * dialogs of the exchange, the pause, the lock and the note. A page that has one is
   * checked a second time as a kind of its own, with the button pressed.
   * Found by its name, so that the next record with the same button is
   * checked as well.
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
    'Neue Anlage',
    'Komponente hinzufügen',
    'Verlegen',
    'Versorgung ändern',
    'Eintragen',
    'Verantwortliche Person ändern',
    'Verantwortliche Person benennen',
    'Hochladen',
    'Etiketten drucken',
    'Anlage aufnehmen',
    'Raum aufnehmen',
    'Etikett zuordnen',
    'Importieren',
    'Eigene Pflicht',
    'Pflicht hinzufügen',
    'Beenden',
    'Berichtigen',
    'Für ungültig erklären',
    'Neue Vorlage',
    'Punkt hinzufügen',
    'Kapitel hinzufügen',
    'Neuer Plan',
    'Zuteilen',
    'Zur Abgabe',
    'Stand eintragen',
    'Zählertausch',
    'Stilllegen',
    'Sperren',
    'Ändern',
    // The longest sentences of the instance stand behind it (#80); the Leitung
    // of the preview is operator and administration in one. The form to name
    // somebody to the administration stands open on its page.
    'Betreiber anlegen',
  ],

  /**
   * More than the 120 the foundation stops at unless told: this application
   * had 106 kinds of page on 08.10.2026, and every screen of Phase 1 still to
   * come brings more (opengewerk#576).
   */
  mostKinds: 160,
  /**
   * Every kind of page is held to the rules of accessibility as well (#132,
   * section 3 of the concept): labels, roles, the order of the headings and
   * the contrast, light and dark, at the width of a telephone and of a
   * desktop. For public bodies this holds for applications for their own
   * people too (section 8).
   */
  accessibility: true,
})
