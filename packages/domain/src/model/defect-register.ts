import type { IsoDate } from '@opengewerk/platform-domain'

import type { ActivityKind, ActivityStatus } from './activity.js'
import type { Defect } from './defect.js'

/**
 * The list "Mängel" of the office (section 4.6 of the concept, #116): the
 * defects in the areas of the person asking, narrowed and cut into pages on
 * the server like the registers of assets and duties.
 */

/**
 * The lists of the register. Open is a defect until it was checked again
 * ("Offen ist ein Mangel, bis er nachgeprüft ist"); over its deadline is one
 * that waits to be set right past the day it was to be by.
 */
export const defectRegisterStates = ['open', 'overdue', 'verified', 'all'] as const

export type DefectRegisterState = (typeof defectRegisterStates)[number]

export const defectRegisterStateLabel: Readonly<Record<DefectRegisterState, string>> = {
  open: 'Offen',
  overdue: 'Über der Frist',
  verified: 'Nachgeprüft',
  all: 'Alle',
}

/** The value of the filter for the defects nobody has given a class yet. */
export const withoutClass = 'none'

/** What the register is asked for. Every part narrows, and two together give what passes both. */
export interface DefectRegisterFilter {
  readonly state?: DefectRegisterState
  readonly propertyId?: string
  readonly areaId?: string
  /** A room: the defects at it and at the assets that stand in it. */
  readonly roomId?: string
  readonly assetId?: string
  /** The key of a class, `<package>.<key>`, or `none` for the defects without one. */
  readonly defectClass?: string
}

/** The names of the filters as an address carries them to the server, in the order it reads them. */
export const defectRegisterFilters = [
  'state',
  'propertyId',
  'areaId',
  'roomId',
  'assetId',
  'defectClass',
] as const satisfies readonly (keyof DefectRegisterFilter)[]

/** How many defects a page holds, and the most a page may be asked for. */
export const defectRegisterPage = { size: 50, most: 200 } as const

/**
 * Where a defect comes from (section 4.6): an activity it was noticed in, a
 * round, a test or a work order; the report of a contractor (#110); or by
 * hand. Fault reports come in phase 2.
 */
export type DefectOrigin =
  | { readonly kind: 'hand' }
  | {
      readonly kind: 'activity'
      readonly activityId: string
      readonly activityKind: ActivityKind
      readonly title: string
    }
  | { readonly kind: 'report'; readonly evidenceId: string; readonly dutyId: string }

/** What a defect hangs on, by the names a row shows. */
export interface DefectPlace {
  readonly propertyId: string
  readonly propertyName: string
  /** The building it hangs on, or the one its room or asset stands in. */
  readonly buildingId: string | null
  readonly buildingName: string | null
  /** The room it hangs on, or the one its asset stands in. */
  readonly roomId: string | null
  readonly roomLabel: string | null
  readonly asset: {
    readonly id: string
    readonly number: string | null
    readonly name: string
  } | null
}

/** The work order that sets a defect right, as its row and its page name it. */
export interface DefectWorkOrder {
  readonly activityId: string
  readonly number: string | null
  readonly title: string
  readonly status: ActivityStatus
  /** The day it was performed, once it is signed. */
  readonly performedOn: IsoDate | null
}

/** A defect as the register lists it: what it is, how it stands, where it is and where it comes from. */
export interface DefectEntry extends Pick<
  Defect,
  'id' | 'description' | 'defectClass' | 'foundOn' | 'dueOn' | 'status'
> {
  /** Whether it waits to be set right past the day it was to be by, today. */
  readonly overdue: boolean
  readonly origin: DefectOrigin
  readonly place: DefectPlace
  readonly workOrder: DefectWorkOrder | null
}

/** How many defects are open and how many of them are over their deadline, in the areas of the person asking. */
export interface DefectSummary {
  readonly open: number
  readonly overdue: number
}

/** A page of the register, with how much there is behind it. */
export interface DefectRegister {
  /** How many defects pass the filters. */
  readonly total: number
  /** How many there are in each list, whatever list the page is narrowed to. */
  readonly counts: Readonly<Record<Exclude<DefectRegisterState, 'all'>, number>>
  readonly more: boolean
  readonly defects: readonly DefectEntry[]
}

/**
 * The page of one defect: its row, what was found when it was last checked
 * again, and for whoever keeps defects the classes it may take, with the
 * default of each, in the order they are offered.
 */
export interface DefectReading
  extends DefectEntry, Pick<Defect, 'areaId' | 'checkedOn' | 'checkNote'> {
  readonly classChoices: readonly DefectClassChoice[]
}

/** A class a defect may take, by its word, and the days its default gives, if the operator set one. */
export interface DefectClassChoice {
  readonly key: string
  readonly label: string
  readonly dueDays: number | null
}

/**
 * A class of a package as the settings list it (section 4.6): its word, the
 * package it comes from, whether a defect of it makes an asset unsafe, and the
 * default the operator set, if any.
 */
export interface DefectClassSetting {
  readonly key: string
  readonly label: string
  readonly unsafe: boolean
  readonly packageName: string
  readonly packageTitle: string
  readonly dueDays: number | null
}
