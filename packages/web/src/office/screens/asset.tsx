import {
  assetBookCountWords,
  assetBookTitle,
  type AssetDetails,
  type AssetEvidenceEntry,
  type AssetField,
  assetFieldValueWords,
  type AssetValue,
  type Catalogue,
  characteristicValueWords,
  dutyInterval,
  type DutyReading,
  dutyTermWords,
  evidenceResultLabel,
  intervalWords,
  isOwnKind,
  type LifecycleEntry,
  lifecycleStateLabel,
  meterUnitSymbol,
  type RecordState,
  restsOn,
  type ShutDownDefect,
  shutDownLabel,
} from '@opengewerk/haustechnik-domain'
import {
  Button,
  cardLink,
  Cell,
  Column,
  IconButton,
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
  NoteBox,
  PageHead,
  Screen,
} from '@opengewerk/platform-web/office'
import { useRight } from '@opengewerk/platform-web/session'
import { request, RequestRefused, text, useRecords } from '@opengewerk/platform-web/sync'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { ArrowLeftRight, Ban, FileText, Pencil, Plus, X, Zap } from 'lucide-react'
import { Fragment, lazy, type ReactNode, Suspense, useState } from 'react'

import { holdsBoards } from '../../app/electrical.js'
import { assetEvidenceQuery } from '../../app/evidence.js'
import { placePath } from '../../app/place-path.js'
import { placeAbove, titleOfRoom } from '../../app/place-records.js'
import { ReviewMarks } from '../../app/review-marks.js'
import { useCatalogue } from '../../sync/catalogue.js'
import { assetForms, assetRegisterPlace } from '../asset-addresses.js'
import {
  AssetSuppliesDialog,
  LifecycleEntryDialog,
  MoveAssetDialog,
  TakeBackLifecycleEntry,
} from '../asset-dialogs.js'
import { AssetConditionMark, DutyStateMark } from '../../app/asset-marks.js'
import { AssetCoverCard } from '../asset-cover.js'
import { AssetBoardsCard } from '../boards-card.js'
import { ExchangeAssetDialog, mayBeExchanged } from '../asset-exchange.js'
import { AssetState } from '../asset-state.js'
import { cataloguePlaces } from '../catalogue-addresses.js'
import { defectPlaces } from '../defect-addresses.js'
import { DocumentsCard } from '../documents.js'
import { ExpectedDocumentsCard } from '../expected-documents.js'
import { TasksCard } from '../tasks.js'
import { dutyPlaces } from '../duty-addresses.js'
import { dutySourceWords, kindOfDuty, NewDutyButton } from '../duty-words.js'
import { EvidenceNumber, ResultMark, StandingMark } from '../evidence-words.js'
import { LabelCardOf } from '../labels.js'
import { factLink } from '../links.js'
import { officePlaces } from '../place-addresses.js'
import { kindLabel } from './assets.js'
import { AssetDefectsCard, useClassWord } from './defects.js'
import { AssetFaultsCard } from './fault-reports.js'
import { ProposalsNote } from './proposals.js'
import { AssetOrdersCard, NewOrderAtAssetButton } from './work-orders.js'
import { TimelineButton } from '../timeline.js'

// Loaded when the book is asked for (#437), like the register of evidence.
const AssetBookDialog = lazy(async () => ({
  default: (await import('../asset-book.js')).AssetBookDialog,
}))

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
  noEvidence: 'Für diese Anlage ist noch kein Nachweis festgehalten.',
  evidenceLoading: 'Die Nachweise werden geladen.',
  resting:
    'Die Anlage ist nicht in Betrieb. Ihre Pflichten ruhen, bis sie wieder in Betrieb geht, und verfallen nicht.',
  noLifecycle: 'Noch kein Eintrag. Ohne Eintrag gilt die Anlage als in Betrieb.',
  noComponents: 'Diese Anlage hat keine Komponenten.',
  distinctFrom: 'Keine Dublette von',
  removed: '(entfernt)',
  shownOnEntry: 'Beim Anlegen als mögliche Dublette gezeigt.',
  replaces: 'Ersetzt',
  replacedBy: 'Ersetzt durch',
  /** Until when an asset is out of service by a defect, and what goes on meanwhile (#345). */
  shutDownUntil: (defects: number) =>
    defects === 1
      ? 'Die Anlage bleibt außer Betrieb, bis der Mangel behoben ist, also bis zur Unterschrift unter seinem Auftrag. Ihre Pflichten laufen weiter.'
      : 'Die Anlage bleibt außer Betrieb, bis jeder dieser Mängel behoben ist, also bis zur Unterschrift unter seinem Auftrag. Ihre Pflichten laufen weiter.',
  /** For whoever does not read the defects: the state, and not what is wrong. */
  shutDownUnread:
    'Ein Mangel macht die Anlage unsicher. Sie bleibt außer Betrieb, bis er behoben ist. Ihre Pflichten laufen weiter.',
  shutDownLifecycle:
    'Außer Betrieb durch Mangel gilt, solange ein Mangel sie unsicher macht. Ein Eintrag hier ändert das nicht.',
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
 * Whoever takes assets into the register changes what is known about it, adds
 * a component and says what it supplies; its life cycle and moving it are for
 * whoever keeps the assets (section 7 of the concept, #88), and neither is
 * offered to anybody else. So is its exchange (#89): offered once, and not
 * for a measuring point, whose meter is exchanged at the point. Afterwards
 * the two files name each other.
 *
 * Its label and its documents stand in the narrow column, after the life
 * cycle (#98, #97): the label with its QR code, made, printed and blocked
 * there, and what is filed at this asset, the one changed last first. Both
 * are read from the device.
 *
 * What the board draws beyond this arrives with what it shows: confirming
 * duties (#102), evidence (#109), defects (#116) and work orders (#117). A
 * low-voltage installation lists its boards under its evidence (#349).
 */
export function AssetFileScreen() {
  const { assetId } = useParams({ strict: false }) as { assetId?: string }
  const navigate = useNavigate()
  const seesDuties = useRight('duty.read')
  const seesEvidence = useRight('evidence.read')
  const records = useRight('asset.record')
  const keeps = useRight('asset.write')
  const [changing, setChanging] = useState<
    'place' | 'supplies' | 'lifecycle' | 'exchange' | 'book' | null
  >(null)
  const [takingBack, setTakingBack] = useState<LifecycleEntry | null>(null)
  const file = useQuery({ ...assetFileQuery(assetId ?? ''), enabled: assetId !== undefined })
  const duties = useQuery({
    ...assetDutiesQuery(assetId ?? ''),
    enabled: assetId !== undefined && seesDuties,
  })
  const evidence = useQuery({
    ...assetEvidenceQuery(assetId ?? ''),
    enabled: assetId !== undefined && seesEvidence,
  })
  const catalogue = useCatalogue()
  const properties = useRecords('properties')
  const buildings = useRecords('buildings')
  const floors = useRecords('floors')
  const rooms = useRecords('rooms')
  const asset = file.data

  if (asset === undefined || assetId === undefined) {
    return <AssetFileUnread file={file} />
  }

  const stopChanging = () => {
    setChanging(null)
  }

  const byId = (records: readonly RecordState[], id: unknown) =>
    records.find((record) => record['id'] === id) ?? null
  const property = byId(properties, asset.propertyId)
  const building = byId(buildings, asset.buildingId)
  const room = byId(rooms, asset.roomId)
  const floor = room ? byId(floors, room['floorId']) : null
  const kind = catalogue?.assetKind(asset.kind, today()) ?? null
  // The book of the asset under the name its kind gives it (#437).
  const book = assetBookTitle(kind?.definition.book).title

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
            <AssetState state={asset.lifecycleState ?? undefined} shutDown={asset.shutDown} />
            <AssetConditionMark standing={asset} />
          </>
        }
        tags={
          <>
            <Status tone="neutral" icon={Zap}>
              {kindLabel(catalogue, asset.kind)}
            </Status>
            {/* A kind of the operator's own is accepted by nobody, and says nothing of it (#62). */}
            {kind && !isOwnKind(kind.key) ? <ReviewMarks review={kind.review} /> : null}
          </>
        }
        actions={
          <>
            <TimelineButton place={{ assetId }} />
            <ChangesButton table="assets" id={assetId} />
            {records ? (
              <Button
                icon={Pencil}
                onClick={() => {
                  void navigate({ to: assetForms.edit(assetId) })
                }}
              >
                Bearbeiten
              </Button>
            ) : null}
            {keeps && mayBeExchanged(asset) ? (
              <Button
                icon={ArrowLeftRight}
                onClick={() => {
                  setChanging('exchange')
                }}
              >
                Tauschen
              </Button>
            ) : null}
            <NewOrderAtAssetButton assetId={assetId} />
          </>
        }
      />
      {asset.shutDown ? <ShutDownNote defects={asset.shutDownBy} /> : null}
      <div className="grid gap-3.5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-3.5">
          {seesDuties ? (
            <Duties
              duties={duties.data}
              catalogue={catalogue}
              resting={restsOn(asset.lifecycleState)}
              action={<NewDutyButton start={{ assetId: asset.id }} />}
              proposals={<ProposalsNote assetId={asset.id} />}
            />
          ) : null}
          {seesEvidence ? (
            <AssetEvidence
              evidence={evidence.data}
              action={
                <Button
                  size="small"
                  icon={FileText}
                  onClick={() => {
                    setChanging('book')
                  }}
                >
                  {book}
                </Button>
              }
            />
          ) : null}
          {/* The boards of a low-voltage installation, under its evidence (#349). */}
          {holdsBoards(asset.kind) ? (
            <AssetBoardsCard assetId={assetId} assetName={asset.name} />
          ) : null}
          <AssetDefectsCard assetId={assetId} />
          {/* The faults reported at the asset (#331), for whoever accepts them. */}
          <AssetFaultsCard assetId={assetId} />
          <AssetOrdersCard assetId={assetId} />
        </div>
        <div className="flex min-w-0 flex-col gap-3.5">
          <Panel
            title="Stammdaten"
            action={
              records ? (
                <Button
                  size="small"
                  aria-label="Stammdaten bearbeiten"
                  onClick={() => {
                    void navigate({ to: assetForms.edit(assetId) })
                  }}
                >
                  Bearbeiten
                </Button>
              ) : null
            }
          >
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
            {records || keeps ? (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {keeps ? (
                  <Button
                    size="small"
                    onClick={() => {
                      setChanging('place')
                    }}
                  >
                    Verlegen
                  </Button>
                ) : null}
                {records ? (
                  <Button
                    size="small"
                    onClick={() => {
                      setChanging('supplies')
                    }}
                  >
                    Versorgung ändern
                  </Button>
                ) : null}
              </div>
            ) : null}
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
                    {/* A defect at a component puts the component out of service and not this asset (#345). */}
                    {component.shutDown ? (
                      <div className="mt-1">
                        <AssetState
                          state={component.lifecycleState ?? undefined}
                          shutDown={component.shutDown}
                        />
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {records ? (
              <div className="mt-2.5 flex">
                <Button
                  size="small"
                  icon={Plus}
                  onClick={() => {
                    void navigate({ to: assetForms.component(assetId) })
                  }}
                >
                  Komponente hinzufügen
                </Button>
              </div>
            ) : null}
          </Panel>
          <Lifecycle
            asset={asset}
            {...(keeps
              ? {
                  onEnter: () => {
                    setChanging('lifecycle')
                  },
                  onTakeBack: setTakingBack,
                }
              : {})}
          />
          {/* The warranty, the contracts that cover it and the orders with a warranty of their own (#329). */}
          <AssetCoverCard assetId={assetId} warrantyEndsOn={asset.warrantyEndsOn} />
          <LabelCardOf holder="assets" id={assetId} />
          {/* What the package expects of the kind, and whether it lies here (#347). */}
          <ExpectedDocumentsCard
            kind={kind?.definition ?? null}
            packageTitle={
              isOwnKind(asset.kind)
                ? null
                : (catalogue?.packages.find(
                    (entry) => entry.name === asset.kind.slice(0, asset.kind.indexOf('.')),
                  )?.title ?? asset.kind)
            }
            place={{ propertyId: asset.propertyId, assetId }}
            at={[asset.number, asset.name].filter(Boolean).join(' ')}
          />
          <DocumentsCard
            place={{ propertyId: asset.propertyId, assetId }}
            at={[asset.number, asset.name].filter(Boolean).join(' ')}
          />
          <TasksCard
            field="assetId"
            id={assetId}
            propertyId={asset.propertyId}
            areaId={asset.areaId}
          />
        </div>
      </div>
      {changing === 'place' ? <MoveAssetDialog asset={asset} onClose={stopChanging} /> : null}
      {changing === 'supplies' ? (
        <AssetSuppliesDialog asset={asset} onClose={stopChanging} />
      ) : null}
      {changing === 'lifecycle' ? (
        <LifecycleEntryDialog asset={asset} onClose={stopChanging} />
      ) : null}
      {changing === 'exchange' ? (
        <ExchangeAssetDialog asset={asset} onClose={stopChanging} />
      ) : null}
      {changing === 'book' ? (
        <Suspense fallback={null}>
          <AssetBookDialog
            assetId={asset.id}
            asset={[asset.number, asset.name].filter(Boolean).join(' ')}
            title={book}
            count={
              evidence.data === undefined
                ? null
                : assetBookCountWords(
                    evidence.data.map((entry) => entry.performedOn),
                    asset.lifecycle.map((entry) => entry.validFrom),
                  )
            }
            onClose={stopChanging}
          />
        </Suspense>
      ) : null}
      {takingBack ? (
        <TakeBackLifecycleEntry
          asset={asset}
          entry={takingBack}
          onClose={() => {
            setTakingBack(null)
          }}
        />
      ) : null}
    </Screen>
  )
}

/**
 * In place of the file while there is none to show: still on its way, not
 * there for this person, or out of reach without a connection. The forms of
 * an asset stand on the same file and say the same.
 */
export function AssetFileUnread({
  file,
}: {
  readonly file: Pick<UseQueryResult<AssetDetails>, 'error' | 'isError' | 'fetchStatus'>
}) {
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

/** The value of a field of the kind, a day as this screen writes a day. */
function fieldWords(of: AssetField, value: AssetValue): string {
  return assetFieldValueWords(of, value, date)
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
        ...kind.definition.characteristics.flatMap((each) =>
          valued(each, characteristicValueWords),
        ),
        ...kind.definition.fields.flatMap((each) => valued(each, fieldWords)),
      ]
    : []
  const known = (label: string, value: string | number | null): Fact[] =>
    value === null || value === '' ? [] : [{ label, value: String(value) }]
  /** The other asset of an exchange (#89), by number and name and the way to its file. */
  const exchanged = (label: string, other: AssetDetails['replaces']): Fact[] =>
    other === null
      ? []
      : [
          {
            label,
            value: (
              <Link to={officePlaces.asset(other.id)} className={factLink}>
                {[other.number, other.name].filter(Boolean).join(' ')}
              </Link>
            ),
          },
        ]

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
    ...exchanged(assetFileWords.replaces, asset.replaces),
    ...exchanged(assetFileWords.replacedBy, asset.replacedBy),
    ...(asset.distinctFromAssets.length + asset.distinctFromElsewhere > 0
      ? [{ label: assetFileWords.distinctFrom, value: <DistinctFrom asset={asset} /> }]
      : []),
  ]
}

/**
 * "Keine Dublette von" (#171): the assets this one was held against when it
 * was entered and found to be another, each by number and name and the way
 * to its file. One that was removed since has no file to open, and one
 * beyond the areas of whoever reads is counted and not named.
 */
function DistinctFrom({ asset }: { readonly asset: AssetDetails }) {
  const named = asset.distinctFromAssets
  const more = asset.distinctFromElsewhere
  const further = named.length > 0

  return (
    <ul className="flex flex-col gap-0.5">
      {named.map((other) => {
        const title = [other.number, other.name].filter(Boolean).join(' ')

        return (
          <li key={other.id}>
            {other.removed ? (
              <>
                {title} <span className="text-ink-faint">{assetFileWords.removed}</span>
              </>
            ) : (
              <Link to={officePlaces.asset(other.id)} className={factLink}>
                {title}
              </Link>
            )}
          </li>
        )
      })}
      {more === 0 ? null : (
        <li>
          {more === 1
            ? `eine ${further ? 'weitere ' : ''}Anlage`
            : `${String(more)} ${further ? 'weitere ' : ''}Anlagen`}{' '}
          außerhalb Ihrer Bereiche
        </li>
      )}
      <li className="text-[12px] text-ink-faint">{assetFileWords.shownOnEntry}</li>
    </ul>
  )
}

/** Under the name of a duty: where it comes from and how often it falls due. */
export function dutyLine(duty: DutyReading, catalogue: Catalogue | null): string {
  const interval = dutyInterval(duty)
  // A duty that falls due once names its due day (#439).
  const term = interval === null ? dutyTermWords(duty) : `alle ${intervalWords(interval)}`

  return [dutySourceWords(duty, catalogue), term].filter(Boolean).join(' · ')
}

/**
 * "Pflichten": the duties of an asset or of a room that have not ended, each
 * with the last day it was met, its next appointment and its state today,
 * and its name the way to its page. A duty of an asset that is not in
 * service rests, and has no appointment to name.
 */
export function Duties({
  duties,
  catalogue,
  resting,
  action,
  proposals,
  words,
}: {
  readonly duties: readonly DutyReading[] | undefined
  readonly catalogue: Catalogue | null
  readonly resting: boolean
  /** In the head of the card: the way to a duty of the operator's own at this place. */
  readonly action?: ReactNode
  /** Under the card of an asset: the line of the proposals of the catalogue (#102). */
  readonly proposals?: ReactNode
  /** What the card is called and says while it is empty or cannot be read, for a room. */
  readonly words?: {
    readonly title: string
    readonly caption: string
    readonly none: string
    readonly unread?: string
  }
}) {
  const title = words?.title ?? 'Pflichten'

  if (duties === undefined || duties.length === 0) {
    return (
      <Panel title={title} action={action}>
        <p className="text-[13px] leading-[1.4] text-ink-muted">
          {duties === undefined
            ? (words?.unread ?? 'Die Pflichten werden geladen.')
            : (words?.none ?? assetFileWords.noDuties)}
        </p>
        {proposals ? (
          <p className="mt-1.5 text-[13px] leading-[1.4] text-ink-muted">{proposals}</p>
        ) : null}
      </Panel>
    )
  }

  // The name of a duty leads to its page; from there the way goes on to its
  // kind in the catalogue.
  const nameOf = (duty: DutyReading, className?: string): ReactNode => (
    <Link to={dutyPlaces.duty(duty.id)} {...(className ? { className } : {})}>
      {duty.title}
    </Link>
  )
  const reviewOf = (duty: DutyReading) => kindOfDuty(duty, catalogue)?.review ?? null
  const lastOf = (duty: DutyReading) => (duty.lastMetOn === null ? null : date(duty.lastMetOn))
  // The number leads to the page of the evidence, the day stands under it;
  // one taken over from an earlier application is named by its day.
  const lastCell = (duty: DutyReading): ReactNode => {
    const last = duty.lastEvidence

    if (last === null) {
      return <span className="text-ink-faint">noch keiner</span>
    }

    return (
      <div className="leading-[1.32]">
        <EvidenceNumber
          id={last.id}
          number={last.origin === 'legacy' ? date(last.performedOn) : last.number}
        />
        <div className="text-[12px] text-ink-faint">
          {last.origin === 'legacy' ? 'Altbestand' : date(last.performedOn)}
        </div>
      </div>
    )
  }
  const nextOf = (duty: DutyReading) =>
    resting || duty.appointment === null ? null : date(duty.appointment.dueOn)
  const state = (duty: DutyReading) => (
    <DutyStateMark state={duty.state} until={duty.appointment?.dueOn ?? null} />
  )

  return (
    <TablePanel
      title={title}
      action={action}
      caption={
        words?.caption ??
        'Pflichten dieser Anlage mit letztem Nachweis, nächstem Termin und Zustand'
      }
      cards={duties.map((duty) => ({
        key: duty.id,
        title: nameOf(duty, cardLink),
        sub: [
          dutyLine(duty, catalogue),
          lastOf(duty) === null ? 'noch kein Nachweis' : `zuletzt ${String(lastOf(duty))}`,
        ].join(' · '),
        right: state(duty),
      }))}
      {...(resting || proposals
        ? {
            note: (
              <>
                {resting ? <p>{assetFileWords.resting}</p> : null}
                {proposals ? <p>{proposals}</p> : null}
              </>
            ),
          }
        : {})}
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
              <Cell>{lastCell(duty)}</Cell>
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
 * "Nachweise": every evidence of a duty at the asset, the newest first, with
 * its duty and what it means for the appointment, its number the way to its
 * page (2.6 of the concept). One replaced or declared invalid stays in the
 * list and says so.
 */
function AssetEvidence({
  evidence,
  action,
}: {
  readonly evidence: readonly AssetEvidenceEntry[] | undefined
  /** "Anlagenbuch": all of them with the life cycle, as a PDF or a table (#437). */
  readonly action: ReactNode
}) {
  const title = 'Nachweise'

  if (evidence === undefined || evidence.length === 0) {
    return (
      <Panel title={title} action={action}>
        <p className="text-[13px] leading-[1.4] text-ink-muted">
          {evidence === undefined ? assetFileWords.evidenceLoading : assetFileWords.noEvidence}
        </p>
      </Panel>
    )
  }

  const back = (entry: AssetEvidenceEntry) => (entry.standing === 'counts' ? '' : 'text-ink-muted')

  return (
    <TablePanel
      title={title}
      action={action}
      caption="Nachweise dieser Anlage mit Pflicht, Tag, Ergebnis und Bedeutung für die Frist"
      cards={evidence.map((entry) => ({
        key: entry.id,
        title: <EvidenceNumber id={entry.id} number={entry.number} />,
        sub: [entry.dutyTitle, date(entry.performedOn), evidenceResultLabel[entry.result]].join(
          ' · ',
        ),
        right: <StandingMark standing={entry.standing} emptied={entry.emptied === true} />,
      }))}
    >
      <thead>
        <tr>
          {/* Beside a column of 320 pixels the table has 677 at a width of
              1280: what the columns ask for stays below that. */}
          <Column className="w-[112px] min-w-[104px]">Nummer</Column>
          <Column className="min-w-[120px]">Pflicht</Column>
          <Column className="w-[88px] min-w-[80px]">Tag</Column>
          <Column className="w-[134px] min-w-[124px]">Ergebnis</Column>
          <Column className="w-[160px] min-w-[150px]">Für die Frist</Column>
        </tr>
      </thead>
      <tbody>
        {evidence.map((entry) => (
          <tr key={entry.id}>
            <Cell className={back(entry)}>
              <EvidenceNumber id={entry.id} number={entry.number} />
            </Cell>
            <Cell className={back(entry)}>{entry.dutyTitle}</Cell>
            <Cell className={back(entry)}>{date(entry.performedOn)}</Cell>
            <Cell>
              <ResultMark result={entry.result} />
            </Cell>
            <Cell>
              <StandingMark standing={entry.standing} emptied={entry.emptied === true} />
            </Cell>
          </tr>
        ))}
      </tbody>
    </TablePanel>
  )
}

/**
 * "Lebenszyklus": every entry, the newest first, so that an asset taken out
 * of service still says since when it ran (2.2 of the concept). The entry
 * that holds today is the first that has begun.
 *
 * Entering a state and taking an entry back are handed in by the file for
 * whoever keeps the assets; without them the card only reads.
 */
function Lifecycle({
  asset,
  onEnter,
  onTakeBack,
}: {
  readonly asset: AssetDetails
  readonly onEnter?: () => void
  readonly onTakeBack?: (entry: LifecycleEntry) => void
}) {
  const day = today()
  const entries = [...asset.lifecycle].sort((left, right) =>
    right.validFrom.localeCompare(left.validFrom),
  )
  const current = entries.find((entry) => entry.validFrom <= day)

  return (
    <Panel
      title="Lebenszyklus"
      action={
        onEnter ? (
          <Button size="small" icon={Plus} onClick={onEnter}>
            Eintragen
          </Button>
        ) : null
      }
    >
      {entries.length === 0 ? (
        <p className="text-[13px] leading-[1.4] text-ink-muted">{assetFileWords.noLifecycle}</p>
      ) : (
        <ol className="flex flex-col gap-[5px] text-[13px] max-sm:text-[15px]">
          {entries.map((entry) => (
            <li key={entry.id} className="flex items-center gap-2">
              <span className={entry === current ? 'grow font-semibold' : 'grow text-ink-muted'}>
                {lifecycleStateLabel[entry.state]}
                {entry === current ? <span className="sr-only"> (heute)</span> : null}
              </span>
              <span className="numeric text-ink-muted">
                {entry.validFrom > day ? 'ab' : 'seit'} {date(entry.validFrom)}
              </span>
              {onTakeBack ? (
                <IconButton
                  label={`${lifecycleStateLabel[entry.state]} ${entry.validFrom > day ? 'ab' : 'seit'} ${date(entry.validFrom)} zurücknehmen`}
                  className="-my-1.5 h-7! min-h-7! w-7! min-w-7! max-sm:h-10! max-sm:min-h-10! max-sm:w-10! max-sm:min-w-10!"
                  onClick={() => {
                    onTakeBack(entry)
                  }}
                >
                  <X size={14} strokeWidth={2.2} aria-hidden="true" />
                </IconButton>
              ) : null}
            </li>
          ))}
        </ol>
      )}
      {asset.shutDown ? (
        <p className="mt-2 text-[12px] leading-[1.4] text-ink-muted">
          {assetFileWords.shutDownLifecycle}
        </p>
      ) : null}
    </Panel>
  )
}

/**
 * What the file says first while a defect puts the asset out of service
 * (#345, `anlagenakte(shut=True)` of the boards): each defect that does,
 * with its class and the day it was found, and that the asset stays out of
 * service until it is remedied while its duties go on. Whoever does not read
 * the defects is told the state and not what is wrong.
 */
function ShutDownNote({ defects }: { readonly defects: readonly ShutDownDefect[] | null }) {
  const classWord = useClassWord()

  return (
    <NoteBox tone="conflict" icon={Ban}>
      <strong>{shutDownLabel}:</strong>{' '}
      {defects === null ? (
        assetFileWords.shutDownUnread
      ) : (
        <>
          {defects.map((defect, index) => (
            <Fragment key={defect.id}>
              {index === 0 ? null : '; '}
              <Link to={defectPlaces.defect(defect.id)} className="underline">
                {defect.description}
              </Link>
              , {classWord(defect.defectClass)}, festgestellt am {date(defect.foundOn)}
            </Fragment>
          ))}
          . {assetFileWords.shutDownUntil(defects.length)}
        </>
      )}
    </NoteBox>
  )
}
