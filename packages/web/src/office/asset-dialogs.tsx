import {
  type AssetDetails,
  type LifecycleEntry,
  type LifecycleState,
  lifecycleStateLabel,
  lifecycleStates,
  type RecordState,
} from '@opengewerk/haustechnik-domain'
import {
  Button,
  Confirm,
  Dialog,
  DialogActions,
  Field,
  SelectField,
} from '@opengewerk/platform-web'
import { date, today } from '@opengewerk/platform-web/format'
import { NoteBox } from '@opengewerk/platform-web/office'
import {
  type EditResult,
  refusalFor,
  text,
  useRecords,
  useSync,
} from '@opengewerk/platform-web/sync'
import { useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useMemo, useState } from 'react'

import { byLevel, byNumber, titleOfRoom } from '../app/place-records.js'
import { askAt, makeAt } from '../sync/made-at.js'

/**
 * What is changed at the file of an asset and not in its form, each in a
 * dialog of its own (4.2 of the concept, #88): where the asset stands, what
 * it supplies, and its life cycle.
 *
 * Moving an asset and its life cycle have consequences beyond the record,
 * its duties rest while it is out of service, and are for whoever keeps the
 * assets ("pflegen", section 7). What it supplies belongs to taking stock of
 * it ("aufnehmen"). All of it is asked of the routes of the server, with a
 * connection, and the file is read again afterwards: it comes from there.
 */

export const assetDialogWords = {
  staysOnProperty: (property: string) =>
    `Eine Anlage bleibt auf ihrer Liegenschaft. Hier stehen die Gebäude von „${property}“.`,
  componentStays: 'Eine Komponente steht im Gebäude ihrer Anlage und zieht mit ihr um.',
  componentsFollow:
    'Wechselt die Anlage das Gebäude, ziehen ihre Komponenten mit und stehen dort in keinem Raum, bis sie einen bekommen.',
  everyFloor: 'Alle Geschosse',
  noRoom: 'Kein Raum',
  whatSupplyIs:
    'Was die Anlage versorgt, ohne dort zu stehen: ganze Gebäude oder einzelne Räume ihrer Liegenschaft.',
  suppliesNothing: 'Die Anlage versorgt nur ihren eigenen Standort.',
  nothingToAdd: 'Nichts weiter',
  whatAStateIs:
    'Ein Zustand gilt ab einem Tag, bis der nächste Eintrag beginnt. Auf einen Tag kommt einer.',
  dutiesRest: 'Solange die Anlage nicht in Betrieb ist, ruhen ihre Pflichten. Sie verfallen nicht.',
  takenBack:
    'Der Eintrag wird zurückgenommen, etwa weil er auf dem falschen Tag steht. Es gilt dann wieder der Eintrag davor.',
} as const

interface Choice {
  readonly value: string
  readonly label: string
}

/** Asks a route, shows what it refused with, and has the file read again once it is done. */
function useAsking(onDone: () => void) {
  const queries = useQueryClient()
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  async function ask(question: () => Promise<EditResult>) {
    setWorking(true)
    setTrouble(null)

    try {
      const result = await question()

      if (result.outcome === 'refused') {
        setTrouble(refusalFor(result))

        return
      }

      // The register, the file and the duties come from the server.
      await queries.invalidateQueries({ queryKey: ['assets'] })
      onDone()
    } finally {
      setWorking(false)
    }
  }

  return { working, trouble, ask }
}

function Trouble({ children }: { readonly children: ReactNode }) {
  return children ? (
    <p role="alert" className="text-[13px] font-semibold text-conflict">
      {children}
    </p>
  ) : null
}

/**
 * Moving an asset, `anlage_verlegen()` of the boards: to another building of
 * its property, or to another room. A component moves on its own only to
 * another room of the building of its asset.
 */
export function MoveAssetDialog({
  asset,
  onClose,
}: {
  readonly asset: AssetDetails
  readonly onClose: () => void
}) {
  const client = useSync()
  const properties = useRecords('properties')
  const buildings = useRecords('buildings')
  const floors = useRecords('floors')
  const rooms = useRecords('rooms')
  const { working, trouble, ask } = useAsking(onClose)
  const [buildingId, setBuildingId] = useState<string>(asset.buildingId)
  const [roomId, setRoomId] = useState<string>(asset.roomId ?? '')
  const [floorId, setFloorId] = useState<string>(() => {
    const room = rooms.find((each) => each['id'] === asset.roomId)

    return room ? String(room['floorId']) : ''
  })

  const component = asset.parentAssetId !== null
  const property = properties.find((each) => each['id'] === asset.propertyId)
  const buildingChoices = buildings
    .filter((each) =>
      component ? each['id'] === asset.buildingId : each['propertyId'] === asset.propertyId,
    )
    .map((each) => ({ value: String(each['id']), label: text(each, 'name') }))
    .sort((left, right) => left.label.localeCompare(right.label, 'de'))
  const here = (records: readonly RecordState[]) =>
    records.filter((each) => each['buildingId'] === buildingId)

  return (
    <Dialog
      title={`${asset.name} verlegen`}
      width={600}
      onClose={onClose}
      sub={
        component
          ? assetDialogWords.componentStays
          : assetDialogWords.staysOnProperty(
              property ? text(property, 'name') : 'ihrer Liegenschaft',
            )
      }
    >
      <form
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          void ask(() =>
            askAt(client, 'PUT', `/assets/${asset.id}/location`, asset.id, {
              buildingId,
              roomId: roomId === '' ? null : roomId,
            }),
          )
        }}
      >
        <SelectField
          label="Gebäude"
          required
          starred
          disabled={component}
          options={buildingChoices}
          value={buildingId}
          onChange={(value) => {
            setBuildingId(value)
            setFloorId('')
            setRoomId('')
          }}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            label="Geschoss"
            options={[
              { value: '', label: assetDialogWords.everyFloor },
              ...[...here(floors)]
                .sort(byLevel)
                .map((each) => ({ value: String(each['id']), label: text(each, 'name') })),
            ]}
            value={floorId}
            onChange={(value) => {
              const room = rooms.find((each) => each['id'] === roomId)

              setFloorId(value)

              if (value !== '' && room?.['floorId'] !== value) {
                setRoomId('')
              }
            }}
          />
          <SelectField
            label="Raum"
            options={[
              { value: '', label: assetDialogWords.noRoom },
              ...here(rooms)
                .filter((each) => floorId === '' || each['floorId'] === floorId)
                .sort(byNumber)
                .map((each) => ({ value: String(each['id']), label: titleOfRoom(each) })),
            ]}
            value={roomId}
            onChange={(value) => {
              const room = rooms.find((each) => each['id'] === value)

              setRoomId(value)

              if (room) {
                setFloorId(String(room['floorId']))
              }
            }}
          />
        </div>
        {!component && asset.components.length > 0 ? (
          <NoteBox>{assetDialogWords.componentsFollow}</NoteBox>
        ) : null}
        <Trouble>{trouble}</Trouble>
        <DialogActions>
          <Button type="button" disabled={working} onClick={onClose}>
            Abbrechen
          </Button>
          <Button type="submit" tone="primary" disabled={working}>
            {working ? 'Einen Moment' : 'Verlegen'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

/**
 * What an asset supplies without standing there, `anlage_versorgung()` of
 * the boards: buildings and rooms of its property, kept as one list. The
 * route takes the list whole, so the dialog holds it whole and sends it once.
 */
export function AssetSuppliesDialog({
  asset,
  onClose,
}: {
  readonly asset: AssetDetails
  readonly onClose: () => void
}) {
  const client = useSync()
  const buildings = useRecords('buildings')
  const floors = useRecords('floors')
  const rooms = useRecords('rooms')
  const { working, trouble, ask } = useAsking(onClose)
  const [buildingIds, setBuildingIds] = useState<readonly string[]>(() =>
    asset.supplies.flatMap((supply) => (supply.buildingId === null ? [] : [supply.buildingId])),
  )
  const [roomIds, setRoomIds] = useState<readonly string[]>(() =>
    asset.supplies.flatMap((supply) => (supply.roomId === null ? [] : [supply.roomId])),
  )
  const [building, setBuilding] = useState('')
  const [room, setRoom] = useState('')

  const names = useMemo(() => {
    const nameOf = (records: readonly RecordState[]) =>
      new Map(records.map((each) => [String(each['id']), text(each, 'name')]))
    const ofBuilding = nameOf(buildings)
    const ofFloor = nameOf(floors)

    return {
      building: (id: string) => `${ofBuilding.get(id) ?? 'Ein Gebäude'}, ganzes Gebäude`,
      room: (each: RecordState) =>
        [
          ofBuilding.get(String(each['buildingId'])),
          ofFloor.get(String(each['floorId'])),
          titleOfRoom(each),
        ]
          .filter(Boolean)
          .join(', '),
    }
  }, [buildings, floors])

  const byLabel = (left: Choice, right: Choice) => left.label.localeCompare(right.label, 'de')
  const onProperty = (records: readonly RecordState[]) =>
    records.filter((each) => each['propertyId'] === asset.propertyId)
  const buildingChoices = onProperty(buildings)
    .filter((each) => !buildingIds.includes(String(each['id'])))
    .map((each) => ({ value: String(each['id']), label: names.building(String(each['id'])) }))
    .sort(byLabel)
  const roomChoices = onProperty(rooms)
    .filter((each) => !roomIds.includes(String(each['id'])))
    .map((each) => ({ value: String(each['id']), label: names.room(each) }))
    .sort(byLabel)
  const toAdd = (choices: readonly Choice[], chosen: string) =>
    choices.some((choice) => choice.value === chosen) ? chosen : (choices[0]?.value ?? '')
  const nextBuilding = toAdd(buildingChoices, building)
  const nextRoom = toAdd(roomChoices, room)

  const supplied = [
    ...buildingIds.map((id) => ({
      key: id,
      words: names.building(id),
      remove: () => {
        setBuildingIds(buildingIds.filter((each) => each !== id))
      },
    })),
    ...roomIds.map((id) => {
      const itsRoom = rooms.find((each) => each['id'] === id)

      return {
        key: id,
        words: itsRoom ? names.room(itsRoom) : 'Ein Raum',
        remove: () => {
          setRoomIds(roomIds.filter((each) => each !== id))
        },
      }
    }),
  ]
  const nothing = [{ value: '', label: assetDialogWords.nothingToAdd }]

  return (
    <Dialog
      title={`Versorgungsbereich von ${asset.name}`}
      width={600}
      onClose={onClose}
      sub={assetDialogWords.whatSupplyIs}
    >
      <form
        noValidate
        className="flex flex-col gap-3.5"
        onSubmit={(event) => {
          event.preventDefault()
          void ask(() =>
            askAt(client, 'PUT', `/assets/${asset.id}/supplies`, asset.id, {
              buildingIds,
              roomIds,
            }),
          )
        }}
      >
        {supplied.length === 0 ? (
          <p className="text-[13px] leading-[1.4] text-ink-muted">
            {assetDialogWords.suppliesNothing}
          </p>
        ) : (
          <ul aria-label="Versorgt" className="flex flex-col">
            {supplied.map((place) => (
              <li
                key={place.key}
                className="flex items-center justify-between gap-2 border-b border-line py-1.5 text-[14px]"
              >
                <span className="min-w-0">{place.words}</span>
                <Button size="small" aria-label={`${place.words} entfernen`} onClick={place.remove}>
                  Entfernen
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-end gap-2">
          <div className="min-w-0 grow">
            <SelectField
              label="Gebäude"
              options={buildingChoices.length === 0 ? nothing : buildingChoices}
              value={nextBuilding}
              disabled={buildingChoices.length === 0}
              onChange={setBuilding}
            />
          </div>
          <Button
            aria-label="Gebäude hinzufügen"
            disabled={nextBuilding === ''}
            onClick={() => {
              setBuildingIds([...buildingIds, nextBuilding])
              setBuilding('')
            }}
          >
            Hinzufügen
          </Button>
        </div>
        <div className="flex items-end gap-2">
          <div className="min-w-0 grow">
            <SelectField
              label="Raum"
              options={roomChoices.length === 0 ? nothing : roomChoices}
              value={nextRoom}
              disabled={roomChoices.length === 0}
              onChange={setRoom}
            />
          </div>
          <Button
            aria-label="Raum hinzufügen"
            disabled={nextRoom === ''}
            onClick={() => {
              setRoomIds([...roomIds, nextRoom])
              setRoom('')
            }}
          >
            Hinzufügen
          </Button>
        </div>
        <Trouble>{trouble}</Trouble>
        <DialogActions>
          <Button type="button" disabled={working} onClick={onClose}>
            Abbrechen
          </Button>
          <Button type="submit" tone="primary" disabled={working}>
            {working ? 'Einen Moment' : 'Speichern'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

/**
 * A state of the life cycle from a day on, `anlage_lebenszyklus()` of the
 * boards (2.2 of the concept): a period and not a switch, so an asset taken
 * out of service keeps its past, and its duties rest instead of lapsing.
 */
export function LifecycleEntryDialog({
  asset,
  onClose,
}: {
  readonly asset: AssetDetails
  readonly onClose: () => void
}) {
  const client = useSync()
  const { working, trouble, ask } = useAsking(onClose)
  const [state, setState] = useState<LifecycleState>(
    asset.lifecycle.length === 0 ? 'in_service' : 'out_of_service',
  )
  const [validFrom, setValidFrom] = useState<string>(today())

  return (
    <Dialog
      title="Lebenszyklus eintragen"
      width={600}
      onClose={onClose}
      sub={assetDialogWords.whatAStateIs}
    >
      <form
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          void ask(() => makeAt(client, `/assets/${asset.id}/lifecycle`, { state, validFrom }))
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            label="Zustand"
            required
            starred
            options={lifecycleStates.map((each) => ({
              value: each,
              label: lifecycleStateLabel[each],
            }))}
            value={state}
            onChange={(value) => {
              setState(value as LifecycleState)
            }}
          />
          <Field
            label="Gilt ab"
            type="date"
            required
            starred
            value={validFrom}
            onChange={(event) => {
              setValidFrom(event.target.value)
            }}
          />
        </div>
        {state === 'in_service' ? null : <NoteBox>{assetDialogWords.dutiesRest}</NoteBox>}
        <Trouble>{trouble}</Trouble>
        <DialogActions>
          <Button type="button" disabled={working} onClick={onClose}>
            Abbrechen
          </Button>
          <Button type="submit" tone="primary" disabled={working}>
            {working ? 'Einen Moment' : 'Eintragen'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

/** The question before an entry of the life cycle is taken back. */
export function TakeBackLifecycleEntry({
  asset,
  entry,
  onClose,
}: {
  readonly asset: AssetDetails
  readonly entry: LifecycleEntry
  readonly onClose: () => void
}) {
  const client = useSync()
  const { working, trouble, ask } = useAsking(onClose)

  return (
    <Confirm
      open
      title={`„${lifecycleStateLabel[entry.state]} ab ${date(entry.validFrom)}“ zurücknehmen?`}
      confirm="Zurücknehmen"
      tone="danger"
      busy={working}
      onConfirm={() => {
        void ask(() =>
          askAt(client, 'DELETE', `/assets/${asset.id}/lifecycle/${entry.id}`, entry.id),
        )
      }}
      onCancel={onClose}
    >
      <div className="flex flex-col gap-2">
        <p>{assetDialogWords.takenBack}</p>
        <Trouble>{trouble}</Trouble>
      </div>
    </Confirm>
  )
}
