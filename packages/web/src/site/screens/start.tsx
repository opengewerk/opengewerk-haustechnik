import {
  activityKindLabel,
  type IsoDate,
  type RecordState,
  weekdayLabel,
  weekdayOf,
  type WorkOrderUrgency,
  workOrderUrgencyLabel,
} from '@opengewerk/haustechnik-domain'
import { date, today } from '@opengewerk/platform-web/format'
import { accountQuery, useRight } from '@opengewerk/platform-web/session'
import {
  SiteLabel,
  SiteScreen,
  SiteText,
  TitleCount,
  TopTitle,
} from '@opengewerk/platform-web/site'
import {
  maybeText,
  text,
  useRecord,
  useRecords,
  useRelated,
  useSync,
  useSyncStatus,
} from '@opengewerk/platform-web/sync'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useMemo } from 'react'

import { readingStanding, useHeldMeters } from '../../app/meters.js'
import { titleOfRoom } from '../../app/place-records.js'
import { assetTitle, useAcross } from '../kit.js'
import { siteForms, siteReadings } from '../places.js'
import { endOfWeek, shortDay, startItems, longDay } from '../start-items.js'
import { RoundOverview, progressOf, useActivityForm } from './form.js'

export const startWords = {
  title: 'Start',
  thisWeek: 'diese Woche',
  today: 'Heute',
  week: 'Diese Woche',
  later: 'Später',
  nothing: 'Für heute und diese Woche liegt nichts an.',
  round: 'Rundgang',
  workOrder: 'Auftrag',
  begun: 'begonnen',
  todayWord: 'heute',
  due: (day: IsoDate) => `fällig ${shortDay(day)}`,
  open: 'offen',
  overdue: (day: IsoDate) => `Frist ${date(day)}, überschritten`,
  passed: (day: IsoDate) => `vom ${date(day)}, noch offen`,
  answered: (done: number, total: number) => `${String(done)} von ${String(total)} beantwortet`,
  onDevice: (waiting: number) =>
    waiting === 1 ? '1 Antwort auf dem Gerät' : `${String(waiting)} Antworten auf dem Gerät`,
  choose: 'Einen Rundgang aus der Liste wählen.',
  reading: (keyDate: IsoDate) => `Ablesung · Stichtag ${shortDay(keyDate)}`,
  meters: (count: number) => (count === 1 ? '1 Zähler' : `${String(count)} Zähler`),
  readingMissing: 'Stand fehlt noch',
} as const

/** The meters of a property whose reading is due by today and missing, the earliest key date first. */
interface DueReading {
  readonly propertyId: string
  readonly keyDate: IsoDate
  readonly count: number
}

/**
 * The rounds of the meters there are today (section 4.9 of the concept,
 * #120): for each property this device holds, the meters whose key date has
 * come and that have no reading for it, leaving out a locked one and one
 * that rests. Worked out from what the device holds, also without a network.
 */
function useDueReadings(day: IsoDate): readonly DueReading[] {
  const held = useHeldMeters()
  const reads = useRight('reading.write')

  return useMemo(() => {
    if (!reads) {
      return []
    }

    const due = new Map<string, { keyDate: IsoDate; count: number }>()

    for (const meter of held.values()) {
      const standing = readingStanding(meter, day)

      if (meter.lockReason !== null || standing.rests || standing.taken || standing.keyDate > day) {
        continue
      }

      const propertyId = String(meter.asset['propertyId'])
      const before = due.get(propertyId)

      due.set(propertyId, {
        keyDate:
          before === undefined || standing.keyDate < before.keyDate
            ? standing.keyDate
            : before.keyDate,
        count: (before?.count ?? 0) + 1,
      })
    }

    return [...due.entries()].map(([propertyId, found]) => ({ propertyId, ...found }))
  }, [held, reads, day])
}

/** The round of the meters of a property, a card as the board draws it: what, where, how many. */
function ReadingCard({ due }: { readonly due: DueReading }) {
  const property = useRecord('properties', due.propertyId)

  return (
    <Link
      to={siteReadings.round(due.propertyId)}
      className="block rounded-[6px] border border-l-4 border-line border-l-control bg-surface py-[11px] pr-3.5 pl-4 text-ink no-underline"
    >
      <p className="font-condensed text-[14px] font-semibold tracking-[0.9px] text-ink-faint uppercase">
        {startWords.reading(due.keyDate)}
      </p>
      <p className="mt-px text-[18px] leading-[1.25] font-bold [overflow-wrap:anywhere]">
        {property === null ? '' : text(property, 'name')}
      </p>
      <p className="mt-0.5 text-[15px] text-ink-muted">{startWords.meters(due.count)}</p>
      <p className="mt-0.5 text-[15px] text-ink-muted">{startWords.readingMissing}</p>
    </Link>
  )
}

/** "Rundgang · Mittwoch", "Auftrag AU-2026-0031 · dringend", "Prüfung · fällig 12.10.": over the title of a card. */
function overOf(activity: RecordState, workOrder: RecordState | undefined, day: IsoDate): string {
  const kind = text(activity, 'kind')
  const begun = text(activity, 'status') === 'started'
  const dueOn = maybeText(activity, 'dueOn') as IsoDate | null

  if (kind === 'work_order') {
    const urgency = maybeText(workOrder, 'urgency') as WorkOrderUrgency | null
    const head = [startWords.workOrder, maybeText(workOrder, 'number')].filter(Boolean).join(' ')
    const tail = begun
      ? startWords.begun
      : urgency !== null && urgency !== 'normal'
        ? workOrderUrgencyLabel[urgency]
        : null

    return tail === null ? head : `${head} · ${tail}`
  }

  if (kind === 'round') {
    const when = begun
      ? startWords.begun
      : dueOn === null
        ? null
        : dueOn === day
          ? startWords.todayWord
          : dueOn > day && dueOn <= endOfWeek(day)
            ? weekdayLabel[weekdayOf(dueOn)]
            : `${weekdayLabel[weekdayOf(dueOn)]}, ${shortDay(dueOn)}`

    return when === null ? startWords.round : `${startWords.round} · ${when}`
  }

  const label = activityKindLabel[kind as keyof typeof activityKindLabel]
  const when = begun ? startWords.begun : dueOn === null ? null : startWords.due(dueOn)

  return when === null ? label : `${label} · ${when}`
}

/**
 * Where an activity is, in a line: the property and the building of a round,
 * the building and the room or the asset of what is done there.
 */
function usePlaceLine(activity: RecordState): string {
  const property = useRecord('properties', maybeText(activity, 'propertyId') ?? undefined)
  const building = useRecord('buildings', maybeText(activity, 'buildingId') ?? undefined)
  const room = useRecord('rooms', maybeText(activity, 'roomId') ?? undefined)
  const asset = useRecord('assets', maybeText(activity, 'assetId') ?? undefined)
  const house = useRecord('buildings', maybeText(asset ?? room, 'buildingId') ?? undefined)
  const near = maybeText(house, 'name') ?? maybeText(property, 'name')

  if (asset) {
    return [near, assetTitle(asset)].filter(Boolean).join(', ')
  }

  if (room) {
    return [near, `Raum ${titleOfRoom(room)}`].filter(Boolean).join(', ')
  }

  return [maybeText(property, 'name'), maybeText(building, 'name')].filter(Boolean).join(', ')
}

/** How far a begun activity is: its points answered, and what of that is still only on this device. */
function BegunMeta({ activityId }: { readonly activityId: string }) {
  const client = useSync()
  const { online } = useSyncStatus()
  const form = useActivityForm(activityId, [])

  if (!form.definition || form.context === null) {
    return <p className="mt-0.5 text-[15px] text-ink-muted">{startWords.begun}</p>
  }

  const progress = progressOf(form.points, form.answers)
  const waiting = form.answers.filter((answer) =>
    client.isPending('activity_answers', String(answer['id'])),
  ).length
  const share = progress.total === 0 ? 0 : Math.round((100 * progress.done) / progress.total)

  return (
    <>
      <p
        className={`mt-0.5 text-[15px] ${!online && waiting > 0 ? 'font-semibold text-waiting' : 'text-ink-muted'}`}
      >
        {[
          startWords.answered(progress.done, progress.total),
          !online && waiting > 0 ? startWords.onDevice(waiting) : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
      <div
        aria-hidden="true"
        className="mt-2 h-1.5 overflow-hidden rounded-[3px] bg-surface-sunken"
      >
        <div className="h-full bg-copper" style={{ width: `${String(share)}%` }} />
      </div>
    </>
  )
}

/**
 * One thing to do, `item_card()` of the board: what and when over its title,
 * where, and how far it is; the whole card leads to it. A begun one has the
 * edge in copper; one past its day says so in the colour of a conflict.
 */
function StartCard({
  activity,
  day,
  selected,
}: {
  readonly activity: RecordState
  readonly day: IsoDate
  readonly selected: boolean
}) {
  const id = String(activity['id'])
  const workOrder = useRelated('work_orders', 'activityId', id)[0]
  const place = usePlaceLine(activity)
  const begun = text(activity, 'status') === 'started'
  const dueOn = maybeText(activity, 'dueOn') as IsoDate | null
  const late = !begun && dueOn !== null && dueOn < day

  return (
    <Link
      to={siteForms.form(id)}
      aria-current={selected ? 'page' : undefined}
      className={`block rounded-[6px] border border-l-4 border-line bg-surface py-[11px] pr-3.5 pl-4 text-ink no-underline ${
        begun ? 'border-l-copper' : 'border-l-control'
      } ${selected ? 'ring-2 ring-ink' : ''}`}
    >
      <p className="font-condensed text-[14px] font-semibold tracking-[0.9px] text-ink-faint uppercase">
        {overOf(activity, workOrder, day)}
      </p>
      <p className="mt-px text-[18px] leading-[1.25] font-bold [overflow-wrap:anywhere]">
        {text(activity, 'title')}
      </p>
      {place === '' ? null : <p className="mt-0.5 text-[15px] text-ink-muted">{place}</p>}
      {begun ? (
        <BegunMeta activityId={id} />
      ) : late && dueOn !== null ? (
        <p className="mt-0.5 text-[15px] font-semibold text-conflict">
          {text(activity, 'kind') === 'round'
            ? startWords.passed(dueOn)
            : startWords.overdue(dueOn)}
        </p>
      ) : (
        <p className="mt-0.5 text-[15px] text-ink-muted">{startWords.open}</p>
      )}
    </Link>
  )
}

/** The activities of the start for whoever is signed in on this device, worked out from what it holds. */
function useStartItems() {
  const me = useQuery(accountQuery).data?.userId ?? ''
  const activities = useRecords('activities')
  const plans = useRecords('round_plans')
  const participants = useRecords('work_order_participants')
  const signatures = useRecords('activity_signatures')
  const day = today() as IsoDate

  return {
    day,
    items: useMemo(
      () =>
        startItems(
          {
            activities,
            plans,
            participants,
            signed: new Set(
              signatures
                .filter((each) => each['role'] === 'signer')
                .map((each) => String(each['activityId'])),
            ),
          },
          me,
          day,
        ),
      [activities, plans, participants, signatures, me, day],
    ),
  }
}

/** The list of the start, the left of the two on a tablet held across. */
function StartList({ selected }: { readonly selected: string | null }) {
  const { day, items } = useStartItems()
  const readings = useDueReadings(day)
  const counted = items.begun.length + items.today.length + readings.length + items.week.length
  const cards = (list: readonly RecordState[]) =>
    list.map((activity) => (
      <StartCard
        key={String(activity['id'])}
        activity={activity}
        day={day}
        selected={selected === activity['id']}
      />
    ))
  const section = (label: string, list: readonly RecordState[]) =>
    list.length === 0 ? null : (
      <section aria-label={label} className="flex flex-col gap-2">
        <SiteLabel>{label}</SiteLabel>
        {cards(list)}
      </section>
    )

  return (
    <SiteScreen gap={10}>
      <TopTitle
        over={longDay(day)}
        title={startWords.title}
        right={<TitleCount count={counted} label={startWords.thisWeek} />}
      />
      {cards(items.begun)}
      {items.today.length + readings.length === 0 ? null : (
        <section aria-label={startWords.today} className="flex flex-col gap-2">
          <SiteLabel>{startWords.today}</SiteLabel>
          {cards(items.today)}
          {readings.map((due) => (
            <ReadingCard key={due.propertyId} due={due} />
          ))}
        </section>
      )}
      {section(startWords.week, items.week)}
      {section(startWords.later, items.later)}
      {counted + items.later.length === 0 ? <SiteText muted>{startWords.nothing}</SiteText> : null}
    </SiteScreen>
  )
}

/** The round the pane of a tablet shows when none is chosen: the begun one, else the next. */
function useFirstRound(): string | null {
  const { items } = useStartItems()
  const first = [...items.begun, ...items.today, ...items.week, ...items.later].find(
    (activity) => text(activity, 'kind') === 'round',
  )

  return first === undefined ? null : String(first['id'])
}

/**
 * The start on site, the board "Start: heute und diese Woche (4.5, 4.8)":
 * the day, how much there is this week, the begun activity on top, then what
 * is due today, with what is past its day, and the rest of the week. Without
 * a network nothing changes here: the frame says what waits, and a begun
 * round how many of its answers are still only on this device.
 *
 * On a tablet held across the list and a round stand side by side, the board
 * "Tablet quer: Liste und Rundgang (10)": the chosen one, else the begun one
 * or the next. `selected` is the round of the address the pane shows.
 */
export function SiteStartScreen({ selected }: { readonly selected?: string } = {}) {
  const across = useAcross()
  const first = useFirstRound()

  if (!across) {
    return <StartList selected={null} />
  }

  const shown = selected ?? first

  return (
    <div className="flex min-h-full">
      <div className="w-[380px] shrink-0">
        <StartList selected={shown} />
      </div>
      <div className="min-w-0 grow border-l border-line">
        {shown === null ? (
          <SiteScreen>
            <SiteText muted>{startWords.choose}</SiteText>
          </SiteScreen>
        ) : (
          <RoundOverview key={shown} activityId={shown} pane />
        )}
      </div>
    </div>
  )
}
