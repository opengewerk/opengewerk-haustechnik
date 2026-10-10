import type { DefectEntry, Overview, OverviewDuty, RoleKey } from '@opengewerk/haustechnik-domain'
import { TestServer } from '@opengewerk/platform-web/testing'
import { onlineManager } from '@tanstack/react-query'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { servingCatalogue } from '../../app/test-catalogue.js'
import { memberIn } from '../../app/test-entry.js'
import { mountOffice, type NamedArea, onA, rowsOf, signedInOffice } from '../test-office.js'

/**
 * "Übersicht", the start page of the office (#122, 4.3 of the concept,
 * scenario 1): the numbers the server counts, each a link to the list it
 * counts, narrowed the same way and to the area chosen; the overdue duties
 * and those of the next 30 days, the duties never recorded and the defects
 * past their deadline; the areas for whoever sees more than one.
 */

const nord: NamedArea = { id: 'a-nord', name: 'Nord' }
const sued: NamedArea = { id: 'a-sued', name: 'Süd' }

const yard = {
  id: 'p-yard',
  areaId: nord.id,
  name: 'Werkhof Nord',
  street: 'Hafenstraße 2',
  postalCode: '00001',
  city: 'Musterhausen',
  federalState: 'DE-BW',
  note: null,
}
const school = { ...yard, id: 'p-school', areaId: sued.id, name: 'Schulzentrum Am Lindenhain' }

function duty(id: string, further: Readonly<Record<string, unknown>>): OverviewDuty {
  return {
    id,
    title: 'Prüfung',
    state: 'due',
    appointment: { dueOn: '2026-10-12', onTimeUntil: '2026-10-12' },
    propertyId: school.id,
    buildingId: null,
    roomId: null,
    assetId: null,
    asset: null,
    ...further,
  } as unknown as OverviewDuty
}

const electrics = duty('d-electrics', {
  title: 'Prüfung der ortsfesten elektrischen Anlage',
  state: 'overdue',
  appointment: { dueOn: '2026-09-15', onTimeUntil: '2026-09-15' },
  propertyId: yard.id,
  assetId: 'as-12',
  asset: {
    id: 'as-12',
    number: 'AN-00012',
    name: 'Elektrische Anlage Halle 1',
    kind: 'probe.elevator',
    buildingId: 'b-hall',
    roomId: null,
  },
})
const lighting = duty('d-lighting', {
  title: 'Prüfung der Sicherheitsbeleuchtung',
  assetId: 'as-44',
  asset: {
    id: 'as-44',
    number: 'AN-00044',
    name: 'Sicherheitsbeleuchtung',
    kind: 'probe.elevator',
    buildingId: 'b-hall',
    roomId: null,
  },
})
const roof = duty('d-roof', {
  title: 'Dachrinnen reinigen',
  state: 'met',
  appointment: { dueOn: '2026-11-02', onTimeUntil: '2026-11-02' },
})

function defect(id: string, description: string, status: DefectEntry['status']): DefectEntry {
  return {
    id,
    description,
    defectClass: null,
    foundOn: '2026-09-24',
    dueOn: '2026-09-28',
    status,
    overdue: true,
    origin: { kind: 'hand' },
    place: {
      propertyId: school.id,
      propertyName: school.name,
      buildingId: null,
      buildingName: null,
      roomId: null,
      roomLabel: null,
      asset: null,
    },
    workOrder: null,
  } as unknown as DefectEntry
}

const everywhere: Overview = {
  today: '2026-10-05',
  overdue: 3,
  dueIn30Days: 7,
  dueIn90Days: 18,
  neverRecorded: 5,
  reportsMissing: 2,
  defectsOverdue: 2,
  soon: [electrics, lighting, roof],
  soonTotal: 10,
  neverRecordedFirst: [
    duty('d-never-1', { title: 'Untersuchung auf Legionellen', state: 'never_recorded' }),
    duty('d-never-2', { title: 'Prüfung der Feuerlöscher', state: 'never_recorded' }),
    duty('d-never-3', { title: 'Wartung der Lüftung', state: 'never_recorded' }),
  ],
  defectsOverdueFirst: [
    defect('m-1', 'Notleuchte Flur 1. OG ohne Funktion', 'ordered'),
    defect('m-2', 'Feuerlöscher ohne Prüfplakette', 'found'),
  ],
}

/** The north alone: nothing overdue, and nothing past its deadline. */
const inTheNorth: Overview = {
  ...everywhere,
  overdue: 0,
  dueIn30Days: 1,
  dueIn90Days: 2,
  neverRecorded: 1,
  reportsMissing: 0,
  defectsOverdue: 0,
  soon: [lighting],
  soonTotal: 1,
  neverRecordedFirst: [],
  defectsOverdueFirst: [],
}

const soonTable =
  'Überfällige und in 30 Tagen fällige Pflichten mit Anlage und Liegenschaft, Termin und Zustand'

let server: TestServer

function mount(
  at: string,
  answers: Readonly<Record<string, unknown>>,
  areas: readonly NamedArea[] = [nord, sued],
  role: RoleKey = 'management',
) {
  signedInOffice(role, areas, { ...servingCatalogue(), ...answers })

  return mountOffice(at, server, ['properties', 'buildings', 'floors', 'rooms', 'assets'])
}

/** The numbers, each as what it says and where it leads. */
function tiles(): string[] {
  return within(screen.getByRole('list', { name: 'Betreiberverantwortung in Zahlen' }))
    .getAllByRole('link')
    .map((link) => `${link.textContent} > ${link.getAttribute('href') ?? ''}`)
}

function href(name: string): string {
  return screen.getByRole('link', { name }).getAttribute('href') ?? ''
}

beforeEach(() => {
  localStorage.clear()
  onA('desktop')
  server = new TestServer()
  server.put('properties', yard)
  server.put('properties', school)
})

afterEach(() => {
  vi.unstubAllGlobals()
  onlineManager.setOnline(true)
})

describe('the overview', () => {
  it('is where the office starts, first in the navigation and lit there', async () => {
    await mount('/', { '/overview': everywhere })
    await screen.findByRole('heading', { level: 1, name: 'Übersicht' })

    expect(
      within(screen.getByRole('navigation', { name: 'Hauptbereiche' }))
        .getAllByRole('link')
        .filter((link) => link.getAttribute('aria-current') !== null)
        .map((link) => `${link.textContent} > ${link.getAttribute('href') ?? ''}`),
    ).toEqual(['Übersicht > /'])
  })

  it('leads from every number to the list it counts', async () => {
    await mount('/', { '/overview': everywhere })
    await screen.findByRole('list', { name: 'Betreiberverantwortung in Zahlen' })

    expect(tiles()).toEqual([
      '3ÜberfälligTermin verstrichen > /pflichten?zustand=overdue',
      '7In 30 Tagen fällig > /pflichten?termin=in_30_days',
      '18In 90 Tagen fällig > /pflichten?termin=in_90_days',
      '5Nie erfasstPflicht ohne Nachweis > /pflichten?zustand=never_recorded',
      '2Nachweis fehltFremdfirma, Bericht fehlt > /pruefungen?stand=report_missing',
      '2Mängel über Frist > /maengel?liste=overdue',
    ])
    expect(href('Alle 10 im Pflichtenverzeichnis')).toBe('/pflichten?termin=overdue_or_in_30_days')
    expect(href('2 weitere')).toBe('/pflichten?zustand=never_recorded')
    expect(
      screen.getByText(/Betreiberverantwortung über alle Liegenschaften, Montag, 5\. Oktober 2026/),
    ).toBeTruthy()
  })

  it('narrows to an area chosen, asks the server for it and takes it into every link', async () => {
    const { router } = await mount('/', {
      '/overview': everywhere,
      '/overview?area=a-nord': inTheNorth,
    })
    await screen.findByRole('list', { name: 'Betreiberverantwortung in Zahlen' })

    fireEvent.click(
      within(screen.getByRole('group', { name: 'Bereich' })).getByRole('button', { name: 'Nord' }),
    )
    await waitFor(() => {
      expect(tiles()[0]).toBe(
        '0ÜberfälligTermin verstrichen > /pflichten?zustand=overdue&bereich=a-nord',
      )
    })

    expect(router.state.location.href).toBe('/?bereich=a-nord')
    expect(tiles()).toEqual([
      '0ÜberfälligTermin verstrichen > /pflichten?zustand=overdue&bereich=a-nord',
      '1In 30 Tagen fällig > /pflichten?termin=in_30_days&bereich=a-nord',
      '2In 90 Tagen fällig > /pflichten?termin=in_90_days&bereich=a-nord',
      '1Nie erfasstPflicht ohne Nachweis > /pflichten?zustand=never_recorded&bereich=a-nord',
      '0Nachweis fehltFremdfirma, Bericht fehlt > /pruefungen?stand=report_missing&bereich=a-nord',
      '0Mängel über Frist > /maengel?liste=overdue&bereich=a-nord',
    ])
    expect(href('Alle 1 im Pflichtenverzeichnis')).toBe(
      '/pflichten?termin=overdue_or_in_30_days&bereich=a-nord',
    )
    expect(screen.getByText(/Betreiberverantwortung im Bereich Nord/)).toBeTruthy()
    expect(screen.getByText('Jede Pflicht ist erfasst.')).toBeTruthy()
    expect(screen.getByText('Kein Mangel ist über seiner Frist.')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Alle Bereiche' }))
    await waitFor(() => {
      expect(router.state.location.href).toBe('/')
    })
  })

  it('reads the area from the address', async () => {
    await mount('/?bereich=a-nord', { '/overview?area=a-nord': inTheNorth })
    await waitFor(() => {
      expect(tiles()[1]).toBe('1In 30 Tagen fällig > /pflichten?termin=in_30_days&bereich=a-nord')
    })
    expect(
      within(screen.getByRole('group', { name: 'Bereich' }))
        .getAllByRole('button')
        .map(
          (chip) =>
            `${chip.textContent}${chip.getAttribute('aria-pressed') === 'true' ? ' *' : ''}`,
        ),
    ).toEqual(['Alle Bereiche', 'Nord *', 'Süd'])
  })

  it('asks for every area where the address names one the person does not see', async () => {
    await mount('/?bereich=a-ost', { '/overview': everywhere })

    await waitFor(() => {
      expect(tiles()[0]).toBe('3ÜberfälligTermin verstrichen > /pflichten?zustand=overdue')
    })
  })

  it('shows the overdue duties and those of the next 30 days, the duties never recorded and the defects past their deadline', async () => {
    await mount('/', { '/overview': everywhere })
    await screen.findByRole('table', { name: soonTable })

    expect(rowsOf(soonTable)).toEqual([
      [
        'Prüfung der ortsfesten elektrischen Anlage',
        'AN-00012 Elektrische Anlage Halle 1Werkhof Nord',
        '15.09.2026',
        'Überfällig',
      ],
      [
        'Prüfung der Sicherheitsbeleuchtung',
        'AN-00044 SicherheitsbeleuchtungSchulzentrum Am Lindenhain',
        '12.10.2026',
        'Fällig',
      ],
      [
        'Dachrinnen reinigen',
        'Schulzentrum Am LindenhainLiegenschaft',
        '02.11.2026',
        'Erfüllt bis 02.11.2026',
      ],
    ])
    expect(href('Prüfung der ortsfesten elektrischen Anlage')).toBe('/pflichten/d-electrics')
    expect(href('AN-00012 Elektrische Anlage Halle 1')).toBe('/anlagen/as-12')

    const never = screen.getByRole('region', { name: 'Nie erfasst' })

    expect(
      within(never)
        .getAllByRole('link')
        .map((link) => `${link.textContent} > ${link.getAttribute('href') ?? ''}`),
    ).toEqual([
      'Untersuchung auf LegionellenSchulzentrum Am Lindenhain > /pflichten/d-never-1',
      'Prüfung der FeuerlöscherSchulzentrum Am Lindenhain > /pflichten/d-never-2',
      'Wartung der LüftungSchulzentrum Am Lindenhain > /pflichten/d-never-3',
      '2 weitere > /pflichten?zustand=never_recorded',
    ])

    const defects = screen.getByRole('region', { name: 'Mängel über ihrer Frist' })

    expect(
      within(defects)
        .getAllByRole('link')
        .map((link) => `${link.textContent} > ${link.getAttribute('href') ?? ''}`),
    ).toEqual([
      'Notleuchte Flur 1. OG ohne FunktionSchulzentrum Am Lindenhain, Frist 28.09.2026Beauftragt > /maengel/m-1',
      'Feuerlöscher ohne PrüfplaketteSchulzentrum Am Lindenhain, Frist 28.09.2026Festgestellt > /maengel/m-2',
    ])
  })

  it('offers no area to somebody who sees one', async () => {
    await mount('/', { '/overview': everywhere }, [sued], 'site_management')
    await screen.findByRole('list', { name: 'Betreiberverantwortung in Zahlen' })

    expect(screen.queryByRole('group', { name: 'Bereich' })).toBeNull()
  })

  it('leaves out the reports and the defects where the server counts none for the person', async () => {
    await mount('/', {
      '/overview': {
        ...everywhere,
        reportsMissing: null,
        defectsOverdue: null,
        defectsOverdueFirst: null,
      },
    })
    await screen.findByRole('list', { name: 'Betreiberverantwortung in Zahlen' })

    expect(tiles().map((tile) => tile.split(' > ')[0])).toEqual([
      '3ÜberfälligTermin verstrichen',
      '7In 30 Tagen fällig',
      '18In 90 Tagen fällig',
      '5Nie erfasstPflicht ohne Nachweis',
    ])
    expect(screen.queryByRole('region', { name: 'Mängel über ihrer Frist' })).toBeNull()
  })

  it('says so without a connection, and shows no number it has not been told', async () => {
    onlineManager.setOnline(false)

    await mount('/', { '/overview': everywhere })

    await screen.findByText('Die Übersicht kommt vom Server. Gerade ist keine Verbindung da.')
    expect(screen.queryByRole('list', { name: 'Betreiberverantwortung in Zahlen' })).toBeNull()
  })

  it('is not offered to somebody who may not read duties', async () => {
    const technician = memberIn('technician')

    await mount('/liegenschaften', {
      '/auth/tenants': [
        { ...technician, rights: technician.rights.filter((right) => right !== 'duty.read') },
      ],
    })
    await screen.findByRole('heading', { level: 1, name: 'Liegenschaften' })

    expect(
      within(screen.getByRole('navigation', { name: 'Hauptbereiche' })).queryByRole('link', {
        name: 'Übersicht',
      }),
    ).toBeNull()
  })
})
