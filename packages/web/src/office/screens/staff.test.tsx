import { type Area, type AreaId, shippedRoles } from '@opengewerk/haustechnik-domain'
import { TestServer } from '@opengewerk/platform-web/testing'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { memberIn } from '../../app/test-entry.js'
import { areasToBeginWith, areaWords } from '../staff-areas.js'
import { areasOnTop, substitutionWords } from '../substitutions.js'
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

/**
 * "Zugänge" in the office (#84, section 2.8 of the concept). The screen and
 * its dialogs are the foundation's and tested there. Here: what this
 * application binds into them, the areas somebody holds in as a column and as
 * a part of both dialogs, and the card of the substitutions.
 */

// As the model types them, so that what is asked without a screen takes them too.
const nord: Area = { id: 'a-nord' as AreaId, name: 'Nord' }
const sued: Area = { id: 'a-sued' as AreaId, name: 'Süd' }

function person(userId: string, name: string, role: string, blockedAt: string | null = null) {
  return {
    userId,
    name,
    email: `${userId}@beispielstadt.example`,
    roles: [role],
    blockedAt,
    lastSignInAt: null,
    twoFactorEnabled: false,
    hasPasskey: false,
  }
}

// The person signed in is `u-1` (`signedInOffice`).
const sabine = person('u-1', 'Sabine Krämer', 'management')
const joerg = person('u-joerg', 'Jörg Albrecht', 'technical_management')
const petra = person('u-petra', 'Petra Lindner', 'site_management')
const dennis = person('u-dennis', 'Dennis Roth', 'site_management')
const murat = person('u-murat', 'Murat Yilmaz', 'technician')

const everybody = [sabine, joerg, petra, dennis, murat]

const held = [
  { userId: sabine.userId, all: true, areaIds: [] },
  { userId: joerg.userId, all: true, areaIds: [] },
  { userId: petra.userId, all: false, areaIds: [nord.id] },
  { userId: dennis.userId, all: false, areaIds: [sued.id] },
  { userId: murat.userId, all: false, areaIds: [sued.id, nord.id] },
]

function invitation(id: string, name: string, role: string) {
  return {
    id,
    name,
    email: `${id}@beispielstadt.example`,
    roles: [role],
    expiresAt: '2036-10-12T08:00:00.000Z',
    invitedBy: sabine.userId,
    mail: null,
  }
}

const kai = invitation('i-kai', 'Kai Neumann', 'technician')

// Far enough ahead that the day the tests run on does not matter.
const autumn = {
  id: 's-autumn',
  substitute: petra.userId,
  absent: dennis.userId,
  startsOn: '2036-10-12',
  endsOn: '2036-10-23',
}

const roles = shippedRoles.map(({ key, label, rights, leads, secondFactor }) => ({
  key,
  label,
  rights: [...rights],
  leads,
  secondFactor,
}))

const accounts = 'Konten dieses Betreibers'
const invitations = 'Einladungen, die noch benutzt werden können'
const substitutions = 'Vertretungen, die laufen oder anstehen'

let server: TestServer
/** What a route answers a write with, set by the test that expects one. */
let answerToWrite: (write: Written) => WriteAnswer
/** What was written to a route, in order. */
let written: Written[]

/** What the server holds, as far as the screen asks; a test names what differs. */
function signedIn(
  differing: Readonly<Record<string, unknown>> = {},
  areas: readonly NamedArea[] = [nord, sued],
) {
  written = signedInOffice(
    'management',
    areas,
    {
      '/staff': everybody,
      '/staff/roles': roles,
      '/staff/invitations': [kai],
      '/areas/members': held,
      '/areas/invitations': [{ invitationId: kai.id, all: false, areaIds: [sued.id] }],
      '/substitutions': [autumn],
      [`/staff/${petra.userId}/devices`]: [],
      ...differing,
    },
    (write) => answerToWrite(write),
  )
}

async function mount() {
  const mounted = await mountOffice('/einstellungen/zugaenge', server, ['properties'])

  await untilTheRightsAreKnown()
  await screen.findByRole('table', { name: accounts })

  return mounted
}

/** What was written to one route with one method. */
function sent(method: string, path: string): unknown[] {
  return written
    .filter((write) => write.method === method && write.path === path)
    .map((write) => write.body)
}

/** The column "Bereiche" of a table, row by row. */
function areasIn(table: string): (string | null | undefined)[] {
  return rowsOf(table).map((row) => row[2])
}

/** The part "Bereiche" of the dialog that stands. */
function areasPart(): HTMLElement {
  return within(screen.getByRole('dialog')).getByRole('group', { name: areaWords.title })
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

describe('the areas somebody holds in', () => {
  it('stand beside every access: all, the ones named, in the order of the tenant', async () => {
    signedIn()
    await mount()

    await waitFor(() => {
      expect(areasIn(accounts)).toEqual(['alle', 'alle', 'Nord', 'Süd', 'Nord, Süd'])
    })
    expect(screen.queryByText(areaWords.withoutAny, { exact: false })).toBeNull()
  })

  it('say so where somebody holds in none, with what that means', async () => {
    signedIn({
      '/areas/members': held.map((entry) =>
        entry.userId === dennis.userId ? { ...entry, areaIds: [] } : entry,
      ),
    })
    await mount()

    await waitFor(() => {
      expect(areasIn(accounts)).toEqual(['alle', 'alle', 'Nord', 'ohne Bereich', 'Nord, Süd'])
    })
    expect(screen.getByText(areaWords.withoutAny, { exact: false })).toBeTruthy()
  })

  it('stand beside an open invitation, and one that names nothing shows what a membership begins with', async () => {
    signedIn({
      '/staff/invitations': [
        kai,
        invitation('i-lea', 'Lea Sommer', 'technician'),
        invitation('i-olaf', 'Olaf Berger', 'management'),
      ],
    })
    await mount()

    await waitFor(() => {
      expect(areasIn(invitations)).toEqual(['Süd', 'ohne Bereich', 'alle'])
    })
  })

  it('begin as the database gives them where nobody names any', () => {
    expect(areasToBeginWith(['technician'], [nord])).toEqual({ all: false, areaIds: [nord.id] })
    expect(areasToBeginWith(['technician'], [nord, sued])).toEqual({ all: false, areaIds: [] })
    expect(areasToBeginWith(['site_management'], [])).toEqual({ all: false, areaIds: [] })
    expect(areasToBeginWith(['management'], [nord, sued])).toEqual({ all: true, areaIds: [] })
    expect(areasToBeginWith(['technician', 'technical_management'], [nord])).toEqual({
      all: true,
      areaIds: [],
    })
  })
})

describe('a new access', () => {
  async function open(user: ReturnType<typeof userEvent.setup>) {
    await mount()
    await user.click(await screen.findByRole('button', { name: 'Zugang anlegen' }))

    const dialog = await screen.findByRole('dialog', { name: 'Zugang anlegen' })

    await user.type(within(dialog).getByLabelText(/^Name/), 'Kai Neumann')
    await user.type(within(dialog).getByLabelText(/^E-Mail/), 'k.neumann@beispielstadt.example')

    return dialog
  }

  beforeEach(() => {
    answerToWrite = () => ({
      status: 201,
      body: { token: 'ein-link', expiresAt: '2036-10-12T08:00:00.000Z' },
    })
  })

  it('goes out with its role and the areas ticked for it', async () => {
    const user = userEvent.setup()

    signedIn()

    const dialog = await open(user)
    const part = areasPart()

    // Named areas and none of them: with two areas nobody is given one unasked.
    expect(
      within(part).getByRole<HTMLInputElement>('radio', { name: areaWords.named }).checked,
    ).toBe(true)
    expect(within(part).getByText(areaWords.noneTicked)).toBeTruthy()

    await user.click(within(part).getByRole('checkbox', { name: 'Süd' }))

    expect(within(part).queryByText(areaWords.noneTicked)).toBeNull()

    await user.click(within(dialog).getByRole('button', { name: 'Link erzeugen' }))

    await waitFor(() => {
      expect(sent('POST', '/staff')).toEqual([
        {
          name: 'Kai Neumann',
          email: 'k.neumann@beispielstadt.example',
          roles: ['technician'],
          send: 'link',
          additions: { all: false, areaIds: [sued.id] },
        },
      ])
    })
  })

  it('goes out with every area where somebody picks that', async () => {
    const user = userEvent.setup()

    signedIn()

    const dialog = await open(user)
    const part = areasPart()

    await user.click(within(part).getByRole('checkbox', { name: 'Nord' }))
    await user.click(within(part).getByRole('radio', { name: areaWords.every }))

    // Every area is no list: the boxes are gone.
    expect(within(part).queryByRole('checkbox')).toBeNull()

    await user.click(within(dialog).getByRole('button', { name: 'Link erzeugen' }))

    await waitFor(() => {
      expect(sent('POST', '/staff')).toMatchObject([{ additions: { all: true, areaIds: [] } }])
    })
  })

  it('holds in every area with a role that does, whatever was ticked before', async () => {
    const user = userEvent.setup()

    signedIn()

    const dialog = await open(user)

    await user.click(within(areasPart()).getByRole('checkbox', { name: 'Nord' }))
    await user.click(within(dialog).getByRole('radio', { name: 'Leitung' }))

    const part = areasPart()
    const every = within(part).getByRole<HTMLInputElement>('radio', { name: areaWords.every })

    // Nothing to choose: the choice stands still, and there is no box to tick.
    expect(every.checked).toBe(true)
    expect(every.closest('fieldset')?.disabled).toBe(true)
    expect(within(part).queryByRole('checkbox')).toBeNull()
    expect(within(part).getByText(areaWords.rule)).toBeTruthy()

    await user.click(within(dialog).getByRole('button', { name: 'Link erzeugen' }))

    await waitFor(() => {
      expect(sent('POST', '/staff')).toMatchObject([
        { roles: ['management'], additions: { all: true, areaIds: [] } },
      ])
    })
  })

  it('starts with the one area of a tenant that has a single one', async () => {
    const user = userEvent.setup()

    signedIn({ '/areas/members': held.map((entry) => ({ ...entry, areaIds: [] })) }, [nord])

    const dialog = await open(user)
    const part = areasPart()

    expect(within(part).getByRole<HTMLInputElement>('checkbox', { name: 'Nord' }).checked).toBe(
      true,
    )
    expect(within(part).queryByText(areaWords.noneTicked)).toBeNull()

    await user.click(within(dialog).getByRole('button', { name: 'Link erzeugen' }))

    await waitFor(() => {
      expect(sent('POST', '/staff')).toMatchObject([
        { additions: { all: false, areaIds: [nord.id] } },
      ])
    })
  })
})

describe('the access of somebody', () => {
  async function open(user: ReturnType<typeof userEvent.setup>, name: string) {
    await mount()
    await user.click(await screen.findByRole('button', { name: `${name} bearbeiten` }))

    return screen.findByRole('dialog', { name: 'Zugang bearbeiten' })
  }

  beforeEach(() => {
    answerToWrite = () => ({ status: 200, body: {} })
  })

  it('starts with the areas they hold, and a change of them goes out with the role they have', async () => {
    const user = userEvent.setup()

    signedIn()

    const dialog = await open(user, petra.name)
    const part = areasPart()

    expect(within(part).getByRole<HTMLInputElement>('checkbox', { name: 'Nord' }).checked).toBe(
      true,
    )
    expect(within(part).getByRole<HTMLInputElement>('checkbox', { name: 'Süd' }).checked).toBe(
      false,
    )

    await user.click(within(part).getByRole('checkbox', { name: 'Süd' }))
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(sent('PATCH', `/staff/${petra.userId}`)).toEqual([
        { roles: ['site_management'], additions: { all: false, areaIds: [nord.id, sued.id] } },
      ])
    })
  })

  it('loses an area that is unticked, down to none', async () => {
    const user = userEvent.setup()

    signedIn()

    const dialog = await open(user, petra.name)

    await user.click(within(areasPart()).getByRole('checkbox', { name: 'Nord' }))

    expect(within(areasPart()).getByText(areaWords.noneTicked)).toBeTruthy()

    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(sent('PATCH', `/staff/${petra.userId}`)).toEqual([
        { roles: ['site_management'], additions: { all: false, areaIds: [] } },
      ])
    })
  })

  it('holds in every area once given a role that does', async () => {
    const user = userEvent.setup()

    signedIn()

    const dialog = await open(user, petra.name)

    await user.click(within(dialog).getByRole('radio', { name: 'Technische Leitung' }))

    const every = within(areasPart()).getByRole<HTMLInputElement>('radio', {
      name: areaWords.every,
    })

    expect(every.checked).toBe(true)
    expect(every.closest('fieldset')?.disabled).toBe(true)

    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(sent('PATCH', `/staff/${petra.userId}`)).toEqual([
        { roles: ['technical_management'], additions: { all: true, areaIds: [] } },
      ])
    })
  })
})

describe('the substitutions', () => {
  /** A day typed into a field for a day. */
  function typeDay(field: HTMLElement, day: string) {
    fireEvent.change(field, { target: { value: day } })
  }

  async function open(user: ReturnType<typeof userEvent.setup>) {
    await mount()
    await user.click(await screen.findByRole('button', { name: substitutionWords.add }))

    return screen.findByRole('dialog', { name: substitutionWords.add })
  }

  it('are listed with who stands in for whom, when, and what that adds', async () => {
    signedIn()
    await mount()

    await waitFor(() => {
      expect(rowsOf(substitutions)).toEqual([
        ['Petra Lindner', 'Dennis Roth', 'Süd', '12.10.2036 bis 23.10.2036', 'Beenden'],
      ])
    })
  })

  it('add what the absent person holds and the substitute does not', () => {
    const areas = [nord, sued]
    const both = { userId: 'x', all: false, areaIds: [nord.id, sued.id] }
    const north = { userId: 'y', all: false, areaIds: [nord.id] }
    const all = { userId: 'z', all: true, areaIds: [] }
    const none = { userId: 'n', all: false, areaIds: [] }

    expect(areasOnTop(north, both, areas)).toBe('Süd')
    expect(areasOnTop(none, both, areas)).toBe('Nord, Süd')
    expect(areasOnTop(both, north, areas)).toBe('keine')
    expect(areasOnTop(north, all, areas)).toBe('alle')
    expect(areasOnTop(all, north, areas)).toBe('keine')
    expect(areasOnTop(all, all, areas)).toBe('keine')
    expect(areasOnTop(north, none, areas)).toBe('keine')
  })

  it('say so while there is none', async () => {
    signedIn({ '/substitutions': [] })
    await mount()

    expect(await screen.findByText(substitutionWords.none)).toBeTruthy()
    expect(screen.queryByRole('table', { name: substitutions })).toBeNull()
    expect(screen.getByRole('button', { name: substitutionWords.add })).toBeTruthy()
  })

  it('are entered at their route: who stands in, for whom, from which day to which', async () => {
    const user = userEvent.setup()

    signedIn()
    answerToWrite = (write) => ({ status: 201, body: { id: 's-new', ...(write.body as object) } })

    const dialog = await open(user)

    await user.selectOptions(within(dialog).getByLabelText('Wer vertritt'), petra.userId)
    await user.selectOptions(within(dialog).getByLabelText('Für wen'), dennis.userId)
    typeDay(within(dialog).getByLabelText('Anfang'), '2037-03-02')
    typeDay(within(dialog).getByLabelText('Ende'), '2037-03-13')

    // What it will mean, before it is entered.
    expect(dialog.textContent).toContain(
      'Petra Lindner sieht vom 02.03.2037 bis zum 13.03.2037 zusätzlich die Bereiche von Dennis Roth: Süd.',
    )

    await user.click(within(dialog).getByRole('button', { name: substitutionWords.add }))

    await waitFor(() => {
      expect(sent('POST', '/substitutions')).toEqual([
        {
          substitute: petra.userId,
          absent: dennis.userId,
          startsOn: '2037-03-02',
          endsOn: '2037-03-13',
        },
      ])
    })
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
  })

  it('say before one is entered that it adds nothing, where the substitute holds those areas already', async () => {
    const user = userEvent.setup()

    signedIn()

    const dialog = await open(user)

    // Murat holds in both areas, Petra in the north alone; and it is one day.
    await user.selectOptions(within(dialog).getByLabelText('Wer vertritt'), murat.userId)
    await user.selectOptions(within(dialog).getByLabelText('Für wen'), petra.userId)
    typeDay(within(dialog).getByLabelText('Anfang'), '2037-03-02')
    typeDay(within(dialog).getByLabelText('Ende'), '2037-03-02')

    expect(dialog.textContent).toContain(
      'Murat Yilmaz sieht am 02.03.2037 nichts zusätzlich: von Petra Lindner kommt kein Bereich dazu.',
    )
    expect(dialog.textContent).not.toContain('zusätzlich die Bereiche')
  })

  it('are not sent where the model refuses, and the dialog says why', async () => {
    const user = userEvent.setup()

    signedIn()

    const dialog = await open(user)

    await user.selectOptions(within(dialog).getByLabelText('Wer vertritt'), petra.userId)
    await user.selectOptions(within(dialog).getByLabelText('Für wen'), petra.userId)
    typeDay(within(dialog).getByLabelText('Anfang'), '2037-03-02')
    typeDay(within(dialog).getByLabelText('Ende'), '2037-03-13')
    await user.click(within(dialog).getByRole('button', { name: substitutionWords.add }))

    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      'Niemand vertritt sich selbst.',
    )

    await user.selectOptions(within(dialog).getByLabelText('Für wen'), dennis.userId)
    typeDay(within(dialog).getByLabelText('Ende'), '2037-03-01')
    await user.click(within(dialog).getByRole('button', { name: substitutionWords.add }))

    await waitFor(() => {
      expect(within(dialog).getByRole('alert').textContent).toBe(
        'Die Vertretung endet, bevor sie beginnt.',
      )
    })
    expect(sent('POST', '/substitutions')).toEqual([])
  })

  it('say what the server says where it refuses, and keep what was typed', async () => {
    const user = userEvent.setup()

    signedIn()
    answerToWrite = () => ({
      status: 409,
      body: { message: 'Diese Vertretung gibt es für diese Tage schon.' },
    })

    const dialog = await open(user)

    await user.selectOptions(within(dialog).getByLabelText('Wer vertritt'), petra.userId)
    await user.selectOptions(within(dialog).getByLabelText('Für wen'), dennis.userId)
    typeDay(within(dialog).getByLabelText('Anfang'), '2036-10-12')
    typeDay(within(dialog).getByLabelText('Ende'), '2036-10-23')
    await user.click(within(dialog).getByRole('button', { name: substitutionWords.add }))

    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      'Diese Vertretung gibt es für diese Tage schon.',
    )
    expect(within(dialog).getByLabelText<HTMLSelectElement>('Wer vertritt').value).toBe(
      petra.userId,
    )
  })

  it('offer nobody to stand in who is shut out, and anybody to be stood in for', async () => {
    const user = userEvent.setup()
    const gone = person('u-gone', 'Lena Vogt', 'technician', '2036-01-01T08:00:00.000Z')

    signedIn({
      '/staff': [...everybody, gone],
      '/areas/members': [...held, { userId: gone.userId, all: false, areaIds: [nord.id] }],
    })

    const dialog = await open(user)
    const offered = (label: string) =>
      within(within(dialog).getByLabelText(label))
        .getAllByRole<HTMLOptionElement>('option')
        .map((option) => option.value)

    expect(offered('Wer vertritt')).toEqual(['', ...everybody.map((one) => one.userId)])
    expect(offered('Für wen')).toEqual(['', ...everybody.map((one) => one.userId), gone.userId])
    // A person with the role and the areas named for them.
    expect(
      within(within(dialog).getByLabelText('Für wen')).getByRole('option', {
        name: 'Murat Yilmaz, Haustechnik Nord, Süd',
      }),
    ).toBeTruthy()
    expect(
      within(within(dialog).getByLabelText('Für wen')).getByRole('option', {
        name: 'Sabine Krämer, Leitung',
      }),
    ).toBeTruthy()
  })

  it('are ended at their route, after a question', async () => {
    const user = userEvent.setup()

    signedIn()
    answerToWrite = () => ({ status: 200, body: { ended: autumn.id } })
    await mount()

    await user.click(
      await screen.findByRole('button', {
        name: 'Vertretung von Petra Lindner für Dennis Roth beenden',
      }),
    )

    const question = await screen.findByRole('alertdialog', { name: 'Vertretung beenden?' })

    expect(written).toEqual([])

    await user.click(within(question).getByRole('button', { name: 'Beenden' }))

    await waitFor(() => {
      expect(written).toEqual([
        { method: 'DELETE', path: `/substitutions/${autumn.id}`, body: undefined },
      ])
    })
  })

  it('offer nothing to change to whoever may only read who works here', async () => {
    signedIn({
      '/auth/tenants': [{ ...memberIn('management'), rights: ['membership.read'] }],
    })
    await mount()

    await waitFor(() => {
      expect(rowsOf(substitutions)).toEqual([
        ['Petra Lindner', 'Dennis Roth', 'Süd', '12.10.2036 bis 23.10.2036', ''],
      ])
    })
    expect(screen.queryByRole('button', { name: substitutionWords.add })).toBeNull()
  })
})
