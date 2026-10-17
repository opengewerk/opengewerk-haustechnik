import {
  type LifecycleState,
  lifecycleStateLabel,
  showsShutDown,
  shutDownLabel,
} from '@opengewerk/haustechnik-domain'
import { Status } from '@opengewerk/platform-web'
import { Ban, Pause } from 'lucide-react'

/**
 * The state of an asset on a day as the boards draw it: in service in the
 * tone of what is in order, every other state plain and with a pause, because
 * the duties of an asset rest while it is not in service (2.2 of the
 * concept). Nothing for an asset that has no state yet.
 *
 * One a defect puts out of service (#345) says so in the tone of a conflict,
 * over in service, no entry and out of service (`showsShutDown`): it is a
 * state and no section of the life cycle, and its duties go on.
 */
export function AssetState({
  state,
  shutDown = false,
}: {
  readonly state: LifecycleState | undefined
  readonly shutDown?: boolean
}) {
  if (showsShutDown(state ?? null, shutDown)) {
    return (
      <Status tone="conflict" icon={Ban}>
        {shutDownLabel}
      </Status>
    )
  }

  if (state === undefined) {
    return null
  }

  return state === 'in_service' ? (
    <Status tone="done">{lifecycleStateLabel[state]}</Status>
  ) : (
    <Status tone="neutral" icon={Pause}>
      {lifecycleStateLabel[state]}
    </Status>
  )
}
