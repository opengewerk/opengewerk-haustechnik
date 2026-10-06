import {
  type Catalogue,
  type DutyEntry,
  dutyInterval,
  type DutyRegister,
  type DutyRegisterFilter,
  type DutyRegisterState,
  dutyRegisterStateLabel,
  dutyRegisterStates,
  endedDuties,
  intervalWords,
  namesAPerson,
  type RecordState,
  withoutResponsible,
} from '@opengewerk/haustechnik-domain'
import { Button, cardLink, Cell, Column, Panel, TablePanel } from '@opengewerk/platform-web'
import { date, today } from '@opengewerk/platform-web/format'
import { Chip, Empty, NoteBox, PageHead, Screen } from '@opengewerk/platform-web/office'
import { maybeText, request, RequestRefused, useRecords } from '@opengewerk/platform-web/sync'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { TriangleAlert } from 'lucide-react'
import { type ReactNode, useMemo } from 'react'

import { titleOfRoom } from '../../app/place-records.js'
import { ReviewMarks } from '../../app/review-marks.js'
import { useCatalogue } from '../../sync/catalogue.js'
import {
  dutyFilterOf,
  dutyPlaces,
  dutyRegisterPlace,
  dutyRegisterRequest,
  dutySearch,
} from '../duty-addresses.js'
import {
  dutySourceWords,
  DutyStandingMark,
  intervalKindWords,
  kindOfDuty,
  NewDutyButton,
  Nobody,
  nobodyWords,
  performerWords,
} from '../duty-words.js'
import { factLink } from '../links.js'
import { officePlaces } from '../place-addresses.js'
import { assetKindChoices, PlaceFilter, RegisterFilter } from '../register-filter.js'

export const dutyRegisterWords = {
  noConnection: 'Das Pflichtenverzeichnis kommt vom Server. Gerade ist keine Verbindung da.',
  loading: 'Das Pflichtenverzeichnis wird geladen.',
  failed: 'Das Pflichtenverzeichnis ließ sich nicht laden. Es kommt vom Server, mit Verbindung.',
  byPersonRefused:
    'Diese Liste ist auf eine Person eingegrenzt. Das kann nur, wer das Pflichtenverzeichnis führt.',
  nothingPasses: 'Keine Pflicht passt zu dem, wonach das Verzeichnis eingegrenzt ist.',
  none: 'Noch ist keine Pflicht bestätigt.',
  order: 'geordnet nach Zustand: nie erfasst vor überfällig',
  endedOrder: 'das jüngste Ende zuerst',
  everybody: 'Alle Personen',
} as const

/**
 * "Pflichtenverzeichnis" in the office, `pflichten()` of the boards (4.3 of
 * the concept): every duty of the operator with what it hangs on, its source,
 * its interval, who answers for it and who performs it, its last evidence,
 * its next appointment and how it stands today.
 *
 * The list comes from the server a page at a time and is narrowed there. The
 * state of a duty is worked out there as well, from its evidence on the day
 * it is read; the evidence never travels to a device. So this screen needs a
 * connection, and says so without one.
 *
 * What it is narrowed by stands in the address (`duty-addresses.ts`). A duty
 * nobody answers for is said above the list, whatever it is narrowed by.
 * Narrowing it to one person is for whoever keeps the register, and the list
 * then names no number (4.16 of the concept: no evaluation by person).
 *
 * A duty of the operator's own is made from here, by whoever keeps the
 * register (`duty-form.tsx`). What the board draws beyond this arrives with
 * what it shows: the proposals of the catalogue (#102).
 */
export function DutyRegisterScreen() {
  const search = useSearch({ strict: false })
  const filter = useMemo(() => dutyFilterOf(search), [search])
  const navigate = useNavigate()
  const catalogue = useCatalogue()
  const properties = useRecords('properties')
  const buildings = useRecords('buildings')
  const rooms = useRecords('rooms')

  const pages = useInfiniteQuery({
    queryKey: ['duties', 'register', filter],
    queryFn: ({ pageParam }) => request<DutyRegister>(dutyRegisterRequest(filter, pageParam)),
    initialPageParam: 0,
    getNextPageParam: (last, all) =>
      last.more ? all.reduce((sum, page) => sum + page.duties.length, 0) : undefined,
    // A refusal is an answer: asking again brings the same one.
    retry: (count, error) => !(error instanceof RequestRefused) && count < 2,
  })

  const narrowed = Object.keys(filter).length > 0
  const first = pages.data?.pages[0]
  const duties = pages.data?.pages.flatMap((page) => page.duties) ?? []
  const ended = filter.state === endedDuties

  const show = (next: DutyRegisterFilter) => {
    void navigate({ to: dutyRegisterPlace.to, search: dutySearch(next), replace: true })
  }
  /** The filter with one part set, or without it for the choice "all". */
  const set = (name: keyof DutyRegisterFilter, value: string) => {
    const { [name]: _, ...rest } = filter

    show(value === '' ? rest : { ...rest, [name]: value })
  }

  const byId = (records: readonly RecordState[], id: string | null) =>
    id === null ? null : (records.find((record) => record['id'] === id) ?? null)
  const propertyOf = (duty: DutyEntry) => maybeText(byId(properties, duty.propertyId), 'name')
  /** What a duty hangs on: the asset, or the room, the building or the property itself. */
  const whereOf = (duty: DutyEntry): { name: string; to: string; sub: string } => {
    const property = propertyOf(duty) ?? 'Liegenschaft'

    if (duty.asset !== null) {
      return {
        name: duty.asset.name,
        to: officePlaces.asset(duty.asset.id),
        sub: [duty.asset.number, property].filter(Boolean).join(' · '),
      }
    }

    if (duty.roomId !== null) {
      const room = byId(rooms, duty.roomId)

      return {
        name: room ? titleOfRoom(room) : 'Raum',
        to: officePlaces.room(duty.roomId),
        sub: `Raum · ${property}`,
      }
    }

    if (duty.buildingId !== null) {
      return {
        name: maybeText(byId(buildings, duty.buildingId), 'name') ?? 'Gebäude',
        to: officePlaces.building(duty.buildingId),
        sub: `Gebäude · ${property}`,
      }
    }

    return { name: property, to: officePlaces.property(duty.propertyId), sub: 'Liegenschaft' }
  }
  const lastOf = (duty: DutyEntry): { main: string; sub: string } | null =>
    duty.lastEvidence === null
      ? null
      : duty.lastEvidence.origin === 'legacy'
        ? { main: date(duty.lastEvidence.performedOn), sub: 'Altbestand' }
        : { main: duty.lastEvidence.number, sub: date(duty.lastEvidence.performedOn) }
  const nextOf = (duty: DutyEntry) =>
    duty.ended || duty.state === 'dormant' || duty.appointment === null
      ? null
      : date(duty.appointment.dueOn)
  const none = <span className="text-ink-faint">keiner</span>

  return (
    <Screen>
      <PageHead
        title="Pflichtenverzeichnis"
        {...countOf(first)}
        actions={
          // In the building or on the property the list is narrowed to, where it is.
          <NewDutyButton
            primary
            start={{
              ...(filter.buildingId === undefined ? {} : { buildingId: filter.buildingId }),
              ...(filter.propertyId === undefined ? {} : { propertyId: filter.propertyId }),
            }}
          />
        }
      />
      <Filters
        filter={filter}
        register={first}
        catalogue={catalogue}
        properties={properties}
        buildings={buildings}
        onSet={set}
        onPlace={(place) => {
          const { propertyId: _, buildingId: __, ...rest } = filter

          show({ ...rest, ...place })
        }}
        {...(narrowed
          ? {
              onReset: () => {
                show({})
              },
            }
          : {})}
      />
      {filter.dutyKind === undefined ? null : (
        <NoteBox>
          Eingegrenzt auf die Pflichtart „
          {catalogue?.dutyKind(filter.dutyKind, today())?.definition.label ?? filter.dutyKind}“.{' '}
          <InlineButton
            onPress={() => {
              set('dutyKind', '')
            }}
          >
            Aufheben
          </InlineButton>
        </NoteBox>
      )}
      {first !== undefined &&
      first.withoutResponsible > 0 &&
      filter.responsible !== withoutResponsible ? (
        <NoteBox tone="waiting" icon={TriangleAlert}>
          {unownedWords(first.withoutResponsible)}{' '}
          <InlineButton
            onPress={() => {
              const { state: _, ...rest } = filter

              show({ ...rest, responsible: withoutResponsible })
            }}
          >
            Anzeigen
          </InlineButton>
        </NoteBox>
      ) : null}
      {first === undefined ? (
        <Panel>
          <Empty>
            {pages.error instanceof RequestRefused && pages.error.status === 403
              ? dutyRegisterWords.byPersonRefused
              : pages.isError
                ? dutyRegisterWords.failed
                : pages.fetchStatus === 'paused'
                  ? dutyRegisterWords.noConnection
                  : dutyRegisterWords.loading}
          </Empty>
        </Panel>
      ) : duties.length === 0 ? (
        <Panel>
          <Empty>{narrowed ? dutyRegisterWords.nothingPasses : dutyRegisterWords.none}</Empty>
        </Panel>
      ) : (
        <TablePanel
          caption="Pflichten mit Anlage oder Ort, Frist, Zuständigkeit, letztem Nachweis, nächstem Termin und Zustand"
          cards={duties.map((duty) => ({
            key: duty.id,
            title: (
              <Link to={dutyPlaces.duty(duty.id)} className={cardLink}>
                {duty.title}
              </Link>
            ),
            sub: [
              whereOf(duty).name,
              propertyOf(duty),
              intervalWords(dutyInterval(duty)),
              duty.responsible?.name ?? nobodyWords,
            ]
              .filter((part) => part !== null && part !== '')
              .join(' · '),
            right: <DutyStandingMark duty={duty} />,
          }))}
          footer={
            <>
              <span>
                {first.total === null
                  ? ''
                  : `${duties.length.toLocaleString('de-DE')} von ${first.total.toLocaleString('de-DE')}, `}
                {ended ? dutyRegisterWords.endedOrder : dutyRegisterWords.order}
              </span>
              <span className="grow" />
              {pages.hasNextPage ? (
                <Button
                  size="small"
                  disabled={pages.isFetchingNextPage}
                  onClick={() => {
                    void pages.fetchNextPage()
                  }}
                >
                  Weitere laden
                </Button>
              ) : null}
            </>
          }
        >
          <thead>
            <tr>
              <Column className="w-[190px] min-w-[140px]">Anlage oder Ort</Column>
              <Column className="min-w-[180px]">Pflicht</Column>
              <Column className="w-[104px] min-w-[88px]">Frist</Column>
              <Column className="w-[168px] min-w-[124px]">Zuständig</Column>
              <Column className="w-[122px] min-w-[104px]">Letzter Nachweis</Column>
              <Column numeric className="w-[96px] min-w-[88px]">
                Nächster Termin
              </Column>
              <Column className="w-[176px] min-w-[148px]">Zustand</Column>
            </tr>
          </thead>
          <tbody>
            {duties.map((duty) => {
              const where = whereOf(duty)
              const review = kindOfDuty(duty, catalogue)?.review ?? null
              const last = lastOf(duty)

              return (
                <tr key={duty.id}>
                  <Cell>
                    <TwoLines main={<Link to={where.to}>{where.name}</Link>} sub={where.sub} bold />
                  </Cell>
                  <Cell>
                    <div className="leading-[1.32]">
                      <div className="font-medium">
                        <Link to={dutyPlaces.duty(duty.id)} className={factLink}>
                          {duty.title}
                        </Link>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-[3px] text-[12px] text-ink-faint">
                        <span>{dutySourceWords(duty, catalogue)}</span>
                        {review ? <ReviewMarks review={review} /> : null}
                      </div>
                    </div>
                  </Cell>
                  <Cell>
                    <TwoLines
                      main={intervalWords(dutyInterval(duty))}
                      sub={intervalKindWords(duty, catalogue)}
                    />
                  </Cell>
                  <Cell>
                    <TwoLines
                      main={duty.responsible?.name ?? <Nobody />}
                      sub={performerWords(duty)}
                    />
                  </Cell>
                  <Cell>{last ? <TwoLines main={last.main} sub={last.sub} /> : none}</Cell>
                  <Cell numeric>{nextOf(duty) ?? none}</Cell>
                  <Cell>
                    <DutyStandingMark duty={duty} />
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

/** Two lines in a cell, `lines()` of the boards: the thing, and below it in small print what it is. */
function TwoLines({
  main,
  sub,
  bold = false,
}: {
  readonly main: ReactNode
  readonly sub: ReactNode
  readonly bold?: boolean
}) {
  return (
    <div className="leading-[1.32]">
      <div className={bold ? 'font-medium' : undefined}>{main}</div>
      {sub === null || sub === '' ? null : <div className="text-[12px] text-ink-faint">{sub}</div>}
    </div>
  )
}

/** A button in the middle of a sentence, in the look of the sentence it stands in. */
function InlineButton({
  onPress,
  children,
}: {
  readonly onPress: () => void
  readonly children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      className="cursor-pointer font-semibold text-inherit underline underline-offset-2"
    >
      {children}
    </button>
  )
}

const counted = (count: number, one: string, many: string) =>
  `${count.toLocaleString('de-DE')} ${count === 1 ? one : many}`

/** "2 Pflichten haben keine verantwortliche Person." */
export function unownedWords(count: number): string {
  return count === 1
    ? '1 Pflicht hat keine verantwortliche Person.'
    : `${count.toLocaleString('de-DE')} Pflichten haben keine verantwortliche Person.`
}

/**
 * "287 Pflichten an 241 Anlagen und 6 Orten". Nothing where the register
 * names no number, which is where it is narrowed to one person.
 */
function countOf(register: DutyRegister | undefined): { readonly count?: string } {
  if (register === undefined || register.total === null) {
    return {}
  }

  if (register.total === 0) {
    return { count: 'Keine Pflicht' }
  }

  const at = [
    register.assets ? counted(register.assets, 'Anlage', 'Anlagen') : null,
    register.places ? counted(register.places, 'Ort', 'Orten') : null,
  ].filter((part) => part !== null)

  return {
    count: `${counted(register.total, 'Pflicht', 'Pflichten')}${at.length > 0 ? ` an ${at.join(' und ')}` : ''}`,
  }
}

/**
 * The filters over the list: the states as chips, each with how many duties
 * are in it, and beside them the place, the asset kind and who answers.
 *
 * The people to choose from are the ones the server hands whoever keeps the
 * register; anybody else narrows to the duties of nobody and to no person.
 */
function Filters({
  filter,
  register,
  catalogue,
  properties,
  buildings,
  onSet,
  onPlace,
  onReset,
}: {
  readonly filter: DutyRegisterFilter
  readonly register: DutyRegister | undefined
  readonly catalogue: Catalogue | null
  readonly properties: readonly RecordState[]
  readonly buildings: readonly RecordState[]
  readonly onSet: (name: keyof DutyRegisterFilter, value: string) => void
  readonly onPlace: (place: Pick<DutyRegisterFilter, 'propertyId' | 'buildingId'>) => void
  readonly onReset?: () => void
}) {
  const kinds = useMemo(() => assetKindChoices(catalogue), [catalogue])
  // A kind or a person the address names beyond those on offer stays a
  // choice, so that the filter shows what the list is narrowed by.
  const unknownKind =
    filter.assetKind !== undefined && !kinds.some((kind) => kind.key === filter.assetKind)
      ? filter.assetKind
      : null
  const people = register?.people ?? []
  const unknownPerson =
    namesAPerson(filter) && !people.some((person) => person.userId === filter.responsible)
      ? (filter.responsible ?? null)
      : null
  const counts = register?.counts ?? null
  const chip = (state: DutyRegisterState | null, label: string) => (
    <Chip
      key={state ?? 'all'}
      pressed={(filter.state ?? null) === state}
      onPress={() => {
        onSet('state', state ?? '')
      }}
    >
      {state === null || counts === null
        ? label
        : `${label} ${counts[state].toLocaleString('de-DE')}`}
    </Chip>
  )

  return (
    <div className="flex flex-wrap items-end gap-x-2.5 gap-y-2">
      <div role="group" aria-label="Zustand" className="flex flex-wrap gap-1.5">
        {chip(null, 'Alle')}
        {dutyRegisterStates.map((state) => chip(state, dutyRegisterStateLabel[state]))}
      </div>
      <span className="grow max-lg:hidden" />
      {/* One group: where the row is too narrow for chips and choices side by
          side, the choices go below together, and none alone. */}
      <div className="flex flex-wrap items-end gap-2.5 max-lg:w-full">
        <PlaceFilter
          className="lg:w-[200px]"
          place={filter}
          properties={properties}
          buildings={buildings}
          onPlace={onPlace}
        />
        <RegisterFilter
          label="Anlagenart"
          className="lg:w-[170px]"
          value={filter.assetKind ?? ''}
          onChange={(value) => {
            onSet('assetKind', value)
          }}
        >
          <option value="">Alle</option>
          {kinds.map((kind) => (
            <option key={kind.key} value={kind.key}>
              {kind.label}
            </option>
          ))}
          {unknownKind === null ? null : <option value={unknownKind}>{unknownKind}</option>}
        </RegisterFilter>
        <RegisterFilter
          label="Verantwortlich"
          className="lg:w-[170px]"
          value={filter.responsible ?? ''}
          onChange={(value) => {
            onSet('responsible', value)
          }}
        >
          <option value="">{dutyRegisterWords.everybody}</option>
          <option value={withoutResponsible}>{nobodyWords}</option>
          {people.map((person) => (
            <option key={person.userId} value={person.userId}>
              {person.name}
            </option>
          ))}
          {unknownPerson === null ? null : <option value={unknownPerson}>Eine Person</option>}
        </RegisterFilter>
        {onReset ? (
          <Button size="small" onClick={onReset}>
            Filter zurücksetzen
          </Button>
        ) : null}
      </div>
    </div>
  )
}
