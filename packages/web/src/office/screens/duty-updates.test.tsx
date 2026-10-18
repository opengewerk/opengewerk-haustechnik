import type {
  DutyDetails,
  DutyEntry,
  DutyUpdate,
  DutyUpdateEntry,
  DutyUpdates,
  RoleKey,
} from '@opengewerk/haustechnik-domain'
import { TestServer } from '@opengewerk/platform-web/testing'
import { onlineManager } from '@tanstack/react-query'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { servingCatalogue } from '../../app/test-catalogue.js'
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
import { updateWords } from './duty-updates.js'

/**
 * What a new version of a package changes for the duties that are confirmed
 * (#139, section 2.3 of the concept): the report by duty kind with what
 * changes and what becomes of each duty, the two decisions on what is chosen,
 * the note that leads there, and the marks of a duty in the register and on
 * its page. Whoever keeps the register decides; everybody else reads.
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
const house = {
  id: 'b-house',
  propertyId: school.id,
  areaId: sued.id,
  name: 'Schulhaus',
  kinds: '["school"]',
  yearBuilt: 1975,
}

const mainTest = 'probe.elevator_main_test'
const changes = 'Hauptprüfung der Aufzugsanlage: was sich ändert'
const dutiesOfTheKind =
  'Hauptprüfung der Aufzugsanlage: 3 Pflichten, mit der Frist heute und mit der neuen Fassung'

/** A second version from a day years ahead, with a maximum of one year: beyond it for a duty of two. */
const shorter: DutyUpdate = {
  held: 1,
  newest: 2,
  from: '2099-01-01',
  changes: [
    { field: 'interval', held: '24 Monate', newest: '12 Monate' },
    {
      field: 'source',
      held: '§ 16 der Probeverordnung',
      newest: '§ 16 Abs. 2 der Probeverordnung',
    },
  ],
  maximum: { interval: { months: 12 }, from: '2099-01-01' },
  shorter: { interval: { months: 12 }, from: '2099-01-01' },
  lapse: null,
  adoptable: true,
  becomes: { months: 12 },
  becomesDue: null,
  obstacle: null,
  keepable: false,
}
/** The same for a duty of half a year, which is within the new maximum. */
const within6: DutyUpdate = { ...shorter, shorter: null, becomes: { months: 6 }, keepable: true }

function entry(n: number, update: DutyUpdate, intervalMonths = 24): DutyUpdateEntry {
  return {
    id: `d-${String(n)}`,
    kind: mainTest,
    title: 'Hauptprüfung der Aufzugsanlage',
    propertyId: school.id,
    asset: {
      id: `a-${String(n)}`,
      number: `AN-0010${String(n)}`,
      name: `Aufzug ${String(n)}`,
      kind: 'probe.elevator',
      buildingId: house.id,
      roomId: null,
    },
    intervalDays: null,
    intervalMonths,
    update,
  } as DutyUpdateEntry
}

const reported: DutyUpdates = {
  entries: [entry(1, shorter), entry(2, shorter), entry(3, within6, 6)],
}

let server: TestServer
let written: Written[]
let answerToWrite: (write: Written) => WriteAnswer

async function mount(
  at: string,
  role: RoleKey = 'technical_management',
  answers: Readonly<Record<string, unknown>> = {},
) {
  written = signedInOffice(
    role,
    [sued],
    { ...servingCatalogue(), '/duties/updates': reported, ...answers },
    (write) => answerToWrite(write),
  )

  return (await mountOffice(at, server, ['properties', 'buildings'])).router
}

/** The report once its group stands, with the catalogue known: the line of the group names its package. */
async function listed(role?: RoleKey, answers?: Readonly<Record<string, unknown>>) {
  const router = await mount('/pflichten/fassungen', role, answers)

  await screen.findByRole('heading', { level: 2, name: 'Hauptprüfung der Aufzugsanlage' })
  await screen.findByText(/^Probepaket · /)

  return router
}

function press(name: string | RegExp): void {
  fireEvent.click(screen.getByRole('button', { name }))
}

beforeEach(() => {
  localStorage.clear()
  onA('desktop')
  server = new TestServer()
  server.put('properties', school)
  server.put('buildings', house)
  answerToWrite = () => ({
    status: 500,
    body: { message: 'Dieser Test hat keinen Schreibzugriff erwartet.' },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  onlineManager.setOnline(true)
})

describe('the report of a new version', () => {
  it('stands by duty kind, with what changes, from when, and what becomes of each duty', async () => {
    await listed()

    expect(screen.getByText('3 bestätigte Pflichten an 3 Anlagen')).toBeTruthy()
    expect(
      screen.getByText('Probepaket · Fassung 1, neu Fassung 2 · gilt ab dem 01.01.2099'),
    ).toBeTruthy()
    expect(rowsOf(changes)).toEqual([
      ['Frist der Vorschrift', '24 Monate', '12 Monate'],
      ['Fundstelle', '§ 16 der Probeverordnung', '§ 16 Abs. 2 der Probeverordnung'],
    ])
    expect(rowsOf(dutiesOfTheKind)).toEqual([
      [
        '',
        'Aufzug 1AN-00101 · Schulzentrum Am Lindenhain, Schulhaus',
        '24 Monate',
        'wird 12 Monate',
      ],
      [
        '',
        'Aufzug 2AN-00102 · Schulzentrum Am Lindenhain, Schulhaus',
        '24 Monate',
        'wird 12 Monate',
      ],
      [
        '',
        'Aufzug 3AN-00103 · Schulzentrum Am Lindenhain, Schulhaus',
        '6 Monate',
        'bleibt 6 Monate',
      ],
    ])
    expect(screen.getByRole('link', { name: 'Aufzug 1' }).getAttribute('href')).toBe(
      '/pflichten/d-1',
    )
  })

  it('says so where the catalogue says nothing new', async () => {
    await mount('/pflichten/fassungen', 'technical_management', {
      '/duties/updates': { entries: [] },
    })

    expect(await screen.findByText(updateWords.none)).toBeTruthy()
  })

  it('takes the new version over for the duties that are chosen', async () => {
    answerToWrite = () => ({ status: 201, body: [] })
    await listed()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Aufzug 2 auswählen' }))
    press('2 Pflichten übernehmen')

    await waitFor(() => {
      expect(written).toEqual([
        { method: 'POST', path: '/duties/updates/adopt', body: { dutyIds: ['d-1', 'd-3'] } },
      ])
    })
    expect(await screen.findByText('2 Pflichten mit der neuen Fassung übernommen.')).toBeTruthy()
  })

  it('leaves as it is only what may be left, and only with a reason', async () => {
    answerToWrite = () => ({ status: 201, body: [] })
    await listed()

    // Two of the three lie beyond the new maximum: they are taken over, never left.
    expect(
      screen.getByText(
        '2 der 3 Pflichten haben eine längere Frist als die neue Höchstfrist. Sie lassen sich nur übernehmen.',
      ),
    ).toBeTruthy()

    press('1 Pflicht so lassen')

    expect(await screen.findByText(updateWords.noReason)).toBeTruthy()
    expect(written).toEqual([])

    fireEvent.change(screen.getByLabelText('Begründung'), {
      target: { value: '  Wir prüfen ohnehin halbjährlich.  ' },
    })
    press('1 Pflicht so lassen')

    await waitFor(() => {
      expect(written).toEqual([
        {
          method: 'POST',
          path: '/duties/updates/keep',
          body: { dutyIds: ['d-3'], reason: 'Wir prüfen ohnehin halbjährlich.' },
        },
      ])
    })
    expect(await screen.findByText('1 Pflicht so gelassen, mit Begründung.')).toBeTruthy()
  })

  it('says what the server refused, and what was chosen stays', async () => {
    answerToWrite = () => ({
      status: 409,
      body: {
        message: 'Hauptprüfung der Aufzugsanlage an AN-00101 Aufzug 1: Diese Pflicht ist beendet.',
      },
    })
    await listed()

    press('3 Pflichten übernehmen')

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Hauptprüfung der Aufzugsanlage an AN-00101 Aufzug 1: Diese Pflicht ist beendet.',
    )
    expect(screen.getByRole('button', { name: '3 Pflichten übernehmen' })).toBeTruthy()
  })

  it('offers only leaving it for a duty the new version no longer takes in', async () => {
    const lapsed: DutyUpdate = {
      ...shorter,
      changes: [],
      maximum: null,
      shorter: null,
      lapse: 'out_of_scope',
      adoptable: false,
      becomes: null,
      becomesDue: null,
      obstacle: 'Nach der neuen Fassung gilt die Pflichtart für diese Anlage nicht mehr.',
      keepable: true,
    }

    await listed('technical_management', { '/duties/updates': { entries: [entry(1, lapsed)] } })

    expect(
      screen.getByText(
        'Nach der neuen Fassung gilt die Pflichtart für diese Anlage nicht mehr. Lassen Sie die Pflicht mit Begründung, wie sie ist, oder beenden Sie sie auf ihrer Seite.',
      ),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: '0 Pflichten übernehmen' })).toHaveProperty(
      'disabled',
      true,
    )
    expect(screen.getByRole('button', { name: '1 Pflicht so lassen' })).toHaveProperty(
      'disabled',
      false,
    )
  })

  it('offers no decision to whoever only reads duties', async () => {
    await listed('technician')
    await untilTheRightsAreKnown()

    expect(rowsOf(dutiesOfTheKind)).toHaveLength(3)
    expect(screen.getByText(updateWords.mayNot)).toBeTruthy()
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.queryByRole('button', { name: /übernehmen/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /so lassen/ })).toBeNull()
  })
})

describe('the note of a new version', () => {
  it('says over the proposals what the package changes, and leads to the report', async () => {
    await mount('/pflichten/vorschlaege', 'technical_management', {
      '/duties/proposals': { proposals: [], dismissed: [] },
      // One beyond the new maximum and one within it: the maximum is shorter for both.
      '/duties/updates': { entries: [entry(1, shorter), entry(3, within6, 6)] },
    })

    expect(
      await screen.findByText(
        'Neue Fassung des Pakets Probepaket: Für 2 Pflichten gilt ab dem 01.01.2099 eine kürzere Höchstfrist, von diesem Tag an auch ohne Übernahme.',
      ),
    ).toBeTruthy()
    expect(screen.getByRole('link', { name: updateWords.look }).getAttribute('href')).toBe(
      '/pflichten/fassungen',
    )
  })

  it('stands nowhere while the catalogue says nothing new', async () => {
    await mount('/pflichten/vorschlaege', 'technical_management', {
      '/duties/proposals': { proposals: [], dismissed: [] },
      '/duties/updates': { entries: [] },
    })

    await screen.findByRole('heading', { level: 1, name: 'Vorschläge aus dem Katalog' })
    await untilTheRightsAreKnown()

    expect(screen.queryByText(/Neue Fassung des Pakets/)).toBeNull()
    expect(screen.queryByRole('link', { name: updateWords.look })).toBeNull()
  })
})

describe('a duty the catalogue says something new about', () => {
  const register =
    'Pflichten mit Anlage oder Ort, Frist, Zuständigkeit, letztem Nachweis, nächstem Termin und Zustand'

  function row(id: string, further: Readonly<Record<string, unknown>>): DutyEntry {
    return {
      id,
      kind: mainTest,
      kindVersion: 1,
      label: null,
      basis: null,
      sourceNote: null,
      task: null,
      counting: 'betrsichv',
      intervalDays: null,
      intervalMonths: 24,
      intervalReason: null,
      endsOn: null,
      title: 'Hauptprüfung der Aufzugsanlage',
      state: 'met',
      appointment: { dueOn: '2099-03-01', onTimeUntil: '2099-05-31' },
      lastMetOn: '2026-03-12',
      propertyId: school.id,
      buildingId: null,
      roomId: null,
      assetId: `a-${id}`,
      responsibleUserId: null,
      performer: null,
      performerNote: null,
      ended: false,
      intervalToCheck: false,
      contractId: null,
      contractEnded: false,
      asset: {
        id: `a-${id}`,
        number: 'AN-00101',
        name: `Aufzug ${id}`,
        kind: 'probe.elevator',
        buildingId: house.id,
        roomId: null,
      },
      responsible: null,
      lastEvidence: null,
      shortened: null,
      updated: false,
      ...further,
    } as unknown as DutyEntry
  }

  it('says "Neue Fassung" under its interval in the register, or that a regulation cut it short, and no other does', async () => {
    await mount('/pflichten', 'technician', {
      '/duties/register?offset=0&limit=50': {
        total: 3,
        assets: 3,
        places: 0,
        counts: {
          never_recorded: 0,
          overdue: 0,
          due: 0,
          outstanding: 0,
          met: 3,
          dormant: 0,
          ended: 0,
        },
        withoutResponsible: 0,
        more: false,
        duties: [
          row('1', {}),
          row('2', { updated: true }),
          row('3', { updated: true, shortened: { months: 12 } }),
        ],
        people: null,
      },
    })

    await screen.findByRole('table', { name: register })
    // The kind of the interval comes with the catalogue of the device, like the source.
    await screen.findAllByText('§ 16 der Probeverordnung')

    // The interval a row shows is the one the duty counts with.
    expect(rowsOf(register).map((cells) => cells[2])).toEqual([
      '24 MonateHöchstfrist',
      '24 MonateHöchstfristNeue Fassung',
      '12 MonateHöchstfristDurch Vorschrift verkürzt',
    ])
  })

  function page(further: Readonly<Record<string, unknown>>): DutyDetails {
    return {
      ...row('1', {}),
      areaId: sued.id,
      maximumDays: null,
      maximumMonths: 24,
      guideDays: null,
      guideMonths: null,
      keptVersion: null,
      keptDays: null,
      keptMonths: null,
      keptReason: null,
      confirmedBy: 'u-lead',
      confirmedAt: '2026-09-14T08:00:00.000Z',
      endReason: null,
      removable: false,
      intervalDocumentId: null,
      intervalDocumentVersionId: null,
      intervalDocument: null,
      contractEnded: false,
      contract: null,
      covering: [],
      delegation: null,
      activity: null,
      update: null,
      ...further,
    } as unknown as DutyDetails
  }

  it('says on its page what changes and from when, and that the appointment will count with the shorter maximum', async () => {
    await mount('/pflichten/d-1', 'technical_management', {
      '/duties/d-1': page({ update: shorter, updated: true }),
      '/duties/d-1/evidence': [],
    })

    const card = (await screen.findByRole('heading', { level: 2, name: updateWords.mark })).closest(
      'section',
    ) as HTMLElement

    expect(within(card).getByText('Fassung 2 der Pflichtart gilt ab dem 01.01.2099.')).toBeTruthy()
    expect(within(card).getByText('24 Monate, neu 12 Monate')).toBeTruthy()
    expect(within(card).getByRole('link', { name: updateWords.look }).getAttribute('href')).toBe(
      '/pflichten/fassungen',
    )
    expect(
      screen.getByText(
        'Ab dem 01.01.2099 beträgt die Höchstfrist 12 Monate. Von diesem Tag an rechnet der Termin mit ihr, auch ohne Übernahme.',
      ),
    ).toBeTruthy()
    // Before that day nothing is cut short.
    expect(screen.queryByText(/Durch Vorschrift verkürzt/)).toBeNull()
  })

  it('says on its page that a regulation cut its interval short, with the interval it counts with', async () => {
    const since = {
      ...shorter,
      from: '2026-01-01',
      shorter: { interval: { months: 12 }, from: '2026-01-01' },
    }

    await mount('/pflichten/d-1', 'technical_management', {
      '/duties/d-1': page({ update: since, updated: true, shortened: { months: 12 } }),
      '/duties/d-1/evidence': [],
    })

    expect(await screen.findByText('Durch Vorschrift verkürzt, zählt mit 12 Monaten')).toBeTruthy()
    expect(
      screen.getByText(
        'Seit dem 01.01.2026 beträgt die Höchstfrist 12 Monate. Der Termin rechnet mit ihr; die Pflicht nennt weiter 24 Monate, bis jemand die neue Fassung übernimmt.',
      ),
    ).toBeTruthy()
  })

  it('has no card and no mark on its page while the catalogue says nothing new', async () => {
    await mount('/pflichten/d-1', 'technical_management', {
      '/duties/d-1': page({}),
      '/duties/d-1/evidence': [],
    })

    await screen.findByRole('heading', { level: 1, name: 'Hauptprüfung der Aufzugsanlage' })
    await screen.findByText('24 Monate, am Tag der Bestätigung')

    expect(screen.queryByText(updateWords.mark)).toBeNull()
    expect(screen.queryByText(/Durch Vorschrift verkürzt/)).toBeNull()
  })
})
