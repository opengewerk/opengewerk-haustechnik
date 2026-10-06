import {
  type Catalogue,
  type Duty,
  dutyBasisLabel,
  type DutyEntry,
  dutyPerformerLabel,
  type DutyReading,
  intervalKindLabel,
} from '@opengewerk/haustechnik-domain'
import { Status } from '@opengewerk/platform-web'
import { date } from '@opengewerk/platform-web/format'
import { TriangleAlert } from 'lucide-react'

import { DutyStateMark } from '../app/asset-marks.js'

/**
 * What the register of duties, the page of a duty and the file of an asset
 * say about a duty in the same words: where it comes from, what kind of
 * interval it has, who performs it, and how it stands.
 */

/** The version of the duty kind a duty was confirmed in, where this device has a catalogue that knows it. */
export function kindOfDuty(
  duty: Pick<DutyReading, 'kind' | 'kindVersion'>,
  catalogue: Catalogue | null,
) {
  return duty.kind === null || duty.kindVersion === null
    ? null
    : (catalogue?.dutyKindVersion(duty.kind, duty.kindVersion) ?? null)
}

/**
 * Where a duty comes from, in a line: the source its kind names, or for one
 * of the operator's own its basis and the source it names.
 */
export function dutySourceWords(
  duty: Pick<DutyReading, 'kind' | 'kindVersion' | 'basis' | 'sourceNote'>,
  catalogue: Catalogue | null,
): string {
  return (
    kindOfDuty(duty, catalogue)?.definition.source ??
    [duty.basis === null ? null : dutyBasisLabel[duty.basis], duty.sourceNote]
      .filter(Boolean)
      .join(', ')
  )
}

export const ownDutyWords = 'Eigene Pflicht'

/**
 * What kind of interval a duty has, in the words of its kind: a maximum, a
 * guide or none of either; a duty of the operator's own says that it is one.
 * Nothing for a kind this device has no catalogue for.
 */
export function intervalKindWords(
  duty: Pick<DutyReading, 'kind' | 'kindVersion'>,
  catalogue: Catalogue | null,
): string {
  if (duty.kind === null) {
    return ownDutyWords
  }

  const kind = kindOfDuty(duty, catalogue)

  return kind === null ? '' : intervalKindLabel[kind.definition.interval.kind]
}

/**
 * Who performs a duty: the operator's own people, or a contractor, by the
 * name the duty notes where it notes one. Nothing where nobody said.
 */
export function performerWords(duty: Pick<Duty, 'performer' | 'performerNote'>): string | null {
  if (duty.performer === null) {
    return null
  }

  return duty.performer === 'contractor' && duty.performerNote !== null
    ? duty.performerNote
    : dutyPerformerLabel[duty.performer]
}

export const nobodyWords = 'Niemand benannt'

/**
 * In the place of a name where nobody answers for a duty (4.3 of the
 * concept: such a duty is pointed out instead of running on quietly). In
 * words and with a symbol, in the tone of what waits.
 */
export function Nobody() {
  return (
    <span className="inline-flex items-center gap-[5px] font-semibold text-waiting">
      <TriangleAlert size={13} strokeWidth={2.2} aria-hidden="true" />
      {nobodyWords}
    </span>
  )
}

/** "Beendet seit 05.09.2026". */
export function endedWords(duty: Pick<DutyReading, 'endsOn'>): string {
  return duty.endsOn === null ? 'Beendet' : `Beendet seit ${date(duty.endsOn)}`
}

/**
 * How a duty stands today. One that has ended says so and nothing else: from
 * the day it ends it calls for nothing, whatever its last appointment was.
 */
export function DutyStandingMark({
  duty,
}: {
  readonly duty: Pick<DutyEntry, 'state' | 'appointment' | 'ended' | 'endsOn'>
}) {
  return duty.ended ? (
    <Status tone="neutral">{endedWords(duty)}</Status>
  ) : (
    <DutyStateMark state={duty.state} until={duty.appointment?.dueOn ?? null} />
  )
}
