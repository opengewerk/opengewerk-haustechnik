import {
  type AssetDetails,
  type AssetField,
  type AssetValue,
  type Catalogue,
  type Characteristic,
  type ChoiceOption,
  dutyBasisLabel,
  dutyInterval,
  type DutyReading,
  intervalWords,
  lifecycleStateLabel,
  meterUnitSymbol,
  type RecordState,
  restsOn,
  ruleValueWords,
} from '@opengewerk/haustechnik-domain'
import {
  cardLink,
  Cell,
  Column,
  NumberBadge,
  Panel,
  Status,
  TablePanel,
} from '@opengewerk/platform-web'
import { date, today } from '@opengewerk/platform-web/format'
import {
  ChangesButton,
  Empty,
  type Fact,
  FactList,
  PageHead,
  Screen,
} from '@opengewerk/platform-web/office'
import { useRight } from '@opengewerk/platform-web/session'
import { request, RequestRefused, text, useRecords } from '@opengewerk/platform-web/sync'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import { Zap } from 'lucide-react'
import type { ReactNode } from 'react'

import { placePath } from '../../app/place-path.js'
import { placeAbove, titleOfRoom } from '../../app/place-records.js'
import { ReviewMarks } from '../../app/review-marks.js'
import { useCatalogue } from '../../sync/catalogue.js'
import { assetRegisterPlace } from '../asset-addresses.js'
import { AssetConditionMark, DutyStateMark } from '../asset-marks.js'
import { AssetState } from '../asset-state.js'
import { cataloguePlaces } from '../catalogue-addresses.js'
import { factLink } from '../links.js'
import { officePlaces } from '../place-addresses.js'
import { kindLabel } from './assets.js'

/** The file of an asset as the server reads it today. */
export function assetFileQuery(id: string) {
  return {
    queryKey: ['assets', 'file', id],
    queryFn: () => request<AssetDetails>(`/assets/${id}`),
  } as const
}

/** The duties of an asset with how each stands today. */
export function assetDutiesQuery(id: string) {
  return {
    queryKey: ['assets', 'duties', id],
    queryFn: () => request<DutyReading[]>(`/assets/${id}/duties`),
  } as const
}

export const assetFileWords = {
  notThere:
    'Diese Anlage gibt es nicht mehr, oder sie liegt in einem Bereich, den dieser Zugang nicht sieht.',
  noConnection: 'Die Akte einer Anlage kommt vom Server. Gerade ist keine Verbindung da.',
  loading: 'Die Akte wird geladen.',
  failed: 'Die Akte ließ sich nicht laden. Sie kommt vom Server, mit Verbindung.',
  noDuties: 'Für diese Anlage ist keine Pflicht bestätigt.',
  resting:
    'Die Anlage ist nicht in Betrieb. Ihre Pflichten ruhen, bis sie wieder in Betrieb geht, und verfallen nicht.',
  noLifecycle: 'Noch kein Eintrag. Ohne Eintrag gilt die Anlage als in Betrieb.',
  noComponents: 'Diese Anlage hat keine Komponenten.',
} as const

/**
 * The file of an asset in the office, `anlagenakte()` of the boards (4.2 of
 * the concept): what is known about it with the fields of its kind, where it
 * stands and what it supplies, its components, its life cycle whole and its
 * duties with how each stands today.
 *
 * Read from the server, like the register: the condition of the asset and
 * the state of a duty follow from the evidence, which never travels to a
 * device. The names of the places come from the device. A decommissioned
 * asset keeps its past here, and its duties stand as resting.
 *
 * What the board draws beyond this arrives with what it shows: changing and
 * swapping the asset (#88, #89), confirming duties (#102), evidence (#109),
 * defects (#116), work orders (#117), documents (#97) and the label (#98).
 */
export function AssetFileScreen() {
  const { assetId } = useParams({ strict: false }) as { assetId?: string }
  const seesDuties = useRight('duty.read')
  const file = useQuery({ ...assetFileQuery(assetId ?? ''), enabled: assetId !== undefined })
  const duties = useQuery({
    ...assetDutiesQuery(assetId ?? ''),
    enabled: assetId !== undefined && seesDuties,
  })
  const catalogue = useCatalogue()
  const properties = useRecords('properties')
  const buildings = useRecords('buildings')
  const floors = useRecords('floors')
  const rooms = useRecords('rooms')
  const asset = file.data

  if (asset === undefined || assetId === undefined) {
    const gone = file.error instanceof RequestRefused && file.error.status === 404

    return (
      <Screen>
        <PageHead title={gone ? 'Nicht gefunden' : 'Anlage'} crumbs={[assetRegisterPlace]} />
        <Empty>
          {gone
            ? assetFileWords.notThere
            : file.isError
              ? assetFileWords.failed
              : file.fetchStatus === 'paused'
                ? assetFileWords.noConnection
                : assetFileWords.loading}
        </Empty>
      </Screen>
    )
  }

  const byId = (records: readonly RecordState[], id: unknown) =>
    records.find((record) => record['id'] === id) ?? null
  const property = byId(properties, asset.propertyId)
  const building = byId(buildings, asset.buildingId)
  const room = byId(rooms, asset.roomId)
  const floor = room ? byId(floors, room['floorId']) : null
  const kind = catalogue?.assetKind(asset.kind, today()) ?? null

  /** A room or a building the asset supplies, as somebody on its property would say it. */
  const supplied = asset.supplies.map((supply) => {
    const itsRoom = byId(rooms, supply.roomId)
    const itsBuilding = byId(buildings, itsRoom ? itsRoom['buildingId'] : supply.buildingId)
    const name = itsBuilding ? text(itsBuilding, 'name') : null

    return {
      key: supply.id,
      to: itsRoom
        ? officePlaces.room(String(itsRoom['id']))
        : itsBuilding
          ? officePlaces.building(String(itsBuilding['id']))
          : null,
      words: itsRoom
        ? [titleOfRoom(itsRoom), name].filter(Boolean).join(', ')
        : `${name ?? 'Ein Gebäude'}, ganzes Gebäude`,
    }
  })

  return (
    <Screen>
      <PageHead
        title={asset.name}
        crumbs={
          property
            ? placePath(
                placeAbove({
                  property,
                  building,
                  floor,
                  room,
                  // A component stands under the asset it is one of.
                  asset: asset.parent ? { id: asset.parent.id, name: asset.parent.name } : null,
                }),
                officePlaces,
              )
            : [assetRegisterPlace]
        }
        phoneBack={assetRegisterPlace}
        badges={
          <>
            {asset.number === null ? null : <NumberBadge>{asset.number}</NumberBadge>}
            <AssetState state={asset.lifecycleState ?? undefined} />
            <AssetConditionMark standing={asset} />
          </>
        }
        tags={
          <>
            <Status tone="neutral" icon={Zap}>
              {kindLabel(catalogue, asset.kind)}
            </Status>
            {kind ? <ReviewMarks review={kind.review} /> : null}
          </>
        }
        actions={<ChangesButton table="assets" id={assetId} />}
      />
      <div className="grid gap-3.5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-3.5">
          {seesDuties ? (
            <Duties
              duties={duties.data}
              catalogue={catalogue}
              resting={restsOn(asset.lifecycleState)}
            />
          ) : null}
        </div>
        <div className="flex min-w-0 flex-col gap-3.5">
          <Panel title="Stammdaten">
            {/* Wider than the facts of a place: a package names the fields of a kind. */}
            <FactList facts={masterData(asset, catalogue)} keyWidth={130} />
          </Panel>
          <Panel title="Standort und Versorgung">
            <FactList
              keyWidth={110}
              facts={[
                ...(asset.parent
                  ? [
                      {
                        label: 'Gehört zu',
                        value: (
                          <Link to={officePlaces.asset(asset.parent.id)} className={factLink}>
                            {asset.parent.name}
                          </Link>
                        ),
                      },
                    ]
                  : []),
                ...(room
                  ? [
                      {
                        label: 'Steht in',
                        value: (
                          <>
                            <Link to={officePlaces.room(String(room['id']))} className={factLink}>
                              {titleOfRoom(room)}
                            </Link>
                            {floor ? `, ${text(floor, 'name')}` : null}
                          </>
                        ),
                      },
                    ]
                  : []),
                {
                  label: 'Gebäude',
                  value: building ? (
                    <Link to={officePlaces.building(String(building['id']))} className={factLink}>
                      {text(building, 'name')}
                    </Link>
                  ) : null,
                },
                {
                  label: 'Versorgt',
                  value:
                    supplied.length === 0 ? (
                      <span className="text-ink-faint">nur den eigenen Standort</span>
                    ) : (
                      <ul className="flex flex-col gap-0.5">
                        {supplied.map((place) => (
                          <li key={place.key}>
                            {place.to ? (
                              <Link to={place.to} className={factLink}>
                                {place.words}
                              </Link>
                            ) : (
                              place.words
                            )}
                          </li>
                        ))}
                      </ul>
                    ),
                },
              ]}
            />
          </Panel>
          <Panel title="Komponenten">
            {asset.components.length === 0 ? (
              <p className="text-[13px] leading-[1.4] text-ink-muted">
                {assetFileWords.noComponents}
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {asset.components.map((component) => (
                  <li key={component.id} className="leading-[1.3]">
                    <Link to={officePlaces.asset(component.id)} className={factLink}>
                      {component.name}
                    </Link>
                    <div className="text-[12px] text-ink-faint">
                      {[component.number, kindLabel(catalogue, component.kind)]
                        .filter(Boolean)
                        .join(', ')}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Lifecycle asset={asset} />
        </div>
      </div>
    </Screen>
  )
}

/** Yes or no, the label of a choice, or the value as it is. */
function plainWords(
  of: { readonly kind: string; readonly options?: readonly ChoiceOption[] },
  value: AssetValue,
): string {
  if (typeof value === 'boolean') {
    return value ? 'Ja' : 'Nein'
  }

  return of.options?.find((option) => option.value === value)?.label ?? String(value)
}

/** The value of a characteristic: a number counts in a unit of the rule engine. */
function characteristicWords(of: Characteristic, value: AssetValue): string {
  return of.kind === 'number' && typeof value === 'number'
    ? ruleValueWords(value, of.unit)
    : plainWords(of, value)
}

/**
 * The value of a field of the kind: a number with the unit the field names, a
 * day as a day. A number without a unit is written as it is: it may be a year
 * or a count, and "2.021" is neither.
 */
function fieldWords(of: AssetField, value: AssetValue): string {
  if (of.kind === 'number' && typeof value === 'number') {
    return of.unit === undefined ? String(value) : `${value.toLocaleString('de-DE')} ${of.unit}`
  }

  return of.kind === 'date' ? date(value) : plainWords(of, value)
}

/** "Stammdaten": the kind and its package, then what is known, each only where it is. */
function masterData(asset: AssetDetails, catalogue: Catalogue | null): Fact[] {
  const kind = catalogue?.assetKind(asset.kind, today()) ?? null
  const packageName = asset.kind.slice(0, asset.kind.indexOf('.'))
  const itsPackage = catalogue?.packages.find((entry) => entry.name === packageName)
  const valued = <Of extends { readonly key: string; readonly label: string }>(
    of: Of,
    words: (of: Of, value: AssetValue) => string,
  ): Fact[] => {
    const value = asset.values[of.key]

    return value === undefined ? [] : [{ label: of.label, value: words(of, value) }]
  }
  const own = kind
    ? [
        ...kind.definition.characteristics.flatMap((each) => valued(each, characteristicWords)),
        ...kind.definition.fields.flatMap((each) => valued(each, fieldWords)),
      ]
    : []
  const known = (label: string, value: string | number | null): Fact[] =>
    value === null || value === '' ? [] : [{ label, value: String(value) }]

  return [
    {
      label: 'Anlagenart',
      value: itsPackage ? (
        <Link to={cataloguePlaces.assetKind(asset.kind)} className={factLink}>
          {kindLabel(catalogue, asset.kind)}
        </Link>
      ) : (
        kindLabel(catalogue, asset.kind)
      ),
    },
    ...(itsPackage
      ? [{ label: 'Paket', value: `${itsPackage.title}, Fassung ${itsPackage.version}` }]
      : []),
    ...known('Kennzeichen', asset.mark),
    ...known('Hersteller', asset.manufacturer),
    ...known('Typ', asset.model),
    ...known('Seriennummer', asset.serialNumber),
    ...own,
    ...known('Zählernummer', asset.meterNumber),
    ...known('Einheit', asset.meterUnit === null ? null : meterUnitSymbol[asset.meterUnit]),
    ...known('Baujahr', asset.yearBuilt),
    ...known('In Betrieb seit', asset.commissionedOn === null ? null : date(asset.commissionedOn)),
    ...known(
      'Gewährleistung bis',
      asset.warrantyEndsOn === null ? null : date(asset.warrantyEndsOn),
    ),
  ]
}

/** Under the name of a duty: where it comes from and how often it falls due. */
function dutyLine(duty: DutyReading, catalogue: Catalogue | null): string {
  const kind =
    duty.kind === null || duty.kindVersion === null
      ? null
      : (catalogue?.dutyKindVersion(duty.kind, duty.kindVersion) ?? null)
  const source =
    kind?.definition.source ??
    [duty.basis === null ? null : dutyBasisLabel[duty.basis], duty.sourceNote]
      .filter(Boolean)
      .join(', ')

  return [source, `alle ${intervalWords(dutyInterval(duty))}`].filter(Boolean).join(' · ')
}

/**
 * "Pflichten": the duties of the asset that have not ended, each with the
 * last day it was met, its next appointment and its state today. A duty of
 * an asset that is not in service rests, and has no appointment to name.
 */
function Duties({
  duties,
  catalogue,
  resting,
}: {
  readonly duties: readonly DutyReading[] | undefined
  readonly catalogue: Catalogue | null
  readonly resting: boolean
}) {
  const title = 'Pflichten'

  if (duties === undefined || duties.length === 0) {
    return (
      <Panel title={title}>
        <p className="text-[13px] leading-[1.4] text-ink-muted">
          {duties === undefined ? 'Die Pflichten werden geladen.' : assetFileWords.noDuties}
        </p>
      </Panel>
    )
  }

  const nameOf = (duty: DutyReading, className?: string): ReactNode =>
    duty.kind === null ? (
      duty.title
    ) : (
      <Link to={cataloguePlaces.dutyKind(duty.kind)} {...(className ? { className } : {})}>
        {duty.title}
      </Link>
    )
  const reviewOf = (duty: DutyReading) =>
    duty.kind === null || duty.kindVersion === null
      ? null
      : (catalogue?.dutyKindVersion(duty.kind, duty.kindVersion)?.review ?? null)
  const lastOf = (duty: DutyReading) => (duty.lastMetOn === null ? null : date(duty.lastMetOn))
  const nextOf = (duty: DutyReading) =>
    resting || duty.appointment === null ? null : date(duty.appointment.dueOn)
  const state = (duty: DutyReading) => (
    <DutyStateMark state={duty.state} until={duty.appointment?.dueOn ?? null} />
  )

  return (
    <TablePanel
      title={title}
      caption="Pflichten dieser Anlage mit letztem Nachweis, nächstem Termin und Zustand"
      cards={duties.map((duty) => ({
        key: duty.id,
        title: nameOf(duty, cardLink),
        sub: [
          dutyLine(duty, catalogue),
          lastOf(duty) === null ? 'noch kein Nachweis' : `zuletzt ${String(lastOf(duty))}`,
        ].join(' · '),
        right: state(duty),
      }))}
      {...(resting ? { note: assetFileWords.resting } : {})}
    >
      <thead>
        <tr>
          <Column className="min-w-[220px]">Pflicht</Column>
          <Column className="w-[140px] min-w-[120px]">Letzter Nachweis</Column>
          <Column numeric className="w-[120px] min-w-[104px]">
            Nächster Termin
          </Column>
          <Column className="w-[190px] min-w-[150px]">Zustand</Column>
        </tr>
      </thead>
      <tbody>
        {duties.map((duty) => {
          const review = reviewOf(duty)

          return (
            <tr key={duty.id}>
              <Cell>
                <div className="leading-[1.35]">
                  <div className="font-medium">{nameOf(duty, factLink)}</div>
                  <div className="text-[12px] text-ink-faint">{dutyLine(duty, catalogue)}</div>
                  {review ? (
                    <div className="mt-[3px] flex flex-wrap gap-1">
                      <ReviewMarks review={review} />
                    </div>
                  ) : null}
                </div>
              </Cell>
              <Cell>{lastOf(duty) ?? <span className="text-ink-faint">noch keiner</span>}</Cell>
              <Cell numeric>{nextOf(duty)}</Cell>
              <Cell>{state(duty)}</Cell>
            </tr>
          )
        })}
      </tbody>
    </TablePanel>
  )
}

/**
 * "Lebenszyklus": every entry, the newest first, so that an asset taken out
 * of service still says since when it ran (2.2 of the concept). The entry
 * that holds today is the first that has begun.
 */
function Lifecycle({ asset }: { readonly asset: AssetDetails }) {
  const day = today()
  const entries = [...asset.lifecycle].sort((left, right) =>
    right.validFrom.localeCompare(left.validFrom),
  )
  const current = entries.find((entry) => entry.validFrom <= day)

  return (
    <Panel title="Lebenszyklus">
      {entries.length === 0 ? (
        <p className="text-[13px] leading-[1.4] text-ink-muted">{assetFileWords.noLifecycle}</p>
      ) : (
        <ol className="flex flex-col gap-[5px] text-[13px] max-sm:text-[15px]">
          {entries.map((entry) => (
            <li key={entry.id} className="flex items-baseline justify-between gap-2">
              <span className={entry === current ? 'font-semibold' : 'text-ink-muted'}>
                {lifecycleStateLabel[entry.state]}
                {entry === current ? <span className="sr-only"> (heute)</span> : null}
              </span>
              <span className="numeric text-ink-muted">
                {entry.validFrom > day ? 'ab' : 'seit'} {date(entry.validFrom)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  )
}
