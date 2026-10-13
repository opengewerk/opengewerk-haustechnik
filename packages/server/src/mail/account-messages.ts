import type { AccountMessages } from '@opengewerk/platform-server'

import { application } from '../configuration.js'
import { passkeyAddedMessage, passwordResetMessage } from '../notifications/templates.js'

/**
 * What this application says in the mails to an account (#81, #126): the
 * link to a new password and the notice of a new passkey, in its words and
 * under its name.
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
}
