import {
  type FormValues,
  type Id,
  longestSignaturePath,
  longestSignerName,
  signaturePathIsValid,
  type Synced,
} from '@opengewerk/platform-domain'

import type { ActivityId } from './activity.js'
import type { AreaId } from './area.js'
import type { ContractorId } from './contractor.js'
import type { Problems } from './fields.js'
import { type FormDefinition, forms } from './forms.js'
import type { PropertyId } from './location.js'
import { signatureLimits } from './signature.js'

/**
 * A contractor at work for the operator (section 4.11 of the concept, #330):
 * "Einsatz einer Fremdfirma: Auftrag, Einweisung vor Ort mit Unterschrift,
 * Erlaubnisschein für feuergefährliche Arbeiten als Formular, Bericht
 * hochladen."
 *
 * The visit is the work order the firm carries out, which names it from the
 * list (#328). A briefing belongs to that order and has no deadline of its
 * own (decided on 15.10.2026): whoever was briefed signs with the drawing and
 * the name in block letters on the device, as the client signs a service
 * report (4.8), and the account that holds the device stands on it. The
 * permit for hot work is a form of the package Brandschutz, filled in on the
 * same device and signed in it by whoever carries the work out; it keeps the
 * key and the version of its form, so that it is read in the version it was
 * made in. Both are written once and changed by nobody, the database
 * included.
 */

export type BriefingId = Id<'briefing'>
export type WorkPermitId = Id<'work-permit'>

/** The bounds of a briefing, the same on the device, the server and the database. */
export const briefingLimits = {
  /** The name in block letters is a name like the typed name under a signature. */
  personName: longestSignerName,
  subject: 2000,
  deviceInfo: signatureLimits.deviceInfo,
} as const

/** The bounds of a permit beside its form, the same on the device, the server and the database. */
export const workPermitLimits = {
  deviceInfo: signatureLimits.deviceInfo,
} as const

/**
 * The key of the form a permit for hot work is filled in, in the package
 * Brandschutz. Where the catalogue holds no such form, no permit is offered.
 */
export const hotWorkPermitForm = 'brandschutz.hot_work_permit'

/**
 * A briefing on site, as the device takes it and the sync carries it: whom,
 * of which firm, in what, the drawing and the moment of the device. Who held
 * the device is the person signed in, which the server writes. Written once.
 */
export interface Briefing extends Synced {
  readonly id: BriefingId
  readonly propertyId: PropertyId
  readonly areaId: AreaId
  readonly activityId: ActivityId
  /** The firm the person works for, the one the order named when the person was briefed. */
  readonly contractorId: ContractorId
  readonly personName: string
  readonly subject: string
  /** The drawing, as a path in the units of `signatureBox` of the foundation. */
  readonly path: string
  /** The account that held the device. */
  readonly signedBy: string
  /** The clock of the device at the moment the briefing was confirmed. */
  readonly signedAt: Date
  readonly deviceInfo: string | null
}

/**
 * A permit for hot work, as the device fills it in and the sync carries it:
 * the form it is filled in by its key and version and what was entered,
 * the signature of whoever carries the work out among it. Who held the
 * device, and issued the permit, is the person signed in. Written once.
 */
export interface WorkPermit extends Synced {
  readonly id: WorkPermitId
  readonly propertyId: PropertyId
  readonly areaId: AreaId
  readonly activityId: ActivityId
  readonly contractorId: ContractorId
  readonly formKey: string
  readonly formVersion: number
  readonly answers: FormValues
  readonly signedBy: string
  readonly signedAt: Date
  readonly deviceInfo: string | null
}

/**
 * Whether a person briefs at a work order and issues a permit there (decided
 * on 15.10.2026): whoever leads the order or plans and hands out work. No
 * right of its own; the device needs "Vorgänge ausführen" to send it at all.
 */
export function briefsAtWorkOrder(
  activity: { readonly responsibleUserId: string | null },
  userId: string,
  rights: readonly string[],
): boolean {
  return activity.responsibleUserId === userId || rights.includes('activity.write')
}

function deviceInfoProblem(value: unknown, longest: number): string | null {
  return value !== undefined &&
    value !== null &&
    (typeof value !== 'string' || value.length > longest)
    ? `Die Angabe zum Gerät hat höchstens ${String(longest)} Zeichen.`
    : null
}

/**
 * What is wrong with a briefing as it arrives, one sentence per field. A
 * field that is not given is not asked about; the drawing is required,
 * since the person briefed has no account to confirm with.
 */
export function briefingProblems(briefing: Readonly<Record<string, unknown>>): Readonly<Problems> {
  const problems: Problems = {}

  if ('personName' in briefing) {
    const name = briefing['personName']
    const trimmed = typeof name === 'string' ? name.trim() : ''

    if (trimmed === '') {
      problems['personName'] = 'Der Name der eingewiesenen Person in Druckschrift fehlt.'
    } else if (trimmed.length > briefingLimits.personName) {
      problems['personName'] =
        `Der Name der eingewiesenen Person hat höchstens ${String(briefingLimits.personName)} Zeichen.`
    }
  }

  if ('subject' in briefing) {
    const subject = briefing['subject']
    const trimmed = typeof subject === 'string' ? subject.trim() : ''

    if (trimmed === '') {
      problems['subject'] = 'Worin die Person eingewiesen wurde, fehlt.'
    } else if (trimmed.length > briefingLimits.subject) {
      problems['subject'] =
        `Worin die Person eingewiesen wurde, hat höchstens ${String(briefingLimits.subject)} Zeichen.`
    }
  }

  if ('path' in briefing) {
    const path = briefing['path']

    if (path === null || path === undefined || path === '') {
      problems['path'] = 'Es fehlt die Unterschrift der eingewiesenen Person im Feld.'
    } else if (typeof path !== 'string' || !signaturePathIsValid(path)) {
      problems['path'] =
        `Die Unterschrift ist ein Linienzug im Feld, höchstens ${String(longestSignaturePath)} Zeichen.`
    }
  }

  const device = deviceInfoProblem(briefing['deviceInfo'], briefingLimits.deviceInfo)

  if (device !== null) {
    problems['deviceInfo'] = device
  }

  return problems
}

/** What is wrong with the fields of a permit beside its form, one sentence per field. */
export function workPermitProblems(permit: Readonly<Record<string, unknown>>): Readonly<Problems> {
  const problems: Problems = {}
  const device = deviceInfoProblem(permit['deviceInfo'], workPermitLimits.deviceInfo)

  if (device !== null) {
    problems['deviceInfo'] = device
  }

  return problems
}

/**
 * What stands between what was entered and a permit that can be issued, in
 * the form it is filled in: a value of the wrong kind first, then every field
 * the form requires and is empty, the signature of whoever carries the work
 * out among them. Empty, it can be issued.
 */
export function permitAnswersProblems(
  definition: FormDefinition,
  answers: unknown,
): readonly string[] {
  const wrong = forms.valuesProblem(definition, answers)

  if (wrong !== null) {
    return [wrong]
  }

  return forms.sealProblems(definition, answers as FormValues)
}

/** The name of whoever signed in the first signature of a permit, the person who carries the work out. */
export function permitSignerName(definition: FormDefinition, answers: FormValues): string | null {
  for (const section of definition.sections) {
    for (const field of section.fields) {
      const value = answers[field.key] as { readonly name?: unknown } | undefined

      if (field.kind === 'signature' && typeof value?.name === 'string') {
        return value.name
      }
    }
  }

  return null
}

/** A briefing as the office reads it, at its work order and at its firm. */
export interface BriefingEntry {
  readonly id: BriefingId
  readonly activityId: ActivityId
  readonly orderNumber: string | null
  readonly orderTitle: string
  readonly contractorId: ContractorId
  readonly contractorName: string
  readonly personName: string
  readonly subject: string
  readonly path: string
  /** The name of the account that held the device. */
  readonly signedByName: string
  readonly signedAt: string
}

/**
 * A permit as the office reads it: with the form in the version it was made
 * in, whatever version the catalogue holds today, or null where the
 * catalogue of this server does not know that version.
 */
export interface WorkPermitEntry {
  readonly id: WorkPermitId
  readonly activityId: ActivityId
  readonly orderNumber: string | null
  readonly orderTitle: string
  readonly contractorId: ContractorId
  readonly contractorName: string
  readonly formKey: string
  readonly formVersion: number
  readonly form: FormDefinition | null
  readonly answers: FormValues
  /** Whoever carries the work out, as signed in the form. */
  readonly signerName: string | null
  readonly signedByName: string
  readonly signedAt: string
}

/** The briefings and permits of a work order or of a firm, the latest first. */
export interface ContractorVisits {
  readonly briefings: readonly BriefingEntry[]
  readonly permits: readonly WorkPermitEntry[]
}
