import {
  type AssetDetails,
  type AssetDuplicate,
  type AssetKind,
  assetProblems,
  assetValueProblems,
  type Catalogue,
  type DuplicateField,
  duplicateFields,
  duplicateKey,
  dutyKindsNaming,
  intervalLine,
  isGeneralKind,
  meterMediumLabel,
  meterProblems,
  meterUnitSymbol,
  type RecordState,
  sameWords,
} from '@opengewerk/haustechnik-domain'
import { Button, Field, Panel, PanelLabel, SelectField } from '@opengewerk/platform-web'
import { today } from '@opengewerk/platform-web/format'
import { Empty, NoteBox, PageHead, Screen } from '@opengewerk/platform-web/office'
import { useRight } from '@opengewerk/platform-web/session'
import {
  type EditResult,
  maybeText,
  refusalFor,
  request,
  text,
  useRecords,
  useSync,
  useSyncStatus,
} from '@opengewerk/platform-web/sync'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { Check, TriangleAlert } from 'lucide-react'
import { type FormEvent, type ReactNode, useMemo, useRef, useState } from 'react'

import {
  type KindField,
  kindChoices,
  kindFields,
  typedValues,
  unitOf,
  valuesOf,
  yearOf,
} from '../../app/asset-values.js'
import { placePath } from '../../app/place-path.js'
import { byLevel, byNumber, placeAbove, titleOfRoom } from '../../app/place-records.js'
import { ReviewMarks } from '../../app/review-marks.js'
import { useCatalogue } from '../../sync/catalogue.js'
import { askAt, makeAt } from '../../sync/made-at.js'
import {
  assetRegisterPlace,
  type DuplicateAsked,
  duplicatesRequest,
  newAssetBuilding,
} from '../asset-addresses.js'
import { cataloguePlaces } from '../catalogue-addresses.js'
import { factLink } from '../links.js'
import { officePlaces } from '../place-addresses.js'
import { RemovePlace } from '../place-forms.js'
import { assetFileQuery, AssetFileUnread } from './asset.js'

/**
 * An asset to make or to change in the office, `neue_anlage()`,
 * `anlage_bearbeiten()` and `neue_komponente()` of the boards (4.2 of the
 * concept): its kind from the catalogue, where it stands, what every asset
 * has, and the fields of its kind in the version in force today.
 *
 * Whoever takes assets into the register fills it in ("aufnehmen", section
 * 7). It is written at the routes of the server, with a connection: the
 * register and the file it leads to come from there, and so does the answer
 * to whether the asset may be one that is there already. An asset with the
 * same serial number or the same mark is named, and made all the same if
 * whoever enters it says so.
 *
 * Moving an asset reaches beyond its record and is done at its file. Removing
 * it stands in the form of the asset, as in every form, for whoever keeps the
 * assets ("pflegen").
 */

export const assetFormWords = {
  mayNotRecord: 'Anlagen anlegen und ändern darf dieser Zugang nicht.',
  noCatalogue: 'Der Katalog wird geladen. Aus ihm kommen die Anlagenarten und ihre Felder.',
  noConnection:
    'Angelegt und geändert wird eine Anlage im Büro mit Verbindung. Gerade ist keine da.',
  kindHint:
    'Aus den Paketen. Für eine Anlage ohne Fachpaket gibt es je Kostengruppe eine allgemeine Anlagenart.',
  noRoom: 'Kein Raum',
  everyFloor: 'Alle Geschosse',
  noBuilding: 'Das Gebäude fehlt.',
  check: 'Bitte prüfen Sie die markierten Felder.',
  decide: 'Eine Anlage mit diesen Angaben gibt es schon. Entscheiden Sie oben, ob es dieselbe ist.',
  noAnswer:
    'Ob es die Anlage schon gibt, ließ sich nicht prüfen. Das beantwortet der Server, mit Verbindung.',
  noValue: 'Keine Angabe',
  chooseKind:
    'Wählen Sie eine Anlagenart. Dann stehen hier die Pflichten, die der Katalog für sie führt.',
  noDuties: 'Für diese Anlagenart führt der Katalog keine Pflicht.',
  duties: 'Für diese Anlagenart führt der Katalog:',
  whichApply:
    'Welche davon für diese Anlage in Frage kommen, hängt von ihren Angaben, der Gebäudeart und dem Land ab.',
  movedAtFile: 'Verlegt wird eine Anlage an ihrer Akte.',
  removeAsks:
    'Mit der Anlage gehen ihre Komponenten, ihr Lebenszyklus und ihr Versorgungsbereich. Eine Anlage mit Nachweis wird nicht entfernt: sie wird stillgelegt.',
} as const

/** In place of the form, for whoever may not fill it in. */
function MayNotRecord() {
  return (
    <Screen>
      <PageHead title="Anlagen" crumbs={[assetRegisterPlace]} />
      <Empty>{assetFormWords.mayNotRecord}</Empty>
    </Screen>
  )
}

/**
 * The form once the catalogue of the device is there: it reads the values of
 * an asset against its kind once, when it starts, and a form that started
 * without the kind would show an asset without its values and save it so.
 */
function WithCatalogue({
  title,
  children,
}: {
  readonly title: string
  readonly children: (catalogue: Catalogue) => ReactNode
}) {
  const catalogue = useCatalogue()

  return catalogue === null ? (
    <Screen>
      <PageHead title={title} crumbs={[assetRegisterPlace]} />
      <Empty>{assetFormWords.noCatalogue}</Empty>
    </Screen>
  ) : (
    children(catalogue)
  )
}

export function NewAssetScreen() {
  const records = useRight('asset.record')
  const search = useSearch({ strict: false })
  const buildingId = newAssetBuilding(search)

  return records ? (
    <WithCatalogue title="Neue Anlage">
      {(catalogue) => (
        <AssetForm catalogue={catalogue} {...(buildingId === undefined ? {} : { buildingId })} />
      )}
    </WithCatalogue>
  ) : (
    <MayNotRecord />
  )
}

export function NewComponentScreen() {
  const { assetId } = useParams({ strict: false }) as { assetId?: string }
  const records = useRight('asset.record')
  const file = useQuery({
    ...assetFileQuery(assetId ?? ''),
    enabled: assetId !== undefined && records,
  })

  if (!records) {
    return <MayNotRecord />
  }

  const parent = file.data

  return parent === undefined ? (
    <AssetFileUnread file={file} />
  ) : (
    <WithCatalogue title="Neue Komponente">
      {(catalogue) => (
        <AssetForm key={`under-${parent.id}`} catalogue={catalogue} parent={parent} />
      )}
    </WithCatalogue>
  )
}

export function EditAssetScreen() {
  const { assetId } = useParams({ strict: false }) as { assetId?: string }
  const records = useRight('asset.record')
  const file = useQuery({
    ...assetFileQuery(assetId ?? ''),
    enabled: assetId !== undefined && records,
  })

  if (!records) {
    return <MayNotRecord />
  }

  const asset = file.data

  // Made anew for another asset: a form reads what it starts with once.
  return asset === undefined ? (
    <AssetFileUnread file={file} />
  ) : (
    <WithCatalogue title={`${asset.name} bearbeiten`}>
      {(catalogue) => <AssetForm key={asset.id} catalogue={catalogue} asset={asset} />}
    </WithCatalogue>
  )
}

/** What the form holds, every field as the text that stands in it. */
interface Typed {
  readonly kind: string
  readonly buildingId: string
  readonly floorId: string
  readonly roomId: string
  readonly name: string
  readonly mark: string
  readonly manufacturer: string
  readonly model: string
  readonly serialNumber: string
  readonly yearBuilt: string
  readonly commissionedOn: string
  readonly warrantyEndsOn: string
  readonly meterNumber: string
  readonly meterUnit: string
  readonly values: Readonly<Record<string, string>>
}

interface Choice {
  readonly value: string
  readonly label: string
}

function AssetForm({
  catalogue,
  asset,
  parent,
  buildingId: startsIn,
}: {
  readonly catalogue: Catalogue
  /** The asset that is changed. */
  readonly asset?: AssetDetails
  /** The asset a new component will be one of. */
  readonly parent?: AssetDetails
  /** The building a new asset starts in, as the address says. */
  readonly buildingId?: string
}) {
  const client = useSync()
  const status = useSyncStatus()
  const queries = useQueryClient()
  const navigate = useNavigate()
  const keeps = useRight('asset.write')
  const properties = useRecords('properties')
  const buildings = useRecords('buildings')
  const floors = useRecords('floors')
  const rooms = useRecords('rooms')
  const found = useRef<HTMLDivElement>(null)

  const editing = asset !== undefined
  const fixed = asset ?? parent
  const byId = (records: readonly RecordState[], id: unknown) =>
    records.find((record) => record['id'] === id) ?? null

  const [typed, setTyped] = useState<Typed>(() => {
    const kind = asset ? (catalogue.assetKind(asset.kind, today())?.definition ?? null) : null

    return {
      kind: asset?.kind ?? '',
      buildingId: fixed?.buildingId ?? startsIn ?? '',
      floorId: '',
      roomId: '',
      name: asset?.name ?? '',
      mark: asset?.mark ?? '',
      manufacturer: asset?.manufacturer ?? '',
      model: asset?.model ?? '',
      serialNumber: asset?.serialNumber ?? '',
      yearBuilt: asset?.yearBuilt === null || asset === undefined ? '' : String(asset.yearBuilt),
      commissionedOn: asset?.commissionedOn ?? '',
      warrantyEndsOn: asset?.warrantyEndsOn ?? '',
      meterNumber: asset?.meterNumber ?? '',
      meterUnit: asset?.meterUnit ?? '',
      values: asset && kind ? typedValues(kind, asset.values) : {},
    }
  })
  const [problems, setProblems] = useState<Readonly<Record<string, string>>>({})
  const [trouble, setTrouble] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  /** What the route of the duplicates was last asked with: what stood in the two fields when one was left. */
  const [asked, setAsked] = useState<DuplicateAsked>(() => ({
    serialNumber: typed.serialNumber,
    mark: typed.mark,
  }))

  const set = (values: Partial<Typed>) => {
    setTyped((current) => ({ ...current, ...values }))
  }
  const kind: AssetKind | null =
    typed.kind === '' ? null : (catalogue.assetKind(typed.kind, today())?.definition ?? null)
  const except = asset?.id ?? null
  const asks = (question: DuplicateAsked) =>
    duplicateFields.some((field) => duplicateKey(question[field]) !== null)
  const duplicatesQuery = (question: DuplicateAsked) => ({
    queryKey: ['assets', 'duplicates', question.serialNumber.trim(), question.mark.trim(), except],
    queryFn: () => request<AssetDuplicate[]>(duplicatesRequest(question, except)),
  })
  const duplicates = useQuery({ ...duplicatesQuery(asked), enabled: asks(asked) }).data ?? []
  const shown = asks(asked) ? duplicates : []

  const building = byId(buildings, typed.buildingId)
  const here = (records: readonly RecordState[]) =>
    records.filter((record) => record['buildingId'] === typed.buildingId)

  const buildingChoices = useMemo((): readonly Choice[] => {
    const nameOf = new Map(properties.map((each) => [String(each['id']), text(each, 'name')]))
    const propertyOf = (each: RecordState) => nameOf.get(String(each['propertyId'])) ?? ''

    // By property and then by building, each offered by its own name first:
    // the choice is narrow, and the name of a property is long.
    return [...buildings]
      .sort(
        (left, right) =>
          propertyOf(left).localeCompare(propertyOf(right), 'de') ||
          text(left, 'name').localeCompare(text(right, 'name'), 'de'),
      )
      .map((each) => ({
        value: String(each['id']),
        label:
          properties.length > 1 ? `${text(each, 'name')}, ${propertyOf(each)}` : text(each, 'name'),
      }))
  }, [properties, buildings])
  const floorChoices: readonly Choice[] = [
    { value: '', label: assetFormWords.everyFloor },
    ...[...here(floors)]
      .sort(byLevel)
      .map((each) => ({ value: String(each['id']), label: text(each, 'name') })),
  ]
  const roomChoices: readonly Choice[] = [
    { value: '', label: assetFormWords.noRoom },
    ...here(rooms)
      .filter((each) => typed.floorId === '' || each['floorId'] === typed.floorId)
      .sort(byNumber)
      .map((each) => ({ value: String(each['id']), label: titleOfRoom(each) })),
  ]

  const title = editing ? `${asset.name} bearbeiten` : parent ? 'Neue Komponente' : 'Neue Anlage'
  const submitLabel = editing ? 'Speichern' : parent ? 'Komponente anlegen' : 'Anlage anlegen'
  const anyway = editing ? 'Trotzdem speichern' : 'Trotzdem anlegen'

  /** The path above the form: the place of the asset that is there, or the building the address named. */
  const crumbs = (() => {
    const at = fixed
      ? {
          building: byId(buildings, fixed.buildingId),
          room: byId(rooms, fixed.roomId),
        }
      : { building: byId(buildings, startsIn), room: null }
    const itsProperty = at.building ? byId(properties, at.building['propertyId']) : null

    if (!itsProperty) {
      return [assetRegisterPlace]
    }

    return placePath(
      placeAbove({
        property: itsProperty,
        building: at.building,
        floor: at.room ? byId(floors, at.room['floorId']) : null,
        room: at.room,
        asset: fixed ? { id: fixed.id, name: fixed.name } : null,
      }),
      officePlaces,
    )
  })()

  const back = () => {
    void navigate({
      to: fixed
        ? officePlaces.asset(fixed.id)
        : startsIn
          ? officePlaces.building(startsIn)
          : assetRegisterPlace.to,
    })
  }

  /** What the form says about the asset, as the routes and the model take it. */
  const wanted = () => ({
    kind: typed.kind === '' ? null : typed.kind,
    name: typed.name,
    mark: typed.mark,
    manufacturer: typed.manufacturer,
    model: typed.model,
    serialNumber: typed.serialNumber,
    yearBuilt: yearOf(typed.yearBuilt),
    commissionedOn: typed.commissionedOn === '' ? null : typed.commissionedOn,
    warrantyEndsOn: typed.warrantyEndsOn === '' ? null : typed.warrantyEndsOn,
    // The values and the meter go only with a kind this device knows: an
    // asset of a kind from a package it lacks keeps what it has.
    ...(kind
      ? {
          values: valuesOf(kind, typed.values),
          meterNumber:
            kind.meter === null || typed.meterNumber.trim() === '' ? null : typed.meterNumber,
          meterUnit: kind.meter === null || typed.meterUnit === '' ? null : typed.meterUnit,
        }
      : {}),
  })

  async function save(event: FormEvent | null, decided: boolean) {
    event?.preventDefault()
    setTrouble(null)

    const values = wanted()
    const wrong = {
      ...assetProblems(values),
      ...(kind && values.values ? assetValueProblems(kind, values.values) : {}),
      ...(kind ? meterProblems(kind, values) : {}),
      ...(typed.buildingId === '' ? { buildingId: assetFormWords.noBuilding } : {}),
    }

    setProblems(wrong)

    if (Object.keys(wrong).length > 0) {
      setTrouble(assetFormWords.check)

      return
    }

    setWorking(true)

    try {
      const question = { serialNumber: typed.serialNumber, mark: typed.mark }
      // An asset that is changed asks again only about what was changed: one
      // that shares its serial number with another did so before, and
      // somebody decided it then.
      const changed =
        !editing ||
        duplicateFields.some(
          (field) => duplicateKey(question[field]) !== duplicateKey(asset[field]),
        )

      if (!decided && changed && asks(question)) {
        let there: AssetDuplicate[]

        try {
          there = await queries.fetchQuery({ ...duplicatesQuery(question), staleTime: 0 })
        } catch {
          setTrouble(assetFormWords.noAnswer)

          return
        }

        setAsked(question)

        if (there.length > 0) {
          setTrouble(assetFormWords.decide)
          found.current?.focus()

          return
        }
      }

      const result: EditResult = editing
        ? await askAt(client, 'PATCH', `/assets/${asset.id}`, asset.id, values)
        : parent
          ? await makeAt(client, `/assets/${parent.id}/components`, {
              ...values,
              roomId: typed.roomId === '' ? null : typed.roomId,
            })
          : await makeAt(client, `/buildings/${typed.buildingId}/assets`, {
              ...values,
              roomId: typed.roomId === '' ? null : typed.roomId,
            })

      if (result.outcome === 'refused') {
        setTrouble(refusalFor(result))

        return
      }

      // The register, the file and the duties of an asset come from the
      // server and not from the exchange. What was read of them is dropped,
      // so that the file that opens next does not show for a moment what the
      // asset was before.
      queries.removeQueries({ queryKey: ['assets'] })
      await navigate({ to: officePlaces.asset(result.id) })
    } finally {
      setWorking(false)
    }
  }

  const leaveDuplicateField = () => {
    setAsked({ serialNumber: typed.serialNumber, mark: typed.mark })
  }
  const placeOf = (duplicate: AssetDuplicate): string =>
    [
      maybeText(byId(buildings, duplicate.buildingId), 'name'),
      duplicate.roomId === null ? null : titleOfRoom(byId(rooms, duplicate.roomId)),
    ]
      .filter((part) => part !== null && part !== '')
      .join(', ')
  /** "AN-00057 Trinkwassererwärmer": an asset by its number and its name. */
  const nameOf = (named: { readonly number: string | null; readonly name: string }) =>
    [named.number, named.name].filter(Boolean).join(' ')
  /** Under a field: who carries the same already, the first by name and the rest counted. */
  const taken = (field: DuplicateField): string | undefined => {
    const sharing = shown.filter((each) => each.same.includes(field))
    const [first] = sharing

    if (first === undefined || duplicateKey(typed[field]) !== duplicateKey(asked[field])) {
      return undefined
    }

    const where = maybeText(byId(buildings, first.buildingId), 'name')
    const more = sharing.length - 1

    return `${field === 'mark' ? 'Dieses Kennzeichen' : 'Diese Seriennummer'} trägt schon ${nameOf(first)}${
      where === null ? '' : `, ${where}`
    }${more === 0 ? '' : more === 1 ? ' und eine weitere Anlage' : ` und ${String(more)} weitere Anlagen`}.`
  }

  const general = kind !== null && isGeneralKind(typed.kind)
  const ownFields = kind ? kindFields(kind) : []

  return (
    <Screen>
      <PageHead title={title} crumbs={crumbs} />
      <form
        noValidate
        className="flex flex-col gap-3.5"
        onSubmit={(event) => {
          void save(event, false)
        }}
      >
        <div className="grid items-start gap-3.5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Panel className="px-5! py-[18px]!">
            <div className="flex flex-col gap-3.5">
              {status.online ? null : (
                <p role="status" className="text-[13px] font-medium text-ink-muted">
                  {assetFormWords.noConnection}
                </p>
              )}
              <SelectField
                label="Anlagenart"
                required
                starred
                options={kindChoices(catalogue)}
                value={typed.kind}
                hint={assetFormWords.kindHint}
                problem={problems['kind']}
                onChange={(value) => {
                  set({ kind: value })
                }}
              />
              {general ? (
                <NoteBox>
                  Allgemeine Anlagenart der Kostengruppe {kind.costGroup}: für diese Anlage fehlt
                  noch das Fachpaket, und der Katalog schlägt für sie keine Pflichten vor. Kommt das
                  Paket, wird die Anlagenart hier berichtigt.
                </NoteBox>
              ) : null}
              {fixed ? (
                <p className="text-[13px] leading-[1.4] text-ink-muted">
                  {editing ? (
                    <>
                      Steht in {standsIn(asset, { buildings, floors, rooms })}.{' '}
                      {assetFormWords.movedAtFile}
                    </>
                  ) : (
                    <>
                      Komponente von {nameOf(fixed)}. Sie steht im Gebäude ihrer Anlage:{' '}
                      {building ? text(building, 'name') : 'dem der Anlage'}.
                    </>
                  )}
                </p>
              ) : null}
              {editing ? null : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {parent ? null : (
                    <SelectField
                      label="Gebäude"
                      required
                      starred
                      options={buildingChoices}
                      value={typed.buildingId}
                      problem={problems['buildingId']}
                      onChange={(value) => {
                        set({ buildingId: value, floorId: '', roomId: '' })
                      }}
                    />
                  )}
                  <SelectField
                    label="Geschoss"
                    options={floorChoices}
                    value={typed.floorId}
                    onChange={(value) => {
                      const room = byId(rooms, typed.roomId)

                      set({
                        floorId: value,
                        roomId: value === '' || room?.['floorId'] === value ? typed.roomId : '',
                      })
                    }}
                  />
                  <SelectField
                    label="Raum"
                    options={roomChoices}
                    value={typed.roomId}
                    onChange={(value) => {
                      const room = byId(rooms, value)

                      set({
                        roomId: value,
                        floorId: room ? String(room['floorId']) : typed.floorId,
                      })
                    }}
                  />
                </div>
              )}
              <PanelLabel>Angaben</PanelLabel>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label="Bezeichnung"
                  required
                  starred
                  value={typed.name}
                  problem={problems['name']}
                  onChange={(event) => {
                    set({ name: event.target.value })
                  }}
                />
                <Field
                  label="Kennzeichen"
                  value={typed.mark}
                  problem={problems['mark'] ?? taken('mark')}
                  onBlur={leaveDuplicateField}
                  onChange={(event) => {
                    set({ mark: event.target.value })
                  }}
                />
                <Field
                  label="Hersteller"
                  value={typed.manufacturer}
                  problem={problems['manufacturer']}
                  onChange={(event) => {
                    set({ manufacturer: event.target.value })
                  }}
                />
                <Field
                  label="Typ"
                  value={typed.model}
                  problem={problems['model']}
                  onChange={(event) => {
                    set({ model: event.target.value })
                  }}
                />
                <Field
                  label="Seriennummer"
                  value={typed.serialNumber}
                  problem={problems['serialNumber'] ?? taken('serialNumber')}
                  onBlur={leaveDuplicateField}
                  onChange={(event) => {
                    set({ serialNumber: event.target.value })
                  }}
                />
                <Field
                  label="Baujahr"
                  inputMode="numeric"
                  numeric
                  value={typed.yearBuilt}
                  problem={problems['yearBuilt']}
                  onChange={(event) => {
                    set({ yearBuilt: event.target.value })
                  }}
                />
                <Field
                  label="In Betrieb seit"
                  type="date"
                  value={typed.commissionedOn}
                  problem={problems['commissionedOn']}
                  onChange={(event) => {
                    set({ commissionedOn: event.target.value })
                  }}
                />
                <Field
                  label="Gewährleistung bis"
                  type="date"
                  value={typed.warrantyEndsOn}
                  problem={problems['warrantyEndsOn']}
                  onChange={(event) => {
                    set({ warrantyEndsOn: event.target.value })
                  }}
                />
              </div>
              {shown.length > 0 ? (
                <div ref={found} tabIndex={-1} role="group" aria-label="Mögliche Dublette">
                  {/* The buttons stand in the sentence and not in the action of the
                      box: beside two buttons a phone leaves the sentence the width
                      of a letter. Here they wrap under it. */}
                  <NoteBox tone="conflict" icon={TriangleAlert}>
                    <span className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                      <span className="min-w-0 grow basis-[240px]">
                        {shown.map((duplicate) => (
                          <span key={duplicate.id} className="block">
                            {sameWords(duplicate.same)} wie{' '}
                            <Link to={officePlaces.asset(duplicate.id)} className="underline">
                              {nameOf(duplicate)}
                            </Link>
                            {placeOf(duplicate) === '' ? '' : `, ${placeOf(duplicate)}`}.
                          </span>
                        ))}
                        <span className="block">
                          {editing
                            ? 'Ist es dieselbe Anlage, steht sie zweimal im Verzeichnis.'
                            : 'Ist es dieselbe Anlage, öffnen Sie diese, statt eine zweite anzulegen.'}
                        </span>
                      </span>
                      <span className="flex flex-wrap gap-1.5">
                        {shown.length === 1 && shown[0] ? (
                          <Button
                            size="small"
                            onClick={() => {
                              void navigate({ to: officePlaces.asset(shown[0]?.id ?? '') })
                            }}
                          >
                            {editing ? 'Zur anderen Anlage' : 'Zur vorhandenen Anlage'}
                          </Button>
                        ) : null}
                        <Button
                          size="small"
                          disabled={working || !status.online}
                          onClick={() => {
                            void save(null, true)
                          }}
                        >
                          {anyway}
                        </Button>
                      </span>
                    </span>
                  </NoteBox>
                </div>
              ) : null}
              {kind && (ownFields.length > 0 || kind.meter !== null) ? (
                <>
                  <PanelLabel>Angaben der Anlagenart</PanelLabel>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {kind.meter === null ? null : (
                      <>
                        <Field
                          label="Zählernummer"
                          required
                          starred
                          value={typed.meterNumber}
                          problem={problems['meterNumber']}
                          hint={`Misst ${meterMediumLabel[kind.meter.medium]}.`}
                          onChange={(event) => {
                            set({ meterNumber: event.target.value })
                          }}
                        />
                        <SelectField
                          label="Einheit"
                          required
                          starred
                          options={kind.meter.units.map((unit) => ({
                            value: unit,
                            label: meterUnitSymbol[unit],
                          }))}
                          value={typed.meterUnit}
                          problem={problems['meterUnit']}
                          onChange={(value) => {
                            set({ meterUnit: value })
                          }}
                        />
                      </>
                    )}
                    {ownFields.map((entry) => (
                      <KindFieldInput
                        key={entry.field.key}
                        entry={entry}
                        value={typed.values[entry.field.key] ?? ''}
                        problem={problems[`values.${entry.field.key}`]}
                        onChange={(value) => {
                          set({ values: { ...typed.values, [entry.field.key]: value } })
                        }}
                      />
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          </Panel>
          <KindDuties catalogue={catalogue} kind={kind === null ? null : typed.kind} />
        </div>
        {trouble ? (
          <p role="alert" className="text-[13px] font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {editing && keeps ? (
            <>
              <RemovePlace
                label="Anlage entfernen"
                question={`„${asset.name}“ entfernen?`}
                disabled={!status.online}
                remove={() => askAt(client, 'DELETE', `/assets/${asset.id}`, asset.id)}
                onRemoved={async () => {
                  queries.removeQueries({ queryKey: ['assets'] })
                  await navigate({
                    to: asset.parent ? officePlaces.asset(asset.parent.id) : assetRegisterPlace.to,
                  })
                }}
              >
                {assetFormWords.removeAsks}
              </RemovePlace>
              <div className="grow" />
            </>
          ) : null}
          <Button onClick={back} disabled={working}>
            Abbrechen
          </Button>
          <Button type="submit" tone="primary" icon={Check} disabled={working || !status.online}>
            {working ? 'Wird gespeichert' : submitLabel}
          </Button>
        </div>
      </form>
    </Screen>
  )
}

/** "E.14 Heizraum, Erdgeschoss, Schulhaus": where an asset stands, as its file says it. */
function standsIn(
  asset: Pick<AssetDetails, 'buildingId' | 'roomId'>,
  held: {
    readonly buildings: readonly RecordState[]
    readonly floors: readonly RecordState[]
    readonly rooms: readonly RecordState[]
  },
): string {
  const room = held.rooms.find((record) => record['id'] === asset.roomId) ?? null
  const floor = room
    ? (held.floors.find((record) => record['id'] === room['floorId']) ?? null)
    : null
  const building = held.buildings.find((record) => record['id'] === asset.buildingId) ?? null

  return (
    [
      room ? titleOfRoom(room) : null,
      floor ? text(floor, 'name') : null,
      building ? text(building, 'name') : null,
    ]
      .filter(Boolean)
      .join(', ') || 'ihrem Gebäude'
  )
}

/** One field of the kind: a figure with its unit, yes or no, a choice, a text or a day. */
function KindFieldInput({
  entry,
  value,
  problem,
  onChange,
}: {
  readonly entry: KindField
  readonly value: string
  readonly problem: string | undefined
  readonly onChange: (value: string) => void
}) {
  const { field } = entry

  if (field.kind === 'flag' || field.kind === 'choice') {
    return (
      <SelectField
        label={field.label}
        options={[
          { value: '', label: assetFormWords.noValue },
          ...(field.kind === 'flag'
            ? [
                { value: 'true', label: 'Ja' },
                { value: 'false', label: 'Nein' },
              ]
            : field.options),
        ]}
        value={value}
        problem={problem}
        onChange={onChange}
      />
    )
  }

  return (
    <Field
      label={field.label}
      type={field.kind === 'date' ? 'date' : 'text'}
      {...(field.kind === 'number' ? { inputMode: 'decimal' as const, numeric: true } : {})}
      {...(unitOf(entry) === undefined ? {} : { unit: unitOf(entry) })}
      value={value}
      problem={problem}
      onChange={(event) => {
        onChange(event.target.value)
      }}
    />
  )
}

/**
 * Beside the form: the duty kinds the catalogue holds for the chosen kind,
 * so that nobody enters an asset without seeing what comes with it. Which of
 * them apply to this asset depends on more than its kind, and says so.
 */
function KindDuties({
  catalogue,
  kind,
}: {
  readonly catalogue: Catalogue
  readonly kind: string | null
}) {
  const duties = kind ? dutyKindsNaming(catalogue, kind, today()) : []
  const said = (children: ReactNode) => (
    <p className="text-[13px] leading-[1.4] text-ink-muted">{children}</p>
  )

  return (
    <Panel title="Pflichten aus dem Katalog">
      {kind === null ? (
        said(assetFormWords.chooseKind)
      ) : duties.length === 0 ? (
        said(assetFormWords.noDuties)
      ) : (
        <div className="flex flex-col gap-2">
          {said(assetFormWords.duties)}
          <ul className="flex list-disc flex-col gap-2 pl-[18px] text-[13px] leading-[1.4]">
            {duties.map((duty) => (
              <li key={duty.key}>
                <Link to={cataloguePlaces.dutyKind(duty.key)} className={factLink}>
                  {duty.definition.label}
                </Link>
                <div className="text-[12px] text-ink-faint">
                  {[duty.definition.source, intervalLine(catalogue, duty.definition, today())]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
                <div className="mt-[3px] flex flex-wrap gap-1 empty:hidden">
                  <ReviewMarks review={duty.review} />
                </div>
              </li>
            ))}
          </ul>
          <p className="text-[12px] leading-[1.4] text-ink-faint">{assetFormWords.whichApply}</p>
        </div>
      )}
    </Panel>
  )
}
