import { type RecordState, roomProblems } from '@opengewerk/haustechnik-domain'
import { Button, Confirm, Panel, SelectField } from '@opengewerk/platform-web'
import { NoteBox, PageHead, Screen } from '@opengewerk/platform-web/office'
import { useRight } from '@opengewerk/platform-web/session'
import {
  asTextOrNull,
  type EditResult,
  type FormField,
  RecordForm,
  refusalFor,
  text,
  useRecord,
  useRecords,
  useRelated,
  useSync,
  useSyncStatus,
} from '@opengewerk/platform-web/sync'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useMemo, useState } from 'react'

import { placePath } from '../../app/place-path.js'
import { byLevel, placeAbove, titleOfRoom } from '../../app/place-records.js'
import { askAt } from '../../sync/made-at.js'
import { officePlaces } from '../place-addresses.js'
import { NotAllowed, RemovePlace } from '../place-forms.js'
import { countedAssets, PlaceNotFound } from '../place-pages.js'

/**
 * A room to make or to change, `neuer_raum()` and `raum_bearbeiten()` of the
 * boards (4.1 of the concept): its number, what it is called and what it is
 * used for. A room has a number or a name, or both.
 *
 * A room is taken stock of on site as well, so it is made and corrected
 * through the outbox, with a connection or without (ADR 0006). Moving it to
 * another floor and removing it belong to the structure of the property:
 * both are for whoever keeps the places, and both need a connection.
 */

export function NewRoomScreen() {
  const { floorId } = useParams({ strict: false }) as { floorId?: string }
  const records = useRight('room.record')

  return records ? (
    <RoomFormScreen floorId={floorId} roomId={undefined} />
  ) : (
    <NotAllowed>Räume anlegen darf dieser Zugang nicht.</NotAllowed>
  )
}

export function EditRoomScreen() {
  const { roomId } = useParams({ strict: false }) as { roomId?: string }
  const records = useRight('room.record')

  return records ? (
    <RoomFormScreen floorId={undefined} roomId={roomId} />
  ) : (
    <NotAllowed>Räume ändern darf dieser Zugang nicht.</NotAllowed>
  )
}

const fields: readonly FormField[] = [
  { name: 'number', label: 'Nummer' },
  { name: 'name', label: 'Bezeichnung', place: 'lg:col-span-2' },
  {
    name: 'use',
    label: 'Nutzung',
    placeholder: 'Zum Beispiel Unterricht, Büro oder Haustechnik',
    place: 'col-span-full',
  },
]

const noConnection = 'Verlegt und entfernt wird ein Raum mit Verbindung. Gerade ist keine da.'

function RoomFormScreen({
  floorId: asked,
  roomId,
}: {
  /** The floor a new room will lie on. */
  readonly floorId: string | undefined
  readonly roomId: string | undefined
}) {
  const client = useSync()
  const status = useSyncStatus()
  const navigate = useNavigate()
  const keeps = useRight('location.write')
  const room = useRecord('rooms', roomId)
  const floor = useRecord('floors', room ? String(room['floorId']) : asked)
  const building = useRecord('buildings', floor ? String(floor['buildingId']) : undefined)
  const property = useRecord('properties', building ? String(building['propertyId']) : undefined)
  const editing = roomId !== undefined

  if (editing && !room) {
    return <PlaceNotFound place="room" />
  }

  if (!floor || !building || !property) {
    return <PlaceNotFound place="floor" />
  }

  const floorId = String(floor['id'])
  const title = titleOfRoom(room)
  const back = () => {
    void navigate({ to: editing ? officePlaces.room(roomId) : officePlaces.floor(floorId) })
  }

  /** What the form collected, as the outbox and the model take it. */
  const wanted = (values: Readonly<Record<string, string>>) => ({
    number: asTextOrNull(values['number']),
    name: asTextOrNull(values['name']),
    use: asTextOrNull(values['use']),
  })

  async function save(values: Record<string, string>): Promise<EditResult> {
    const result = editing
      ? await client.update('rooms', roomId, wanted(values))
      : await client.create('rooms', { floorId, ...wanted(values) })

    if (result.outcome === 'queued') {
      await navigate({ to: officePlaces.room(result.id) })
    }

    return result
  }

  return (
    <Screen>
      <PageHead
        title={editing ? `${title} bearbeiten` : 'Neuer Raum'}
        crumbs={placePath(
          placeAbove(editing ? { property, building, floor, room } : { property, building, floor }),
          officePlaces,
        )}
      />
      <Panel className="max-w-[860px] px-5! py-[18px]!">
        <RecordForm
          // Made anew for another room: a form reads what it starts with once,
          // and so does the question that moves a room.
          key={roomId ?? `new-${floorId}`}
          fields={fields}
          record={room}
          columns="lg:grid-cols-3"
          divided={false}
          submitLabel={editing ? 'Speichern' : 'Raum anlegen'}
          onSubmit={save}
          onCancel={back}
          check={(values) => Object.values(roomProblems(wanted(values)))[0] ?? null}
          after={
            <>
              <p className="text-[13px] leading-[1.4] text-ink-muted">
                Ein Raum braucht eine Nummer oder eine Bezeichnung.
              </p>
              {editing && keeps && !status.online ? (
                <p role="status" className="text-[13px] font-medium text-ink-muted">
                  {noConnection}
                </p>
              ) : null}
            </>
          }
          extraAction={
            editing && keeps ? (
              <>
                <RemovePlace
                  label="Raum entfernen"
                  question={`„${title}“ entfernen?`}
                  disabled={!status.online}
                  remove={() => askAt(client, 'DELETE', `/rooms/${roomId}`, roomId)}
                  onRemoved={() => navigate({ to: officePlaces.floor(floorId) })}
                >
                  Mit dem Raum gehen die Anlagen darin und alle Pflichten, Vorgänge und Mängel dort.
                  Eine Anlage mit Nachweis wird nicht entfernt, und dann bleibt auch der Raum.
                </RemovePlace>
                <MoveRoom
                  room={room as RecordState}
                  floor={floor}
                  building={building}
                  property={property}
                  disabled={!status.online}
                />
              </>
            ) : undefined
          }
        />
      </Panel>
    </Screen>
  )
}

/** A floor a room may move to, as the list offers it. */
interface Target {
  readonly value: string
  readonly label: string
}

/**
 * Moving a room to another floor, `raum_verlegen()` of the boards, with a
 * question first: where to. The room moves with everything in it.
 *
 * A room an asset stands in moves only within its building (ADR 0002: an
 * asset stands in the building of its room), so with assets the list has the
 * floors of that building and says why. Without, it has the floors of the
 * property. What the device cannot know, an asset removed long ago that still
 * names the room, the server knows, and its sentence stands in the question
 * when it refuses.
 */
function MoveRoom({
  room,
  floor,
  building,
  property,
  disabled,
}: {
  readonly room: RecordState
  readonly floor: RecordState
  readonly building: RecordState
  readonly property: RecordState
  readonly disabled: boolean
}) {
  const client = useSync()
  const navigate = useNavigate()
  const roomId = String(room['id'])
  const floors = useRecords('floors')
  const buildings = useRecords('buildings')
  const standing = useRelated('assets', 'roomId', roomId).length
  const [asking, setAsking] = useState(false)
  const [chosen, setChosen] = useState('')
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [nowhere, setNowhere] = useState(false)

  const targets = useMemo((): readonly Target[] => {
    const here = String(building['id'])
    const nameOf = new Map(buildings.map((each) => [String(each['id']), text(each, 'name')]))
    const others = floors.filter(
      (each) =>
        each['id'] !== floor['id'] &&
        (standing > 0 ? each['buildingId'] === here : each['propertyId'] === property['id']),
    )
    const inBuilding = (id: string) =>
      others.filter((each) => each['buildingId'] === id).sort(byLevel)

    return [
      ...inBuilding(here).map((each) => ({ value: String(each['id']), label: text(each, 'name') })),
      ...[...nameOf.entries()]
        .filter(([id]) => id !== here)
        .sort((left, right) => left[1].localeCompare(right[1], 'de'))
        .flatMap(([id, name]) =>
          inBuilding(id).map((each) => ({
            value: String(each['id']),
            label: `${name}, ${text(each, 'name')}`,
          })),
        ),
    ]
  }, [floors, buildings, floor, building, property, standing])

  const title = titleOfRoom(room)
  const to = targets.some((target) => target.value === chosen) ? chosen : (targets[0]?.value ?? '')

  async function move() {
    setWorking(true)
    setTrouble(null)

    const result = await askAt(client, 'PUT', `/rooms/${roomId}/floor`, roomId, { floorId: to })

    setWorking(false)

    if (result.outcome === 'refused') {
      setTrouble(refusalFor(result))

      return
    }

    setAsking(false)
    await navigate({ to: officePlaces.room(roomId) })
  }

  return (
    <>
      <Button
        className="mr-auto"
        disabled={disabled}
        onClick={() => {
          setTrouble(null)
          setNowhere(targets.length === 0)
          setAsking(targets.length > 0)
        }}
      >
        In ein anderes Geschoss verlegen
      </Button>
      {nowhere ? (
        <p role="status" className="order-last basis-full text-[13px] font-medium text-ink-muted">
          {standing > 0
            ? `„${text(building, 'name')}“ hat kein anderes Geschoss, und mit Anlagen zieht ein Raum nur innerhalb seines Gebäudes um.`
            : `„${text(property, 'name')}“ hat kein anderes Geschoss.`}
        </p>
      ) : null}
      <Confirm
        open={asking}
        title={`${title} verlegen`}
        confirm="Verlegen"
        tone="primary"
        busy={working}
        onConfirm={() => {
          void move()
        }}
        onCancel={() => {
          setAsking(false)
        }}
      >
        <div className="flex flex-col gap-3">
          <p>Der Raum zieht mit allem um, was in ihm steht.</p>
          <SelectField
            label="Geschoss"
            required
            starred
            options={targets}
            value={to}
            onChange={setChosen}
          />
          <NoteBox>
            {standing > 0
              ? `In diesem Raum ${standing === 1 ? 'steht' : 'stehen'} ${countedAssets(standing)}. Mit Anlagen zieht ein Raum nur innerhalb seines Gebäudes um, deshalb stehen hier die Geschosse von „${text(building, 'name')}“.`
              : `Hier stehen die Geschosse von „${text(property, 'name')}“.`}
          </NoteBox>
          {trouble ? (
            <p role="alert" className="text-[13px] font-semibold text-conflict">
              {trouble}
            </p>
          ) : null}
        </div>
      </Confirm>
    </>
  )
}
