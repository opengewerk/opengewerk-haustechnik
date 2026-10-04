import type { SiteTab } from '@opengewerk/platform-web/site'
import { House, Plus, ScanLine } from 'lucide-react'

import { type Offer, useOffered } from '../app/places.js'

/** A place among the tabs: the tab the frame draws, and what it asks before it stands there. */
export type SitePlace = SiteTab & Offer

/**
 * The tabs on site as the board "Navigation mit dem Pfad" draws them: Start,
 * Scannen and Aufnehmen. "Konflikte" and "Menü" after them are the frame's of
 * the foundation, which makes the five of the board.
 *
 * A tab stands from the moment a screen answers at its address, and only for
 * somebody who holds its right, as a place in the office does (`useBuilt`).
 * The start is for everybody: what is due today and this week for the person
 * who holds the device. Scanning opens an asset by its label, taking stock
 * brings one into being.
 */
export const siteTabs: readonly SitePlace[] = [
  { to: '/', label: 'Start', icon: House },
  { to: '/scannen', label: 'Scannen', icon: ScanLine, right: 'asset.read' },
  { to: '/aufnehmen', label: 'Aufnehmen', icon: Plus, right: 'asset.record' },
]

/** The tabs the person signed in is offered, before those of the frame. */
export function useTabs(): readonly SiteTab[] {
  return useOffered(siteTabs)
}
