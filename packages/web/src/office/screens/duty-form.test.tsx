import type { AssetDetails, DutyColleague, RoleKey } from '@opengewerk/haustechnik-domain'
import { TestServer } from '@opengewerk/platform-web/testing'
import { onlineManager } from '@tanstack/react-query'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { servingCatalogue } from '../../app/test-catalogue.js'
import {
  mountOffice,
  type NamedArea,
  onA,
  signedInOffice,
  type WriteAnswer,
  type Written,
} from '../test-office.js'
import { dutyFormWords } from './duty-form.js'

/**
 * The form of a duty of the operator's own (#103, 4.3 and 2.3 of the
 * concept): for whoever keeps the register, opened from the place the duty is
 * to hang on or from the register, sent to the route of the duties with what
 * it says, and not sent without its source.
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
const place = { propertyId: school.id, areaId: sued.id }
const house = { id: 'b-house', ...place, name: 'Schulhaus', kinds: '["school"]', yearBuilt: 1975 }
const gym = { id: 'b-gym', ...place, name: 'Turnhalle', kinds: '["sports"]', yearBuilt: 1982 }
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

const everything = ['properties', 'buildings', 'floors', 'rooms', 'assets', 'duties'] as const

/** A water heater in the boiler room, as its file reads it. */
function heater(further: Readonly<Record<string, unknown>> = {}): AssetDetails {
  return {
    id: 'a-heater',
    ...place,
    buildingId: house.id,
    roomId: boilerRoom.id,
    kind: 'probe.elevator',
    number: 'AN-00057',
    name: 'Trinkwassererwärmer',
    ...further,
  } as unknown as AssetDetails
}

const colleagues: readonly DutyColleague[] = [
  { userId: 'u-roth', name: 'Dennis Roth', active: true },
  { userId: 'u-gone', name: 'Gerd Fort', active: false },
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
    { ...servingCatalogue(), '/duties/colleagues': colleagues, ...answers },
    (write) => answerToWrite(write),
  )

  const mounted = await mountOffice(at, server, everything)

  return mounted.router
}

/** The form at an address, once it stands. */
async function opened(at: string, role?: RoleKey, answers?: Readonly<Record<string, unknown>>) {
  const router = await mount(at, role, answers)

  await screen.findByRole('button', { name: 'Pflicht anlegen' })

  return router
}

function choice(name: string): HTMLSelectElement {
  return screen.getByRole('combobox', { name })
}

function choose(name: string, value: string): void {
  fireEvent.change(choice(name), { target: { value } })
}

function type(name: string, value: string): void {
  fireEvent.change(screen.getByLabelText(name), { target: { value } })
}

function pick(name: string): void {
  fireEvent.click(screen.getByRole('radio', { name }))
}

function press(name: string): void {
  fireEvent.click(screen.getByRole('button', { name }))
}

/** What a duty has to say before it is taken: a cleaning of the gutters, as the insurer demands it. */
function fillIn(): void {
  type('Bezeichnung', ' Dachrinnen reinigen ')
  choose('Tätigkeit', 'maintenance')
  choose('Grundlage', 'insurer')
  type('Quelle', ' Gebäudeversicherung, Vertrag 4711 ')
  type('Frist', '12')
}

/** What the form sends for it, beyond what it hangs on. */
const filledIn = {
  label: 'Dachrinnen reinigen',
  task: 'maintenance',
  basis: 'insurer',
  sourceNote: 'Gebäudeversicherung, Vertrag 4711',
  counting: 'from_performance',
  intervalMonths: 12,
  responsibleUserId: null,
  performer: null,
  performerNote: null,
}

/** The places the form offers to hang the duty on, with the one that is picked. */
function offeredPlaces(): { readonly names: string[]; readonly picked: string | undefined } {
  const nameOf = (radio: HTMLInputElement) =>
    document.getElementById(radio.getAttribute('aria-labelledby') ?? '')?.textContent ?? ''
  // The two radios of who performs it stand in the same form.
  const radios = screen
    .getAllByRole<HTMLInputElement>('radio')
    .filter((radio) => !['Eigene Leute', 'Fremdfirma'].includes(nameOf(radio)))

  return {
    names: radios.map(nameOf),
    picked: radios.filter((radio) => radio.checked).map(nameOf)[0],
  }
}

beforeEach(() => {
  localStorage.clear()
  onA('desktop')
  server = new TestServer()
  server.put('properties', school)

  for (const building of [house, gym]) {
    server.put('buildings', building)
  }

  server.put('floors', ground)
  server.put('rooms', boilerRoom)
  answerToWrite = answering({ message: 'Dieser Test hat keinen Schreibzugriff erwartet.' }, 500)
})

afterEach(() => {
  vi.unstubAllGlobals()
  onlineManager.setOnline(true)
})

describe('who makes a duty of the operator own', () => {
  it.each(['management', 'technical_management'] as const)(
    'is whoever keeps the register: "%s" is given the form',
    async (role) => {
      await opened(`/pflichten/neu?gebaeude=${house.id}`, role)

      expect(screen.getByRole('heading', { level: 1, name: dutyFormWords.title })).toBeTruthy()
    },
  )

  it.each(['site_management', 'technician'] as const)(
    'is nobody else: "%s" is told so and given no form',
    async (role) => {
      await mount(`/pflichten/neu?gebaeude=${house.id}`, role)

      expect(await screen.findByText(dutyFormWords.mayNot)).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Pflicht anlegen' })).toBeNull()
      expect(screen.queryByLabelText('Bezeichnung')).toBeNull()
    },
  )
})

describe('the form of a duty of the operator own', () => {
  it('opened from a building, offers the building and its property, sends what it says to the route of the duties and opens the page of the duty', async () => {
    const router = await opened(`/pflichten/neu?gebaeude=${house.id}`)

    expect(offeredPlaces()).toEqual({ names: ['Gebäude', 'Liegenschaft'], picked: 'Gebäude' })

    answerToWrite = answering({ id: 'd-new' })
    fillIn()
    press('Pflicht anlegen')

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/pflichten/d-new')
    })
    expect(written).toEqual([
      { method: 'POST', path: '/duties', body: { buildingId: house.id, ...filledIn } },
    ])
  })

  it('opened from an asset, offers the asset, its room, its building and its property, and hangs the duty on the one chosen', async () => {
    await opened('/pflichten/neu?anlage=a-heater', 'management', { '/assets/a-heater': heater() })

    expect(offeredPlaces()).toEqual({
      names: ['Anlage', 'Raum', 'Gebäude', 'Liegenschaft'],
      picked: 'Anlage',
    })
    // Each place by what it is called, under what it is.
    const places = within(screen.getByRole('group', { name: dutyFormWords.hangsOn }))

    expect(places.getByText('AN-00057 Trinkwassererwärmer')).toBeTruthy()
    expect(places.getByText('E.14 Heizraum')).toBeTruthy()

    answerToWrite = answering({ id: 'd-new' })
    fillIn()
    pick('Raum')
    press('Pflicht anlegen')

    await waitFor(() => {
      expect(written).toHaveLength(1)
    })
    expect(written).toEqual([
      { method: 'POST', path: '/duties', body: { roomId: boilerRoom.id, ...filledIn } },
    ])
  })

  it('hangs the duty on the asset it was opened from where nothing else is chosen', async () => {
    await opened('/pflichten/neu?anlage=a-heater', 'management', { '/assets/a-heater': heater() })

    answerToWrite = answering({ id: 'd-new' })
    fillIn()
    press('Pflicht anlegen')

    await waitFor(() => {
      expect(written).toHaveLength(1)
    })
    expect(written[0]?.body).toEqual({ assetId: 'a-heater', ...filledIn })
  })

  it('opened from a room, offers the room, its building and its property', async () => {
    await opened(`/pflichten/neu?raum=${boilerRoom.id}`)

    expect(offeredPlaces()).toEqual({ names: ['Raum', 'Gebäude', 'Liegenschaft'], picked: 'Raum' })

    answerToWrite = answering({ id: 'd-new' })
    fillIn()
    pick('Liegenschaft')
    press('Pflicht anlegen')

    await waitFor(() => {
      expect(written).toHaveLength(1)
    })
    expect(written[0]?.body).toEqual({ propertyId: school.id, ...filledIn })
  })

  it('opened from the register, asks for the property and hangs the duty on it, or on the building chosen', async () => {
    await opened('/pflichten/neu')

    // One property is the one: nothing to choose.
    expect(choice('Liegenschaft').value).toBe(school.id)
    expect([...choice('Gebäude').options].map((option) => option.text)).toEqual([
      dutyFormWords.wholeProperty,
      'Schulhaus',
      'Turnhalle',
    ])
    expect(screen.getByText(dutyFormWords.elsewhere)).toBeTruthy()

    answerToWrite = answering({ id: 'd-new' })
    fillIn()
    choose('Gebäude', gym.id)
    press('Pflicht anlegen')

    await waitFor(() => {
      expect(written).toHaveLength(1)
    })
    expect(written[0]?.body).toEqual({ buildingId: gym.id, ...filledIn })
  })

  it('hangs a duty made from the register on the property itself where no building is chosen', async () => {
    await opened('/pflichten/neu')

    answerToWrite = answering({ id: 'd-new' })
    fillIn()
    press('Pflicht anlegen')

    await waitFor(() => {
      expect(written).toHaveLength(1)
    })
    expect(written[0]?.body).toEqual({ propertyId: school.id, ...filledIn })
  })

  it('asks which property where the operator has more than one, and sends nothing before it is said', async () => {
    server.put('properties', depot)
    await opened('/pflichten/neu')

    expect(choice('Liegenschaft').value).toBe('')

    fillIn()
    press('Pflicht anlegen')

    expect(await screen.findByText(dutyFormWords.noProperty)).toBeTruthy()
    expect(written).toEqual([])
  })

  it('is not sent without its source, and says so at the field', async () => {
    await opened(`/pflichten/neu?gebaeude=${house.id}`)

    fillIn()
    type('Quelle', '   ')
    press('Pflicht anlegen')

    expect(await screen.findByText(dutyFormWords.noSource)).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe(dutyFormWords.check)
    expect(written).toEqual([])
  })

  it('is not sent without its name, its task, its basis or its interval, and names each', async () => {
    await opened(`/pflichten/neu?gebaeude=${house.id}`)

    press('Pflicht anlegen')

    for (const words of [
      dutyFormWords.noLabel,
      dutyFormWords.noTask,
      dutyFormWords.noBasis,
      dutyFormWords.noSource,
      dutyFormWords.noInterval,
    ]) {
      expect(await screen.findByText(words)).toBeTruthy()
    }

    expect(written).toEqual([])
  })

  it.each([
    ['0', 'Die Frist ist eine ganze Zahl von Monaten, mindestens 1.'],
    ['ein Jahr', 'Die Frist ist eine ganze Zahl von Monaten, mindestens 1.'],
  ])('refuses the interval "%s" as the model does', async (typed, sentence) => {
    await opened(`/pflichten/neu?gebaeude=${house.id}`)

    fillIn()
    type('Frist', typed)
    press('Pflicht anlegen')

    expect(await screen.findByText(sentence)).toBeTruthy()
    expect(written).toEqual([])
  })

  it('counts in days where the unit says so, from the due day where that is chosen, and in months only under § 14 Abs. 5 BetrSichV', async () => {
    await opened(`/pflichten/neu?gebaeude=${house.id}`)

    fillIn()
    type('Frist', '90')
    choose('Einheit', 'days')
    choose('Gezählt', 'betrsichv')
    press('Pflicht anlegen')

    expect(
      await screen.findByText('Nach § 14 Abs. 5 BetrSichV zählt die Frist in Monaten.'),
    ).toBeTruthy()
    expect(written).toEqual([])

    answerToWrite = answering({ id: 'd-new' })
    choose('Gezählt', 'from_due')
    press('Pflicht anlegen')

    await waitFor(() => {
      expect(written).toHaveLength(1)
    })

    const { intervalMonths: _, ...withoutMonths } = filledIn

    expect(written[0]?.body).toEqual({
      buildingId: house.id,
      ...withoutMonths,
      counting: 'from_due',
      intervalDays: 90,
    })
  })

  it('names who answers from the people who can still be named, and who performs it', async () => {
    await opened(`/pflichten/neu?gebaeude=${house.id}`)

    await waitFor(() => {
      // Whoever is shut out of the operator is offered to nobody.
      expect([...choice('Verantwortlich').options].map((option) => option.text)).toEqual([
        'Niemand',
        'Dennis Roth',
        'Petra Lindner',
      ])
    })

    answerToWrite = answering({ id: 'd-new' })
    fillIn()
    choose('Verantwortlich', 'u-lindner')
    pick('Fremdfirma')
    type('Angabe zur Fremdfirma', ' Dachdecker Beispiel GmbH ')
    press('Pflicht anlegen')

    await waitFor(() => {
      expect(written).toHaveLength(1)
    })
    expect(written[0]?.body).toEqual({
      buildingId: house.id,
      ...filledIn,
      responsibleUserId: 'u-lindner',
      performer: 'contractor',
      performerNote: 'Dachdecker Beispiel GmbH',
    })
  })

  it('names a contractor only for a duty a contractor performs', async () => {
    await opened(`/pflichten/neu?gebaeude=${house.id}`)

    expect(screen.queryByLabelText('Angabe zur Fremdfirma')).toBeNull()

    answerToWrite = answering({ id: 'd-new' })
    fillIn()
    pick('Fremdfirma')
    type('Angabe zur Fremdfirma', 'Dachdecker Beispiel GmbH')
    pick('Eigene Leute')

    expect(screen.queryByLabelText('Angabe zur Fremdfirma')).toBeNull()

    press('Pflicht anlegen')

    await waitFor(() => {
      expect(written).toHaveLength(1)
    })
    expect(written[0]?.body).toEqual({
      buildingId: house.id,
      ...filledIn,
      performer: 'own_staff',
      performerNote: null,
    })
  })

  it('shows what the server refuses with, and stays', async () => {
    const router = await opened(`/pflichten/neu?gebaeude=${house.id}`)

    answerToWrite = answering({ message: 'Die Quelle einer eigenen Pflicht fehlt.' }, 400)
    fillIn()
    press('Pflicht anlegen')

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Die Quelle einer eigenen Pflicht fehlt.',
    )
    expect(router.state.location.pathname).toBe('/pflichten/neu')
  })

  it('says without a connection that it needs one, and cannot be sent', async () => {
    await opened(`/pflichten/neu?gebaeude=${house.id}`)

    window.dispatchEvent(new Event('offline'))

    expect(await screen.findByText(dutyFormWords.noConnection)).toBeTruthy()
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Pflicht anlegen' }).disabled,
    ).toBe(true)
  })

  it('says of an asset with a general kind that it carries duties of its own from the start, and of no other asset', async () => {
    await opened('/pflichten/neu?anlage=a-heater', 'management', {
      '/assets/a-heater': heater({ kind: 'allgemein.kg_420' }),
    })

    expect(screen.getByText(dutyFormWords.generalKind)).toBeTruthy()
  })

  it('says nothing about a general kind at an asset of a kind of its own', async () => {
    await opened('/pflichten/neu?anlage=a-heater', 'management', { '/assets/a-heater': heater() })

    expect(screen.queryByText(dutyFormWords.generalKind)).toBeNull()
  })

  it('leads back to where it was opened from', async () => {
    const router = await opened(`/pflichten/neu?raum=${boilerRoom.id}`)

    press('Abbrechen')

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/raeume/${boilerRoom.id}`)
    })
    expect(written).toEqual([])
  })

  it('says so of a place this device does not hold, and offers no form', async () => {
    await mount('/pflichten/neu?raum=r-nowhere')

    expect(await screen.findByText(dutyFormWords.placeUnread)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Pflicht anlegen' })).toBeNull()
  })
})
