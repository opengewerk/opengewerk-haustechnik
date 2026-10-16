import {
  type FaultReportState,
  faultPlaceLine,
  type TenantId,
} from '@opengewerk/haustechnik-domain'
import {
  type Database,
  everyTenant,
  type MailConfiguration,
  type MailTransport,
  type SecretKey,
  type TenantTransaction,
} from '@opengewerk/platform-server'
import { tenants } from '@opengewerk/platform-server/schema'
import { and, eq, inArray } from 'drizzle-orm'

import { application } from '../configuration.js'
import { inEveryArea } from '../database/every-area.js'
import { faultReportContacts, faultReports } from '../database/schema/index.js'
import { followedStateOf, rowsWhere, signedAtOf, wordsOf } from '../faults/reading.js'
import { mailServersOfOperators } from '../mail/server-settings.js'

/** What the run needs, handed in so that a test can run it with a clock and a mail server of its own. */
export interface OutsideAnswersJob {
  readonly database: Database
  readonly connect: (configuration: MailConfiguration) => MailTransport
  readonly key: SecretKey
  readonly now?: () => Date
}

/**
 * How long after the signature an answer that does not go out is given up,
 * and the address removed all the same: the concept removes it with the
 * report done, and a mail server that does not answer for days does not
 * keep it.
 */
const giveUpAfterMs = 2 * 24 * 3_600_000

type ContactRow = typeof faultReportContacts.$inferSelect

/** The day a report came in, as the mail says it. */
function dayOf(at: Date): string {
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(at)
}

/** The two answers somebody without an account gets, in the words of the operator. */
function messageOf(
  step: 'accepted' | 'done',
  report: { readonly receivedAt: Date; readonly category: string; readonly place: string },
  operator: string,
): { readonly subject: string; readonly text: string } {
  const about = `Ihre Meldung vom ${dayOf(report.receivedAt)} (${report.category}, ${report.place})`

  return step === 'accepted'
    ? {
        subject: 'Ihre Störmeldung ist angenommen',
        text: [
          'Guten Tag,',
          '',
          `${about} ist angenommen. Wir kümmern uns darum, und Sie bekommen noch einmal Bescheid, wenn sie erledigt ist.`,
          '',
          'Diese Nachricht geht an die Adresse, die Sie bei der Meldung angegeben haben. Mit der Erledigung wird sie gelöscht.',
          '',
          operator,
        ].join('\n'),
      }
    : {
        subject: 'Ihre Störmeldung ist erledigt',
        text: [
          'Guten Tag,',
          '',
          `${about} ist erledigt. Danke für den Hinweis.`,
          '',
          'Ihre Adresse ist mit dieser Nachricht gelöscht, und zu dieser Meldung kommt keine weitere.',
          '',
          operator,
        ].join('\n'),
      }
}

/** What to do with one address, from the state its report follows. */
function stepOf(
  state: FaultReportState,
  contact: ContactRow,
): 'wait' | 'accepted' | 'done' | 'remove' {
  switch (state) {
    case 'rejected':
      return 'remove'
    case 'done':
      return 'done'
    case 'accepted':
      return contact.acceptedMailedAt === null ? 'accepted' : 'wait'
    default:
      return 'wait'
  }
}

/**
 * The answers to somebody who reported without an account and gave an address
 * (section 4.7 of the concept, #332): one mail when the report is accepted,
 * one when it is done, each through the mail server of the operator, as a
 * report merged into another follows that one. The address goes with the
 * report done, after the mail, and with the report rejected, without one: a
 * rejection is answered to nobody, as with an account (#331).
 *
 * Not through `mail_outbox`: that table is in the change log and keeps the
 * address it sent to, and the address is never to stand in the log (#355).
 * What has gone out is written on the row of the address itself. An operator
 * without a mail server sends nothing, and the address of a report done is
 * removed all the same; one whose server does not take the mail is tried
 * again at the next pass, for two days after the signature.
 *
 * Works for nobody and in every area, like the other runs of the
 * notifications. Returns how many mails went out.
 */
export async function answerOutsideReports(job: OutsideAnswersJob): Promise<number> {
  let sent = 0

  for (const tenantId of await everyTenant(job.database)) {
    try {
      sent += await answerIn(job, tenantId)
    } catch (error) {
      console.error(
        `Die Rückmeldung an Meldende ohne Konto für den Betreiber ${tenantId} ist gescheitert.`,
        error,
      )
    }
  }

  return sent
}

async function answerIn(job: OutsideAnswersJob, tenantId: TenantId): Promise<number> {
  const actor = { tenantId, reason: 'mail' }
  const waiting = await inEveryArea(job.database, actor, async (tx) => {
    const contacts = await tx.select().from(faultReportContacts)

    if (contacts.length === 0) {
      return []
    }

    const rows = await rowsWhere(
      tx,
      inArray(
        faultReports.id,
        contacts.map((contact) => contact.faultReportId),
      ),
    )
    const byReport = new Map(rows.map((row) => [row.report.id as string, row]))

    return Promise.all(
      contacts.map(async (contact) => {
        const row = byReport.get(contact.faultReportId)
        const state = row === undefined ? 'received' : followedStateOf(row)

        return {
          contact,
          step: stepOf(state, contact),
          report:
            row === undefined
              ? null
              : {
                  receivedAt: row.report.receivedAt,
                  category: row.category,
                  place: faultPlaceLine(wordsOf(row)),
                },
          signedAt:
            state === 'done' && row?.orderActivityId
              ? await signedAtOf(tx, row.orderActivityId)
              : null,
        }
      }),
    )
  })
  const due = waiting.filter((one) => one.step !== 'wait')

  if (due.length === 0) {
    return 0
  }

  const connection = await mailServersOfOperators.connectionOf(job.database, tenantId, job.key)
  const now = (job.now ?? (() => new Date()))()
  let sent = 0
  let transport: MailTransport | null = null

  try {
    for (const { contact, step, report, signedAt } of due) {
      if (step === 'wait') {
        continue
      }

      if (step === 'remove') {
        await settle(job.database, actor, contact, 'remove')
        continue
      }

      if (connection?.state !== 'ready' || report === null) {
        // Nothing can go out. An acceptance waits for a mail server; a report
        // done takes the address with it.
        if (step === 'done' && (connection === null || report === null)) {
          await settle(job.database, actor, contact, 'remove')
        }

        continue
      }

      try {
        transport ??= job.connect(connection.configuration)

        const operator = await inEveryArea(job.database, actor, operatorName)
        const message = messageOf(step, report, operator)

        await transport.send({
          from: { name: operator, address: connection.configuration.from },
          replyTo: null,
          to: { name: null, address: contact.address },
          subject: message.subject,
          text: message.text,
          attachments: [],
        })
        sent += 1
        await settle(job.database, actor, contact, step === 'done' ? 'remove' : 'accepted', now)
      } catch (error) {
        console.warn(
          `Eine Rückmeldung an jemanden ohne Konto ging für den Betreiber ${tenantId} nicht hinaus.`,
          error,
        )

        if (
          step === 'done' &&
          signedAt !== null &&
          now.getTime() - signedAt.getTime() > giveUpAfterMs
        ) {
          await settle(job.database, actor, contact, 'remove')
        }
      }
    }
  } finally {
    transport?.close()
  }

  return sent
}

/** The name of the operator, as it signs a message. */
async function operatorName(tx: TenantTransaction): Promise<string> {
  const [tenant] = await tx.select({ name: tenants.name }).from(tenants)

  return tenant?.name ?? application.name
}

/** Writes down that the answer to an acceptance went out, or removes the address. */
async function settle(
  database: Database,
  actor: { readonly tenantId: TenantId; readonly reason: string },
  contact: ContactRow,
  how: 'accepted' | 'remove',
  now: Date = new Date(),
): Promise<void> {
  await inEveryArea(database, actor, async (tx) => {
    const where = and(
      eq(faultReportContacts.id, contact.id),
      eq(faultReportContacts.tenantId, contact.tenantId),
    )

    await (how === 'remove'
      ? tx.delete(faultReportContacts).where(where)
      : tx.update(faultReportContacts).set({ acceptedMailedAt: now, updatedAt: now }).where(where))
  })
}
