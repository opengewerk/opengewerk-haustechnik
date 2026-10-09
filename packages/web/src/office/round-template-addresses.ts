import type { Crumb } from '@opengewerk/platform-web'

/**
 * Where the templates of the rounds live in the office (#112): under
 * "Rundgänge", the list, a new one, empty or taken over from a package, and
 * one template by its id. "Rundgänge" shows the list as well until the
 * overview of the week comes with the plans of the rounds.
 */

export const roundsPlace = { to: '/rundgaenge', label: 'Rundgänge' } as const satisfies Crumb

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
