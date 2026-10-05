import { floorProblems } from '@opengewerk/haustechnik-domain'
import { Panel } from '@opengewerk/platform-web'
import { PageHead, Screen } from '@opengewerk/platform-web/office'
import { useRight } from '@opengewerk/platform-web/session'
import {
  type EditResult,
  type FormField,
  RecordForm,
  text,
  useRecord,
  useSync,
  useSyncStatus,
} from '@opengewerk/platform-web/sync'
import { useNavigate, useParams } from '@tanstack/react-router'

import { placePath } from '../../app/place-path.js'
import { placeAbove } from '../../app/place-records.js'
import { makeAt } from '../../sync/made-at.js'
import { officePlaces } from '../place-addresses.js'
import { NotAllowed, RemovePlace } from '../place-forms.js'
import { PlaceNotFound } from '../place-pages.js'

/**
 * A floor to make or to change, `neues_geschoss()` of the boards (4.1 of the
 * concept): what it is called and the level it lies on, which orders the
 * floors of a building.
 *
 * A floor is kept by the office and with a connection (ADR 0006, point 6),
 * and the form says so before anybody fills it in.
 */

const noConnection = 'Ein Geschoss wird mit Verbindung angelegt und geändert. Gerade ist keine da.'

export function NewFloorScreen() {
  const { buildingId } = useParams({ strict: false }) as { buildingId?: string }
  const writes = useRight('location.write')

  return writes ? (
    <FloorFormScreen buildingId={buildingId} floorId={undefined} />
  ) : (
    <NotAllowed>Geschosse anlegen darf dieser Zugang nicht.</NotAllowed>
  )
}

export function EditFloorScreen() {
  const { floorId } = useParams({ strict: false }) as { floorId?: string }
  const writes = useRight('location.write')

  return writes ? (
    <FloorFormScreen buildingId={undefined} floorId={floorId} />
  ) : (
    <NotAllowed>Geschosse ändern darf dieser Zugang nicht.</NotAllowed>
  )
}

/**
 * The level as a form holds it: a whole number, below zero for a basement.
 * Anything else, an empty field too, is handed on so that the rule refuses it
 * with its sentence.
 */
function levelOf(typed: string | undefined): number | string | null {
  const trimmed = (typed ?? '').trim()

  if (trimmed === '') {
    return null
  }

  return /^-?\d+$/.test(trimmed) ? Number(trimmed) : trimmed
}

const fields: readonly FormField[] = [
  { name: 'name', label: 'Bezeichnung', required: true, place: 'lg:col-span-2' },
  {
    name: 'level',
    label: 'Ebene',
    required: true,
    numeric: true,
    hint: '0 ist das Erdgeschoss, darunter liegen die Untergeschosse. Die Ebene ordnet die Geschosse.',
  },
]

function FloorFormScreen({
  buildingId: asked,
  floorId,
}: {
  /** The building a new floor will lie in. */
  readonly buildingId: string | undefined
  readonly floorId: string | undefined
}) {
  const client = useSync()
  const status = useSyncStatus()
  const navigate = useNavigate()
  const floor = useRecord('floors', floorId)
  const building = useRecord('buildings', floor ? String(floor['buildingId']) : asked)
  const property = useRecord('properties', building ? String(building['propertyId']) : undefined)
  const editing = floorId !== undefined

  if (editing && !floor) {
    return <PlaceNotFound place="floor" />
  }

  if (!building || !property) {
    return <PlaceNotFound place="building" />
  }

  const buildingId = String(building['id'])
  const name = text(floor, 'name')
  const back = () => {
    void navigate({ to: editing ? officePlaces.floor(floorId) : officePlaces.building(buildingId) })
  }

  /** What the form collected, as the route and the model take it. */
  const wanted = (values: Readonly<Record<string, string>>) => ({
    name: (values['name'] ?? '').trim(),
    level: levelOf(values['level']),
  })

  async function save(values: Record<string, string>): Promise<EditResult> {
    const result = editing
      ? await client.update('floors', floorId, wanted(values))
      : await makeAt(client, `/buildings/${buildingId}/floors`, wanted(values))

    if (result.outcome === 'queued') {
      await navigate({ to: officePlaces.floor(result.id) })
    }

    return result
  }

  return (
    <Screen>
      <PageHead
        title={editing ? `${name} bearbeiten` : 'Neues Geschoss'}
        crumbs={placePath(
          placeAbove(editing ? { property, building, floor } : { property, building }),
          officePlaces,
        )}
      />
      <Panel className="max-w-[860px] px-5! py-[18px]!">
        <RecordForm
          // Made anew for another floor: a form reads what it starts with once.
          key={floorId ?? `new-${buildingId}`}
          fields={fields}
          record={floor}
          columns="lg:grid-cols-3"
          starred
          divided={false}
          submitLabel={editing ? 'Speichern' : 'Geschoss anlegen'}
          onSubmit={save}
          onCancel={back}
          disabled={!status.online}
          disabledReason={noConnection}
          check={(values) => Object.values(floorProblems(wanted(values)))[0] ?? null}
          extraAction={
            editing ? (
              <RemovePlace
                label="Geschoss entfernen"
                question={`„${name}“ entfernen?`}
                disabled={!status.online}
                remove={() => client.remove('floors', floorId)}
                onRemoved={() => navigate({ to: officePlaces.building(buildingId) })}
              >
                Mit dem Geschoss gehen seine Räume, die Anlagen darin und alle Pflichten, Vorgänge
                und Mängel dort. Eine Anlage mit Nachweis wird nicht entfernt, und dann bleibt auch
                das Geschoss.
              </RemovePlace>
            ) : undefined
          }
        />
      </Panel>
    </Screen>
  )
}
