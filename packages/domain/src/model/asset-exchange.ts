import type { IsoDate } from '@opengewerk/platform-domain'

import type { Activity } from './activity.js'
import type { LifecycleEntry } from './asset.js'
import type { Defect } from './defect.js'
import type { Duty } from './duty-record.js'
import { calendarDay, type Problems } from './fields.js'

/**
 * The exchange of an asset (section 4.2 of the concept, #89): the old one is
 * removed from a day on, a new one stands where it stood and supplies what it
 * supplied, with a number of its own. What is open at the old one ends with
 * it: its duties end, a defect nobody set right yet counts as remedied, and
 * an activity that is open or begun is closed as not performed, with the
 * exchange as the reason. Nothing moves to the new asset by itself. Its
 * duties are proposed anew by the catalogue; a duty the operator made himself
 * may be taken over, and so may single components.
 *
 * What was recorded at the old asset stays with it and as it is.
 */

/** How many components, and how many duties of the operator's own, one exchange takes along. */
export const exchangeLimits = { components: 200, duties: 100 } as const

const idShape = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

/** Whether a value is a list of ids, each once and no more than `most`. A list left out is none. */
function listOfIds(value: unknown, most: number): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.length <= most &&
      value.every((each) => typeof each === 'string' && idShape.test(each)) &&
      new Set(value).size === value.length)
  )
}

/**
 * What is wrong with what an exchange says beside the new asset, one sentence
 * per field: the day, which is today or a day before it, since an exchange is
 * entered once it happened and ends what was open, and the components and
 * duties that go along.
 */
export function exchangeProblems(
  exchange: Readonly<Record<string, unknown>>,
  today: IsoDate,
): Readonly<Problems> {
  const problems: Problems = {}
  const on = exchange['on']

  if (!calendarDay(on)) {
    problems['on'] = 'Der Tag des Tauschs fehlt oder ist keiner.'
    // ISO dates sort the same way as the days they name.
  } else if (on > today) {
    problems['on'] =
      'Der Tag des Tauschs ist heute oder ein Tag davor: eingetragen wird ein Tausch, der stattgefunden hat.'
  }

  if (!listOfIds(exchange['components'], exchangeLimits.components)) {
    problems['components'] =
      `Die Komponenten, die mitgehen, stehen als Liste von höchstens ${String(exchangeLimits.components)} Anlagen.`
  }

  if (!listOfIds(exchange['duties'], exchangeLimits.duties)) {
    problems['duties'] =
      `Die eigenen Pflichten, die übernommen werden, stehen als Liste von höchstens ${String(exchangeLimits.duties)} Pflichten.`
  }

  return problems
}

export const exchangeRefusals = {
  replaced: 'Diese Anlage ist schon getauscht.',
  meter:
    'Ein Zähler wird an seiner Messstelle getauscht, mit „Zählertausch“: die Messstelle und ihre Stände bleiben.',
  removed: 'Diese Anlage ist schon zurückgebaut.',
  dayTaken:
    'An diesem Tag hat die Anlage schon einen Zustand; auf einen Tag kommt einer. Den Eintrag zurücknehmen oder einen anderen Tag des Tauschs wählen.',
  laterEntry:
    'Im Lebenszyklus der Anlage steht schon ein Eintrag nach diesem Tag; mit dem Tausch endet er.',
  newMeter:
    'Die neue Anlage ist keine Messstelle: ein Zähler kommt mit „Zählertausch“ an die Messstelle, die es schon gibt.',
} as const

/**
 * Why an asset is not exchanged on a day, or null. An asset is replaced once.
 * A measuring point keeps its readings over every meter that hangs there, so
 * its meter is exchanged at the point and not as an asset (section 4.9). And
 * the exchange is the last entry of a life cycle: an asset removed by the day
 * is gone already, a day holds one state, and an entry after the day would
 * bring a removed asset back.
 */
export function exchangeRefusal(
  asset: {
    readonly lifecycle: readonly Pick<LifecycleEntry, 'state' | 'validFrom'>[]
    /** Whether its kind is a measuring point. */
    readonly meter: boolean
    /** Whether another asset took its place already. */
    readonly replaced: boolean
  },
  on: IsoDate,
): string | null {
  if (asset.replaced) {
    return exchangeRefusals.replaced
  }

  if (asset.meter) {
    return exchangeRefusals.meter
  }

  // ISO dates sort the same way as the days they name.
  const standing = asset.lifecycle
    .filter((entry) => entry.validFrom <= on)
    .sort((left, right) => right.validFrom.localeCompare(left.validFrom))
    .at(0)

  if (standing?.state === 'removed') {
    return exchangeRefusals.removed
  }

  if (asset.lifecycle.some((entry) => entry.validFrom === on)) {
    return exchangeRefusals.dayTaken
  }

  if (asset.lifecycle.some((entry) => entry.validFrom > on)) {
    return exchangeRefusals.laterEntry
  }

  return null
}

/**
 * Why a duty of the exchanged asset ended and an activity at it was not
 * performed, in the words their pages show: the asset that stands there now
 * is named by its number.
 */
export function exchangeReason(successor: string): string {
  return `Die Anlage wurde getauscht, an ihrer Stelle steht ${successor}.`
}

/** A duty of the operator's own at the asset that goes, as the exchange offers it to the new one. */
export type ExchangeDuty = Pick<Duty, 'id' | 'label' | 'intervalDays' | 'intervalMonths'>

/** A defect at the asset that goes that nobody set right yet. */
export type ExchangeDefect = Pick<Defect, 'id' | 'description' | 'status'>

/** An activity at the asset that goes that is open or begun. */
export type ExchangeActivity = Pick<Activity, 'id' | 'kind' | 'title' | 'status'>

/**
 * What an exchange meets at the asset that goes, read before anybody says
 * yes: what ends with it. How many there are of each is said to whoever may
 * exchange it; each is named only to whoever reads duties, defects and
 * activities, and the lists are empty for anybody else.
 */
export interface ExchangeStanding {
  /** Its duties that have not ended: they end on the day of the exchange. */
  readonly duties: number
  /** Those of them the operator made himself, which the new asset may take over. */
  readonly ownDuties: readonly ExchangeDuty[]
  /** Its defects that are found or ordered: they count as remedied, and wait to be checked again. */
  readonly defects: number
  readonly openDefects: readonly ExchangeDefect[]
  /** The activities at it that are open or begun: closed as not performed. */
  readonly activities: number
  readonly openActivities: readonly ExchangeActivity[]
}
