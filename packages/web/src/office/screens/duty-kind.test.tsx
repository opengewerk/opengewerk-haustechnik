import type { CatalogueBundle } from '@opengewerk/haustechnik-domain'
import { date, today } from '@opengewerk/platform-web/format'
import { TestServer } from '@opengewerk/platform-web/testing'
import { screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { servingCatalogue, testCatalogue, unacceptedReview } from '../../app/test-catalogue.js'
import { mountOffice, onA, rowsOf, signedInOffice } from '../test-office.js'

/**
 * The page of a duty kind (#90, section 5 of the concept): what it is, for
 * which assets it comes into question, the rules it runs by, and who has
 * accepted it and when it was last checked.
 */

const mainTest = '/katalog/probe/pflichtarten/elevator_main_test'
const interimCheck = '/katalog/probe/pflichtarten/interim_check'
const checkedToday = date(today())

/**
 * The catalogue with a main test that only comes into question for a drive
 * between two outputs: its scope asks two thresholds, one of them twice.
 */
const withThresholds: CatalogueBundle = {
  ...testCatalogue,
  packages: testCatalogue.packages.map((entry) =>
    entry.name === 'probe'
      ? {
          ...entry,
          assetKinds: entry.assetKinds.map((kind) => ({
            ...kind,
            definition: {
              ...kind.definition,
              characteristics: [
                {
                  key: 'drive_output',
                  label: 'Antriebsleistung',
                  kind: 'number',
                  unit: 'kilowatts',
                },
                {
                  key: 'auxiliary_output',
                  label: 'Leistung des Hilfsantriebs',
                  kind: 'number',
                  unit: 'kilowatts',
                },
              ],
            },
          })),
          dutyKinds: entry.dutyKinds.map((kind) =>
            kind.key === 'probe.elevator_main_test'
              ? {
                  ...kind,
                  definition: {
                    ...kind.definition,
                    scope: {
                      ...kind.definition.scope,
                      conditions: [
                        { characteristic: 'drive_output', atLeast: 'probe.output_from' },
                        { characteristic: 'drive_output', below: 'probe.output_below' },
                        { characteristic: 'auxiliary_output', atLeast: 'probe.output_from' },
                      ],
                    },
                  },
                }
              : kind,
          ),
          rules: [
            ...entry.rules,
            ...(
              [
                ['probe.output_from', 15],
                ['probe.output_below', 75],
              ] as const
            ).map(([key, value]) => ({
              record: {
                key,
                validFrom: '2015-06-01',
                validUntil: null,
                unit: 'kilowatts' as const,
                value,
                source: 'Anhang 2 der Probeverordnung',
                origin: 'state_law' as const,
              },
              review: unacceptedReview,
            })),
          ],
        }
      : entry,
  ),
}

async function mount(at: string, title: string, bundle: CatalogueBundle = testCatalogue) {
  signedInOffice('technician', [], servingCatalogue(bundle))

  const mounted = await mountOffice(at, new TestServer(), [])

  await screen.findByRole('heading', { level: 1, name: title })

  return mounted
}

/** What stands beside a fact, by what the fact is called. */
function fact(label: string): string | null {
  const term = screen.getAllByRole('term').find((each) => each.textContent === label)

  return term?.nextElementSibling?.textContent ?? null
}

/** The card with this title. */
function card(title: string): HTMLElement {
  const found = screen.getByText(title).closest('section')

  if (found === null) {
    throw new Error(`No card is called ${title}.`)
  }

  return found
}

beforeEach(() => {
  localStorage.clear()
  onA('desktop')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the page of a duty kind', () => {
  it('says what the duty kind is, in the words of the catalogue', async () => {
    await mount(mainTest, 'Hauptprüfung der Aufzugsanlage')

    expect(
      screen.getByText(
        'Pflichtart im Paket Probepaket, Schlüssel probe.elevator_main_test, Fassung 1 seit 01.06.2015',
      ),
    ).toBeDefined()
    expect(
      screen.getByText(
        'Eine zugelassene Überwachungsstelle prüft die Aufzugsanlage wiederkehrend.',
      ),
    ).toBeDefined()
    expect(
      [
        'Tätigkeit',
        'Herkunft',
        'Verbindlichkeit',
        'Fundstelle',
        'Art der Frist',
        'Gezählt',
        'Qualifikation',
        'Nachweis',
        'Formular',
        'Aufbewahrung',
      ].map(fact),
    ).toEqual([
      'Prüfung',
      'Staatliches Recht',
      'Gesetz oder Verordnung',
      '§ 16 der Probeverordnung',
      'Höchstfrist',
      'Nach § 14 Abs. 5 BetrSichV',
      'Zugelassene Überwachungsstelle',
      'Bericht einer Fremdfirma oder Prüforganisation',
      'keines',
      // The years the rule names today.
      '10 Jahre',
    ])
  })

  it('names the form of its protocol, every kind of evidence and a note on the qualification', async () => {
    await mount(interimCheck, 'Zwischenprüfung')

    expect(
      ['Art der Frist', 'Qualifikation', 'Nachweis', 'Formular', 'Aufbewahrung'].map(fact),
    ).toEqual([
      'Ohne Vorgabe',
      'Zur Prüfung befähigte Person, mit Erfahrung an Aufzügen',
      'Unterschriebenes Protokoll, Abgenommener Arbeitsauftrag',
      'Protokoll der Zwischenprüfung',
      'Mindestens bis zur nächsten Prüfung',
    ])
  })

  it('names the assets it comes into question for, by their labels', async () => {
    await mount(mainTest, 'Hauptprüfung der Aufzugsanlage')

    expect(['Anlagenart', 'Merkmale', 'Gebäudeart', 'Bundesland'].map(fact)).toEqual([
      'Aufzugsanlage',
      'Feuerwehraufzug: ja',
      'Krankenhaus',
      'Baden-Württemberg',
    ])
  })

  it('says of a scope without a condition that it is every asset, everywhere', async () => {
    await mount(interimCheck, 'Zwischenprüfung')

    expect(['Anlagenart', 'Merkmale', 'Gebäudeart', 'Bundesland'].map(fact)).toEqual([
      'alle',
      'ohne Einschränkung',
      'alle',
      'bundesweit',
    ])
  })

  it('lists the rules it runs by with the time each applies in and the review of each', async () => {
    await mount(mainTest, 'Hauptprüfung der Aufzugsanlage')

    // The interval, the record that has ended as well, and the years its
    // evidence is kept: accepted itself, the kind runs by a rule that is not.
    expect(rowsOf('Regeln dieser Pflichtart')).toEqual([
      [
        'Höchstfristbundesweit',
        '36 Monate',
        '01.06.2015',
        '31.12.2020',
        'Abgenommen',
        checkedToday,
      ],
      ['Höchstfristbundesweit', '24 Monate', '01.01.2021', 'offen', 'Abgenommen', checkedToday],
      [
        'Aufbewahrungbundesweit',
        '10 Jahre',
        '01.06.2015',
        'offen',
        'Nicht abgenommen',
        '01.01.2020, seit über einem Jahr nicht geprüft',
      ],
    ])
  })

  it('lists the thresholds of its scope among its rules, a rule it asks twice once', async () => {
    await mount(mainTest, 'Hauptprüfung der Aufzugsanlage', withThresholds)

    expect(fact('Merkmale')).toBe(
      'Antriebsleistung ab 15 kW, Antriebsleistung unter 75 kW, Leistung des Hilfsantriebs ab 15 kW',
    )
    expect(rowsOf('Regeln dieser Pflichtart').map(([rule, value]) => [rule, value])).toEqual([
      ['Höchstfristbundesweit', '36 Monate'],
      ['Höchstfristbundesweit', '24 Monate'],
      ['Aufbewahrungbundesweit', '10 Jahre'],
      ['Schwelle im Geltungsbereichbundesweit', '15 kW'],
      ['Schwelle im Geltungsbereichbundesweit', '75 kW'],
    ])
  })

  it('says that the operator enters the interval where it runs by no rule', async () => {
    await mount(interimCheck, 'Zwischenprüfung')

    expect(card('Regeln').textContent).toContain(
      'Diese Pflichtart läuft nach keiner Regel des Katalogs: die Frist trägt der Betreiber ein.',
    )
    expect(screen.queryByRole('table', { name: 'Regeln dieser Pflichtart' })).toBeNull()
  })
})

describe('the page of a duty kind on a phone', () => {
  it('shows each rule as a box, with the time it applies in and its review', async () => {
    onA('phone')
    await mount(mainTest, 'Hauptprüfung der Aufzugsanlage')

    expect(
      within(screen.getByRole('list', { name: 'Regeln dieser Pflichtart' }))
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      `Höchstfrist: 36 Monatebundesweit · gilt ab 01.06.2015 bis 31.12.2020Abgenommen · geprüft am ${checkedToday}`,
      `Höchstfrist: 24 Monatebundesweit · gilt ab 01.01.2021Abgenommen · geprüft am ${checkedToday}`,
      'Aufbewahrung: 10 Jahrebundesweit · gilt ab 01.06.2015Nicht abgenommen · seit über einem Jahr nicht geprüft (01.01.2020)',
    ])
  })
})

describe('the review of a duty kind on its page', () => {
  it('names who accepted it and when, and the day of its last check', async () => {
    await mount(mainTest, 'Hauptprüfung der Aufzugsanlage')

    const review = card('Prüfung und Abnahme').textContent

    expect(review).toContain('Abgenommen von Ada Beispiel am 15.01.2026')
    expect(review).toContain(`Zuletzt gegen die Quelle geprüft am ${checkedToday}`)
    expect(review).not.toContain('Das liegt mehr als ein Jahr zurück.')
    // No mark beside the title of an entry accepted and checked within the
    // year: the one on the page belongs to a rule, in the table.
    expect(screen.getAllByText('Nicht abgenommen')).toEqual([
      within(screen.getByRole('table', { name: 'Regeln dieser Pflichtart' })).getByText(
        'Nicht abgenommen',
      ),
    ])
    expect(screen.queryByText('Seit über einem Jahr nicht geprüft')).toBeNull()
  })

  it('carries both marks where nobody accepted it and its check lies more than a year back', async () => {
    await mount(interimCheck, 'Zwischenprüfung')

    const review = card('Prüfung und Abnahme').textContent

    expect(review).toContain('Nicht abgenommen')
    expect(review).toContain('Die fachkundige Abnahme steht aus.')
    expect(review).toContain('Zuletzt gegen die Quelle geprüft am 01.01.2020')
    expect(review).toContain('Das liegt mehr als ein Jahr zurück.')
    // Beside the title, where nobody misses them.
    expect(screen.getByText('Seit über einem Jahr nicht geprüft')).toBeDefined()
    expect(screen.getAllByText('Nicht abgenommen').length).toBe(2)
  })
})

describe('the way to the page of a duty kind', () => {
  it('leads back to its package and to the catalogue', async () => {
    await mount(mainTest, 'Hauptprüfung der Aufzugsanlage')

    const path = within(screen.getByRole('navigation', { name: 'Pfad' }))

    expect(
      path.getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')]),
    ).toEqual([
      ['Katalog', '/katalog'],
      ['Probepaket', '/katalog/probe'],
    ])
  })

  it('finds nothing for a key the catalogue does not know, or one of another package', async () => {
    // From a page that stands, so that the device holds the catalogue.
    const { router } = await mount(mainTest, 'Hauptprüfung der Aufzugsanlage')

    for (const address of [
      '/katalog/probe/pflichtarten/unbekannt',
      '/katalog/leer/pflichtarten/elevator_main_test',
    ]) {
      await router.navigate({ to: address })

      expect(
        await screen.findByRole('heading', { level: 1, name: 'Nicht im Katalog' }),
      ).toBeDefined()

      await router.navigate({ to: mainTest })
      await screen.findByRole('heading', { level: 1, name: 'Hauptprüfung der Aufzugsanlage' })
    }
  })
})
