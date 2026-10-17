import type { QualificationHint } from '@opengewerk/haustechnik-domain'
import { date } from '@opengewerk/platform-web/format'
import { NoteBox } from '@opengewerk/platform-web/office'
import { TriangleAlert } from 'lucide-react'

/**
 * The note when a person chosen for an inspection, a maintenance or a work
 * order lacks the kind of qualification its duties ask for (#337): a note,
 * not a refusal, in the words of the board "Prüfung zuteilen".
 */
export function qualificationNote(hint: QualificationHint, name: string): string {
  return hint.check === 'missing'
    ? `Gefordert ist „${hint.kindLabel}“. ${name} hat sie nicht. Sie können trotzdem speichern.`
    : `Gefordert ist „${hint.kindLabel}“. Bei ${name} ist sie${hint.expiredOn === null ? '' : ` am ${date(hint.expiredOn)}`} abgelaufen. Sie können trotzdem speichern.`
}

/** A note for each person chosen who lacks the kind; nothing where everybody holds it. */
export function QualificationNotes({
  hints,
  chosen,
  nameOf,
}: {
  readonly hints: Readonly<Record<string, QualificationHint>> | undefined
  readonly chosen: readonly string[]
  readonly nameOf: (userId: string) => string
}) {
  const lacking = chosen.filter((userId) => userId !== '' && hints?.[userId] !== undefined)

  if (hints === undefined || lacking.length === 0) {
    return null
  }

  return (
    <>
      {lacking.map((userId) => (
        <NoteBox key={userId} tone="waiting" icon={TriangleAlert}>
          {qualificationNote(hints[userId] as QualificationHint, nameOf(userId))}
        </NoteBox>
      ))}
    </>
  )
}
