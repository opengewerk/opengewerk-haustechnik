import type { DutyDeadlineFacts, RoleKey } from '@opengewerk/haustechnik-domain'
import type { DeadlineView } from '@opengewerk/platform-web/office'
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
} from '../test-office.js'
import type { DutyDeadlineView } from './deadlines.js'

/**
 * "Fristen" in the office (#104, #75; 2.4 of the concept): the list of the
 * foundation with the duty a deadline follows and what it hangs on, narrowed
 * on the server by the property and, for whoever sees more than one area,
 * by the area; the late ones counted beside the entry of the navigation;
 * and the settings of the kinds under "Einstellungen".
 */

const sued: NamedArea = { id: 'a-sued', name: 'Süd' }
const nord: NamedArea = { id: 'a-nord', name: 'Nord' }

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
const yard = { ...school, id: 'p-yard', name: 'Werkhof Nord' }
const house = {
  id: 'b-house',
  propertyId: school.id,
  areaId: sued.id,
  name: 'Schulhaus',
  kinds: '["school"]',
  yearBuilt: 1975,
}

const everything = ['properties', 'buildings', 'floors', 'rooms', 'assets'] as const

/** The first page of open deadlines, narrowed by nothing, as the list asks for it. */
const firstPage = '/deadlines?status=open&limit=50'
/** What the navigation asks to count the late ones. */
const lateOnes = '/deadlines?status=open&late=true&limit=1'

const dutyDue = {
  key: 'duty.due',
  title: 'Fälligkeit einer Pflicht',
  about: 'Folgt aus dem letzten Nachweis einer Pflicht und ihrer Frist.',
  source: 'duty',
  actions: ['reminder'],
  responsible: 'source',
  intervalDays: null,
  intervalMonths: null,
  leadDays: 30,
  setting: { intervalDays: null, intervalMonths: null, leadDays: null, responsibleUserId: null },
}

function deadline(
  id: string,
  further: Partial<DeadlineView & DutyDeadlineFacts> = {},
): DutyDeadlineView {
  return {
    id,
    kind: 'duty.due',
    kindTitle: 'Fälligkeit einer Pflicht',
    status: 'open',
    anchorOn: '2025-03-12',
    dueOn: '2027-03-12',
    remindOn: '2027-02-10',
    leadDays: 30,
    ownLeadDays: null,
    responsible: { userId: 'u-roth', name: 'Dennis Roth' },
    ownResponsibleUserId: null,
    source: { label: 'Hauptprüfung der Aufzugsanlage, Aufzug Schulhaus (AN-00012)' },
    remindedFor: null,
    remindedAt: null,
    closedAt: null,
    closedBy: null,
    follows: 'duty',
    dutyId: 'd-main',
    dutyTitle: 'Hauptprüfung der Aufzugsanlage',
    propertyId: school.id,
    buildingId: house.id,
    roomId: null,
    asset: { id: 'a-lift', number: 'AN-00012', name: 'Aufzug Schulhaus' },
    ...further,
  }
}

const lift = deadline('dl-lift')
const yardDuty = deadline('dl-yard', {
  dueOn: '2027-05-02',
  remindOn: '2027-04-02',
  dutyId: 'd-yard',
  dutyTitle: 'Wartung des Rolltors',
  propertyId: yard.id,
  buildingId: null,
  asset: null,
  responsible: { userId: 'u-lindner', name: 'Petra Lindner' },
})

function page(rows: readonly DutyDeadlineView[], total: number | null = rows.length) {
  return { rows, total, more: false }
}

const colleagues = [
  { userId: 'u-roth', name: 'Dennis Roth', active: true },
  { userId: 'u-lindner', name: 'Petra Lindner', active: true },
]

let server: TestServer

async function mount(
  at: string,
  answers: Readonly<Record<string, unknown>> = {},
  role: RoleKey = 'technical_management',
  areas: readonly NamedArea[] = [sued],
) {
  signedInOffice(role, areas, {
    ...servingCatalogue(),
    '/deadlines/kinds': [dutyDue],
    '/settings/deadlines': [dutyDue],
    '/deadlines/run': { succeededAt: new Date().toISOString(), failedAt: null, behind: false },
    '/duties/colleagues': colleagues,
    ...answers,
  })

  return mountOffice(at, server, everything)
}

/** The choice of a filter, by what it says to a screen reader. */
function filter(name: string): HTMLSelectElement {
  return screen.getByRole('combobox', { name })
}

beforeEach(() => {
  localStorage.clear()
  onA('desktop')
  server = new TestServer()
  server.put('properties', school)
  server.put('properties', yard)
  server.put('buildings', house)
})

afterEach(() => {
  vi.unstubAllGlobals()
  onlineManager.setOnline(true)
})

describe('the list "Fristen"', () => {
  it('names the duty, the asset or the place it hangs on and where, who answers and when it reminds', async () => {
    await mount('/fristen', { [firstPage]: page([lift, yardDuty]) })

    await waitFor(() => {
      expect(rowsOf('Fristen')).toHaveLength(2)
    })
    expect(rowsOf('Fristen').map((row) => row.slice(0, 4))).toEqual([
      [
        '12.03.2027',
        'Hauptprüfung der AufzugsanlageFälligkeit einer Pflicht',
        'AN-00012 Aufzug SchulhausSchulzentrum Am Lindenhain, Schulhaus',
        'Dennis Roth',
      ],
      [
        '02.05.2027',
        'Wartung des RolltorsFälligkeit einer Pflicht',
        'Werkhof NordLiegenschaft',
        'Petra Lindner',
      ],
    ])

    const table = screen.getByRole('table', { name: 'Fristen' })

    expect(
      within(table)
        .getByRole('link', { name: 'Hauptprüfung der Aufzugsanlage' })
        .getAttribute('href'),
    ).toBe('/pflichten/d-main')
    expect(
      within(table).getByRole('link', { name: 'AN-00012 Aufzug Schulhaus' }).getAttribute('href'),
    ).toBe('/anlagen/a-lift')
    expect(screen.getByText('2 offen')).toBeTruthy()
  })

  it('narrows to a property on the server, and offers the area only to whoever sees more than one', async () => {
    await mount('/fristen', {
      [firstPage]: page([lift, yardDuty]),
      '/deadlines?status=open&property=p-yard&limit=50': page([yardDuty]),
    })

    await waitFor(() => {
      expect(rowsOf('Fristen')).toHaveLength(2)
    })
    expect(screen.queryByRole('combobox', { name: 'Nach Bereich filtern' })).toBeNull()
    expect(
      within(filter('Nach Liegenschaft filtern'))
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Alle Liegenschaften', 'Schulzentrum Am Lindenhain', 'Werkhof Nord'])

    fireEvent.change(filter('Nach Liegenschaft filtern'), { target: { value: yard.id } })

    await waitFor(() => {
      expect(rowsOf('Fristen').map((row) => row[1])).toEqual([
        'Wartung des RolltorsFälligkeit einer Pflicht',
      ])
    })
  })

  it('narrows to an area for whoever sees two', async () => {
    await mount(
      '/fristen',
      {
        [firstPage]: page([lift, yardDuty]),
        '/deadlines?status=open&area=a-nord&limit=50': page([yardDuty]),
      },
      'management',
      [nord, sued],
    )

    await waitFor(() => {
      expect(rowsOf('Fristen')).toHaveLength(2)
    })
    fireEvent.change(filter('Nach Bereich filtern'), { target: { value: nord.id } })

    await waitFor(() => {
      expect(rowsOf('Fristen')).toHaveLength(1)
    })
  })

  it('counts the late deadlines beside its entry in the navigation', async () => {
    await mount('/fristen', { [firstPage]: page([lift]), [lateOnes]: page([lift], 3) })

    expect(
      await within(screen.getByRole('navigation', { name: 'Hauptbereiche' })).findByRole('link', {
        name: 'Fristen, 3 überfällig',
      }),
    ).toBeTruthy()
  })
})

describe('the settings of the deadlines', () => {
  it.each([
    ['management', true],
    ['technical_management', true],
    ['site_management', false],
  ] as const)('stand under "Einstellungen" for %s: %s', async (role, offered) => {
    await mount('/einstellungen', {}, role)

    await screen.findByRole('heading', { level: 1, name: 'Einstellungen' })
    await untilTheRightsAreKnown()
    expect(
      screen
        .queryAllByRole('link')
        .some((link) => link.getAttribute('href') === '/einstellungen/fristen'),
    ).toBe(offered)
  })

  it('show the kind with its lead and say nobody "du"', async () => {
    await mount('/einstellungen/fristen')

    expect(await screen.findByText('Fälligkeit einer Pflicht')).toBeTruthy()
    expect(screen.queryByText(/\(du\)/)).toBeNull()
  })
})
