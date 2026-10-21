import type { AccountMessages } from '@opengewerk/platform-server'

import { application } from '../configuration.js'
import {
  mailServerChangedMessage,
  operatorsChangedMessage,
  passkeyAddedMessage,
  passwordResetMessage,
  recoveryCodesRenewedMessage,
} from '../notifications/templates.js'

/**
 * What this application says in the mails to an account (#81, #126): the
 * link to a new password and the notice of a new passkey or of new recovery
 * codes, in its words and under its name, to the lead of every operator when
 * the mail server of the instance changes, and to the administration of the
 * instance when an account is named to it or taken off (#360).
 *
 * When they go out, and through what, is the foundation's: through the mail
 * server of the instance, which whoever runs the instance sets up in its
 * settings, and through the mail server of no operator. An account belongs
 * to the instance; an operator could otherwise read the link to a new
 * password of an account it had taken in. Without that mail server nothing
 * goes out, and the way back into an account is whoever leads an operator it
 * works for, or `reset-password` on the server.
 */
export const accountMessages: AccountMessages = {
  senderName: application.name,
  accountPath: '/konto',
  passwordReset: (facts) => passwordResetMessage({ ...facts, application: application.name }),
  passkeyAdded: (facts) => passkeyAddedMessage({ ...facts, application: application.name }),
  recoveryCodesRenewed: (facts) =>
    recoveryCodesRenewedMessage({ ...facts, application: application.name }),
  operatorsChanged: (facts) => operatorsChangedMessage({ ...facts, application: application.name }),
  mailServerChanged: (facts) =>
    mailServerChangedMessage({ ...facts, application: application.name }),
}
