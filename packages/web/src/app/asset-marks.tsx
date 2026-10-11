import {
  type AssetCondition,
  assetConditionLabel,
  type AssetStanding,
  conditionWords,
  type DutyState,
  dutyStateWords,
  type IsoDate,
} from '@opengewerk/haustechnik-domain'
import { Status, statusIcons, type StatusTone } from '@opengewerk/platform-web'
import { type LucideIcon, Pause } from 'lucide-react'

/**
 * How a duty and an asset stand today, as the boards draw it
 * (`duty_state()` of the canvas): what calls for something in the tone of a
 * conflict, what is coming in the tone of waiting, what is met in the tone of
 * what is in order, and what rests plain with a pause. Never by colour alone:
 * each says it in words and with a symbol of its own.
 */

interface Look {
  readonly tone: StatusTone
  readonly icon?: LucideIcon
}

const dutyLooks: Readonly<Record<DutyState, Look>> = {
  never_recorded: { tone: 'conflict', icon: statusIcons.ban },
  dormant: { tone: 'neutral', icon: Pause },
  overdue: { tone: 'conflict' },
  due: { tone: 'waiting' },
  met: { tone: 'done' },
}

/** "Erfüllt bis 12.03.2027", or the state alone where no day belongs to it. */
export function DutyStateMark({
  state,
  until,
}: {
  readonly state: DutyState
  /** For a duty that is met: the day it falls due. */
  readonly until?: IsoDate | null
}) {
  const look = dutyLooks[state]

  return (
    <Status tone={look.tone} {...(look.icon ? { icon: look.icon } : {})}>
      {dutyStateWords(state, until)}
    </Status>
  )
}

const conditionLooks: Readonly<Record<Exclude<AssetCondition, 'no_duties'>, Look>> = {
  defect_open: { tone: 'conflict' },
  never_checked: { tone: 'conflict', icon: statusIcons.ban },
  overdue: { tone: 'conflict' },
  due: { tone: 'waiting' },
  in_order: { tone: 'done' },
  resting: { tone: 'neutral', icon: Pause },
}

/**
 * The condition of an asset. One without a duty has no marker: nothing is
 * known to be in order or not, and a grey line says that without looking
 * like a state.
 */
export function AssetConditionMark({ standing }: { readonly standing: AssetStanding }) {
  if (standing.condition === 'no_duties') {
    return <span className="text-[12px] text-ink-faint">{assetConditionLabel.no_duties}</span>
  }

  const look = conditionLooks[standing.condition]

  return (
    <Status tone={look.tone} {...(look.icon ? { icon: look.icon } : {})}>
      {conditionWords(standing)}
    </Status>
  )
}
