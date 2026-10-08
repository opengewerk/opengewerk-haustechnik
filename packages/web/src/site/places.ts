import type { PlaceAddresses } from '../app/place-path.js'

/**
 * Where the pages of the places live in the entry on site (#99): the same
 * words in the address as in the office, under `/m`. No list stands at the
 * start of the path: on site it begins at the property (4.1 of the concept).
 */
export const sitePlaces = {
  property: (id: string) => `/liegenschaften/${id}`,
  building: (id: string) => `/gebaeude/${id}`,
  floor: (id: string) => `/geschosse/${id}`,
  room: (id: string) => `/raeume/${id}`,
  asset: (id: string) => `/anlagen/${id}`,
} as const satisfies PlaceAddresses

/**
 * Where taking stock lives: its start among the tabs, each form under the
 * place it takes something into, which the address names because the form has
 * nothing else to learn it from, and the label of an asset under its page.
 */
export const stockTaking = {
  start: '/aufnehmen',
  assetInBuilding: (buildingId: string) => `/aufnehmen/gebaeude/${buildingId}`,
  assetInRoom: (roomId: string) => `/aufnehmen/raum/${roomId}`,
  roomOnFloor: (floorId: string) => `/aufnehmen/geschoss/${floorId}`,
  label: (assetId: string) => `/anlagen/${assetId}/etikett`,
} as const

/** Where a defect is reported on site (#116): under the page of the asset or the room it is at. */
export const siteDefects = {
  atAsset: (assetId: string) => `/anlagen/${assetId}/mangel`,
  atRoom: (roomId: string) => `/raeume/${roomId}/mangel`,
} as const
