import type { Crumb } from '@opengewerk/platform-web'

/**
 * Where the fault reports live in the office (#331): the inbox and the page of
 * a report, at the addresses of the boards. Apart from the screens, so that a
 * screen that links to a report does not bring them along.
 */
export const faultListPlace = { to: '/stoerungen', label: 'Störungen' } as const satisfies Crumb

export const faultPlaces = {
  report: (id: string) => `/stoerungen/${id}`,
} as const
