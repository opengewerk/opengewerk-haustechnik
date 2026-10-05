import type { RecordState } from '@opengewerk/haustechnik-domain'
import { cardLink, Cell, Column, Panel, Status, TablePanel } from '@opengewerk/platform-web'
import { ChangesButton, PageHead, Screen } from '@opengewerk/platform-web/office'
import { text, useRecord, useRecords, useRelated } from '@opengewerk/platform-web/sync'
import { Link, useParams } from '@tanstack/react-router'
import { Building2 } from 'lucide-react'
import { useMemo } from 'react'

import { placePath } from '../../app/place-path.js'
import { byLevel, kindsOf, placeAbove } from '../../app/place-records.js'
import { areaName, useAreas } from '../../session/areas.js'
import { AreaBadge } from '../area-badge.js'
import { officePlaces } from '../place-addresses.js'
import { countedAssets, countedRooms, PlaceNotFound } from '../place-pages.js'

/**
 * The page of a building in the office, `lagebild()` of the boards (4.1 of
 * the concept): what it is used as, when it was built and in which area it
 * lies, and under that what it consists of, floor by floor with its rooms and
 * the assets standing in them.
 *
 * Read from the device, so it stands without a network. What the board draws
 * beyond this arrives with what it shows: what is to do with the register of
 * duties, the assets by cost group with the catalogue, the last activities
 * with the activities, and the labels with the labels.
 */
export function BuildingScreen() {
  const { buildingId } = useParams({ strict: false }) as { buildingId?: string }
  const building = useRecord('buildings', buildingId)
  const property = useRecord('properties', building ? String(building['propertyId']) : undefined)
  const floors = useRelated('floors', 'buildingId', buildingId)
  const rooms = useRecords('rooms')
  const assets = useRelated('assets', 'buildingId', buildingId)
  const areas = useAreas()

  if (!building || !buildingId || !property) {
    return <PlaceNotFound place="building" />
  }

  const area = areas.length > 1 ? areaName(areas, building['areaId']) : null
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
        actions={<ChangesButton table="buildings" id={buildingId} />}
      />
      {/* The columns of the board. Beside the floors the assets by cost group
          take their place once the catalogue reaches the interface (#90). */}
      <div className="grid gap-3.5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
        <Floors floors={floors} rooms={rooms} assets={assets} />
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
}: {
  readonly floors: readonly RecordState[]
  readonly rooms: readonly RecordState[]
  readonly assets: readonly RecordState[]
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
      <Panel title="Geschosse und Räume">
        <p className="text-[13px] leading-[1.4] text-ink-muted">
          In diesem Gebäude ist noch kein Geschoss angelegt.
        </p>
      </Panel>
    )
  }

  return (
    <TablePanel
      title="Geschosse und Räume"
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
