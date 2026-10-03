import { SiteFrame } from '@opengewerk/platform-web/site'

/**
 * What every screen on site sits in. The frame is the foundation's (ADR 0010
 * in the repository opengewerk): the strips, the header of a screen, the tabs
 * where the thumb is, the conflicts after them and the menu.
 *
 * This application has no place of its own among the tabs yet: rounds,
 * inventory and defects arrive in phase 1, each with its board. Until then
 * the device on site shows what it holds of the sync, and the menu with the
 * account and the way to the office.
 */
export function SiteShell() {
  return <SiteFrame tabs={[]} />
}
