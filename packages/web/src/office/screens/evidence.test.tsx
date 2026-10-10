import type {
  DutyDetails,
  EvidencePage,
  EvidenceState,
  RoleKey,
} from '@opengewerk/haustechnik-domain'
import { moment } from '@opengewerk/platform-web/format'
import { TestServer } from '@opengewerk/platform-web/testing'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { servingCatalogue } from '../../app/test-catalogue.js'
import { pdfWords } from '../pdf-button.js'
import {
  mountOffice,
  type NamedArea,
  noRenderer,
  onA,
  rowsOf,
  servingPdf,
  signedInOffice,
  type WriteAnswer,
  type Written,
} from '../test-office.js'

/**
 * The page of an evidence in the office and its two dialogs (#109, 2.6 of
 * the concept, ADR 0004, points 14 and 15): the page shows the frozen state
 * as the server hands it out, the signatures, the fingerprint and what
 * became of the evidence; correcting and declaring invalid are offered to
 * whoever enters evidence and only while neither happened; each dialog sends
 * what it says to its route and nothing without a reason.
 */

const sued: NamedArea = { id: 'a-sued', name: 'Süd' }

const school = {
  id: 'p-school',
  areaId: sued.id,
  name: 'Schulzentrum Am Lindenhain',
  street: 'Am Lindenhain 7',
  postalCode: '00003',
  city: 'Musterhausen',
  federalState: 'DE-BW',
  note: null,
}
const place = { propertyId: school.id, areaId: sued.id }
const house = { id: 'b-house', ...place, name: 'Schulhaus', kinds: '["school"]', yearBuilt: 1975 }
const ground = { id: 'f-ground', ...place, buildingId: house.id, name: 'Erdgeschoss', level: 0 }
const boilerRoom = {
  id: 'r-boiler',
  ...place,
  buildingId: house.id,
  floorId: ground.id,
  number: 'E.14',
  name: 'Heizraum',
  use: 'Haustechnik',
}
const heater = {
  id: 'a-heater',
  ...place,
  buildingId: house.id,
  roomId: boilerRoom.id,
  kind: 'probe.elevator',
  number: 'AN-00057',
  name: 'Trinkwassererwärmer',
}

const everything = ['properties', 'buildings', 'floors', 'rooms', 'assets', 'duties'] as const

/** The point of a round, signed and countersigned, with a defect. */
function frozen(further: Partial<EvidenceState> = {}): EvidenceState {
  return {
    version: 2,
    number: 'NW-2026-00131',
    origin: 'round_point',
    performedOn: '2026-10-01',
    result: 'with_defects',
    resultReason: null,
    replaces: null,
    duty: {
      label: 'Temperatur am Speicheraustritt',
      kind: null,
      kindVersion: null,
      source: 'Eigene Festlegung, nach DVGW-Arbeitsblatt W 551',
      interval: { days: 7 },
      counting: 'from_performance',
    },
    place: {
      property: {
        name: 'Schulzentrum Am Lindenhain',
        address: 'Am Lindenhain 7, 00003 Musterhausen',
      },
      building: { name: 'Schulhaus', shortCode: null },
      room: { number: 'E.14', name: 'Heizraum' },
      asset: {
        number: 'AN-00057',
        name: 'Trinkwassererwärmer',
        kind: 'probe.elevator',
        kindLabel: 'Trinkwassererwärmung',
        serialNumber: 'BT-750-22-0193',
      },
    },
    activity: { kind: 'round', title: 'Technikzentrale Schulhaus, Woche 40' },
    performer: { person: 'Tobias Wendt' },
    defects: [
      {
        description: 'Warmwasser am Speicheraustritt 55,5 °C',
        defectClass: 'erheblich',
        dueOn: '2026-10-19',
      },
    ],
    signatures: [
      {
        name: 'Tobias Wendt',
        role: 'signer',
        signedAt: '2026-10-01T05:42:00.000Z',
        path: 'M10,10L200,300',
        way: 'drawing',
      },
      // Countersigned with the typed name (#209).
      {
        name: 'Dennis Roth',
        role: 'countersigner',
        signedAt: '2026-10-02T06:15:00.000Z',
        path: null,
        way: 'name',
      },
    ],
    files: [],
    retention: { kind: 'until_next_inspection', on: '2026-10-01' },
    writtenBy: 'Dennis Roth',
    writtenAt: '2026-10-02T06:15:00.000Z',
    ...further,
  } as EvidenceState
}

function evidence(further: Readonly<Record<string, unknown>> = {}): EvidencePage {
  return {
    id: 'e-131',
    number: 'NW-2026-00131',
    dutyId: 'd-1',
    place: {
      propertyId: school.id,
      buildingId: house.id,
      roomId: boilerRoom.id,
      assetId: heater.id,
    },
    state: frozen(),
    fingerprint: 'f'.repeat(64),
    standing: 'counts',
    replaces: null,
    replacedBy: null,
    voiding: null,
    ...further,
  } as EvidencePage
}

/** A report of an examiner, entered and corrected nowhere yet. */
const reported = evidence({
  id: 'e-144',
  number: 'NW-2026-00144',
  state: frozen({
    number: 'NW-2026-00144',
    origin: 'report',
    performedOn: '2026-10-02',
    activity: null,
    performer: { examiner: 'Klaus Berger', organisation: 'Brandschutz Beispiel GmbH' },
    defects: [],
    signatures: [],
    files: [
      { sha256: 'a'.repeat(64), name: 'pruefbericht-2026-10.pdf', mediaType: 'application/pdf' },
    ],
  }),
})

const theDuty = {
  id: 'd-1',
  title: 'Temperatur am Speicheraustritt',
  state: 'met',
  appointment: { dueOn: '2026-10-08', onTimeUntil: '2026-10-08' },
  lastMetOn: '2026-10-01',
} as unknown as DutyDetails

let server: TestServer
let written: Written[]
let answerToWrite: (write: Written) => WriteAnswer

const answering =
  (body: unknown, status = 200) =>
  (): WriteAnswer => ({ status, body })

async function opened(role: RoleKey, page: EvidencePage = evidence()) {
  written = signedInOffice(
    role,
    [sued],
    { ...servingCatalogue(), [`/evidence/${page.id}`]: page, '/duties/d-1': theDuty },
    (write) => answerToWrite(write),
  )

  const mounted = await mountOffice(`/nachweise/${page.id}`, server, everything)

  await screen.findByRole('heading', { level: 1, name: page.state.duty.label })

  return mounted
}

/** What stands beside the title in the head of the page. */
function head(): string {
  return screen.getByRole('heading', { level: 1 }).parentElement?.parentElement?.textContent ?? ''
}

/** The facts of one card, by their names. */
function factsIn(card: string): Readonly<Record<string, string | undefined>> {
  const region = screen.getByRole('region', { name: card })
  const values = within(region).getAllByRole('definition')

  return Object.fromEntries(
    within(region)
      .getAllByRole('term')
      .map((term, index) => [term.textContent, values[index]?.textContent]),
  )
}

const leadsTo = (name: string) => screen.getByRole('link', { name }).getAttribute('href')

beforeEach(() => {
  localStorage.clear()
  onA('desktop')
  server = new TestServer()
  server.put('properties', school)
  server.put('buildings', house)
  server.put('floors', ground)
  server.put('rooms', boilerRoom)
  server.put('assets', heater)
  answerToWrite = answering({ message: 'Dieser Test hat keinen Schreibzugriff erwartet.' }, 500)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the page of an evidence', () => {
  it('shows the frozen state, the signatures and the fingerprint, under the path to its asset', async () => {
    await opened('technician')

    expect(head()).toContain('NW-2026-00131')
    expect(head()).toContain('Festgeschrieben')
    expect(head()).toContain('Mit Mängeln')
    expect(factsIn('Eingefrorener Stand, Fassung 2')).toEqual({
      Nummer: 'NW-2026-00131',
      Herkunft: 'Punkt eines Rundgangs: Technikzentrale Schulhaus, Woche 40',
      Pflicht: 'Temperatur am Speicheraustritt',
      Quelle: 'Eigene Festlegung, nach DVGW-Arbeitsblatt W 551',
      Frist: '7 Tage, ab dem Tag der Durchführung',
      Ort: 'Schulzentrum Am Lindenhain, Am Lindenhain 7, 00003 Musterhausen; Schulhaus; E.14 Heizraum',
      Anlage: 'AN-00057 Trinkwassererwärmer, Trinkwassererwärmung, Seriennummer BT-750-22-0193',
      Durchgeführt: 'am 01.10.2026 von Tobias Wendt',
      Ergebnis: 'Mit Mängeln',
      Aufbewahrung: 'Mindestens bis zur nächsten Prüfung',
    })

    const signatures = screen.getByRole('region', { name: 'Unterschriften' }).textContent ?? ''

    // The hour is the one of the clock the test runs on, which the CI keeps in UTC.
    expect(signatures).toMatch(/UnterschriftTobias Wendt01\.10\.2026, \d\d:\d\dGegen/)
    // The evidence says which way somebody signed (#209).
    expect(signatures).toMatch(
      /GegenzeichnungDennis Roth02\.10\.2026, \d\d:\d\d, mit getipptem Namen bestätigt/,
    )
    expect(screen.getByText('f'.repeat(64))).toBeTruthy()
    expect(screen.getByText('Warmwasser am Speicheraustritt 55,5 °C')).toBeTruthy()
    expect(screen.getByText('erheblich · Frist 19.10.2026')).toBeTruthy()
    await waitFor(() => {
      expect(factsIn('Für die Frist')).toEqual({
        Dieser: 'Zählt',
        'Termin jetzt': '08.10.2026',
        'Gezählt ab': '01.10.2026',
      })
    })
    expect(
      within(screen.getByRole('region', { name: 'Eingefrorener Stand, Fassung 2' }))
        .getByRole('link', { name: 'Temperatur am Speicheraustritt' })
        .getAttribute('href'),
    ).toBe('/pflichten/d-1')
    expect(
      within(screen.getByRole('navigation', { name: 'Pfad' }))
        .getAllByRole('link')
        .map((link) => `${link.textContent} > ${link.getAttribute('href') ?? ''}`),
    ).toEqual([
      'Liegenschaften > /liegenschaften',
      'Schulzentrum Am Lindenhain > /liegenschaften/p-school',
      'Schulhaus > /gebaeude/b-house',
      'Erdgeschoss > /geschosse/f-ground',
      'E.14 Heizraum > /raeume/r-boiler',
      'Trinkwassererwärmer > /anlagen/a-heater',
    ])
  })

  it('shows a report with its examiner and the files it rests on', async () => {
    await opened('site_management', reported)

    expect(factsIn('Eingefrorener Stand, Fassung 2')).toMatchObject({
      Herkunft: 'Bericht einer Fremdfirma oder Prüforganisation',
      Geprüft: 'am 02.10.2026 von Klaus Berger, Brandschutz Beispiel GmbH',
      Belege: 'pruefbericht-2026-10.pdf',
    })
    expect(screen.queryByRole('region', { name: 'Unterschriften' })).toBeNull()
    // The evidence hands out its file itself, by its place among the files.
    expect(leadsTo('pruefbericht-2026-10.pdf')).toBe('/evidence/e-144/files/0')
  })

  it('names the class of a defect by its word in the catalogue', async () => {
    await opened(
      'technician',
      evidence({
        state: frozen({
          defects: [{ description: 'Plombe beschädigt', defectClass: 'probe.slight', dueOn: null }],
        }),
      }),
    )

    expect(await screen.findByText('leicht')).toBeTruthy()
  })

  it.each(['management', 'technical_management', 'site_management'] as const)(
    'offers correcting and declaring invalid to whoever enters evidence: "%s"',
    async (role) => {
      await opened(role)

      expect(screen.getByRole('button', { name: 'Berichtigen' })).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Für ungültig erklären' })).toBeTruthy()
    },
  )

  it('opens the PDF of its frozen state in a tab of its own, for every role (#111)', async () => {
    await opened('technician')

    const pdf = servingPdf()

    fireEvent.click(screen.getByRole('button', { name: pdfWords.open }))

    await waitFor(() => {
      expect(pdf.opened).toEqual(['blob:probe'])
    })
    expect(pdf.asked).toEqual([`/evidence/${evidence().id}/pdf`])
  })

  it('says why there is no PDF where the instance makes none, and stays as it is', async () => {
    await opened('management')
    servingPdf(noRenderer)

    fireEvent.click(screen.getByRole('button', { name: pdfWords.open }))

    expect(await screen.findByText(noRenderer)).toBeDefined()
    expect(screen.getByRole('button', { name: pdfWords.open })).toBeDefined()
  })

  it('offers neither to the Haustechnik', async () => {
    await opened('technician')

    expect(screen.queryByRole('button', { name: 'Berichtigen' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Für ungültig erklären' })).toBeNull()
  })

  it('says who declared it invalid, when and why, shows its course, and offers nothing more', async () => {
    const voidedAt = '2026-10-03T08:05:00.000Z'

    await opened(
      'management',
      evidence({
        standing: 'voided',
        voiding: {
          reason: 'Der Rundgang wurde im falschen Gebäude unterschrieben.',
          voidedBy: 'Dennis Roth',
          voidedAt,
        },
      }),
    )

    expect(head()).toContain('Für ungültig erklärt')
    expect(head()).not.toContain('Festgeschrieben')
    // In the time zone of the device, as every moment the office shows.
    expect(
      screen.getByText(new RegExp(`Für ungültig erklärt am ${moment(voidedAt)} von Dennis Roth`))
        .textContent,
    ).toContain('Grund: Der Rundgang wurde im falschen Gebäude unterschrieben.')
    expect(
      rowsOf('Verlauf des Nachweises: Unterschriften, Festschreibung und Ungültigerklärung'),
    ).toEqual([
      [moment('2026-10-01T05:42:00.000Z'), 'Unterschrift', 'Tobias Wendt'],
      [moment('2026-10-02T06:15:00.000Z'), 'Gegenzeichnung', 'Dennis Roth'],
      [moment('2026-10-02T06:15:00.000Z'), 'Festgeschrieben', 'Dennis Roth'],
      [moment(voidedAt), 'Für ungültig erklärt, mit Grund', 'Dennis Roth'],
    ])
    expect(screen.queryByRole('button', { name: 'Berichtigen' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Für ungültig erklären' })).toBeNull()
  })

  it('leads from a replaced evidence to its correction and back, and offers nothing on the replaced one', async () => {
    await opened(
      'management',
      evidence({
        standing: 'replaced',
        replacedBy: { id: 'e-150', number: 'NW-2026-00150' },
      }),
    )

    expect(head()).toContain('Ersetzt')
    expect(leadsTo('NW-2026-00150')).toBe('/nachweise/e-150')
    expect(screen.queryByRole('button', { name: 'Berichtigen' })).toBeNull()
  })

  it('names the evidence a correction replaces, with the reason, and where its signatures are', async () => {
    await opened(
      'management',
      evidence({
        id: 'e-150',
        number: 'NW-2026-00150',
        replaces: { id: 'e-131', number: 'NW-2026-00131' },
        state: frozen({
          number: 'NW-2026-00150',
          replaces: { number: 'NW-2026-00131', reason: 'Falscher Tag eingetragen.' },
          signatures: [],
        }),
      }),
    )

    expect(factsIn('Eingefrorener Stand, Fassung 2')['Berichtigt']).toBe(
      'NW-2026-00131: Falscher Tag eingetragen.',
    )
    expect(leadsTo('NW-2026-00131')).toBe('/nachweise/e-131')
    expect(screen.getByRole('region', { name: 'Unterschriften' }).textContent).toBe(
      'UnterschriftenDie Unterschriften stehen am Nachweis, den diese Berichtigung ersetzt.',
    )
  })

  it('says nothing of signatures at the correction of a report, which never had any', async () => {
    await opened(
      'management',
      evidence({
        ...reported,
        id: 'e-151',
        replaces: { id: 'e-144', number: 'NW-2026-00144' },
        state: {
          ...reported.state,
          replaces: { number: 'NW-2026-00144', reason: 'Falscher Tag.' },
        },
      }),
    )

    expect(factsIn('Eingefrorener Stand, Fassung 2')['Berichtigt']).toBe(
      'NW-2026-00144: Falscher Tag.',
    )
    expect(screen.queryByRole('region', { name: 'Unterschriften' })).toBeNull()
  })

  it('says so of an evidence that is not there', async () => {
    signedInOffice('management', [sued], servingCatalogue(), (write) => answerToWrite(write))
    await mountOffice('/nachweise/e-gone', server, everything)

    expect(
      await screen.findByText(
        'Diesen Nachweis gibt es nicht, oder er liegt in einem Bereich, den dieser Zugang nicht sieht.',
      ),
    ).toBeTruthy()
  })
})

describe('the dialog that corrects an evidence', () => {
  async function asking(page: EvidencePage = reported) {
    const mounted = await opened('site_management', page)

    fireEvent.click(screen.getByRole('button', { name: 'Berichtigen' }))

    return {
      ...mounted,
      dialog: within(await screen.findByRole('dialog', { name: 'Nachweis berichtigen' })),
    }
  }

  const fix = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Berichtigung festschreiben' }))
  }

  it('starts with the day, the result and the examiner of the evidence, and says what comes about', async () => {
    const { dialog } = await asking()

    expect(screen.getByLabelText<HTMLInputElement>('Tag der Durchführung').value).toBe('2026-10-02')
    expect(screen.getByLabelText<HTMLSelectElement>('Ergebnis').value).toBe('with_defects')
    expect(screen.getByLabelText<HTMLInputElement>('Prüfer').value).toBe('Klaus Berger')
    expect(screen.getByLabelText<HTMLInputElement>('Organisation').value).toBe(
      'Brandschutz Beispiel GmbH',
    )
    expect(
      dialog.getByText(/Es entsteht ein neuer Nachweis, der NW-2026-00144 ersetzt/),
    ).toBeTruthy()
  })

  it('sends the reason and the corrected state to the route, and opens the new evidence', async () => {
    const { router } = await asking()

    answerToWrite = answering({ id: 'e-150', number: 'NW-2026-00150' }, 201)
    fireEvent.change(screen.getByLabelText('Was falsch ist'), {
      target: { value: ' Im Bericht steht der 01.10.2026. ' },
    })
    fireEvent.change(screen.getByLabelText('Tag der Durchführung'), {
      target: { value: '2026-10-01' },
    })
    fireEvent.change(screen.getByLabelText('Organisation'), {
      target: { value: 'Brandschutz Muster GmbH' },
    })
    fix()

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/nachweise/e-150')
    })
    expect(written).toEqual([
      {
        method: 'POST',
        path: '/evidence/e-144/correction',
        body: {
          reason: 'Im Bericht steht der 01.10.2026.',
          performedOn: '2026-10-01',
          result: 'with_defects',
          resultReason: null,
          examiner: 'Klaus Berger',
          examinerOrganisation: 'Brandschutz Muster GmbH',
        },
      },
    ])
  })

  it('asks for no examiner where the evidence is no report, and for the reason of what was not performed', async () => {
    await asking(evidence())

    expect(screen.queryByLabelText('Prüfer')).toBeNull()

    answerToWrite = answering({ id: 'e-151', number: 'NW-2026-00151' }, 201)
    fireEvent.change(screen.getByLabelText('Was falsch ist'), {
      target: { value: 'Der Punkt wurde nicht gemessen.' },
    })
    fireEvent.change(screen.getByLabelText('Ergebnis'), { target: { value: 'not_performed' } })
    fix()

    expect(await screen.findByText('Was nicht durchgeführt wurde, nennt den Grund.')).toBeTruthy()
    expect(written).toEqual([])

    fireEvent.change(screen.getByLabelText('Warum nicht durchgeführt'), {
      target: { value: 'Heizraum war verschlossen.' },
    })
    fix()

    await waitFor(() => {
      expect(written).toEqual([
        {
          method: 'POST',
          path: '/evidence/e-131/correction',
          body: {
            reason: 'Der Punkt wurde nicht gemessen.',
            performedOn: '2026-10-01',
            result: 'not_performed',
            resultReason: 'Heizraum war verschlossen.',
            examiner: null,
            examinerOrganisation: null,
          },
        },
      ])
    })
  })

  it('is not sent without a reason, or for a day to come, and says so', async () => {
    const { dialog } = await asking()

    fireEvent.change(screen.getByLabelText('Tag der Durchführung'), {
      target: { value: '2999-01-01' },
    })
    fix()

    expect(await dialog.findByText('Eine Berichtigung nennt ihren Grund.')).toBeTruthy()
    expect(dialog.getByText('Ein Nachweis gilt für einen Tag, der schon war.')).toBeTruthy()
    expect(written).toEqual([])
  })

  it('shows what the server refuses with, and keeps the dialog open', async () => {
    await asking()

    answerToWrite = answering(
      {
        message:
          'Dieser Nachweis ist schon berichtigt, mit NW-2026-00150; berichtigt wird dann die Berichtigung.',
      },
      409,
    )
    fireEvent.change(screen.getByLabelText('Was falsch ist'), {
      target: { value: 'Falscher Tag.' },
    })
    fix()

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Dieser Nachweis ist schon berichtigt, mit NW-2026-00150; berichtigt wird dann die Berichtigung.',
    )
    expect(screen.getByRole('dialog')).toBeTruthy()
  })
})

describe('the dialog that declares an evidence invalid', () => {
  async function asking() {
    await opened('technical_management')
    fireEvent.click(screen.getByRole('button', { name: 'Für ungültig erklären' }))

    return within(await screen.findByRole('dialog', { name: 'Nachweis für ungültig erklären' }))
  }

  const declare = (dialog: ReturnType<typeof within>) => {
    fireEvent.click(dialog.getByRole('button', { name: 'Für ungültig erklären' }))
  }

  it('sends the reason to the route, and reads the page again', async () => {
    const dialog = await asking()
    const reads: string[] = []
    const answer = globalThis.fetch

    vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'GET') {
        reads.push(path)
      }

      return answer(path, init)
    })
    answerToWrite = answering({ id: 'e-131', number: 'NW-2026-00131' }, 201)
    fireEvent.change(screen.getByLabelText('Grund'), {
      target: { value: ' Die Werte gehören zur Mensa. ' },
    })
    declare(dialog)

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    expect(written).toEqual([
      {
        method: 'POST',
        path: '/evidence/e-131/voiding',
        body: { reason: 'Die Werte gehören zur Mensa.' },
      },
    ])
    await waitFor(() => {
      expect(reads).toContain('/evidence/e-131')
    })
  })

  it('is not sent without a reason, and says what it does before', async () => {
    const dialog = await asking()

    expect(dialog.getByText(/Zurücknehmen lässt sich das nicht/)).toBeTruthy()

    declare(dialog)

    expect(await dialog.findByText('Eine Ungültigerklärung nennt ihren Grund.')).toBeTruthy()
    expect(written).toEqual([])
  })
})
