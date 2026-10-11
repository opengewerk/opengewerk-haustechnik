import type {
  DismissedProposal,
  DutyColleague,
  DutyProposals,
  ProposedAsset,
  RoleKey,
} from '@opengewerk/haustechnik-domain'
import { TestServer } from '@opengewerk/platform-web/testing'
import { onlineManager } from '@tanstack/react-query'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { unacceptedWords } from '../../app/review-marks.js'
import { servingCatalogue } from '../../app/test-catalogue.js'
import {
  mountOffice,
  type NamedArea,
  onA,
  servingTables,
  signedInOffice,
  type WriteAnswer,
  type Written,
} from '../test-office.js'
import { dismissedWords, proposalWords } from './proposals.js'

/**
 * The proposals of the catalogue in the office (#102, 4.3 of the concept):
 * grouped by duty kind with the marks of their entries, a group open with
 * its assets all chosen, confirmed or dismissed in one batch from the card
 * "Auswahl", one dismissed from its row with its reason, and the dismissed
 * ones taken back. Whoever keeps the register decides; everybody else sees
 * the proposals without a way to decide.
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
const depot = { ...school, id: 'p-depot', name: 'Bauhof', street: 'Am Hafen 2' }
const house = {
  id: 'b-house',
  propertyId: school.id,
  areaId: sued.id,
  name: 'Schulhaus',
  kinds: '["school"]',
  yearBuilt: 1975,
}

const mainTest = 'probe.elevator_main_test'
const interimCheck = 'probe.interim_check'

function lift(n: number): ProposedAsset {
  return {
    id: `a-${String(n)}`,
    number: `AN-0010${String(n)}`,
    name: `Aufzug ${String(n)}`,
    kind: 'probe.elevator',
    propertyId: school.id,
    buildingId: house.id,
    roomId: null,
    enteredOn: '2026-09-28',
  } as ProposedAsset
}

const lifts = [1, 2, 3, 4, 5, 6, 7].map(lift)

const dismissal = {
  id: 'dm-1',
  kind: interimCheck,
  kindVersion: 1,
  reason: 'Die Zwischenprüfung übernimmt der Hersteller.',
  dismissedOn: '2026-10-06',
  asset: lifts[1],
} as DismissedProposal

const proposals: DutyProposals = {
  proposals: [
    ...lifts.map((asset) => ({ kind: mainTest, asset })),
    { kind: interimCheck, asset: lifts[0] as ProposedAsset },
  ],
  dismissed: [dismissal],
}

const emptyRegister = {
  total: 0,
  assets: 0,
  places: 0,
  counts: { never_recorded: 0, overdue: 0, due: 0, met: 0, dormant: 0, ended: 0 },
  withoutResponsible: 0,
  more: false,
  duties: [],
  people: null,
}

const colleagues: readonly DutyColleague[] = [
  { userId: 'u-roth', name: 'Dennis Roth', active: true },
  { userId: 'u-lindner', name: 'Petra Lindner', active: true },
]

let server: TestServer
let written: Written[]
let answerToWrite: (write: Written) => WriteAnswer

const answering =
  (body: unknown, status = 201) =>
  (): WriteAnswer => ({ status, body })

async function mount(
  at: string,
  role: RoleKey = 'technical_management',
  answers: Readonly<Record<string, unknown>> = {},
) {
  written = signedInOffice(
    role,
    [sued],
    {
      ...servingCatalogue(),
      '/duties/colleagues': colleagues,
      '/duties/proposals': proposals,
      ...answers,
    },
    (write) => answerToWrite(write),
  )

  return (await mountOffice(at, server, ['properties', 'buildings'])).router
}

/** The list once its groups stand, with the catalogue known: the marks come with it. */
async function listed(role?: RoleKey, answers?: Readonly<Record<string, unknown>>) {
  const router = await mount('/pflichten/vorschlaege', role, answers)

  await screen.findByRole('heading', { level: 2, name: 'Hauptprüfung der Aufzugsanlage' })
  await screen.findByText(/Probepaket · § 16 der Probeverordnung/)

  return router
}

function group(name: string): HTMLElement {
  return screen.getByRole('region', { name })
}

function press(name: string | RegExp): void {
  fireEvent.click(screen.getByRole('button', { name }))
}

beforeEach(() => {
  localStorage.clear()
  onA('desktop')
  server = new TestServer()
  server.put('properties', school)
  server.put('properties', depot)
  server.put('buildings', house)
  answerToWrite = answering({ message: 'Dieser Test hat keinen Schreibzugriff erwartet.' }, 500)
})

afterEach(() => {
  vi.unstubAllGlobals()
  onlineManager.setOnline(true)
})

describe('the proposals of the catalogue', () => {
  it('stand grouped by duty kind, each with what it is and how many assets it is proposed for', async () => {
    await listed()

    expect(screen.getByText('8 offene Vorschläge an 7 Anlagen')).toBeTruthy()

    const main = group('Hauptprüfung der Aufzugsanlage')

    expect(
      within(main).getByText(
        'Probepaket · § 16 der Probeverordnung · Höchstfrist 24 Monate · Zugelassene Überwachungsstelle',
      ),
    ).toBeTruthy()
    expect(within(main).getByText('7 Anlagen')).toBeTruthy()
    expect(within(group('Zwischenprüfung')).getByText('1 Anlage')).toBeTruthy()
    // The first group stands open, with its first five assets and the way to the rest.
    expect(
      within(main).getByText(
        'AN-00101 · Schulzentrum Am Lindenhain, Schulhaus · angelegt am 28.09.2026',
      ),
    ).toBeTruthy()
    expect(within(main).getAllByRole('link', { name: /^Aufzug \d$/ })).toHaveLength(5)

    fireEvent.click(within(main).getByRole('button', { name: '2 weitere zeigen' }))

    expect(within(main).getAllByRole('link', { name: /^Aufzug \d$/ })).toHaveLength(7)
  })

  it('mark the proposal of an entry nobody with expertise has accepted, and only that one', async () => {
    await listed()

    expect(within(group('Zwischenprüfung')).getByText(unacceptedWords)).toBeTruthy()
    expect(within(group('Hauptprüfung der Aufzugsanlage')).queryByText(unacceptedWords)).toBeNull()
  })

  it('lead a row to the form that confirms it', async () => {
    await listed()

    expect(
      screen
        .getByRole('link', {
          name: 'Hauptprüfung der Aufzugsanlage an AN-00101 Aufzug 1 bestätigen',
        })
        .getAttribute('href'),
    ).toBe('/pflichten/bestaetigen?anlage=a-1&pflichtart=probe.elevator_main_test')
  })

  it('are narrowed to a property at the route, and to a package on the screen', async () => {
    await listed('technical_management', {
      '/duties/proposals': {
        ...proposals,
        proposals: [...proposals.proposals, { kind: 'fremd.check', asset: lifts[2] }],
      },
      [`/duties/proposals?propertyId=${depot.id}`]: { proposals: [], dismissed: [] },
    })

    fireEvent.change(screen.getByLabelText('Liegenschaft'), { target: { value: depot.id } })

    expect(await screen.findByText(proposalWords.noneNarrowed)).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Liegenschaft'), { target: { value: '' } })
    // A kind of a package this device does not know stands by its key.
    expect(await screen.findByRole('heading', { level: 2, name: 'fremd.check' })).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Paket'), { target: { value: 'probe' } })

    await waitFor(() => {
      expect(screen.queryByRole('heading', { level: 2, name: 'fremd.check' })).toBeNull()
    })
    expect(screen.getByRole('heading', { level: 2, name: 'Zwischenprüfung' })).toBeTruthy()
    expect(screen.getByText('8 offene Vorschläge an 7 Anlagen')).toBeTruthy()
  })
})

describe('a batch', () => {
  it('confirms every asset chosen in the open group, with the people named, in one request', async () => {
    await listed()

    answerToWrite = answering([])
    fireEvent.change(screen.getByRole('combobox', { name: 'Verantwortlich' }), {
      target: { value: 'u-lindner' },
    })
    fireEvent.click(screen.getByRole('radio', { name: 'Fremdfirma' }))
    fireEvent.change(screen.getByLabelText('Angabe zur Fremdfirma'), {
      target: { value: ' Prüfdienst Süd ' },
    })
    // One chosen less.
    fireEvent.click(screen.getByRole('checkbox', { name: 'AN-00102 Aufzug 2 auswählen' }))

    expect(screen.getByText('6 von 7 ausgewählt')).toBeTruthy()
    expect(
      screen.getByText(
        'Frist: 24 Monate, die Höchstfrist der Pflichtart. Eine kürzere legen Sie danach je Pflicht fest.',
      ),
    ).toBeTruthy()

    press('6 Vorschläge bestätigen')

    expect(await screen.findByText('6 Pflichten bestätigt.')).toBeTruthy()
    expect(written).toEqual([
      {
        method: 'POST',
        path: '/duties/batch',
        body: {
          kind: mainTest,
          assetIds: ['a-1', 'a-3', 'a-4', 'a-5', 'a-6', 'a-7'],
          responsibleUserId: 'u-lindner',
          performer: 'contractor',
          performerNote: 'Prüfdienst Süd',
        },
      },
    ])
  })

  it('asks the interval and its reason of a kind without a value, and sends them with the batch', async () => {
    await listed()

    press('Öffnen: Zwischenprüfung')
    answerToWrite = answering([])
    press('1 Vorschlag bestätigen')

    expect(await screen.findByText(proposalWords.noInterval)).toBeTruthy()
    expect(screen.getByText(proposalWords.noIntervalReason)).toBeTruthy()
    expect(written).toEqual([])

    fireEvent.change(screen.getByLabelText(/^Frist/), { target: { value: '6' } })
    fireEvent.change(screen.getByLabelText(/^Begründung der Frist/), {
      target: { value: 'Gefährdungsbeurteilung Aufzüge' },
    })
    press('1 Vorschlag bestätigen')

    await waitFor(() => {
      expect(written).toHaveLength(1)
    })
    expect(written[0]).toEqual({
      method: 'POST',
      path: '/duties/batch',
      body: {
        kind: interimCheck,
        assetIds: ['a-1'],
        intervalMonths: 6,
        intervalReason: 'Gefährdungsbeurteilung Aufzüge',
        responsibleUserId: null,
        performer: null,
        performerNote: null,
      },
    })
  })

  it('dismisses what is chosen with one reason, and not without one', async () => {
    await listed()

    answerToWrite = answering([])
    fireEvent.click(screen.getByRole('checkbox', { name: 'Alle 7 auswählen' }))

    expect(screen.getByText('0 von 7 ausgewählt')).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: '0 Vorschläge verwerfen' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)

    fireEvent.click(screen.getByRole('checkbox', { name: 'AN-00103 Aufzug 3 auswählen' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'AN-00104 Aufzug 4 auswählen' }))
    press('2 Vorschläge verwerfen')

    expect(await screen.findByText(proposalWords.noReason)).toBeTruthy()
    expect(written).toEqual([])

    fireEvent.change(screen.getByRole('textbox', { name: /^Begründung/ }), {
      target: { value: ' Die Aufzüge prüft der Vermieter. ' },
    })
    press('2 Vorschläge verwerfen')

    expect(await screen.findByText('2 Vorschläge verworfen.')).toBeTruthy()
    expect(written).toEqual([
      {
        method: 'POST',
        path: '/duty-dismissals/batch',
        body: {
          kind: mainTest,
          assetIds: ['a-3', 'a-4'],
          reason: 'Die Aufzüge prüft der Vermieter.',
        },
      },
    ])
  })

  it('says the refusal of the server and names nothing done', async () => {
    await listed()

    answerToWrite = answering(
      { message: 'AN-00103 Aufzug 3: Diese Pflicht ist an der Anlage schon bestätigt.' },
      409,
    )
    press('7 Vorschläge bestätigen')

    expect(
      await screen.findByText(
        'AN-00103 Aufzug 3: Diese Pflicht ist an der Anlage schon bestätigt.',
      ),
    ).toBeTruthy()
    expect(screen.queryByText('7 Pflichten bestätigt.')).toBeNull()
  })
})

describe('one proposal', () => {
  it('is dismissed from its row with its reason, and not without one', async () => {
    await listed()

    answerToWrite = answering({ id: 'dm-new' })
    press('Hauptprüfung der Aufzugsanlage an AN-00105 Aufzug 5 verwerfen')

    const dialog = await screen.findByRole('dialog', { name: 'Vorschlag verwerfen' })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Verwerfen' }))

    expect(await within(dialog).findByText(proposalWords.noReason)).toBeTruthy()
    expect(written).toEqual([])

    fireEvent.change(within(dialog).getByLabelText(/^Begründung/), {
      target: { value: 'Steht still und wird abgebaut.' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Verwerfen' }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    expect(written).toEqual([
      {
        method: 'POST',
        path: '/duty-dismissals',
        body: { assetId: 'a-5', kind: mainTest, reason: 'Steht still und wird abgebaut.' },
      },
    ])
  })
})

describe('whoever does not keep the register', () => {
  it.each(['site_management', 'technician'] as const)(
    'sees the proposals as "%s" with no way to decide on them',
    async (role) => {
      await listed(role)

      expect(screen.getByText(proposalWords.mayNot)).toBeTruthy()
      expect(screen.queryByRole('checkbox')).toBeNull()
      expect(screen.queryByRole('button', { name: /bestätigen$/ })).toBeNull()
      expect(screen.queryByRole('link', { name: /bestätigen$/ })).toBeNull()
      expect(screen.queryByRole('button', { name: /verwerfen$/ })).toBeNull()
    },
  )
})

describe('the proposals dismissed', () => {
  it('stand with their asset, kind, reason and day, and one is taken back at once', async () => {
    await mount('/pflichten/vorschlaege/verworfen')

    expect(await screen.findByText(dismissal.reason)).toBeTruthy()
    // The name of the kind comes with the catalogue of the device.
    await screen.findByText('Zwischenprüfung')
    expect(screen.getByText('1 verworfener Vorschlag an 1 Anlage')).toBeTruthy()
    expect(screen.getByText('06.10.2026')).toBeTruthy()

    answerToWrite = answering(dismissal, 200)
    press('Zurücknehmen: AN-00102 Aufzug 2, Zwischenprüfung')

    await waitFor(() => {
      expect(written).toEqual([
        { method: 'DELETE', path: '/duty-dismissals/dm-1', body: undefined },
      ])
    })
  })

  it.each(['desktop', 'phone'] as const)(
    'are not taken back by whoever does not keep the register, on a %s',
    async (device) => {
      onA(device)
      await mount('/pflichten/vorschlaege/verworfen', 'technician')

      expect(await screen.findByText(/Die Zwischenprüfung übernimmt der Hersteller/)).toBeTruthy()
      expect(screen.queryByRole('button', { name: /Zurücknehmen/ })).toBeNull()
    },
  )

  it('say so where there are none', async () => {
    await mount('/pflichten/vorschlaege/verworfen', 'technical_management', {
      '/duties/proposals': { proposals: [], dismissed: [] },
    })

    expect(await screen.findByText(dismissedWords.none)).toBeTruthy()
  })
})

describe('the way to the proposals', () => {
  it('stands in the head of the register with their number, for whoever keeps it', async () => {
    await mount('/pflichten', 'technical_management', {
      '/duties/register?offset=0&limit=50': emptyRegister,
    })

    expect((await screen.findByRole('link', { name: '8 Vorschläge' })).getAttribute('href')).toBe(
      '/pflichten/vorschlaege',
    )
  })

  it('is not offered in the head of the register to whoever does not keep it', async () => {
    await mount('/pflichten', 'technician', {
      '/duties/register?offset=0&limit=50': emptyRegister,
    })
    await screen.findByRole('heading', { level: 1, name: 'Pflichtenverzeichnis' })

    expect(screen.queryByRole('link', { name: /Vorschläge$/ })).toBeNull()
  })

  it('stands at a duty kind of the catalogue with the open and the dismissed', async () => {
    await mount(`/katalog/probe/pflichtarten/interim_check`, 'technician', {
      [`/duties/register?dutyKind=${interimCheck}&offset=0&limit=1`]: emptyRegister,
      [`/duties/proposals?dutyKind=${interimCheck}`]: {
        proposals: [{ kind: interimCheck, asset: lifts[0] }],
        dismissed: [dismissal],
      },
    })

    expect(
      (await screen.findByRole('link', { name: '1 offener Vorschlag' })).getAttribute('href'),
    ).toBe(`/pflichten/vorschlaege?pflichtart=${interimCheck}`)
    expect(screen.getByRole('link', { name: '1 verworfener Vorschlag' }).getAttribute('href')).toBe(
      `/pflichten/vorschlaege/verworfen?pflichtart=${interimCheck}`,
    )
  })
})

describe('the proposals as a table (#236)', () => {
  it('are asked for with what the list is narrowed by, the package of the screen included', async () => {
    await mount(`/pflichten/vorschlaege?liegenschaft=${depot.id}&paket=probe`, undefined, {
      [`/duties/proposals?propertyId=${depot.id}`]: proposals,
    })
    await screen.findByRole('heading', { level: 2, name: 'Hauptprüfung der Aufzugsanlage' })

    // After the answers of the test, which it hands every other request to.
    const tables = servingTables()

    fireEvent.click(await screen.findByRole('button', { name: 'Als Tabelle' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Excel (.xlsx)' }))

    await waitFor(() => {
      expect(tables.asked).toEqual([
        `/duties/proposals/table?propertyId=${depot.id}&package=probe&format=xlsx`,
      ])
    })
  })

  it('are asked for as the dismissed ones from the list of the dismissed', async () => {
    await mount('/pflichten/vorschlaege/verworfen')
    await screen.findByText('1 verworfener Vorschlag an 1 Anlage')

    const tables = servingTables()

    fireEvent.click(screen.getByRole('button', { name: 'Als Tabelle' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'CSV (.csv)' }))

    await waitFor(() => {
      expect(tables.asked).toEqual(['/duties/proposals/table?list=dismissed&format=csv'])
    })
  })
})
