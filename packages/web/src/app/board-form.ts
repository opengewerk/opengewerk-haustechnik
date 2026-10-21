import { type FormField } from '@opengewerk/platform-web/sync'

import { boardPlaceFields, type useBoardPlaces } from './board-places.js'

/**
 * The form of a board with its place (#495), as the board draws it: the
 * fields of the foundation, handed in by whoever has loaded them already so
 * that the electrical structure stays out of the entry on site, with the
 * way it hangs across the whole row, and building and room side by side
 * below. A file of its own, since the places of a board load on site before
 * any form of one.
 */
export function boardFormFields(
  fields: readonly FormField[],
  places: ReturnType<typeof useBoardPlaces>,
): readonly FormField[] {
  return [
    ...fields.map((field) =>
      field.name === 'location' ? { ...field, place: 'col-span-full' } : field,
    ),
    ...boardPlaceFields(places),
  ]
}
