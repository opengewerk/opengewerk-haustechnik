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

/**
 * The page of one import (#174), under the change log it is opened from: its
 * entry there leads to it, and so does the line over the log of a record it
 * made.
 */
export function importPage(id: string): string {
  return `/einstellungen/protokoll/importe/${encodeURIComponent(id)}`
}

/** What the office reads of an import: what it made, and which import made a record. */
export const importReadings = {
  made: (id: string) => `/imports/${encodeURIComponent(id)}/made`,
  origin: (table: string, id: string) =>
    `/imports/origins/${encodeURIComponent(table)}/${encodeURIComponent(id)}`,
} as const
