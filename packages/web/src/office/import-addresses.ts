/**
 * Where the imports from a table live in the office (#100, #130): each under
 * the list it fills, so that the navigation stays on "Liegenschaften", on
 * "Anlagen" and on "Pflichtenverzeichnis" and the way back is the list. And
 * the routes of the server they ask, named once.
 */
export const importPlaces = {
  structure: '/liegenschaften/importieren',
  assets: '/anlagen/importieren',
  deadlines: '/pflichten/importieren',
} as const

export const importRoutes = {
  structure: '/imports/structure',
  assets: '/imports/assets',
  deadlines: '/imports/deadlines',
  kindNames: '/imports/asset-kinds',
} as const
