import type { IsoDate } from '@opengewerk/platform-domain'

import type {
  ActivityId,
  ActivityStatus,
  WorkOrderId,
  WorkOrderKind,
  WorkOrderPlan,
  WorkOrderUrgency,
} from './activity.js'
import type { AssetId } from './asset.js'
import type { DefectId } from './defect.js'
import type { DutyId } from './duty-record.js'
import type { DutyPerson } from './duty-register.js'
import type { BuildingId, PropertyId, RoomId } from './location.js'
import type { SignatureRole, WorkOrderDecisionKind } from './signature.js'
import type { PlaceTarget } from './target.js'

/**
 * The list "Aufträge", the page of a work order and a new one in the office
 * (section 4.8 of the concept, #117). What the server answers and the office
 * reads.
 *
 * Whoever plans and hands out work sees every work order in their areas.
 * Whoever only performs sees the ones they answer for, perform or work on,
 * and those given to nobody, as their device holds them.
 */

/**
 * What the list is narrowed to under "Stand": what is open (not yet accepted,
 * also signed and waiting), what waits for its acceptance, what is accepted,
 * or everything.
 */
export const workOrderListStates = ['open', 'waiting', 'accepted', 'all'] as const

export type WorkOrderListState = (typeof workOrderListStates)[number]

export const workOrderListStateLabel: Readonly<Record<WorkOrderListState, string>> = {
  open: 'Offen',
  waiting: 'Wartet auf Abnahme',
  accepted: 'Abgenommen',
  all: 'Alle',
}

/** The states of the activity of a work order each choice of the list holds. */
export const workOrderListStatuses: Readonly<
  Record<WorkOrderListState, readonly ActivityStatus[] | null>
> = {
  open: ['open', 'started', 'signed'],
  waiting: ['signed'],
  accepted: ['done'],
  all: null,
}

/** How many work orders a page holds, and how many one may ask for at most. */
export const workOrderListPage = { size: 50, most: 200 } as const

/**
 * What the list may be narrowed to besides its state, each one a part of the
 * address. There is no narrowing to a person: a list of what somebody worked
 * on would count their work (sections 4.16 and 9 of the concept).
 */
export interface WorkOrderListFilter {
  readonly kind?: WorkOrderKind
  readonly areaId?: string
  /** A part of the title or the number of the order, or of the name of its property. */
  readonly search?: string
}

/**
 * A work order as the list shows it: its number, what it is and where, how
 * urgent, the day it is due on, who answers for it, and how far it is. A
 * work order turned back at its acceptance is begun again, and says so until
 * it is signed anew.
 */
export interface WorkOrderEntry extends PlaceTarget {
  /** The activity of the order, by which it is addressed: everything of it hangs on its activity. */
  readonly id: ActivityId
  readonly workOrderId: WorkOrderId
  readonly number: string | null
  readonly title: string
  readonly kind: WorkOrderKind
  readonly urgency: WorkOrderUrgency
  readonly status: ActivityStatus
  /** Whether the last decision on it turned it back and it was not signed since. */
  readonly rejected: boolean
  readonly dueOn: IsoDate | null
  readonly responsible: DutyPerson | null
}

/**
 * A page of the list, with how many pass the filters, how many of those wait
 * for their acceptance, and whether a further page follows.
 */
export interface WorkOrderList {
  readonly total: number
  readonly waiting: number
  readonly more: boolean
  readonly orders: readonly WorkOrderEntry[]
}

/**
 * Where a work order came from, and what the page names of it: the defect
 * with what was noticed and when, the duty with its title and the due day it
 * was made for, or nothing for one made by hand. A fault report comes with
 * phase 2.
 */
export type WorkOrderOrigin =
  | {
      readonly kind: 'defect'
      readonly defectId: DefectId
      readonly description: string
      readonly foundOn: IsoDate
    }
  | {
      readonly kind: 'duty'
      readonly dutyId: DutyId
      readonly title: string
    }
  | { readonly kind: 'hand' }

/** A signature on a work order as its page shows it: who, when, as what, and whether it counts. */
export interface WorkOrderSignatureLine {
  readonly name: string
  readonly role: SignatureRole
  readonly signedAt: string
  readonly deviceInfo: string | null
  /** The drawing, as a path in the units of `signatureBox` of the foundation. */
  readonly path: string
  /** Whether it counts: no rejection came after it, and the page is the one it was given for. */
  readonly valid: boolean
}

/** A decision on a work order as its page shows it, the latest last. */
export interface WorkOrderDecisionLine {
  readonly decision: WorkOrderDecisionKind
  readonly reason: string | null
  readonly decidedAt: string
  readonly name: string
}

/**
 * The page of a work order: what the list says, where it came from, the
 * further people who work on it, when it was made and performed or why it
 * was not, its signatures and the decisions on it.
 */
export interface WorkOrderDetails extends WorkOrderEntry {
  readonly createdAt: string
  readonly performedOn: IsoDate | null
  /** Why it was not performed; only an order closed with the reason (v0.19 of the concept). */
  readonly closingReason: string | null
  readonly origin: WorkOrderOrigin
  readonly participants: readonly DutyPerson[]
  readonly signatures: readonly WorkOrderSignatureLine[]
  readonly decisions: readonly WorkOrderDecisionLine[]
}

/**
 * Who may be named on a work order of a place: the people who perform
 * activities, see the area and are not shut out. The person who answers for
 * it and the further people are chosen from them. The name and nothing else
 * of a person.
 */
export interface WorkOrderCandidates {
  readonly people: readonly DutyPerson[]
}

/**
 * A new work order as the office sends it (#117): the plan, and where it
 * comes from. One from a defect takes the place of the defect, one for a due
 * day the place of the duty; one made by hand names its place.
 */
export type NewWorkOrder = WorkOrderPlan &
  (
    | { readonly origin: 'defect'; readonly defectId: DefectId }
    | { readonly origin: 'duty'; readonly dutyId: DutyId }
    | {
        readonly origin: 'hand'
        readonly propertyId: PropertyId
        readonly buildingId: BuildingId | null
        readonly roomId: RoomId | null
        readonly assetId: AssetId | null
      }
  )

/** Where a new work order may come from in the office, in the order the form offers them. */
export const workOrderOrigins = ['defect', 'duty', 'hand'] as const

export type WorkOrderOriginKind = (typeof workOrderOrigins)[number]

export const workOrderOriginLabel: Readonly<Record<WorkOrderOriginKind, string>> = {
  defect: 'Aus einem Mangel',
  duty: 'Aus einem Termin',
  hand: 'Von Hand',
}
