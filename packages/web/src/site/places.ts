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

/**
 * Where the form of an activity is filled in on site (#107): the activity
 * with its points, and each point on a screen of its own, by its field, or
 * by group, block and field. Its result with the signature, and a defect
 * reported in it, stand under it (#108); so do the handing in of a round and
 * its signature (#114), and the protocol of a work order, a note on it and
 * its finishing (#118).
 */
export const siteForms = {
  form: (activityId: string) => `/vorgaenge/${activityId}`,
  point: (activityId: string, pointKey: string) => `/vorgaenge/${activityId}/punkte/${pointKey}`,
  result: (activityId: string) => `/vorgaenge/${activityId}/ergebnis`,
  defect: (activityId: string) => `/vorgaenge/${activityId}/mangel`,
  handIn: (activityId: string) => `/vorgaenge/${activityId}/abgabe`,
  sign: (activityId: string) => `/vorgaenge/${activityId}/unterschrift`,
  protocol: (activityId: string) => `/vorgaenge/${activityId}/protokoll`,
  note: (activityId: string) => `/vorgaenge/${activityId}/notiz`,
  close: (activityId: string) => `/vorgaenge/${activityId}/abschliessen`,
} as const
