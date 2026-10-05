import type { CatalogueBundle } from '@opengewerk/haustechnik-domain'
import { date, today } from '@opengewerk/platform-web/format'
import { TestServer } from '@opengewerk/platform-web/testing'
import { screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { servingCatalogue, testCatalogue } from '../../app/test-catalogue.js'
import { mountOffice, onA, rowsOf, signedInOffice } from '../test-office.js'

/**
 * "Katalog" in the office (#90, section 5 of the concept): the packages of
 * the instance, and of one of them its duty kinds, asset kinds, forms, rules,
 * round templates and defect classes (#61), each entry with its review.
 */

const packages = 'Pakete des Katalogs'
const checkedToday = date(today())
const longAgo = '01.01.2020, seit über einem Jahr nicht geprüft'

/** The office at an address of the catalogue, on a device that has fetched it. */
async function mount(at = '/katalog', bundle: CatalogueBundle = testCatalogue) {
  signedInOffice('technician', [], servingCatalogue(bundle))

  const mounted = await mountOffice(at, new TestServer(), [])

  await screen.findByRole('table', { name: packages })

  return mounted
}

beforeEach(() => {
  localStorage.clear()
  onA('desktop')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the packages of the catalogue', () => {
  it('are listed with what each holds and how much of it is accepted', async () => {
    await mount()

    // Of the first package six of eleven: the asset kind in force, a duty
    // kind, the template, two rules and a defect class are accepted; a
    // version that has not begun counts for nothing.
    expect(rowsOf(packages)).toEqual([
      ['Probepaket', '1.2.0', '2', '2', '1', '6 von 11 abgenommen'],
      ['Leeres Paket', '1.0.0', '0', '0', '0', 'nichts abzunehmen'],
      ['Abgenommenes Paket', '2.0.0', '1', '0', '0', '1 von 1 abgenommen'],
    ])
  })

  it('lead to the package each, and the one shown is marked', async () => {
    await mount('/katalog/fertig')

    const table = screen.getByRole('table', { name: packages })
    const link = (name: string) => within(table).getByRole('link', { name })

    expect(link('Probepaket').getAttribute('href')).toBe('/katalog/probe')
    expect(link('Abgenommenes Paket').getAttribute('aria-current')).not.toBeNull()
    expect(link('Probepaket').getAttribute('aria-current')).toBeNull()
    expect(link('Leeres Paket').getAttribute('aria-current')).toBeNull()
    expect(
      screen.getByRole('heading', { level: 2, name: 'Abgenommenes Paket, Fassung 2.0.0' }),
    ).toBeDefined()
  })
})

describe('the package shown', () => {
  it('is the first one where the address names none, with its duty kinds and the review of each', async () => {
    await mount()

    expect(
      screen.getByRole('heading', { level: 2, name: 'Probepaket, Fassung 1.2.0' }),
    ).toBeDefined()
    expect(screen.getByText('benötigt Kernfassung 0.1.0')).toBeDefined()
    // No entry without its review: the one nobody accepted says so, and that
    // its last check is more than a year back.
    expect(rowsOf('Pflichtarten im Paket Probepaket')).toEqual([
      [
        'Hauptprüfung der AufzugsanlagePrüfung',
        '§ 16 der Probeverordnung',
        'Staatliches Recht',
        'Höchstfrist 24 Monate',
        'Abgenommen',
        checkedToday,
      ],
      [
        'ZwischenprüfungFunktionskontrolle',
        'Probenorm 13015, Abschnitt 4',
        'Private Norm oder Richtlinie',
        'die Frist trägt der Betreiber ein',
        'Nicht abgenommen',
        longAgo,
      ],
    ])
  })

  it('names its parts with the number of entries in each, the one shown marked', async () => {
    await mount('/katalog/probe/regeln')

    const parts = within(screen.getByRole('navigation', { name: 'Teile des Pakets' }))

    expect(
      parts
        .getAllByRole('link')
        .map((link) => [
          link.textContent,
          link.getAttribute('href'),
          link.getAttribute('aria-current'),
        ]),
    ).toEqual([
      ['Pflichtarten2', '/katalog/probe/pflichtarten', null],
      ['Anlagenarten2', '/katalog/probe/anlagenarten', null],
      ['Formulare1', '/katalog/probe/formulare', null],
      ['Regeln3', '/katalog/probe/regeln', 'page'],
      ['Vorlagen1', '/katalog/probe/vorlagen', null],
      ['Mängelklassen2', '/katalog/probe/mangelklassen', null],
    ])
  })

  it('shows its defect classes in the order of the package, each with its review', async () => {
    await mount('/katalog/probe/mangelklassen')

    // Not by name: "leicht" stands before "schwer" because the package says so.
    expect(rowsOf('Mängelklassen im Paket Probepaket')).toEqual([
      ['leicht', 'nein', 'Probenorm 13015, Abschnitt 7', 'Abgenommen', checkedToday],
      ['schwer', 'ja', 'eigene Einteilung des Pakets', 'Nicht abgenommen', checkedToday],
    ])
  })

  it('says of the general package why it has no duty kinds', async () => {
    await mount('/katalog/allgemein', {
      ...testCatalogue,
      sha256: '3'.repeat(64),
      packages: [
        {
          name: 'allgemein',
          title: 'Allgemein',
          version: '1.0.0',
          minimumCore: '0.0.0',
          assetKinds: [],
          dutyKinds: [],
          forms: [],
          roundTemplates: [],
          rules: [],
          defectClasses: [],
        },
        ...testCatalogue.packages,
      ],
    })

    expect(
      screen.getByText(
        /Dieses Paket hat keine Pflichtarten: seine Anlagenarten stehen für Anlagen, deren Fachpaket noch fehlt/,
      ),
    ).toBeDefined()
  })

  it('says of any other package without duty kinds only that it has none', async () => {
    await mount('/katalog/leer')

    expect(screen.getByText('Dieses Paket hat keine Pflichtarten.')).toBeDefined()
  })

  it('shows its asset kinds in the version in force, each with its review', async () => {
    await mount('/katalog/probe/anlagenarten')

    // The version of the lift that begins in 2999 is not one of today. By
    // cost group, as assets are sorted everywhere, and not by key.
    expect(rowsOf('Anlagenarten im Paket Probepaket')).toEqual([
      ['Druckerhöhungsanlage', '412', '0', '0', 'Nicht abgenommen', checkedToday],
      ['Aufzugsanlage', '461', '1', '1', 'Abgenommen', checkedToday],
    ])
  })

  it('shows its forms and its round templates, each with its review', async () => {
    const { router } = await mount('/katalog/probe/formulare')

    expect(rowsOf('Formulare im Paket Probepaket')).toEqual([
      ['Protokoll der Zwischenprüfung', '1', '0', 'Nicht abgenommen', checkedToday],
    ])

    await router.navigate({ to: '/katalog/probe/vorlagen' })

    expect(
      await screen.findByRole('table', { name: 'Vorlagen für Rundgänge im Paket Probepaket' }),
    ).toBeDefined()
    expect(rowsOf('Vorlagen für Rundgänge im Paket Probepaket')).toEqual([
      ['Rundgang durch die Technikzentrale', '0', '0', 'Abgenommen', checkedToday],
    ])
  })

  it('shows every record of its rules with the time it applies in, the one that has ended as well', async () => {
    await mount('/katalog/probe/regeln')

    expect(rowsOf('Regeln im Paket Probepaket')).toEqual([
      [
        'probe.main_test_intervalbundesweit',
        '36 Monate',
        'Anhang 2 der Probeverordnung',
        '01.06.2015',
        '31.12.2020',
        'Abgenommen',
        checkedToday,
      ],
      [
        'probe.main_test_intervalbundesweit',
        '24 Monate',
        'Anhang 2 der Probeverordnung',
        '01.01.2021',
        'offen',
        'Abgenommen',
        checkedToday,
      ],
      [
        'probe.retention_yearsbundesweit',
        '10 Jahre',
        'Anhang 2 der Probeverordnung',
        '01.06.2015',
        'offen',
        'Nicht abgenommen',
        longAgo,
      ],
    ])
  })

  it('says so where it has nothing of a part', async () => {
    await mount('/katalog/leer/regeln')

    expect(screen.getByText('Dieses Paket hat keine Regeln.')).toBeDefined()
    expect(screen.queryByRole('table', { name: /Regeln im Paket/ })).toBeNull()
  })

  it('leads from a duty kind to its page', async () => {
    await mount()

    expect(
      screen.getByRole('link', { name: 'Hauptprüfung der Aufzugsanlage' }).getAttribute('href'),
    ).toBe('/katalog/probe/pflichtarten/elevator_main_test')
  })
})

describe('the catalogue on a phone', () => {
  it('shows a package and an entry as a box each, the review of the entry in it', async () => {
    onA('phone')
    signedInOffice('technician', [], servingCatalogue())
    await mountOffice('/katalog', new TestServer(), [])

    const listed = within(await screen.findByRole('list', { name: packages }))
      .getAllByRole('listitem')
      .map((item) => item.textContent)

    expect(listed[0]).toBe(
      'ProbepaketFassung 1.2.0 · 2 Anlagenarten · 2 Pflichtarten · 1 Formular6 von 11 abgenommen',
    )

    const kinds = within(screen.getByRole('list', { name: 'Pflichtarten im Paket Probepaket' }))
      .getAllByRole('listitem')
      .map((item) => item.textContent)

    expect(kinds).toEqual([
      `Hauptprüfung der AufzugsanlagePrüfung§ 16 der Probeverordnung · Höchstfrist 24 MonateAbgenommen · geprüft am ${checkedToday}`,
      'ZwischenprüfungFunktionskontrolleProbenorm 13015, Abschnitt 4 · die Frist trägt der Betreiber einNicht abgenommen · seit über einem Jahr nicht geprüft (01.01.2020)',
    ])
  })
})

describe('where there is nothing to show', () => {
  it('says that the catalogue has not reached a device that could not fetch it', async () => {
    // The server answers neither question of the device.
    signedInOffice('technician', [], {})
    await mountOffice('/katalog', new TestServer(), [])

    expect(
      await screen.findByText(
        'Der Katalog ist noch nicht auf diesem Gerät. Er kommt mit der nächsten Verbindung zum Server.',
      ),
    ).toBeDefined()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('says that the instance has no package yet', async () => {
    signedInOffice('technician', [], servingCatalogue({ ...testCatalogue, packages: [] }))
    await mountOffice('/katalog', new TestServer(), [])

    expect(
      await screen.findByText(
        'Diese Instanz bringt noch kein Paket mit. Pakete kommen mit einer Fassung der Anwendung.',
      ),
    ).toBeDefined()
  })

  it('finds nothing at an address that names no package or no part of one', async () => {
    const { router } = await mount()

    for (const address of ['/katalog/unbekannt', '/katalog/probe/irgendwas']) {
      await router.navigate({ to: address })

      expect(
        await screen.findByRole('heading', { level: 1, name: 'Nicht im Katalog' }),
      ).toBeDefined()

      await router.navigate({ to: '/katalog' })
      await screen.findByRole('table', { name: packages })
    }
  })
})
