import type { PlaceAddresses } from '../app/place-path.js'

/**
 * Where the page of a place lives in the office (4.1 of the concept: every
 * place has a page and an address of its own). A property under the list it
 * is opened from; a building, a floor, a room and an asset by their own id,
 * so that an address names one record and nothing it hangs on, and stays the
 * same when a room moves to another floor.
 *
 * The navigation lights "Liegenschaften" on all of them (`also` of the entry
 * in `navigation.tsx`). The page of an asset arrives with the assets (#88).
 *
 * An id is taken as the text it is on a device: a screen reads it from an
 * address or from a record, and neither knows what kind of record it names.
 */
export const officePlaces = {
  list: { to: '/liegenschaften', label: 'Liegenschaften' },
  property: (id: string) => `/liegenschaften/${id}`,
  building: (id: string) => `/gebaeude/${id}`,
  floor: (id: string) => `/geschosse/${id}`,
  room: (id: string) => `/raeume/${id}`,
  asset: (id: string) => `/anlagen/${id}`,
} as const satisfies PlaceAddresses

/** The addresses below "Liegenschaften" that are not under its own. */
export const placeRoots = ['/gebaeude', '/geschosse', '/raeume'] as const
