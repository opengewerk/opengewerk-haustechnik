import type { PlaceAddresses } from '../app/place-path.js'

/**
 * Where the page of a place lives in the office (4.1 of the concept: every
 * place has a page and an address of its own). A property under the list it
 * is opened from; a building, a floor, a room and an asset by their own id,
 * so that an address names one record and nothing it hangs on, and stays the
 * same when a room moves to another floor.
 *
 * The navigation lights "Liegenschaften" on the places (`also` of the entry in
 * `navigation.tsx`) and "Anlagen" on the file of an asset, which lives under
 * the register it is opened from.
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

/**
 * Where the forms of a building, a floor and a room live: a new one under the
 * place it will stand in, which the address names because the form has
 * nothing else to learn it from, and the form of one that is there under its
 * own page.
 */
export const placeForms = {
  newBuilding: (propertyId: string) => `/liegenschaften/${propertyId}/gebaeude/neu`,
  editBuilding: (buildingId: string) => `/gebaeude/${buildingId}/bearbeiten`,
  newFloor: (buildingId: string) => `/gebaeude/${buildingId}/geschosse/neu`,
  editFloor: (floorId: string) => `/geschosse/${floorId}/bearbeiten`,
  newRoom: (floorId: string) => `/geschosse/${floorId}/raeume/neu`,
  editRoom: (roomId: string) => `/raeume/${roomId}/bearbeiten`,
} as const

/** The addresses below "Liegenschaften" that are not under its own. */
export const placeRoots = ['/gebaeude', '/geschosse', '/raeume'] as const
