import { markdownProblems, markdownTitle, readMarkdown } from '@opengewerk/platform-web'
import { describe, expect, it } from 'vitest'

import { officeApplication } from '../office/application.js'
import { helpKeyOf, helpPlace, officeHelpKey } from '../office/help.js'
import { officeFoot, officeNavigation } from '../office/navigation.js'
import { siteTabs } from '../site/tabs.js'
import { guideTexts } from './guide-texts.js'
import { manualTexts } from './manual-texts.js'
import { officeTexts } from './office-texts.js'
import { siteTexts } from './site-texts.js'
import { firstParagraph, guideOrder, manualOrder, siteHelpOrder } from './texts.js'

/**
 * The texts of the help (#131). What these hold is the acceptance of the
 * issue, that every page of the navigation has a text and a new page without
 * one turns a test red, and that a text keeps to the part of Markdown the
 * application reads, so that nothing shows up on a screen as the signs it
 * was typed with.
 */

const folders = {
  office: officeTexts,
  site: siteTexts,
  guides: guideTexts,
  manual: manualTexts,
} as const

/** Where the links of a text lead, in the order they stand. */
function linksOf(text: string): string[] {
  return readMarkdown(text).flatMap((block) =>
    (block.kind === 'paragraph'
      ? block.line
      : block.kind === 'list'
        ? block.items.flat()
        : []
    ).flatMap((piece) => (piece.kind === 'link' ? [piece.to] : [])),
  )
}

const hasOfficeText = (key: string) => officeTexts.has(key)

/**
 * The places of the office somebody reaches from its navigation: the entries
 * of the board, the two the frame of the foundation adds at the foot, the
 * settings of a Betreiber, the account from the menu of the person and the
 * quick guides the drawer of the help leads to.
 */
const officePlaces: readonly string[] = [
  ...officeNavigation.flatMap((group) => group.entries).map((entry) => entry.to),
  ...officeFoot.map((entry) => entry.to),
  '/konflikte',
  '/einstellungen',
  ...officeApplication.settings.map((entry) => entry.to),
  '/konto',
  helpPlace,
]

/** The screens on site somebody reaches from its tabs and its menu. */
const sitePlaces: readonly string[] = [...siteTabs.map((tab) => tab.to), '/konflikte', '/aufgaben']

describe('every page of the navigation', () => {
  it('has a text of its own in the office', () => {
    const without = officePlaces.filter(
      (place) => officeHelpKey(place, hasOfficeText) !== helpKeyOf(place),
    )

    expect(without).toEqual([])
    // The list is the navigation and not a copy of it: it holds what the
    // board has, so a place added there is asked for here.
    expect(officePlaces).toContain('/rundgaenge')
    expect(officePlaces).toContain('/einstellungen/e-mail')
    expect(officePlaces.length).toBeGreaterThan(20)
  })

  it('has a text of its own on site', () => {
    expect(sitePlaces.filter((place) => !siteTexts.has(helpKeyOf(place)))).toEqual([])
    expect(sitePlaces).toContain('/scannen')
  })

  it('is listed in the help on site, in the order of the tabs and the menu', () => {
    expect([...siteHelpOrder]).toEqual(sitePlaces.map(helpKeyOf))
    expect([...siteTexts.keys()].sort()).toEqual([...siteHelpOrder].sort())
  })
})

describe('the text of an address in the office', () => {
  it('is the one of the first screen at the first screen, and lent to nothing else', () => {
    expect(officeHelpKey('/', hasOfficeText)).toBe('index')
    expect(officeHelpKey('/a/3XQ7M2K9PDH4TA6W', hasOfficeText)).toBeNull()
    expect(officeHelpKey('/gibt-es-nicht', hasOfficeText)).toBeNull()
  })

  it('is the one of the list for what lies below it', () => {
    expect(officeHelpKey('/rundgaenge/plaene/neu', hasOfficeText)).toBe('rundgaenge')
    expect(officeHelpKey('/pflichten/d-1/bearbeiten', hasOfficeText)).toBe('pflichten')
    expect(officeHelpKey('/einstellungen/zugaenge/', hasOfficeText)).toBe('einstellungen/zugaenge')
    expect(officeHelpKey('/hilfe/rundgang', hasOfficeText)).toBe('hilfe')
  })

  it('is the one of the place for a record that lives at an address of its own', () => {
    expect(officeHelpKey('/gebaeude/b-1', hasOfficeText)).toBe('liegenschaften')
    expect(officeHelpKey('/raeume/r-1/zeitachse', hasOfficeText)).toBe('liegenschaften')
    expect(officeHelpKey('/nachweise/e-1', hasOfficeText)).toBe('pruefungen')
  })

  it('is the one of the record where the record has one, and not for the form a new one is made with', () => {
    expect(officeHelpKey('/anlagen/a-1', hasOfficeText)).toBe('anlagen/akte')
    expect(officeHelpKey('/anlagen/a-1/bearbeiten', hasOfficeText)).toBe('anlagen/akte')
    expect(officeHelpKey('/anlagen/neu', hasOfficeText)).toBe('anlagen')
    expect(officeHelpKey('/anlagen', hasOfficeText)).toBe('anlagen')
  })

  it('is none where the text is missing, also for what a place would lend', () => {
    const none = () => false

    expect(officeHelpKey('/', none)).toBeNull()
    expect(officeHelpKey('/anlagen/a-1', none)).toBeNull()
    expect(officeHelpKey('/gebaeude/b-1', none)).toBeNull()
  })
})

describe('the quick guides and the manual', () => {
  it('are the five core flows of the concept, in its order', () => {
    expect([...guideTexts.keys()].sort()).toEqual([...guideOrder].sort())
    expect(guideOrder.map((key) => markdownTitle(guideTexts.get(key) ?? ''))).toEqual([
      'Rundgang',
      'Bestandsaufnahme',
      'Prüfung mit Bericht',
      'Vom Mangel zum Auftrag',
      'Ablesung',
    ])
  })

  it('are the four chapters for whoever runs the instance', () => {
    expect([...manualTexts.keys()].sort()).toEqual([...manualOrder].sort())
    expect(manualOrder.map((key) => markdownTitle(manualTexts.get(key) ?? ''))).toEqual([
      'Installation',
      'Update',
      'Sicherung und Rückspielen',
      'Betreiber anlegen',
    ])
  })

  it('say in a first paragraph what they are about, for the line under their title', () => {
    for (const texts of [guideTexts, manualTexts]) {
      for (const [key, text] of texts) {
        expect(firstParagraph(text).length, key).toBeGreaterThan(40)
      }
    }
  })
})

describe('every text of the help', () => {
  const all = Object.entries(folders).flatMap(([folder, texts]) =>
    [...texts].map(([key, text]) => ({ name: `${folder}/${key}`, folder, text })),
  )

  it('is found by the build', () => {
    // A folder the build does not find is empty without a word.
    expect(officeTexts.size).toBeGreaterThan(20)
    expect(siteTexts.size).toBe(5)
    expect(guideTexts.size).toBe(5)
    expect(manualTexts.size).toBe(4)
  })

  it('says what it is called in a first heading', () => {
    expect(all.filter(({ text }) => markdownTitle(text) === null).map(({ name }) => name)).toEqual(
      [],
    )
    expect(all.filter(({ text }) => !text.startsWith('# ')).map(({ name }) => name)).toEqual([])
  })

  it('keeps to the part of Markdown the application reads', () => {
    expect(
      all.flatMap(({ name, text }) => markdownProblems(text).map((found) => `${name}: ${found}`)),
    ).toEqual([])
  })

  it('leads only to a page of the office that has a text, and only from a text of the office', () => {
    // The office and the entry on site have addresses of their own, and a
    // quick guide is read in both: a link in it would lead astray in one.
    const astray = all.flatMap(({ name, folder, text }) =>
      linksOf(text)
        .filter((to) => folder !== 'office' || !officeTexts.has(helpKeyOf(to)))
        .map((to) => `${name}: ${to}`),
    )

    expect(astray).toEqual([])
    expect(linksOf(officeTexts.get('liegenschaften') ?? '')).toEqual(['/einstellungen/bereiche'])
  })
})
