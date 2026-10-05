import {
  type IsoDate,
  type LifecycleState,
  lifecycleStateOn,
  lifecycleStates,
  type RecordState,
} from '@opengewerk/haustechnik-domain'
import { text } from '@opengewerk/platform-web/sync'

/**
 * The assets as a device holds them, read for a screen. Both entries read the
 * same records, so both read them here.
 */

/**
 * The state every asset is in on a day, by the entries of the life cycles a
 * device holds (ADR 0002, point 7): the entry with the latest first day up to
 * that day. An asset without an entry up to that day is not in the answer:
 * one taken stock of on a device a moment ago has none until the office gives
 * it one.
 */
export function statesOn(
  entries: readonly RecordState[],
  day: IsoDate,
): ReadonlyMap<string, LifecycleState> {
  const byAsset = new Map<string, { state: LifecycleState; validFrom: IsoDate }[]>()

  for (const entry of entries) {
    const state = entry['state']

    if (!(lifecycleStates as readonly unknown[]).includes(state)) {
      continue
    }

    const assetId = String(entry['assetId'])

    byAsset.set(assetId, [
      ...(byAsset.get(assetId) ?? []),
      { state: state as LifecycleState, validFrom: text(entry, 'validFrom') },
    ])
  }

  const states = new Map<string, LifecycleState>()

  for (const [assetId, own] of byAsset) {
    const state = lifecycleStateOn(own, day)

    if (state !== null) {
      states.set(assetId, state)
    }
  }

  return states
}
