import {
  AccountScreen as Account,
  PushPanel,
  type PushPanelWords,
} from '@opengewerk/platform-web/office'

/**
 * What this application says on the card "Benachrichtigungen" of the
 * foundation (#126, the board "Konto: Benachrichtigungen"): what a message
 * says and leaves out, who gets the key an instance without one is missing,
 * and that the reminder of a deadline comes by mail whatever is chosen here.
 */
export const pushWords: PushPanelWords = {
  about:
    'Push-Nachrichten kommen auch, wenn die Anwendung geschlossen ist. Sie sagen nur, was ' +
    'ansteht; Namen und Orte stehen erst in der Anwendung.',
  keyMissing:
    'Wer die Instanz betreibt, bekommt ihn mit dem nächsten Start über „sh docker/start.sh“.',
  footnote: 'Per E-Mail kommen Erinnerungen an Fristen immer, unabhängig davon.',
}

/**
 * "Konto" in the office. The screen is the foundation's (ADR 0010 in the
 * repository opengewerk): light or dark, the second factor, the passkeys, the
 * password and the devices somebody is signed in on. This application adds
 * the card of push on this device (#126), which is the foundation's as well
 * and says here what only this application knows.
 */
export function AccountScreen() {
  return (
    <Account>
      <PushPanel entry="office" words={pushWords} />
    </Account>
  )
}
