import { lifecycleStateLabel, lifecycleStates } from '@opengewerk/haustechnik-domain'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { AssetState } from './asset-state.js'

/**
 * The state of an asset as the pages of the office draw it (#86). A state is
 * never told by its colour alone: each tone has a symbol, and that is what a
 * test can see.
 */

/** The symbol a marker carries, by the name its drawing has. */
function symbolIn(container: HTMLElement): string {
  return container.querySelector('svg')?.getAttribute('class') ?? ''
}

describe('the state of an asset as the pages draw it', () => {
  it('draws an asset in service as what is in order', () => {
    const { container } = render(<AssetState state="in_service" />)

    expect(container.textContent).toBe('In Betrieb')
    expect(symbolIn(container)).toContain('lucide-check')
  })

  // The duties of an asset rest while it is not in service (2.2 of the concept).
  it('draws every other state with a pause', () => {
    const others = lifecycleStates.filter((state) => state !== 'in_service')

    expect(others).toHaveLength(4)

    for (const state of others) {
      const { container, unmount } = render(<AssetState state={state} />)

      expect(container.textContent).toBe(lifecycleStateLabel[state])
      expect([state, symbolIn(container)]).toEqual([state, expect.stringContaining('lucide-pause')])
      unmount()
    }
  })

  // Taken stock of a moment ago: the office has not given it a state.
  it('draws nothing for an asset that has no state yet', () => {
    const { container } = render(<AssetState state={undefined} />)

    expect(container.innerHTML).toBe('')
  })
})
