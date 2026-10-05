import { type AreaId, areaNameProblem } from '@opengewerk/haustechnik-domain'
import { TestServer } from '@opengewerk/platform-web/testing'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { memberIn } from '../../app/test-entry.js'
import { areasQuery } from '../../session/areas.js'
import {
  mountOffice,
  onA,
  rowsOf,
  signedInOffice,
  untilTheRightsAreKnown,
  type WriteAnswer,
  type Written,
} from '../test-office.js'
import {
  type AreaEntry,
  areaScreenWords,
  firstOf,
  inASentence,
  leftWithoutAny,
  nothingLiesIn,
  whatLiesIn,
  whatMovesFirst,
  whoIsLeft,
} from './areas.js'

/**
 * "Bereiche" among the settings (#84, section 2.8 of the concept): the areas
 * of a tenant with what lies in them and who they are named for, and the
 * dialogs an area is made, renamed and removed in.
 */

const named = (...names: string[]) =>
  names.map((name) => ({ id: `p-${name.toLowerCase().replaceAll(' ', '-')}`, name }))

const petra = { userId: 'u-petra', name: 'Petra Lindner' }
const murat = { userId: 'u-murat', name: 'Murat Yilmaz' }
const lena = { userId: 'u-lena', name: 'Lena Vogt' }
const dennis = { userId: 'u-dennis', name: 'Dennis Roth' }
const tobias = { userId: 'u-tobias', name: 'Tobias Wendt' }

// As the route gives them: the properties and the people by name.
const nord: AreaEntry = {
  id: 'a-nord' as AreaId,
  name: 'Nord',
  properties: named(
    'Bürgerhaus Mitte',
    'Feuerwache Nord',
    'Kita Sonnenhang',
    'Stadtarchiv',
    'Verwaltung Am Probehang',
    'Werkhof Nord',
    'Wertstoffhof',
  ),
  buildings: 12,
  members: [lena, murat, petra],
}

const sued: AreaEntry = {
  id: 'a-sued' as AreaId,
  name: 'Süd',
  properties: named(
    'Grundschule Musterhausen',
    'Schulzentrum Am Lindenhain',
    'Sporthalle Süd',
    'Wohnanlage Birkenweg',
  ),
  buildings: 7,
  members: [dennis, murat, tobias],
}

// Just made: nothing lies in it, and nobody is named for it.
const west: AreaEntry = {
  id: 'a-west' as AreaId,
  name: 'West',
  properties: [],
  buildings: 0,
  members: [],
}

// Murat holds in two areas, everybody else in one; the Leitung in all.
const held = [
  { userId: 'u-1', all: true, areaIds: [] },
  { userId: petra.userId, all: false, areaIds: [nord.id] },
  { userId: lena.userId, all: false, areaIds: [nord.id] },
  { userId: murat.userId, all: false, areaIds: [nord.id, sued.id] },
  { userId: dennis.userId, all: false, areaIds: [sued.id] },
  { userId: tobias.userId, all: false, areaIds: [sued.id] },
]

const stillRemoved =
  'In diesem Bereich liegen noch entfernte Liegenschaften. Sie werden vorher in einen anderen Bereich verlegt.'

let server: TestServer
/** What a route answers a write with, set by the test that expects one. */
let answerToWrite: (write: Written) => WriteAnswer
/** What was written to a route, in order. */
let written: Written[]
/** How often an address was read. */
let read: Map<string, number>

/** What the server holds, as far as the screen asks; a test names what differs. */
function signedIn(
  differing: Readonly<Record<string, unknown>> = {},
  areas: readonly AreaEntry[] = [nord, sued, west],
) {
  written = signedInOffice(
    'management',
    areas.map(({ id, name }) => ({ id, name })),
    { '/areas/overview': areas, '/areas/members': held, ...differing },
    (write) => answerToWrite(write),
  )

  const answering = fetch as unknown as (path: string, init?: RequestInit) => Promise<Response>

  read = new Map()
  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
    if ((init?.method ?? 'GET') === 'GET') {
      read.set(path, (read.get(path) ?? 0) + 1)
    }

    return answering(path, init)
  })
}

async function mount() {
  const mounted = await mountOffice('/einstellungen/bereiche', server, ['properties'])

  await untilTheRightsAreKnown()
  await screen.findByRole('table', { name: areaScreenWords.caption })

  return mounted
}

/** What went to the server, as a method and an address. */
function sent(): string[] {
  return written.map((write) => `${write.method} ${write.path}`)
}

function table(): HTMLElement {
  return screen.getByRole('table', { name: areaScreenWords.caption })
}

beforeEach(() => {
  localStorage.clear()
  server = new TestServer()
  answerToWrite = () => ({ status: 500, body: { message: 'Nicht erwartet.' } })
  onA('desktop')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the areas of a tenant', () => {
  it('stand with what lies in them and who they are named for', async () => {
    signedIn()
    await mount()

    expect(rowsOf(areaScreenWords.caption)).toEqual([
      [
        'Nord7 Liegenschaften, 12 Gebäude',
        'Bürgerhaus Mitte, Feuerwache Nord, Kita Sonnenhang, Stadtarchiv, Verwaltung Am Probehang, 2 weitere',
        'Lena Vogt, Murat Yilmaz, Petra Lindner',
        'UmbenennenEntfernen',
      ],
      [
        'Süd4 Liegenschaften, 7 Gebäude',
        'Grundschule Musterhausen, Schulzentrum Am Lindenhain, Sporthalle Süd, Wohnanlage Birkenweg',
        'Dennis Roth, Murat Yilmaz, Tobias Wendt',
        'UmbenennenEntfernen',
      ],
      ['Westkeine Liegenschaft', 'keine', 'niemand', 'UmbenennenEntfernen'],
    ])
    expect(screen.getByText(areaScreenWords.rule)).toBeTruthy()
  })

  it('count what lies in an area as a person says it', () => {
    expect(whatLiesIn({ properties: [], buildings: 0 })).toBe('keine Liegenschaft')
    expect(whatLiesIn({ properties: named('Werkhof'), buildings: 0 })).toBe(
      '1 Liegenschaft, kein Gebäude',
    )
    expect(whatLiesIn({ properties: named('Werkhof'), buildings: 1 })).toBe(
      '1 Liegenschaft, 1 Gebäude',
    )
    expect(whatLiesIn(nord)).toBe('7 Liegenschaften, 12 Gebäude')
  })

  it('name the first of a list and count the rest', () => {
    expect(firstOf(['A', 'B', 'C'], 3)).toEqual(['A', 'B', 'C'])
    expect(firstOf(['A', 'B', 'C', 'D'], 3)).toEqual(['A', 'B', 'C', '1 weitere'])
    expect(inASentence([])).toBe('')
    expect(inASentence(['A'])).toBe('A')
    expect(inASentence(['A', 'B'])).toBe('A und B')
    expect(inASentence(['A', 'B', 'C'])).toBe('A, B und C')
  })

  it('offer nothing to change to whoever may only see the settings', async () => {
    signedIn({ '/auth/tenants': [{ ...memberIn('management'), rights: ['settings.read'] }] })
    await mount()

    expect(rowsOf(areaScreenWords.caption).map((row) => row[3])).toEqual(['', '', ''])
    expect(screen.queryByRole('button', { name: areaScreenWords.add })).toBeNull()
  })

  it('keep the last one: a single area is renamed and not removed', async () => {
    signedIn({}, [nord])
    await mount()

    expect(within(table()).getByRole('button', { name: 'Bereich Nord umbenennen' })).toBeTruthy()
    expect(within(table()).queryByRole('button', { name: 'Bereich Nord entfernen' })).toBeNull()
  })

  it('are among the settings for whoever may see them', async () => {
    signedIn()
    await mountOffice('/einstellungen', server, ['properties'])
    await untilTheRightsAreKnown()

    expect((await screen.findByRole('link', { name: /^Bereiche/ })).getAttribute('href')).toBe(
      '/einstellungen/bereiche',
    )
  })

  it('are not among the settings for whoever may not', async () => {
    signedIn({ '/auth/tenants': [{ ...memberIn('management'), rights: ['membership.read'] }] })
    await mountOffice('/einstellungen', server, ['properties'])
    await untilTheRightsAreKnown()

    await screen.findByRole('link', { name: /^Zugänge/ })
    expect(screen.queryByRole('link', { name: /^Bereiche/ })).toBeNull()
  })
})

describe('a new area', () => {
  async function open(user: ReturnType<typeof userEvent.setup>) {
    await mount()
    await user.click(screen.getByRole('button', { name: areaScreenWords.add }))

    return screen.findByRole('dialog', { name: areaScreenWords.add })
  }

  it('goes out under its name, and everything that names an area is read again', async () => {
    const user = userEvent.setup()

    signedIn()
    answerToWrite = () => ({ status: 201, body: { id: 'a-ost', name: 'Ost' } })

    const { queries } = await mount()

    // What a list read before somebody came here: the areas it filters by.
    // No screen that stands reads them, so they are not asked for again
    // now, but they must not count as fresh either.
    queries.setQueryData(
      areasQuery.queryKey,
      [nord, sued, west].map(({ id, name }) => ({ id, name })),
    )

    await user.click(screen.getByRole('button', { name: areaScreenWords.add }))

    const dialog = await screen.findByRole('dialog', { name: areaScreenWords.add })
    const before = {
      overview: read.get('/areas/overview') ?? 0,
      members: read.get('/areas/members') ?? 0,
    }

    await user.type(within(dialog).getByLabelText(/^Name/), '  Ost ')
    await user.click(within(dialog).getByRole('button', { name: areaScreenWords.add }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    expect(written).toEqual([{ method: 'POST', path: '/areas', body: { name: 'Ost' } }])
    await waitFor(() => {
      expect(read.get('/areas/overview')).toBe(before.overview + 1)
      expect(read.get('/areas/members')).toBe(before.members + 1)
    })
    expect(queries.getQueryState(areasQuery.queryKey)?.isInvalidated).toBe(true)
  })

  it('is not sent without a name, and says what is missing', async () => {
    const user = userEvent.setup()

    signedIn()

    const dialog = await open(user)

    await user.type(within(dialog).getByLabelText(/^Name/), '   ')
    await user.click(within(dialog).getByRole('button', { name: areaScreenWords.add }))

    expect(within(dialog).getByText(areaNameProblem('') ?? '')).toBeTruthy()
    expect(written).toEqual([])
  })

  it('says what the server says where the tenant has an area of that name', async () => {
    const user = userEvent.setup()

    signedIn()
    answerToWrite = () => ({
      status: 409,
      body: { message: 'Einen Bereich mit diesem Namen gibt es schon.' },
    })

    const dialog = await open(user)

    await user.type(within(dialog).getByLabelText(/^Name/), 'Nord')
    await user.click(within(dialog).getByRole('button', { name: areaScreenWords.add }))

    expect(
      await within(dialog).findByText('Einen Bereich mit diesem Namen gibt es schon.'),
    ).toBeTruthy()
    // What was typed stands, to be changed.
    expect(within(dialog).getByLabelText<HTMLInputElement>(/^Name/).value).toBe('Nord')
  })
})

describe('another name for an area', () => {
  async function open(user: ReturnType<typeof userEvent.setup>) {
    await mount()
    await user.click(within(table()).getByRole('button', { name: 'Bereich Süd umbenennen' }))

    return screen.findByRole('dialog', { name: 'Bereich „Süd“ umbenennen' })
  }

  it('goes to the area, trimmed', async () => {
    const user = userEvent.setup()

    signedIn()
    answerToWrite = () => ({ status: 200, body: { id: sued.id, name: 'Südstadt' } })

    const dialog = await open(user)
    const name = within(dialog).getByLabelText<HTMLInputElement>(/^Name/)

    expect(name.value).toBe('Süd')

    await user.clear(name)
    await user.type(name, ' Südstadt  ')
    await user.click(within(dialog).getByRole('button', { name: areaScreenWords.rename }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    expect(written).toEqual([
      { method: 'PATCH', path: '/areas/a-sued', body: { name: 'Südstadt' } },
    ])
  })

  it('sends nothing where the name stays as it was', async () => {
    const user = userEvent.setup()

    signedIn()

    const dialog = await open(user)

    await user.type(within(dialog).getByLabelText(/^Name/), '  ')
    await user.click(within(dialog).getByRole('button', { name: areaScreenWords.rename }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    expect(written).toEqual([])
  })
})

describe('an area that goes', () => {
  async function open(user: ReturnType<typeof userEvent.setup>, area: AreaEntry) {
    const mounted = await mount()

    await user.click(
      within(table()).getByRole('button', { name: `Bereich ${area.name} entfernen` }),
    )

    return {
      dialog: await screen.findByRole('dialog', { name: `Bereich „${area.name}“ entfernen?` }),
      exchanged: vi.spyOn(mounted.client, 'synchronise'),
    }
  }

  it('says what lies in it and who is left without an area, and moves it to the one other area', async () => {
    const user = userEvent.setup()

    signedIn({}, [nord, sued])
    answerToWrite = () => ({ status: 200, body: { removed: sued.id, moved: 4 } })

    const { dialog, exchanged } = await open(user, sued)

    expect(within(dialog).getByText(whatMovesFirst(sued))).toBeTruthy()
    // Murat holds in Nord as well and keeps it.
    expect(
      within(dialog).getByText(
        'Dennis Roth und Tobias Wendt haben danach keinen Bereich mehr. Sie sehen nichts mit ' +
          'Ortsbezug, bis ihnen unter „Zugänge“ ein Bereich gegeben wird. Gesperrt wird niemand.',
      ),
    ).toBeTruthy()

    const target = within(dialog).getByLabelText<HTMLSelectElement>(areaScreenWords.moveTo)

    // One other area: nothing to choose, and nothing to forget.
    expect(target.value).toBe(nord.id)
    expect([...target.options].map((option) => option.text)).toEqual(['Nord'])

    await user.click(within(dialog).getByRole('button', { name: areaScreenWords.moveAndRemove }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    expect(sent()).toEqual(['DELETE /areas/a-sued?moveTo=a-nord'])
    // The properties come down again with the area they lie in now.
    expect(exchanged).toHaveBeenCalled()
  })

  it('asks where to where there is more than one other area, and is not sent before', async () => {
    const user = userEvent.setup()

    signedIn()
    answerToWrite = () => ({ status: 200, body: { removed: sued.id, moved: 4 } })

    const { dialog } = await open(user, sued)
    const target = within(dialog).getByLabelText<HTMLSelectElement>(areaScreenWords.moveTo)

    expect(target.value).toBe('')

    await user.click(within(dialog).getByRole('button', { name: areaScreenWords.moveAndRemove }))

    expect(within(dialog).getByRole('alert').textContent).toBe(areaScreenWords.whereTo)
    expect(written).toEqual([])

    await user.selectOptions(target, west.id)
    await user.click(within(dialog).getByRole('button', { name: areaScreenWords.moveAndRemove }))

    await waitFor(() => {
      expect(sent()).toEqual(['DELETE /areas/a-sued?moveTo=a-west'])
    })
  })

  it('goes as it is where nothing lies in it', async () => {
    const user = userEvent.setup()

    signedIn()
    answerToWrite = () => ({ status: 200, body: { removed: west.id, moved: 0 } })

    const { dialog, exchanged } = await open(user, west)

    expect(within(dialog).getByText(nothingLiesIn('West', []))).toBeTruthy()
    expect(within(dialog).queryByLabelText(areaScreenWords.moveTo)).toBeNull()

    await user.click(within(dialog).getByRole('button', { name: areaScreenWords.remove }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    expect(sent()).toEqual(['DELETE /areas/a-west'])
    // Nothing moved, so nothing on the device is out of date.
    expect(exchanged).not.toHaveBeenCalled()
  })

  it('asks where to after all where the server knows of properties the list does not show', async () => {
    const user = userEvent.setup()

    signedIn()
    answerToWrite = (write) =>
      write.path === '/areas/a-west'
        ? { status: 409, body: { message: stillRemoved } }
        : { status: 200, body: { removed: west.id, moved: 2 } }

    const { dialog } = await open(user, west)

    await user.click(within(dialog).getByRole('button', { name: areaScreenWords.remove }))

    expect(await within(dialog).findByText(stillRemoved)).toBeTruthy()

    await user.selectOptions(within(dialog).getByLabelText(areaScreenWords.moveTo), nord.id)
    await user.click(within(dialog).getByRole('button', { name: areaScreenWords.moveAndRemove }))

    await waitFor(() => {
      expect(sent()).toEqual(['DELETE /areas/a-west', 'DELETE /areas/a-west?moveTo=a-nord'])
    })
  })

  it('does not ask where to where the server refuses for another reason', async () => {
    const user = userEvent.setup()

    signedIn()
    answerToWrite = () => ({ status: 403, body: { message: 'Dafür fehlt das Recht.' } })

    const { dialog } = await open(user, west)

    await user.click(within(dialog).getByRole('button', { name: areaScreenWords.remove }))

    expect((await within(dialog).findByRole('alert')).textContent).toBe('Dafür fehlt das Recht.')
    expect(within(dialog).queryByLabelText(areaScreenWords.moveTo)).toBeNull()
  })

  it('stays and says what the server says where it refuses', async () => {
    const user = userEvent.setup()

    signedIn({}, [nord, sued])
    answerToWrite = () => ({
      status: 409,
      body: { message: 'In diesem Bereich liegen Liegenschaften, die Sie nicht sehen.' },
    })

    const { dialog } = await open(user, sued)

    await user.click(within(dialog).getByRole('button', { name: areaScreenWords.moveAndRemove }))

    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      'In diesem Bereich liegen Liegenschaften, die Sie nicht sehen.',
    )
  })

  it('names nobody to whoever does not see who works for the tenant, and does not ask', async () => {
    const user = userEvent.setup()

    signedIn(
      {
        '/auth/tenants': [
          { ...memberIn('management'), rights: ['settings.read', 'settings.write'] },
        ],
      },
      [nord, sued],
    )

    const { dialog } = await open(user, sued)

    expect(within(dialog).getByText(areaScreenWords.whoeverHoldsOnlyThis)).toBeTruthy()
    expect(read.has('/areas/members')).toBe(false)
  })

  it('leaves without an area whoever holds in it alone', () => {
    expect(leftWithoutAny(sued, held)).toEqual(['Dennis Roth', 'Tobias Wendt'])
    expect(leftWithoutAny(nord, held)).toEqual(['Lena Vogt', 'Petra Lindner'])
    expect(leftWithoutAny(west, held)).toEqual([])
    // Somebody who holds in every area loses nothing with one of them.
    expect(
      leftWithoutAny({ id: sued.id, members: [dennis] }, [
        { userId: dennis.userId, all: true, areaIds: [] },
      ]),
    ).toEqual([])
    expect(leftWithoutAny(sued, undefined)).toBeNull()
  })

  it('says for one person and for several what the removal means, and nothing for nobody', () => {
    expect(whoIsLeft([])).toBeNull()
    expect(whoIsLeft(['Dennis Roth'])).toBe(
      'Dennis Roth hat danach keinen Bereich mehr und sieht nichts mit Ortsbezug, bis unter ' +
        '„Zugänge“ ein Bereich gegeben wird. Gesperrt wird niemand.',
    )
    expect(whoIsLeft(null)).toBe(areaScreenWords.whoeverHoldsOnlyThis)
    expect(nothingLiesIn('West', ['Dennis Roth'])).toBe('In „West“ liegt keine Liegenschaft.')
    expect(
      whatMovesFirst({ name: 'Ost', properties: named('Werkhof Ost') }).startsWith(
        'In „Ost“ liegt noch 1 Liegenschaft: Werkhof Ost. Sie wird vorher',
      ),
    ).toBe(true)
  })
})
