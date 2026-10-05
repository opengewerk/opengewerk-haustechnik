import type { RecordState } from '@opengewerk/haustechnik-domain'
import { Button, cardLink, Cell, Column, Panel, Status, TablePanel } from '@opengewerk/platform-web'
import { ChangesButton, PageHead, Screen } from '@opengewerk/platform-web/office'
import { useRight } from '@opengewerk/platform-web/session'
import { maybeText, text, useRecord, useRelated } from '@opengewerk/platform-web/sync'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { Pencil, Plus } from 'lucide-react'
import { useMemo } from 'react'

import { placePath } from '../../app/place-path.js'
import { byNumber, placeAbove, titleOfRoom } from '../../app/place-records.js'
import { officePlaces, placeForms } from '../place-addresses.js'
import { countedAssets, countedRooms, PlaceNotFound } from '../place-pages.js'

/**
 * The page of a floor in the office, `geschoss()` of the boards (4.1 of the
 * concept: every place has a page of its own, and the path leads to this
 * one): its level, and its rooms in the order of their numbers, each with
 * what it is used for and how many assets stand in it.
 *
 * Read from the device, so it stands without a network. Whoever keeps the
 * places changes the floor from here (`floor-form.tsx`), and whoever takes
 * stock of rooms adds one to it (`room-form.tsx`).
 */
export function FloorScreen() {
  const { floorId } = useParams({ strict: false }) as { floorId?: string }
  const floor = useRecord('floors', floorId)
  const building = useRecord('buildings', floor ? String(floor['buildingId']) : undefined)
  const property = useRecord('properties', building ? String(building['propertyId']) : undefined)
  const rooms = useRelated('rooms', 'floorId', floorId)
  const assets = useRelated('assets', 'buildingId', building ? String(building['id']) : undefined)
  const writes = useRight('location.write')
  const records = useRight('room.record')
  const navigate = useNavigate()

  if (!floor || !floorId || !building || !property) {
    return <PlaceNotFound place="floor" />
  }

  return (
    <Screen>
      <PageHead
        title={text(floor, 'name')}
        crumbs={placePath(placeAbove({ property, building }), officePlaces)}
        phoneBack={{
          to: officePlaces.building(String(building['id'])),
          label: text(building, 'name'),
        }}
        badges={
          typeof floor['level'] === 'number' ? (
            <Status tone="neutral">Ebene {floor['level']}</Status>
          ) : null
        }
        actions={
          <>
            <ChangesButton table="floors" id={floorId} />
            {writes ? (
              <Button
                icon={Pencil}
                onClick={() => {
                  void navigate({ to: placeForms.editFloor(floorId) })
                }}
              >
                Bearbeiten
              </Button>
            ) : null}
            {records ? (
              <Button
                tone="primary"
                icon={Plus}
                onClick={() => {
                  void navigate({ to: placeForms.newRoom(floorId) })
                }}
              >
                Neuer Raum
              </Button>
            ) : null}
          </>
        }
      />
      <Rooms rooms={rooms} assets={assets} />
    </Screen>
  )
}

/**
 * "Räume": number, name, use and the assets standing in the room, counted.
 * The name leads to the room; a room that has only a number is reached by
 * that.
 */
function Rooms({
  rooms,
  assets,
}: {
  readonly rooms: readonly RecordState[]
  readonly assets: readonly RecordState[]
}) {
  const rows = useMemo(() => {
    const standing = new Map<string, number>()

    for (const asset of assets) {
      if (typeof asset['roomId'] === 'string') {
        standing.set(asset['roomId'], (standing.get(asset['roomId']) ?? 0) + 1)
      }
    }

    return [...rooms].sort(byNumber).map((room) => ({
      id: String(room['id']),
      number: maybeText(room, 'number'),
      name: maybeText(room, 'name'),
      title: titleOfRoom(room),
      use: maybeText(room, 'use'),
      assets: standing.get(String(room['id'])) ?? 0,
    }))
  }, [rooms, assets])

  if (rows.length === 0) {
    return (
      <Panel title="Räume">
        <p className="text-[13px] leading-[1.4] text-ink-muted">
          Auf diesem Geschoss ist noch kein Raum angelegt.
        </p>
      </Panel>
    )
  }

  return (
    <TablePanel
      title="Räume"
      caption="Räume des Geschosses"
      footer={<span className="numeric">{countedRooms(rows.length)}</span>}
      cards={rows.map((row) => ({
        key: row.id,
        title: (
          <Link to={officePlaces.room(row.id)} className={cardLink}>
            {row.title}
          </Link>
        ),
        sub: [row.use, countedAssets(row.assets)].filter(Boolean).join(' · '),
      }))}
    >
      <thead>
        <tr>
          <Column className="w-[96px] min-w-[72px]">Nummer</Column>
          <Column className="min-w-[160px]">Raum</Column>
          <Column className="w-[240px] min-w-[120px]">Nutzung</Column>
          <Column numeric className="w-[76px] min-w-[66px]">
            Anlagen
          </Column>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <Cell>
              {row.name === null ? (
                <Link to={officePlaces.room(row.id)}>{row.number}</Link>
              ) : (
                row.number
              )}
            </Cell>
            <Cell>
              {row.name === null ? null : <Link to={officePlaces.room(row.id)}>{row.name}</Link>}
            </Cell>
            <Cell>{row.use}</Cell>
            <Cell numeric>
              <span className={row.assets === 0 ? 'text-ink-faint' : 'font-semibold'}>
                {row.assets.toLocaleString('de-DE')}
              </span>
            </Cell>
          </tr>
        ))}
      </tbody>
    </TablePanel>
  )
}
