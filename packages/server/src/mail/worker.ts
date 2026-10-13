import type {
  ApplicationDeadlineKind,
  DeadlineRegistry,
  TenantId,
} from '@opengewerk/haustechnik-domain'
import {
  type CycleReport,
  type Database,
  type InvitationLinkSource,
  type MailConfiguration,
  type MailJob as FoundationMailJob,
  type MailTransport,
  type RepeatingJob,
  runMailCycle as runFoundationCycle,
  type SecretKey,
  startMailWorker as startFoundationWorker,
} from '@opengewerk/platform-server'

import { occasions } from '../notifications/occasions.js'
import { outbox, type OutboxRow } from './outbox.js'
import { mailServersOfOperators } from './server-settings.js'

export type { CycleReport } from '@opengewerk/platform-server'

/** What the job needs, handed in so that a test can run it with a clock of its own. */
export interface MailJob {
  readonly database: Database
  /**
   * Opens the connection to the mail server of one operator: `smtpTransport`
   * in a running instance, and in a test one that keeps what it is given.
   */
  readonly connect: (configuration: MailConfiguration) => MailTransport
  /** The key the password of each operator's mail server is sealed with. */
  readonly key: SecretKey
  /** Where the instance is reached, for the links in a message. */
  readonly origin: string
  /** Where the link of an invitation comes from, made when its message goes out. */
  readonly invitationLinks?: InvitationLinkSource
  /** The kinds of deadline, the instance's own unless a test brings others. */
  readonly deadlineKinds?: DeadlineRegistry<ApplicationDeadlineKind>
  readonly now?: () => Date
}

/** The sentences of the job that name an operator. */
const sentences = {
  passwordUnreadable: (tenantId: TenantId) =>
    `Das Passwort zum Mailserver des Betreibers ${tenantId} lässt sich nicht mehr lesen, ` +
    'SESSION_SECRET wurde seit dem Speichern getauscht. Die E-Mails warten, bis es ' +
    'unter "E-Mail-Einstellungen" neu eingegeben ist.',
  tenantFailed: (tenantId: TenantId) =>
    `Der Versand für den Betreiber ${tenantId} ist gescheitert.`,
}

/**
 * The job of the foundation (ADR 0010 in the repository opengewerk) over the
 * occasions of this application (#126): a deadline that has come within its
 * lead, written before what waits in the outbox is sent, so that something
 * due in this minute goes out in the same pass. No message of this
 * application carries a file.
 */
function bound(job: MailJob): FoundationMailJob<OutboxRow> {
  return {
    database: job.database,
    servers: mailServersOfOperators,
    outbox,
    connect: job.connect,
    key: job.key,
    raise: occasions.raiseMail(job.database, {
      origin: job.origin,
      ...(job.deadlineKinds ? { deadlineKinds: job.deadlineKinds } : {}),
    }),
    ...(job.invitationLinks ? { invitationLinks: job.invitationLinks } : {}),
    sentences,
    ...(job.now ? { now: job.now } : {}),
  }
}

/**
 * One pass over every operator: first what has become due, then what is
 * waiting to be sent, each operator through its own mail server. How a pass
 * goes is the foundation's, `runMailCycle` there.
 */
export function runMailCycle(job: MailJob): Promise<CycleReport> {
  return runFoundationCycle(bound(job))
}

/** Runs the job every minute, one pass after the other and never two at once. */
export function startMailWorker(job: MailJob, intervalMs = 60_000): RepeatingJob {
  return startFoundationWorker(bound(job), intervalMs)
}
