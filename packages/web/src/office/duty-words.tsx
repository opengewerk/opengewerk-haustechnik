import {
  contractEndedWords,
  type DutyEntry,
  endedWords,
  intervalCheckWords,
  nobodyWords,
} from '@opengewerk/haustechnik-domain'
import { Button, Status } from '@opengewerk/platform-web'
import { useRight } from '@opengewerk/platform-web/session'
import { useNavigate } from '@tanstack/react-router'
import { Plus, TriangleAlert } from 'lucide-react'

import { DutyStateMark } from '../app/asset-marks.js'
import { dutyPlaces, type NewDutyStart, newDutySearch } from './duty-addresses.js'

/**
 * What the register of duties, the page of a duty and the file of an asset
 * say about a duty in the same words: where it comes from, what kind of
 * interval it has, who performs it, and how it stands.
 */

// The words themselves are said in `domain` (`duty-words.ts`), where the
// register as a table reads them as well (#236); here they are handed on, and
// what a screen draws around them is added.
export {
  dutySourceWords,
  endedWords,
  intervalCheckWords,
  intervalKindWords,
  kindOfDuty,
  nobodyWords,
  ownDutyWords,
  performerWords,
} from '@opengewerk/haustechnik-domain'

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

/**
 * "Frist prüfen" beside the state of a duty in the head of its page, in the
 * tone of what waits (4.3 of the concept, #74).
 */
/** "Vertrag abgelaufen" in the head of a duty (#329): the contract it fulfils has ended. */
export function ContractEndedStatus() {
  return (
    <Status tone="conflict" icon={TriangleAlert}>
      {contractEndedWords}
    </Status>
  )
}

export function IntervalCheckStatus() {
  return (
    <Status tone="waiting" icon={TriangleAlert}>
      {intervalCheckWords}
    </Status>
  )
}

/** The same under the interval of a row of the register: in words and with a symbol. */
export function IntervalCheck() {
  return (
    <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-waiting">
      <TriangleAlert size={12} strokeWidth={2.2} aria-hidden="true" />
      {intervalCheckWords}
    </span>
  )
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

/**
 * The way to the form of a duty of the operator's own (#103): "Eigene
 * Pflicht" in the head of the register, and "Pflicht hinzufügen" in the card
 * of the duties of an asset and of a room, as the boards name them. A duty
 * from the catalogue is not added by hand: it is proposed (#102). For whoever
 * keeps the register; nobody else is offered it.
 */
export function NewDutyButton({
  start,
  primary = false,
}: {
  /** The place the form starts at; from the register, what the list is narrowed to. */
  readonly start: NewDutyStart
  /** In the head of the register it is the one thing to do; in a card it stands back. */
  readonly primary?: boolean
}) {
  const keeps = useRight('duty.write')
  const navigate = useNavigate()

  return keeps ? (
    <Button
      icon={Plus}
      {...(primary ? { tone: 'primary' as const } : { size: 'small' as const })}
      onClick={() => {
        void navigate({ to: dutyPlaces.new, search: newDutySearch(start) })
      }}
    >
      {primary ? 'Eigene Pflicht' : 'Pflicht hinzufügen'}
    </Button>
  ) : null
}
