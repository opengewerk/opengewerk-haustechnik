import { type LifecycleState, lifecycleStateLabel } from '@opengewerk/haustechnik-domain'
import { Status } from '@opengewerk/platform-web'
import { Pause } from 'lucide-react'

/**
 * The state of an asset on a day as the boards draw it: in service in the
 * tone of what is in order, every other state plain and with a pause, because
 * the duties of an asset rest while it is not in service (2.2 of the
 * concept). Nothing for an asset that has no state yet.
 */
export function AssetState({ state }: { readonly state: LifecycleState | undefined }) {
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
