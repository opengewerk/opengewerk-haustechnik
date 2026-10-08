import {
  type EvidenceResult,
  evidenceResultLabel,
  type EvidenceStanding,
  evidenceStandingLabel,
} from '@opengewerk/haustechnik-domain'
import { Status, type StatusTone } from '@opengewerk/platform-web'
import { Link } from '@tanstack/react-router'
import { Ban } from 'lucide-react'

import { evidencePlaces } from './duty-addresses.js'
import { factLink } from './links.js'

/**
 * How an evidence is shown wherever it is listed: its result, what it means
 * for the appointment of its duty, and its number as the link to its page
 * (2.6 of the concept). An evidence declared invalid carries the mark
 * everywhere it is shown (ADR 0004, point 15).
 */

const resultTones: Readonly<Record<EvidenceResult, StatusTone>> = {
  without_defects: 'done',
  with_defects: 'conflict',
  failed: 'conflict',
  not_performed: 'neutral',
}

const standingTones: Readonly<Record<EvidenceStanding, StatusTone>> = {
  counts: 'done',
  does_not_meet: 'neutral',
  replaced: 'neutral',
  voided: 'conflict',
}

export function ResultMark({ result }: { readonly result: EvidenceResult }) {
  return <Status tone={resultTones[result]}>{evidenceResultLabel[result]}</Status>
}

export function StandingMark({ standing }: { readonly standing: EvidenceStanding }) {
  return (
    <Status tone={standingTones[standing]} icon={standing === 'voided' ? Ban : undefined}>
      {evidenceStandingLabel[standing]}
    </Status>
  )
}

/** The number of an evidence as a link to its page, as every list of evidence shows it. */
export function EvidenceNumber({ id, number }: { readonly id: string; readonly number: string }) {
  return (
    <Link to={evidencePlaces.evidence(id)} className={factLink}>
      <span className="numeric">{number}</span>
    </Link>
  )
}
