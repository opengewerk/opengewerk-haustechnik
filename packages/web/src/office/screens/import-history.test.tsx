import {
  type MeterImportRow,
  planChanged,
  type RoleKey,
  type TableFile,
  type TemplateImportRow,
} from '@opengewerk/haustechnik-domain'
import { TestServer } from '@opengewerk/platform-web/testing'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { servingCatalogue, testCatalogue } from '../../app/test-catalogue.js'
import { memberIn } from '../../app/test-entry.js'
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
 * The import of the history of the meters and the one of the templates of
 * the rounds in the office (#130, second part, section 11 of the concept):
 * who may run each, what the preview shows of the lines, and the one press
 * that takes the list over.
 *
 * What a plan makes of a list is the server's, and the server is a stand in
 * here that answers what the test names. What is held is what the page sends
 * and when it lets somebody go on.
 */

const nord: NamedArea = { id: 'a-nord', name: 'Nord' }

const meterFile: TableFile = {
  name: 'zaehler-2026.csv',
  sheets: [
    {
      name: '',
      rows: [
        ['Zählernummer', 'Eintrag', 'Tag', 'Stand', 'Ableser'],
        ['W-2001', 'Stand', '31.01.2026', '4812,5', 'Vogt'],
        ['W-2001', 'Stand', '28.02.2026', '48300', 'Vogt'],
      ],
    },
  ],
}
const meterMapping = { meterNumber: 0, entry: 1, day: 2, value: 3 }
const meter = { id: 'm-1', number: 'AN-00101', name: 'Hauptwasserzähler', meterNumber: 'W-2001' }
const readingRow: MeterImportRow = {
  line: 2,
  meter,
  entry: 'reading',
  day: '2026-01-31',
  what: '4.812,5 m³ zum Stichtag 01.02.2026',
  jump: null,
}
const jumpRow: MeterImportRow = {
  line: 3,
  meter,
  entry: 'reading',
  day: '2026-02-28',
  what: '48.300,0 m³ zum Stichtag 01.03.2026',
  jump: 'Etwa zehnmal so viel wie im Vormonat. Stimmt das Komma?',
}
const meterCounts = { readings: 2, exchanges: 0, pauses: 0, known: 0 }
const meterPreview = {
  lines: 2,
  counts: meterCounts,
  problems: [],
  moreProblems: 0,
  notes: [],
  moreNotes: 0,
  rows: [readingRow, jumpRow],
  moreRows: 0,
  jumps: [
    { lines: [3], column: 'Stand', why: 'Etwa zehnmal so viel wie im Vormonat. Stimmt das Komma?' },
  ],
  moreJumps: 0,
}

const templateFile: TableFile = {
  name: 'vorlagen.csv',
  sheets: [
    {
      name: '',
      rows: [
        ['Vorlage', 'Kapitel', 'Punkt', 'Art', 'Anlage'],
        ['Technikrundgang', 'Heizung', 'Kessel ohne Störung', 'Prüfpunkt', 'Kessel 1'],
        ['Technikrundgang', 'Heizung', 'Vorlauf', 'Messwert', 'Kessel 1'],
      ],
    },
  ],
}
const templateMapping = { template: 0, chapter: 1, point: 2, kind: 3 }
const templateRow: TemplateImportRow = {
  line: 2,
  title: 'Technikrundgang',
  chapters: 1,
  points: 2,
  limits: 1,
  asksCountersignature: true,
}
const templateCounts = { templates: 1, chapters: 1, points: 2, known: 0 }
const templatePreview = {
  lines: 2,
  counts: templateCounts,
  problems: [],
  moreProblems: 0,
  notes: [],
  moreNotes: 0,
  rows: [templateRow],
  moreRows: 0,
}

/** What differs between the two imports, for the tests both share. */
const imports = {
  meters: {
    place: '/zaehler/importieren',
    route: '/imports/meters',
    file: meterFile,
    mapping: meterMapping,
    preview: meterPreview,
    counts: meterCounts,
    take: '2 Zeilen übernehmen',
    back: '/zaehler',
  },
  templates: {
    place: '/rundgaenge/vorlagen/importieren',
    route: '/imports/templates',
    file: templateFile,
    mapping: templateMapping,
    preview: templatePreview,
    counts: templateCounts,
    take: '1 Vorlage übernehmen',
    back: '/rundgaenge/vorlagen',
  },
} as const

type Kind = keyof typeof imports

let server: TestServer
let written: Written[]
/** What the routes answer a write with, by their path. */
let answers: Record<string, (write: Written) => WriteAnswer>

function ok(body: unknown, status = 200): () => WriteAnswer {
  return () => ({ status, body })
}

async function mount(kind: Kind, role: RoleKey, lacking: readonly string[] = []) {
  const member = memberIn(role)

  written = signedInOffice(
    role,
    [nord],
    {
      ...servingCatalogue(testCatalogue),
      '/auth/tenants': [
        { ...member, rights: member.rights.filter((right) => !lacking.includes(right)) },
      ],
    },
    (write) =>
      answers[write.path]?.(write) ?? {
        status: 500,
        body: { message: `Dieser Test hat ${write.path} nicht erwartet.` },
      },
  )

  return mountOffice(imports[kind].place, server, [])
}

function button(name: string): HTMLButtonElement {
  return screen.getByRole('button', { name })
}

function tiles(name: string): string[] {
  return within(screen.getByRole('list', { name }))
    .getAllByRole('listitem')
    .map((tile) => tile.textContent)
}

function bodyOf(path: string): Record<string, unknown> {
  return written.findLast((write) => write.path === path)?.body as Record<string, unknown>
}

/** As far as the columns: the list is chosen and read. */
async function withTheList(kind: Kind, role: RoleKey = 'technical_management') {
  const user = userEvent.setup()
  const { route, file } = imports[kind]

  answers[`${route}/table`] = ok(file)
  await mount(kind, role)
  await user.upload(
    await screen.findByLabelText('Datei wählen'),
    new File(['unread by the stand in'], file.name, { type: 'text/csv' }),
  )
  await screen.findByRole('table', { name: 'Spalten der Datei und ihre Felder' })

  return user
}

/** As far as the preview the test names. */
async function withThePreview(kind: Kind, preview: unknown = imports[kind].preview) {
  const user = await withTheList(kind)

  answers[`${imports[kind].route}/preview`] = ok(preview)
  await user.click(button('Weiter zur Vorschau'))
  await screen.findByRole('list', { name: 'Was die Liste übernehmen würde' })

  return user
}

beforeEach(() => {
  localStorage.clear()
  onA('desktop')
  server = new TestServer()
  answers = {}
})

describe('the import of the history of meters', () => {
  const noRight =
    'Zählerstände, Zählertausche und Stilllegungen importiert, wer Anlagen pflegt und Zähler abliest.'

  it('is said to be somebody else’s to whoever keeps no assets', async () => {
    await mount('meters', 'technician')
    await untilTheRightsAreKnown()

    expect(screen.getByText(noRight)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Datei wählen' })).toBeNull()
    expect(written).toEqual([])
  })

  it('is somebody else’s as well to whoever keeps assets and reads no meters', async () => {
    await mount('meters', 'technical_management', ['reading.write'])
    await untilTheRightsAreKnown()

    expect(screen.getByText(noRight)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Datei wählen' })).toBeNull()
  })

  it('asks for the list, under the meters', async () => {
    await mount('meters', 'site_management')

    expect(await screen.findByRole('button', { name: 'Datei wählen' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Zählerstände importieren')
    expect(
      within(screen.getByRole('navigation', { name: 'Pfad' }))
        .getAllByRole('link')
        .map((link) => [link.textContent, link.getAttribute('href')]),
    ).toEqual([['Zähler', '/zaehler']])
    expect(button('Vorlage herunterladen')).toBeTruthy()
    expect(button('Weiter zur Vorschau').disabled).toBe(true)
  })

  it('gives every column the field its name says and sends the list for the preview', async () => {
    await withThePreview('meters')

    expect(bodyOf('/imports/meters/preview')).toEqual({
      sheet: meterFile.sheets[0],
      mapping: meterMapping,
    })
  })

  it('shows what the list would take over, line by line, and why a figure is asked about once more', async () => {
    await withThePreview('meters')

    expect(tiles('Was die Liste übernehmen würde')).toEqual([
      '2Zählerstände',
      '0Zählertausche',
      '0Stilllegungen',
      '0Gibt es schonwerden nicht doppelt übernommen',
    ])
    expect(
      rowsOf(
        'Zeilen der Liste, die übernommen werden, mit Messstelle, Eintrag, Tag und dem, was daraus wird',
      ),
    ).toEqual([
      [
        '2',
        'AN-00101Hauptwasserzähler',
        'Stand',
        '31.01.2026',
        '4.812,5 m³ zum Stichtag 01.02.2026',
      ],
      [
        '3',
        'AN-00101Hauptwasserzähler',
        'Stand',
        '28.02.2026',
        '48.300,0 m³ zum Stichtag 01.03.2026Etwa zehnmal so viel wie im Vormonat. Stimmt das Komma?',
      ],
    ])
    expect(
      screen.getAllByRole('link', { name: 'AN-00101' }).map((link) => link.getAttribute('href')),
    ).toEqual(['/zaehler/m-1', '/zaehler/m-1'])
    // Apart from what is left out: these are taken over, and taking over confirms them.
    expect(rowsOf('Stände der Liste, die weit über dem Stand davor liegen')).toEqual([
      ['3', 'Stand', 'Etwa zehnmal so viel wie im Vormonat. Stimmt das Komma?'],
    ])
    expect(
      screen.getByText(
        'Diese Stände werden übernommen. Wer die Liste übernimmt, bestätigt sie damit.',
      ),
    ).toBeTruthy()
    expect(
      screen.queryByRole('table', { name: 'Werte der Datei, die nicht übernommen werden' }),
    ).toBeNull()
    expect(screen.getByText(/Er trägt die Quelle „Übernommen“/)).toBeTruthy()
    expect(button('2 Zeilen übernehmen').disabled).toBe(false)
  })

  it('shows the lines as boxes on a phone, each with what becomes of it', async () => {
    const turn = onA('desktop')

    await withThePreview('meters')
    turn('phone')

    const boxes = await screen.findAllByRole('listitem')
    const texts = boxes.map((box) => box.textContent)

    expect(texts.some((text) => text.includes('AN-00101 · Stand'))).toBe(true)
    expect(
      texts.some((text) =>
        text.includes(
          'Zeile 3 · Hauptwasserzähler · 28.02.2026 · 48.300,0 m³ zum Stichtag 01.03.2026 · Etwa zehnmal so viel wie im Vormonat. Stimmt das Komma?',
        ),
      ),
    ).toBe(true)
  })

  it('keeps the button off while a line is open, and says what is left out', async () => {
    await withThePreview('meters', {
      ...meterPreview,
      problems: [
        {
          lines: [3],
          what: '4.700,0 m³ an AN-00101: Kleiner als der letzte Stand vom 01.02.2026, 4.812,5 m³',
          next: 'Wurde der Zähler getauscht, den Tausch als Zeile nennen; sonst in der Datei berichtigen',
        },
      ],
      notes: [
        {
          lines: [2],
          column: 'Bis',
          why: 'steht in einer Zeile „Stand“ und wird nicht übernommen',
        },
      ],
    })

    expect(rowsOf('Zeilen, die vor der Übernahme zu klären sind')).toEqual([
      [
        '3',
        '4.700,0 m³ an AN-00101: Kleiner als der letzte Stand vom 01.02.2026, 4.812,5 m³',
        'Wurde der Zähler getauscht, den Tausch als Zeile nennen; sonst in der Datei berichtigen',
      ],
    ])
    expect(rowsOf('Werte der Datei, die nicht übernommen werden')).toEqual([
      ['2', 'Bis', 'steht in einer Zeile „Stand“ und wird nicht übernommen'],
    ])
    expect(button('2 Zeilen übernehmen').disabled).toBe(true)
  })

  it('keeps the button off where the list makes nothing', async () => {
    await withThePreview('meters', {
      ...meterPreview,
      counts: { readings: 0, exchanges: 0, pauses: 0, known: 2 },
      rows: [],
    })

    expect(screen.getByText(/In dieser Liste steht nichts, was es nicht schon gibt\./)).toBeTruthy()
    expect(button('0 Zeilen übernehmen').disabled).toBe(true)
  })

  it('sends the list with the counts it was shown, and says what was made', async () => {
    const user = await withThePreview('meters')

    answers['/imports/meters'] = ok({ id: 'i-1', counts: meterCounts, summary: '' }, 201)
    await user.click(button('2 Zeilen übernehmen'))

    expect(await screen.findByText(/Übernommen: 2 Zählerstände übernommen\./)).toBeTruthy()
    expect(bodyOf('/imports/meters')).toEqual({
      sheet: meterFile.sheets[0],
      mapping: meterMapping,
      fileName: 'zaehler-2026.csv',
      expected: meterCounts,
    })
    expect(tiles('Was der Import übernommen hat')).toEqual([
      '2Zählerstände',
      '0Zählertausche',
      '0Stilllegungen',
      '0Gab es schonnicht doppelt übernommen',
    ])
    expect(button('Zu den Zählern')).toBeTruthy()
  })

  it('says what the server refuses, and stays on the preview', async () => {
    const user = await withThePreview('meters')

    answers['/imports/meters'] = () => ({ status: 409, body: { message: planChanged } })
    await user.click(button('2 Zeilen übernehmen'))

    expect(await screen.findByText(planChanged)).toBeTruthy()
    await waitFor(() => {
      expect(button('2 Zeilen übernehmen').disabled).toBe(false)
    })
  })
})

describe('the import of templates of rounds', () => {
  it('is said to be somebody else’s to whoever does not keep the templates', async () => {
    await mount('templates', 'technician')
    await untilTheRightsAreKnown()

    expect(screen.getByText('Vorlagen der Rundgänge importiert, wer sie führt.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Datei wählen' })).toBeNull()
    expect(written).toEqual([])
  })

  it('asks for the list, under the templates of the rounds', async () => {
    await mount('templates', 'site_management')

    expect(await screen.findByRole('button', { name: 'Datei wählen' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Vorlagen importieren')
    expect(
      within(screen.getByRole('navigation', { name: 'Pfad' }))
        .getAllByRole('link')
        .map((link) => [link.textContent, link.getAttribute('href')]),
    ).toEqual([
      ['Rundgänge', '/rundgaenge'],
      ['Vorlagen', '/rundgaenge/vorlagen'],
    ])
  })

  it('sends the list for the preview and shows each template with what it holds', async () => {
    await withThePreview('templates')

    expect(bodyOf('/imports/templates/preview')).toEqual({
      sheet: templateFile.sheets[0],
      mapping: templateMapping,
    })
    expect(tiles('Was die Liste übernehmen würde')).toEqual([
      '1Vorlagen',
      '1Kapitel',
      '2Punkte',
      '0Gibt es schonZeilen von Vorlagen, die bleiben',
    ])
    expect(
      rowsOf(
        'Vorlagen der Liste, die übernommen werden, mit Umfang, Grenzwerten und Gegenzeichnung',
      ),
    ).toEqual([['2', 'Technikrundgang', '1 Kapitel, 2 Punkte', '1', 'verlangt']])
    expect(
      screen.getByText(/das tragen Sie danach im Editor ein, als nächste Fassung/),
    ).toBeTruthy()
    expect(button('1 Vorlage übernehmen').disabled).toBe(false)
  })

  it('keeps the button off while a line is open and where every template is here already', async () => {
    await withThePreview('templates', {
      ...templatePreview,
      counts: { templates: 0, chapters: 0, points: 0, known: 2 },
      rows: [],
    })

    expect(
      screen.getByText(/In dieser Liste steht keine Vorlage, die es nicht schon gibt\./),
    ).toBeTruthy()
    expect(button('0 Vorlagen übernehmen').disabled).toBe(true)
  })

  it('keeps the button off while a line is to clear up', async () => {
    await withThePreview('templates', {
      ...templatePreview,
      problems: [
        {
          lines: [3],
          what: 'Die Einheit fehlt',
          next: 'In der Datei berichtigen und neu hochladen',
        },
      ],
    })

    expect(button('1 Vorlage übernehmen').disabled).toBe(true)
  })

  it('sends the list with the counts it was shown, and says what was made and what is left to do', async () => {
    const user = await withThePreview('templates')

    answers['/imports/templates'] = ok({ id: 'i-1', counts: templateCounts, summary: '' }, 201)
    await user.click(button('1 Vorlage übernehmen'))

    expect(await screen.findByText(/Übernommen: 1 Vorlage mit 2 Punkten übernommen\./)).toBeTruthy()
    expect(bodyOf('/imports/templates')).toEqual({
      sheet: templateFile.sheets[0],
      mapping: templateMapping,
      fileName: 'vorlagen.csv',
      expected: templateCounts,
    })
    expect(screen.getByText(/welche Anlage oder welchen Raum sie meinen/)).toBeTruthy()
    expect(button('Zu den Vorlagen')).toBeTruthy()
  })
})
