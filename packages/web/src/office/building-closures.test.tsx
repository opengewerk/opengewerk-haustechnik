import { today } from '@opengewerk/platform-web/format'
import { TestServer } from '@opengewerk/platform-web/testing'
import { onlineManager } from '@tanstack/react-query'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { closureWords } from './building-closures.js'
import {
  mountOffice,
  type NamedArea,
  signedInOffice,
  untilTheRightsAreKnown,
  type WriteAnswer,
  type Written,
} from './test-office.js'

/**
 * The card "Schließzeiten" on the page of a building in the office (#86, 4.1
 * and 4.5 of the concept): what is closed now and what is to come, entered
 * and removed by whoever plans the rounds, with a connection, at the routes
 * of the building. None is changed.
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
const house = {
  id: 'b-house',
  ...place,
  name: 'Schulhaus',
  shortCode: 'S',
  kinds: '["school"]',
  yearBuilt: 1975,
}
const gym = { ...house, id: 'b-gym', name: 'Sporthalle', shortCode: null }
const shed = { ...house, id: 'b-shed', name: 'Schuppen', shortCode: null }

// Far enough ahead that the day the tests run on does not matter.
const atHouse = { ...place, buildingId: house.id }
const winter = {
  id: 'c-winter',
  ...atHouse,
  startsOn: '2036-12-24',
  endsOn: '2037-01-06',
  reason: 'Weihnachtsferien',
}
const summer = {
  id: 'c-summer',
  ...atHouse,
  startsOn: '2037-07-27',
  endsOn: '2037-09-06',
  reason: 'Sommerferien',
}
/** One day, and nobody said what for. */
const oneDay = {
  id: 'c-day',
  ...atHouse,
  startsOn: '2036-11-02',
  endsOn: '2036-11-02',
  reason: null,
}
const long = {
  id: 'c-gym',
  ...place,
  buildingId: gym.id,
  startsOn: '2036-10-01',
  endsOn: '2036-10-31',
  reason: 'Sanierung',
}
const over = {
  id: 'c-over',
  ...atHouse,
  startsOn: '2020-08-01',
  endsOn: '2020-08-31',
  reason: 'Sommerferien 2020',
}

const everything = ['properties', 'buildings', 'floors', 'rooms', 'assets', 'building_closures']

let server: TestServer
/** What a route answers a write with, set by the test that expects one. */
let answerToWrite: (write: Written) => WriteAnswer
/** What was written to a route, in order. */
let written: Written[]

function signedIn(role: Parameters<typeof signedInOffice>[0]) {
  written = signedInOffice(role, [nord, sued], {}, (write) => answerToWrite(write))
}

async function mount(building: { readonly id: string } = house) {
  return (await mountOffice(`/gebaeude/${building.id}`, server, everything)).router
}

/** The card, once the page of the building stands. */
async function card(): Promise<HTMLElement> {
  return screen.findByRole('region', { name: 'Schließzeiten' })
}

/** What the card lists, line by line. */
function listed(within_: HTMLElement): (string | null)[] {
  return within(within_)
    .queryAllByRole('listitem')
    .map((line) => line.textContent)
}

/** A day typed into a field for a day. */
function typeDay(field: HTMLElement, day: string) {
  fireEvent.change(field, { target: { value: day } })
}

/** The office says "Keine Verbindung" once it has noticed that there is none. */
async function untilTheOfficeKnowsItIsOffline(): Promise<void> {
  window.dispatchEvent(new Event('offline'))
  await screen.findAllByText(/^Keine Verbindung/)
}

beforeEach(() => {
  localStorage.clear()
  server = new TestServer()
  answerToWrite = () => ({ status: 500, body: { message: 'Nicht erwartet.' } })

  server.put('properties', school)

  for (const building of [house, gym, shed]) {
    server.put('buildings', building)
  }

  // Not in the order of their days.
  for (const closure of [summer, long, winter, oneDay]) {
    server.put('building_closures', closure)
  }

  // Whoever plans the rounds, and keeps no building.
  signedIn('site_management')
})

afterEach(() => {
  vi.unstubAllGlobals()
  onlineManager.setOnline(true)
})

describe('the closing times of a building', () => {
  it('lists what is closed now and what is to come, from the earliest on, and what each is for', async () => {
    await mount()

    const closures = await card()

    // Not the one of the gym.
    expect(listed(closures)).toEqual([
      '02.11.2036',
      '24.12.2036 bis 06.01.2037 · Weihnachtsferien',
      '27.07.2037 bis 06.09.2037 · Sommerferien',
    ])
    expect(within(closures).getByText(closureWords.rule)).toBeTruthy()
    expect(within(closures).queryByRole('button', { name: /^Frühere/ })).toBeNull()
  })

  it('says so while none is entered', async () => {
    await mount(shed)

    const closures = await card()

    expect(
      within(closures).getByText('Für dieses Gebäude ist keine Schließzeit eingetragen.'),
    ).toBeTruthy()
    expect(listed(closures)).toEqual([])
    expect(within(closures).getByText(closureWords.rule)).toBeTruthy()
  })

  it('keeps the ones that are over behind a button', async () => {
    const user = userEvent.setup()

    server.put('building_closures', over)
    await mount()

    const closures = await card()

    expect(listed(closures)).toHaveLength(3)
    expect(closures.textContent).not.toContain('Sommerferien 2020')

    await user.click(within(closures).getByRole('button', { name: 'Frühere anzeigen' }))

    expect(listed(closures)).toEqual([
      '01.08.2020 bis 31.08.2020 · Sommerferien 2020',
      '02.11.2036',
      '24.12.2036 bis 06.01.2037 · Weihnachtsferien',
      '27.07.2037 bis 06.09.2037 · Sommerferien',
    ])

    await user.click(within(closures).getByRole('button', { name: 'Frühere ausblenden' }))

    expect(listed(closures)).toHaveLength(3)
  })

  it('counts a closure that ends today as one that stands', async () => {
    server.put('building_closures', { ...over, id: 'c-today', endsOn: today(), reason: 'Umbau' })
    await mount()

    const closures = await card()

    expect(listed(closures)[0]).toContain('Umbau')
    expect(within(closures).queryByRole('button', { name: 'Frühere anzeigen' })).toBeNull()
  })

  it('says that none is to come where all are over', async () => {
    server.put('building_closures', { ...over, buildingId: shed.id })
    await mount(shed)

    const closures = await card()

    expect(
      within(closures).getByText('Für dieses Gebäude steht keine Schließzeit an.'),
    ).toBeTruthy()
    expect(within(closures).getByRole('button', { name: 'Frühere anzeigen' })).toBeTruthy()
  })

  // Section 7 of the concept: whoever plans and hands out activities enters
  // them, the Objektleitung too. Whoever only walks the rounds reads them.
  it('offers adding and removing to whoever plans the rounds, and to nobody else', async () => {
    await mount()

    const closures = await card()

    expect(await within(closures).findByRole('button', { name: 'Hinzufügen' })).toBeTruthy()
    expect(
      within(closures).getByRole('button', {
        name: 'Schließzeit 24.12.2036 bis 06.01.2037 entfernen',
      }),
    ).toBeTruthy()
    expect(
      within(closures).getByRole('button', { name: 'Schließzeit 02.11.2036 entfernen' }),
    ).toBeTruthy()
  })

  it('shows whoever only reads the closures and nothing to press', async () => {
    signedIn('technician')
    await mount()

    const closures = await card()

    await untilTheRightsAreKnown()
    expect(listed(closures)).toHaveLength(3)
    expect(within(closures).queryByRole('button')).toBeNull()

    // And nothing about a connection for what is not offered in the first place.
    await untilTheOfficeKnowsItIsOffline()
    expect(within(closures).queryByText(closureWords.needsConnection)).toBeNull()
  })
})

describe('a closing time entered', () => {
  /** A route that enters the closure under an id, and puts it where the next exchange finds it. */
  function entering(id: string) {
    return (write: Written): WriteAnswer => {
      const made = { ...atHouse, ...(write.body as Record<string, unknown>), id }

      server.put('building_closures', made)

      return { status: 201, body: made }
    }
  }

  async function open(user: ReturnType<typeof userEvent.setup>) {
    await mount()

    const closures = await card()

    await user.click(await within(closures).findByRole('button', { name: 'Hinzufügen' }))

    return closures
  }

  it('is sent to the route of its building, and stands in the card once the form has closed', async () => {
    const user = userEvent.setup()
    const closures = await open(user)

    answerToWrite = entering('c-autumn')

    // While the form stands, the button that opened it is gone.
    expect(within(closures).getAllByRole('button', { name: 'Hinzufügen' })).toHaveLength(1)

    typeDay(within(closures).getByLabelText(/^Von/), '2036-10-26')
    typeDay(within(closures).getByLabelText(/^Bis/), '2036-10-30')
    await user.type(within(closures).getByRole('textbox', { name: 'Anlass' }), ' Herbstferien ')
    await user.click(within(closures).getByRole('button', { name: 'Hinzufügen' }))

    await waitFor(() => {
      expect(within(closures).queryByRole('textbox', { name: 'Anlass' })).toBeNull()
    })
    expect(written).toEqual([
      {
        method: 'POST',
        path: '/buildings/b-house/closures',
        body: { startsOn: '2036-10-26', endsOn: '2036-10-30', reason: 'Herbstferien' },
      },
    ])
    await waitFor(() => {
      expect(listed(closures)[0]).toBe('26.10.2036 bis 30.10.2036 · Herbstferien')
    })
  })

  it('needs no reason', async () => {
    const user = userEvent.setup()
    const closures = await open(user)

    answerToWrite = entering('c-bridge')

    typeDay(within(closures).getByLabelText(/^Von/), '2036-05-23')
    typeDay(within(closures).getByLabelText(/^Bis/), '2036-05-23')
    await user.click(within(closures).getByRole('button', { name: 'Hinzufügen' }))

    await waitFor(() => {
      expect(written).toHaveLength(1)
    })
    expect(written[0]?.body).toEqual({ startsOn: '2036-05-23', endsOn: '2036-05-23', reason: null })
  })

  it('holds what the model refuses before anything is sent', async () => {
    const user = userEvent.setup()
    const closures = await open(user)

    typeDay(within(closures).getByLabelText(/^Von/), '2036-10-30')
    typeDay(within(closures).getByLabelText(/^Bis/), '2036-10-26')
    await user.click(within(closures).getByRole('button', { name: 'Hinzufügen' }))
    expect((await within(closures).findByRole('alert')).textContent).toBe(
      'Der letzte Tag liegt vor dem ersten.',
    )

    typeDay(within(closures).getByLabelText(/^Bis/), '2036-10-31')
    await user.type(within(closures).getByRole('textbox', { name: 'Anlass' }), 'x'.repeat(81))
    await user.click(within(closures).getByRole('button', { name: 'Hinzufügen' }))
    expect((await within(closures).findByRole('alert')).textContent).toBe(
      'Der Anlass hat höchstens 80 Zeichen.',
    )

    expect(written).toEqual([])
  })

  it('shows the sentence of the server when it refuses, and keeps what was typed', async () => {
    const user = userEvent.setup()
    const closures = await open(user)

    answerToWrite = () => ({
      status: 422,
      body: { message: 'Dieses Gebäude gibt es nicht oder nicht mehr.' },
    })

    typeDay(within(closures).getByLabelText(/^Von/), '2036-10-26')
    typeDay(within(closures).getByLabelText(/^Bis/), '2036-10-30')
    await user.type(within(closures).getByRole('textbox', { name: 'Anlass' }), 'Herbstferien')
    await user.click(within(closures).getByRole('button', { name: 'Hinzufügen' }))

    expect((await within(closures).findByRole('alert')).textContent).toBe(
      'Dieses Gebäude gibt es nicht oder nicht mehr.',
    )
    expect((within(closures).getByLabelText(/^Von/) as HTMLInputElement).value).toBe('2036-10-26')
    expect(
      (within(closures).getByRole('textbox', { name: 'Anlass' }) as HTMLInputElement).value,
    ).toBe('Herbstferien')
  })

  it('closes without a word when the way out is taken', async () => {
    const user = userEvent.setup()
    const closures = await open(user)

    typeDay(within(closures).getByLabelText(/^Von/), '2036-10-26')
    await user.click(within(closures).getByRole('button', { name: 'Abbrechen' }))

    expect(within(closures).queryByRole('textbox', { name: 'Anlass' })).toBeNull()
    expect(within(closures).getByRole('button', { name: 'Hinzufügen' })).toBeTruthy()
    expect(written).toEqual([])
  })
})

describe('a closing time removed', () => {
  const removeWinter = 'Schließzeit 24.12.2036 bis 06.01.2037 entfernen'

  it('goes at the route of its building, after a question that says what follows', async () => {
    const user = userEvent.setup()

    await mount()

    const closures = await card()

    answerToWrite = () => {
      server.put('building_closures', { ...winter, deletedAt: '2026-10-05T10:00:00.000Z' })

      return { status: 200, body: winter }
    }

    await user.click(await within(closures).findByRole('button', { name: removeWinter }))

    const question = screen.getByRole('alertdialog', { name: `${removeWinter}?` })

    expect(question.textContent).toContain(closureWords.removal)
    expect(written).toEqual([])

    await user.click(within(question).getByRole('button', { name: 'Entfernen' }))

    await waitFor(() => {
      expect(listed(closures)).toEqual(['02.11.2036', '27.07.2037 bis 06.09.2037 · Sommerferien'])
    })
    expect(written).toEqual([
      { method: 'DELETE', path: '/buildings/b-house/closures/c-winter', body: undefined },
    ])
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('stays when the question is answered with the way out', async () => {
    const user = userEvent.setup()

    await mount()

    const closures = await card()

    await user.click(await within(closures).findByRole('button', { name: removeWinter }))
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Abbrechen' }),
    )

    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(written).toEqual([])
    expect(listed(closures)).toHaveLength(3)
  })

  it('stays, with the sentence of the server, when the removal is refused', async () => {
    const user = userEvent.setup()
    const sentence = 'Diese Schließzeit gibt es nicht oder nicht mehr.'

    await mount()

    const closures = await card()

    answerToWrite = () => ({ status: 404, body: { message: sentence } })

    await user.click(await within(closures).findByRole('button', { name: removeWinter }))
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Entfernen' }),
    )

    expect((await within(closures).findByRole('alert')).textContent).toBe(sentence)
    expect(listed(closures)).toHaveLength(3)
  })
})

describe('the closing times without a connection', () => {
  it('are read, and say that entering and removing take one', async () => {
    await mount()

    const closures = await card()
    const add = (await within(closures).findByRole('button', {
      name: 'Hinzufügen',
    })) as HTMLButtonElement
    const remove = within(closures).getByRole('button', {
      name: 'Schließzeit 02.11.2036 entfernen',
    }) as HTMLButtonElement

    expect([add.disabled, remove.disabled]).toEqual([false, false])
    expect(within(closures).queryByText(closureWords.needsConnection)).toBeNull()

    window.dispatchEvent(new Event('offline'))

    expect(await within(closures).findByText(closureWords.needsConnection)).toBeTruthy()
    expect([add.disabled, remove.disabled]).toEqual([true, true])
    expect(listed(closures)).toHaveLength(3)
  })

  it('hold an open form, and say why', async () => {
    const user = userEvent.setup()

    await mount()

    const closures = await card()

    await user.click(await within(closures).findByRole('button', { name: 'Hinzufügen' }))

    window.dispatchEvent(new Event('offline'))

    expect(await within(closures).findByText(closureWords.needsConnection)).toBeTruthy()
    expect(
      (within(closures).getByRole('button', { name: 'Hinzufügen' }) as HTMLButtonElement).disabled,
    ).toBe(true)
    // Said once, by the form.
    expect(within(closures).getAllByText(closureWords.needsConnection)).toHaveLength(1)
  })
})
