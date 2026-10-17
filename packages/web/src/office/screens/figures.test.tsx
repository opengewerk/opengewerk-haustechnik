import {
  type DefectFigures,
  type FaultFigures,
  type FulfilmentRow,
  lastTwelveMonths,
  type MeasureRow,
  type RoleKey,
} from '@opengewerk/haustechnik-domain'
import { today } from '@opengewerk/platform-web/format'
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
  servingTables,
  signedInOffice,
} from '../test-office.js'

/**
 * "Auswertungen" in the office (#334, 4.16 of the concept): the fulfilment of
 * the duties, the defects open today, the faults and the activities, each
 * asked of the server with the place, the months and the grid the address
 * names, and as a table with what the filter shows.
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
const house = {
  id: 'b-house',
  propertyId: school.id,
  areaId: sued.id,
  name: 'Schulhaus',
  kinds: '["school"]',
  yearBuilt: 1975,
}

const everything = ['properties', 'buildings', 'floors', 'rooms', 'assets'] as const

/** The twelve months up to today, as the screen asks for them where the address names none. */
function twelve(): string {
  const { from, to } = lastTwelveMonths(today())

  return `from=${from}&to=${to}`
}

const dutyRows: readonly FulfilmentRow[] = [
  { key: '2026-08', label: 'August 2026', due: 41, onTime: 37, late: 3, open: 1 },
  { key: '2026-09', label: 'September 2026', due: 0, onTime: 0, late: 0, open: 0 },
]

function measures(key: string, label: string, inspection: number, repair: number): MeasureRow {
  return {
    key,
    label,
    counts: { maintenance: 0, inspection, repair, improvement: 0, none: 1 },
    total: inspection + repair + 1,
  }
}

const defectFigures: DefectFigures = {
  on: '2026-10-17',
  rows: [
    {
      defectClass: 'probe.severe',
      label: 'schwer',
      bands: { month: 1, quarter: 0, year: 2, older: 0 },
      open: 3,
      overdue: 1,
    },
    {
      defectClass: null,
      label: 'Ohne Klasse',
      bands: { month: 0, quarter: 1, year: 0, older: 0 },
      open: 1,
      overdue: 0,
    },
  ],
}

const faultFigures: FaultFigures = {
  byCategory: [
    {
      key: 'heating',
      label: 'Heizung und Lüftung',
      sub: null,
      received: 3,
      accepted: 2,
      done: 1,
      rejected: 1,
      daysToAcceptance: 0.5,
      daysToDone: null,
    },
  ],
  byBuilding: [
    {
      key: house.id,
      label: house.name,
      sub: school.name,
      received: 3,
      accepted: 2,
      done: 1,
      rejected: 1,
      daysToAcceptance: 0.5,
      daysToDone: 2.25,
    },
  ],
}

let server: TestServer

function mount(
  at: string,
  answers: Readonly<Record<string, unknown>> = {},
  role: RoleKey = 'technical_management',
) {
  signedInOffice(role, [sued], { ...servingCatalogue(), ...answers })

  return mountOffice(at, server, everything)
}

const dutyCaption =
  'Erfüllung der Pflichten je Zeitraum: fällig geworden, rechtzeitig, später und noch offen'
const activityCaption = 'Vorgänge je Zeitraum nach den Grundmaßnahmen der DIN 31051'
const defectCaption = 'Offene Mängel nach Klasse und Alter, und wie viele über ihrer Frist sind'

beforeEach(() => {
  localStorage.clear()
  onA('desktop')
  server = new TestServer()
  server.put('properties', school)
  server.put('buildings', house)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  onlineManager.setOnline(true)
})

describe('the figures over time', () => {
  it('count the terms of the duties per month, with the share on time, and say what a figure per building may tell', async () => {
    await mount('/auswertungen', { [`/reports/duties?${twelve()}&grid=month`]: dutyRows })

    await waitFor(() => {
      expect(rowsOf(dutyCaption)).toEqual([
        ['August 2026', '41', '37', '3', '1', '90 %', ''],
        ['September 2026', '0', '0', '0', '0', '', ''],
      ])
    })
    expect(screen.getByRole('columnheader', { name: 'Monat' })).toBeDefined()
    expect(screen.getByText(/lässt auf sie schließen/)).toBeDefined()
    expect(screen.getByRole('link', { name: 'Pflichten' }).getAttribute('aria-current')).toBe(
      'page',
    )
  })

  it('ask for the view, the place, the months and the grid the address names, and keep a change in the address', async () => {
    const at = 'from=2026-01&to=2026-09'
    const { router } = await mount(
      '/auswertungen?ansicht=vorgaenge&gebaeude=b-house&von=2026-01&bis=2026-09&raster=quartal',
      {
        [`/reports/activities?${at}&grid=quarter&buildingId=b-house`]: [
          measures('2026-Q1', '1. Quartal 2026', 4, 2),
          measures('2026-Q2', '2. Quartal 2026', 3, 0),
        ],
        [`/reports/activities?${at}&grid=year&buildingId=b-house`]: [
          measures('2026', '2026', 7, 2),
        ],
      },
    )

    await waitFor(() => {
      expect(rowsOf(activityCaption)).toEqual([
        ['1. Quartal 2026', '0', '4', '2', '0', '1', '7'],
        ['2. Quartal 2026', '0', '3', '0', '0', '1', '4'],
      ])
    })
    expect((screen.getByLabelText('Standort') as HTMLSelectElement).value).toBe('b:b-house')
    expect((screen.getByLabelText('Von') as HTMLSelectElement).value).toBe('2026-01')

    fireEvent.click(
      within(screen.getByRole('group', { name: 'Raster' })).getByRole('button', { name: 'Jahr' }),
    )

    await waitFor(() => {
      expect(rowsOf(activityCaption)).toEqual([['2026', '0', '7', '2', '0', '1', '10']])
    })
    expect(router.state.location.href).toBe(
      '/auswertungen?ansicht=vorgaenge&gebaeude=b-house&von=2026-01&bis=2026-09&raster=jahr',
    )
  })

  it('show the defects open today by class and age, and lead from the open and the overdue to the list of the defects with the same filter', async () => {
    await mount('/auswertungen?ansicht=maengel&liegenschaft=p-school', {
      [`/reports/defects?${twelve()}&grid=month&propertyId=p-school`]: defectFigures,
    })

    await waitFor(() => {
      expect(rowsOf(defectCaption)).toEqual([
        ['schwer', '1', '0', '2', '0', '3', '1'],
        ['Ohne Klasse', '0', '1', '0', '0', '1', '0'],
      ])
    })
    expect(
      within(screen.getByRole('table', { name: defectCaption }))
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual([
      '/maengel?liegenschaft=p-school&klasse=probe.severe',
      '/maengel?liste=overdue&liegenschaft=p-school&klasse=probe.severe',
      '/maengel?liegenschaft=p-school&klasse=none',
    ])
    // Open today, so no months and no grid.
    expect(screen.queryByLabelText('Von')).toBeNull()
    expect(screen.queryByRole('group', { name: 'Raster' })).toBeNull()
  })

  it('show the faults by category and by building, with the median in days or "keine" where none was done', async () => {
    await mount('/auswertungen?ansicht=stoerungen', {
      [`/reports/faults?${twelve()}&grid=month`]: faultFigures,
    })

    await waitFor(() => {
      expect(
        rowsOf(
          'Störungen nach Kategorie: eingegangen, angenommen, erledigt und die Zeit bis dahin',
        ),
      ).toEqual([['Heizung und Lüftung', '3', '2', '1', '1', '0,5 Tage', 'keine']])
    })
    expect(
      rowsOf('Störungen nach Gebäude: eingegangen, angenommen, erledigt und die Zeit bis dahin'),
    ).toEqual([['SchulhausSchulzentrum Am Lindenhain', '3', '2', '1', '0,5 Tage', '2,3 Tage']])
    expect(screen.getByLabelText('Von')).toBeDefined()
    expect(screen.queryByRole('group', { name: 'Raster' })).toBeNull()
  })

  it('say what is wrong with a period that ends before it begins, and ask nothing', async () => {
    await mount('/auswertungen?von=2026-09&bis=2026-01')

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Der Zeitraum endet vor seinem Anfang.',
    )
    expect(screen.queryByText('Die Auswertung wird geladen.')).toBeNull()
  })

  it('come as a table with what the filter shows', async () => {
    await mount('/auswertungen?ansicht=vorgaenge&von=2026-01&bis=2026-09&raster=jahr', {
      '/reports/activities?from=2026-01&to=2026-09&grid=year': [measures('2026', '2026', 7, 2)],
    })

    await waitFor(() => {
      expect(rowsOf(activityCaption)).toHaveLength(1)
    })

    // After the answers of the test, which it hands every other request to.
    const tables = servingTables()

    fireEvent.click(screen.getByRole('button', { name: 'Als Tabelle' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'CSV (.csv)' }))

    await waitFor(() => {
      expect(tables.asked).toEqual([
        '/reports/activities/table?from=2026-01&to=2026-09&grid=year&format=csv',
      ])
    })
  })
})
