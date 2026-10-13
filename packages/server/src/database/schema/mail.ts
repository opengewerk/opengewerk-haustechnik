import { mailOutboxSchema } from '@opengewerk/platform-server'

/**
 * What a message by mail is about (#126, section 3 of the concept): a
 * deadline that reminds, and the invitation of an access. Everything else an
 * operator tells its people goes by push; the mails to an account, the link
 * to a new password and the notice of a new passkey, go out through the mail
 * server of the instance and are kept in no outbox (#81). In the order the
 * enum learnt them, which is the order they stand in the database.
 */
export const mailKinds = ['deadline_due', 'invitation'] as const

/**
 * Every message an operator sends by mail, before and after it went out.
 *
 * The table and how it is sent are the foundation's (`mailOutboxSchema`,
 * ADR 0010 in the repository opengewerk): written when something is due,
 * sent by the job afterwards, once per cause. Kept here are the kinds of this
 * application and nothing else.
 *
 * The outbox has no place and no policy of the areas: a row is what the
 * operator told one person, and nobody reads it through a route but the list
 * of the accesses, which asks how the message of an invitation stands. So it
 * carries no key onto the deadline a reminder is about either: a deadline
 * has a place, and a key onto a row with a place runs over the property (ADR
 * 0003), which a row without one cannot name. The cause of the message names
 * the deadline and its day, which is what writes it once.
 */
export const { mailKind, mailStatus, mailOutbox } = mailOutboxSchema({ kinds: mailKinds })
