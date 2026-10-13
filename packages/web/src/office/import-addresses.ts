/**
 * Where the imports from a table live in the office (#100, #130): each under
 * the list it fills, so that the navigation stays on "Liegenschaften", on
 * "Anlagen", on "Pflichtenverzeichnis", on "Zähler" and on "Rundgänge" and the
 * way back is the list. And the routes of the server they ask, named once.
 */
export const importPlaces = {
  structure: '/liegenschaften/importieren',
  assets: '/anlagen/importieren',
  deadlines: '/pflichten/importieren',
  meters: '/zaehler/importieren',
  templates: '/rundgaenge/vorlagen/importieren',
} as const

export const importRoutes = {
  structure: '/imports/structure',
  assets: '/imports/assets',
  deadlines: '/imports/deadlines',
  meters: '/imports/meters',
  templates: '/imports/templates',
  kindNames: '/imports/asset-kinds',
} as const
