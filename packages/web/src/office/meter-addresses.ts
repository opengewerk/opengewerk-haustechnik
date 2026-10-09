import type { Crumb } from '@opengewerk/platform-web'

/**
 * Where the meters live in the office (4.9 of the concept, #119): the list
 * "Zähler" and the page of a measuring point under it, by the id of its
 * asset. The list carries what it is narrowed by in its address, German
 * because the address bar is read by a person.
 */

export const meterListPlace = { to: '/zaehler', label: 'Zähler' } as const satisfies Crumb

export const meterPlaces = {
  meter: (assetId: string) => `/zaehler/${assetId}`,
} as const

/** What the address of the list is narrowed by, by the word of the address. */
export const meterListWords = {
  state: 'stand',
  property: 'liegenschaft',
  medium: 'medium',
  keyDate: 'stichtag',
} as const
