import {
  type Id,
  type IsoDate,
  longestSignaturePath,
  longestSignerName,
  signaturePathIsValid,
  type Synced,
  type TenantOwned,
} from '@opengewerk/platform-domain'

import type { ActivityId, WorkOrderKind } from './activity.js'
import type { AreaId } from './area.js'
import type { StatedPlace } from './evidence.js'
import type { Problems } from './fields.js'
import type { PropertyId } from './location.js'
import {
  signatureLimits,
  type SignedNote,
  type SignedPage,
  type WorkOrderDecision,
} from './signature.js'

/**
 * The service report of a work order (section 4.8 of the concept, #324):
 * "Leistungsnachweis für den Auftraggeber im Haus oder beim Kunden:
 * geleistete Arbeit, Dauer, Material, Unterschrift des Auftraggebers mit
 * Namen in Druckschrift, als eingefrorenes PDF, ohne Preise."
 *
 * It comes about on request when the order is finished on site, as a step
 * before the own signature and also without a connection, one per order over
 * all its visits. The client has no account: the client signs with a drawing
 * and the name in block letters on the device, and the page with both is
 * covered by the signature of the account that holds the device (2.6), which
 * the report names. A rejection of the order makes it invalid like the
 * signature; it stays readable, and the next time the order is finished a new
 * one comes about.
 */

export type ServiceReportId = Id<'service-report'>
export type ServiceReportRecordId = Id<'service-report-record'>
export type WorkOrderSettingId = Id<'work-order-setting'>

/** The bounds of what a service report carries, the same on the device, the server and the database. */
export const serviceReportLimits = {
  /** The name in block letters is a name like the typed name under a signature. */
  clientName: longestSignerName,
  deviceInfo: signatureLimits.deviceInfo,
} as const

/**
 * The client's signature under a service report, as the device takes it and
 * the sync carries it: the name in block letters, the drawing, the moment of
 * the device and the fingerprint of the page that was shown. Who held the
 * device is the person signed in, which the server writes. Written once.
 */
export interface ServiceReport extends Synced {
  readonly id: ServiceReportId
  readonly propertyId: PropertyId
  readonly areaId: AreaId
  readonly activityId: ActivityId
  readonly clientName: string
  /** The drawing, as a path in the units of `signatureBox` of the foundation. */
  readonly path: string
  /** The account that held the device; its signature covers the page (2.6). */
  readonly signedBy: string
  /** The clock of the device at the moment the client confirmed. */
  readonly signedAt: Date
  readonly deviceInfo: string | null
  /** SHA-256 over the canonical form of the page that was shown, 64 hexadecimal digits. */
  readonly pageFingerprint: string
}

/**
 * What an operator sets for its work orders (section 15 of the concept):
 * whether the service report names the people who did the work and the times
 * of their notes. The default is off: the time spent is effort of the order
 * and no record of anybody's working time.
 */
export interface WorkOrderSettings {
  readonly namesAndTimes: boolean
}

/** The row an operator's settings of its work orders are kept in, one per operator. */
export interface WorkOrderSetting extends Synced, WorkOrderSettings {
  readonly id: WorkOrderSettingId
}

/** The settings of an operator that has set none. */
export const defaultWorkOrderSettings: WorkOrderSettings = { namesAndTimes: false }

/** What is wrong with the settings of the work orders, one sentence per field. */
export function workOrderSettingsProblems(
  settings: Readonly<Record<string, unknown>>,
): Readonly<Problems> {
  return typeof settings['namesAndTimes'] === 'boolean'
    ? {}
    : { namesAndTimes: 'Namen und Uhrzeiten stehen auf dem Leistungsnachweis oder nicht.' }
}

/**
 * What the client sees on the device before signing, and so what the
 * signature is about. The device builds it from what it holds and the server
 * from its rows, each from the page of the work order (`SignedPage`), so that
 * both reckon the same fingerprint: the order by its key and title, the
 * place, the time spent and the notes by key and text, the name in block
 * letters and whether names and times will stand on the report. Nothing the
 * server adds afterwards is on it: no number, and none of the names, which a
 * device does not hold.
 */
export interface ServiceReportPage {
  readonly activity: { readonly id: string; readonly title: string }
  readonly place: SignedPage['place']
  readonly durationMinutes?: number
  readonly notes?: readonly SignedNote[]
  readonly clientName: string
  readonly namesAndTimes: boolean
}

/** The page of a service report from the page of its work order, the name and the setting. */
export function serviceReportPageOf(
  page: SignedPage,
  clientName: string,
  namesAndTimes: boolean,
): ServiceReportPage {
  return {
    activity: { id: page.activity.id, title: page.activity.title },
    place: page.place,
    ...(page.durationMinutes === undefined ? {} : { durationMinutes: page.durationMinutes }),
    ...(page.notes === undefined ? {} : { notes: page.notes }),
    clientName: clientName.trim(),
    namesAndTimes,
  }
}

/**
 * What is wrong with a service report as it arrives, one sentence per field.
 * A field that is not given is not asked about; the drawing is required,
 * since the client has no account to confirm with a typed name.
 */
export function serviceReportProblems(
  report: Readonly<Record<string, unknown>>,
): Readonly<Problems> {
  const problems: Problems = {}

  if ('clientName' in report) {
    const name = report['clientName']
    const trimmed = typeof name === 'string' ? name.trim() : ''

    if (trimmed === '') {
      problems['clientName'] = 'Der Name des Auftraggebers in Druckschrift fehlt.'
    } else if (trimmed.length > serviceReportLimits.clientName) {
      problems['clientName'] =
        `Der Name des Auftraggebers hat höchstens ${String(serviceReportLimits.clientName)} Zeichen.`
    }
  }

  if ('path' in report) {
    const path = report['path']

    if (path === null || path === undefined || path === '') {
      problems['path'] = 'Es fehlt die Unterschrift des Auftraggebers im Feld.'
    } else if (typeof path !== 'string' || !signaturePathIsValid(path)) {
      problems['path'] =
        `Die Unterschrift ist ein Linienzug im Feld, höchstens ${String(longestSignaturePath)} Zeichen.`
    }
  }

  const fingerprint = report['pageFingerprint']

  if (
    fingerprint !== undefined &&
    (typeof fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(fingerprint))
  ) {
    problems['pageFingerprint'] = 'Der Fingerabdruck der Seite sind 64 hexadezimale Ziffern.'
  }

  const deviceInfo = report['deviceInfo']

  if (
    deviceInfo !== undefined &&
    deviceInfo !== null &&
    (typeof deviceInfo !== 'string' || deviceInfo.length > serviceReportLimits.deviceInfo)
  ) {
    problems['deviceInfo'] =
      `Die Angabe zum Gerät hat höchstens ${String(serviceReportLimits.deviceInfo)} Zeichen.`
  }

  return problems
}

/**
 * Whether a service report counts (section 4.8): no rejection of its work
 * order came after it. Which came after which is told by the moment the
 * server took each in (`createdAt`), as for a signature, and not by the clock
 * of a device. One that does not count stays standing and readable.
 */
export function serviceReportValid(
  report: { readonly createdAt: Date },
  decisions: readonly Pick<WorkOrderDecision, 'decision' | 'createdAt'>[],
): boolean {
  return !decisions.some(
    (decision) =>
      decision.decision === 'rejected' &&
      decision.createdAt.getTime() >= report.createdAt.getTime(),
  )
}

/** The rejection that made a service report invalid, the first after it, or null while it counts. */
export function serviceReportVoidedBy<
  Decision extends Pick<WorkOrderDecision, 'decision' | 'createdAt'>,
>(report: { readonly createdAt: Date }, decisions: readonly Decision[]): Decision | null {
  return (
    [...decisions]
      .filter(
        (decision) =>
          decision.decision === 'rejected' &&
          decision.createdAt.getTime() >= report.createdAt.getTime(),
      )
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())[0] ?? null
  )
}

/** The number of the newest shape of the frozen state of a service report. */
export const serviceReportStateVersion = 1

/**
 * A note as the report states it: what it says, and only where the operator
 * has switched names and times on, who wrote it and when by the clock of the
 * device.
 */
export interface StatedWork {
  readonly text: string
  readonly writtenAt?: string
  readonly writtenBy?: string
}

/**
 * The frozen state of a service report (2.6, #324), written by the server
 * when it takes the client's signature, in the same transaction, and read by
 * the PDF ever after; never the current records. It carries no price, and
 * names and times of the people who did the work only where the operator has
 * switched them on: then the work names who wrote each note and when, and
 * the client's signature its time; otherwise the day only.
 */
export interface ServiceReportState {
  readonly version: typeof serviceReportStateVersion
  readonly workOrder: {
    readonly number: string | null
    readonly kind: WorkOrderKind
    readonly title: string
  }
  readonly place: StatedPlace
  readonly work: readonly StatedWork[]
  readonly durationMinutes: number | null
  readonly client: {
    readonly name: string
    readonly path: string
    /** The day the client signed, in Germany. */
    readonly signedOn: IsoDate
    /** The moment, as an ISO 8601 text in UTC, only with names and times. */
    readonly signedAt?: string
  }
  readonly namesAndTimes: boolean
  /** The name of the account that held the device; its signature covers the page (2.6). */
  readonly holder: string
  readonly pageFingerprint: string
}

/**
 * The frozen state of a service report as its row carries it, with the
 * fingerprint over it. Written once and never changed.
 */
export interface ServiceReportRecord extends Omit<TenantOwned, 'updatedAt'> {
  readonly id: ServiceReportRecordId
  readonly propertyId: PropertyId
  readonly areaId: AreaId
  readonly serviceReportId: ServiceReportId
  readonly state: ServiceReportState
  readonly fingerprint: string
  readonly createdAt: Date
}

/**
 * A service report as the page of its work order shows it: whose name, when,
 * on whose device, and whether it counts; one that does not names the day of
 * the rejection that made it invalid.
 */
export interface ServiceReportLine {
  readonly id: ServiceReportId
  readonly clientName: string
  readonly signedAt: string
  /** The account that held the device. */
  readonly holder: string
  readonly valid: boolean
  /** When the rejection that made it invalid was decided; null while it counts. */
  readonly voidedAt: string | null
}
