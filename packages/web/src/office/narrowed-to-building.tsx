import { NoteBox } from '@opengewerk/platform-web/office'
import { maybeText, useRecord } from '@opengewerk/platform-web/sync'

/**
 * Above a list narrowed to a building by its address (#121): the Lagebild of
 * a building leads into the defects and the meters of that building, and the
 * lists have no choice of their own for it. The sentence says what the list
 * is narrowed to, and the button takes it away.
 */
export function NarrowedToBuilding({
  buildingId,
  onLift,
}: {
  readonly buildingId: string
  readonly onLift: () => void
}) {
  const building = useRecord('buildings', buildingId)
  const name = maybeText(building ?? null, 'name')

  return (
    <NoteBox>
      {name === null ? 'Eingegrenzt auf ein Gebäude.' : `Eingegrenzt auf das Gebäude „${name}“.`}{' '}
      <button
        type="button"
        onClick={onLift}
        className="cursor-pointer font-semibold text-inherit underline underline-offset-2"
      >
        Aufheben
      </button>
    </NoteBox>
  )
}
