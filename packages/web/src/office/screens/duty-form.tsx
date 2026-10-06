import {
  type AssetDetails,
  type Counting,
  countingLabel,
  countings,
  dutyBases,
  dutyBasisLabel,
  dutyIntervalProblem,
  type DutyPerformer,
  dutyPerformerLabel,
  dutyPerformers,
  dutyProblems,
  dutyTaskLabel,
  dutyTasks,
  isGeneralKind,
  type RecordState,
} from '@opengewerk/haustechnik-domain'
import {
  Button,
  Choice,
  type ChoiceOption,
  Field,
  Panel,
  PanelLabel,
  SelectField,
} from '@opengewerk/platform-web'
import { Empty, PageHead, Screen } from '@opengewerk/platform-web/office'
import { useRight } from '@opengewerk/platform-web/session'
import { refusalFor, text, useRecords, useSync, useSyncStatus } from '@opengewerk/platform-web/sync'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { Check } from 'lucide-react'
import { type FormEvent, useMemo, useState } from 'react'

import { placePath } from '../../app/place-path.js'
import { placeAbove, titleOfRoom } from '../../app/place-records.js'
import { makeAt } from '../../sync/made-at.js'
import { dutyPlaces, dutyRegisterPlace, newDutyStart } from '../duty-addresses.js'
import { officePlaces } from '../place-addresses.js'
import { assetFileQuery, AssetFileUnread } from './asset.js'
import { dutyColleaguesQuery, dutyPageWords } from './duty.js'

/**
 * A duty of the operator's own to make in the office, `eigene()` of the
 * boards (4.3 and 2.3 of the concept): what the maker asks for, a condition
 * of the building permit or the fire protection concept, what the insurer
 * demands, or what the operator has decided, each with the source it names.
 * A task that comes back at an interval is made the same way, as a decision
 * of the operator's own, and runs through the same engine (4.8).
 *
 * It hangs on an asset, a room, a building or the property itself. The form
 * is opened from one of them and offers that place and every place above it;
 * opened from the register, it asks for the property and, where the duty is
 * one of a building, the building.
 *
 * Whoever keeps the register fills it in ("Pflichtenverzeichnis führen",
 * section 7). It is written at the route of the server, with a connection:
 * the register and the page it leads to come from there.
 */

export const dutyFormWords = {
  title: 'Eigene Pflicht',
  sub: 'Eine Pflicht, die nicht aus dem Katalog kommt, mit ihrer Quelle',
  mayNot: 'Eine eigene Pflicht anlegen kann nur, wer das Pflichtenverzeichnis führt.',
  placeUnread:
    'Woran die Pflicht hängen soll, ist auf diesem Gerät nicht zu finden. Öffnen Sie das Formular von der Anlage, dem Raum, dem Gebäude oder der Liegenschaft aus.',
  noConnection: 'Angelegt wird eine Pflicht im Büro mit Verbindung. Gerade ist keine da.',
  hangsOn: 'Woran die Pflicht hängt',
  wholeProperty: 'Die Liegenschaft selbst',
  elsewhere:
    'Eine Pflicht an einer Anlage oder an einem Raum legen Sie von dort aus an: an der Akte der Anlage und auf der Seite des Raums steht „Pflicht hinzufügen“.',
  basisHint:
    'Vorgabe des Herstellers, Auflage aus Baugenehmigung oder Brandschutzkonzept, Forderung des Versicherers oder eigene Festlegung.',
  sourceHint: 'So genau, dass jemand sie nachschlagen kann.',
  countingHint: 'Ab dem fälligen Tag hält den Rhythmus, auch wenn früher gewartet wurde.',
  noLabel: 'Die Bezeichnung fehlt.',
  noTask: 'Die Tätigkeit fehlt.',
  noBasis: 'Die Grundlage fehlt.',
  noSource: 'Die Quelle fehlt. Ohne sie wird eine eigene Pflicht nicht angenommen.',
  noInterval: 'Die Frist fehlt.',
  noProperty: 'Die Liegenschaft fehlt.',
  check: 'Bitte prüfen Sie die markierten Felder.',
  noColleagues: 'Wer zur Wahl steht, ließ sich nicht laden. Das braucht eine Verbindung.',
  likeTheCatalogue:
    'Eine eigene Pflicht steht im Pflichtenverzeichnis wie eine aus dem Katalog und erinnert wie sie. Sie trägt keine Kennzeichnung „Nicht abgenommen“: für sie steht die Quelle, die Sie nennen.',
  neverRecorded: 'Bis der erste Nachweis eingetragen ist, ist sie nie erfasst.',
  recurring:
    'Auch eine Aufgabe, die regelmäßig wiederkommt, wird so angelegt: als eigene Pflicht mit der Grundlage „Eigene Festlegung“.',
  generalKind:
    'Diese Anlage hat eine allgemeine Anlagenart. Für sie schlägt noch kein Fachpaket Pflichten vor; eigene Pflichten trägt sie von Anfang an.',
} as const

/** The places a new duty may hang on: the one the form was opened from, and every place above it. */
interface Places {
  readonly asset: AssetDetails | null
  readonly room: RecordState | null
  readonly floor: RecordState | null
  readonly building: RecordState | null
  readonly property: RecordState
}

type Target = 'asset' | 'room' | 'building' | 'property'

const idOf = (record: RecordState) => String(record['id'])

/** "AN-00057 Trinkwassererwärmer": an asset by its number and its name. */
const nameOfAsset = (asset: Pick<AssetDetails, 'number' | 'name'>) =>
  [asset.number, asset.name].filter(Boolean).join(' ')

export function NewDutyScreen() {
  const keeps = useRight('duty.write')
  const search = useSearch({ strict: false })
  const start = useMemo(() => newDutyStart(search), [search])
  const properties = useRecords('properties')
  const buildings = useRecords('buildings')
  const floors = useRecords('floors')
  const rooms = useRecords('rooms')
  const file = useQuery({
    ...assetFileQuery(start.assetId ?? ''),
    enabled: start.assetId !== undefined && keeps,
  })

  const unread = (words: string) => (
    <Screen>
      <PageHead title={dutyFormWords.title} crumbs={[dutyRegisterPlace]} />
      <Empty>{words}</Empty>
    </Screen>
  )

  if (!keeps) {
    return unread(dutyFormWords.mayNot)
  }

  const asset = file.data ?? null

  if (start.assetId !== undefined && asset === null) {
    return <AssetFileUnread file={file} />
  }

  const named = start.assetId ?? start.roomId ?? start.buildingId ?? start.propertyId

  // Opened from the register: the form asks where.
  if (named === undefined) {
    return <DutyForm key="anywhere" at={null} />
  }

  const byId = (records: readonly RecordState[], id: unknown) =>
    id === undefined || id === null ? null : (records.find((record) => record['id'] === id) ?? null)
  const room = byId(rooms, asset ? asset.roomId : start.roomId)
  const building = byId(
    buildings,
    asset ? asset.buildingId : room ? room['buildingId'] : start.buildingId,
  )
  const property = byId(
    properties,
    asset
      ? asset.propertyId
      : room
        ? room['propertyId']
        : building
          ? building['propertyId']
          : start.propertyId,
  )

  // A form reads what it starts with once: it is made when the place the
  // address names is there, and not before.
  if (
    property === null ||
    (start.roomId !== undefined && room === null) ||
    (start.buildingId !== undefined && building === null)
  ) {
    return unread(dutyFormWords.placeUnread)
  }

  return (
    <DutyForm
      key={named}
      at={{
        asset,
        room,
        floor: room ? byId(floors, room['floorId']) : null,
        building,
        property,
      }}
    />
  )
}

/** What the form holds, every field as the text that stands in it. */
interface Typed {
  /** Where the form asks for the place itself: the property, and the building or none. */
  readonly propertyId: string
  readonly buildingId: string
  readonly label: string
  readonly task: string
  readonly basis: string
  readonly sourceNote: string
  readonly interval: string
  readonly unit: 'months' | 'days'
  readonly counting: Counting
  readonly responsibleUserId: string
  readonly performer: DutyPerformer | null
  readonly performerNote: string
}

function DutyForm({ at }: { readonly at: Places | null }) {
  const client = useSync()
  const status = useSyncStatus()
  const queries = useQueryClient()
  const navigate = useNavigate()
  const properties = useRecords('properties')
  const buildings = useRecords('buildings')
  const colleagues = useQuery(dutyColleaguesQuery)

  const offered: readonly ChoiceOption<Target>[] =
    at === null
      ? []
      : [
          ...(at.asset
            ? [{ value: 'asset' as const, label: 'Anlage', note: nameOfAsset(at.asset) }]
            : []),
          ...(at.room
            ? [{ value: 'room' as const, label: 'Raum', note: titleOfRoom(at.room) }]
            : []),
          ...(at.building
            ? [{ value: 'building' as const, label: 'Gebäude', note: text(at.building, 'name') }]
            : []),
          { value: 'property' as const, label: 'Liegenschaft', note: text(at.property, 'name') },
        ]

  const [target, setTarget] = useState<Target>(offered[0]?.value ?? 'property')
  const [typed, setTyped] = useState<Typed>({
    propertyId: '',
    buildingId: '',
    label: '',
    task: '',
    basis: '',
    sourceNote: '',
    interval: '',
    unit: 'months',
    counting: 'from_performance',
    responsibleUserId: '',
    performer: null,
    performerNote: '',
  })
  const [problems, setProblems] = useState<Readonly<Record<string, string>>>({})
  const [trouble, setTrouble] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  const set = (values: Partial<Typed>) => {
    setTyped((current) => ({ ...current, ...values }))
  }

  // An operator with one property has nothing to choose: it is the one.
  const [only] = properties
  const propertyId =
    typed.propertyId !== '' ? typed.propertyId : properties.length === 1 && only ? idOf(only) : ''
  const byName = (left: RecordState, right: RecordState) =>
    text(left, 'name').localeCompare(text(right, 'name'), 'de')
  const propertyChoices = [...properties]
    .sort(byName)
    .map((each) => ({ value: idOf(each), label: text(each, 'name') }))
  const buildingChoices = [
    { value: '', label: dutyFormWords.wholeProperty },
    ...buildings
      .filter((each) => each['propertyId'] === propertyId)
      .sort(byName)
      .map((each) => ({ value: idOf(each), label: text(each, 'name') })),
  ]
  // Whoever is shut out of the operator is named for nothing anew.
  const responsibleChoices = [
    { value: '', label: dutyPageWords.nobody },
    ...(colleagues.data ?? [])
      .filter((person) => person.active)
      .map((person) => ({ value: person.userId, label: person.name })),
  ]

  const crumbs =
    at === null
      ? [dutyRegisterPlace]
      : placePath(
          placeAbove({
            property: at.property,
            building: at.building,
            floor: at.floor,
            room: at.room,
            asset: at.asset ? { id: at.asset.id, name: nameOfAsset(at.asset) } : null,
          }),
          officePlaces,
        )

  /** Back to where the form was opened from. */
  const back = () => {
    void navigate({
      to:
        at === null
          ? dutyRegisterPlace.to
          : at.asset
            ? officePlaces.asset(at.asset.id)
            : at.room
              ? officePlaces.room(idOf(at.room))
              : at.building
                ? officePlaces.building(idOf(at.building))
                : officePlaces.property(idOf(at.property)),
    })
  }

  /** What the duty hangs on: exactly one, as the route takes it. */
  const hangsOn = (): Readonly<Record<string, string>> => {
    if (at === null) {
      return typed.buildingId === '' ? { propertyId } : { buildingId: typed.buildingId }
    }

    if (target === 'asset' && at.asset) {
      return { assetId: at.asset.id }
    }

    if (target === 'room' && at.room) {
      return { roomId: idOf(at.room) }
    }

    return target === 'building' && at.building
      ? { buildingId: idOf(at.building) }
      : { propertyId: idOf(at.property) }
  }

  /** The interval as the model takes it: a whole number where one was typed, else what was typed, for the model to refuse. */
  const interval = () => {
    const said = typed.interval.trim()
    const value = /^\d+$/.test(said) ? Number(said) : said

    return typed.unit === 'months' ? { intervalMonths: value } : { intervalDays: value }
  }

  /** What the form says about the duty, as the route and the model take it. */
  const wanted = () => ({
    ...hangsOn(),
    label: typed.label.trim(),
    task: typed.task === '' ? null : typed.task,
    basis: typed.basis === '' ? null : typed.basis,
    sourceNote: typed.sourceNote.trim(),
    counting: typed.counting,
    ...interval(),
    responsibleUserId: typed.responsibleUserId === '' ? null : typed.responsibleUserId,
    performer: typed.performer,
    // The note names the contractor, and goes only with one.
    performerNote:
      typed.performer === 'contractor' && typed.performerNote.trim() !== ''
        ? typed.performerNote.trim()
        : null,
  })

  async function save(event: FormEvent) {
    event.preventDefault()
    setTrouble(null)

    const values = wanted()
    const wrong: Record<string, string> = {
      ...dutyProblems(values),
      ...(values.label === '' ? { label: dutyFormWords.noLabel } : {}),
      ...(values.task === null ? { task: dutyFormWords.noTask } : {}),
      ...(values.basis === null ? { basis: dutyFormWords.noBasis } : {}),
      ...(values.sourceNote === '' ? { sourceNote: dutyFormWords.noSource } : {}),
      ...(at === null && propertyId === '' ? { propertyId: dutyFormWords.noProperty } : {}),
    }
    const intervalWrong =
      typed.interval.trim() === ''
        ? dutyFormWords.noInterval
        : dutyIntervalProblem(interval(), typed.counting, null)

    if (intervalWrong !== null) {
      wrong['interval'] = intervalWrong
    }

    setProblems(wrong)

    if (Object.keys(wrong).length > 0) {
      setTrouble(dutyFormWords.check)

      return
    }

    setWorking(true)

    try {
      const result = await makeAt(client, '/duties', values)

      if (result.outcome === 'refused') {
        setTrouble(refusalFor(result))

        return
      }

      // The register and the page of a duty come from the server, and so do
      // the file of an asset, its duties and the register of assets, where an
      // asset without duties has just become one that was never tested.
      await queries.invalidateQueries({ queryKey: ['duties'] })
      queries.removeQueries({ queryKey: ['assets'] })
      await navigate({ to: dutyPlaces.duty(result.id) })
    } finally {
      setWorking(false)
    }
  }

  const general = at?.asset ? isGeneralKind(at.asset.kind) : false

  return (
    <Screen>
      <PageHead title={dutyFormWords.title} sub={dutyFormWords.sub} crumbs={crumbs} />
      <form
        noValidate
        className="flex flex-col gap-3.5"
        onSubmit={(event) => {
          void save(event)
        }}
      >
        <div className="grid items-start gap-3.5 lg:grid-cols-[minmax(0,1fr)_330px]">
          <Panel className="px-5! py-[18px]!">
            <div className="flex flex-col gap-3.5">
              {status.online ? null : (
                <p role="status" className="text-[13px] font-medium text-ink-muted">
                  {dutyFormWords.noConnection}
                </p>
              )}
              {at === null ? (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <SelectField
                      label="Liegenschaft"
                      required
                      starred
                      options={propertyChoices}
                      value={propertyId}
                      problem={problems['propertyId']}
                      onChange={(value) => {
                        set({ propertyId: value, buildingId: '' })
                      }}
                    />
                    <SelectField
                      label="Gebäude"
                      options={buildingChoices}
                      value={typed.buildingId}
                      onChange={(value) => {
                        set({ buildingId: value })
                      }}
                    />
                  </div>
                  <p className="text-[13px] leading-[1.4] text-ink-muted">
                    {dutyFormWords.elsewhere}
                  </p>
                </>
              ) : (
                <Choice
                  label={dutyFormWords.hangsOn}
                  options={offered}
                  value={target}
                  onChange={setTarget}
                />
              )}
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_210px]">
                <Field
                  label="Bezeichnung"
                  required
                  starred
                  value={typed.label}
                  problem={problems['label']}
                  onChange={(event) => {
                    set({ label: event.target.value })
                  }}
                />
                <SelectField
                  label="Tätigkeit"
                  required
                  starred
                  options={dutyTasks.map((task) => ({ value: task, label: dutyTaskLabel[task] }))}
                  value={typed.task}
                  problem={problems['task']}
                  onChange={(value) => {
                    set({ task: value })
                  }}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <SelectField
                  label="Grundlage"
                  required
                  starred
                  options={dutyBases.map((basis) => ({
                    value: basis,
                    label: dutyBasisLabel[basis],
                  }))}
                  value={typed.basis}
                  hint={dutyFormWords.basisHint}
                  problem={problems['basis']}
                  onChange={(value) => {
                    set({ basis: value })
                  }}
                />
                <Field
                  label="Quelle"
                  required
                  starred
                  value={typed.sourceNote}
                  hint={dutyFormWords.sourceHint}
                  problem={problems['sourceNote']}
                  onChange={(event) => {
                    set({ sourceNote: event.target.value })
                  }}
                />
              </div>
              <PanelLabel>Frist</PanelLabel>
              <div className="grid gap-3 sm:grid-cols-[110px_150px_minmax(0,1fr)]">
                <Field
                  label="Frist"
                  required
                  starred
                  inputMode="numeric"
                  numeric
                  value={typed.interval}
                  problem={problems['interval']}
                  onChange={(event) => {
                    set({ interval: event.target.value })
                  }}
                />
                <SelectField
                  label="Einheit"
                  options={[
                    { value: 'months', label: 'Monate' },
                    { value: 'days', label: 'Tage' },
                  ]}
                  value={typed.unit}
                  onChange={(value) => {
                    set({ unit: value === 'days' ? 'days' : 'months' })
                  }}
                />
                <SelectField
                  label="Gezählt"
                  options={countings.map((counting) => ({
                    value: counting,
                    label: countingLabel[counting],
                  }))}
                  value={typed.counting}
                  hint={dutyFormWords.countingHint}
                  problem={problems['counting']}
                  onChange={(value) => {
                    set({ counting: countings.find((each) => each === value) ?? typed.counting })
                  }}
                />
              </div>
              <PanelLabel>Zuständig</PanelLabel>
              <div className="grid items-start gap-3 sm:grid-cols-2">
                <SelectField
                  label="Verantwortlich"
                  options={responsibleChoices}
                  value={typed.responsibleUserId}
                  onChange={(value) => {
                    set({ responsibleUserId: value })
                  }}
                />
                <Choice
                  label="Ausgeführt von"
                  options={dutyPerformers.map((performer) => ({
                    value: performer,
                    label: dutyPerformerLabel[performer],
                  }))}
                  value={typed.performer}
                  onChange={(value) => {
                    set({ performer: value })
                  }}
                />
              </div>
              {colleagues.isError ? (
                <p role="status" className="text-[13px] font-medium text-ink-muted">
                  {dutyFormWords.noColleagues}
                </p>
              ) : null}
              {typed.performer === 'contractor' ? (
                <Field
                  label="Angabe zur Fremdfirma"
                  value={typed.performerNote}
                  problem={problems['performerNote']}
                  onChange={(event) => {
                    set({ performerNote: event.target.value })
                  }}
                />
              ) : null}
            </div>
          </Panel>
          <div className="flex min-w-0 flex-col gap-3.5">
            <Panel title="Gut zu wissen">
              <div className="flex flex-col gap-[9px] text-[13px] leading-[1.45] text-ink max-sm:text-[15px]">
                <p>{dutyFormWords.likeTheCatalogue}</p>
                <p>{dutyFormWords.neverRecorded}</p>
                <p>{dutyFormWords.recurring}</p>
              </div>
            </Panel>
            {general ? (
              <Panel title="Allgemeine Anlagenart">
                <p className="text-[13px] leading-[1.45] text-ink-muted max-sm:text-[15px]">
                  {dutyFormWords.generalKind}
                </p>
              </Panel>
            ) : null}
          </div>
        </div>
        {trouble ? (
          <p role="alert" className="text-[13px] font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button onClick={back} disabled={working}>
            Abbrechen
          </Button>
          <Button type="submit" tone="primary" icon={Check} disabled={working || !status.online}>
            {working ? 'Wird gespeichert' : 'Pflicht anlegen'}
          </Button>
        </div>
      </form>
    </Screen>
  )
}
