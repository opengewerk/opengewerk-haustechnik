import {
  type Catalogue,
  costGroupAbove,
  costGroupNames,
  type RecordState,
} from '@opengewerk/haustechnik-domain'
import { Button, cardLink, Cell, Column, Panel, Status, TablePanel } from '@opengewerk/platform-web'
import { today } from '@opengewerk/platform-web/format'
import { ChangesButton, PageHead, Screen } from '@opengewerk/platform-web/office'
import { useRight } from '@opengewerk/platform-web/session'
import { text, useRecord, useRecords, useRelated } from '@opengewerk/platform-web/sync'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { Building2, Pencil, Plus } from 'lucide-react'
import { type ReactNode, useMemo } from 'react'

import { placePath } from '../../app/place-path.js'
import { byLevel, kindsOf, placeAbove } from '../../app/place-records.js'
import { areaName, useAreas } from '../../session/areas.js'
import { useCatalogue } from '../../sync/catalogue.js'
import { AreaBadge } from '../area-badge.js'
import {
  assetForms,
  assetRegisterPlace,
  newAssetSearch,
  registerSearch,
} from '../asset-addresses.js'
import { PrintLabelsButton } from '../labels.js'
import { factLink } from '../links.js'
import { BuildingClosures } from '../building-closures.js'
import { officePlaces, placeForms } from '../place-addresses.js'
import { countedAssets, countedRooms, PlaceNotFound } from '../place-pages.js'

/**
 * The page of a building in the office, `lagebild()` of the boards (4.1 of
 * the concept): what it is used as, when it was built and in which area it
 * lies, and under that what it consists of, floor by floor with its rooms and
 * the assets standing in them.
 *
 * Read from the device, so it stands without a network. Whoever keeps the
 * places changes the building from here and adds a floor to it
 * (`building-form.tsx`, `floor-form.tsx`), and whoever plans the rounds keeps
 * the times it is closed (`building-closures.tsx`). What the board draws beyond this
 * arrives with what it shows: what is to do with the register of duties, the
 * last activities with the activities, and the labels with the labels.
 *
 * The assets of the building are counted by cost group beside the floors, and
 * each count leads into the register of assets, narrowed to this building
 * (`assets.tsx`): the register "je Gebäude" of 4.2.
 */
export function BuildingScreen() {
  const { buildingId } = useParams({ strict: false }) as { buildingId?: string }
  const building = useRecord('buildings', buildingId)
  const property = useRecord('properties', building ? String(building['propertyId']) : undefined)
  const floors = useRelated('floors', 'buildingId', buildingId)
  const rooms = useRecords('rooms')
  const assets = useRelated('assets', 'buildingId', buildingId)
  const catalogue = useCatalogue()
  const areas = useAreas()
  const writes = useRight('location.write')
  const records = useRight('asset.record')
  const recordsRooms = useRight('room.record')
  const navigate = useNavigate()

  if (!building || !buildingId || !property) {
    return <PlaceNotFound place="building" />
  }

  const area = areas.length > 1 ? areaName(areas, building['areaId']) : null
  const roomsHere = rooms.filter((room) => room['buildingId'] === buildingId).length
  const year = typeof building['yearBuilt'] === 'number' ? building['yearBuilt'] : null

  return (
    <Screen>
      <PageHead
        title={text(building, 'name')}
        crumbs={placePath(placeAbove({ property }), officePlaces)}
        phoneBack={{
          to: officePlaces.property(String(property['id'])),
          label: text(property, 'name'),
        }}
        badges={
          <>
            {kindsOf(building).map((kind) => (
              <Status key={kind} tone="neutral" icon={Building2}>
                {kind}
              </Status>
            ))}
            {year === null ? null : (
              <span className="numeric text-[13px] text-ink-muted">Baujahr {year}</span>
            )}
            {area === null ? null : <AreaBadge name={area} />}
          </>
        }
        actions={
          <>
            <ChangesButton table="buildings" id={buildingId} />
            {writes ? (
              <Button
                icon={Pencil}
                onClick={() => {
                  void navigate({ to: placeForms.editBuilding(buildingId) })
                }}
              >
                Bearbeiten
              </Button>
            ) : null}
            {/* The doors of this building, its assets, or a sheet for taking
                stock on its property. */}
            <PrintLabelsButton
              offers={[
                ...(recordsRooms && roomsHere > 0
                  ? [
                      {
                        key: 'rooms',
                        label:
                          roomsHere === 1
                            ? 'Der eine Raum dieses Gebäudes'
                            : `Die ${String(roomsHere)} Räume dieses Gebäudes`,
                        batch: { what: 'rooms' as const, buildingId },
                        count: roomsHere,
                      },
                    ]
                  : []),
                ...(assets.length > 0
                  ? [
                      {
                        key: 'assets',
                        label:
                          assets.length === 1
                            ? 'Die eine Anlage dieses Gebäudes'
                            : `Die ${String(assets.length)} Anlagen dieses Gebäudes`,
                        batch: { what: 'assets' as const, filter: { buildingId } },
                        count: assets.length,
                      },
                    ]
                  : []),
              ]}
              properties={[{ id: String(property['id']), name: text(property, 'name') }]}
              propertyId={String(property['id'])}
            />
            {records ? (
              <Button
                tone="primary"
                icon={Plus}
                onClick={() => {
                  void navigate({ to: assetForms.new, search: newAssetSearch(buildingId) })
                }}
              >
                Neue Anlage
              </Button>
            ) : null}
          </>
        }
      />
      {/* The columns of the board: the floors and the times the building is
          closed, and beside them its assets by cost group. */}
      <div className="grid gap-3.5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
        <div className="flex min-w-0 flex-col gap-3.5">
          <Floors
            floors={floors}
            rooms={rooms}
            assets={assets}
            action={
              writes ? (
                <Button
                  size="small"
                  icon={Plus}
                  onClick={() => {
                    void navigate({ to: placeForms.newFloor(buildingId) })
                  }}
                >
                  Geschoss anlegen
                </Button>
              ) : null
            }
          />
          <BuildingClosures buildingId={buildingId} />
        </div>
        <div className="flex min-w-0 flex-col gap-3.5">
          <AssetsByCostGroup buildingId={buildingId} assets={assets} catalogue={catalogue} />
        </div>
      </div>
    </Screen>
  )
}

/** One floor of the table: how many rooms it has and how many assets stand in them. */
interface FloorRow {
  readonly id: string
  readonly name: string
  readonly rooms: number
  readonly assets: number
}

/**
 * "Geschosse und Räume": the floors from the lowest up, each with its rooms
 * and the assets standing in them, counted. An asset that stands in the
 * building and in no room of it belongs to no floor; so that the column still
 * adds up to the building, those are counted in a row of their own.
 *
 * A room is counted by the floor it names and not by the building: one taken
 * stock of a moment ago names its floor and learns its building from the
 * server.
 */
function Floors({
  floors,
  rooms,
  assets,
  action,
}: {
  readonly floors: readonly RecordState[]
  readonly rooms: readonly RecordState[]
  readonly assets: readonly RecordState[]
  /** "Geschoss anlegen", for whoever keeps the places. */
  readonly action: ReactNode
}) {
  const { rows, withoutRoom } = useMemo(() => {
    const assetsIn = new Map<string, number>()

    for (const asset of assets) {
      const roomId = typeof asset['roomId'] === 'string' ? asset['roomId'] : ''

      assetsIn.set(roomId, (assetsIn.get(roomId) ?? 0) + 1)
    }

    return {
      rows: [...floors].sort(byLevel).map((floor): FloorRow => {
        const here = rooms.filter((room) => room['floorId'] === floor['id'])

        return {
          id: String(floor['id']),
          name: text(floor, 'name'),
          rooms: here.length,
          assets: here.reduce((sum, room) => sum + (assetsIn.get(String(room['id'])) ?? 0), 0),
        }
      }),
      withoutRoom: assetsIn.get('') ?? 0,
    }
  }, [floors, rooms, assets])

  if (rows.length === 0 && withoutRoom === 0) {
    return (
      <Panel title="Geschosse und Räume" action={action}>
        <p className="text-[13px] leading-[1.4] text-ink-muted">
          In diesem Gebäude ist noch kein Geschoss angelegt.
        </p>
      </Panel>
    )
  }

  return (
    <TablePanel
      title="Geschosse und Räume"
      action={action}
      caption="Geschosse des Gebäudes mit ihren Räumen und Anlagen"
      cards={[
        ...rows.map((row) => ({
          key: row.id,
          title: (
            <Link to={officePlaces.floor(row.id)} className={cardLink}>
              {row.name}
            </Link>
          ),
          sub: `${countedRooms(row.rooms)} · ${countedAssets(row.assets)}`,
        })),
        ...(withoutRoom === 0
          ? []
          : [{ key: 'without-room', title: 'Ohne Raum', sub: countedAssets(withoutRoom) }]),
      ]}
    >
      <thead>
        <tr>
          <Column className="min-w-[150px]">Geschoss</Column>
          <Column numeric className="w-[70px] min-w-[60px]">
            Räume
          </Column>
          <Column numeric className="w-[76px] min-w-[66px]">
            Anlagen
          </Column>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <Cell>
              <Link to={officePlaces.floor(row.id)}>{row.name}</Link>
            </Cell>
            <Cell numeric>{row.rooms.toLocaleString('de-DE')}</Cell>
            <Cell numeric>{row.assets.toLocaleString('de-DE')}</Cell>
          </tr>
        ))}
        {withoutRoom === 0 ? null : (
          <tr>
            <Cell>
              <span className="text-ink-muted">Ohne Raum</span>
            </Cell>
            <Cell numeric>{null}</Cell>
            <Cell numeric>{withoutRoom.toLocaleString('de-DE')}</Cell>
          </tr>
        )}
      </tbody>
    </TablePanel>
  )
}

/** What stands in the place of a cost group for an asset whose kind no catalogue of this device knows. */
const unknownGroup = ''

/**
 * "Anlagen nach Kostengruppe": the assets of the building counted by the
 * group of the second level of DIN 276 their kind lies in, which is how a
 * building is read. Every group leads into the register of assets narrowed to
 * this building and that group, and "Alle Anlagen" to the building alone.
 *
 * Counted from the device, with the kinds of the catalogue it holds, so the
 * card stands without a network; the register it leads to needs one.
 */
function AssetsByCostGroup({
  buildingId,
  assets,
  catalogue,
}: {
  readonly buildingId: string
  readonly assets: readonly RecordState[]
  readonly catalogue: Catalogue | null
}) {
  const title = 'Anlagen nach Kostengruppe'
  const groups = useMemo(() => {
    const day = today()
    const counted = new Map<string, number>()

    for (const asset of assets) {
      const kind = catalogue?.assetKind(text(asset, 'kind'), day) ?? null
      const group = kind ? costGroupAbove(kind.definition.costGroup) : unknownGroup

      counted.set(group, (counted.get(group) ?? 0) + 1)
    }

    return (
      [...counted]
        .map(([group, count]) => ({ group, count }))
        // By number, and what has none after them.
        .sort(
          (left, right) =>
            Number(left.group === unknownGroup) - Number(right.group === unknownGroup) ||
            left.group.localeCompare(right.group),
        )
    )
  }, [assets, catalogue])

  if (assets.length === 0) {
    return (
      <Panel title={title}>
        <p className="text-[13px] leading-[1.4] text-ink-muted">
          In diesem Gebäude steht noch keine Anlage.
        </p>
      </Panel>
    )
  }

  const nameOf = (group: string) =>
    group === unknownGroup
      ? 'Anlagenart nicht im Katalog'
      : Object.hasOwn(costGroupNames, group)
        ? (costGroupNames[group] ?? '')
        : 'Kostengruppe'
  const leadsTo = (group: string) =>
    registerSearch(group === unknownGroup ? { buildingId } : { buildingId, costGroup: group })

  return (
    <TablePanel
      title={title}
      action={
        <Link
          to={assetRegisterPlace.to}
          search={registerSearch({ buildingId })}
          className={`${factLink} text-[13px]`}
        >
          Alle Anlagen
        </Link>
      }
      caption="Anlagen dieses Gebäudes, gezählt nach Kostengruppe"
      cards={groups.map(({ group, count }) => ({
        key: group,
        title: (
          <Link to={assetRegisterPlace.to} search={leadsTo(group)} className={cardLink}>
            {nameOf(group)}
          </Link>
        ),
        sub: [group === unknownGroup ? null : `KG ${group}`, countedAssets(count)]
          .filter((part) => part !== null)
          .join(' · '),
      }))}
    >
      <thead>
        <tr>
          <Column className="min-w-[200px]">Kostengruppe</Column>
          <Column numeric className="w-[84px] min-w-[72px]">
            Anlagen
          </Column>
        </tr>
      </thead>
      <tbody>
        {groups.map(({ group, count }) => (
          <tr key={group}>
            <Cell>
              {group === unknownGroup ? null : (
                <span className="numeric text-ink-faint">{group} </span>
              )}
              <Link to={assetRegisterPlace.to} search={leadsTo(group)}>
                {nameOf(group)}
              </Link>
            </Cell>
            <Cell numeric>{count.toLocaleString('de-DE')}</Cell>
          </tr>
        ))}
      </tbody>
    </TablePanel>
  )
}
