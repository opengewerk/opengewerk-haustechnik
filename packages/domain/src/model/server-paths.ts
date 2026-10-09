/**
 * The first segment of every path the server of this application answers
 * itself, beside those of the foundation (`foundationPaths`).
 *
 * Three read it, each together with the paths of the foundation: the server,
 * which never hands a shell back for one of them; the service worker, which
 * never answers a navigation to one from its cache; and the development server
 * of the interface, which forwards them to the server. A path missing from one
 * of the three comes back as HTML where a program expects JSON.
 *
 * The test of the routes holds the list against the controllers, in both
 * directions.
 */
export const serverPaths: readonly string[] = [
  // The areas of a tenant, and who stands in for whom.
  'areas',
  'substitutions',
  // The place, from the property to the room.
  'properties',
  'buildings',
  'floors',
  'rooms',
  // The technology: assets and their components.
  'assets',
  // The meters: the list for a key date, the page of a measuring point, its
  // readings, the replacement of its meter, its pauses, its lock and its note
  // (#119).
  'meters',
  // What a code on a label is for the person asking, and the prints of many
  // labels at once.
  'labels',
  // The duties of an operator and the proposals dismissed.
  'duties',
  'duty-dismissals',
  // The inspections and the maintenance that came of the due days, the page
  // of one and its plan.
  'activities',
  // The work orders: the list, the page of one, making one from a defect, a
  // due day or by hand, changing it, and its acceptance or rejection.
  'work-orders',
  // The page of an evidence, its correction and its declaration of invalidity.
  'evidence',
  // The defects: the register, the page of one, reporting one by hand, its
  // further way and checking it again.
  'defects',
  // The templates of the rounds: a new one, empty or taken over from a
  // package, and a new version of one.
  'round-templates',
  // The plans of the rounds: a new one and a change of one (#113).
  'round-plans',
  // The rounds the plans made: the overview of a week, who walks each round,
  // the people they name and who may walk them (#113).
  'rounds',
  // The catalogue of the server, which a device fetches and keeps.
  'catalogue',
  // The import of places and assets from tables, and what the lists of a
  // tenant call the asset kinds.
  'imports',
]
