import type { IsoDate } from '@opengewerk/platform-domain'

import type { DutyReading } from './asset-condition.js'
import { type Catalogue, intervalKindLabel } from './catalogue.js'
import { type DutyState, dutyStateLabel } from './duty.js'
import { type Duty, dutyBasisLabel, dutyPerformerLabel } from './duty-record.js'

/**
 * What the register of duties, the page of a duty, the file of an asset and
 * the register as a table (#236) say about a duty in the same words: where
 * it comes from, what kind of interval it has, who performs it, and how it
 * stands.
 */

/** A day as a list writes it, 05.09.2026. */
function day(on: IsoDate): string {
  const [year, month, date] = on.split('-')

  return `${date ?? ''}.${month ?? ''}.${year ?? ''}`
}

/** The version of the duty kind a duty was confirmed in, where the catalogue at hand knows it. */
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
 * Nothing for a kind the catalogue at hand does not know.
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

/** In the place of a name where nobody answers for a duty (4.3 of the concept). */
export const nobodyWords = 'Niemand benannt'

/** What a duty says whose document that bears its interval has a newer version, or was taken out of the records (#74). */
export const intervalCheckWords = 'Frist prüfen'

/** What a duty says whose contract has ended (#329): the duty goes on, the contract no longer carries it. */
export const contractEndedWords = 'Vertrag abgelaufen'

/** "Beendet seit 05.09.2026". */
export function endedWords(duty: Pick<DutyReading, 'endsOn'>): string {
  return duty.endsOn === null ? 'Beendet' : `Beendet seit ${day(duty.endsOn)}`
}

/** "Erfüllt bis 12.03.2027", or the state alone where no day belongs to it. */
export function dutyStateWords(state: DutyState, until: IsoDate | null | undefined): string {
  if (state !== 'met' && state !== 'outstanding') {
    return dutyStateLabel[state]
  }

  // A duty that falls due once is outstanding until its due day (#439).
  if (until === null || until === undefined) {
    return state === 'met' ? 'Erfüllt' : 'Ausstehend'
  }

  return `${dutyStateLabel[state]} ${day(until)}`
}

/**
 * How a duty stands today, in words. One that has ended says so and nothing
 * else: from the day it ends it calls for nothing, whatever its last
 * appointment was.
 */
export function dutyStandingWords(
  duty: Pick<DutyReading, 'state' | 'appointment' | 'endsOn'> & { readonly ended: boolean },
): string {
  return duty.ended ? endedWords(duty) : dutyStateWords(duty.state, duty.appointment?.dueOn ?? null)
}
