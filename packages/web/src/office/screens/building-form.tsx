import {
  type Area,
  buildingKindLabel,
  buildingKinds,
  buildingProblems,
  type RecordState,
} from '@opengewerk/haustechnik-domain'
import { Panel } from '@opengewerk/platform-web'
import { NoteBox, PageHead, Screen } from '@opengewerk/platform-web/office'
import { useRight } from '@opengewerk/platform-web/session'
import {
  asTextOrNull,
  type EditResult,
  type FormField,
  RecordForm,
  text,
  useRecord,
  useSync,
  useSyncStatus,
} from '@opengewerk/platform-web/sync'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useState } from 'react'

import { placePath } from '../../app/place-path.js'
import { areaName, useAreasQuery } from '../../session/areas.js'
import { kindKeysOf, placeAbove } from '../../app/place-records.js'
import { makeAt } from '../../sync/made-at.js'
import { officePlaces } from '../place-addresses.js'
import { NotAllowed, RemovePlace } from '../place-forms.js'
import { PlaceNotFound } from '../place-pages.js'

/**
 * A building to make or to change, `neues_gebaeude()` and
 * `gebaeude_bearbeiten()` of the boards (4.1 of the concept): what it is
 * called, the short code that stands before its room numbers, the year it was
 * built, what it is used as, one kind or several, because the kind decides
 * with which duties are proposed, and where there is more than one area, its
 * area: the one of its property, or one of its own (section 2.8, #306).
 *
 * A building is kept by the office and with a connection (ADR 0006, point 6),
 * and the form says so before anybody fills it in.
 */

const noConnection = 'Ein Gebäude wird mit Verbindung angelegt und geändert. Gerade ist keine da.'

export const buildingAreaWords = {
  label: 'Bereich',
  hint: 'Ein eigener Bereich, wenn das Gebäude jemand anderes betreut als die Liegenschaft. Alles im Gebäude folgt ihm.',
  /** The choice that gives a building the area of its property, with that area's name. */
  likeTheProperty: (name: string | null) =>
    name === null ? 'Wie die Liegenschaft' : `Wie die Liegenschaft (${name})`,
  moves:
    'Mit dem Bereich wechselt alles im Gebäude: Geschosse, Räume, Anlagen, Pflichten, Mängel und ' +
    'Vorgänge. Wer den neuen Bereich nicht hat, sieht das Gebäude danach nicht mehr; die ' +
    'Liegenschaft sieht weiter, wer ihren Bereich hat. Was an der Liegenschaft selbst hängt, bleibt ' +
    'in ihrem Bereich.',
} as const

export function NewBuildingScreen() {
  const { propertyId } = useParams({ strict: false }) as { propertyId?: string }
  const writes = useRight('location.write')

  return writes ? (
    <BuildingFormScreen propertyId={propertyId} buildingId={undefined} />
  ) : (
    <NotAllowed>Gebäude anlegen darf dieser Zugang nicht.</NotAllowed>
  )
}

export function EditBuildingScreen() {
  const { buildingId } = useParams({ strict: false }) as { buildingId?: string }
  const writes = useRight('location.write')

  return writes ? (
    <BuildingFormScreen propertyId={undefined} buildingId={buildingId} />
  ) : (
    <NotAllowed>Gebäude ändern darf dieser Zugang nicht.</NotAllowed>
  )
}

/**
 * The year as a form holds it: digits, or nothing. Anything else is handed on
 * as it was typed, so that the rule refuses it with its sentence.
 */
function yearOf(typed: string | undefined): number | string | null {
  const trimmed = (typed ?? '').trim()

  if (trimmed === '') {
    return null
  }

  return /^\d+$/.test(trimmed) ? Number(trimmed) : trimmed
}

const placeFields: readonly FormField[] = [
  { name: 'name', label: 'Bezeichnung', required: true, place: 'lg:col-span-2' },
  {
    name: 'shortCode',
    label: 'Kürzel',
    hint: 'Steht vor der Raumnummer, wo es mehrere Gebäude gibt.',
  },
  { name: 'yearBuilt', label: 'Baujahr', numeric: true },
]

/**
 * Finds what the form stands on, and says so when it is not there.
 *
 * The form itself is made once its records are there and anew for another
 * building: what a form starts with is read when it is made. A building that
 * reaches a device a moment after its address was opened would otherwise
 * start with no kind ticked, and saving would take its kinds away.
 */
function BuildingFormScreen({
  propertyId: asked,
  buildingId,
}: {
  /** The property a new building will stand on. */
  readonly propertyId: string | undefined
  readonly buildingId: string | undefined
}) {
  const building = useRecord('buildings', buildingId)
  const property = useRecord('properties', building ? String(building['propertyId']) : asked)
  const areas = useAreasQuery()

  if (buildingId !== undefined && !building) {
    return <PlaceNotFound place="building" />
  }

  if (!property) {
    return <PlaceNotFound place="property" />
  }

  // The area a building has is read when the form is made: made before the
  // areas are known, it would start at "wie die Liegenschaft" and take an own
  // area away on saving. Without the areas there is no field, and nothing
  // about the area is sent.
  if (areas.isPending) {
    return null
  }

  return (
    <BuildingForm
      key={buildingId ?? `new-${String(property['id'])}`}
      property={property}
      building={building}
      areas={areas.data ?? []}
    />
  )
}

function BuildingForm({
  property,
  building,
  areas,
}: {
  readonly property: RecordState
  /** The building to change, or none for a new one. */
  readonly building: RecordState | null
  /** The areas the person holds in; the field stands where there is more than one. */
  readonly areas: readonly Area[]
}) {
  const client = useSync()
  const status = useSyncStatus()
  const navigate = useNavigate()
  const editing = building !== null
  const buildingId = building ? String(building['id']) : ''
  const propertyId = String(property['id'])
  const name = text(building, 'name')
  // In the order they were chosen, as the building holds them: saving a form
  // nobody ticked anything in changes nothing.
  const [kinds, setKinds] = useState<readonly string[]>(() => kindKeysOf(building))
  const asksArea = areas.length > 1
  const ofTheProperty = property['areaId']
  const fields: readonly FormField[] = asksArea
    ? [
        ...placeFields,
        {
          name: 'ownAreaId',
          label: buildingAreaWords.label,
          options: [
            { value: '', label: buildingAreaWords.likeTheProperty(areaName(areas, ofTheProperty)) },
            ...areas
              .filter((area) => area.id !== ofTheProperty)
              .map((area) => ({ value: area.id as string, label: area.name })),
          ],
          hint: buildingAreaWords.hint,
          place: 'lg:col-span-2',
        },
      ]
    : placeFields

  const back = () => {
    void navigate({
      to: editing ? officePlaces.building(buildingId) : officePlaces.property(propertyId),
    })
  }

  /** What the form collected, as the route and the model take it. */
  const wanted = (values: Readonly<Record<string, string>>) => ({
    name: (values['name'] ?? '').trim(),
    shortCode: asTextOrNull(values['shortCode']),
    kinds,
    yearBuilt: yearOf(values['yearBuilt']),
    // Empty is the area of the property.
    ...(asksArea ? { ownAreaId: asTextOrNull(values['ownAreaId']) } : {}),
  })

  async function save(values: Record<string, string>): Promise<EditResult> {
    const result = editing
      ? await client.update('buildings', buildingId, wanted(values))
      : await makeAt(client, `/properties/${propertyId}/buildings`, wanted(values))

    if (result.outcome === 'queued') {
      await navigate({ to: officePlaces.building(result.id) })
    }

    return result
  }

  return (
    <Screen>
      <PageHead
        title={editing ? `${name} bearbeiten` : 'Neues Gebäude'}
        crumbs={placePath(
          placeAbove(editing ? { property, building } : { property }),
          officePlaces,
        )}
      />
      <Panel className="max-w-[860px] px-5! py-[18px]!">
        <RecordForm
          fields={fields}
          record={building}
          columns="lg:grid-cols-4"
          starred
          divided={false}
          submitLabel={editing ? 'Speichern' : 'Gebäude anlegen'}
          onSubmit={save}
          onCancel={back}
          disabled={!status.online}
          disabledReason={noConnection}
          check={(values) => Object.values(buildingProblems(wanted(values)))[0] ?? null}
          after={
            <>
              <Kinds chosen={kinds} onChange={setKinds} />
              {editing && asksArea ? (
                <NoteBox tone="waiting">{buildingAreaWords.moves}</NoteBox>
              ) : null}
              {editing ? null : (
                <NoteBox>
                  Geschosse und Räume legen Sie danach im Gebäude an, oder Sie übernehmen sie mit
                  dem Import.
                </NoteBox>
              )}
            </>
          }
          extraAction={
            editing ? (
              <RemovePlace
                label="Gebäude entfernen"
                question={`„${name}“ entfernen?`}
                disabled={!status.online}
                remove={() => client.remove('buildings', buildingId)}
                onRemoved={() => navigate({ to: officePlaces.property(propertyId) })}
              >
                Mit dem Gebäude gehen seine Geschosse und Räume, seine Schließzeiten, die Anlagen
                darin und alle Pflichten, Vorgänge und Mängel dort. Eine Anlage mit Nachweis wird
                nicht entfernt, und dann bleibt auch das Gebäude.
              </RemovePlace>
            ) : undefined
          }
        />
      </Panel>
    </Screen>
  )
}

/**
 * What a building is used as: one of the kinds or several, each a box to
 * tick. A kind that is ticked later goes to the end, one that is unticked
 * leaves, and the others stay where they were.
 */
function Kinds({
  chosen,
  onChange,
}: {
  readonly chosen: readonly string[]
  readonly onChange: (kinds: readonly string[]) => void
}) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5">
      <legend className="mb-1.5 flex items-baseline gap-1 text-[13px] font-medium text-ink">
        Gebäudeart
        <span aria-hidden="true" className="text-conflict">
          *
        </span>
      </legend>
      <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {buildingKinds.map((kind) => (
          <label
            key={kind}
            className="inline-flex min-h-6 items-center gap-[7px] text-[14px] max-lg:min-h-tap"
          >
            <input
              type="checkbox"
              className="size-[15px] shrink-0 accent-copper-solid max-lg:size-5"
              checked={chosen.includes(kind)}
              onChange={(event) => {
                onChange(
                  event.target.checked
                    ? [...chosen, kind]
                    : chosen.filter((picked) => picked !== kind),
                )
              }}
            />
            {buildingKindLabel[kind]}
          </label>
        ))}
      </div>
      <p className="text-[13px] leading-[1.4] text-ink-faint">
        Eine oder mehrere. Die Gebäudeart entscheidet mit, welche Pflichten vorgeschlagen werden.
      </p>
    </fieldset>
  )
}
