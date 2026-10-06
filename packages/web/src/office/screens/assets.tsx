import {
  assetConditionLabel,
  assetConditions,
  type AssetEntry,
  type AssetRegister,
  type AssetRegisterFilter,
  type Catalogue,
  costGroupAbove,
  costGroupWords,
  type LifecycleState,
  lifecycleStateLabel,
  lifecycleStates,
  type RecordState,
  withoutLifecycle,
} from '@opengewerk/haustechnik-domain'
import { Button, cardLink, Cell, Column, Panel, TablePanel } from '@opengewerk/platform-web'
import { today } from '@opengewerk/platform-web/format'
import { Empty, PageHead, Screen } from '@opengewerk/platform-web/office'
import { useRight } from '@opengewerk/platform-web/session'
import { maybeText, request, text, useRecords } from '@opengewerk/platform-web/sync'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { useMemo } from 'react'

import { useCatalogue } from '../../sync/catalogue.js'
import {
  assetForms,
  assetRegisterPlace,
  newAssetSearch,
  registerFilterOf,
  registerRequest,
  registerSearch,
} from '../asset-addresses.js'
import { PrintLabelsButton } from '../labels.js'
import { AssetConditionMark } from '../asset-marks.js'
import { AssetState } from '../asset-state.js'
import { officePlaces } from '../place-addresses.js'
import { countedAssets } from '../place-pages.js'
import { assetKindChoices, PlaceFilter, RegisterFilter as Filter } from '../register-filter.js'

/**
 * "Anlagen" in the office, `anlagen()` of the boards (4.2 of the concept): the
 * register over every building, narrowed by place, cost group, kind, condition
 * and life cycle.
 *
 * The list comes from the server a page at a time and is narrowed there, so
 * that a few thousand assets never lie in the browser at once. The condition
 * of an asset is worked out there as well, from its duties, their evidence
 * and its defects on the day it is read; the evidence never travels to a
 * device. So this screen needs a connection, and says so without one.
 *
 * What it is narrowed by stands in the address (`asset-addresses.ts`). The
 * names of the places and of the kinds are read from the device, which holds
 * every place of the areas of the person and the catalogue of its server.
 */
/** "Die 12 gelisteten Anlagen", what a print of labels for the list is called. */
export function listedWords(total: number): string {
  return total === 1 ? 'Die eine gelistete Anlage' : `Die ${String(total)} gelisteten Anlagen`
}

export function AssetRegisterScreen() {
  const search = useSearch({ strict: false })
  const filter = useMemo(() => registerFilterOf(search), [search])
  const navigate = useNavigate()
  const records = useRight('asset.record')
  const catalogue = useCatalogue()
  const properties = useRecords('properties')
  const buildings = useRecords('buildings')
  const rooms = useRecords('rooms')

  const pages = useInfiniteQuery({
    queryKey: ['assets', 'register', filter],
    queryFn: ({ pageParam }) => request<AssetRegister>(registerRequest(filter, pageParam)),
    initialPageParam: 0,
    getNextPageParam: (last, all) => {
      const shown = all.reduce((sum, page) => sum + page.assets.length, 0)

      return shown < last.total ? shown : undefined
    },
  })

  const narrowed = Object.keys(filter).length > 0
  const first = pages.data?.pages[0]
  const assets = pages.data?.pages.flatMap((page) => page.assets) ?? []

  const show = (next: AssetRegisterFilter) => {
    void navigate({ to: assetRegisterPlace.to, search: registerSearch(next), replace: true })
  }
  /** The filter with one part set, or without it for the choice "all". */
  const set = (name: keyof AssetRegisterFilter, value: string) => {
    const { [name]: _, ...rest } = filter

    show(value === '' ? rest : { ...rest, [name]: value })
  }

  const nameOf = (records: readonly RecordState[], id: string | null) =>
    id === null ? null : maybeText(records.find((record) => record['id'] === id) ?? null, 'name')
  /** "Schulzentrum Am Lindenhain, Schulhaus, E.14": property, building and the room by its number. */
  const placeOf = (asset: AssetEntry): string => {
    const room = rooms.find((record) => record['id'] === asset.roomId)

    return [
      nameOf(properties, asset.propertyId),
      nameOf(buildings, asset.buildingId),
      room ? (maybeText(room, 'number') ?? maybeText(room, 'name')) : null,
    ]
      .filter((part) => part !== null && part !== '')
      .join(', ')
  }
  const kindOf = (asset: AssetEntry) => kindLabel(catalogue, asset.kind)

  return (
    <Screen>
      <PageHead
        title="Anlagen"
        {...(first ? { count: countedIn(first) } : {})}
        {...(records
          ? {
              actions: (
                <>
                  {/* A label for everything the list shows, under the filter
                      it is narrowed by, or a sheet that hangs on nothing yet. */}
                  <PrintLabelsButton
                    offers={
                      first && first.total > 0
                        ? [
                            {
                              key: 'assets',
                              label: listedWords(first.total),
                              batch: { what: 'assets', filter },
                              count: first.total,
                            },
                          ]
                        : []
                    }
                    properties={properties.map((property) => ({
                      id: String(property['id']),
                      name: text(property, 'name'),
                    }))}
                    propertyId={
                      filter.propertyId ??
                      maybeText(
                        buildings.find((building) => building['id'] === filter.buildingId) ?? null,
                        'propertyId',
                      ) ??
                      undefined
                    }
                  />
                  <Button
                    tone="primary"
                    icon={Plus}
                    onClick={() => {
                      // In the building the list is narrowed to, where it is.
                      void navigate({
                        to: assetForms.new,
                        search: newAssetSearch(filter.buildingId),
                      })
                    }}
                  >
                    Neue Anlage
                  </Button>
                </>
              ),
            }
          : {})}
      />
      <Filters
        filter={filter}
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
      {first === undefined ? (
        <Panel>
          <Empty>
            {pages.isError
              ? 'Das Anlagenverzeichnis ließ sich nicht laden. Es kommt vom Server, mit Verbindung.'
              : pages.fetchStatus === 'paused'
                ? 'Das Anlagenverzeichnis kommt vom Server. Gerade ist keine Verbindung da.'
                : 'Das Anlagenverzeichnis wird geladen.'}
          </Empty>
        </Panel>
      ) : first.total === 0 ? (
        <Panel>
          <Empty>
            {narrowed
              ? 'Keine Anlage passt zu dem, wonach das Verzeichnis eingegrenzt ist.'
              : 'Noch ist keine Anlage aufgenommen.'}
          </Empty>
        </Panel>
      ) : (
        <TablePanel
          caption="Anlagen mit Anlagenart, Standort, Zustand und Lebenszyklus"
          cards={assets.map((asset) => ({
            key: asset.id,
            title: (
              <Link to={officePlaces.asset(asset.id)} className={cardLink}>
                {asset.name}
              </Link>
            ),
            sub: [
              asset.number,
              kindOf(asset),
              placeOf(asset),
              asset.lifecycleState === null || asset.lifecycleState === 'in_service'
                ? null
                : lifecycleStateLabel[asset.lifecycleState],
            ]
              .filter((part) => part !== null && part !== '')
              .join(' · '),
            right: <AssetConditionMark standing={asset} />,
          }))}
          footer={
            <>
              <span>
                {assets.length.toLocaleString('de-DE')} von {first.total.toLocaleString('de-DE')}
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
              <Column className="w-[96px] min-w-[84px]">Nummer</Column>
              <Column className="min-w-[180px]">Anlage</Column>
              <Column className="w-[230px] min-w-[150px]">Anlagenart</Column>
              <Column className="w-[270px] min-w-[170px]">Standort</Column>
              <Column className="w-[190px] min-w-[150px]">Zustand</Column>
              <Column className="w-[140px] min-w-[120px]">Lebenszyklus</Column>
            </tr>
          </thead>
          <tbody>
            {assets.map((asset) => (
              <tr key={asset.id}>
                <Cell>
                  <span className="numeric text-ink-faint">{asset.number}</span>
                </Cell>
                <Cell className="font-medium">
                  <Link to={officePlaces.asset(asset.id)}>{asset.name}</Link>
                </Cell>
                <Cell>{kindOf(asset)}</Cell>
                <Cell className="text-ink-muted">{placeOf(asset)}</Cell>
                <Cell>
                  <AssetConditionMark standing={asset} />
                </Cell>
                <Cell>
                  <AssetState state={asset.lifecycleState ?? undefined} />
                </Cell>
              </tr>
            ))}
          </tbody>
        </TablePanel>
      )}
    </Screen>
  )
}

/** What an asset kind is called, or its key where this device has no catalogue that knows it. */
export function kindLabel(catalogue: Catalogue | null, key: string): string {
  return catalogue?.assetKind(key, today())?.definition.label ?? key
}

/** "412 Anlagen in 11 Liegenschaften". */
function countedIn(register: AssetRegister): string {
  if (register.total === 0) {
    return 'Keine Anlage'
  }

  return `${countedAssets(register.total)} in ${register.properties.toLocaleString('de-DE')} ${
    register.properties === 1 ? 'Liegenschaft' : 'Liegenschaften'
  }`
}

/** The states of the life cycle the register narrows by, and the one for an asset without an entry. */
const lifecycleChoices: readonly (LifecycleState | typeof withoutLifecycle)[] = [
  ...lifecycleStates,
  withoutLifecycle,
]

export const withoutLifecycleWords = 'Ohne Angabe'

/**
 * The filters over the list, `select_filter()` of the boards: each with its
 * name above it, so that five of them side by side say what they narrow.
 */
function Filters({
  filter,
  catalogue,
  properties,
  buildings,
  onSet,
  onPlace,
  onReset,
}: {
  readonly filter: AssetRegisterFilter
  readonly catalogue: Catalogue | null
  readonly properties: readonly RecordState[]
  readonly buildings: readonly RecordState[]
  readonly onSet: (name: keyof AssetRegisterFilter, value: string) => void
  readonly onPlace: (place: Pick<AssetRegisterFilter, 'propertyId' | 'buildingId'>) => void
  readonly onReset?: () => void
}) {
  const kinds = useMemo(() => assetKindChoices(catalogue), [catalogue])
  // A building is read by the groups of the second level, 460 with the
  // elevators of 461. A group or a kind the address names beyond those the
  // catalogue of this device knows stays a choice, so that the filter shows
  // what the list is narrowed by.
  const costGroups = useMemo(
    () =>
      [
        ...new Set([
          ...kinds.map((kind) => costGroupAbove(kind.costGroup)),
          ...(filter.costGroup === undefined ? [] : [filter.costGroup]),
        ]),
      ].sort(),
    [kinds, filter.costGroup],
  )
  const unknownKind =
    filter.kind !== undefined && !kinds.some((kind) => kind.key === filter.kind)
      ? filter.kind
      : null

  return (
    <div className="flex flex-wrap items-end gap-2.5">
      <PlaceFilter
        className="lg:w-[220px]"
        place={filter}
        properties={properties}
        buildings={buildings}
        onPlace={onPlace}
      />
      <Filter
        label="Kostengruppe"
        className="lg:w-[210px]"
        value={filter.costGroup ?? ''}
        onChange={(value) => {
          onSet('costGroup', value)
        }}
      >
        <option value="">Alle</option>
        {costGroups.map((group) => (
          <option key={group} value={group}>
            {costGroupWords(group)}
          </option>
        ))}
      </Filter>
      <Filter
        label="Anlagenart"
        className="lg:w-[190px]"
        value={filter.kind ?? ''}
        onChange={(value) => {
          onSet('kind', value)
        }}
      >
        <option value="">Alle</option>
        {kinds.map((kind) => (
          <option key={kind.key} value={kind.key}>
            {kind.label}
          </option>
        ))}
        {unknownKind === null ? null : <option value={unknownKind}>{unknownKind}</option>}
      </Filter>
      <Filter
        label="Zustand"
        className="lg:w-[160px]"
        value={filter.condition ?? ''}
        onChange={(value) => {
          onSet('condition', value)
        }}
      >
        <option value="">Alle Zustände</option>
        {assetConditions.map((condition) => (
          <option key={condition} value={condition}>
            {assetConditionLabel[condition]}
          </option>
        ))}
      </Filter>
      <Filter
        label="Lebenszyklus"
        className="lg:w-[150px]"
        value={filter.lifecycle ?? ''}
        onChange={(value) => {
          onSet('lifecycle', value)
        }}
      >
        <option value="">Alle</option>
        {lifecycleChoices.map((state) => (
          <option key={state} value={state}>
            {state === withoutLifecycle ? withoutLifecycleWords : lifecycleStateLabel[state]}
          </option>
        ))}
      </Filter>
      <span className="grow max-lg:hidden" />
      {onReset ? (
        <Button size="small" onClick={onReset}>
          Filter zurücksetzen
        </Button>
      ) : null}
    </div>
  )
}
