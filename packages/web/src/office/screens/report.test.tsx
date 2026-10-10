import type {
  ActivityDetails,
  DutyDetails,
  DutyEvidenceEntry,
  RoleKey,
} from '@opengewerk/haustechnik-domain'
import { TestServer } from '@opengewerk/platform-web/testing'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { servingCatalogue } from '../../app/test-catalogue.js'
import {
  mountOffice,
  type NamedArea,
  onA,
  signedInOffice,
  untilTheRightsAreKnown,
  type WriteAnswer,
  type Written,
} from '../test-office.js'

/**
 * The report of a contractor entered in the office (#110, section 4.4 of the
 * concept): the form sends the file ahead and then the report that names it,
 * with the examiner, the day, the result and the defects a result with
 * defects names; it sends nothing while something is wrong; and the way to it
 * from the duty and from the inspection is offered to whoever enters evidence
 * and not to whoever only performs.
 */

const sued: NamedArea = { id: 'a-sued', name: 'Süd' }

const office = {
  id: 'p-office',
  areaId: sued.id,
  name: 'Verwaltung Am Probehang',
  street: 'Am Probehang 1',
  postalCode: '00001',
  city: 'Musterhausen',
  federalState: 'DE-BW',
  note: null,
}
const place = { propertyId: office.id, areaId: sued.id }
const house = { id: 'b-house', ...place, name: 'Haus A', kinds: '["office"]', yearBuilt: 1990 }
const extinguisher = {
  id: 'a-fire',
  ...place,
  buildingId: house.id,
  roomId: null,
  kind: 'probe.elevator',
  number: 'AN-00031',
  name: 'Feuerlöscher EG, Flur',
}

const everything = ['properties', 'buildings', 'floors', 'rooms', 'assets', 'duties'] as const

/** A duty of the operator's own at the extinguisher, tested by a contractor every 24 months. */
function dutyOf(further: Partial<DutyDetails> = {}): DutyDetails {
  return {
    id: 'd-fire',
    ...place,
    buildingId: null,
    roomId: null,
    assetId: extinguisher.id,
    kind: null,
    kindVersion: null,
    label: 'Prüfung der Feuerlöscher',
    basis: 'insurer',
    sourceNote: 'ASR A2.2',
    task: 'inspection',
    counting: 'from_performance',
    intervalMonths: 24,
    intervalDays: null,
    performer: 'contractor',
    performerNote: 'Brandschutz Beispiel GmbH',
    endsOn: null,
    title: 'Prüfung der Feuerlöscher',
    state: 'overdue',
    appointment: { dueOn: '2026-09-30', onTimeUntil: '2026-09-30' },
    lastMetOn: '2024-09-30',
    ended: false,
    removable: false,
    asset: {
      id: extinguisher.id,
      number: extinguisher.number,
      name: extinguisher.name,
      kind: extinguisher.kind,
      buildingId: house.id,
      roomId: null,
    },
    responsible: null,
    activity: null,
    ...further,
  } as unknown as DutyDetails
}

const lastTime: DutyEvidenceEntry[] = [
  {
    id: 'e-100',
    number: 'NW-2024-00100',
    performedOn: '2024-09-30',
    result: 'without_defects',
    origin: 'report',
    standing: 'counts',
  } as DutyEvidenceEntry,
]

/** A file of a report, as somebody chooses it. */
function scan(): File {
  return new File(['%PDF-1.7 Prüfbericht'], 'pruefbericht-feuerloescher-2026-10.pdf', {
    type: 'application/pdf',
  })
}

let server: TestServer
let written: Written[]
let answerToWrite: (write: Written) => WriteAnswer

async function opened(role: RoleKey, duty: DutyDetails = dutyOf()) {
  written = signedInOffice(
    role,
    [sued],
    {
      ...servingCatalogue(),
      [`/duties/${duty.id}`]: duty,
      [`/duties/${duty.id}/evidence`]: lastTime,
    },
    (write) => answerToWrite(write),
  )

  const mounted = await mountOffice(`/nachweise/bericht/${duty.id}`, server, everything)

  await screen.findByRole('heading', { level: 1, name: 'Bericht eintragen' })
  await untilTheRightsAreKnown()

  return mounted
}

/** Fills in what every report says, with the file. */
function filledIn() {
  fireEvent.change(screen.getByLabelText('Datei wählen'), { target: { files: [scan()] } })
  fireEvent.change(screen.getByRole('textbox', { name: /^Prüfer/ }), {
    target: { value: 'Klaus Berger' },
  })
  fireEvent.change(screen.getByLabelText(/^Tag der Durchführung/), {
    target: { value: '2026-10-02' },
  })
}

function saved() {
  fireEvent.click(screen.getByRole('button', { name: 'Nachweis festschreiben' }))
}

beforeEach(() => {
  localStorage.clear()
  onA('desktop')
  server = new TestServer()
  server.put('properties', office)
  server.put('buildings', house)
  server.put('assets', extinguisher)
  answerToWrite = () => ({ status: 201, body: { id: 'e-new', number: 'NW-2026-00145' } })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the form of a report', () => {
  it('sends the file ahead, then the report that names it, and opens the evidence it became', async () => {
    // A duty of a kind of the probe, whose package names classes of its own
    // (#116); a duty of the operator's own takes the general ones.
    const { router } = await opened(
      'site_management',
      dutyOf({ kind: 'probe.elevator_main_test', kindVersion: 1, label: null }),
    )

    // The server finds the file only if it arrived before the report did.
    answerToWrite = (write) =>
      server.uploaded.has((write.body as { file: { sha256: string } }).file.sha256)
        ? { status: 201, body: { id: 'e-new', number: 'NW-2026-00145' } }
        : { status: 409, body: { message: 'Die Datei des Berichts ist nicht auf dem Server.' } }
    filledIn()
    expect(screen.getByRole('textbox', { name: /^Organisation/ })).toHaveProperty(
      'value',
      'Brandschutz Beispiel GmbH',
    )
    fireEvent.click(screen.getByRole('radio', { name: 'Mit Mängeln' }))

    const defect = screen.getByRole('group', { name: 'Mangel 1' })

    fireEvent.change(within(defect).getByRole('textbox', { name: /^Beschreibung/ }), {
      target: { value: 'Wandhalterung locker' },
    })
    // The classes of the package of the duty kind come with the catalogue of the device.
    await within(defect).findByRole('option', { name: 'leicht' })
    fireEvent.change(within(defect).getByRole('combobox', { name: 'Klasse' }), {
      target: { value: 'probe.slight' },
    })
    fireEvent.change(within(defect).getByLabelText('Frist zur Beseitigung'), {
      target: { value: '2026-10-16' },
    })
    saved()

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/nachweise/e-new')
    })
    expect(written).toEqual([
      {
        method: 'POST',
        path: '/duties/d-fire/report',
        body: {
          performedOn: '2026-10-02',
          result: 'with_defects',
          resultReason: null,
          examiner: 'Klaus Berger',
          examinerOrganisation: 'Brandschutz Beispiel GmbH',
          defects: [
            {
              description: 'Wandhalterung locker',
              defectClass: 'probe.slight',
              dueOn: '2026-10-16',
            },
          ],
          file: {
            sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
            fileName: 'pruefbericht-feuerloescher-2026-10.pdf',
            sizeBytes: new Blob(['%PDF-1.7 Prüfbericht']).size,
            previewSha256: null,
          },
        },
      },
    ])

    const named = (written[0]?.body as { file: { sha256: string } }).file.sha256

    expect([...server.uploaded.keys()]).toEqual([named])
  })

  it('names no defect for a result without them, and the reason for one not performed', async () => {
    await opened('technical_management')

    filledIn()
    fireEvent.click(screen.getByRole('radio', { name: 'Mit Mängeln' }))
    fireEvent.change(screen.getByRole('textbox', { name: /^Beschreibung/ }), {
      target: { value: 'Wandhalterung locker' },
    })
    fireEvent.click(screen.getByRole('radio', { name: 'Nicht durchgeführt' }))
    expect(screen.queryByRole('region', { name: 'Mängel aus dem Bericht' })).toBeNull()
    fireEvent.change(screen.getByRole('textbox', { name: /^Warum nicht durchgeführt/ }), {
      target: { value: 'Der Raum war verschlossen.' },
    })
    saved()

    await waitFor(() => {
      expect(written).toHaveLength(1)
    })
    expect(written[0]?.body).toMatchObject({
      result: 'not_performed',
      resultReason: 'Der Raum war verschlossen.',
      defects: [],
    })
  })

  it('sends nothing while something is wrong, and says what', async () => {
    await opened('site_management')

    fireEvent.click(screen.getByRole('radio', { name: 'Mit Mängeln' }))
    fireEvent.click(screen.getByRole('button', { name: 'Mangel 1 entfernen' }))
    saved()

    expect(await screen.findByText('Der Bericht oder die Prüfbescheinigung fehlt.')).toBeTruthy()
    expect(screen.getByText('Ein Bericht nennt den Prüfer.')).toBeTruthy()
    expect(screen.getByText('Der Tag der Durchführung fehlt.')).toBeTruthy()
    expect(
      screen.getByText('Mit Mängeln heißt, der Bericht nennt mindestens einen Mangel.'),
    ).toBeTruthy()
    expect(written).toEqual([])

    // With its file chosen, what else is wrong still holds it back, and the
    // file does not go up either.
    fireEvent.change(screen.getByLabelText('Datei wählen'), { target: { files: [scan()] } })
    saved()

    await waitFor(() => {
      expect(screen.queryByText('Der Bericht oder die Prüfbescheinigung fehlt.')).toBeNull()
    })
    expect(screen.getByText('Ein Bericht nennt den Prüfer.')).toBeTruthy()
    // Long enough for a file to go up and a report to follow, were they sent.
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(written).toEqual([])
    expect(server.uploaded.size).toBe(0)
  })

  it('shows what the server refuses, and stays', async () => {
    const { router } = await opened('management')

    answerToWrite = () => ({
      status: 409,
      body: { message: 'Für diese Pflicht hat jemand eine Prüfung begonnen.' },
    })
    filledIn()
    saved()

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Für diese Pflicht hat jemand eine Prüfung begonnen.',
    )
    expect(router.state.location.pathname).toBe('/nachweise/bericht/d-fire')
  })

  it('says where the due day goes from the day of the test', async () => {
    await opened('site_management')

    fireEvent.change(screen.getByLabelText(/^Tag der Durchführung/), {
      target: { value: '2026-10-02' },
    })

    expect(document.body.textContent).toContain(
      'Der Termin rückt auf den 02.10.2028, ab dem Tag der Durchführung.',
    )

    fireEvent.click(screen.getByRole('radio', { name: 'Nicht bestanden' }))

    expect(document.body.textContent).toContain('Am Termin ändert sich nichts.')
  })

  it('is not for whoever only performs', async () => {
    await opened('technician')

    expect(screen.getByText('Einen Bericht trägt ein, wer Nachweise eintragen darf.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Nachweis festschreiben' })).toBeNull()
  })

  it('is not for a duty whose kind takes no report', async () => {
    await opened('management', dutyOf({ kind: 'probe.interim_check', kindVersion: 1, label: null }))

    expect(
      await screen.findByText('Diese Pflichtart nimmt keinen Bericht als Nachweis.'),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Nachweis festschreiben' })).toBeNull()
  })
})

describe('the way to a report', () => {
  it.each([
    ['site_management', true],
    ['technician', false],
  ] as const)('stands on the page of a duty for "%s": %s', async (role, offered) => {
    const duty = dutyOf()

    signedInOffice(role, [sued], {
      ...servingCatalogue(),
      [`/duties/${duty.id}`]: duty,
      [`/duties/${duty.id}/evidence`]: lastTime,
    })

    const { router } = await mountOffice(`/pflichten/${duty.id}`, server, everything)

    await screen.findByRole('heading', { level: 1, name: duty.title })
    await untilTheRightsAreKnown()

    const button = screen.queryByRole('button', { name: 'Bericht eintragen' })

    expect(button !== null).toBe(offered)

    if (button) {
      fireEvent.click(button)
      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/nachweise/bericht/d-fire')
      })
    }
  })

  /** An inspection a contractor performs, for the duty, open. */
  function inspection(further: Partial<ActivityDetails> = {}): ActivityDetails {
    return {
      id: 'v-fire',
      kind: 'inspection',
      title: 'Prüfung der Feuerlöscher',
      status: 'open',
      dueOn: '2026-09-30',
      ...place,
      buildingId: null,
      roomId: null,
      assetId: extinguisher.id,
      responsible: null,
      performer: 'contractor',
      performerPerson: null,
      contractorNote: 'Brandschutz Beispiel GmbH',
      createdAt: '2026-08-31T06:00:00.000Z',
      performedOn: null,
      closingReason: null,
      duties: [
        {
          id: 'ad-fire',
          dutyId: 'd-fire',
          title: 'Prüfung der Feuerlöscher',
          source: 'ASR A2.2',
          interval: { months: 24 },
          state: 'overdue',
          appointment: '2026-09-30',
          lastMetOn: '2024-09-30',
          qualification: null,
          takesReport: true,
          result: null,
          resultReason: null,
        },
      ],
      ...further,
    } as unknown as ActivityDetails
  }

  it.each([
    ['site_management', inspection(), true],
    ['technician', inspection(), false],
    ['site_management', inspection({ performer: 'own_staff', contractorNote: null }), false],
    ['site_management', inspection({ status: 'started' }), false],
    [
      'site_management',
      inspection({
        duties: inspection().duties.map((line) => ({ ...line, takesReport: false })),
      }),
      false,
    ],
  ] as const)(
    'stands on the page of an inspection for "%s" (%#): %s',
    async (role, activity, offered) => {
      signedInOffice(role, [sued], {
        ...servingCatalogue(),
        [`/activities/${activity.id}`]: activity,
        [`/activities/${activity.id}/candidates`]: { responsible: [], performers: [] },
      })

      const { router } = await mountOffice(`/pruefungen/${activity.id}`, server, everything)

      await screen.findByRole('heading', { level: 1, name: activity.title })
      await untilTheRightsAreKnown()

      const button = screen.queryByRole('button', { name: 'Bericht eintragen' })

      expect(button !== null).toBe(offered)

      if (button) {
        fireEvent.click(button)
        await waitFor(() => {
          expect(router.state.location.pathname).toBe('/nachweise/bericht/d-fire')
        })
        // The form names the contractor planned at the inspection (#186).
        expect(router.state.location.search).toEqual({ vorgang: 'v-fire' })
      }
    },
  )
})

describe('the contractor a report comes from (#186)', () => {
  /** The inspection of the duty under way, planned with a contractor. */
  const planned = {
    id: 'v-fire',
    kind: 'inspection',
    status: 'open',
    dueOn: '2026-09-30',
    performer: 'contractor',
    contractorNote: 'Löschtechnik Beispiel GmbH',
  } as const

  async function openedAt(address: string, duty: DutyDetails) {
    written = signedInOffice('site_management', [sued], {
      ...servingCatalogue(),
      [`/duties/${duty.id}`]: duty,
      [`/duties/${duty.id}/evidence`]: lastTime,
    })
    await mountOffice(address, server, everything)
    await screen.findByRole('heading', { level: 1, name: 'Bericht eintragen' })
  }

  const organisation = () =>
    (screen.getByRole('textbox', { name: /^Organisation/ }) as HTMLInputElement).value

  it('is the one planned at the inspection it is entered from, also where the duty says the own people', async () => {
    await openedAt(
      '/nachweise/bericht/d-fire?vorgang=v-fire',
      dutyOf({ performer: 'own_staff', performerNote: null, activity: planned }),
    )

    expect(organisation()).toBe('Löschtechnik Beispiel GmbH')
    expect(screen.getByText(/durchgeführt von einer Fremdfirma/)).toBeTruthy()
    expect(screen.getByText('Löschtechnik Beispiel GmbH')).toBeTruthy()
  })

  it.each([['/nachweise/bericht/d-fire'], ['/nachweise/bericht/d-fire?vorgang=v-other']])(
    'is the one the duty names, entered at %s',
    async (address) => {
      await openedAt(address, dutyOf({ activity: planned }))

      expect(organisation()).toBe('Brandschutz Beispiel GmbH')
    },
  )
})
