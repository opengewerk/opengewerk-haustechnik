import {
  addDays,
  type Catalogue,
  closureOn,
  type DutyPerson,
  type FederalState,
  hasHolidays,
  holidayClosures,
  holidaysBetween,
  type IsoDate,
  isPassDay,
  monthLabel,
  passSearchDays,
  type PlanCalendar,
  planLimits,
  planProblems,
  type PlanRhythm,
  planRhythmLabel,
  planRhythms,
  type PlanState,
  planStateOn,
  type RecordState,
  rhythmText,
  ruleScopeNames,
  type Weekday,
  weekdayLabel,
  weekdayOf,
  weekdays,
  weekdayShort,
} from '@opengewerk/haustechnik-domain'
import {
  Button,
  Cell,
  Choice,
  Column,
  Dialog,
  DialogActions,
  Field,
  Panel,
  PanelLabel,
  SelectField,
  Status,
  type StatusTone,
  TablePanel,
} from '@opengewerk/platform-web'
import { date, today } from '@opengewerk/platform-web/format'
import { ChangesButton, Empty, NoteBox, PageHead, Screen } from '@opengewerk/platform-web/office'
import { useRight } from '@opengewerk/platform-web/session'
import {
  count,
  flag,
  maybeText,
  refusalFor,
  request,
  text,
  useRecords,
  useSync,
  useSyncStatus,
} from '@opengewerk/platform-web/sync'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { Check, Pause, Play, Plus, Square } from 'lucide-react'
import { type FormEvent, useMemo, useState } from 'react'

import { areaName, useAreas } from '../../session/areas.js'
import { useCatalogue } from '../../sync/catalogue.js'
import { askAt, makeAt } from '../../sync/made-at.js'
import { planListPlace, planPlaces, roundsPlace } from '../round-template-addresses.js'
import { useTemplateVersions } from './round-templates.js'

/**
 * The plans of the rounds (#113, section 4.5 of the concept), as `plaene()`,
 * `plan()`, `plan_ansicht()` and `plan_beenden()` of the boards draw them:
 * the list, a new plan, a plan that runs with resting and ending it.
 *
 * A plan is read out of the sync like on a device; it is made and changed by
 * whoever plans and hands out work (section 7), with a connection, at the
 * route of the server, which makes its rounds at once.
 */

export const planWords = {
  none: 'Noch gibt es keinen Plan. Ein Plan sagt, wann welcher Rundgang fällig ist, an welchem Ort und für wen.',
  stays:
    'Ein Plan endet oder ruht; seine Rundgänge bleiben. In den Schließzeiten eines Gebäudes entsteht kein Rundgang.',
  newSub: 'Wann welcher Rundgang fällig ist, an welchem Ort und für wen',
  templateHint: 'Jeder neue Rundgang nimmt die neueste Fassung.',
  placeHint: 'Eine Liegenschaft oder ein Gebäude darin.',
  placeStays: 'Der Ort eines Plans bleibt. Für einen anderen Ort legen Sie einen neuen Plan an.',
  otherDays: 'An den anderen Tagen entsteht kein Rundgang.',
  holidays: 'Gesetzliche Feiertage auslassen',
  holidaysHint: (state: string) =>
    `Feiertage in ${state}. Ein Durchgang an einem Feiertag fällt aus und wird nicht verschoben.`,
  holiday: (name: string) => `${name}, Feiertag`,
  dayHint: 'In einem kürzeren Monat am letzten Tag.',
  leadHint: `So viele Tage vorher steht der Rundgang vor Ort unter „Start“, höchstens ${String(planLimits.leadDays)}.`,
  endsHint: 'Leer: Der Plan läuft weiter.',
  personHint:
    'Zur Wahl steht, wer Vorgänge ausführt und den Bereich sieht. Einzelne Rundgänge teilen Sie unter „Rundgänge“ anders zu.',
  everybody: (area: string | null) =>
    `Jeder Rundgang liegt auf den Geräten aller im Bereich${area ? ` ${area}` : ''}, die Vorgänge ausführen. Wer ihn beginnt, geht ihn.`,
  passesNew:
    'Jeder Durchgang ist ein eigener Rundgang mit eigener Unterschrift. In den Schließzeiten des Gebäudes entsteht keiner.',
  passesChange:
    'Eine Änderung gilt für die Rundgänge ab heute, die noch niemand begonnen hat. Was schon gegangen ist, bleibt.',
  shorter:
    'Was in kürzerem Abstand zu belegen ist, etwa eine Spülung nach spätestens 72 Stunden, ist eine eigene Pflicht mit eigenem Nachweis, kein schnellerer Rhythmus dieses Plans.',
  noTemplate: 'Die Vorlage fehlt.',
  noPlace: 'Der Ort fehlt.',
  noPerson: 'Die Person fehlt. Oder wählen Sie „Alle im Bereich“.',
  offline:
    'Ohne Verbindung lässt sich ein Plan nicht speichern. Er ist gleich wieder da, wenn das Gerät verbunden ist.',
  endSub:
    'Rundgänge nach diesem Tag, die noch niemand begonnen hat, entfallen. Was schon gegangen oder begonnen ist, bleibt, und der Plan bleibt lesbar.',
  ended:
    'Dieser Plan ist beendet und bleibt, wie er war. Für neue Rundgänge legen Sie einen neuen Plan an.',
  missing: 'Diesen Plan gibt es nicht oder nicht mehr.',
  nobodyKnown: 'Die Namen sind ohne Verbindung nicht bekannt.',
} as const

/** The names of the people the plans and their rounds name, as far as the person sees them. */
export const roundPeopleQuery = {
  queryKey: ['rounds', 'people'],
  queryFn: () => request<DutyPerson[]>('/rounds/people'),
} as const

/** Who may walk the rounds of an area, for whoever plans there. */
export function performersQuery(areaId: string) {
  return {
    queryKey: ['rounds', 'performers', areaId],
    queryFn: () => request<DutyPerson[]>(`/rounds/performers?area=${areaId}`),
    enabled: areaId !== '',
  } as const
}

/** The name of a person by the names the server gave, or a word while it does not know them. */
export function nameOf(people: readonly DutyPerson[] | undefined, userId: string): string {
  return people?.find((person) => person.userId === userId)?.name ?? 'Unbekannte Person'
}

/** Who walks the rounds of a plan or a round, in words. */
export function walkerOf(
  people: readonly DutyPerson[] | undefined,
  userId: string | null,
  area: string | null,
): string {
  return userId === null ? `Alle im Bereich${area ? ` ${area}` : ''}` : nameOf(people, userId)
}

/** A day with its day of the week: "Mittwoch, 07.10.2026". */
export function dayWords(day: string): string {
  return `${weekdayLabel[weekdayOf(day as IsoDate)]}, ${date(day)}`
}

/**
 * The days of the week of a plan. On a device a list is the text of the list
 * (ADR 0005 in the repository opengewerk), as the kinds of a building are;
 * none for a plan whose rhythm names a day of the month.
 */
function weekdaysOf(plan: RecordState): readonly Weekday[] | null {
  let days: unknown = plan['weekdays']

  if (typeof days === 'string') {
    try {
      days = JSON.parse(days)
    } catch {
      days = null
    }
  }

  return Array.isArray(days) ? days.map((day) => Number(day) as Weekday) : null
}

/** The calendar of a plan as the sync holds it. */
export function calendarOf(plan: RecordState): PlanCalendar {
  return {
    rhythm: text(plan, 'rhythm') as PlanRhythm,
    weekdays: weekdaysOf(plan),
    dayOfMonth: typeof plan['dayOfMonth'] === 'number' ? plan['dayOfMonth'] : null,
    month: typeof plan['month'] === 'number' ? plan['month'] : null,
    startsOn: text(plan, 'startsOn') as IsoDate,
    endsOn: (maybeText(plan, 'endsOn') ?? null) as IsoDate | null,
  }
}

/** Where a plan stands, by its state and its days, with the tone of its marker. */
export function planStateWords(
  plan: RecordState,
  on: string,
): { readonly text: string; readonly tone: StatusTone } {
  const state: PlanState = planStateOn(
    {
      startsOn: text(plan, 'startsOn') as IsoDate,
      endsOn: (maybeText(plan, 'endsOn') ?? null) as IsoDate | null,
      resting: flag(plan, 'resting'),
    },
    on as IsoDate,
  )
  const endsOn = maybeText(plan, 'endsOn')

  switch (state) {
    case 'ended':
      return { text: `Beendet am ${date(endsOn)}`, tone: 'neutral' }
    case 'resting':
      return { text: 'Ruht', tone: 'waiting' }
    case 'upcoming':
      return { text: `Beginnt am ${date(text(plan, 'startsOn'))}`, tone: 'neutral' }
    case 'running':
      return { text: endsOn ? `Läuft bis ${date(endsOn)}` : 'Läuft', tone: 'done' }
  }
}

/** The closures that stand, by building. */
function useClosures(): ReadonlyMap<
  string,
  { startsOn: IsoDate; endsOn: IsoDate; reason: string | null }[]
> {
  const closures = useRecords('building_closures')

  return useMemo(() => {
    const byBuilding = new Map<
      string,
      { startsOn: IsoDate; endsOn: IsoDate; reason: string | null }[]
    >()

    for (const closure of closures) {
      const building = text(closure, 'buildingId')

      byBuilding.set(building, [
        ...(byBuilding.get(building) ?? []),
        {
          startsOn: text(closure, 'startsOn') as IsoDate,
          endsOn: text(closure, 'endsOn') as IsoDate,
          reason: maybeText(closure, 'reason') ?? null,
        },
      ])
    }

    return byBuilding
  }, [closures])
}

/**
 * The state of a property, where the catalogue holds its statutory public
 * holidays (#200): only there may a plan leave them out. None while the
 * catalogue is not on the device yet.
 */
function holidayStateOf(
  catalogue: Catalogue | null,
  property: RecordState | undefined,
): FederalState | null {
  const state = maybeText(property, 'federalState') as FederalState | undefined

  return catalogue !== null && state !== undefined && hasHolidays(catalogue, state) ? state : null
}

/** The first pass of a plan from today on that its building is open for. */
function nextPassOf(
  calendar: PlanCalendar,
  closures: readonly { startsOn: IsoDate; endsOn: IsoDate }[],
  from: IsoDate,
): IsoDate | null {
  for (let day = from, step = 0; step < 2 * 366 + 1; day = addDays(day, 1), step += 1) {
    if (calendar.endsOn !== null && day > calendar.endsOn) {
      return null
    }

    if (isPassDay(calendar, day) && closureOn(closures, day) === null) {
      return day
    }
  }

  return null
}

/** The place of a plan in two lines: the building, or the property, and the property under it. */
function usePlaceOf(): (plan: RecordState) => { readonly name: string; readonly sub: string } {
  const properties = useRecords('properties')
  const buildings = useRecords('buildings')

  return (plan) => {
    const property = properties.find((each) => each['id'] === plan['propertyId'])
    const building = buildings.find((each) => each['id'] === plan['buildingId'])
    const propertyName = maybeText(property, 'name') ?? 'Liegenschaft'

    return building
      ? { name: maybeText(building, 'name') ?? 'Gebäude', sub: propertyName }
      : { name: propertyName, sub: 'ganze Liegenschaft' }
  }
}

const counted = (found: number) =>
  found === 0 ? 'Kein Plan' : `${String(found)} ${found === 1 ? 'Plan' : 'Pläne'}`

/**
 * "Pläne", `plaene()` of the boards: every plan with its template and rhythm,
 * its place, who walks its rounds, its next pass and whether it runs.
 */
export function PlanListScreen() {
  const plans = useRight('activity.write')
  const navigate = useNavigate()
  const on = today()
  const records = useRecords('round_plans')
  const templates = useRecords('round_templates')
  const closures = useClosures()
  const placeOf = usePlaceOf()
  const areas = useAreas()
  const people = useQuery(roundPeopleQuery)
  const catalogue = useCatalogue()
  const properties = useRecords('properties')
  const rows = useMemo(
    () =>
      records
        .map((plan) => {
          const template = templates.find((each) => each['id'] === plan['templateId'])
          const calendar = calendarOf(plan)
          const state = planStateOn(
            {
              startsOn: calendar.startsOn,
              endsOn: calendar.endsOn,
              resting: flag(plan, 'resting'),
            },
            on as IsoDate,
          )
          const start = calendar.startsOn > on ? calendar.startsOn : (on as IsoDate)
          const holidayState = flag(plan, 'skipHolidays')
            ? holidayStateOf(
                catalogue,
                properties.find((each) => each['id'] === plan['propertyId']),
              )
            : null
          const holidays =
            catalogue === null || holidayState === null
              ? []
              : holidayClosures(
                  holidaysBetween(catalogue, holidayState, start, addDays(start, passSearchDays)),
                )

          return {
            id: String(plan['id']),
            plan,
            title: maybeText(template, 'title') ?? 'Vorlage',
            rhythm: rhythmText(calendar),
            place: placeOf(plan),
            next:
              state === 'running' || state === 'upcoming'
                ? nextPassOf(
                    calendar,
                    [...(closures.get(text(plan, 'buildingId')) ?? []), ...holidays],
                    start,
                  )
                : null,
          }
        })
        .sort(
          (left, right) =>
            left.place.sub.localeCompare(right.place.sub, 'de') ||
            left.place.name.localeCompare(right.place.name, 'de') ||
            left.title.localeCompare(right.title, 'de'),
        ),
    [records, templates, closures, placeOf, on, catalogue, properties],
  )

  return (
    <Screen>
      <PageHead
        title={planListPlace.label}
        crumbs={[roundsPlace]}
        count={counted(rows.length)}
        actions={
          plans ? (
            <Button
              tone="primary"
              icon={Plus}
              onClick={() => {
                void navigate({ to: planPlaces.new })
              }}
            >
              Neuer Plan
            </Button>
          ) : null
        }
      />
      {rows.length === 0 ? (
        <Panel>
          <Empty>{planWords.none}</Empty>
        </Panel>
      ) : (
        <TablePanel
          caption="Pläne der Rundgänge mit Ort, Zuständigkeit, nächstem Durchgang und Stand"
          note={planWords.stays}
          cards={rows.map((row) => ({
            key: row.id,
            title: <Link to={planPlaces.plan(row.id)}>{row.title}</Link>,
            sub: `${row.place.name}, ${row.rhythm}`,
            right: planStateWords(row.plan, on).text,
          }))}
        >
          <thead>
            <tr>
              <Column>Rundgang</Column>
              <Column className="w-[230px]">Ort</Column>
              <Column className="w-[170px]">Zuständig</Column>
              <Column className="w-[180px]">Nächster Durchgang</Column>
              <Column className="w-[170px]">Stand</Column>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const state = planStateWords(row.plan, on)

              return (
                <tr key={row.id}>
                  <Cell>
                    <div className="leading-[1.32]">
                      <Link to={planPlaces.plan(row.id)} className="font-medium">
                        {row.title}
                      </Link>
                      <div className="text-[12px] text-ink-faint">{row.rhythm}</div>
                    </div>
                  </Cell>
                  <Cell>
                    <div className="leading-[1.32]">
                      <div className="font-medium">{row.place.name}</div>
                      <div className="text-[12px] text-ink-faint">{row.place.sub}</div>
                    </div>
                  </Cell>
                  <Cell>
                    {walkerOf(
                      people.data,
                      maybeText(row.plan, 'performerUserId') ?? null,
                      areaName(areas, row.plan['areaId']),
                    )}
                  </Cell>
                  <Cell>
                    {row.next === null ? (
                      <span className="text-ink-muted">keiner</span>
                    ) : (
                      dayWords(row.next)
                    )}
                  </Cell>
                  <Cell>
                    <Status tone={state.tone}>{state.text}</Status>
                  </Cell>
                </tr>
              )
            })}
          </tbody>
        </TablePanel>
      )}
    </Screen>
  )
}

/** What the form of a plan holds while it is filled in. */
interface PlanDraft {
  readonly templateId: string
  /** `p:<property>` for the whole property, `b:<building>` for a building there. */
  readonly place: string
  readonly rhythm: PlanRhythm
  readonly days: readonly Weekday[]
  readonly weekday: string
  readonly dayOfMonth: string
  readonly month: string
  readonly leadDays: string
  readonly startsOn: string
  readonly endsOn: string
  readonly everybody: boolean
  readonly performerUserId: string
  /** Whether the statutory public holidays of the state are left out (#200). */
  readonly skipHolidays: boolean
}

function draftOf(plan: RecordState | null, on: string): PlanDraft {
  if (plan === null) {
    return {
      templateId: '',
      place: '',
      rhythm: 'weekly',
      days: [1, 2, 3, 4, 5],
      weekday: String(weekdayOf(on as IsoDate)),
      dayOfMonth: on.slice(8, 10).replace(/^0/, ''),
      month: on.slice(5, 7).replace(/^0/, ''),
      leadDays: '0',
      startsOn: on,
      endsOn: '',
      everybody: false,
      performerUserId: '',
      skipHolidays: false,
    }
  }

  const calendar = calendarOf(plan)
  const days = calendar.weekdays ?? []

  return {
    templateId: text(plan, 'templateId'),
    place: plan['buildingId'] ? `b:${text(plan, 'buildingId')}` : `p:${text(plan, 'propertyId')}`,
    rhythm: calendar.rhythm,
    days: calendar.rhythm === 'daily' ? days : [1, 2, 3, 4, 5],
    weekday: String(days[0] ?? weekdayOf(on as IsoDate)),
    dayOfMonth: calendar.dayOfMonth === null ? '1' : String(calendar.dayOfMonth),
    month: calendar.month === null ? '1' : String(calendar.month),
    leadDays: String(count(plan, 'leadDays')),
    startsOn: calendar.startsOn,
    endsOn: calendar.endsOn ?? '',
    everybody: typeof plan['performerUserId'] !== 'string',
    performerUserId: typeof plan['performerUserId'] === 'string' ? plan['performerUserId'] : '',
    skipHolidays: flag(plan, 'skipHolidays'),
  }
}

/** A whole number typed in, or what the check refuses. */
function whole(value: string): number | string {
  return /^\d+$/.test(value.trim()) ? Number(value.trim()) : value
}

/** The calendar of a draft, as the route takes it: each rhythm with what it names. */
function calendarValues(draft: PlanDraft): Record<string, unknown> {
  return {
    rhythm: draft.rhythm,
    weekdays:
      draft.rhythm === 'daily'
        ? [...draft.days].sort((one, other) => one - other)
        : draft.rhythm === 'weekly'
          ? [Number(draft.weekday)]
          : null,
    dayOfMonth:
      draft.rhythm === 'monthly' || draft.rhythm === 'yearly' ? whole(draft.dayOfMonth) : null,
    month: draft.rhythm === 'yearly' ? whole(draft.month) : null,
    leadDays: whole(draft.leadDays),
    startsOn: draft.startsOn,
    endsOn: draft.endsOn === '' ? null : draft.endsOn,
  }
}

/** The days of the week a daily plan holds on, each a button that is pressed or not. */
function WeekdayToggles({
  chosen,
  onChange,
  disabled,
}: {
  readonly chosen: readonly Weekday[]
  readonly onChange: (days: readonly Weekday[]) => void
  readonly disabled: boolean
}) {
  return (
    <div role="group" aria-label="Wochentage" className="flex flex-wrap gap-1.5">
      {weekdays.map((day) => {
        const on = chosen.includes(day)

        return (
          <button
            key={day}
            type="button"
            aria-pressed={on}
            aria-label={weekdayLabel[day]}
            disabled={disabled}
            className={
              on
                ? 'h-[34px] w-11 rounded-[4px] border border-copper-solid bg-copper-solid text-[14px] font-semibold text-on-copper max-sm:h-11'
                : 'h-[34px] w-11 rounded-[4px] border border-control bg-surface text-[14px] text-ink max-sm:h-11'
            }
            onClick={() => {
              onChange(on ? chosen.filter((each) => each !== day) : [...chosen, day])
            }}
          >
            {weekdayShort[day]}
          </button>
        )
      })}
    </div>
  )
}

/**
 * The page of a plan by its id. The form reads once what it begins with, so
 * it stands only once the plan is on the device, and carries its id as key.
 */
export function PlanScreen() {
  const { planId } = useParams({ strict: false })
  const records = useRecords('round_plans')
  const plan = records.find((each) => each['id'] === planId) ?? null

  if (planId === undefined || plan === null) {
    return (
      <Screen>
        <PageHead title="Plan" crumbs={[roundsPlace, planListPlace]} />
        <Panel>
          <Empty>{planWords.missing}</Empty>
        </Panel>
      </Screen>
    )
  }

  return <PlanForm key={planId} planId={planId} plan={plan} />
}

export function NewPlanScreen() {
  return <PlanForm planId={null} plan={null} />
}

/**
 * A plan, `plan()` and `plan_ansicht()` of the boards: the template, the
 * place, the rhythm with its days, the lead, the first and the last day, and
 * who walks the rounds; beside it the next passes. A plan that runs is
 * changed, rests and ends here.
 */
function PlanForm({
  planId,
  plan: begunWith,
}: {
  readonly planId: string | null
  readonly plan: RecordState | null
}) {
  const plans = useRight('activity.write')
  const client = useSync()
  const status = useSyncStatus()
  const queries = useQueryClient()
  const navigate = useNavigate()
  const on = today()
  const records = useRecords('round_plans')
  const plan = planId === null ? null : (records.find((each) => each['id'] === planId) ?? begunWith)
  const templates = useRecords('round_templates')
  const versions = useTemplateVersions()
  const properties = useRecords('properties')
  const buildings = useRecords('buildings')
  const closures = useClosures()
  const areas = useAreas()
  const rounds = useRecords('activities')
  const people = useQuery(roundPeopleQuery)
  const [draft, setDraft] = useState<PlanDraft>(() => draftOf(plan, on))
  const [problems, setProblems] = useState<Readonly<Record<string, string>>>({})
  const [trouble, setTrouble] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const [ending, setEnding] = useState(false)
  const set = (changes: Partial<PlanDraft>) => {
    setDraft((before) => ({ ...before, ...changes }))
  }

  const property = draft.place.startsWith('b:')
    ? buildings.find((each) => `b:${String(each['id'])}` === draft.place)?.['propertyId']
    : draft.place.slice(2)
  const areaId = text(
    properties.find((each) => each['id'] === property),
    'areaId',
  )
  const catalogue = useCatalogue()
  const holidayState = holidayStateOf(
    catalogue,
    properties.find((each) => each['id'] === property),
  )
  const area = areaName(areas, areaId)
  const performers = useQuery(performersQuery(plans ? areaId : ''))
  const ended =
    plan !== null &&
    planStateOn(
      {
        startsOn: text(plan, 'startsOn') as IsoDate,
        endsOn: (maybeText(plan, 'endsOn') ?? null) as IsoDate | null,
        resting: flag(plan, 'resting'),
      },
      on as IsoDate,
    ) === 'ended'
  const locked = !plans || ended || working

  const templateChoices = templates
    .map((template) => ({
      value: String(template['id']),
      label: `${text(template, 'title')}, Fassung ${String(count(versions.get(String(template['id']))?.[0], 'formVersion'))}`,
    }))
    .sort((left, right) => left.label.localeCompare(right.label, 'de'))
  const placeChoices = properties
    .flatMap((each) => [
      { value: `p:${String(each['id'])}`, label: `${text(each, 'name')}, ganze Liegenschaft` },
      ...buildings
        .filter((building) => building['propertyId'] === each['id'])
        .map((building) => ({
          value: `b:${String(building['id'])}`,
          label: `${text(each, 'name')}, ${text(building, 'name')}`,
        })),
    ])
    .sort((left, right) => left.label.localeCompare(right.label, 'de'))
  const named = maybeText(plan, 'performerUserId') ?? null
  const personChoices = [
    { value: '', label: 'Person wählen' },
    ...(performers.data ?? []).map((person) => ({ value: person.userId, label: person.name })),
    ...(named !== null && !(performers.data ?? []).some((person) => person.userId === named)
      ? [{ value: named, label: nameOf(people.data, named) }]
      : []),
  ]

  // The next passes of the plan as it is filled in, the days a closure takes among them.
  const passes = useMemo(() => {
    const values = calendarValues(draft)

    if (Object.keys(planProblems(values)).length > 0) {
      return []
    }

    const calendar = values as unknown as PlanCalendar
    const building = draft.place.startsWith('b:') ? draft.place.slice(2) : ''
    const closed = closures.get(building) ?? []
    const found: { day: IsoDate; closed: string | null }[] = []
    const from = (draft.startsOn > on ? draft.startsOn : on) as IsoDate
    const holidays =
      catalogue === null || holidayState === null || !draft.skipHolidays
        ? []
        : holidaysBetween(catalogue, holidayState, from, addDays(from, 400))

    for (
      let day = from, step = 0;
      step < 400 && found.length < 5;
      day = addDays(day, 1), step += 1
    ) {
      if (calendar.endsOn !== null && day > calendar.endsOn) {
        break
      }

      if (isPassDay(calendar, day)) {
        const closure = closureOn(closed, day)
        const holiday = holidays.find((each) => each.day === day)

        found.push({
          day,
          closed:
            closure !== null
              ? `${closure.reason ?? 'Schließzeit'}, geschlossen`
              : holiday === undefined
                ? null
                : planWords.holiday(holiday.name),
        })
      }
    }

    return found
  }, [draft, closures, on, catalogue, holidayState])

  const walkerFor = (day: IsoDate) => {
    // A new plan has no rounds yet, and an activity without a plan is none of its rounds.
    const round =
      planId === null
        ? undefined
        : rounds.find((each) => each['roundPlanId'] === planId && each['dueOn'] === day)

    if (round !== undefined) {
      return walkerOf(people.data, maybeText(round, 'performerUserId') ?? null, area)
    }

    return draft.everybody
      ? walkerOf(people.data, null, area)
      : draft.performerUserId === ''
        ? ''
        : (performers.data?.find((person) => person.userId === draft.performerUserId)?.name ??
          nameOf(people.data, draft.performerUserId))
  }

  async function send(values: Record<string, unknown>): Promise<boolean> {
    setTrouble(null)
    setWorking(true)

    try {
      const result =
        planId === null
          ? await makeAt(client, '/round-plans', values)
          : await askAt(client, 'PATCH', `/round-plans/${planId}`, planId, values)

      if (result.outcome === 'refused') {
        setTrouble(refusalFor(result))

        return false
      }

      await queries.invalidateQueries({ queryKey: ['rounds'] })

      if (planId === null && result.outcome === 'queued') {
        void navigate({ to: planPlaces.plan(result.id) })
      }

      return true
    } finally {
      setWorking(false)
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault()

    const values = {
      ...calendarValues(draft),
      performerUserId: draft.everybody ? null : draft.performerUserId,
      ...(holidayState === null ? {} : { skipHolidays: draft.skipHolidays }),
    }
    const found: Record<string, string> = { ...planProblems(values) }

    if (draft.templateId === '') {
      found['templateId'] = planWords.noTemplate
    }

    if (draft.place === '') {
      found['place'] = planWords.noPlace
    }

    if (!draft.everybody && draft.performerUserId === '') {
      found['performerUserId'] = planWords.noPerson
    }

    setProblems(found)

    if (Object.keys(found).length > 0) {
      return
    }

    await send(
      planId === null
        ? {
            ...values,
            templateId: draft.templateId,
            propertyId: property,
            buildingId: draft.place.startsWith('b:') ? draft.place.slice(2) : null,
          }
        : { ...values, templateId: draft.templateId },
    )
  }

  const problem = (field: string) => (problems[field] ? { problem: problems[field] } : {})
  const resting = plan !== null && flag(plan, 'resting')
  const state = plan === null ? null : planStateWords(plan, on)
  const title =
    plan === null
      ? 'Neuer Plan'
      : (maybeText(
          templates.find((each) => each['id'] === plan['templateId']),
          'title',
        ) ?? 'Plan')

  return (
    <Screen>
      <PageHead
        title={title}
        crumbs={[roundsPlace, planListPlace]}
        sub={
          plan === null
            ? planWords.newSub
            : `${placeChoices.find((each) => each.value === draft.place)?.label ?? ''}, ${rhythmText(calendarOf(plan))}`
        }
        badges={state === null ? undefined : <Status tone={state.tone}>{state.text}</Status>}
        actions={
          plan === null ? null : (
            <>
              <ChangesButton table="round_plans" id={String(planId)} />
              {plans && !ended ? (
                <>
                  <Button
                    icon={resting ? Play : Pause}
                    disabled={working || !status.online}
                    onClick={() => {
                      void send({ resting: !resting })
                    }}
                  >
                    {resting ? 'Wieder aufnehmen' : 'Ruhen lassen'}
                  </Button>
                  <Button
                    icon={Square}
                    disabled={working || !status.online}
                    onClick={() => {
                      setEnding(true)
                    }}
                  >
                    Beenden
                  </Button>
                  <Button
                    type="submit"
                    form="plan-form"
                    tone="primary"
                    icon={Check}
                    disabled={working || !status.online}
                  >
                    {working ? 'Wird gespeichert' : 'Speichern'}
                  </Button>
                </>
              ) : null}
            </>
          )
        }
      />
      <form
        id="plan-form"
        noValidate
        className="flex flex-col gap-3.5"
        onSubmit={(event) => {
          void save(event)
        }}
      >
        <div className="grid items-start gap-3.5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Panel className="px-5! py-[18px]!">
            <fieldset disabled={locked} className="flex min-w-0 flex-col gap-3">
              {status.online ? null : (
                <p role="status" className="text-[13px] font-medium text-ink-muted">
                  {planWords.offline}
                </p>
              )}
              {ended ? <NoteBox>{planWords.ended}</NoteBox> : null}
              <div className="grid gap-3.5 sm:grid-cols-2">
                <SelectField
                  label="Vorlage"
                  required
                  starred
                  options={[{ value: '', label: 'Vorlage wählen' }, ...templateChoices]}
                  value={draft.templateId}
                  hint={planWords.templateHint}
                  {...problem('templateId')}
                  onChange={(value) => {
                    set({ templateId: value })
                  }}
                />
                {plan === null ? (
                  <SelectField
                    label="Ort"
                    required
                    starred
                    options={[{ value: '', label: 'Ort wählen' }, ...placeChoices]}
                    value={draft.place}
                    hint={planWords.placeHint}
                    {...problem('place')}
                    onChange={(value) => {
                      set({ place: value, performerUserId: '' })
                    }}
                  />
                ) : (
                  <Field
                    label="Ort"
                    readOnly
                    // Grey as the board draws a field that cannot be changed.
                    className="bg-surface-sunken!"
                    value={placeChoices.find((each) => each.value === draft.place)?.label ?? ''}
                    hint={planWords.placeStays}
                  />
                )}
              </div>
              <Choice<PlanRhythm>
                label="Rhythmus"
                value={draft.rhythm}
                disabled={locked}
                options={planRhythms.map((rhythm) => ({
                  value: rhythm,
                  label: planRhythmLabel[rhythm],
                }))}
                onChange={(rhythm) => {
                  set({ rhythm })
                }}
              />
              {draft.rhythm === 'daily' ? (
                <div className="flex flex-col gap-1.5">
                  <PanelLabel>Wochentage</PanelLabel>
                  <WeekdayToggles
                    chosen={draft.days}
                    disabled={locked}
                    onChange={(days) => {
                      set({ days })
                    }}
                  />
                  <p
                    className={
                      problems['weekdays']
                        ? 'text-[12px] font-semibold text-conflict'
                        : 'text-[12px] text-ink-faint'
                    }
                  >
                    {problems['weekdays'] ?? planWords.otherDays}
                  </p>
                </div>
              ) : null}
              {draft.rhythm === 'weekly' ? (
                <SelectField
                  label="Wochentag"
                  options={weekdays.map((day) => ({
                    value: String(day),
                    label: weekdayLabel[day],
                  }))}
                  value={draft.weekday}
                  {...problem('weekdays')}
                  onChange={(weekday) => {
                    set({ weekday })
                  }}
                />
              ) : null}
              {draft.rhythm === 'monthly' || draft.rhythm === 'yearly' ? (
                <div className="grid gap-3 sm:grid-cols-[140px_minmax(0,1fr)]">
                  <Field
                    label="Tag"
                    inputMode="numeric"
                    numeric
                    value={draft.dayOfMonth}
                    hint={draft.rhythm === 'monthly' ? planWords.dayHint : undefined}
                    {...problem('dayOfMonth')}
                    onChange={(event) => {
                      set({ dayOfMonth: event.target.value })
                    }}
                  />
                  {draft.rhythm === 'yearly' ? (
                    <SelectField
                      label="Monat"
                      options={monthLabel.map((label, index) => ({
                        value: String(index + 1),
                        label,
                      }))}
                      value={draft.month}
                      {...problem('month')}
                      onChange={(month) => {
                        set({ month })
                      }}
                    />
                  ) : null}
                </div>
              ) : null}
              {holidayState === null ? null : (
                <label className="flex items-start gap-2.5 text-[14px] leading-[1.4] max-lg:min-h-tap">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 shrink-0 accent-solid max-lg:size-5"
                    checked={draft.skipHolidays}
                    disabled={locked}
                    onChange={(event) => {
                      set({ skipHolidays: event.target.checked })
                    }}
                  />
                  <span>
                    {planWords.holidays}
                    <span className="block text-[12px] text-ink-muted">
                      {planWords.holidaysHint(ruleScopeNames[holidayState])}
                    </span>
                  </span>
                </label>
              )}
              <div className="grid gap-3 sm:grid-cols-3">
                <Field
                  label="Vorlauf"
                  inputMode="numeric"
                  numeric
                  unit="Tage"
                  value={draft.leadDays}
                  hint={planWords.leadHint}
                  {...problem('leadDays')}
                  onChange={(event) => {
                    set({ leadDays: event.target.value })
                  }}
                />
                <Field
                  label="Ab"
                  type="date"
                  required
                  starred
                  value={draft.startsOn}
                  {...problem('startsOn')}
                  onChange={(event) => {
                    set({ startsOn: event.target.value })
                  }}
                />
                <Field
                  label="Bis"
                  type="date"
                  value={draft.endsOn}
                  hint={planWords.endsHint}
                  {...problem('endsOn')}
                  onChange={(event) => {
                    set({ endsOn: event.target.value })
                  }}
                />
              </div>
              <Choice<'person' | 'area'>
                label="Zuständig"
                value={draft.everybody ? 'area' : 'person'}
                disabled={locked}
                options={[
                  { value: 'person', label: 'Eine Person' },
                  { value: 'area', label: 'Alle im Bereich' },
                ]}
                onChange={(choice) => {
                  set({ everybody: choice === 'area' })
                }}
              />
              {draft.everybody ? (
                <p className="text-[12px] leading-[1.4] text-ink-faint">
                  {planWords.everybody(area)}
                </p>
              ) : (
                <SelectField
                  label="Person"
                  options={personChoices}
                  value={draft.performerUserId}
                  hint={planWords.personHint}
                  {...problem('performerUserId')}
                  onChange={(performerUserId) => {
                    set({ performerUserId })
                  }}
                />
              )}
            </fieldset>
          </Panel>
          <div className="flex min-w-0 flex-col gap-3.5">
            <TablePanel
              title="Die nächsten Durchgänge"
              caption="Die nächsten Durchgänge des Plans mit der Person, die sie geht"
              note={plan === null ? planWords.passesNew : planWords.passesChange}
              cards={passes.map((pass) => ({
                key: pass.day,
                title: dayWords(pass.day),
                sub: pass.closed ?? walkerFor(pass.day),
              }))}
            >
              <thead>
                <tr>
                  <Column>Fällig</Column>
                  <Column className="w-[150px]">Zuständig</Column>
                </tr>
              </thead>
              <tbody>
                {passes.map((pass) => (
                  <tr key={pass.day}>
                    <Cell>
                      <span className={pass.closed ? 'text-ink-muted' : undefined}>
                        {dayWords(pass.day)}
                      </span>
                    </Cell>
                    <Cell>
                      {pass.closed ? (
                        <span className="text-ink-muted">{pass.closed}</span>
                      ) : (
                        walkerFor(pass.day)
                      )}
                    </Cell>
                  </tr>
                ))}
              </tbody>
            </TablePanel>
            <Panel title="Gut zu wissen">
              <p className="text-[13px] leading-[1.45] text-ink-muted max-sm:text-[15px]">
                {planWords.shorter}
              </p>
            </Panel>
          </div>
        </div>
        {trouble ? (
          <p role="alert" className="text-[13px] font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}
        {plan === null && plans ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              disabled={working}
              onClick={() => {
                void navigate({ to: planListPlace.to })
              }}
            >
              Abbrechen
            </Button>
            <Button type="submit" tone="primary" icon={Check} disabled={working || !status.online}>
              {working ? 'Wird gespeichert' : 'Plan anlegen'}
            </Button>
          </div>
        ) : null}
      </form>
      {ending ? (
        <EndDialog
          onClose={() => {
            setEnding(false)
          }}
          onEnd={async (endsOn) => {
            const done = await send({ endsOn })

            if (done) {
              setEnding(false)
            }

            return done
          }}
          startsOn={draft.startsOn}
          on={on}
          working={working}
          trouble={trouble}
        />
      ) : null}
    </Screen>
  )
}

/** Ending a plan, `plan_beenden()` of the boards: the day of its last pass. */
function EndDialog({
  onClose,
  onEnd,
  startsOn,
  on,
  working,
  trouble,
}: {
  readonly onClose: () => void
  readonly onEnd: (endsOn: string) => Promise<boolean>
  readonly startsOn: string
  readonly on: string
  readonly working: boolean
  readonly trouble: string | null
}) {
  const [endsOn, setEndsOn] = useState(on < startsOn ? startsOn : on)
  const problem = planProblems({ startsOn, endsOn })['endsOn']

  return (
    <Dialog title="Plan beenden" width={520} onClose={onClose}>
      <form
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()

          if (problem === undefined) {
            void onEnd(endsOn)
          }
        }}
      >
        <Field
          label="Letzter Durchgang am"
          type="date"
          required
          starred
          value={endsOn}
          {...(problem ? { problem } : {})}
          onChange={(event) => {
            setEndsOn(event.target.value)
          }}
        />
        <p className="text-[13px] leading-[1.45] text-ink-muted">{planWords.endSub}</p>
        {trouble ? (
          <p role="alert" className="text-[13px] font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}
        <DialogActions>
          <Button type="button" disabled={working} onClick={onClose}>
            Abbrechen
          </Button>
          <Button type="submit" tone="primary" icon={Square} disabled={working}>
            {working ? 'Einen Moment' : 'Beenden'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
