import {
  type IsoDate,
  isReportMonth,
  lastTwelveMonths,
  type ReportGrid,
  reportGrids,
  type ReportView,
  reportViews,
} from '@opengewerk/haustechnik-domain'

/**
 * Where the figures over time stand (#334) and what their address says: the
 * view, the place, the months and the grid, in German words, as the other
 * addresses of the office. A word the screen does not know counts as none.
 */
export const figuresPlace = { to: '/auswertungen' } as const

const viewWords: Readonly<Record<ReportView, string>> = {
  duties: 'pflichten',
  defects: 'maengel',
  faults: 'stoerungen',
  activities: 'vorgaenge',
}

const gridWords: Readonly<Record<ReportGrid, string>> = {
  month: 'monat',
  quarter: 'quartal',
  year: 'jahr',
}

/** What the screen shows, as its address names it. */
export interface FiguresAddress {
  readonly view: ReportView
  readonly areaId?: string
  readonly propertyId?: string
  readonly buildingId?: string
  readonly from?: string
  readonly to?: string
  readonly grid?: ReportGrid
}

function word(search: Readonly<Record<string, unknown>>, name: string): string | undefined {
  const value = search[name]

  return typeof value === 'string' && value !== '' ? value : undefined
}

export function figuresAddressOf(search: Readonly<Record<string, unknown>>): FiguresAddress {
  const view = reportViews.find((each) => viewWords[each] === word(search, 'ansicht')) ?? 'duties'
  const grid = reportGrids.find((each) => gridWords[each] === word(search, 'raster'))
  const from = word(search, 'von')
  const to = word(search, 'bis')
  const areaId = word(search, 'bereich')
  const propertyId = word(search, 'liegenschaft')
  const buildingId = word(search, 'gebaeude')

  return {
    view,
    ...(areaId === undefined ? {} : { areaId }),
    ...(propertyId === undefined ? {} : { propertyId }),
    ...(buildingId === undefined ? {} : { buildingId }),
    ...(isReportMonth(from) ? { from } : {}),
    ...(isReportMonth(to) ? { to } : {}),
    ...(grid === undefined ? {} : { grid }),
  }
}

/** The address of the screen for what it shows. */
export function figuresSearch(address: FiguresAddress): Record<string, string> {
  return {
    ...(address.view === 'duties' ? {} : { ansicht: viewWords[address.view] }),
    ...(address.areaId === undefined ? {} : { bereich: address.areaId }),
    ...(address.propertyId === undefined ? {} : { liegenschaft: address.propertyId }),
    ...(address.buildingId === undefined ? {} : { gebaeude: address.buildingId }),
    ...(address.from === undefined ? {} : { von: address.from }),
    ...(address.to === undefined ? {} : { bis: address.to }),
    ...(address.grid === undefined || address.grid === 'month'
      ? {}
      : { raster: gridWords[address.grid] }),
  }
}

/** The months the screen shows: those its address names, or the twelve up to today. */
export function monthsOf(
  address: FiguresAddress,
  today: IsoDate,
): {
  readonly from: string
  readonly to: string
} {
  const twelve = lastTwelveMonths(today)

  return { from: address.from ?? twelve.from, to: address.to ?? twelve.to }
}

/** What the server is asked for the view of an address, in its own words. */
export function figuresRequest(address: FiguresAddress, today: IsoDate): string {
  const { from, to } = monthsOf(address, today)
  const asked = new URLSearchParams({
    from,
    to,
    grid: address.grid ?? 'month',
    ...(address.areaId === undefined ? {} : { areaId: address.areaId }),
    ...(address.propertyId === undefined ? {} : { propertyId: address.propertyId }),
    ...(address.buildingId === undefined ? {} : { buildingId: address.buildingId }),
  })

  return `/reports/${address.view}?${asked.toString()}`
}
