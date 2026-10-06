import {
  type CatalogueBundle,
  planChanged,
  type RoleKey,
  tableBodyType,
  type TableFile,
  tableFileType,
} from '@opengewerk/haustechnik-domain'
import { TestServer } from '@opengewerk/platform-web/testing'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { acceptedReview, servingCatalogue, testCatalogue } from '../../app/test-catalogue.js'
import {
  mountOffice,
  type NamedArea,
  onA,
  rowsOf,
  signedInOffice,
  untilTheRightsAreKnown,
  type WriteAnswer,
  type Written,
} from '../test-office.js'

/**
 * The two imports from a table in the office (#100, sections 3 and 11 of the
 * concept): the file somebody chooses and the fields of its columns, what is
 * asked where the file says nothing, the kinds the words of a list are given,
 * the preview with what has to be put right and what waits for an answer, and
 * the one press that takes a table over.
 *
 * What a plan makes of a table is the server's, and the server is a stand in
 * here that answers what the test names. What is held is what the page sends
 * and when it lets somebody go on.
 */

const nord: NamedArea = { id: 'a-nord', name: 'Nord' }
const sued: NamedArea = { id: 'a-sued', name: 'Süd' }

const structurePlace = '/liegenschaften/importieren'
const assetsPlace = '/anlagen/importieren'

/** A list of places as the server read it: three lines under names a list uses, and a column nobody takes. */
const placesFile: TableFile = {
  name: 'bestand schulzentrum.csv',
  sheets: [
    {
      name: '',
      rows: [
        ['Liegenschaft', 'Haus', 'Etage', 'Raum-Nr.', 'Fläche'],
        ['Schulzentrum', 'Schulhaus', 'EG', 'E.01', '54,2'],
        ['Schulzentrum', 'Schulhaus', 'EG', 'E.02', '18'],
        ['Schulzentrum', 'Turnhalle', '', '', ''],
      ],
    },
  ],
}
const placesMapping = { property: 0, building: 1, floor: 2, roomNumber: 3 }

/** A list of assets: five lines and four words for what they are, one of them written in two ways. */
const assetsFile: TableFile = {
  name: 'anlagen.xlsx',
  sheets: [
    {
      name: 'Anlagen',
      rows: [
        ['Standort', 'Gebäude', 'Art', 'Bezeichnung', 'Seriennummer', 'KG'],
        ['Schulzentrum', 'Schulhaus', 'Aufzugsanlage', 'Aufzug Nord', 'SN-1', '461'],
        ['Schulzentrum', 'Schulhaus', 'aufzugs-anlage', 'Aufzug Süd', 'SN-2', '461'],
        ['Schulzentrum', 'Schulhaus', 'Rolltreppe', 'Fahrtreppe Foyer', '', '461'],
        ['Schulzentrum', 'Schulhaus', 'WW-Speicher', 'Speicher Keller', '', ''],
        ['Schulzentrum', 'Schulhaus', 'Feuerlöscher', 'Löscher Flur', '', ''],
      ],
    },
  ],
}
const assetsMapping = { property: 0, building: 1, kind: 2, name: 3, serialNumber: 4, costGroup: 5 }

/** The catalogue of the tests with a general kind for the conveying systems, as the package "Allgemein" has one. */
const catalogue: CatalogueBundle = {
  ...testCatalogue,
  sha256: '2'.repeat(64),
  packages: [
    ...testCatalogue.packages,
    {
      name: 'allgemein',
      title: 'Allgemein',
      version: '1.0.0',
      minimumCore: '0.1.0',
      assetKinds: [
        {
          key: 'allgemein.kg_460',
          version: 1,
          validFrom: '2015-06-01',
          definition: {
            label: 'Förderanlage',
            costGroup: '460',
            characteristics: [],
            fields: [],
            expectedDocuments: [],
            meter: null,
          },
          review: acceptedReview,
        },
      ],
      dutyKinds: [],
      forms: [],
      roundTemplates: [],
      rules: [],
      defectClasses: [],
    },
  ],
}

/** What a request that is no question carried, with the type it said it has. */
interface Sent {
  readonly method: string
  readonly path: string
  readonly type: string | null
  /** The name of the file in the header, as it was written there. */
  readonly fileName: string | null
  /** The file a request carried as its body, by its name. */
  readonly file: string | null
}

let server: TestServer
let written: Written[]
let sent: Sent[]
/** What the routes answer a write with, by their path. */
let answers: Record<string, (write: Written) => WriteAnswer>

function ok(body: unknown, status = 200): () => WriteAnswer {
  return () => ({ status, body })
}

function refused(status: number, message: string): () => WriteAnswer {
  return () => ({ status, body: { message } })
}

/** The office at an address, for somebody in a role who sees these areas. */
async function mount(
  at: string,
  role: RoleKey,
  areas: readonly NamedArea[] = [nord],
  further: Readonly<Record<string, unknown>> = {},
) {
  written = signedInOffice(
    role,
    areas,
    { ...servingCatalogue(catalogue), '/imports/asset-kinds': { names: [] }, ...further },
    (write) =>
      answers[write.path]?.(write) ?? {
        status: 500,
        body: { message: `Dieser Test hat ${write.path} nicht erwartet.` },
      },
  )

  // The stand in of the office keeps what was written and not how: the type
  // of a request and the name of a file are kept here, in front of it.
  const answering = globalThis.fetch as unknown as (
    path: string,
    init?: RequestInit,
  ) => Promise<Response>

  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'

    if (method !== 'GET') {
      const headers = new Headers(init?.headers)

      sent.push({
        method,
        path,
        type: headers.get('content-type'),
        fileName: headers.get('x-file-name'),
        file: init?.body instanceof File ? init.body.name : null,
      })
    }

    return answering(path, init)
  })

  return mountOffice(at, server, ['properties', 'buildings', 'floors', 'rooms'])
}

/** Chooses a file, which the server reads into the table the test names for the route. */
async function chooseFile(user: ReturnType<typeof userEvent.setup>, name: string): Promise<void> {
  const picker = await screen.findByLabelText('Datei wählen')

  await user.upload(picker, new File(['unread by the stand in'], name, { type: 'text/csv' }))
}

function select(name: string): HTMLSelectElement {
  return screen.getByRole('combobox', { name })
}

function choose(name: string, value: string): void {
  fireEvent.change(select(name), { target: { value } })
}

function button(name: string): HTMLButtonElement {
  return screen.getByRole('button', { name })
}

/** What the figures of a preview say, each with what it counts. */
function tiles(name: string): string[] {
  return within(screen.getByRole('list', { name }))
    .getAllByRole('listitem')
    .map((tile) => tile.textContent)
}

/** The step somebody is at. */
function step(): string | null {
  return (
    within(screen.getByRole('list', { name: 'Schritte des Imports' }))
      .getAllByRole('listitem')
      .find((item) => item.getAttribute('aria-current') === 'step')?.textContent ?? null
  )
}

function bodyOf(path: string, method = 'POST'): unknown {
  return written.findLast((write) => write.path === path && write.method === method)?.body
}

beforeEach(() => {
  localStorage.clear()
  onA('desktop')
  server = new TestServer()
  sent = []
  answers = {}
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const problemsTable = 'Zeilen, die vor der Übernahme zu klären sind'
const knownTable = 'Zeilen, die nichts anlegen, weil es den Ort schon gibt'
const columnsTable = 'Spalten der Datei und ihre Felder'

describe('the import of places', () => {
  const cleanCounts = { properties: 1, buildings: 2, floors: 1, rooms: 2, known: 0 }
  const clean = {
    lines: 3,
    counts: cleanCounts,
    problems: [],
    moreProblems: 0,
    known: [],
    moreKnown: 0,
  }

  /** As far as the columns: the file is chosen and read. */
  async function withTheFile(role: RoleKey = 'technical_management', areas = [nord]) {
    const user = userEvent.setup()

    answers['/imports/structure/table'] = ok(placesFile)

    const mounted = await mount(structurePlace, role, areas)

    await chooseFile(user, 'bestand schulzentrum.csv')
    await screen.findByRole('table', { name: columnsTable })

    return { user, ...mounted }
  }

  /** As far as the preview the test names. */
  async function withThePreview(preview: unknown, areas = [nord]) {
    const at = await withTheFile('technical_management', areas)

    answers['/imports/structure/preview'] = ok(preview)
    await at.user.click(button('Weiter zur Vorschau'))
    await screen.findByRole('list', { name: 'Was die Tabelle anlegen würde' })

    return at
  }

  it('is said to be somebody else’s to whoever does not keep the places', async () => {
    await mount(structurePlace, 'site_management')
    await untilTheRightsAreKnown()

    expect(
      screen.getByText('Den Bestand importiert, wer Liegenschaften, Gebäude und Geschosse pflegt.'),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Datei wählen' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Weiter zur Vorschau' })).toBeNull()
    expect(written).toEqual([])
  })

  it('asks for a file first, and offers the names of the fields as a file to start from', async () => {
    await mount(structurePlace, 'technical_management')

    expect(await screen.findByRole('button', { name: 'Datei wählen' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Bestand importieren')
    expect(step()).toBe('1Datei und Spalten')
    expect(button('Vorlage herunterladen')).toBeTruthy()
    // Nothing to go on with before a file is read.
    expect(button('Weiter zur Vorschau').disabled).toBe(true)
    expect(screen.queryByRole('table', { name: columnsTable })).toBeNull()
  })

  it('sends the file somebody chose as its bytes, shows what was read, and gives every column the field its name says', async () => {
    await withTheFile()

    expect(sent).toEqual([
      {
        method: 'POST',
        path: '/imports/structure/table',
        type: tableFileType,
        fileName: 'bestand%20schulzentrum.csv',
        file: 'bestand schulzentrum.csv',
      },
    ])

    // The card of the file: its name, its lines and where the names of the columns stand.
    expect(screen.getByText('bestand schulzentrum.csv')).toBeTruthy()
    expect(screen.getByText('3 Zeilen · Kopfzeile in Zeile 1')).toBeTruthy()
    expect(button('Andere Datei')).toBeTruthy()

    // A column with its first value and the field it was given; "Fläche" is no field and stays out.
    expect(rowsOf(columnsTable).map(([name, sample]) => [name, sample])).toEqual([
      ['Liegenschaft', 'Schulzentrum'],
      ['Haus', 'Schulhaus'],
      ['Etage', 'EG'],
      ['Raum-Nr.', 'E.01'],
      ['Fläche', '54,2'],
    ])
    expect(
      ['Liegenschaft', 'Haus', 'Etage', 'Raum-Nr.', 'Fläche'].map(
        (column) => select(`Feld für ${column}`).value,
      ),
    ).toEqual(['property', 'building', 'floor', 'roomNumber', ''])
    expect(button('Weiter zur Vorschau').disabled).toBe(false)
  })

  it('holds somebody back while a field that is needed has no column', async () => {
    await withTheFile()

    choose('Feld für Liegenschaft', '')

    expect(screen.getByRole('status').textContent).toBe('Noch ohne Spalte: Liegenschaft.')
    expect(button('Weiter zur Vorschau').disabled).toBe(true)

    // Given to another column, the field has one again.
    choose('Feld für Fläche', 'property')

    expect(screen.queryByRole('status')).toBeNull()
    expect(button('Weiter zur Vorschau').disabled).toBe(false)
  })

  it('says what the server says about a file that is no table', async () => {
    const user = userEvent.setup()

    answers['/imports/structure/table'] = refused(
      422,
      'Die Datei ist im alten Format (.xls) oder mit einem Kennwort geschützt.',
    )
    await mount(structurePlace, 'technical_management')
    await chooseFile(user, 'bestand.xls')

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Die Datei ist im alten Format (.xls) oder mit einem Kennwort geschützt.',
    )
    expect(screen.queryByRole('table', { name: columnsTable })).toBeNull()
    expect(button('Weiter zur Vorschau').disabled).toBe(true)
  })

  it('asks for the area, the federal state and the kind of building, and sends them with the sheet and its columns', async () => {
    const { user } = await withTheFile('technical_management', [nord, sued])

    choose('Bereich neuer Liegenschaften', sued.id)
    choose('Bundesland neuer Liegenschaften', 'DE-BW')
    choose('Gebäudeart neuer Gebäude', 'school')

    answers['/imports/structure/preview'] = ok(clean)
    await user.click(button('Weiter zur Vorschau'))
    await screen.findByRole('list', { name: 'Was die Tabelle anlegen würde' })

    expect(bodyOf('/imports/structure/preview')).toEqual({
      sheet: placesFile.sheets[0],
      mapping: placesMapping,
      defaults: { areaId: sued.id, federalState: 'DE-BW', buildingKinds: ['school'] },
    })
    expect(sent.at(-1)).toMatchObject({ path: '/imports/structure/preview', type: tableBodyType })
    // A preview is a question: nothing was taken over by asking.
    expect(written.map((write) => write.path)).toEqual([
      '/imports/structure/table',
      '/imports/structure/preview',
    ])
  })

  it('sends the one area of somebody who sees one without asking, and leaves empty what nobody chose', async () => {
    await withThePreview(clean)

    expect(screen.queryByRole('combobox', { name: 'Bereich neuer Liegenschaften' })).toBeNull()
    expect(bodyOf('/imports/structure/preview')).toEqual({
      sheet: placesFile.sheets[0],
      mapping: placesMapping,
      defaults: { areaId: nord.id, federalState: null, buildingKinds: [] },
    })
  })

  it('sends no area where somebody who sees several has chosen none', async () => {
    await withThePreview(clean, [nord, sued])

    expect(bodyOf('/imports/structure/preview')).toMatchObject({
      defaults: { areaId: null, federalState: null, buildingKinds: [] },
    })
  })

  it('shows what has to be put right with its lines and what to do, and keeps the button off', async () => {
    await withThePreview({
      lines: 3,
      counts: { properties: 1, buildings: 1, floors: 1, rooms: 1, known: 0 },
      problems: [
        {
          lines: [3, 4, 5, 9],
          what: 'Das Gebäude fehlt',
          next: 'In der Datei berichtigen und neu hochladen',
        },
        {
          lines: [7],
          what: 'Liegenschaft „Schulzentrum“: Das Bundesland fehlt',
          next: 'Im ersten Schritt ein Bundesland wählen oder die Datei berichtigen',
        },
      ],
      moreProblems: 12,
      known: [],
      moreKnown: 0,
    })

    expect(step()).toBe('2Vorschau')
    expect(screen.getByText('bestand schulzentrum.csv, 3 Zeilen')).toBeTruthy()
    expect(rowsOf(problemsTable)).toEqual([
      ['3 bis 5, 9', 'Das Gebäude fehlt', 'In der Datei berichtigen und neu hochladen'],
      [
        '7',
        'Liegenschaft „Schulzentrum“: Das Bundesland fehlt',
        'Im ersten Schritt ein Bundesland wählen oder die Datei berichtigen',
      ],
    ])
    expect(screen.getByText('und 12 weitere')).toBeTruthy()
    expect(screen.getByText(/Solange etwas zu klären ist, bleibt der Knopf aus\./)).toBeTruthy()
    expect(button('3 Zeilen übernehmen').disabled).toBe(true)
  })

  it('keeps the button off for problems the answer only counts', async () => {
    await withThePreview({ ...clean, moreProblems: 1 })

    expect(button('3 Zeilen übernehmen').disabled).toBe(true)
  })

  it('names what is there already, each with the way to its page', async () => {
    await withThePreview({
      ...clean,
      counts: { properties: 0, buildings: 1, floors: 0, rooms: 0, known: 14 },
      known: [
        {
          lines: [2],
          inFile: 'Schulzentrum',
          existing: 'Schulzentrum Am Neckar',
          table: 'properties',
          id: 'p-school',
        },
        {
          lines: [3],
          inFile: 'Schulzentrum, Schulhaus',
          existing: 'Schulhaus',
          table: 'buildings',
          id: 'b-house',
        },
        {
          lines: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
          inFile: '12 Räume: Schulzentrum, Schulhaus, EG',
          existing: 'EG, gleiche Räume',
          table: 'floors',
          id: 'f-ground',
        },
        {
          lines: [16],
          inFile: 'Schulzentrum, Schulhaus, 1. OG, 1.01',
          existing: 'Raum 1.01',
          table: 'rooms',
          id: 'r-101',
        },
      ],
      moreKnown: 3,
    })

    expect(rowsOf(knownTable)).toEqual([
      ['2', 'Schulzentrum', 'Schulzentrum Am Neckar'],
      ['3', 'Schulzentrum, Schulhaus', 'Schulhaus'],
      ['4 bis 15', '12 Räume: Schulzentrum, Schulhaus, EG', 'EG, gleiche Räume'],
      ['16', 'Schulzentrum, Schulhaus, 1. OG, 1.01', 'Raum 1.01'],
    ])
    expect(
      within(screen.getByRole('table', { name: knownTable }))
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual([
      '/liegenschaften/p-school',
      '/gebaeude/b-house',
      '/geschosse/f-ground',
      '/raeume/r-101',
    ])
    expect(screen.getByText('und 3 weitere')).toBeTruthy()
    expect(tiles('Was die Tabelle anlegen würde')).toEqual([
      '0Liegenschaften neu',
      '1Gebäude neu',
      '0Geschosse neu',
      '0Räume neu',
      '14Gibt es schonwerden nicht doppelt angelegt',
    ])
    // What is there already holds nothing back.
    expect(button('3 Zeilen übernehmen').disabled).toBe(false)
  })

  it('keeps the button off for a table that makes nothing, and says so', async () => {
    await withThePreview({
      ...clean,
      counts: { properties: 0, buildings: 0, floors: 0, rooms: 0, known: 3 },
    })

    expect(
      screen.getByText(/In dieser Tabelle steht nichts, was es nicht schon gibt\./),
    ).toBeTruthy()
    expect(button('3 Zeilen übernehmen').disabled).toBe(true)
  })

  it('takes a clean table over with one press: the sheet, its columns, what was chosen, the name of the file and what the preview counted', async () => {
    const { user, router } = await withThePreview(clean)

    expect(button('3 Zeilen übernehmen').disabled).toBe(false)

    // What the import made reaches the device with the exchange after it.
    server.put('properties', {
      id: 'p-school',
      areaId: nord.id,
      name: 'Schulzentrum',
      street: null,
      postalCode: null,
      city: null,
      federalState: 'DE-BW',
      note: null,
    })
    answers['/imports/structure'] = ok({ id: 'i-1', counts: cleanCounts, summary: 'unread' }, 201)
    await user.click(button('3 Zeilen übernehmen'))

    expect(
      await screen.findByText(
        'Übernommen: 1 Liegenschaft, 2 Gebäude, 1 Geschoss und 2 Räume angelegt. Der Import steht als ein Eintrag im Änderungsprotokoll.',
      ),
    ).toBeTruthy()
    expect(bodyOf('/imports/structure')).toEqual({
      sheet: placesFile.sheets[0],
      mapping: placesMapping,
      defaults: { areaId: nord.id, federalState: null, buildingKinds: [] },
      fileName: 'bestand schulzentrum.csv',
      expected: cleanCounts,
    })
    expect(sent.at(-1)).toMatchObject({ path: '/imports/structure', type: tableBodyType })
    expect(written.filter((write) => write.path === '/imports/structure')).toHaveLength(1)
    expect(tiles('Was der Import angelegt hat')).toEqual([
      '1Liegenschaften angelegt',
      '2Gebäude angelegt',
      '1Geschosse angelegt',
      '2Räume angelegt',
      '0Gab es schonnicht doppelt angelegt',
    ])

    // Back at the list the property is there, without anybody asking for an exchange.
    await user.click(button('Zu den Liegenschaften'))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/liegenschaften')
    })
    expect(await screen.findByRole('link', { name: 'Schulzentrum' })).toBeTruthy()
  })

  it('shows what the server refuses, at the preview and at the take-over, and has taken nothing over', async () => {
    const { user } = await withTheFile()
    const noArea =
      'Den Bereich für neue Liegenschaften gibt es bei diesem Betreiber nicht, oder Sie sehen ihn nicht.'

    answers['/imports/structure/preview'] = refused(400, noArea)
    await user.click(button('Weiter zur Vorschau'))

    expect(await screen.findByText(noArea)).toBeTruthy()
    expect(step()).toBe('1Datei und Spalten')

    answers['/imports/structure/preview'] = ok(clean)
    await user.click(button('Weiter zur Vorschau'))
    await screen.findByRole('list', { name: 'Was die Tabelle anlegen würde' })

    // The refusal of before is gone with the question that was answered.
    expect(screen.queryByText(noArea)).toBeNull()

    answers['/imports/structure'] = refused(409, planChanged)
    await user.click(button('3 Zeilen übernehmen'))

    expect(await screen.findByText(planChanged)).toBeTruthy()
    expect(step()).toBe('2Vorschau')
    expect(screen.queryByText(/^Übernommen:/)).toBeNull()
    await waitFor(() => {
      expect(button('3 Zeilen übernehmen').disabled).toBe(false)
    })
  })

  it('goes back to the columns with what was chosen, and leaves for the list', async () => {
    const { user, router } = await withThePreview(clean)

    await user.click(button('Zurück'))

    expect(step()).toBe('1Datei und Spalten')
    expect(select('Feld für Haus').value).toBe('building')

    await user.click(button('Abbrechen'))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/liegenschaften')
    })
  })
})

describe('the import of assets', () => {
  const kindsTable = 'Bezeichnungen der Datei und ihre Anlagenart'
  const duplicatesTable = 'Zeilen, die eine Anlage nennen, die es vielleicht schon gibt'
  const kept = { '/imports/asset-kinds': { names: [{ name: 'ww speicher', kind: 'probe.pump' }] } }
  const clean = {
    lines: 5,
    counts: { assets: 5, skipped: 0, undecided: 0 },
    problems: [],
    moreProblems: 0,
    duplicates: [],
  }
  const withDuplicates = {
    lines: 5,
    counts: { assets: 3, skipped: 0, undecided: 2 },
    problems: [],
    moreProblems: 0,
    duplicates: [
      {
        line: 3,
        name: 'Aufzug Süd',
        same: 'Gleiche Seriennummer',
        of: [{ id: 'a-lift', number: 'AN-00012', name: 'Aufzug Schulhaus' }],
        decision: null,
      },
      {
        line: 5,
        name: 'Speicher Keller',
        same: 'Gleiches Kennzeichen',
        of: [{ line: 3 }, { id: 'a-old', number: null, name: 'Speicher alt' }],
        decision: null,
      },
    ],
  }

  /** As far as the step that gives the words of the list their kinds. */
  async function withTheKinds(further: Readonly<Record<string, unknown>> = kept) {
    const user = userEvent.setup()

    answers['/imports/assets/table'] = ok(assetsFile)

    const mounted = await mount(assetsPlace, 'site_management', [nord], further)

    await chooseFile(user, 'anlagen.xlsx')
    await screen.findByRole('table', { name: columnsTable })
    await user.click(button('Weiter zu den Anlagenarten'))
    await screen.findByRole('table', { name: kindsTable })

    return { user, ...mounted }
  }

  /** As far as the preview the test names: every word has its kind, and they are saved. */
  async function withThePreview(preview: unknown) {
    const at = await withTheKinds()

    choose('Anlagenart für Feuerlöscher', 'fertig.pump')
    answers['/imports/asset-kinds'] = ok({ names: [] })
    answers['/imports/assets/preview'] = ok(preview)
    await at.user.click(button('Zuordnung speichern'))
    await screen.findByRole('list', { name: 'Was die Tabelle anlegen würde' })

    return at
  }

  it('is said to be somebody else’s to whoever does not keep the assets', async () => {
    await mount(assetsPlace, 'technician')
    await untilTheRightsAreKnown()

    expect(screen.getByText('Anlagen importiert, wer Anlagen pflegt.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Datei wählen' })).toBeNull()
    expect(written).toEqual([])
  })

  it('reads the file by the route of the assets, and lets nobody on before the four fields it needs have a column', async () => {
    const user = userEvent.setup()

    answers['/imports/assets/table'] = ok(assetsFile)
    await mount(assetsPlace, 'site_management')
    await chooseFile(user, 'anlagen.xlsx')
    await screen.findByRole('table', { name: columnsTable })

    expect(sent).toEqual([
      {
        method: 'POST',
        path: '/imports/assets/table',
        type: tableFileType,
        fileName: 'anlagen.xlsx',
        file: 'anlagen.xlsx',
      },
    ])
    expect(screen.getByText('Blatt „Anlagen“ · 5 Zeilen · Kopfzeile in Zeile 1')).toBeTruthy()
    expect(
      ['Standort', 'Gebäude', 'Art', 'Bezeichnung', 'Seriennummer', 'KG'].map(
        (column) => select(`Feld für ${column}`).value,
      ),
    ).toEqual(['property', 'building', 'kind', 'name', 'serialNumber', 'costGroup'])
    expect(button('Weiter zu den Anlagenarten').disabled).toBe(false)

    for (const column of ['Standort', 'Gebäude', 'Art', 'Bezeichnung']) {
      const field = select(`Feld für ${column}`).value

      choose(`Feld für ${column}`, '')
      expect([column, button('Weiter zu den Anlagenarten').disabled]).toEqual([column, true])
      choose(`Feld für ${column}`, field)
    }

    // The serial number is none of them.
    choose('Feld für Seriennummer', '')
    expect(button('Weiter zu den Anlagenarten').disabled).toBe(false)
  })

  it('lists every word of the list once with its lines, and gives it the kind the tenant keeps or the catalogue proposes', async () => {
    await withTheKinds()

    expect(step()).toBe('2Anlagenarten')
    // "Aufzugsanlage" and "aufzugs-anlage" are one word, with both their lines.
    expect(rowsOf(kindsTable).map(([name, count]) => [name, count])).toEqual([
      ['Aufzugsanlage', '2'],
      ['Rolltreppe', '1'],
      ['WW-Speicher', '1'],
      ['Feuerlöscher', '1'],
    ])
    expect(
      ['Aufzugsanlage', 'Rolltreppe', 'WW-Speicher', 'Feuerlöscher'].map(
        (name) => select(`Anlagenart für ${name}`).value,
      ),
    ).toEqual([
      // The one kind of a package that is called exactly that.
      'probe.elevator',
      // No kind is called that: the general kind of the cost group its lines name.
      'allgemein.kg_460',
      // What the tenant kept, however it was written then.
      'probe.pump',
      // Nothing to go by.
      '',
    ])
    expect(rowsOf(kindsTable).map((row) => row[3])).toEqual([
      '',
      'Pflichten erst mit dem Fachpaket',
      '',
      'Noch offen',
    ])
    // The general kind is offered with its cost group, so that it is told from the kinds of a package.
    expect(
      [...select('Anlagenart für Feuerlöscher').options].map((option) => option.textContent),
    ).toEqual([
      'Anlagenart wählen',
      'Probepaket: Aufzugsanlage',
      'Probepaket: Druckerhöhungsanlage',
      'Abgenommenes Paket: Druckerhöhungsanlage',
      'Allgemein: Förderanlage (KG 460)',
    ])
    expect(button('Zuordnung speichern').disabled).toBe(true)
    expect(written.map((write) => write.path)).toEqual(['/imports/assets/table'])
  })

  it('proposes nothing where the tenant keeps no word and the list names no cost group', async () => {
    await withTheKinds({})

    expect(select('Anlagenart für WW-Speicher').value).toBe('')
    expect(rowsOf(kindsTable).map((row) => row[3])).toEqual([
      '',
      'Pflichten erst mit dem Fachpaket',
      'Noch offen',
      'Noch offen',
    ])
  })

  it('saves every word with its kind once none is open, and asks for the preview after that', async () => {
    const { user } = await withTheKinds()

    choose('Anlagenart für Feuerlöscher', 'fertig.pump')

    expect(screen.queryByText('Noch offen')).toBeNull()
    expect(button('Zuordnung speichern').disabled).toBe(false)

    // Somebody corrects what the tenant kept.
    choose('Anlagenart für WW-Speicher', 'allgemein.kg_460')

    answers['/imports/asset-kinds'] = ok({ names: [] })
    answers['/imports/assets/preview'] = ok(clean)
    await user.click(button('Zuordnung speichern'))
    await screen.findByRole('list', { name: 'Was die Tabelle anlegen würde' })

    expect(written.slice(1).map((write) => `${write.method} ${write.path}`)).toEqual([
      'PUT /imports/asset-kinds',
      'POST /imports/assets/preview',
    ])
    expect(bodyOf('/imports/asset-kinds', 'PUT')).toEqual({
      names: [
        { name: 'Aufzugsanlage', kind: 'probe.elevator' },
        { name: 'Rolltreppe', kind: 'allgemein.kg_460' },
        { name: 'WW-Speicher', kind: 'allgemein.kg_460' },
        { name: 'Feuerlöscher', kind: 'fertig.pump' },
      ],
    })
    expect(bodyOf('/imports/assets/preview')).toEqual({
      sheet: assetsFile.sheets[0],
      mapping: assetsMapping,
    })
    expect(sent.slice(1).map((request) => request.type)).toEqual([
      'application/json',
      tableBodyType,
    ])
    expect(step()).toBe('3Vorschau')
    expect(screen.getByText('anlagen.xlsx, 5 Zeilen')).toBeTruthy()
  })

  it('asks for no preview where the words could not be saved, and says why', async () => {
    const { user } = await withTheKinds()

    choose('Anlagenart für Feuerlöscher', 'fertig.pump')
    answers['/imports/asset-kinds'] = refused(
      400,
      'Die Anlagenart für „Feuerlöscher“ kennt kein Paket des Katalogs.',
    )
    await user.click(button('Zuordnung speichern'))

    expect(
      await screen.findByText('Die Anlagenart für „Feuerlöscher“ kennt kein Paket des Katalogs.'),
    ).toBeTruthy()
    expect(step()).toBe('2Anlagenarten')
    expect(written.map((write) => write.path)).not.toContain('/imports/assets/preview')
  })

  it('takes a clean table over with what the preview counted, and says what was made', async () => {
    const { user, router } = await withThePreview(clean)

    expect(tiles('Was die Tabelle anlegen würde')).toEqual([
      '5Anlagen neu',
      '0Gibt es vielleicht schonSie entscheiden je Zeile',
      '0Zeilen offenvor der Übernahme zu klären',
    ])
    expect(screen.queryByRole('table', { name: duplicatesTable })).toBeNull()

    answers['/imports/assets'] = ok({ id: 'i-1', counts: clean.counts, summary: 'unread' }, 201)
    await user.click(button('5 Anlagen anlegen'))

    expect(
      await screen.findByText(
        'Übernommen: 5 Anlagen angelegt. Der Import steht als ein Eintrag im Änderungsprotokoll.',
      ),
    ).toBeTruthy()
    expect(bodyOf('/imports/assets')).toEqual({
      sheet: assetsFile.sheets[0],
      mapping: assetsMapping,
      decisions: {},
      fileName: 'anlagen.xlsx',
      expected: { assets: 5, skipped: 0, undecided: 0 },
    })
    expect(sent.at(-1)).toMatchObject({ path: '/imports/assets', type: tableBodyType })

    await user.click(button('Zu den Anlagen'))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/anlagen')
    })
  })

  it('names every possible duplicate with what it may be, and waits for an answer to each', async () => {
    const { user } = await withThePreview(withDuplicates)

    expect(tiles('Was die Tabelle anlegen würde')).toEqual([
      '3Anlagen neu',
      '2Gibt es vielleicht schonSie entscheiden je Zeile',
      '0Zeilen offenvor der Übernahme zu klären',
    ])
    expect(rowsOf(duplicatesTable).map((row) => row.slice(0, 3))).toEqual([
      ['3', 'Aufzug Süd', 'AN-00012 Aufzug SchulhausGleiche Seriennummer'],
      ['5', 'Speicher Keller', 'Zeile 3 dieser DateiAnlage Speicher altGleiches Kennzeichen'],
    ])
    expect(
      within(screen.getByRole('table', { name: duplicatesTable }))
        .getAllByRole('link')
        .map((link) => [link.textContent, link.getAttribute('href')]),
    ).toEqual([
      ['AN-00012', '/anlagen/a-lift'],
      ['Anlage', '/anlagen/a-old'],
    ])

    const answer = (line: number, name: string) =>
      within(screen.getByRole('group', { name: `Zeile ${String(line)}` })).getByRole('button', {
        name,
      })

    // No answer yet: the button is off and says so.
    expect(
      screen.getByText(/Solange eine Dublette ohne Entscheidung ist, bleibt der Knopf aus\./),
    ).toBeTruthy()
    expect(button('3 Anlagen anlegen').disabled).toBe(true)

    // One answer is not both.
    await user.click(answer(3, 'Nicht anlegen'))

    expect(answer(3, 'Nicht anlegen').getAttribute('aria-pressed')).toBe('true')
    expect(answer(3, 'Trotzdem anlegen').getAttribute('aria-pressed')).toBe('false')
    expect(button('3 Anlagen anlegen').disabled).toBe(true)

    // The second is taken all the same: the button counts it and comes on.
    await user.click(answer(5, 'Trotzdem anlegen'))

    expect(screen.queryByText(/Solange eine Dublette ohne Entscheidung ist/)).toBeNull()
    expect(button('4 Anlagen anlegen').disabled).toBe(false)

    answers['/imports/assets'] = ok(
      { id: 'i-1', counts: { assets: 4, skipped: 1, undecided: 0 }, summary: 'unread' },
      201,
    )
    await user.click(button('4 Anlagen anlegen'))

    expect(
      await screen.findByText(
        'Übernommen: 4 Anlagen angelegt, 1 Zeile als Dublette nicht angelegt. Der Import steht als ein Eintrag im Änderungsprotokoll.',
      ),
    ).toBeTruthy()
    expect(bodyOf('/imports/assets')).toEqual({
      sheet: assetsFile.sheets[0],
      mapping: assetsMapping,
      decisions: { 3: 'skip', 5: 'take' },
      fileName: 'anlagen.xlsx',
      expected: { assets: 4, skipped: 1, undecided: 0 },
    })
  })

  it('answers all of them at once, either way, and an answer is changed by giving the other', async () => {
    const { user } = await withThePreview(withDuplicates)

    await user.click(button('Alle nicht anlegen'))

    expect(button('3 Anlagen anlegen').disabled).toBe(false)
    expect(
      screen
        .getAllByRole('button', { name: 'Nicht anlegen' })
        .map((chip) => chip.getAttribute('aria-pressed')),
    ).toEqual(['true', 'true'])

    await user.click(button('Alle trotzdem anlegen'))

    expect(button('5 Anlagen anlegen').disabled).toBe(false)
    expect(
      screen
        .getAllByRole('button', { name: 'Nicht anlegen' })
        .map((chip) => chip.getAttribute('aria-pressed')),
    ).toEqual(['false', 'false'])

    answers['/imports/assets'] = ok(
      { id: 'i-1', counts: { assets: 5, skipped: 0, undecided: 0 }, summary: 'unread' },
      201,
    )
    await user.click(button('5 Anlagen anlegen'))
    await screen.findByText(/^Übernommen: 5 Anlagen angelegt\./)

    expect(bodyOf('/imports/assets')).toMatchObject({
      decisions: { 3: 'take', 5: 'take' },
      expected: { assets: 5, skipped: 0, undecided: 0 },
    })
  })

  it('counts one asset as one, and keeps the button off where every line is left out', async () => {
    const { user } = await withThePreview({
      ...withDuplicates,
      counts: { assets: 0, skipped: 0, undecided: 2 },
    })

    await user.click(button('Alle nicht anlegen'))

    expect(screen.getByText(/Von dieser Tabelle bleibt nichts, was anzulegen wäre\./)).toBeTruthy()
    expect(button('0 Anlagen anlegen').disabled).toBe(true)

    await user.click(
      within(screen.getByRole('group', { name: 'Zeile 3' })).getByRole('button', {
        name: 'Trotzdem anlegen',
      }),
    )

    expect(button('1 Anlage anlegen').disabled).toBe(false)
  })

  it('shows what has to be put right, counts its lines, and keeps the button off', async () => {
    await withThePreview({
      lines: 5,
      counts: { assets: 3, skipped: 0, undecided: 0 },
      problems: [
        {
          lines: [4, 6],
          what: 'Das Gebäude „Turnhalle“ gibt es in der Liegenschaft Schulzentrum nicht',
          next: 'Gebäude anlegen oder die Datei berichtigen',
        },
      ],
      moreProblems: 0,
      duplicates: [],
    })

    expect(rowsOf(problemsTable)).toEqual([
      [
        '4, 6',
        'Das Gebäude „Turnhalle“ gibt es in der Liegenschaft Schulzentrum nicht',
        'Gebäude anlegen oder die Datei berichtigen',
      ],
    ])
    expect(tiles('Was die Tabelle anlegen würde')).toEqual([
      '3Anlagen neu',
      '0Gibt es vielleicht schonSie entscheiden je Zeile',
      '2Zeile offenvor der Übernahme zu klären',
    ])
    expect(button('3 Anlagen anlegen').disabled).toBe(true)
  })

  it('shows what the server refuses at the take-over, and goes back to the kinds with what was chosen', async () => {
    const { user } = await withThePreview(clean)

    answers['/imports/assets'] = refused(409, planChanged)
    await user.click(button('5 Anlagen anlegen'))

    expect(await screen.findByText(planChanged)).toBeTruthy()
    expect(step()).toBe('3Vorschau')
    expect(screen.queryByText(/^Übernommen:/)).toBeNull()

    await user.click(button('Zurück'))

    expect(step()).toBe('2Anlagenarten')
    expect(select('Anlagenart für Feuerlöscher').value).toBe('fertig.pump')
  })
})

describe('the way into the imports', () => {
  const school = {
    id: 'p-school',
    areaId: nord.id,
    name: 'Schulzentrum',
    street: 'Am Lindenhain 7',
    postalCode: '00003',
    city: 'Musterhausen',
    federalState: 'DE-BW',
    note: null,
  }
  const register = { '/assets?offset=0&limit=50': { total: 0, properties: 0, assets: [] } }

  beforeEach(() => {
    server.put('properties', school)
  })

  it('stands over the list of the properties for whoever keeps the places, and leads to their import', async () => {
    const user = userEvent.setup()
    const { router } = await mount('/liegenschaften', 'technical_management')

    await user.click(await screen.findByRole('button', { name: 'Importieren' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(structurePlace)
    })
    expect(await screen.findByRole('heading', { name: 'Bestand importieren' })).toBeTruthy()
  })

  it('is not offered over the properties to whoever only looks after assets', async () => {
    await mount('/liegenschaften', 'site_management')
    await untilTheRightsAreKnown()
    await screen.findByRole('link', { name: 'Schulzentrum' })

    expect(screen.queryByRole('button', { name: 'Importieren' })).toBeNull()
  })

  it('stands over the register of the assets for whoever keeps assets, and leads to their import', async () => {
    const user = userEvent.setup()
    const { router } = await mount('/anlagen', 'site_management', [nord], register)

    await user.click(await screen.findByRole('button', { name: 'Importieren' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(assetsPlace)
    })
    expect(await screen.findByRole('heading', { name: 'Anlagen importieren' })).toBeTruthy()
  })

  it('is not offered over the register to whoever takes assets into it and keeps none', async () => {
    await mount('/anlagen', 'technician', [nord], register)
    await untilTheRightsAreKnown()

    // What the Haustechnik may do with the register is there, the import is not.
    expect(await screen.findByRole('button', { name: 'Neue Anlage' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Importieren' })).toBeNull()
  })
})
