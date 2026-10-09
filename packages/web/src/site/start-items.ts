import {
  addDays,
  type IsoDate,
  monthLabel,
  type RecordState,
  weekdayLabel,
  weekdayOf,
  weekOf,
} from '@opengewerk/haustechnik-domain'
import { count, maybeText, text } from '@opengewerk/platform-web/sync'

/**
 * What the start on site shows (#114, 4.5 and 4.8 of the concept, the board
 * "Start: heute und diese Woche"): the activities of the person who holds the
 * device, the begun ones on top, then those of today and those of this week.
 *
 * The device holds more than that: every activity of the person and every one
 * given to nobody while open, and a round two weeks ahead of its day (#113).
 * A round shows from the lead of its plan, or from the start of its week if
 * that comes first, so that the start is not a list of fourteen days; one the
 * lead shows before its week stands under "Später".
 */
export interface StartItems {
  readonly begun: readonly RecordState[]
  readonly today: readonly RecordState[]
  readonly week: readonly RecordState[]
  readonly later: readonly RecordState[]
}

export interface StartHeld {
  readonly activities: readonly RecordState[]
  /** The plans of the rounds, for the lead of each. */
  readonly plans: readonly RecordState[]
  /** Who works on which work order beside the person it is given to. */
  readonly participants: readonly RecordState[]
  /** The activities this device holds a signature of the person who did the work for. */
  readonly signed: ReadonlySet<string>
}

/** The statuses in which an activity is still to be done on site. */
const toDo = ['open', 'started']

function live(record: RecordState): boolean {
  return record['deletedAt'] === null || record['deletedAt'] === undefined
}

/**
 * Whether an activity is the person's to do: given to them, a work order they
 * work on, or one given to nobody that the operator's own people perform and
 * that nobody else answers for. One a contractor performs has its result
 * entered in the office (4.4), and one given to somebody else lies on this
 * device only because its person answers for it.
 */
export function isOwn(
  activity: RecordState,
  me: string,
  participants: readonly RecordState[],
): boolean {
  const performer = maybeText(activity, 'performerUserId')

  if (performer !== null) {
    return performer === me
  }

  if (
    participants.some(
      (each) =>
        live(each) && each['activityId'] === activity['id'] && maybeText(each, 'userId') === me,
    )
  ) {
    return true
  }

  const responsible = maybeText(activity, 'responsibleUserId')

  return (
    maybeText(activity, 'performer') !== 'contractor' &&
    (responsible === null || responsible === me)
  )
}

/** The Sunday of the week of a day. */
export function endOfWeek(day: IsoDate): IsoDate {
  return addDays(weekOf(day), 6)
}

/**
 * The day from which an activity of a later week shows on the start: the
 * lead of the plan of a round. Every other one, a round without a plan
 * among them, waits for its week.
 */
function showsFrom(activity: RecordState, dueOn: IsoDate, plans: readonly RecordState[]): IsoDate {
  const planId = maybeText(activity, 'roundPlanId')
  const plan = planId === null ? undefined : plans.find((each) => each['id'] === planId)

  return addDays(dueOn, plan === undefined ? 0 : -count(plan, 'leadDays'))
}

/** By day, one without a day after those with one, and by title within a day. */
function byDay(left: RecordState, right: RecordState): number {
  const leftDay = maybeText(left, 'dueOn') ?? '9999-12-31'
  const rightDay = maybeText(right, 'dueOn') ?? '9999-12-31'

  return leftDay === rightDay
    ? text(left, 'title').localeCompare(text(right, 'title'), 'de')
    : leftDay.localeCompare(rightDay)
}

/** The activities of the start, for the person and the day. */
export function startItems(held: StartHeld, me: string, today: IsoDate): StartItems {
  const sunday = endOfWeek(today)
  const begun: RecordState[] = []
  const now: RecordState[] = []
  const week: RecordState[] = []
  const later: RecordState[] = []

  for (const activity of held.activities) {
    const status = text(activity, 'status')

    if (
      !live(activity) ||
      !toDo.includes(status) ||
      held.signed.has(String(activity['id'])) ||
      !isOwn(activity, me, held.participants)
    ) {
      continue
    }

    const dueOn = maybeText(activity, 'dueOn') as IsoDate | null

    if (status === 'started') {
      begun.push(activity)
    } else if (dueOn === null || dueOn <= today) {
      now.push(activity)
    } else if (dueOn <= sunday) {
      week.push(activity)
    } else if (showsFrom(activity, dueOn, held.plans) <= today) {
      later.push(activity)
    }
  }

  return {
    begun: begun.sort(byDay),
    today: now.sort(byDay),
    week: week.sort(byDay),
    later: later.sort(byDay),
  }
}

/** "Montag, 5. Oktober": the day over the title of the start. */
export function longDay(day: IsoDate): string {
  const [, month, of] = day.split('-').map(Number)

  return `${weekdayLabel[weekdayOf(day)]}, ${String(of)}. ${monthLabel[(month ?? 1) - 1] ?? ''}`
}

/** "12.10.": a day of this year, short, as the cards of the start name it. */
export function shortDay(day: IsoDate): string {
  const [, month, of] = day.split('-')

  return `${of ?? ''}.${month ?? ''}.`
}
