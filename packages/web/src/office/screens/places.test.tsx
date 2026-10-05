import { TestServer } from '@opengewerk/platform-web/testing'
import { screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  mountOffice,
  type NamedArea,
  onA,
  rowsOf,
  signedInOffice,
  untilTheRightsAreKnown,
} from '../test-office.js'

/**
 * The pages of a building, a floor and a room in the office (#86, 4.1 of the
 * concept): every place has a page and an address of its own, the path leads
 * from one to the next, and the page of a room shows what stands in it and
 * what supplies it from elsewhere. All of it is read from the device.
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
const house = { id: 'b-house', ...place, name: 'Schulhaus', kinds: '["school"]', yearBuilt: 1975 }
const gym = {
  id: 'b-gym',
  ...place,
  name: 'Sporthalle',
  kinds: '["school","assembly"]',
  yearBuilt: null,
}
const shed = { id: 'b-shed', ...place, name: 'Geräteschuppen', kinds: '["other"]', yearBuilt: 2001 }

const inHouse = { ...place, buildingId: house.id }
const basement = { id: 'f-basement', ...inHouse, name: 'Untergeschoss', level: -1 }
const ground = { id: 'f-ground', ...inHouse, name: 'Erdgeschoss', level: 0 }
const first = { id: 'f-first', ...inHouse, name: '1. Obergeschoss', level: 1 }
const gymGround = { id: 'f-gym', ...place, buildingId: gym.id, name: 'Erdgeschoss', level: 0 }

const onGround = { ...inHouse, floorId: ground.id }
const store = { id: 'r-store', ...onGround, number: 'E.2', name: 'Lager', use: null }
const caretaker = {
  id: 'r-caretaker',
  ...onGround,
  number: 'E.10',
  name: 'Hausmeister',
  use: 'Büro',
}
const boilerRoom = {
  id: 'r-boiler',
  ...onGround,
  number: 'E.14',
  name: 'Heizraum',
  use: 'Haustechnik',
}
/** A room that has only a number. */
const numbered = { id: 'r-numbered', ...onGround, number: 'E.20', name: null, use: null }
/** A room that has only a name. */
const stairs = { id: 'r-stairs', ...onGround, number: null, name: 'Treppenhaus', use: null }
const classroom = {
  id: 'r-class',
  ...inHouse,
  floorId: first.id,
  number: '1.03',
  name: 'Klassenraum 5a',
  use: 'Unterricht',
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

const asset = { ...inHouse, parentAssetId: null, kind: 'probe.elevator' }
const meter = {
  id: 's-meter',
  ...asset,
  roomId: boilerRoom.id,
  number: 'AN-00009',
  name: 'Hauptwasserzähler',
}
const boiler = {
  id: 's-boiler',
  ...asset,
  roomId: boilerRoom.id,
  number: 'AN-00010',
  name: 'Heizkessel',
}
/** Taken stock of a moment ago: the server has not numbered it, and the office has given it no state. */
const pump = { id: 's-pump', ...asset, roomId: boilerRoom.id, number: null, name: 'Neue Pumpe' }
const lamp = {
  id: 's-lamp',
  ...asset,
  roomId: caretaker.id,
  number: 'AN-00012',
  name: 'Notleuchte Flur',
}
/** Stands in the building and in no room of it. */
const elevator = { id: 's-lift', ...asset, roomId: null, number: 'AN-00003', name: 'Aufzug' }
/** Stands in the other building of the property, in no room. */
const ventilation = {
  id: 's-air',
  ...asset,
  buildingId: gym.id,
  roomId: null,
  number: 'AN-00020',
  name: 'Lüftung Sporthalle',
}

const entry = (id: string, assetId: string, state: string, validFrom: string) => ({
  id,
  ...place,
  assetId,
  state,
  validFrom,
})

const supply = (id: string, assetId: string, where: { buildingId?: string; roomId?: string }) => ({
  id,
  ...place,
  assetId,
  buildingId: where.buildingId ?? null,
  roomId: where.roomId ?? null,
})

const everything = [
  'properties',
  'buildings',
  'floors',
  'rooms',
  'assets',
  'asset_lifecycle',
  'asset_supplies',
] as const

let server: TestServer

function mount(at: string) {
  return mountOffice(at, server, everything)
}

/** The steps of the path over the page, each with where it leads. */
function path(): string[] {
  return within(screen.getByRole('navigation', { name: 'Pfad' }))
    .getAllByRole('link')
    .map((link) => `${link.textContent} > ${link.getAttribute('href') ?? ''}`)
}

/**
 * The way back a phone shows in place of the path: one step up. Both stand in
 * the page, and the width decides which of them is seen.
 */
function wayBack(): string {
  const link = screen
    .getAllByRole('link')
    .find((each) => each.className.split(' ').includes('sm:hidden'))

  return `${link?.textContent ?? ''} > ${link?.getAttribute('href') ?? ''}`
}

/** What stands beside the title in the head of the page, marker by marker. */
function head(): string {
  return screen.getByRole('heading', { level: 1 }).parentElement?.textContent ?? ''
}

/** The entries of the navigation that say "you are here". */
function lit(): string[] {
  return within(screen.getByRole('navigation', { name: 'Hauptbereiche' }))
    .getAllByRole('link')
    .filter((link) => link.getAttribute('aria-current') !== null)
    .map((link) => link.textContent)
}

beforeEach(() => {
  localStorage.clear()
  server = new TestServer()
  server.put('properties', school)

  for (const building of [gym, house, shed]) {
    server.put('buildings', building)
  }

  // Not in the order of their levels, so that the page has to order them.
  for (const floor of [first, gymGround, basement, ground]) {
    server.put('floors', floor)
  }

  // Not in the order of their numbers either.
  for (const room of [stairs, boilerRoom, numbered, caretaker, classroom, store, hall]) {
    server.put('rooms', room)
  }

  for (const each of [pump, boiler, lamp, ventilation, meter, elevator]) {
    server.put('assets', each)
  }

  for (const each of [
    entry('l-1', boiler.id, 'in_service', '2020-01-01'),
    entry('l-2', meter.id, 'in_service', '2020-01-01'),
    entry('l-3', meter.id, 'out_of_service', '2026-01-01'),
    // What lies ahead does not hold today.
    entry('l-4', boiler.id, 'decommissioned', '2999-01-01'),
    entry('l-5', lamp.id, 'in_service', '2021-06-01'),
  ]) {
    server.put('asset_lifecycle', each)
  }

  for (const each of [
    // The main meter supplies the whole school house, the room it stands in included.
    supply('v-1', meter.id, { buildingId: house.id }),
    // From the room beside, from the building as a whole, and from the other building.
    supply('v-2', lamp.id, { roomId: boilerRoom.id }),
    supply('v-3', elevator.id, { roomId: caretaker.id }),
    supply('v-4', ventilation.id, { roomId: boilerRoom.id }),
    // Named twice, by the room and by its building: one asset all the same.
    supply('v-5', ventilation.id, { buildingId: house.id }),
  ]) {
    server.put('asset_supplies', each)
  }

  signedInOffice('technician', [nord, sued])
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the page of a building', () => {
  it('says what the building is used as, when it was built and in which area it lies', async () => {
    await mount(`/gebaeude/${house.id}`)
    await screen.findByText('Bereich Süd')

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Schulhaus')
    expect(head()).toContain('Schule oder Hochschule')
    expect(head()).toContain('Baujahr 1975')
    expect(path()).toEqual([
      'Liegenschaften > /liegenschaften',
      'Schulzentrum Am Lindenhain > /liegenschaften/p-school',
    ])
    expect(wayBack()).toBe('Schulzentrum Am Lindenhain > /liegenschaften/p-school')
  })

  it('names every kind of a building that has several, and no year for one whose year is not known', async () => {
    await mount(`/gebaeude/${gym.id}`)
    await untilTheRightsAreKnown()

    expect(head()).toContain('Schule oder Hochschule')
    expect(head()).toContain('Versammlungs- oder Sportstätte')
    expect(head()).not.toContain('Baujahr')
  })

  it('names no area to somebody who sees one', async () => {
    signedInOffice('technician', [sued])
    await mount(`/gebaeude/${house.id}`)
    await untilTheRightsAreKnown()
    // Asked for long enough that the areas would have arrived.
    await expect(screen.findByText('Bereich Süd', undefined, { timeout: 250 })).rejects.toThrow()
  })

  it('lists its floors from the lowest up, each with its rooms and the assets standing in them', async () => {
    await mount(`/gebaeude/${house.id}`)

    expect(rowsOf('Geschosse des Gebäudes mit ihren Räumen und Anlagen')).toEqual([
      ['Untergeschoss', '0', '0'],
      // Five rooms; three assets in the boiler room and one with the caretaker.
      ['Erdgeschoss', '5', '4'],
      ['1. Obergeschoss', '1', '0'],
      // The elevator stands in the building and in no room of it.
      ['Ohne Raum', '', '1'],
    ])
    expect(screen.getByRole('link', { name: 'Erdgeschoss' }).getAttribute('href')).toBe(
      '/geschosse/f-ground',
    )
    // What stands in no room belongs to no floor, and leads nowhere.
    expect(screen.queryByRole('link', { name: 'Ohne Raum' })).toBeNull()
  })

  it('has no row for assets without a room while every asset stands in one', async () => {
    // The ventilation, the one asset of the gym, moves into its hall.
    server.put('assets', { ...ventilation, roomId: hall.id })
    await mount(`/gebaeude/${gym.id}`)

    expect(rowsOf('Geschosse des Gebäudes mit ihren Räumen und Anlagen')).toEqual([
      ['Erdgeschoss', '1', '1'],
    ])
  })

  it('counts an asset in no room under no floor', async () => {
    await mount(`/gebaeude/${gym.id}`)

    expect(rowsOf('Geschosse des Gebäudes mit ihren Räumen und Anlagen')).toEqual([
      ['Erdgeschoss', '1', '0'],
      ['Ohne Raum', '', '1'],
    ])
  })

  it('says that no floor is there yet in a building without one', async () => {
    await mount(`/gebaeude/${shed.id}`)

    expect(screen.getByText('In diesem Gebäude ist noch kein Geschoss angelegt.')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })

  // Taken stock of before anybody entered a floor: the asset is in the
  // building, and the page does not say that nothing is there.
  it('counts the assets of a building without a floor', async () => {
    server.put('assets', {
      ...elevator,
      id: 's-mower',
      buildingId: shed.id,
      number: 'AN-00030',
      name: 'Rasenmäher',
    })
    await mount(`/gebaeude/${shed.id}`)

    expect(rowsOf('Geschosse des Gebäudes mit ihren Räumen und Anlagen')).toEqual([
      ['Ohne Raum', '', '1'],
    ])
    expect(screen.queryByText('In diesem Gebäude ist noch kein Geschoss angelegt.')).toBeNull()
  })

  it('leads the Leitung to the changes of the building', async () => {
    signedInOffice('management', [nord, sued])
    await mount(`/gebaeude/${house.id}`)

    expect((await screen.findByRole('link', { name: 'Änderungen' })).getAttribute('href')).toBe(
      '/einstellungen/protokoll?art=buildings&datensatz=b-house',
    )
  })

  it('offers the log to nobody who may not read it', async () => {
    await mount(`/gebaeude/${house.id}`)
    await untilTheRightsAreKnown()
    await screen.findByText('Bereich Süd')

    expect(screen.queryByRole('link', { name: 'Änderungen' })).toBeNull()
  })

  it('lights the properties in the navigation, which it is opened from', async () => {
    await mount(`/gebaeude/${house.id}`)
    await untilTheRightsAreKnown()

    expect(lit()).toEqual(['Liegenschaften'])
  })

  it('shows its floors as cards on a phone, each leading to the floor', async () => {
    onA('phone')
    await mount(`/gebaeude/${house.id}`)

    expect(screen.queryByRole('table')).toBeNull()
    expect(
      screen
        .getAllByRole('listitem')
        .map((item) => item.textContent)
        .filter((text) => /Raum|Räume|Anlage/.test(text)),
    ).toEqual([
      'Untergeschoss0 Räume · 0 Anlagen',
      'Erdgeschoss5 Räume · 4 Anlagen',
      '1. Obergeschoss1 Raum · 0 Anlagen',
      'Ohne Raum1 Anlage',
    ])
    expect(screen.getByRole('link', { name: 'Erdgeschoss' }).getAttribute('href')).toBe(
      '/geschosse/f-ground',
    )
  })

  it('says why a building is not there', async () => {
    await mount('/gebaeude/b-gone')

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Nicht gefunden')
    // And leads back to where the places are listed.
    expect(path()).toEqual(['Liegenschaften > /liegenschaften'])
    expect(
      screen.getByText(
        'Dieses Gebäude gibt es nicht mehr, es liegt in einem Bereich, den dieser Zugang nicht sieht, oder dieses Gerät kennt es noch nicht.',
      ),
    ).toBeTruthy()
  })
})

describe('the page of a floor', () => {
  it('says its level and stands under its property and its building', async () => {
    await mount(`/geschosse/${ground.id}`)

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Erdgeschoss')
    expect(head()).toContain('Ebene 0')
    expect(path()).toEqual([
      'Liegenschaften > /liegenschaften',
      'Schulzentrum Am Lindenhain > /liegenschaften/p-school',
      'Schulhaus > /gebaeude/b-house',
    ])
    expect(wayBack()).toBe('Schulhaus > /gebaeude/b-house')
  })

  it('says a level below the ground as it is counted', async () => {
    await mount(`/geschosse/${basement.id}`)

    expect(head()).toContain('Ebene -1')
  })

  it('lists its rooms by their numbers as a person counts them, those without a number last', async () => {
    await mount(`/geschosse/${ground.id}`)

    expect(rowsOf('Räume des Geschosses')).toEqual([
      // E.2 before E.10, although "E.10" sorts first as a text.
      ['E.2', 'Lager', '', '0'],
      ['E.10', 'Hausmeister', 'Büro', '1'],
      ['E.14', 'Heizraum', 'Haustechnik', '3'],
      ['E.20', '', '', '0'],
      ['', 'Treppenhaus', '', '0'],
    ])
    expect(screen.getByText('5 Räume')).toBeTruthy()
  })

  it('leads to a room by its name, and by its number where it has no name', async () => {
    await mount(`/geschosse/${ground.id}`)

    expect(
      within(screen.getByRole('table', { name: 'Räume des Geschosses' }))
        .getAllByRole('link')
        .map((link) => `${link.textContent} > ${link.getAttribute('href') ?? ''}`),
    ).toEqual([
      'Lager > /raeume/r-store',
      'Hausmeister > /raeume/r-caretaker',
      'Heizraum > /raeume/r-boiler',
      'E.20 > /raeume/r-numbered',
      'Treppenhaus > /raeume/r-stairs',
    ])
  })

  it('counts one room as one', async () => {
    await mount(`/geschosse/${first.id}`)

    expect(screen.getByText('1 Raum')).toBeTruthy()
  })

  it('says that no room is there yet on a floor without one', async () => {
    await mount(`/geschosse/${basement.id}`)

    expect(screen.getByText('Auf diesem Geschoss ist noch kein Raum angelegt.')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('shows its rooms as cards on a phone, each leading to the room', async () => {
    onA('phone')
    await mount(`/geschosse/${ground.id}`)

    expect(screen.queryByRole('table')).toBeNull()
    expect(
      screen
        .getAllByRole('listitem')
        .map((item) => item.textContent)
        .filter((text) => text.includes('Anlage')),
    ).toEqual([
      'E.2 Lager0 Anlagen',
      'E.10 HausmeisterBüro · 1 Anlage',
      'E.14 HeizraumHaustechnik · 3 Anlagen',
      'E.200 Anlagen',
      'Treppenhaus0 Anlagen',
    ])
    expect(screen.getByRole('link', { name: 'E.14 Heizraum' }).getAttribute('href')).toBe(
      '/raeume/r-boiler',
    )
  })

  it('leads the Leitung to the changes of the floor', async () => {
    signedInOffice('management', [nord, sued])
    await mount(`/geschosse/${ground.id}`)

    expect((await screen.findByRole('link', { name: 'Änderungen' })).getAttribute('href')).toBe(
      '/einstellungen/protokoll?art=floors&datensatz=f-ground',
    )
  })

  it('offers the log to nobody who may not read it', async () => {
    await mount(`/geschosse/${ground.id}`)
    await untilTheRightsAreKnown()

    expect(screen.queryByRole('link', { name: 'Änderungen' })).toBeNull()
  })

  it('lights the properties in the navigation', async () => {
    await mount(`/geschosse/${ground.id}`)
    await untilTheRightsAreKnown()

    expect(lit()).toEqual(['Liegenschaften'])
  })

  it('says why a floor is not there', async () => {
    await mount('/geschosse/f-gone')

    expect(
      screen.getByText(
        'Dieses Geschoss gibt es nicht mehr, es liegt in einem Bereich, den dieser Zugang nicht sieht, oder dieses Gerät kennt es noch nicht.',
      ),
    ).toBeTruthy()
  })
})

describe('the page of a room', () => {
  const inside = 'Anlagen, die in diesem Raum stehen, mit ihrem Zustand am heutigen Tag'
  const supplying = 'Anlagen, die diesen Raum versorgen, mit dem Ort, an dem sie stehen'

  it('is called by its number and its name, says what it is used for and stands under its floor', async () => {
    await mount(`/raeume/${boilerRoom.id}`)

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('E.14 Heizraum')
    expect(head()).toContain('Nutzung: Haustechnik')
    expect(path()).toEqual([
      'Liegenschaften > /liegenschaften',
      'Schulzentrum Am Lindenhain > /liegenschaften/p-school',
      'Schulhaus > /gebaeude/b-house',
      'Erdgeschoss > /geschosse/f-ground',
    ])
    expect(wayBack()).toBe('Erdgeschoss > /geschosse/f-ground')
  })

  it('is called by its name where it has no number, and says nothing about a use nobody entered', async () => {
    await mount(`/raeume/${stairs.id}`)

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Treppenhaus')
    expect(head()).not.toContain('Nutzung')
  })

  it('is called by its number where it has no name', async () => {
    await mount(`/raeume/${numbered.id}`)

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('E.20')
  })

  it('lists the assets standing in it by their numbers, each with the state it is in today', async () => {
    await mount(`/raeume/${boilerRoom.id}`)

    expect(rowsOf(inside)).toEqual([
      // Out of service since the first of January; what it was before does not show.
      ['AN-00009', 'Hauptwasserzähler', 'Außer Betrieb'],
      // In service: its decommissioning lies ahead.
      ['AN-00010', 'Heizkessel', 'In Betrieb'],
      // Not numbered yet, and no state yet: after the others, and neither is made up.
      ['', 'Neue Pumpe', ''],
    ])
  })

  it('lists the assets that supply it without standing in it, each with where it stands', async () => {
    await mount(`/raeume/${boilerRoom.id}`)

    expect(rowsOf(supplying)).toEqual([
      // From the room beside: by that room.
      ['AN-00012', 'Notleuchte Flur', 'E.10 Hausmeister'],
      // From the other building of the property, in no room there: by that building. Named by
      // the room and by the building as a whole, and listed once.
      ['AN-00020', 'Lüftung Sporthalle', 'Sporthalle'],
    ])
    // The main meter supplies the whole house and stands in this room: it is listed above.
    expect(rowsOf(supplying).flat()).not.toContain('Hauptwasserzähler')
  })

  it('shows an asset that supplies the building of the room as a whole, and one that stands in the building and in no room', async () => {
    await mount(`/raeume/${caretaker.id}`)

    expect(rowsOf(inside)).toEqual([['AN-00012', 'Notleuchte Flur', 'In Betrieb']])
    expect(rowsOf(supplying)).toEqual([
      // In the building and in no room of it: by the building.
      ['AN-00003', 'Aufzug', 'Schulhaus'],
      // By naming the whole school house.
      ['AN-00009', 'Hauptwasserzähler', 'E.14 Heizraum'],
      ['AN-00020', 'Lüftung Sporthalle', 'Sporthalle'],
    ])
  })

  it('names the building first for an asset that stands in a room of another building', async () => {
    server.put('assets', { ...ventilation, roomId: hall.id })
    await mount(`/raeume/${boilerRoom.id}`)

    expect(rowsOf(supplying)).toContainEqual([
      'AN-00020',
      'Lüftung Sporthalle',
      'Sporthalle, H.01 Halle',
    ])
  })

  it('says so where nothing stands in it and nothing supplies it', async () => {
    await mount(`/raeume/${hall.id}`)

    expect(screen.getByText('In diesem Raum steht noch keine Anlage.')).toBeTruthy()
    expect(screen.getByText('Diesen Raum versorgt keine Anlage, die woanders steht.')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('shows its assets as cards on a phone, with number, state and where they stand', async () => {
    onA('phone')
    await mount(`/raeume/${boilerRoom.id}`)

    expect(screen.queryByRole('table')).toBeNull()
    expect(
      screen
        .getAllByRole('listitem')
        .map((item) => item.textContent)
        .filter((text) => /Hauptwasserzähler|Heizkessel|Pumpe|Notleuchte|Lüftung/.test(text)),
    ).toEqual([
      'HauptwasserzählerAN-00009Außer Betrieb',
      'HeizkesselAN-00010In Betrieb',
      'Neue Pumpe',
      'Notleuchte FlurAN-00012 · Steht in E.10 Hausmeister',
      'Lüftung SporthalleAN-00020 · Steht in Sporthalle',
    ])
  })

  it('leads the Leitung to the changes of the room', async () => {
    signedInOffice('management', [nord, sued])
    await mount(`/raeume/${boilerRoom.id}`)

    expect((await screen.findByRole('link', { name: 'Änderungen' })).getAttribute('href')).toBe(
      '/einstellungen/protokoll?art=rooms&datensatz=r-boiler',
    )
  })

  it('offers the log to nobody who may not read it', async () => {
    await mount(`/raeume/${boilerRoom.id}`)
    await untilTheRightsAreKnown()

    expect(screen.queryByRole('link', { name: 'Änderungen' })).toBeNull()
  })

  it('lights the properties in the navigation', async () => {
    await mount(`/raeume/${boilerRoom.id}`)
    await untilTheRightsAreKnown()

    expect(lit()).toEqual(['Liegenschaften'])
  })

  it('says why a room is not there', async () => {
    await mount('/raeume/r-gone')

    expect(
      screen.getByText(
        'Diesen Raum gibt es nicht mehr, er liegt in einem Bereich, den dieser Zugang nicht sieht, oder dieses Gerät kennt ihn noch nicht.',
      ),
    ).toBeTruthy()
  })
})

describe('the way down from a property', () => {
  it('leads from the page of a property to each of its buildings', async () => {
    await mount(`/liegenschaften/${school.id}`)

    expect(
      within(screen.getByRole('table', { name: 'Gebäude der Liegenschaft' }))
        .getAllByRole('link')
        .map((link) => `${link.textContent} > ${link.getAttribute('href') ?? ''}`),
    ).toEqual([
      'Geräteschuppen > /gebaeude/b-shed',
      'Schulhaus > /gebaeude/b-house',
      'Sporthalle > /gebaeude/b-gym',
    ])
  })

  it('leads from the card of a building on a phone to its page', async () => {
    onA('phone')
    await mount(`/liegenschaften/${school.id}`)

    expect(screen.queryByRole('table', { name: 'Gebäude der Liegenschaft' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Sporthalle' }).getAttribute('href')).toBe(
      '/gebaeude/b-gym',
    )
  })

  it('leads from the list of the properties to each building under its property', async () => {
    await mount('/liegenschaften')

    expect(screen.getByRole('link', { name: 'Schulhaus' }).getAttribute('href')).toBe(
      '/gebaeude/b-house',
    )
    expect(screen.getByRole('link', { name: 'Sporthalle' }).getAttribute('href')).toBe(
      '/gebaeude/b-gym',
    )
  })
})
