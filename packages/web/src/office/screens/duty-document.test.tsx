import type {
  AssetDetails,
  DutyColleague,
  DutyDetails,
  DutyEntry,
  DutyIntervalDocument,
  RoleKey,
} from '@opengewerk/haustechnik-domain'
import { TestServer } from '@opengewerk/platform-web/testing'
import { onlineManager } from '@tanstack/react-query'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { servingCatalogue } from '../../app/test-catalogue.js'
import { memberIn } from '../../app/test-entry.js'
import {
  mountOffice,
  type NamedArea,
  onA,
  signedInOffice,
  untilTheRightsAreKnown,
  type WriteAnswer,
  type Written,
} from '../test-office.js'
import { confirmWords } from './duty-confirm.js'

/**
 * The document that bears the interval of a duty in the office (#74, 4.3 of
 * the concept): the forms "Pflicht bestätigen" and "Frist festlegen" offer
 * the documents filed at the asset, its room, its building and its property
 * and send the one chosen; over a duty whose document has a newer version,
 * saving takes the newest; the page names the document with its version and
 * says "Frist prüfen", and so does the register.
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
const hall = { ...house, id: 'b-hall', name: 'Sporthalle' }
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
const store = { ...boilerRoom, id: 'r-store', number: 'E.2', name: 'Lager', use: null }

const mainTest = 'probe.elevator_main_test'

const liftRecord = {
  id: 'a-lift',
  ...place,
  buildingId: house.id,
  roomId: boilerRoom.id,
  parentAssetId: null,
  kind: 'probe.elevator',
  number: 'AN-00012',
  name: 'Aufzug Schulhaus',
}
const lift = liftRecord as unknown as AssetDetails

const colleagues: readonly DutyColleague[] = [
  { userId: 'u-roth', name: 'Dennis Roth', active: true },
]

const nowhere = { buildingId: null, roomId: null, assetId: null, activityId: null, defectId: null }
const document = (id: string, title: string, home: Readonly<Record<string, string>>) => ({
  id,
  ...place,
  ...nowhere,
  ...home,
  title,
  kind: null,
})

// At the asset, its room, its building and its property: the four that may bear its interval.
const assessment = document('d-assessment', 'Gefährdungsbeurteilung Aufzug', { assetId: lift.id })
const plan = document('d-plan', 'Schaltplan Heizraum', { roomId: boilerRoom.id })
const handover = document('d-handover', 'Revisionsunterlagen Heizung', { buildingId: house.id })
const concept = document('d-concept', 'Brandschutzkonzept Schulzentrum', {})
// Elsewhere on the property, and the photo of an activity: none of them.
const inventory = document('d-inventory', 'Lagerliste', { roomId: store.id })
const hallPlan = document('d-hall', 'Hallenplan', { buildingId: hall.id })
const photo = document('d-photo', 'Foto der Prüfung', { activityId: 'v-1' })

const versionId = (order: number) => `00000000-0000-7000-8000-0000000000${String(order)}`
const version = (order: number, attachmentId: string, fileName: string, day: string) => ({
  id: versionId(order),
  attachmentId,
  sha256: String(order).padEnd(64, 'a'),
  fileName,
  mediaType: 'application/pdf',
  sizeBytes: 820_000,
  previewSha256: null,
  createdBy: 'u-kraemer',
  createdAt: `${day}T09:00:00.000Z`,
})

const everything = [
  'properties',
  'buildings',
  'floors',
  'rooms',
  'assets',
  'activities',
  'attachments',
  'attachment_versions',
] as const

/** The assessment as the duty reads it: version 1 kept, version 2 laid over it since. */
const pointedAt: DutyIntervalDocument = {
  id: assessment.id as DutyIntervalDocument['id'],
  title: assessment.title,
  removed: false,
  version: {
    id: versionId(11) as DutyIntervalDocument['version']['id'],
    number: 1,
    filedOn: '2026-09-02',
    fileName: 'gb-aufzug-2024.pdf',
  },
  newer: {
    id: versionId(19) as DutyIntervalDocument['version']['id'],
    number: 2,
    filedOn: '2026-10-06',
    fileName: 'gb-aufzug-2026.pdf',
  },
}

/** The main test of the lift, which points at the assessment. */
function duty(further: Readonly<Record<string, unknown>> = {}): DutyDetails {
  return {
    id: 'd-1',
    ...place,
    buildingId: null,
    roomId: null,
    assetId: lift.id,
    kind: mainTest,
    kindVersion: 1,
    label: null,
    basis: null,
    sourceNote: null,
    task: null,
    counting: 'betrsichv',
    intervalDays: null,
    intervalMonths: 12,
    intervalReason: 'Die Gefährdungsbeurteilung verlangt die jährliche Prüfung.',
    intervalDocumentId: assessment.id,
    intervalDocumentVersionId: versionId(11),
    maximumDays: null,
    maximumMonths: 24,
    responsibleUserId: 'u-roth',
    performer: 'contractor',
    performerNote: 'Prüfdienst Beispiel GmbH',
    confirmedBy: 'u-lead',
    confirmedAt: '2026-09-14T08:00:00.000Z',
    endsOn: null,
    endReason: null,
    title: 'Hauptprüfung der Aufzugsanlage',
    state: 'met',
    appointment: { dueOn: '2027-07-01', onTimeUntil: '2027-09-30' },
    lastMetOn: '2026-07-12',
    ended: false,
    removable: false,
    intervalDocument: pointedAt,
    intervalToCheck: true,
    asset: {
      id: lift.id,
      number: 'AN-00012',
      name: 'Aufzug Schulhaus',
      kind: 'probe.elevator',
      buildingId: house.id,
      roomId: boilerRoom.id,
    },
    responsible: { userId: 'u-roth', name: 'Dennis Roth' },
    activity: null,
    ...further,
  } as unknown as DutyDetails
}

let server: TestServer
let written: Written[]
let answerToWrite: (write: Written) => WriteAnswer

const answering =
  (body: unknown, status = 201) =>
  (): WriteAnswer => ({ status, body })

async function mount(
  at: string,
  {
    role = 'technical_management',
    lacking = [],
    answers = {},
  }: {
    readonly role?: RoleKey
    readonly lacking?: readonly string[]
    readonly answers?: Readonly<Record<string, unknown>>
  } = {},
) {
  const member = memberIn(role)

  written = signedInOffice(
    role,
    [sued],
    {
      '/auth/tenants': [
        { ...member, rights: member.rights.filter((right) => !lacking.includes(right)) },
      ],
      ...servingCatalogue(),
      '/duties/colleagues': colleagues,
      [`/assets/${lift.id}`]: lift,
      '/duties/d-1': duty(),
      '/duties/d-1/evidence': [],
      ...answers,
    },
    (write) => answerToWrite(write),
  )

  const mounted = await mountOffice(at, server, everything)

  await untilTheRightsAreKnown()

  return mounted.router
}

/** The choice of the document, once the documents of the device are there. */
async function documentChoice(): Promise<HTMLSelectElement> {
  const choice = await screen.findByRole<HTMLSelectElement>('combobox', {
    name: confirmWords.document,
  })

  await waitFor(() => {
    expect(choice.options.length).toBeGreaterThan(1)
  })

  return choice
}

function offered(choice: HTMLSelectElement): string[] {
  return [...choice.options].filter((option) => !option.hidden).map((option) => option.text)
}

beforeEach(() => {
  localStorage.clear()
  onA('desktop')
  server = new TestServer()
  server.put('properties', school)

  for (const building of [house, hall]) {
    server.put('buildings', building)
  }

  server.put('floors', ground)

  for (const room of [boilerRoom, store]) {
    server.put('rooms', room)
  }

  server.put('assets', liftRecord)

  for (const each of [assessment, plan, handover, concept, inventory, hallPlan, photo]) {
    server.put('attachments', each)
  }

  for (const each of [
    version(11, assessment.id, 'gb-aufzug-2024.pdf', '2026-09-02'),
    version(19, assessment.id, 'gb-aufzug-2026.pdf', '2026-10-06'),
    version(12, plan.id, 'schaltplan-heizraum.pdf', '2026-09-02'),
    version(13, handover.id, 'revision-heizung.pdf', '2026-01-12'),
    version(14, concept.id, 'brandschutzkonzept-2019.pdf', '2026-03-14'),
    version(15, inventory.id, 'lagerliste.pdf', '2026-09-03'),
    version(16, hallPlan.id, 'hallenplan.pdf', '2026-09-03'),
    version(17, photo.id, 'foto.pdf', '2026-09-03'),
  ]) {
    server.put('attachment_versions', each)
  }

  answerToWrite = answering({ message: 'Dieser Test hat keinen Schreibzugriff erwartet.' }, 500)
})

afterEach(() => {
  vi.unstubAllGlobals()
  onlineManager.setOnline(true)
})

describe('the document that bears the interval, confirming a proposal', () => {
  it('is one of the asset, its room, its building or its property, and goes with the duty', async () => {
    const router = await mount(`/pflichten/bestaetigen?anlage=${lift.id}&pflichtart=${mainTest}`)
    const choice = await documentChoice()

    expect(offered(choice)).toEqual([
      confirmWords.noDocument,
      'Brandschutzkonzept Schulzentrum (brandschutzkonzept-2019.pdf)',
      'Gefährdungsbeurteilung Aufzug (gb-aufzug-2026.pdf)',
      'Revisionsunterlagen Heizung (revision-heizung.pdf)',
      'Schaltplan Heizraum (schaltplan-heizraum.pdf)',
    ])
    expect(screen.getByText(confirmWords.documentFrom)).toBeTruthy()

    answerToWrite = answering({ id: 'd-new' })
    fireEvent.change(choice, { target: { value: assessment.id } })
    fireEvent.click(screen.getByRole('button', { name: 'Pflicht bestätigen' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/pflichten/d-new')
    })
    expect(written).toEqual([
      {
        method: 'POST',
        path: '/duties',
        body: expect.objectContaining({
          assetId: lift.id,
          kind: mainTest,
          intervalDocumentId: assessment.id,
        }) as unknown,
      },
    ])
  })

  it('is not asked of whoever may not look at documents', async () => {
    await mount(`/pflichten/bestaetigen?anlage=${lift.id}&pflichtart=${mainTest}`, {
      lacking: ['document.read'],
    })
    await screen.findByRole('button', { name: 'Pflicht bestätigen' })

    expect(screen.queryByRole('combobox', { name: confirmWords.document })).toBeNull()
  })
})

describe('the document that bears the interval of a duty there is', () => {
  it('is taken in its newest version when the form is saved, which is checking the interval against it', async () => {
    const router = await mount('/pflichten/d-1/frist')
    const choice = await documentChoice()

    expect(choice.value).toBe(assessment.id)
    expect(
      screen.getByText(
        'Die Pflicht zeigt auf Fassung 1 vom 02.09.2026. Fassung 2 vom 06.10.2026 liegt vor; mit „Speichern“ zeigt sie auf diese.',
      ),
    ).toBeTruthy()

    answerToWrite = answering(duty(), 200)
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/pflichten/d-1')
    })
    expect(written).toEqual([
      { method: 'PATCH', path: '/duties/d-1', body: { intervalDocumentId: assessment.id } },
    ])
  })

  it('is sent only where it changes while no newer version lies over it', async () => {
    const router = await mount('/pflichten/d-1/frist', {
      answers: {
        '/duties/d-1': duty({
          intervalDocument: { ...pointedAt, newer: null },
          intervalToCheck: false,
        }),
      },
    })

    await documentChoice()
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/pflichten/d-1')
    })
    expect(written).toEqual([])
  })

  it('is let go with "Kein Dokument"', async () => {
    await mount('/pflichten/d-1/frist')

    const choice = await documentChoice()

    answerToWrite = answering(duty(), 200)
    fireEvent.change(choice, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(written).toHaveLength(1)
    })
    expect(written[0]?.body).toEqual({ intervalDocumentId: null })
  })

  it('stays a choice once taken out of the records, says so, and is not sent again', async () => {
    // Taken out of the records, it is on no device any more.
    const router = await mount('/pflichten/d-1/frist', {
      answers: {
        '/duties/d-1': duty({
          intervalDocumentId: 'd-gone',
          intervalDocument: {
            ...pointedAt,
            id: 'd-gone',
            title: 'Alte Gefährdungsbeurteilung',
            removed: true,
          },
        }),
      },
    })
    const choice = await documentChoice()

    expect(choice.value).toBe('d-gone')
    expect(offered(choice)).toContain('Alte Gefährdungsbeurteilung (aus der Ablage entfernt)')
    expect(screen.getByText(confirmWords.removedChoose)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/pflichten/d-1')
    })
    expect(written).toEqual([])
  })
})

describe('a duty whose document has a newer version', () => {
  it('names the document with the version it points at, and says "Frist prüfen" with what to do', async () => {
    await mount('/pflichten/d-1')

    await screen.findByRole('heading', { level: 1, name: 'Hauptprüfung der Aufzugsanlage' })

    const card = screen.getByRole('region', { name: 'Frist' })

    // Beside the state in the head of the page.
    expect(screen.getByText('Frist prüfen')).toBeTruthy()
    expect(
      within(card)
        .getByRole('link', { name: 'Gefährdungsbeurteilung Aufzug' })
        .getAttribute('href'),
    ).toBe(`/dokumente/${assessment.id}`)
    expect(within(card).getByText('Fassung 1 vom 02.09.2026')).toBeTruthy()
    expect(
      within(card).getByText(
        'Seit dem 06.10.2026 liegt Fassung 2 des Dokuments vor. Prüfen Sie, ob die Frist noch stimmt. Mit „Ändern“ und „Speichern“ zeigt die Pflicht auf die neue Fassung.',
      ),
    ).toBeTruthy()
  })

  it('tells whoever does not keep the register what it means, and not what they cannot do', async () => {
    await mount('/pflichten/d-1', { role: 'technician' })

    const card = await screen.findByRole('region', { name: 'Frist' })

    expect(
      within(card).getByText(
        'Seit dem 06.10.2026 liegt Fassung 2 des Dokuments vor. Prüfen Sie, ob die Frist noch stimmt.',
      ),
    ).toBeTruthy()
  })

  it('names one taken out of the records without leading to it', async () => {
    await mount('/pflichten/d-1', {
      answers: { '/duties/d-1': duty({ intervalDocument: { ...pointedAt, removed: true } }) },
    })

    const card = await screen.findByRole('region', { name: 'Frist' })

    expect(within(card).getByText('Gefährdungsbeurteilung Aufzug')).toBeTruthy()
    expect(within(card).queryByRole('link', { name: 'Gefährdungsbeurteilung Aufzug' })).toBeNull()
    expect(within(card).getByText('aus der Ablage entfernt')).toBeTruthy()
    expect(
      within(card).getByText(
        'Das Dokument, das die Frist trägt, ist aus der Ablage entfernt. Prüfen Sie, ob die Frist noch stimmt. Unter „Ändern“ wählen Sie ein anderes Dokument oder keines.',
      ),
    ).toBeTruthy()
  })

  it('says "Frist prüfen" in the register under its interval', async () => {
    const entry = {
      ...duty(),
      lastEvidence: null,
    } as unknown as DutyEntry

    await mount('/pflichten', {
      answers: {
        '/duties/register?offset=0&limit=50': {
          total: 1,
          assets: 1,
          places: 0,
          counts: { never_recorded: 0, overdue: 0, due: 0, met: 1, dormant: 0, ended: 0 },
          withoutResponsible: 0,
          more: false,
          duties: [entry],
          people: [],
        },
      },
    })

    const table = await screen.findByRole('table', {
      name: 'Pflichten mit Anlage oder Ort, Frist, Zuständigkeit, letztem Nachweis, nächstem Termin und Zustand',
    })

    expect(within(table).getByText('Frist prüfen')).toBeTruthy()
  })
})
