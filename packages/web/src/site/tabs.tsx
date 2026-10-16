import { useRight } from '@opengewerk/platform-web/session'
import type { SiteTab } from '@opengewerk/platform-web/site'
import { House, MessageSquareWarning, Plus, ScanLine } from 'lucide-react'

import { type Offer, useOffered } from '../app/places.js'

/** A place among the tabs: the tab the frame draws, and what it asks before it stands there. */
export type SitePlace = SiteTab & Offer

/**
 * The tabs on site as the board "Navigation mit dem Pfad" draws them: Start,
 * Scannen and Aufnehmen. "Konflikte" and "Menü" after them are the frame's of
 * the foundation, which makes the five of the board. A Melder has "Menü" alone
 * after its own (#392).
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

/**
 * The tabs of a Melder (#331, the board "Melder"): the own reports and the
 * scan of a label to report at. It sees no place, so it has no other.
 */
export const reporterTabs: readonly SitePlace[] = [
  { to: '/', label: 'Meldungen', icon: MessageSquareWarning, right: 'fault.report' },
  { to: '/scannen', label: 'Scannen', icon: ScanLine, right: 'fault.report' },
]

/** What the frame on site is told about the person signed in. */
export interface SiteTabs {
  /** The tabs the person is offered, before those of the frame. */
  readonly tabs: readonly SiteTab[]
  /**
   * Whether the person only reports, as a Melder does (#392). Its device
   * holds nothing of the operator, so nothing on it can come into conflict,
   * and the office sends it straight back here: the frame leaves out the tab
   * "Konflikte", the suggestion of the office and the way to it in the menu.
   */
  readonly reportsOnly: boolean
}

/** The tabs the person signed in is offered, and whether the person only reports. */
export function useTabs(): SiteTabs {
  const seesPlaces = useRight('location.read')
  const own = useOffered(siteTabs)
  const reporting = useOffered(reporterTabs)
  const reportsOnly = !seesPlaces && reporting.length > 0

  return { tabs: reportsOnly ? reporting : own, reportsOnly }
}
