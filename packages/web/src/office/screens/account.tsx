import { AccountScreen as Account } from '@opengewerk/platform-web/office'

/**
 * "Konto" in the office. The screen is the foundation's (ADR 0010 in the
 * repository opengewerk): light or dark, the second factor, the passkeys, the
 * password and the devices somebody is signed in on. This application adds no
 * card of its own yet; push on this device arrives with the notifications.
 */
export function AccountScreen() {
  return <Account />
}
