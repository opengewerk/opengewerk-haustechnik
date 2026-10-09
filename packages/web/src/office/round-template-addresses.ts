import type { Crumb } from '@opengewerk/platform-web'

/**
 * Where the rounds live in the office: "Rundgänge" is the overview of the
 * week (#113) with one round by its id (#115), and under it the templates
 * (#112), the list, a new one, empty or taken over from a package, and one
 * template by its id, and the plans (#113), the list, a new one and one plan
 * by its id.
 */

export const roundsPlace = { to: '/rundgaenge', label: 'Rundgänge' } as const satisfies Crumb

/** The overview of the week a Monday begins (#113). */
export function weekPlace(monday: string): string {
  return `/rundgaenge?woche=${monday}`
}

/** The page of one round, by the id of its activity (#115). */
export const roundPlaces = {
  round: (id: string) => `/rundgaenge/${id}`,
} as const

export const templateListPlace = {
  to: '/rundgaenge/vorlagen',
  label: 'Vorlagen',
} as const satisfies Crumb

/** The word of the address that names the template of a package taken over. */
export const takenFromWord = 'aus'

export const templatePlaces = {
  template: (id: string) => `/rundgaenge/vorlagen/${id}`,
  new: '/rundgaenge/vorlagen/neu',
} as const

export const planListPlace = { to: '/rundgaenge/plaene', label: 'Pläne' } as const satisfies Crumb

export const planPlaces = {
  plan: (id: string) => `/rundgaenge/plaene/${id}`,
  new: '/rundgaenge/plaene/neu',
} as const
