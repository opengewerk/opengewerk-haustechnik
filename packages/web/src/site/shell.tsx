import { SiteFrame } from '@opengewerk/platform-web/site'

import { useKeepCatalogue } from '../sync/catalogue.js'
import { useTabs } from './tabs.js'

/**
 * What every screen on site sits in. The frame is the foundation's (ADR 0010
 * in the repository opengewerk): the strips, the header of a screen, the tabs
 * where the thumb is, the conflicts after them and the menu.
 *
 * The tabs of this application are those of its board, each from the moment
 * its screen is built and for whoever holds its right (`useTabs`). Until the
 * first of them arrives, the device on site shows what it holds of the sync,
 * and the menu with the account and the way to the office.
 *
 * The frame is also where the device sees to it that it holds the catalogue
 * of its server (`useKeepCatalogue`): on site it is asked without a network.
 */
export function SiteShell() {
  useKeepCatalogue()

  return <SiteFrame tabs={useTabs()} />
}
