/**
 * Where the two imports from a table live in the office (#100): each under
 * the list it fills, so that the navigation stays on "Liegenschaften" and on
 * "Anlagen" and the way back is the list. And the routes of the server they
 * ask, named once.
 */
export const importPlaces = {
  structure: '/liegenschaften/importieren',
  assets: '/anlagen/importieren',
} as const

export const importRoutes = {
  structure: '/imports/structure',
  assets: '/imports/assets',
  kindNames: '/imports/asset-kinds',
} as const
