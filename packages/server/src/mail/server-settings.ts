import { signatureProblem } from '@opengewerk/haustechnik-domain'
import { mailServers } from '@opengewerk/platform-server'

import { secretsOfOperators } from '../secrets/store.js'
import { giveUpPending } from './outbox.js'

/**
 * The mail servers of the operators (#126). How one is checked, kept and
 * opened is the foundation's (`mailServers`, ADR 0010 in the repository
 * opengewerk); this binds it to the sealed credentials of this application,
 * to its signature with `{benutzer}`, to its outbox and to the sentences that
 * name an operator.
 */
export const mailServersOfOperators = mailServers({
  secrets: secretsOfOperators,
  purpose: 'smtp_password',
  signatureProblem,
  // Messages still waiting are given up on with the reason rather than left to
  // go out whenever a server is set up again: a reminder of a deadline that
  // came three weeks ago is not what somebody switching mail back on wants to
  // send.
  whenRemoved: (tx, now) =>
    giveUpPending(tx, 'Der Mailserver wurde entfernt, bevor die E-Mail hinausging.', now),
  sentences: {
    notConfigured:
      'Für diesen Betreiber ist kein Mailserver eingerichtet, deshalb verschickt er keine ' +
      'E-Mails. Einrichten lässt er sich unter "E-Mail-Einstellungen".',
    noneToRemove: 'Für diesen Betreiber ist kein Mailserver eingerichtet.',
    senderName: 'Der Name davor ist der des Betreibers.',
  },
})

export const { requireMailServer } = mailServersOfOperators
