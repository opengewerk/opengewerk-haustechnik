import {
  type SubjectAccessChoice,
  type SubjectAccessMatch,
  subjectAccessNeedsEveryArea,
} from '@opengewerk/haustechnik-domain'
import { TestServer } from '@opengewerk/platform-web/testing'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  mountOffice,
  type NamedArea,
  signedInOffice,
  untilTheRightsAreKnown,
} from '../test-office.js'
import { subjectAccessWords } from './subject-access.js'

/**
 * "Auskunft über eine Person" on "Datenschutz" (#355): the access of a person
 * with one, a search for one without, and the file of either as a PDF or as
 * JSON, for a Leitung that sees every area.
 */

const nord: NamedArea = { id: 'a-nord', name: 'Nord' }

const choice = (everyArea: boolean): SubjectAccessChoice => ({
  people: [
    { userId: 'u-kai', name: 'Kai Becker', email: 'k.becker@beispielstadt.example' },
    { userId: 'u-sabine', name: 'Sabine Krämer', email: 's.kraemer@beispielstadt.example' },
  ],
  everyArea,
})

const found: SubjectAccessMatch[] = [
  {
    part: 'contacts',
    where: 'Ansprechpartner, Liegenschaft Rathaus',
    name: 'Petra Keller',
    email: 'p.keller@hv-beispiel.example',
  },
  {
    part: 'clients',
    where: 'Unterschrift als Auftraggeber, AU-00031',
    name: 'P. Keller',
    email: null,
  },
]

/** Mounts "Datenschutz" for the Leitung and keeps every address the screen asks. */
async function mounted(everyArea = true) {
  signedInOffice('management', [nord], {
    '/settings/processing-descriptions': { facts: [], changedSinceNewest: null, versions: [] },
    '/settings/subject-access': choice(everyArea),
    '/settings/subject-access/matches?term=Keller': found,
  })

  const answered = globalThis.fetch
  const asked: string[] = []

  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
    asked.push(path)

    return answered(path, init)
  })
  await mountOffice('/einstellungen/datenschutz', new TestServer(), [])
  await untilTheRightsAreKnown()

  return {
    asked,
    panel: await screen.findByRole('region', { name: subjectAccessWords.title }),
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the information about a person under "Datenschutz"', () => {
  it('is made for an access as a PDF or as JSON, at the address of that access', async () => {
    const { asked, panel } = await mounted()
    const opened = vi.fn(() => ({}) as Window)

    vi.stubGlobal('open', opened)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:auskunft')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    const access = await within(panel).findByRole('combobox', { name: subjectAccessWords.access })

    await userEvent.selectOptions(access, 'u-sabine')
    await userEvent.click(within(panel).getByRole('button', { name: subjectAccessWords.json }))

    await waitFor(() => {
      expect(asked).toContain('/settings/subject-access/people/u-sabine?format=json')
    })

    await userEvent.click(within(panel).getByRole('button', { name: subjectAccessWords.pdf }))

    await waitFor(() => {
      expect(asked).toContain('/settings/subject-access/people/u-sabine?format=pdf')
    })
  })

  it('searches for a person without an access, refuses a short search, and lists what it found', async () => {
    const { asked, panel } = await mounted()

    await userEvent.click(
      within(panel).getByRole('radio', { name: subjectAccessWords.withoutAccess }),
    )

    const term = within(panel).getByRole('textbox', { name: subjectAccessWords.term })

    await userEvent.type(term, 'Ke')
    await userEvent.click(within(panel).getByRole('button', { name: subjectAccessWords.search }))

    expect(
      within(panel).getByText('Gesucht wird nach mindestens 3 und höchstens 200 Zeichen.'),
    ).toBeTruthy()
    expect(asked.filter((path) => path.includes('/matches'))).toEqual([])

    await userEvent.type(term, 'ller')
    await userEvent.click(within(panel).getByRole('button', { name: subjectAccessWords.search }))

    const table = await within(panel).findByRole('table', {
      name: subjectAccessWords.found(2, 'Keller'),
    })

    expect(within(table).getByText('Petra Keller')).toBeTruthy()
    expect(within(table).getByText('Unterschrift als Auftraggeber, AU-00031')).toBeTruthy()
    expect(within(panel).getByRole('button', { name: subjectAccessWords.json })).toBeTruthy()
  })

  it('is not made by a Leitung that does not see every area', async () => {
    const { panel } = await mounted(false)

    expect(await within(panel).findByText(subjectAccessNeedsEveryArea)).toBeTruthy()
    expect(within(panel).queryByRole('button', { name: subjectAccessWords.pdf })).toBeNull()
  })
})
