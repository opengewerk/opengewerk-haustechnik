import {
  type DeadlineImportRow,
  planChanged,
  type RoleKey,
  type TableFile,
} from '@opengewerk/haustechnik-domain'
import { TestServer } from '@opengewerk/platform-web/testing'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
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
 * The import of running deadlines and old evidence in the office (#130,
 * section 11 of the concept): who may run it, the files chosen beside the
 * table, what the preview shows of the lines, and the one press that sends
 * the files a line names ahead and then takes the list over.
 *
 * What a plan makes of a list is the server's, and the server is a stand in
 * here that answers what the test names. What is held is what the page sends
 * and when it lets somebody go on.
 */

const nord: NamedArea = { id: 'a-nord', name: 'Nord' }
const place = '/pflichten/importieren'

const listFile: TableFile = {
  name: 'fristen-2026.csv',
  sheets: [
    {
      name: '',
      rows: [
        ['Kennzeichen', 'Pflicht', 'Letzter Nachweis', 'Nächste Fälligkeit', 'Datei', 'Prüfer'],
        [
          'FL-031',
          'Prüfung der Feuerlöscher',
          '14.09.2024',
          '30.09.2026',
          'pruefung-2024.pdf',
          'A',
        ],
        ['FL-031', 'Prüfung der Feuerlöscher', '20.09.2022', '', 'pruefung-2022.pdf', 'A'],
      ],
    },
  ],
}
const mapping = { mark: 0, duty: 1, performedOn: 2, nextDueOn: 3, file: 4 }

const evidenceRow: DeadlineImportRow = {
  line: 2,
  asset: { id: 'a-1', number: 'AN-00031', name: 'Feuerlöscher Flur' },
  duty: 'Prüfung der Feuerlöscher',
  becomes: 'evidence',
  confirms: true,
  performedOn: '2024-09-14',
  dueOn: '2026-09-30',
  dueFrom: 'list',
  remark: 'ohne prüfbare Unterschrift',
  file: 'pruefung-2024.pdf',
}
const documentRow: DeadlineImportRow = {
  line: 3,
  asset: { id: 'a-1', number: 'AN-00031', name: 'Feuerlöscher Flur' },
  duty: 'Prüfung der Feuerlöscher',
  becomes: 'document',
  confirms: false,
  performedOn: '2022-09-20',
  dueOn: null,
  dueFrom: 'counted',
  remark: null,
  file: 'pruefung-2022.pdf',
}
const counts = { duties: 1, evidence: 1, documents: 1, known: 0 }
const clean = {
  lines: 2,
  counts,
  problems: [],
  moreProblems: 0,
  notes: [],
  moreNotes: 0,
  rows: [evidenceRow, documentRow],
  moreRows: 0,
  files: ['pruefung-2024.pdf'],
  unusedFiles: 1,
}

let server: TestServer
let written: Written[]
/** What the routes answer a write with, by their path. */
let answers: Record<string, (write: Written) => WriteAnswer>

function ok(body: unknown, status = 200): () => WriteAnswer {
  return () => ({ status, body })
}

async function mount(role: RoleKey, lacking: readonly string[] = []) {
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

  return mountOffice(place, server, [])
}

function button(name: string): HTMLButtonElement {
  return screen.getByRole('button', { name })
}

function pdf(name: string, text = `%PDF-1.7 ${name}`): File {
  return new File([text], name, { type: 'application/pdf' })
}

function chooseFiles(...files: File[]): void {
  fireEvent.change(screen.getByLabelText('Dateien der Liste wählen'), { target: { files } })
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
async function withTheList(role: RoleKey = 'technical_management') {
  const user = userEvent.setup()

  answers['/imports/deadlines/table'] = ok(listFile)
  await mount(role)
  await user.upload(
    await screen.findByLabelText('Datei wählen'),
    new File(['unread by the stand in'], 'fristen-2026.csv', { type: 'text/csv' }),
  )
  await screen.findByRole('table', { name: 'Spalten der Datei und ihre Felder' })

  return user
}

/** As far as the preview the test names, with the two files of the list chosen and one nobody names. */
async function withThePreview(preview: unknown = clean) {
  const user = await withTheList()

  chooseFiles(pdf('pruefung-2024.pdf'), pdf('pruefung-2022.pdf'), pdf('lageplan.pdf'))
  answers['/imports/deadlines/preview'] = ok(preview)
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

describe('the import of running deadlines', () => {
  it('is said to be somebody else’s to whoever does not keep the register of duties', async () => {
    await mount('site_management')
    await untilTheRightsAreKnown()

    expect(
      screen.getByText(
        'Laufende Fristen und alte Nachweise importiert, wer das Pflichtenverzeichnis führt und Nachweise einträgt.',
      ),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Datei wählen' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Weiter zur Vorschau' })).toBeNull()
    expect(written).toEqual([])
  })

  it('is somebody else’s as well to whoever keeps the register and enters no evidence', async () => {
    await mount('technical_management', ['evidence.write'])
    await untilTheRightsAreKnown()

    expect(
      screen.getByText(
        'Laufende Fristen und alte Nachweise importiert, wer das Pflichtenverzeichnis führt und Nachweise einträgt.',
      ),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Datei wählen' })).toBeNull()
  })

  it('asks for the list first, and for its files once the list is read', async () => {
    await mount('technical_management')

    expect(await screen.findByRole('button', { name: 'Datei wählen' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Fristen importieren')
    expect(button('Vorlage herunterladen')).toBeTruthy()
    expect(button('Weiter zur Vorschau').disabled).toBe(true)
    expect(screen.queryByRole('button', { name: 'Dateien wählen' })).toBeNull()
  })

  it('gives every column the field its name says, and no line needs every field', async () => {
    await withTheList()

    expect(rowsOf('Spalten der Datei und ihre Felder').map((row) => row.slice(0, 2))).toEqual([
      ['Kennzeichen', 'FL-031'],
      ['Pflicht', 'Prüfung der Feuerlöscher'],
      ['Letzter Nachweis', '14.09.2024'],
      ['Nächste Fälligkeit', '30.09.2026'],
      ['Datei', 'pruefung-2024.pdf'],
      ['Prüfer', 'A'],
    ])
    expect(button('Dateien wählen')).toBeTruthy()
    expect(screen.getByText('Keine Datei gewählt')).toBeTruthy()
    // A list without a file to it can be looked at all the same.
    expect(button('Weiter zur Vorschau').disabled).toBe(false)
  })

  it('sends the list with the names of the chosen files for the preview, and none of their bytes', async () => {
    await withThePreview()

    expect(bodyOf('/imports/deadlines/preview')).toEqual({
      sheet: listFile.sheets[0],
      mapping,
      files: [
        { name: 'pruefung-2024.pdf' },
        { name: 'pruefung-2022.pdf' },
        { name: 'lageplan.pdf' },
      ],
    })
    expect(server.uploaded.size).toBe(0)
  })

  it('takes no two files of one name, because a line names its file by it', async () => {
    const user = await withTheList()

    chooseFiles(pdf('pruefung-2024.pdf'), pdf('Pruefung-2024.PDF', 'another one'))

    expect(screen.getByRole('alert').textContent).toBe(
      'Die Datei „Pruefung-2024.PDF“ ist zweimal gewählt. Eine Zeile nennt ihre Datei beim Namen, also hat jede ihren eigenen.',
    )
    expect(screen.getByText('Keine Datei gewählt')).toBeTruthy()

    answers['/imports/deadlines/preview'] = ok(clean)
    await user.click(button('Weiter zur Vorschau'))
    await screen.findByRole('list', { name: 'Was die Liste übernehmen würde' })

    expect(bodyOf('/imports/deadlines/preview')['files']).toEqual([])
  })

  it('shows what the list would take over, line by line, each marked as taken over', async () => {
    await withThePreview()

    expect(tiles('Was die Liste übernehmen würde')).toEqual([
      '1Nachweise als Altbestand',
      '1Pflichten werden bestätigt',
      '1Dokumente als Altbestand',
      '0Gibt es schonwerden nicht doppelt übernommen',
    ])
    expect(
      rowsOf(
        'Zeilen der Liste, die übernommen werden, mit Anlage, Pflicht, letztem Nachweis und nächster Fälligkeit',
      ),
    ).toEqual([
      [
        '2',
        'AN-00031Feuerlöscher Flur',
        'Prüfung der Feuerlöscherwird bestätigt',
        '14.09.2024',
        '30.09.2026aus der Liste',
        'Altbestandohne prüfbare Unterschrift',
        'pruefung-2024.pdf',
      ],
      [
        '3',
        'AN-00031Feuerlöscher Flur',
        'Prüfung der Feuerlöscher',
        '20.09.2022',
        '',
        'Altbestandälterer Nachweis, als Dokument',
        'pruefung-2022.pdf',
      ],
    ])
    expect(
      screen.getByText('1 gewählte Datei nennt keine Zeile. Sie wird nicht übernommen.'),
    ).toBeTruthy()
    expect(button('2 Zeilen übernehmen').disabled).toBe(false)
    expect(
      screen.getAllByRole('link', { name: 'AN-00031' }).map((link) => link.getAttribute('href')),
    ).toEqual(['/anlagen/a-1', '/anlagen/a-1'])
  })

  it('shows the lines as boxes on a phone, each with its mark and what its line says', async () => {
    const turn = onA('desktop')

    await withThePreview()
    turn('phone')

    const boxes = await screen.findByRole('list', {
      name: 'Zeilen der Liste, die übernommen werden, mit Anlage, Pflicht, letztem Nachweis und nächster Fälligkeit',
    })

    expect(
      within(boxes)
        .getAllByRole('listitem')
        .map((box) => box.textContent),
    ).toEqual([
      'AN-00031 · Prüfung der FeuerlöscherZeile 2 · 14.09.2024 · fällig 30.09.2026, aus der Liste · pruefung-2024.pdf · Pflicht wird bestätigtAltbestandohne prüfbare Unterschrift',
      'AN-00031 · Prüfung der FeuerlöscherZeile 3 · 20.09.2022 · pruefung-2022.pdfAltbestandälterer Nachweis, als Dokument',
    ])
  })

  it('keeps the button off while a line is open, whatever the other lines would make', async () => {
    await withThePreview({
      ...clean,
      // What the other lines would make is counted all the same; none of it is taken while one is open.
      rows: [],
      files: [],
      problems: [
        {
          lines: [3],
          what: 'Die Datei „fehlt.pdf“ ist nicht gewählt',
          next: 'Im ersten Schritt die Dateien der Liste dazu wählen',
        },
      ],
      notes: [
        {
          lines: [4],
          column: 'Datei',
          why: 'Ein älterer Nachweis ohne Datei wird nicht übernommen: für die Frist zählt der letzte',
        },
      ],
    })

    expect(rowsOf('Zeilen, die vor der Übernahme zu klären sind')).toEqual([
      [
        '3',
        'Die Datei „fehlt.pdf“ ist nicht gewählt',
        'Im ersten Schritt die Dateien der Liste dazu wählen',
      ],
    ])
    expect(rowsOf('Werte der Datei, die nicht übernommen werden')).toEqual([
      [
        '4',
        'Datei',
        'Ein älterer Nachweis ohne Datei wird nicht übernommen: für die Frist zählt der letzte',
      ],
    ])
    expect(button('2 Zeilen übernehmen').disabled).toBe(true)
  })

  it('keeps the button off where the list makes nothing', async () => {
    await withThePreview({
      ...clean,
      counts: { duties: 0, evidence: 0, documents: 0, known: 2 },
      rows: [],
      files: [],
    })

    expect(screen.getByText(/In dieser Liste steht nichts, was es nicht schon gibt\./)).toBeTruthy()
    expect(button('0 Zeilen übernehmen').disabled).toBe(true)
  })

  it('sends the files a line names ahead, then the list with their hashes, and says what was made', async () => {
    const user = await withThePreview()

    answers['/imports/deadlines'] = (write) => {
      const files = (write.body as { files: { name: string; sha256?: string }[] }).files
      // Refused unless the bytes of every file with a hash are on the server by now.
      const ahead = files.every(
        (file) => file.sha256 === undefined || server.uploaded.has(file.sha256),
      )

      return ahead
        ? { status: 201, body: { id: 'i-1', counts, summary: '' } }
        : { status: 409, body: { message: 'Die Datei ist nicht auf dem Server.' } }
    }
    await user.click(button('2 Zeilen übernehmen'))

    expect(
      await screen.findByText(
        'Übernommen: 1 Nachweis als Altbestand übernommen, 1 Pflicht bestätigt, 1 Dokument als Altbestand abgelegt. Der Import steht im Änderungsprotokoll, und jede Pflicht, jeder Nachweis und jedes Dokument mit einem eigenen Eintrag.',
      ),
    ).toBeTruthy()

    const body = bodyOf('/imports/deadlines')
    const [named] = body['files'] as { name: string; sha256: string; sizeBytes: number }[]

    expect(body).toEqual({
      sheet: listFile.sheets[0],
      mapping,
      files: [
        {
          name: 'pruefung-2024.pdf',
          sha256: expect.stringMatching(/^[0-9a-f]{64}$/) as string,
          sizeBytes: 26,
          previewSha256: null,
        },
        // Chosen and named by no line that is taken over: by its name, and its bytes stay here.
        { name: 'pruefung-2022.pdf' },
        { name: 'lageplan.pdf' },
      ],
      fileName: 'fristen-2026.csv',
      expected: counts,
    })
    expect([...server.uploaded.keys()]).toEqual([named?.sha256])
    expect(tiles('Was der Import übernommen hat')).toEqual([
      '1Nachweise als Altbestand',
      '1Pflichten bestätigt',
      '1Dokumente als Altbestand',
      '0Gab es schonnicht doppelt übernommen',
    ])
  })

  it('says what the server refuses, and stays on the preview', async () => {
    const user = await withThePreview({ ...clean, files: [] })

    answers['/imports/deadlines'] = () => ({ status: 409, body: { message: planChanged } })
    await user.click(button('2 Zeilen übernehmen'))

    expect(await screen.findByText(planChanged)).toBeTruthy()
    await waitFor(() => {
      expect(button('2 Zeilen übernehmen').disabled).toBe(false)
    })
    expect(server.uploaded.size).toBe(0)
  })
})
