import type {
  AssetDetails,
  CatalogueBundle,
  CatalogueEntry,
  DutyColleague,
  DutyDetails,
  DutyKind,
  RoleKey,
} from '@opengewerk/haustechnik-domain'
import { TestServer } from '@opengewerk/platform-web/testing'
import { onlineManager } from '@tanstack/react-query'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { servingCatalogue, testCatalogue } from '../../app/test-catalogue.js'
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
import { proposalWords } from './proposals.js'

/**
 * Confirming a proposal with its interval, and the interval of a duty from
 * the catalogue set again (#102, 4.3 and 2.3 of the concept): a maximum may
 * only be shortened, a guide needs a reason where the interval departs from
 * it, and a kind without a value always does; who answers for the duty and
 * who performs it go with it. Only whoever keeps the register is given the
 * forms.
 *
 * The catalogue is the one of the tests, with the main test of an elevator
 * (a maximum of 24 months, counted under § 14 Abs. 5 BetrSichV), and beside
 * it, for this test alone, a visual check with a guide of 24 months and a
 * check of the operator without a value.
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

const mainTest = 'probe.elevator_main_test'
const visualCheck = 'probe.visual_check'
const ownCheck = 'probe.own_check'

/** The catalogue of the tests with a kind with a guide and one without a value beside the main test. */
const withMoreKinds: CatalogueBundle = {
  ...testCatalogue,
  sha256: '2'.repeat(64),
  packages: testCatalogue.packages.map((pack) => {
    const main = pack.dutyKinds.find((entry) => entry.key === mainTest)

    if (main === undefined || main.definition.interval.kind === 'none') {
      return pack
    }

    const like = (
      key: string,
      label: string,
      changes: Partial<DutyKind>,
    ): CatalogueEntry<DutyKind> => ({
      ...main,
      key,
      definition: {
        ...main.definition,
        label,
        counting: 'from_performance',
        scope: { ...main.definition.scope, conditions: [], buildingKinds: [], states: [] },
        ...changes,
      },
    })

    return {
      ...pack,
      dutyKinds: [
        ...pack.dutyKinds,
        like(visualCheck, 'Sichtprüfung der Aufzugsanlage', {
          interval: { kind: 'guide', rule: main.definition.interval.rule },
        }),
        like(ownCheck, 'Kontrolle durch den Betreiber', { interval: { kind: 'none' } }),
      ],
    }
  }),
}

const lift = {
  id: 'a-lift',
  ...place,
  buildingId: house.id,
  roomId: null,
  kind: 'probe.elevator',
  number: 'AN-00012',
  name: 'Aufzug Schulhaus',
} as unknown as AssetDetails

const colleagues: readonly DutyColleague[] = [
  { userId: 'u-roth', name: 'Dennis Roth', active: true },
  { userId: 'u-lindner', name: 'Petra Lindner', active: true },
]

/** The main test of the lift, confirmed with 12 of 24 months and a reason. */
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
    intervalReason: 'Das Gesundheitsamt verlangt die jährliche Prüfung.',
    maximumDays: null,
    maximumMonths: 24,
    responsibleUserId: 'u-roth',
    performer: 'own_staff',
    performerNote: null,
    contractorId: null,
    confirmedBy: 'u-lead',
    confirmedAt: '2026-09-14T08:00:00.000Z',
    endsOn: null,
    endReason: null,
    title: 'Hauptprüfung der Aufzugsanlage',
    state: 'never_recorded',
    appointment: null,
    lastMetOn: null,
    ended: false,
    removable: false,
    intervalDocumentId: null,
    intervalDocumentVersionId: null,
    intervalDocument: null,
    intervalToCheck: false,
    contractId: null,
    contractEnded: false,
    contract: null,
    asset: {
      id: lift.id,
      number: 'AN-00012',
      name: 'Aufzug Schulhaus',
      kind: 'probe.elevator',
      buildingId: house.id,
      roomId: null,
    },
    responsible: { userId: 'u-roth', name: 'Dennis Roth' },
    activity: null,
    ...further,
  } as unknown as DutyDetails
}

/** A duty of the operator's own at the same lift. */
const own = duty({
  kind: null,
  kindVersion: null,
  label: 'Eigene Kontrolle',
  title: 'Eigene Kontrolle',
  basis: 'own_decision',
  sourceNote: 'Hausordnung',
  task: 'visual_check',
  counting: 'from_performance',
  maximumMonths: null,
})

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
      ...servingCatalogue(withMoreKinds),
      '/duties/colleagues': colleagues,
      // The firms of the operator (#328).
      '/contractors': [{ id: 'c-sued', name: 'Prüfdienst Süd', services: [] }],
      [`/assets/${lift.id}`]: lift,
      '/duties/d-1': duty(),
      '/duties/d-1/evidence': [],
      ...answers,
    },
    (write) => answerToWrite(write),
  )

  return (await mountOffice(at, server, ['properties', 'buildings'])).router
}

/** The form that confirms a kind for the lift, once it stands with the kind of the catalogue. */
async function confirming(kind: string, role?: RoleKey) {
  const router = await mount(`/pflichten/bestaetigen?anlage=${lift.id}&pflichtart=${kind}`, role)

  await screen.findByRole('button', { name: 'Pflicht bestätigen' })

  return router
}

function type(name: RegExp, value: string): void {
  fireEvent.change(screen.getByLabelText(name), { target: { value } })
}

function press(name: string): void {
  fireEvent.click(screen.getByRole('button', { name }))
}

function interval(): string {
  return (screen.getByLabelText(/^Frist/) as HTMLInputElement).value
}

beforeEach(() => {
  localStorage.clear()
  onA('desktop')
  server = new TestServer()
  server.put('properties', school)
  server.put('buildings', house)
  answerToWrite = answering({ message: 'Dieser Test hat keinen Schreibzugriff erwartet.' }, 500)
})

afterEach(() => {
  vi.unstubAllGlobals()
  onlineManager.setOnline(true)
})

describe('confirming a proposal', () => {
  it('starts from the maximum, may shorten it without a reason and sends it with who answers and performs', async () => {
    const router = await confirming(mainTest)

    expect(interval()).toBe('24')
    expect(screen.getByText('Höchstfrist: 24 Monate')).toBeTruthy()
    expect(
      screen.getByText('Hauptprüfung der Aufzugsanlage an AN-00012 Aufzug Schulhaus'),
    ).toBeTruthy()

    answerToWrite = answering({ id: 'd-new' })
    type(/^Frist/, '12')
    fireEvent.change(screen.getByRole('combobox', { name: 'Verantwortlich' }), {
      target: { value: 'u-roth' },
    })
    fireEvent.click(screen.getByRole('radio', { name: 'Eigene Leute' }))
    press('Pflicht bestätigen')

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/pflichten/d-new')
    })
    expect(written).toEqual([
      {
        method: 'POST',
        path: '/duties',
        body: {
          assetId: lift.id,
          kind: mainTest,
          intervalMonths: 12,
          intervalReason: null,
          intervalDocumentId: null,
          responsibleUserId: 'u-roth',
          performer: 'own_staff',
          performerNote: null,
          contractorId: null,
        },
      },
    ])
  })

  it('never sends an interval longer than the maximum', async () => {
    await confirming(mainTest)

    type(/^Frist/, '30')
    press('Pflicht bestätigen')

    expect(
      await screen.findByText(
        'Die Höchstfrist beträgt 24 Monate, länger darf die Frist nicht sein; eine Höchstfrist lässt sich nur verkürzen.',
      ),
    ).toBeTruthy()
    expect(written).toEqual([])
  })

  it('asks a reason for an interval that departs from the guide, and none for the guide itself', async () => {
    await confirming(visualCheck)

    expect(interval()).toBe('24')
    expect(screen.getByText('Richtwert: 24 Monate')).toBeTruthy()

    type(/^Frist/, '12')

    expect(screen.getByText('Weicht vom Richtwert ab: 24 Monate')).toBeTruthy()

    press('Pflicht bestätigen')

    expect(
      await screen.findByText(
        'Der Richtwert beträgt 24 Monate; eine Frist, die davon abweicht, braucht eine Begründung.',
      ),
    ).toBeTruthy()
    expect(written).toEqual([])

    answerToWrite = answering({ id: 'd-new' })
    type(/^Begründung der Frist/, 'Viel befahren, Gefährdungsbeurteilung 2026')
    press('Pflicht bestätigen')

    await waitFor(() => {
      expect(written).toHaveLength(1)
    })
    expect(written[0]?.body).toMatchObject({
      kind: visualCheck,
      intervalMonths: 12,
      intervalReason: 'Viel befahren, Gefährdungsbeurteilung 2026',
    })
  })

  it('takes the guide as it is without a reason', async () => {
    await confirming(visualCheck)

    answerToWrite = answering({ id: 'd-new' })
    press('Pflicht bestätigen')

    await waitFor(() => {
      expect(written).toHaveLength(1)
    })
    expect(written[0]?.body).toMatchObject({ intervalMonths: 24, intervalReason: null })
  })

  it('leaves the interval of a kind without a value to the operator, always with a reason', async () => {
    await confirming(ownCheck)

    expect(interval()).toBe('')

    press('Pflicht bestätigen')

    expect(await screen.findByText(confirmWords.noInterval)).toBeTruthy()

    type(/^Frist/, '6')
    press('Pflicht bestätigen')

    expect(
      await screen.findByText(
        'Die Frist dieser Pflichtart legt der Betreiber fest; sie braucht eine Begründung, etwa den Verweis auf die Gefährdungsbeurteilung.',
      ),
    ).toBeTruthy()
    expect(written).toEqual([])
  })

  it('dismisses the proposal from the form with its reason and goes back to the proposals', async () => {
    const router = await confirming(mainTest)

    answerToWrite = answering({ id: 'dm-new' })
    press('Verwerfen')

    const dialog = await screen.findByRole('dialog', { name: 'Vorschlag verwerfen' })

    fireEvent.change(within(dialog).getByLabelText(/^Begründung/), {
      target: { value: 'Prüft der Vermieter.' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Verwerfen' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/pflichten/vorschlaege')
    })
    expect(written).toEqual([
      {
        method: 'POST',
        path: '/duty-dismissals',
        body: { assetId: lift.id, kind: mainTest, reason: 'Prüft der Vermieter.' },
      },
    ])
  })

  it.each(['site_management', 'technician'] as const)(
    'is for whoever keeps the register: "%s" is given no form',
    async (role) => {
      await mount(`/pflichten/bestaetigen?anlage=${lift.id}&pflichtart=${mainTest}`, role)

      expect(await screen.findByText(confirmWords.mayNot)).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Pflicht bestätigen' })).toBeNull()
      expect(screen.queryByText(proposalWords.mayNot)).toBeNull()
    },
  )
})

describe('the interval of a duty from the catalogue', () => {
  it('is set again within the kept maximum, and only what changes is sent', async () => {
    const router = await mount('/pflichten/d-1/frist')

    await screen.findByRole('button', { name: 'Speichern' })

    expect(interval()).toBe('12')
    expect(screen.getByText('Höchstfrist: 24 Monate, am Tag der Bestätigung')).toBeTruthy()

    type(/^Frist/, '30')
    press('Speichern')

    expect(await screen.findByText(/Die Höchstfrist beträgt 24 Monate/)).toBeTruthy()
    expect(written).toEqual([])

    answerToWrite = answering(duty(), 200)
    type(/^Frist/, '18')
    fireEvent.click(screen.getByRole('radio', { name: 'Fremdfirma' }))
    await screen.findByRole('option', { name: 'Prüfdienst Süd' })
    fireEvent.change(screen.getByRole('combobox', { name: 'Fremdfirma' }), {
      target: { value: 'c-sued' },
    })
    press('Speichern')

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/pflichten/d-1')
    })
    expect(written).toEqual([
      {
        method: 'PATCH',
        path: '/duties/d-1',
        body: { intervalMonths: 18, performer: 'contractor', contractorId: 'c-sued' },
      },
    ])
  })

  it('is reached from the card "Frist" of its page, for whoever keeps the register', async () => {
    await mount('/pflichten/d-1')

    expect((await screen.findByRole('link', { name: 'Frist ändern' })).getAttribute('href')).toBe(
      '/pflichten/d-1/frist',
    )
  })

  it.each(['site_management', 'technician'] as const)('is not offered to "%s"', async (role) => {
    await mount('/pflichten/d-1', role)
    await untilTheRightsAreKnown()
    await screen.findByRole('heading', { level: 1, name: 'Hauptprüfung der Aufzugsanlage' })

    expect(screen.queryByRole('link', { name: 'Frist ändern' })).toBeNull()
  })

  it('has its form say why to whoever does not keep the register', async () => {
    await mount('/pflichten/d-1/frist', 'technician')

    expect(await screen.findByText(confirmWords.mayNotChange)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Speichern' })).toBeNull()
  })

  it('is not offered at a duty of the operator own, which has its form', async () => {
    await mount('/pflichten/d-1', 'technical_management', { '/duties/d-1': own })
    await screen.findByRole('heading', { level: 1, name: 'Eigene Kontrolle' })

    expect(screen.queryByRole('link', { name: 'Frist ändern' })).toBeNull()
  })

  it('is not set here for a duty of the operator own', async () => {
    await mount('/pflichten/d-1/frist', 'technical_management', { '/duties/d-1': own })

    expect(await screen.findByText(confirmWords.ownDuty)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Speichern' })).toBeNull()
  })
})
