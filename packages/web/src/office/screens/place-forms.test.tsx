import { buildingKinds } from '@opengewerk/haustechnik-domain'
import { RequestRefused } from '@opengewerk/platform-web/sync'
import { TestServer } from '@opengewerk/platform-web/testing'
import { onlineManager } from '@tanstack/react-query'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { memberIn } from '../../app/test-entry.js'
import {
  mountOffice,
  type NamedArea,
  signedInOffice,
  untilTheRightsAreKnown,
  type WriteAnswer,
  type Written,
} from '../test-office.js'

/**
 * The forms a building, a floor and a room are made, changed and removed
 * with in the office (#86, 4.1 of the concept), and the question a room is
 * moved to another floor with.
 *
 * A building and a floor are kept by the office and with a connection: made
 * at the route of the place above, changed and removed at their own. A room
 * is taken stock of on site as well, so it is made and corrected through the
 * outbox; moving and removing it is for whoever keeps the places, at a route.
 */

const nord: NamedArea = { id: 'a-nord', name: 'Nord' }
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

// The kinds of a building reach a device as the text of a list.
const house = {
  id: 'b-house',
  ...place,
  name: 'Schulhaus',
  shortCode: 'S',
  kinds: '["school"]',
  yearBuilt: 1975,
}
/** Its kinds stand in another order than the form lists them in. */
const gym = {
  id: 'b-gym',
  ...place,
  name: 'Sporthalle',
  shortCode: null,
  kinds: '["assembly","school"]',
  yearBuilt: null,
}

const inHouse = { ...place, buildingId: house.id }
const basement = { id: 'f-basement', ...inHouse, name: 'Untergeschoss', level: -1 }
const ground = { id: 'f-ground', ...inHouse, name: 'Erdgeschoss', level: 0 }
const first = { id: 'f-first', ...inHouse, name: '1. Obergeschoss', level: 1 }
const gymGround = { id: 'f-gym', ...place, buildingId: gym.id, name: 'Erdgeschoss', level: 0 }

const onGround = { ...inHouse, floorId: ground.id }
const store = { id: 'r-store', ...onGround, number: 'E.2', name: 'Lager', use: null }
const boilerRoom = {
  id: 'r-boiler',
  ...onGround,
  number: 'E.14',
  name: 'Heizraum',
  use: 'Haustechnik',
}
const hall = {
  id: 'r-hall',
  ...place,
  buildingId: gym.id,
  floorId: gymGround.id,
  number: 'H.01',
  name: 'Halle',
  use: null,
}

const asset = { ...inHouse, parentAssetId: null, kind: 'probe.elevator', roomId: boilerRoom.id }
const boiler = { id: 's-boiler', ...asset, number: 'AN-00010', name: 'Heizkessel' }
const meter = { id: 's-meter', ...asset, number: 'AN-00009', name: 'Hauptwasserzähler' }
const pump = { id: 's-pump', ...asset, number: 'AN-00011', name: 'Pumpe' }
/** Stands in the hall of the gym, the one room of a building with one floor. */
const scoreboard = {
  id: 's-board',
  ...asset,
  buildingId: gym.id,
  roomId: hall.id,
  number: 'AN-00030',
  name: 'Anzeigetafel',
}

const everything = ['properties', 'buildings', 'floors', 'rooms', 'assets'] as const

let server: TestServer
/** What a route answers a write with, set by the test that expects one. */
let answerToWrite: (write: Written) => WriteAnswer
/** What was written to a route, in order. */
let written: Written[]

/** Somebody signed in in one of the roles, with the routes a form writes to. */
function signedIn(role: Parameters<typeof signedInOffice>[0]) {
  written = signedInOffice(role, [nord, sued], {}, (write) => answerToWrite(write))
}

/**
 * Somebody in a role that lacks one right. Every role a tenant starts with
 * takes stock of rooms; a role of its own (phase 2) may not, and the forms
 * hold for that as well.
 */
function signedInWithout(right: string) {
  const technician = memberIn('technician')

  written = signedInOffice(
    'technician',
    [nord, sued],
    {
      '/auth/tenants': [
        { ...technician, rights: technician.rights.filter((held) => held !== right) },
      ],
    },
    (write) => answerToWrite(write),
  )
}

async function mount(at: string) {
  return (await mountOffice(at, server, everything)).router
}

/** The office says "Keine Verbindung" once it has noticed that there is none. */
async function untilTheOfficeKnowsItIsOffline(): Promise<void> {
  window.dispatchEvent(new Event('offline'))
  await screen.findAllByText(/^Keine Verbindung/)
}

/** A server that takes a change and a removal at the route of a record, and says what it was asked. */
function takingChanges() {
  const asked: { what: string; entity: string; id: string; values?: unknown }[] = []

  server.patch = (entity, id, values) => {
    asked.push({ what: 'change', entity, id, values })
    server.put(entity, {
      ...server.row(entity, id),
      ...values,
      // On a device the kinds of a building are the text of a list.
      ...('kinds' in values ? { kinds: JSON.stringify(values['kinds']) } : {}),
    })

    return Promise.resolve(server.row(entity, id))
  }

  server.remove = (entity, id) => {
    asked.push({ what: 'removal', entity, id })
    server.put(entity, { ...server.row(entity, id), deletedAt: '2026-10-05T10:00:00.000Z' })

    return Promise.resolve(server.row(entity, id))
  }

  return asked
}

/** A route that makes a record of a kind under an id, and puts it where the next exchange finds it. */
function making(entity: string, id: string, further: object = {}) {
  return (write: Written): WriteAnswer => {
    const made = { ...further, ...(write.body as Record<string, unknown>), id }

    server.put(entity, 'kinds' in made ? { ...made, kinds: JSON.stringify(made['kinds']) } : made)

    return { status: 201, body: made }
  }
}

const field = (name: string) => screen.getByRole('textbox', { name }) as HTMLInputElement
const kind = (name: string) => screen.getByRole('checkbox', { name }) as HTMLInputElement
const ticked = () =>
  (screen.getAllByRole('checkbox') as HTMLInputElement[])
    .filter((box) => box.checked)
    .map((box) => box.closest('label')?.textContent)

/** The steps of the path over the page. */
function path(): (string | null)[] {
  return within(screen.getByRole('navigation', { name: 'Pfad' }))
    .getAllByRole('link')
    .map((link) => link.textContent)
}

beforeEach(() => {
  localStorage.clear()
  server = new TestServer()
  answerToWrite = () => ({ status: 500, body: { message: 'Nicht erwartet.' } })

  server.put('properties', school)

  for (const building of [house, gym]) {
    server.put('buildings', building)
  }

  for (const floor of [first, gymGround, basement, ground]) {
    server.put('floors', floor)
  }

  for (const room of [boilerRoom, store, hall]) {
    server.put('rooms', room)
  }

  for (const each of [boiler, meter, pump]) {
    server.put('assets', each)
  }

  signedIn('technical_management')
})

afterEach(() => {
  vi.unstubAllGlobals()
  // One manager for every test of the file: a test that took the network
  // away would leave the questions of all that follow waiting for one.
  onlineManager.setOnline(true)
})

describe('the way into the forms', () => {
  it('offers whoever keeps the places a new building on the page of a property', async () => {
    const user = userEvent.setup()
    const router = await mount(`/liegenschaften/${school.id}`)

    await user.click(await screen.findByRole('button', { name: 'Neues Gebäude' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/liegenschaften/p-school/gebaeude/neu')
    })
  })

  it('offers the form of a building and a new floor on the page of the building', async () => {
    const user = userEvent.setup()
    const router = await mount(`/gebaeude/${house.id}`)

    await user.click(await screen.findByRole('button', { name: 'Geschoss anlegen' }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/gebaeude/b-house/geschosse/neu')
    })

    await router.navigate({ to: `/gebaeude/${house.id}` })
    await user.click(await screen.findByRole('button', { name: 'Bearbeiten' }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/gebaeude/b-house/bearbeiten')
    })
  })

  it('offers a first floor in a building that has none', async () => {
    server.put('buildings', { ...gym, id: 'b-shed', name: 'Schuppen' })
    await mount('/gebaeude/b-shed')

    expect(screen.getByText('In diesem Gebäude ist noch kein Geschoss angelegt.')).toBeTruthy()
    expect(await screen.findByRole('button', { name: 'Geschoss anlegen' })).toBeTruthy()
  })

  it('offers the form of a floor and a new room on the page of the floor', async () => {
    const user = userEvent.setup()
    const router = await mount(`/geschosse/${ground.id}`)

    await user.click(await screen.findByRole('button', { name: 'Neuer Raum' }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/geschosse/f-ground/raeume/neu')
    })

    await router.navigate({ to: `/geschosse/${ground.id}` })
    await user.click(await screen.findByRole('button', { name: 'Bearbeiten' }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/geschosse/f-ground/bearbeiten')
    })
  })

  it('offers the form of a room on its page', async () => {
    const user = userEvent.setup()
    const router = await mount(`/raeume/${boilerRoom.id}`)

    await user.click(await screen.findByRole('button', { name: 'Bearbeiten' }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/raeume/r-boiler/bearbeiten')
    })
  })

  // Section 7 of the concept: the Objektleitung takes stock of rooms and
  // keeps no building and no floor.
  it('offers whoever takes stock a new room and the form of a room, and nothing of a building or a floor', async () => {
    signedIn('site_management')

    const router = await mount(`/liegenschaften/${school.id}`)

    await untilTheRightsAreKnown()
    expect(screen.queryByRole('button', { name: 'Neues Gebäude' })).toBeNull()

    await router.navigate({ to: `/gebaeude/${house.id}` })
    await screen.findByRole('heading', { level: 1, name: 'Schulhaus' })
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Geschoss anlegen' })).toBeNull()

    await router.navigate({ to: `/geschosse/${ground.id}` })
    expect(await screen.findByRole('button', { name: 'Neuer Raum' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).toBeNull()

    await router.navigate({ to: `/raeume/${boilerRoom.id}` })
    expect(await screen.findByRole('button', { name: 'Bearbeiten' })).toBeTruthy()
  })

  it('offers a role that takes no stock neither a new room nor the form of a room', async () => {
    signedInWithout('room.record')

    const router = await mount(`/geschosse/${ground.id}`)

    await untilTheRightsAreKnown()
    await screen.findByRole('heading', { level: 1, name: 'Erdgeschoss' })
    expect(screen.queryByRole('button', { name: 'Neuer Raum' })).toBeNull()

    await router.navigate({ to: `/raeume/${boilerRoom.id}` })
    await screen.findByRole('heading', { level: 1, name: 'E.14 Heizraum' })
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).toBeNull()
  })
})

describe('the form of a new building', () => {
  const address = `/liegenschaften/${school.id}/gebaeude/neu`

  it('stands under its property, with every kind to tick and none ticked', async () => {
    await mount(address)

    expect(await screen.findByRole('heading', { level: 1, name: 'Neues Gebäude' })).toBeTruthy()
    expect(path()).toEqual(['Liegenschaften', 'Schulzentrum Am Lindenhain'])
    expect(screen.getAllByRole('checkbox')).toHaveLength(buildingKinds.length)
    expect(ticked()).toEqual([])
    expect(screen.getByRole('group', { name: /Gebäudeart/ })).toBeTruthy()
    expect(
      screen.getByText(
        'Eine oder mehrere. Die Gebäudeart entscheidet mit, welche Pflichten vorgeschlagen werden.',
      ),
    ).toBeTruthy()
    expect(
      screen.getByText(
        'Geschosse und Räume legen Sie danach im Gebäude an, oder Sie übernehmen sie mit dem Import.',
      ),
    ).toBeTruthy()
    // Nothing to remove yet.
    expect(screen.queryByRole('button', { name: 'Gebäude entfernen' })).toBeNull()
  })

  it('makes the building at the route of its property and opens its page', async () => {
    const user = userEvent.setup()
    const router = await mount(address)

    answerToWrite = making('buildings', 'b-new', place)

    await user.type(await screen.findByRole('textbox', { name: 'Bezeichnung' }), ' Mensa ')
    await user.type(field('Kürzel'), ' M ')
    await user.type(field('Baujahr'), ' 2008 ')
    await user.click(kind('Versammlungs- oder Sportstätte'))
    await user.click(kind('Schule oder Hochschule'))
    await user.click(screen.getByRole('button', { name: 'Gebäude anlegen' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/gebaeude/b-new')
    })
    expect(written).toEqual([
      {
        method: 'POST',
        path: '/properties/p-school/buildings',
        // The kinds in the order they were ticked, the year as a number.
        body: { name: 'Mensa', shortCode: 'M', kinds: ['assembly', 'school'], yearBuilt: 2008 },
      },
    ])
    // The exchange that follows brought it down: its page stands.
    expect(await screen.findByRole('heading', { level: 1, name: 'Mensa' })).toBeTruthy()
  })

  it('takes a short code and a year left empty as none', async () => {
    const user = userEvent.setup()
    const router = await mount(address)

    answerToWrite = making('buildings', 'b-new', place)

    await user.type(await screen.findByRole('textbox', { name: 'Bezeichnung' }), 'Mensa')
    await user.click(kind('Gaststätte'))
    await user.click(screen.getByRole('button', { name: 'Gebäude anlegen' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/gebaeude/b-new')
    })
    expect(written[0]?.body).toEqual({
      name: 'Mensa',
      shortCode: null,
      kinds: ['restaurant'],
      yearBuilt: null,
    })
  })

  it('holds what the model refuses before anything is sent', async () => {
    const user = userEvent.setup()

    await mount(address)

    await user.type(await screen.findByRole('textbox', { name: 'Bezeichnung' }), 'Mensa')
    await user.click(screen.getByRole('button', { name: 'Gebäude anlegen' }))
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Ein Gebäude hat mindestens eine Gebäudeart.',
    )

    // A kind ticked and unticked again is none.
    await user.click(kind('Garage'))
    await user.click(kind('Garage'))
    await user.click(screen.getByRole('button', { name: 'Gebäude anlegen' }))
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Ein Gebäude hat mindestens eine Gebäudeart.',
    )

    await user.click(kind('Garage'))

    for (const year of ['MMVIII', '999', '20.08']) {
      await user.clear(field('Baujahr'))
      await user.type(field('Baujahr'), year)
      await user.click(screen.getByRole('button', { name: 'Gebäude anlegen' }))
      expect([year, (await screen.findByRole('alert')).textContent]).toEqual([
        year,
        'Das Baujahr ist eine ganze Zahl von 1000 bis 2100.',
      ])
    }

    expect(written).toEqual([])
  })

  it('shows the sentence of the server when it refuses, and keeps what was typed', async () => {
    const user = userEvent.setup()
    const router = await mount(address)

    answerToWrite = () => ({
      status: 422,
      body: { message: 'Diese Liegenschaft gibt es nicht oder nicht mehr.' },
    })

    await user.type(await screen.findByRole('textbox', { name: 'Bezeichnung' }), 'Mensa')
    await user.click(kind('Gaststätte'))
    await user.click(screen.getByRole('button', { name: 'Gebäude anlegen' }))

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Diese Liegenschaft gibt es nicht oder nicht mehr.',
    )
    expect(router.state.location.pathname).toBe(address)
    expect(field('Bezeichnung').value).toBe('Mensa')
    expect(ticked()).toEqual(['Gaststätte'])
  })

  it('says that it takes a connection once the one there was is gone', async () => {
    const takesAConnection =
      'Ein Gebäude wird mit Verbindung angelegt und geändert. Gerade ist keine da.'

    await mount(address)

    const save = (await screen.findByRole('button', {
      name: 'Gebäude anlegen',
    })) as HTMLButtonElement

    expect(save.disabled).toBe(false)
    expect(screen.queryByText(takesAConnection)).toBeNull()

    window.dispatchEvent(new Event('offline'))

    expect(await screen.findByText(takesAConnection)).toBeTruthy()
    expect(save.disabled).toBe(true)
  })

  it('leads back to the property without a word', async () => {
    const user = userEvent.setup()
    const router = await mount(address)

    await user.click(await screen.findByRole('button', { name: 'Abbrechen' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/liegenschaften/p-school')
    })
    expect(written).toEqual([])
  })

  it('is not there for whoever keeps no places', async () => {
    signedIn('site_management')
    await mount(address)
    await untilTheRightsAreKnown()

    expect(await screen.findByText('Gebäude anlegen darf dieser Zugang nicht.')).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: 'Bezeichnung' })).toBeNull()
  })

  it('says so when its property is not there', async () => {
    await mount('/liegenschaften/p-gone/gebaeude/neu')

    expect(
      await screen.findByText(
        'Diese Liegenschaft gibt es nicht mehr, sie liegt in einem Bereich, den dieser Zugang nicht sieht, oder dieses Gerät kennt sie noch nicht.',
      ),
    ).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: 'Bezeichnung' })).toBeNull()
  })
})

describe('the form of a building there is', () => {
  const address = `/gebaeude/${house.id}/bearbeiten`

  it('starts with what the building holds, its kinds ticked', async () => {
    await mount(address)

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Schulhaus bearbeiten' }),
    ).toBeTruthy()
    expect(path()).toEqual(['Liegenschaften', 'Schulzentrum Am Lindenhain', 'Schulhaus'])
    expect(field('Bezeichnung').value).toBe('Schulhaus')
    expect(field('Kürzel').value).toBe('S')
    expect(field('Baujahr').value).toBe('1975')
    expect(ticked()).toEqual(['Schule oder Hochschule'])
    expect(screen.queryByText(/legen Sie danach im Gebäude an/)).toBeNull()
  })

  it('sends what changed and nothing else, and leads back to the page of the building', async () => {
    const user = userEvent.setup()
    const asked = takingChanges()
    const router = await mount(address)

    await user.clear(await screen.findByRole('textbox', { name: 'Baujahr' }))
    await user.type(field('Baujahr'), '1976')
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/gebaeude/b-house')
    })
    expect(asked).toEqual([
      { what: 'change', entity: 'buildings', id: 'b-house', values: { yearBuilt: 1976 } },
    ])
  })

  it('sends nothing when nothing was changed, whatever order the kinds stand in', async () => {
    const user = userEvent.setup()
    const asked = takingChanges()
    // The gym holds its kinds in another order than the form lists them in.
    const router = await mount(`/gebaeude/${gym.id}/bearbeiten`)

    expect(await screen.findByRole('textbox', { name: 'Bezeichnung' })).toBeTruthy()
    expect(ticked()).toEqual(['Schule oder Hochschule', 'Versammlungs- oder Sportstätte'])

    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/gebaeude/b-gym')
    })
    expect(asked).toEqual([])
  })

  it('puts a kind ticked later at the end and takes an unticked one out', async () => {
    const user = userEvent.setup()
    const asked = takingChanges()
    const router = await mount(`/gebaeude/${gym.id}/bearbeiten`)

    await user.click(await screen.findByRole('checkbox', { name: 'Garage' }))
    await user.click(kind('Versammlungs- oder Sportstätte'))
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/gebaeude/b-gym')
    })
    expect(asked).toEqual([
      { what: 'change', entity: 'buildings', id: 'b-gym', values: { kinds: ['school', 'garage'] } },
    ])
  })

  it('takes a short code and a year away', async () => {
    const user = userEvent.setup()
    const asked = takingChanges()
    const router = await mount(address)

    await user.clear(await screen.findByRole('textbox', { name: 'Kürzel' }))
    await user.clear(field('Baujahr'))
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/gebaeude/b-house')
    })
    expect(asked).toEqual([
      {
        what: 'change',
        entity: 'buildings',
        id: 'b-house',
        values: { shortCode: null, yearBuilt: null },
      },
    ])
  })

  it('removes the building after a question that says what goes with it', async () => {
    const user = userEvent.setup()
    const asked = takingChanges()
    const router = await mount(address)

    await user.click(await screen.findByRole('button', { name: 'Gebäude entfernen' }))

    const question = screen.getByRole('alertdialog', { name: '„Schulhaus“ entfernen?' })

    expect(question.textContent).toContain(
      'Mit dem Gebäude gehen seine Geschosse und Räume, seine Schließzeiten, die Anlagen darin und alle Pflichten, Vorgänge und Mängel dort.',
    )
    expect(question.textContent).toContain(
      'Eine Anlage mit Nachweis wird nicht entfernt, und dann bleibt auch das Gebäude.',
    )
    expect(asked).toEqual([])

    await user.click(within(question).getByRole('button', { name: 'Entfernen' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/liegenschaften/p-school')
    })
    expect(asked).toEqual([{ what: 'removal', entity: 'buildings', id: 'b-house' }])
  })

  it('removes nothing when the question is answered with the way out', async () => {
    const user = userEvent.setup()
    const asked = takingChanges()
    const router = await mount(address)

    await user.click(await screen.findByRole('button', { name: 'Gebäude entfernen' }))
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Abbrechen' }),
    )

    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(asked).toEqual([])
    expect(router.state.location.pathname).toBe(address)
  })

  it('shows the sentence of the server when the removal is refused, and stays', async () => {
    const user = userEvent.setup()
    const sentence = 'Eine Anlage mit Nachweis wird nicht entfernt.'
    const router = await mount(address)

    server.remove = () => Promise.reject(new RequestRefused(409, sentence))

    await user.click(await screen.findByRole('button', { name: 'Gebäude entfernen' }))
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Entfernen' }),
    )

    expect((await screen.findByRole('alert')).textContent).toBe(sentence)
    // The question is answered: the sentence stands beside the button.
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(router.state.location.pathname).toBe(address)
  })

  it('says that changing and removing take a connection once the one there was is gone', async () => {
    const takesAConnection =
      'Ein Gebäude wird mit Verbindung angelegt und geändert. Gerade ist keine da.'

    await mount(address)

    const save = (await screen.findByRole('button', { name: 'Speichern' })) as HTMLButtonElement
    const remove = screen.getByRole('button', { name: 'Gebäude entfernen' }) as HTMLButtonElement

    expect(save.disabled).toBe(false)
    expect(remove.disabled).toBe(false)

    window.dispatchEvent(new Event('offline'))

    expect(await screen.findByText(takesAConnection)).toBeTruthy()
    expect(save.disabled).toBe(true)
    expect(remove.disabled).toBe(true)
  })

  it('leads back to the page of the building without a word', async () => {
    const user = userEvent.setup()
    const asked = takingChanges()
    const router = await mount(address)

    await user.clear(await screen.findByRole('textbox', { name: 'Bezeichnung' }))
    await user.type(field('Bezeichnung'), 'Altbau')
    await user.click(screen.getByRole('button', { name: 'Abbrechen' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/gebaeude/b-house')
    })
    expect(asked).toEqual([])
  })

  // What a form starts with is read when it is made. A building that reaches
  // the device a moment after its address was opened still starts with its
  // kinds: without them the next "Speichern" would take them away.
  it('starts with the kinds of a building that reaches the device after its address was opened', async () => {
    const { client } = await mountOffice('/gebaeude/b-late/bearbeiten', server, everything)

    expect(await screen.findByText(/^Dieses Gebäude gibt es nicht mehr/)).toBeTruthy()

    server.put('buildings', {
      ...house,
      id: 'b-late',
      name: 'Neubau',
      kinds: '["assembly","office"]',
    })
    await client.synchronise()

    expect(await screen.findByRole('heading', { level: 1, name: 'Neubau bearbeiten' })).toBeTruthy()
    expect(field('Bezeichnung').value).toBe('Neubau')
    expect(ticked()).toEqual(['Büro- und Verwaltungsgebäude', 'Versammlungs- oder Sportstätte'])
  })

  it('starts anew for another building when only the address changes', async () => {
    const user = userEvent.setup()
    const asked = takingChanges()
    const router = await mount(address)

    await user.click(await screen.findByRole('checkbox', { name: 'Garage' }))
    await user.type(field('Kürzel'), 'X')
    await router.navigate({ to: `/gebaeude/${gym.id}/bearbeiten` })

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Sporthalle bearbeiten' }),
    ).toBeTruthy()
    expect(field('Bezeichnung').value).toBe('Sporthalle')
    expect(field('Kürzel').value).toBe('')
    expect(ticked()).toEqual(['Schule oder Hochschule', 'Versammlungs- oder Sportstätte'])

    // And saves nothing of the building it came from.
    await user.click(screen.getByRole('button', { name: 'Speichern' }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/gebaeude/b-gym')
    })
    expect(asked).toEqual([])
  })

  it('says so when the building is not there', async () => {
    await mount('/gebaeude/b-gone/bearbeiten')

    expect(
      await screen.findByText(
        'Dieses Gebäude gibt es nicht mehr, es liegt in einem Bereich, den dieser Zugang nicht sieht, oder dieses Gerät kennt es noch nicht.',
      ),
    ).toBeTruthy()
  })

  it('is not there for whoever keeps no places', async () => {
    signedIn('technician')
    await mount(address)
    await untilTheRightsAreKnown()

    expect(await screen.findByText('Gebäude ändern darf dieser Zugang nicht.')).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: 'Bezeichnung' })).toBeNull()
  })
})

describe('the form of a floor', () => {
  const level =
    'Die Ebene ist eine ganze Zahl von -20 bis 200: 0 ist das Erdgeschoss, darunter liegen die Untergeschosse.'

  it('makes a floor at the route of its building and opens its page', async () => {
    const user = userEvent.setup()
    const router = await mount(`/gebaeude/${house.id}/geschosse/neu`)

    answerToWrite = making('floors', 'f-new', inHouse)

    expect(await screen.findByRole('heading', { level: 1, name: 'Neues Geschoss' })).toBeTruthy()
    expect(path()).toEqual(['Liegenschaften', 'Schulzentrum Am Lindenhain', 'Schulhaus'])
    expect(
      screen.getByText(
        '0 ist das Erdgeschoss, darunter liegen die Untergeschosse. Die Ebene ordnet die Geschosse.',
      ),
    ).toBeTruthy()
    // Nothing to remove yet.
    expect(screen.queryByRole('button', { name: 'Geschoss entfernen' })).toBeNull()

    await user.type(field('Bezeichnung'), ' 3. Obergeschoss ')
    await user.type(field('Ebene'), ' 3 ')
    await user.click(screen.getByRole('button', { name: 'Geschoss anlegen' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/geschosse/f-new')
    })
    expect(written).toEqual([
      {
        method: 'POST',
        path: '/buildings/b-house/floors',
        body: { name: '3. Obergeschoss', level: 3 },
      },
    ])
    expect(await screen.findByRole('heading', { level: 1, name: '3. Obergeschoss' })).toBeTruthy()
  })

  it('takes a level below the ground', async () => {
    const user = userEvent.setup()
    const router = await mount(`/gebaeude/${house.id}/geschosse/neu`)

    answerToWrite = making('floors', 'f-new', inHouse)

    await user.type(await screen.findByRole('textbox', { name: 'Bezeichnung' }), 'Tiefkeller')
    await user.type(field('Ebene'), '-2')
    await user.click(screen.getByRole('button', { name: 'Geschoss anlegen' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/geschosse/f-new')
    })
    expect(written[0]?.body).toEqual({ name: 'Tiefkeller', level: -2 })
  })

  it('holds a level that is no whole number, or out of every building, before anything is sent', async () => {
    const user = userEvent.setup()

    await mount(`/gebaeude/${house.id}/geschosse/neu`)
    await user.type(await screen.findByRole('textbox', { name: 'Bezeichnung' }), 'Zwischengeschoss')

    // Spaces pass the browser, which only asks whether the field is filled in.
    for (const typed of ['E', '0,5', '300', '   ']) {
      await user.clear(field('Ebene'))
      await user.type(field('Ebene'), typed)
      await user.click(screen.getByRole('button', { name: 'Geschoss anlegen' }))
      expect([typed, (await screen.findByRole('alert')).textContent]).toEqual([typed, level])
    }

    expect(written).toEqual([])
  })

  it('shows the sentence of the server when it refuses, and keeps what was typed', async () => {
    const user = userEvent.setup()
    const address = `/gebaeude/${house.id}/geschosse/neu`
    const router = await mount(address)

    answerToWrite = () => ({
      status: 422,
      body: { message: 'Dieses Gebäude gibt es nicht oder nicht mehr.' },
    })

    await user.type(await screen.findByRole('textbox', { name: 'Bezeichnung' }), 'Dachgeschoss')
    await user.type(field('Ebene'), '4')
    await user.click(screen.getByRole('button', { name: 'Geschoss anlegen' }))

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Dieses Gebäude gibt es nicht oder nicht mehr.',
    )
    expect(router.state.location.pathname).toBe(address)
    expect(field('Bezeichnung').value).toBe('Dachgeschoss')
    expect(field('Ebene').value).toBe('4')
  })

  it('leads back without a word, from a new floor to its building and from one there is to its page', async () => {
    const user = userEvent.setup()
    const asked = takingChanges()
    const router = await mount(`/gebaeude/${house.id}/geschosse/neu`)

    await user.click(await screen.findByRole('button', { name: 'Abbrechen' }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/gebaeude/b-house')
    })

    await router.navigate({ to: `/geschosse/${ground.id}/bearbeiten` })
    await user.click(await screen.findByRole('button', { name: 'Abbrechen' }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/geschosse/f-ground')
    })
    expect(asked).toEqual([])
    expect(written).toEqual([])
  })

  it('starts with what the floor holds, the ground floor on level 0, and sends what changed', async () => {
    const user = userEvent.setup()
    const asked = takingChanges()
    const router = await mount(`/geschosse/${ground.id}/bearbeiten`)

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Erdgeschoss bearbeiten' }),
    ).toBeTruthy()
    expect(path()).toEqual([
      'Liegenschaften',
      'Schulzentrum Am Lindenhain',
      'Schulhaus',
      'Erdgeschoss',
    ])
    expect(field('Bezeichnung').value).toBe('Erdgeschoss')
    expect(field('Ebene').value).toBe('0')

    await user.clear(field('Bezeichnung'))
    await user.type(field('Bezeichnung'), 'Parterre')
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/geschosse/f-ground')
    })
    expect(asked).toEqual([
      { what: 'change', entity: 'floors', id: 'f-ground', values: { name: 'Parterre' } },
    ])
  })

  it('starts anew for another floor when only the address changes', async () => {
    const user = userEvent.setup()
    const router = await mount(`/geschosse/${ground.id}/bearbeiten`)

    await user.type(await screen.findByRole('textbox', { name: 'Bezeichnung' }), ' alt')
    await router.navigate({ to: `/geschosse/${basement.id}/bearbeiten` })

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Untergeschoss bearbeiten' }),
    ).toBeTruthy()
    expect(field('Bezeichnung').value).toBe('Untergeschoss')
    expect(field('Ebene').value).toBe('-1')
  })

  it('removes the floor after a question that says what goes with it', async () => {
    const user = userEvent.setup()
    const asked = takingChanges()
    const router = await mount(`/geschosse/${ground.id}/bearbeiten`)

    await user.click(await screen.findByRole('button', { name: 'Geschoss entfernen' }))

    const question = screen.getByRole('alertdialog', { name: '„Erdgeschoss“ entfernen?' })

    expect(question.textContent).toContain(
      'Mit dem Geschoss gehen seine Räume, die Anlagen darin und alle Pflichten, Vorgänge und Mängel dort.',
    )

    await user.click(within(question).getByRole('button', { name: 'Entfernen' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/gebaeude/b-house')
    })
    expect(asked).toEqual([{ what: 'removal', entity: 'floors', id: 'f-ground' }])
  })

  it('says that it takes a connection once the one there was is gone', async () => {
    const takesAConnection =
      'Ein Geschoss wird mit Verbindung angelegt und geändert. Gerade ist keine da.'

    await mount(`/geschosse/${ground.id}/bearbeiten`)

    const save = (await screen.findByRole('button', { name: 'Speichern' })) as HTMLButtonElement
    const remove = screen.getByRole('button', { name: 'Geschoss entfernen' }) as HTMLButtonElement

    expect(save.disabled).toBe(false)
    expect(remove.disabled).toBe(false)

    window.dispatchEvent(new Event('offline'))

    expect(await screen.findByText(takesAConnection)).toBeTruthy()
    expect(save.disabled).toBe(true)
    expect(remove.disabled).toBe(true)
  })

  it('is not there for whoever keeps no places, new or old', async () => {
    signedIn('site_management')

    const router = await mount(`/gebaeude/${house.id}/geschosse/neu`)

    await untilTheRightsAreKnown()
    expect(await screen.findByText('Geschosse anlegen darf dieser Zugang nicht.')).toBeTruthy()

    await router.navigate({ to: `/geschosse/${ground.id}/bearbeiten` })
    expect(await screen.findByText('Geschosse ändern darf dieser Zugang nicht.')).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: 'Bezeichnung' })).toBeNull()
  })

  it('says so when the floor or its building is not there', async () => {
    const router = await mount('/geschosse/f-gone/bearbeiten')

    expect(
      await screen.findByText(
        'Dieses Geschoss gibt es nicht mehr, es liegt in einem Bereich, den dieser Zugang nicht sieht, oder dieses Gerät kennt es noch nicht.',
      ),
    ).toBeTruthy()

    await router.navigate({ to: '/gebaeude/b-gone/geschosse/neu' })
    expect(
      await screen.findByText(
        'Dieses Gebäude gibt es nicht mehr, es liegt in einem Bereich, den dieser Zugang nicht sieht, oder dieses Gerät kennt es noch nicht.',
      ),
    ).toBeTruthy()
  })
})

describe('the form of a new room', () => {
  const address = `/geschosse/${ground.id}/raeume/neu`
  const room = /^\/raeume\/[0-9a-f-]{36}$/

  /** What the outbox sent about rooms, as kind and values. */
  const sent = () =>
    server
      .operations()
      .filter((operation) => operation.entity === 'rooms')
      .map((operation) => ({
        kind: operation.kind,
        values: Object.fromEntries(operation.patches.map((patch) => [patch.field, patch.to])),
      }))

  it('is for whoever takes stock, and makes the room through the outbox', async () => {
    signedIn('technician')

    const user = userEvent.setup()
    const router = await mount(address)

    expect(await screen.findByRole('heading', { level: 1, name: 'Neuer Raum' })).toBeTruthy()
    expect(path()).toEqual([
      'Liegenschaften',
      'Schulzentrum Am Lindenhain',
      'Schulhaus',
      'Erdgeschoss',
    ])
    expect(screen.getByText('Ein Raum braucht eine Nummer oder eine Bezeichnung.')).toBeTruthy()
    expect(field('Nutzung').placeholder).toBe('Zum Beispiel Unterricht, Büro oder Haustechnik')

    await user.type(field('Nummer'), ' E.21 ')
    await user.type(field('Bezeichnung'), ' Klassenraum 1b ')
    await user.type(field('Nutzung'), ' Unterricht ')
    await user.click(screen.getByRole('button', { name: 'Raum anlegen' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toMatch(room)
    })
    expect(sent()).toEqual([
      {
        kind: 'create',
        values: {
          floorId: 'f-ground',
          number: 'E.21',
          name: 'Klassenraum 1b',
          use: 'Unterricht',
        },
      },
    ])
    // No route was asked: a room is taken stock of through the outbox.
    expect(written).toEqual([])
    expect(
      await screen.findByRole('heading', { level: 1, name: 'E.21 Klassenraum 1b' }),
    ).toBeTruthy()
  })

  it('takes a room that has only a name', async () => {
    const user = userEvent.setup()
    const router = await mount(address)

    await user.type(await screen.findByRole('textbox', { name: 'Bezeichnung' }), 'Treppenhaus')
    await user.click(screen.getByRole('button', { name: 'Raum anlegen' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toMatch(room)
    })
    // What was left empty is not said.
    expect(sent()).toEqual([
      { kind: 'create', values: { floorId: 'f-ground', name: 'Treppenhaus' } },
    ])
  })

  it('holds a room that has neither a number nor a name', async () => {
    const user = userEvent.setup()
    const router = await mount(address)

    await user.type(await screen.findByRole('textbox', { name: 'Nutzung' }), 'Lager')
    await user.type(field('Nummer'), '   ')
    await user.click(screen.getByRole('button', { name: 'Raum anlegen' }))

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Ein Raum hat eine Nummer oder eine Bezeichnung.',
    )
    expect(sent()).toEqual([])
    expect(router.state.location.pathname).toBe(address)
  })

  it('is made without a connection as well, and waits in the outbox', async () => {
    const user = userEvent.setup()
    const { router, client } = await mountOffice(address, server, everything)

    await screen.findByRole('textbox', { name: 'Nummer' })
    server.offline = true

    await user.type(field('Nummer'), 'E.30')
    await user.click(screen.getByRole('button', { name: 'Raum anlegen' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toMatch(room)
    })
    expect(sent()).toEqual([])
    expect(client.status().pending).toBe(1)
    // The page of the room stands from what the device holds.
    expect(await screen.findByRole('heading', { level: 1, name: 'E.30' })).toBeTruthy()
  })

  it('leads back to the floor without a word', async () => {
    const user = userEvent.setup()
    const router = await mount(address)

    await user.click(await screen.findByRole('button', { name: 'Abbrechen' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/geschosse/f-ground')
    })
    expect(sent()).toEqual([])
  })

  // Only moving and removing take a connection, and a new room has neither.
  it('says nothing about a connection, which a new room does not take', async () => {
    await mount(address)

    const save = (await screen.findByRole('button', { name: 'Raum anlegen' })) as HTMLButtonElement

    await untilTheOfficeKnowsItIsOffline()

    expect(screen.queryByText(/Verlegt und entfernt wird ein Raum mit Verbindung/)).toBeNull()
    expect(save.disabled).toBe(false)
  })

  it('is not there for a role that takes no stock', async () => {
    signedInWithout('room.record')
    await mount(address)
    await untilTheRightsAreKnown()

    expect(await screen.findByText('Räume anlegen darf dieser Zugang nicht.')).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: 'Nummer' })).toBeNull()
  })

  it('says so when its floor is not there', async () => {
    await mount('/geschosse/f-gone/raeume/neu')

    expect(
      await screen.findByText(
        'Dieses Geschoss gibt es nicht mehr, es liegt in einem Bereich, den dieser Zugang nicht sieht, oder dieses Gerät kennt es noch nicht.',
      ),
    ).toBeTruthy()
  })
})

describe('the form of a room there is', () => {
  const address = `/raeume/${boilerRoom.id}/bearbeiten`

  it('starts with what the room holds and sends what changed through the outbox', async () => {
    signedIn('technician')

    const user = userEvent.setup()
    const router = await mount(address)

    expect(
      await screen.findByRole('heading', { level: 1, name: 'E.14 Heizraum bearbeiten' }),
    ).toBeTruthy()
    expect(path()).toEqual([
      'Liegenschaften',
      'Schulzentrum Am Lindenhain',
      'Schulhaus',
      'Erdgeschoss',
      'E.14 Heizraum',
    ])
    expect(field('Nummer').value).toBe('E.14')
    expect(field('Bezeichnung').value).toBe('Heizraum')
    expect(field('Nutzung').value).toBe('Haustechnik')

    await user.clear(field('Nutzung'))
    await user.type(field('Nutzung'), 'Technikzentrale')
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/raeume/r-boiler')
    })

    const [operation] = server.operations()

    expect(operation?.kind).toBe('update')
    expect(operation?.recordId).toBe('r-boiler')
    expect(operation?.patches.map((patch) => [patch.field, patch.to])).toEqual([
      ['use', 'Technikzentrale'],
    ])
    expect(written).toEqual([])
  })

  it('offers whoever only takes stock neither the removal nor the move', async () => {
    signedIn('site_management')
    await mount(address)

    expect(await screen.findByRole('button', { name: 'Speichern' })).toBeTruthy()
    await untilTheRightsAreKnown()
    expect(screen.queryByRole('button', { name: 'Raum entfernen' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'In ein anderes Geschoss verlegen' })).toBeNull()

    // And nothing about a connection for what is not offered in the first place.
    await untilTheOfficeKnowsItIsOffline()
    expect(screen.queryByText(/Verlegt und entfernt wird ein Raum mit Verbindung/)).toBeNull()
  })

  it('is not there for a role that takes no stock', async () => {
    signedInWithout('room.record')
    await mount(address)
    await untilTheRightsAreKnown()

    expect(await screen.findByText('Räume ändern darf dieser Zugang nicht.')).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: 'Nummer' })).toBeNull()
  })

  it('starts anew for another room when only the address changes', async () => {
    const user = userEvent.setup()
    const router = await mount(address)

    await user.type(await screen.findByRole('textbox', { name: 'Nutzung' }), ' und Lager')
    await router.navigate({ to: `/raeume/${store.id}/bearbeiten` })

    expect(
      await screen.findByRole('heading', { level: 1, name: 'E.2 Lager bearbeiten' }),
    ).toBeTruthy()
    expect(field('Nummer').value).toBe('E.2')
    expect(field('Bezeichnung').value).toBe('Lager')
    expect(field('Nutzung').value).toBe('')
  })

  it('leads back to the page of the room without a word', async () => {
    const user = userEvent.setup()
    const router = await mount(address)

    await user.clear(await screen.findByRole('textbox', { name: 'Nutzung' }))
    await user.click(screen.getByRole('button', { name: 'Abbrechen' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/raeume/r-boiler')
    })
    expect(server.operations()).toEqual([])
    expect(written).toEqual([])
  })

  it('removes the room at its route after a question that says what goes with it', async () => {
    const user = userEvent.setup()
    const router = await mount(address)

    answerToWrite = (write) => {
      server.put('rooms', { ...boilerRoom, deletedAt: '2026-10-05T10:00:00.000Z' })

      return { status: 200, body: { ...boilerRoom, method: write.method } }
    }

    await user.click(await screen.findByRole('button', { name: 'Raum entfernen' }))

    const question = screen.getByRole('alertdialog', { name: '„E.14 Heizraum“ entfernen?' })

    expect(question.textContent).toContain(
      'Mit dem Raum gehen die Anlagen darin und alle Pflichten, Vorgänge und Mängel dort.',
    )
    expect(question.textContent).toContain(
      'Eine Anlage mit Nachweis wird nicht entfernt, und dann bleibt auch der Raum.',
    )
    expect(written).toEqual([])

    await user.click(within(question).getByRole('button', { name: 'Entfernen' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/geschosse/f-ground')
    })
    // At the route, and not through the outbox, where a removal would be refused.
    expect(written).toEqual([{ method: 'DELETE', path: '/rooms/r-boiler', body: undefined }])
    expect(server.operations()).toEqual([])
  })

  it('shows the sentence of the server when the removal is refused, and stays', async () => {
    const user = userEvent.setup()
    const sentence = 'Eine Anlage mit Nachweis wird nicht entfernt.'
    const router = await mount(address)

    answerToWrite = () => ({ status: 409, body: { message: sentence } })

    await user.click(await screen.findByRole('button', { name: 'Raum entfernen' }))
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Entfernen' }),
    )

    expect((await screen.findByRole('alert')).textContent).toBe(sentence)
    expect(router.state.location.pathname).toBe(address)
  })

  it('says that moving and removing take a connection once the one there was is gone, and still saves', async () => {
    const takesAConnection =
      'Verlegt und entfernt wird ein Raum mit Verbindung. Gerade ist keine da.'

    await mount(address)

    const remove = (await screen.findByRole('button', {
      name: 'Raum entfernen',
    })) as HTMLButtonElement
    const move = screen.getByRole('button', {
      name: 'In ein anderes Geschoss verlegen',
    }) as HTMLButtonElement

    expect(remove.disabled).toBe(false)
    expect(move.disabled).toBe(false)
    expect(screen.queryByText(takesAConnection)).toBeNull()

    window.dispatchEvent(new Event('offline'))

    expect(await screen.findByText(takesAConnection)).toBeTruthy()
    expect(remove.disabled).toBe(true)
    expect(move.disabled).toBe(true)
    // What a room is called is corrected through the outbox, with or without.
    expect((screen.getByRole('button', { name: 'Speichern' }) as HTMLButtonElement).disabled).toBe(
      false,
    )
  })

  it('says so when the room is not there', async () => {
    await mount('/raeume/r-gone/bearbeiten')

    expect(
      await screen.findByText(
        'Diesen Raum gibt es nicht mehr, er liegt in einem Bereich, den dieser Zugang nicht sieht, oder dieses Gerät kennt ihn noch nicht.',
      ),
    ).toBeTruthy()
  })
})

describe('a room moved to another floor', () => {
  const offered = (question: HTMLElement) =>
    [
      ...(within(question).getByRole('combobox', { name: 'Geschoss' }) as HTMLSelectElement)
        .options,
    ].map((option) => option.textContent)

  /** A route that moves the room, and puts it where the next exchange finds it. */
  function moving(room: { readonly id: string }) {
    return (write: Written): WriteAnswer => {
      const moved = { ...room, ...(write.body as object) }

      server.put('rooms', moved)

      return { status: 200, body: moved }
    }
  }

  it('offers the floors of its building while assets stand in it, and says why', async () => {
    const user = userEvent.setup()
    const router = await mount(`/raeume/${boilerRoom.id}/bearbeiten`)

    answerToWrite = moving(boilerRoom)

    await user.click(
      await screen.findByRole('button', { name: 'In ein anderes Geschoss verlegen' }),
    )

    const question = screen.getByRole('alertdialog', { name: 'E.14 Heizraum verlegen' })

    // From the lowest up, without the floor it lies on and without the gym.
    expect(offered(question)).toEqual(['Untergeschoss', '1. Obergeschoss'])
    expect(question.textContent).toContain('Der Raum zieht mit allem um, was in ihm steht.')
    expect(question.textContent).toContain(
      'In diesem Raum stehen 3 Anlagen. Mit Anlagen zieht ein Raum nur innerhalb seines Gebäudes um, deshalb stehen hier die Geschosse von „Schulhaus“.',
    )
    expect(written).toEqual([])

    await user.selectOptions(
      within(question).getByRole('combobox', { name: 'Geschoss' }),
      '1. Obergeschoss',
    )
    await user.click(within(question).getByRole('button', { name: 'Verlegen' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/raeume/r-boiler')
    })
    expect(written).toEqual([
      { method: 'PUT', path: '/rooms/r-boiler/floor', body: { floorId: 'f-first' } },
    ])
    // The page of the room stands under the floor it moved to.
    await waitFor(() => {
      expect(path()).toEqual([
        'Liegenschaften',
        'Schulzentrum Am Lindenhain',
        'Schulhaus',
        '1. Obergeschoss',
      ])
    })
  })

  it('counts one asset as one', async () => {
    const user = userEvent.setup()

    server.put('assets', { ...meter, roomId: store.id })
    server.put('assets', { ...pump, roomId: store.id })
    await mount(`/raeume/${boilerRoom.id}/bearbeiten`)
    await user.click(
      await screen.findByRole('button', { name: 'In ein anderes Geschoss verlegen' }),
    )

    expect(screen.getByRole('alertdialog').textContent).toContain(
      'In diesem Raum steht 1 Anlage. Mit Anlagen zieht ein Raum nur innerhalb seines Gebäudes um',
    )
  })

  it('offers the floors of the property for a room nothing stands in, the first of them chosen', async () => {
    const user = userEvent.setup()

    // Nothing stands in the boiler room any more.
    for (const each of [boiler, meter, pump]) {
      server.put('assets', { ...each, roomId: null })
    }

    // A third building, which a device comes to hold after the gym and which
    // is called by a name before it.
    server.put('buildings', { ...gym, id: 'b-zz', name: 'Aula' })
    server.put('floors', { ...place, buildingId: 'b-zz', id: 'f-zz', name: 'Saal', level: 0 })

    const router = await mount(`/raeume/${boilerRoom.id}/bearbeiten`)

    answerToWrite = moving(boilerRoom)

    await user.click(
      await screen.findByRole('button', { name: 'In ein anderes Geschoss verlegen' }),
    )

    const question = screen.getByRole('alertdialog')

    // Its own building first, then the others by name, each with its building before it.
    expect(offered(question)).toEqual([
      'Untergeschoss',
      '1. Obergeschoss',
      'Aula, Saal',
      'Sporthalle, Erdgeschoss',
    ])
    expect(question.textContent).toContain(
      'Hier stehen die Geschosse von „Schulzentrum Am Lindenhain“.',
    )
    expect(question.textContent).not.toContain('Mit Anlagen zieht')

    // Without a choice: the first one offered.
    await user.click(within(question).getByRole('button', { name: 'Verlegen' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/raeume/r-boiler')
    })
    expect(written).toEqual([
      { method: 'PUT', path: '/rooms/r-boiler/floor', body: { floorId: 'f-basement' } },
    ])
  })

  it('moves a room without assets into another building of the property', async () => {
    const user = userEvent.setup()
    const router = await mount(`/raeume/${store.id}/bearbeiten`)

    answerToWrite = moving(store)

    await user.click(
      await screen.findByRole('button', { name: 'In ein anderes Geschoss verlegen' }),
    )
    await user.selectOptions(
      within(screen.getByRole('alertdialog')).getByRole('combobox', { name: 'Geschoss' }),
      'Sporthalle, Erdgeschoss',
    )
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Verlegen' }),
    )

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/raeume/r-store')
    })
    expect(written).toEqual([
      { method: 'PUT', path: '/rooms/r-store/floor', body: { floorId: 'f-gym' } },
    ])
  })

  // What the device cannot know: an asset removed long ago still names the room.
  it('shows the sentence of the server in the question when it refuses, and stays', async () => {
    const user = userEvent.setup()
    const sentence =
      'In diesem Raum stehen Anlagen, gelöschte mitgezählt; er zieht deshalb nur innerhalb seines Gebäudes um.'
    const router = await mount(`/raeume/${store.id}/bearbeiten`)

    answerToWrite = () => ({ status: 400, body: { message: sentence } })

    await user.click(
      await screen.findByRole('button', { name: 'In ein anderes Geschoss verlegen' }),
    )

    const question = screen.getByRole('alertdialog')

    await user.selectOptions(
      within(question).getByRole('combobox', { name: 'Geschoss' }),
      'Sporthalle, Erdgeschoss',
    )
    await user.click(within(question).getByRole('button', { name: 'Verlegen' }))

    expect((await within(question).findByRole('alert')).textContent).toBe(sentence)
    expect(screen.getByRole('alertdialog')).toBeTruthy()
    expect(router.state.location.pathname).toBe(`/raeume/${store.id}/bearbeiten`)
  })

  it('moves nothing when the question is answered with the way out', async () => {
    const user = userEvent.setup()

    await mount(`/raeume/${store.id}/bearbeiten`)
    await user.click(
      await screen.findByRole('button', { name: 'In ein anderes Geschoss verlegen' }),
    )
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Abbrechen' }),
    )

    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(written).toEqual([])
  })

  it('says so where there is no other floor to move to, and asks nothing', async () => {
    const user = userEvent.setup()

    // The gym has one floor, and something stands in its hall.
    server.put('assets', scoreboard)
    await mount(`/raeume/${hall.id}/bearbeiten`)
    await user.click(
      await screen.findByRole('button', { name: 'In ein anderes Geschoss verlegen' }),
    )

    expect(
      await screen.findByText(
        '„Sporthalle“ hat kein anderes Geschoss, und mit Anlagen zieht ein Raum nur innerhalb seines Gebäudes um.',
      ),
    ).toBeTruthy()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(written).toEqual([])
  })

  it('says so where the property has no other floor at all', async () => {
    const user = userEvent.setup()
    const yard = { ...school, id: 'p-yard', name: 'Werkhof Nord' }
    const onYard = { propertyId: yard.id, areaId: sued.id, buildingId: 'b-hall' }

    server.put('properties', yard)
    server.put('buildings', { ...gym, ...onYard, id: 'b-hall', name: 'Halle 1' })
    server.put('floors', { ...onYard, id: 'f-hall', name: 'Erdgeschoss', level: 0 })
    server.put('rooms', {
      ...onYard,
      id: 'r-bay',
      floorId: 'f-hall',
      number: null,
      name: 'Waschbucht',
      use: null,
    })
    await mount('/raeume/r-bay/bearbeiten')
    await user.click(
      await screen.findByRole('button', { name: 'In ein anderes Geschoss verlegen' }),
    )

    expect(await screen.findByText('„Werkhof Nord“ hat kein anderes Geschoss.')).toBeTruthy()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(written).toEqual([])
  })
})
