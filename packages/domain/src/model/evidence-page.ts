import type { IsoDate } from '@opengewerk/platform-domain'

import type { AssetId } from './asset.js'
import type { DutyId } from './duty-record.js'
import type { DutyEvidenceEntry, EvidenceStanding } from './duty-register.js'
import {
  type EvidenceId,
  evidenceLimits,
  type EvidenceOrigin,
  evidenceProblems,
  type EvidenceResult,
  evidenceResults,
  type EvidenceState,
  statedReasonProblem,
} from './evidence.js'
import type { Problems } from './fields.js'
import type { BuildingId, PropertyId, RoomId } from './location.js'
import type { EmptiedEvidence } from './retention.js'

/** Another evidence an evidence names: the one it replaces, or the one that replaced it. */
export interface EvidenceLink {
  readonly id: EvidenceId
  readonly number: string
}

/** A declaration of invalidity as a page shows it: why, by whom and when (ADR 0004, point 15). */
export interface ShownVoiding {
  readonly reason: string
  /** The name of the person, read from the instance; the voiding keeps the id of the account. */
  readonly voidedBy: string
  /** The moment, as an ISO 8601 text in UTC. */
  readonly voidedAt: string
}

/**
 * The page of one evidence (2.6 of the concept): the frozen state as it was
 * written down and the fingerprint over it, which every view reads and never
 * the current records, and what became of it since: the correction that
 * replaced it, the evidence it replaces itself and a declaration of
 * invalidity. Neither changes the evidence; each is a record of its own.
 *
 * The page is the one place that names who did, signed and wrote down an
 * evidence, all of it from the frozen state; the list of a duty names nobody.
 */
export interface EvidencePage {
  readonly id: EvidenceId
  readonly number: string
  readonly dutyId: DutyId
  /**
   * Where the duty hangs today, for the path above the page and its links.
   * Where it hung on the day it was written down, the frozen state says.
   */
  readonly place: {
    readonly propertyId: PropertyId
    readonly buildingId: BuildingId | null
    readonly roomId: RoomId | null
    readonly assetId: AssetId | null
  }
  readonly state: EvidenceState
  readonly fingerprint: string
  readonly standing: EvidenceStanding
  readonly replaces: EvidenceLink | null
  readonly replacedBy: EvidenceLink | null
  readonly voiding: ShownVoiding | null
  /** The PDFs of it with a higher signature, signed outside (#341), the newest first. */
  readonly signedPrints: readonly SignedPrint[]
}

/**
 * The PDF of an evidence with a higher signature, signed outside and filed
 * at it (#341, section 2.6 of the concept): who signed it and who issued the
 * certificate, as the certificate in the file names them, when the signature
 * says it was made, and who filed it. Whether the certificate belongs to a
 * list of trusted providers, the application does not check.
 */
export interface SignedPrint {
  readonly id: string
  readonly signer: string
  readonly issuer: string
  /** As an ISO 8601 text in UTC; none where the signature names no moment. */
  readonly signedAt: string | null
  readonly validFrom: string
  readonly validTo: string
  /** The name of the person, read from the instance. */
  readonly filedBy: string
  readonly filedAt: string
}

/** What filing one says: the file that went up ahead of it, by its hash. */
export interface SignedPrintFiling {
  readonly sha256: string
}

export const signedPrintWords = {
  noPrint:
    'Zu diesem Nachweis gibt es noch kein PDF. Erst „PDF öffnen“, dann außerhalb signieren und hier ablegen.',
  missingFile: 'Die Datei ist nicht auf dem Server.',
  twice: 'Dieses signierte PDF liegt schon am Nachweis.',
  missing: 'Dieses signierte PDF gibt es an diesem Nachweis nicht.',
} as const

/**
 * The page of an evidence after the end of its retention (#340, decided on
 * 15.10.2026): the empty shell with its number, duty, day and result, and
 * when and on whose confirmation the rest was deleted. A declaration of
 * invalidity stays with who and when; its reason went with the rest.
 */
export interface EmptiedEvidencePage {
  readonly id: EvidenceId
  readonly number: string
  readonly dutyId: DutyId
  readonly dutyTitle: string
  readonly place: EvidencePage['place']
  readonly performedOn: IsoDate
  readonly result: EvidenceResult
  readonly standing: EvidenceStanding
  readonly emptied: EmptiedEvidence
  readonly voided: Omit<ShownVoiding, 'reason'> | null
}

/** What `GET /evidence/:id` answers: the page of an evidence, or what stays of it. */
export type EvidenceReading = EvidencePage | EmptiedEvidencePage

export function isEmptied(reading: EvidenceReading): reading is EmptiedEvidencePage {
  return 'emptied' in reading
}

/**
 * An evidence of an asset as its file lists it: an evidence of a duty with
 * the duty it belongs to, since an asset carries several. No person, like the
 * list of a duty.
 */
export interface AssetEvidenceEntry extends DutyEvidenceEntry {
  readonly dutyId: DutyId
  readonly dutyTitle: string
}

/**
 * A correction as a person enters it (ADR 0004, point 14): why, and the
 * corrected day and result, with the examiner and the organisation where the
 * evidence is a report. Everything else the new evidence takes from the one
 * it replaces.
 */
export interface EvidenceCorrection {
  readonly reason: string
  readonly performedOn: IsoDate
  readonly result: EvidenceResult
  readonly resultReason: string | null
  readonly examiner: string | null
  readonly examinerOrganisation: string | null
}

/**
 * What is wrong with a correction of an evidence of this origin, entered on
 * this day. A correction says why, and it states the whole corrected day and
 * result, not what changes: a new evidence carries the whole state. Only a
 * report names an examiner, and a report always does. The day lies in the
 * past, as for every evidence.
 */
export function correctionProblems(
  correction: Readonly<Record<string, unknown>>,
  origin: EvidenceOrigin,
  today: IsoDate,
): Readonly<Problems> {
  const problems: Problems = {}
  const reason = statedReasonProblem(
    correction['reason'],
    evidenceLimits.replacementReason,
    'Eine Berichtigung nennt ihren Grund.',
  )

  if (reason !== undefined) {
    problems['reason'] = reason
  }

  Object.assign(problems, evidenceProblems(correction))

  const performedOn = correction['performedOn']

  if (performedOn === undefined || performedOn === null || performedOn === '') {
    problems['performedOn'] = 'Der Tag der Durchführung fehlt.'
  } else if (problems['performedOn'] === undefined && (performedOn as string) > today) {
    problems['performedOn'] = 'Ein Nachweis gilt für einen Tag, der schon war.'
  }

  if (!evidenceResults.includes(correction['result'] as EvidenceResult)) {
    problems['result'] ??= 'Das Ergebnis fehlt.'
  }

  const named = (field: string) => {
    const value = correction[field]

    return typeof value === 'string' && value.trim() !== ''
  }

  if (origin === 'report') {
    if (!named('examiner')) {
      problems['examiner'] ??= 'Ein Bericht nennt den Prüfer.'
    }

    if (!named('examinerOrganisation')) {
      problems['examinerOrganisation'] ??= 'Ein Bericht nennt die Organisation des Prüfers.'
    }
  } else if (named('examiner') || named('examinerOrganisation')) {
    // Whatever else is said about them, they do not belong here at all.
    delete problems['examinerOrganisation']
    problems['examiner'] = 'Prüfer und Organisation nennt nur ein Bericht.'
  }

  return problems
}
