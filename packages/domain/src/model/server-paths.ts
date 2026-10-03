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
  // The place, from the property to the room.
  'properties',
  'buildings',
  'floors',
  'rooms',
]
