import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

import { outsideReportRules } from '@opengewerk/haustechnik-domain'
import type { TenantId } from '@opengewerk/haustechnik-domain'
import type { Database, TenantTransaction } from '@opengewerk/platform-server'
import { sql } from 'drizzle-orm'

import { outsideReason } from '../database/label-area.js'

const hour = 3_600_000

/** A limit asked of the database: the kind of count, what it counts under, and how many an hour. */
interface Count {
  readonly kind: 'page' | 'address' | 'label'
  readonly key: string
  readonly limit: number
}

/** What a count is kept under: the SHA-256 of the address or the code, never either itself. */
function keyOf(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

/**
 * Whether once more is allowed under each count in the last hour, and if so
 * counting it under the kinds named, in the database (#540): every process
 * of an instance counts the same, and a restart forgets nothing. The
 * database forgets a count after its hour (`outside_take`).
 */
async function taken(
  tx: TenantTransaction,
  counts: readonly Count[],
  counted: readonly Count['kind'][],
  now: number,
): Promise<boolean> {
  const { rows } = await tx.execute<{ allowed: boolean }>(
    sql`select outside_take(
          ${sql.raw(`array[${counts.map((count) => `'${count.kind}'`).join(',')}]::text[]`)},
          ${sql.raw(`array[${counts.map((count) => `'${count.key}'`).join(',')}]::text[]`)},
          ${sql.raw(`array[${counts.map((count) => String(count.limit)).join(',')}]::integer[]`)},
          ${sql.raw(`array[${counted.map((kind) => `'${kind}'`).join(',')}]::text[]`)},
          ${new Date(now).toISOString()}::timestamptz
        ) as allowed`,
  )

  return rows[0]?.allowed === true
}

/** Where the photo of a report without an account may still go, and until when. */
export interface PhotoSlip {
  readonly tenantId: TenantId
  readonly areaId: string
  readonly reportId: string
  readonly code: string
}

/** What a form sent back from the page of a label is: good, sent faster than a person reads, or stale. */
export type FormState = 'good' | 'early' | 'stale'

/**
 * What stands between the page of a label and a machine (section 4.7 of the
 * concept, #332, decided 15.10.2026: no captcha and no service of a third
 * party). Three things:
 *
 * - a limit per hour, on opening the page per address, and on reports per
 *   address and per label, counted in the database (#540), so that every
 *   process counts the same and a restart forgets nothing. The address counts
 *   every request for a report;
 *   the label counts only a report that passed its checks and is written
 *   (#472), so that requests that fail at the field nobody sees, at the form
 *   or at their fields do not use up the reports a label takes;
 * - the form the page sends back, in this process, which carries when it was handed out under
 *   a key of this process: a report sent sooner than a person reads the page
 *   is taken as from a machine, one older than a day as stale, and so is one
 *   from before a restart;
 * - the slip for the photo of a report, in this process, good once and for a few minutes, so
 *   that nobody stores a file in an operator's store without a report it
 *   belongs to.
 *
 * `now` is the clock; a test hands in its own.
 */
export class OutsideReports {
  private readonly key = randomBytes(32)
  private readonly slips = new Map<string, { readonly slip: PhotoSlip; readonly until: number }>()

  constructor(readonly now: () => number = Date.now) {}

  /** Whether one more opening of a page is allowed from this address. */
  openPage(database: Database, address: string): Promise<boolean> {
    const now = this.now()

    return database.forInstance(
      (tx) =>
        taken(
          tx,
          [{ kind: 'page', key: keyOf(address), limit: outsideReportRules.pagesPerAddress }],
          ['page'],
          now,
        ),
      undefined,
      outsideReason,
    )
  }

  /**
   * Whether one more request for a report is allowed from this address and
   * over this code. Counted against the address once it is, whatever becomes
   * of the request, and against neither when one refuses. The code is only
   * asked here: a report over it is counted once it is written (`takeLabel`).
   */
  takeReport(database: Database, address: string, code: string): Promise<boolean> {
    const now = this.now()

    return database.forInstance(
      (tx) =>
        taken(
          tx,
          [
            { kind: 'address', key: keyOf(address), limit: outsideReportRules.perAddress },
            { kind: 'label', key: keyOf(code), limit: outsideReportRules.perLabel },
          ],
          ['address'],
          now,
        ),
      undefined,
      outsideReason,
    )
  }

  /**
   * Whether one more report over this code is allowed, counted against it
   * once it is: for a report that passed its checks and is about to be
   * written, and for nothing before (#472). In the transaction of the
   * report, so that one that fails after it counts nothing (#540).
   */
  takeLabel(tx: TenantTransaction, code: string): Promise<boolean> {
    return taken(
      tx,
      [{ kind: 'label', key: keyOf(code), limit: outsideReportRules.perLabel }],
      ['label'],
      this.now(),
    )
  }

  /** The form for the page of a code, with the moment it was handed out. */
  form(code: string): string {
    const at = String(this.now())

    return `${at}.${this.signature(code, at)}`
  }

  /** What a form sent back for a code is. */
  formState(code: string, form: unknown): FormState {
    if (typeof form !== 'string') {
      return 'stale'
    }

    const [at, signature, ...rest] = form.split('.')

    if (at === undefined || signature === undefined || rest.length > 0 || !/^\d{1,15}$/u.test(at)) {
      return 'stale'
    }

    const expected = Buffer.from(this.signature(code, at), 'base64url')
    const given = Buffer.from(signature, 'base64url')

    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      return 'stale'
    }

    const age = this.now() - Number(at)

    if (age > outsideReportRules.mostHours * hour || age < 0) {
      return 'stale'
    }

    return age < outsideReportRules.leastSeconds * 1000 ? 'early' : 'good'
  }

  /** A slip for the photo of a report just written, good once. */
  promisePhoto(slip: PhotoSlip): string {
    const now = this.now()

    for (const [token, held] of this.slips) {
      if (held.until <= now) {
        this.slips.delete(token)
      }
    }

    const token = randomBytes(24).toString('base64url')

    this.slips.set(token, { slip, until: now + outsideReportRules.photoMinutes * 60_000 })

    return token
  }

  /** The report a slip was for, once: a second call with it, or a late one, finds nothing. */
  photoFor(token: string): PhotoSlip | null {
    const held = this.slips.get(token)

    this.slips.delete(token)

    return held !== undefined && held.until > this.now() ? held.slip : null
  }

  private signature(code: string, at: string): string {
    return createHmac('sha256', this.key).update(`${code}\n${at}`).digest('base64url')
  }
}

/** Where the routes of the page of a label find the one gate of this process. */
export const OUTSIDE_REPORTS = Symbol('OUTSIDE_REPORTS')
