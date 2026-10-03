import { OfficeFrame } from '@opengewerk/platform-web/office'

/**
 * What every office screen sits in. The frame is the foundation's (ADR 0010
 * in the repository opengewerk): the header in slate, the strips, the
 * navigation beside the screen and behind "Menü" on a phone, with the two
 * places at its foot that are visited rather than worked in, the exchange
 * with the server and the settings.
 *
 * This application has no group of its own in the navigation yet: its
 * records arrive in phase 1, each with its board.
 */
export function OfficeShell() {
  return <OfficeFrame navigation={[]} />
}
