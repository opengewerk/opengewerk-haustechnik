import { catalogueBundle } from '@opengewerk/haustechnik-catalogue'
import { type Catalogue, catalogueOf } from '@opengewerk/haustechnik-domain'

/**
 * The catalogue the routes ask: which asset kinds there are, and with #25
 * which duty kinds apply to them (ADR 0005). Built into the server with its
 * code, from the bundle the build of @opengewerk/haustechnik-catalogue wrote
 * from the packages under pakete/, so that server and device compute with the
 * same entries.
 *
 * Handed to the routes as a value under this token, so that a test hands in
 * another one, the probe package, for what the catalogue of this build does
 * not hold yet: a duty kind, a rule, a measuring point.
 */
export const CATALOGUE = Symbol.for('opengewerk-haustechnik.catalogue')

/** The catalogue this build ships. Read once, when the module is made. */
export function shippedCatalogue(): Catalogue {
  return catalogueOf(catalogueBundle)
}
