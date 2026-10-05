import type { LifecycleState, RecordState } from '@opengewerk/haustechnik-domain'
import { Button, Cell, Column, Panel, Status, TablePanel } from '@opengewerk/platform-web'
import { today } from '@opengewerk/platform-web/format'
import { ChangesButton, PageHead, Screen } from '@opengewerk/platform-web/office'
import { useRight } from '@opengewerk/platform-web/session'
import { maybeText, text, useRecord, useRecords } from '@opengewerk/platform-web/sync'
import { useNavigate, useParams } from '@tanstack/react-router'
import { DoorOpen, Pencil } from 'lucide-react'
import { useMemo } from 'react'

import { statesOn } from '../../app/asset-records.js'
import { placePath } from '../../app/place-path.js'
import { byNumber, placeAbove, titleOfRoom } from '../../app/place-records.js'
import { AssetState } from '../asset-state.js'
import { officePlaces, placeForms } from '../place-addresses.js'
import { PlaceNotFound } from '../place-pages.js'

/**
 * The page of a room in the office, `raum()` of the boards (4.1 of the
 * concept): the assets that stand in it, each with the state it is in today,
 * and the assets that supply it without standing there, each with where it
 * stands. An asset supplies a room by naming it, or by naming its building
 * as a whole: the fire alarm system of a school supplies every room of it.
 *
 * Read from the device, so it stands without a network. Whoever takes stock
 * of rooms corrects this one from here (`room-form.tsx`). What the board draws
 * beyond this arrives with what it shows: the kind of an asset with the
 * catalogue, the way to an asset with its page, the open defects with the
 * defects and the label of the room with the labels.
 */
export function RoomScreen() {
  const { roomId } = useParams({ strict: false }) as { roomId?: string }
  const room = useRecord('rooms', roomId)
  const floor = useRecord('floors', room ? String(room['floorId']) : undefined)
  const building = useRecord('buildings', floor ? String(floor['buildingId']) : undefined)
  const property = useRecord('properties', building ? String(building['propertyId']) : undefined)
  const assets = useRecords('assets')
  const supplies = useRecords('asset_supplies')
  const lifecycle = useRecords('asset_lifecycle')
  const rooms = useRecords('rooms')
  const buildings = useRecords('buildings')
  const buildingId = building ? String(building['id']) : undefined
  const records = useRight('room.record')
  const navigate = useNavigate()

  const inside = useMemo(
    () => assets.filter((asset) => asset['roomId'] === roomId).sort(byNumber),
    [assets, roomId],
  )
  const supplying = useMemo(() => {
    const names = new Set(
      supplies
        .filter((supply) => supply['roomId'] === roomId || supply['buildingId'] === buildingId)
        .map((supply) => String(supply['assetId'])),
    )

    return (
      assets
        // What stands in the room is listed above and supplies it by standing there.
        .filter((asset) => names.has(String(asset['id'])) && asset['roomId'] !== roomId)
        .sort(byNumber)
    )
  }, [assets, supplies, roomId, buildingId])
  const states = useMemo(() => statesOn(lifecycle, today()), [lifecycle])

  if (!room || !roomId || !floor || !building || !property) {
    return <PlaceNotFound place="room" />
  }

  const use = maybeText(room, 'use')

  /** Where an asset stands, as somebody in this building would say it. */
  const standsIn = (asset: RecordState): string => {
    const itsRoom = rooms.find((each) => each['id'] === asset['roomId'])
    const elsewhere =
      asset['buildingId'] === buildingId
        ? null
        : text(
            buildings.find((each) => each['id'] === asset['buildingId']),
            'name',
          )

    return [elsewhere, itsRoom ? titleOfRoom(itsRoom) : null]
      .filter((part) => part !== null && part !== '')
      .join(', ')
  }

  return (
    <Screen>
      <PageHead
        title={titleOfRoom(room)}
        crumbs={placePath(placeAbove({ property, building, floor }), officePlaces)}
        phoneBack={{ to: officePlaces.floor(String(floor['id'])), label: text(floor, 'name') }}
        badges={
          use === null ? null : (
            <Status tone="neutral" icon={DoorOpen}>
              Nutzung: {use}
            </Status>
          )
        }
        actions={
          <>
            <ChangesButton table="rooms" id={roomId} />
            {records ? (
              <Button
                icon={Pencil}
                onClick={() => {
                  void navigate({ to: placeForms.editRoom(roomId) })
                }}
              >
                Bearbeiten
              </Button>
            ) : null}
          </>
        }
      />
      {/* The columns of the board. Beside the assets the open defects and the
          label of the room take their place once there are defects and labels
          (#116, #98). */}
      <div className="grid gap-3.5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-3.5">
          <AssetsInside assets={inside} states={states} />
          <AssetsSupplying
            assets={supplying}
            standsIn={standsIn}
            hereName={text(building, 'name')}
          />
        </div>
      </div>
    </Screen>
  )
}

/** "AN-00057", or nothing for an asset the server has not numbered yet. */
function AssetNumber({ asset }: { readonly asset: RecordState }) {
  return <span className="numeric text-ink-faint">{maybeText(asset, 'number')}</span>
}

/** "Anlagen in diesem Raum": what stands here, with the state it is in today. */
function AssetsInside({
  assets,
  states,
}: {
  readonly assets: readonly RecordState[]
  readonly states: ReadonlyMap<string, LifecycleState>
}) {
  const title = 'Anlagen in diesem Raum'

  if (assets.length === 0) {
    return (
      <Panel title={title}>
        <p className="text-[13px] leading-[1.4] text-ink-muted">
          In diesem Raum steht noch keine Anlage.
        </p>
      </Panel>
    )
  }

  return (
    <TablePanel
      title={title}
      caption="Anlagen, die in diesem Raum stehen, mit ihrem Zustand am heutigen Tag"
      cards={assets.map((asset) => ({
        key: String(asset['id']),
        title: text(asset, 'name'),
        sub: maybeText(asset, 'number') ?? undefined,
        right: <AssetState state={states.get(String(asset['id']))} />,
      }))}
    >
      <thead>
        <tr>
          <Column className="w-[96px] min-w-[84px]">Nummer</Column>
          <Column className="min-w-[180px]">Anlage</Column>
          <Column className="w-[150px] min-w-[120px]">Zustand</Column>
        </tr>
      </thead>
      <tbody>
        {assets.map((asset) => (
          <tr key={String(asset['id'])}>
            <Cell>
              <AssetNumber asset={asset} />
            </Cell>
            <Cell>{text(asset, 'name')}</Cell>
            <Cell>
              <AssetState state={states.get(String(asset['id']))} />
            </Cell>
          </tr>
        ))}
      </tbody>
    </TablePanel>
  )
}

/**
 * "Anlagen, die den Raum versorgen": what supplies the room without standing
 * in it, and where it stands instead. An asset in the same building is said
 * to stand in its room; one in another building of the property names that
 * building first, and one that stands in no room names its building alone.
 */
function AssetsSupplying({
  assets,
  standsIn,
  hereName,
}: {
  readonly assets: readonly RecordState[]
  readonly standsIn: (asset: RecordState) => string
  /** The building of this room, for an asset that stands in it and in no room. */
  readonly hereName: string
}) {
  const title = 'Anlagen, die den Raum versorgen'

  if (assets.length === 0) {
    return (
      <Panel title={title}>
        <p className="text-[13px] leading-[1.4] text-ink-muted">
          Diesen Raum versorgt keine Anlage, die woanders steht.
        </p>
      </Panel>
    )
  }

  const where = (asset: RecordState) => standsIn(asset) || hereName

  return (
    <TablePanel
      title={title}
      caption="Anlagen, die diesen Raum versorgen, mit dem Ort, an dem sie stehen"
      cards={assets.map((asset) => ({
        key: String(asset['id']),
        title: text(asset, 'name'),
        sub: [maybeText(asset, 'number'), `Steht in ${where(asset)}`].filter(Boolean).join(' · '),
      }))}
    >
      <thead>
        <tr>
          <Column className="w-[96px] min-w-[84px]">Nummer</Column>
          <Column className="min-w-[180px]">Anlage</Column>
          <Column className="w-[250px] min-w-[140px]">Steht in</Column>
        </tr>
      </thead>
      <tbody>
        {assets.map((asset) => (
          <tr key={String(asset['id'])}>
            <Cell>
              <AssetNumber asset={asset} />
            </Cell>
            <Cell>{text(asset, 'name')}</Cell>
            <Cell>{where(asset)}</Cell>
          </tr>
        ))}
      </tbody>
    </TablePanel>
  )
}
