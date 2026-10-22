import type { SyncConflict } from '@opengewerk/haustechnik-domain'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { afterEachSiteTest, mountSite, schoolServer } from '../site/test-site.js'
import { handedOnWords } from './handed-on-decision.js'

/**
 * A round the office gave to another person while the device was away
 * (#559): what the device still held of it comes back refused, and the
 * screen of the conflicts says so once for the round.
 */

afterEach(afterEachSiteTest)

const at = new Date('2026-10-22T07:30:00Z')

function conflict(part: Partial<Omit<SyncConflict, 'id'>> & { readonly id: string }): SyncConflict {
  return {
    tenantId: 't-nord',
    operationId: `op-${part.id}`,
    entity: 'activity_answers',
    recordId: 'aa-1',
    reason: 'changed_elsewhere',
    fields: ['performerUserId'],
    wanted: {},
    seen: {},
    found: {},
    deviceId: 'phone',
    recordedAt: at,
    resolvedAt: null,
    createdAt: at,
    updatedAt: at,
    ...part,
  } as SyncConflict
}

const anAnswer = conflict({
  id: 'k-answer',
  wanted: { activityId: 'ac-round', fieldKey: 'seal_intact', result: 'not_ok' },
})
const theSignature = conflict({
  id: 'k-signature',
  entity: 'activity_signatures',
  recordId: 'as-1',
  wanted: { activityId: 'ac-round', role: 'signer' },
})
const ofAnotherRound = conflict({
  id: 'k-other',
  recordId: 'aa-2',
  wanted: { activityId: 'ac-other', fieldKey: 'no_leak', result: 'ok' },
})

describe('a round given to another person while the device was away (#559)', () => {
  it('is one card for each round with what the server did not take of it, which is taken note of', async () => {
    const closed: string[] = []
    let waiting = [anAnswer, theSignature, ofAnotherRound]
    const server = Object.assign(schoolServer(), {
      conflicts: () => Promise.resolve(waiting),
      resolve: (id: string) => {
        closed.push(id)
        waiting = waiting.filter((each) => each.id !== id)

        return Promise.resolve()
      },
    })

    await mountSite('/konflikte', { server })

    await waitFor(() => {
      expect(screen.getAllByText(handedOnWords.reason)).toHaveLength(2)
    })
    // Nothing to choose, as there is no version of a field to keep.
    expect(screen.queryByText('performerUserId')).toBeNull()

    const [first] = screen.getAllByRole('button', { name: handedOnWords.noted })

    fireEvent.click(first as HTMLElement)

    await waitFor(() => {
      expect(closed).toEqual(['k-answer', 'k-signature'])
    })
  })
})
