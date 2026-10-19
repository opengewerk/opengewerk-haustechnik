import { databaseErrors } from '@opengewerk/platform-server'

/**
 * The translation of a refusal of the database into an answer is the
 * foundation's (ADR 0010 in the repository opengewerk): a policy that refuses
 * becomes a 403 that says nothing about whether the row exists elsewhere, a
 * value that does not fit the data model a 400, and what the foundation's own
 * functions raise a 409 with their sentence.
 *
 * The error classes of this application go the same way, each with the
 * sentence that stands in when the database gave none. The class is `HT`
 * followed by three digits, beside the foundation's `OG`.
 */
export const applicationConflicts: Readonly<Record<string, string>> = {
  // A component under itself, however long the chain (#20).
  HT001: 'Eine Komponente hängt nicht unter sich selbst.',
  // An asset moved to another property (#20).
  HT002:
    'Eine Anlage bleibt auf ihrer Liegenschaft; an einem anderen Ort ist sie eine neue Anlage.',
  // An evidence changed or removed, by whatever way (#26, ADR 0004).
  HT003:
    'Ein Nachweis wird nicht geändert und nicht gelöscht. Berichtigt wird er durch einen neuen Nachweis, der ihn nennt.',
  // An asset with an evidence marked deleted, also by marking its place (#26).
  HT004:
    'Eine Anlage mit Nachweis wird zurückgebaut und nicht gelöscht; ihre Nachweise bleiben bei ihr.',
  // A signature or the decision on a work order changed or removed (#26).
  HT005:
    'Eine Unterschrift oder eine Entscheidung über einen Auftrag wird nicht geändert und nicht gelöscht.',
  // A declaration that an evidence is invalid changed or removed (#26).
  HT006:
    'Eine Ungültigerklärung wird nicht geändert und nicht gelöscht. Der Nachweis bleibt mit ihr lesbar.',
  // A deletion after the end of the retention confirmed by somebody who does
  // not lead the operator, or before the end (#340, ADR 0004).
  HT008: 'Die Aufbewahrung dieses Nachweises ist nicht abgelaufen.',
  // The confirmation of a deletion changed or removed (#340).
  HT009:
    'Die Bestätigung, dass ein Nachweis gelöscht wird, wird nicht geändert und nicht gelöscht.',
  // An activity emptied with its last evidence changed or added to, or
  // emptied on another way (#409).
  HT010: 'Ein gelöschter Vorgang wird nicht geändert und nimmt nichts mehr auf.',
  // A part of something that is no collective activity (#342).
  HT011: 'Ein Vorgang ist nur Teil eines Sammelvorgangs.',
  // An answer about an asset its point does not ask about in this round, or
  // without the asset its point asks about (#343).
  HT012: 'Nach dieser Anlage fragt der Punkt in diesem Rundgang nicht.',
  // A further photo of a point that is no document of its activity, or one
  // named twice (#451).
  HT013: 'Jedes Foto eines Punkts ist ein Dokument seines Vorgangs und steht nur einmal an ihm.',
  // A board on an asset that is no low-voltage installation, or such an
  // installation with boards given another kind (#349).
  HT014: 'Ein Verteiler hängt nur unter einer Niederspannungsanlage.',
}

export const { answerFor, DatabaseExceptionFilter } = databaseErrors(applicationConflicts)
