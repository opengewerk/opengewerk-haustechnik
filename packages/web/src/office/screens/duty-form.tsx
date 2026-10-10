import {
  type AssetDetails,
  type Counting,
  countingLabel,
  countings,
  dutyBases,
  dutyBasisLabel,
  type DutyDetails,
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
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { Check } from 'lucide-react'
import { type FormEvent, useMemo, useState } from 'react'

import { placePath } from '../../app/place-path.js'
import { placeAbove, titleOfRoom } from '../../app/place-records.js'
import { askAt, makeAt } from '../../sync/made-at.js'
import { dutyPlaces, dutyRegisterPlace, newDutyStart } from '../duty-addresses.js'
import { officePlaces } from '../place-addresses.js'
import { RemovePlace } from '../place-forms.js'
import { assetFileQuery, AssetFileUnread } from './asset.js'
import {
  dutyColleaguesQuery,
  dutyQuery,
  dutyTarget,
  DutyUnread,
  responsibleChoices,
  useDutyPlaces,
} from './duty.js'

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
 * The same form changes a duty of the operator's own there is,
 * `pflicht_bearbeiten()` of the boards (#178): without the choice of the
 * place, as what a duty hangs on stays, and with the counting as it was
 * confirmed. A duty without evidence and without an activity that was signed
 * or closed may have been entered by mistake, and is removed there.
 *
 * Whoever keeps the register fills it in ("Pflichtenverzeichnis führen",
 * section 7). It is written at the route of the server, with a connection:
 * the register and the page it leads to come from there.
 */

export const dutyFormWords = {
  title: 'Eigene Pflicht',
  sub: 'Eine Pflicht, die nicht aus dem Katalog kommt, mit ihrer Quelle',
  mayNot: 'Eine eigene Pflicht anlegen kann nur, wer das Pflichtenverzeichnis führt.',
  mayNotChange: 'Eine Pflicht bearbeiten kann nur, wer das Pflichtenverzeichnis führt.',
  fromTheCatalogue:
    'Eine Pflicht aus dem Katalog nimmt Bezeichnung, Grundlage, Quelle und Tätigkeit von ihrer Pflichtart. Bearbeiten lässt sich hier eine eigene Pflicht.',
  ended: 'Diese Pflicht ist beendet; eine beendete Pflicht ändert sich nicht mehr.',
  placeUnread:
    'Woran die Pflicht hängen soll, ist auf diesem Gerät nicht zu finden. Öffnen Sie das Formular von der Anlage, dem Raum, dem Gebäude oder der Liegenschaft aus.',
  noConnection: 'Angelegt wird eine Pflicht im Büro mit Verbindung. Gerade ist keine da.',
  noConnectionToChange: 'Geändert wird eine Pflicht im Büro mit Verbindung. Gerade ist keine da.',
  hangsOn: 'Woran die Pflicht hängt',
  wholeProperty: 'Die Liegenschaft selbst',
  elsewhere:
    'Eine Pflicht an einer Anlage oder an einem Raum legen Sie von dort aus an: an der Akte der Anlage und auf der Seite des Raums steht „Pflicht hinzufügen“.',
  basisHint:
    'Vorgabe des Herstellers, Auflage aus Baugenehmigung oder Brandschutzkonzept, Forderung des Versicherers oder eigene Festlegung.',
  sourceHint: 'So genau, dass jemand sie nachschlagen kann.',
  countingHint: 'Ab dem fälligen Tag hält den Rhythmus, auch wenn früher gewartet wurde.',
  countingStays: 'Bleibt, wie die Pflicht angelegt wurde.',
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
  placeStays:
    'Woran die Pflicht hängt, bleibt. Gehört sie an einen anderen Ort, legen Sie sie dort neu an und beenden diese.',
  intervalCounts:
    'Ändert sich die Frist, rechnet der Termin mit ihr neu. Nachweise und Vorgänge bleiben bei der Pflicht.',
  removeOrEnd:
    'Entfernen ist für eine Pflicht, die irrtümlich angelegt wurde: ohne Nachweis und ohne unterschriebenen Vorgang. Gilt eine Pflicht nicht mehr, beenden Sie sie auf ihrer Seite.',
  removeAsks:
    'Die Pflicht verschwindet aus dem Pflichtenverzeichnis und von ihrer Anlage und erinnert niemanden mehr. Was zu ihr geplant und nicht unterschrieben ist, geht mit. Im Änderungsprotokoll bleibt stehen, wer sie angelegt und wer sie entfernt hat. War sie kein Irrtum und gilt nur nicht mehr, beenden Sie sie stattdessen.',
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

/**
 * The form over a duty of the operator's own there is (#178). Read from the
 * server like the page of the duty; a duty from the catalogue and one that
 * has ended are not changed here, and the screen says why.
 */
export function EditDutyScreen() {
  const { dutyId } = useParams({ strict: false }) as { dutyId?: string }
  const keeps = useRight('duty.write')
  const page = useQuery({ ...dutyQuery(dutyId ?? ''), enabled: dutyId !== undefined && keeps })
  const duty = page.data
  const places = useDutyPlaces(duty)

  const unread = (words: string) => (
    <Screen>
      <PageHead
        title={duty?.title ?? 'Pflicht'}
        crumbs={[
          dutyRegisterPlace,
          ...(duty ? [{ to: dutyPlaces.duty(duty.id), label: duty.title }] : []),
        ]}
      />
      <Empty>{words}</Empty>
    </Screen>
  )

  if (!keeps) {
    return unread(dutyFormWords.mayNotChange)
  }

  if (duty === undefined) {
    return <DutyUnread page={page} />
  }

  if (duty.kind !== null) {
    return unread(dutyFormWords.fromTheCatalogue)
  }

  if (duty.ended) {
    return unread(dutyFormWords.ended)
  }

  return <EditDutyForm key={duty.id} duty={duty} target={dutyTarget(duty, places)} />
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

/** What a new duty starts with. */
const blank: Typed = {
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
}

/** What the form starts with over a duty there is: what it says, as text. */
function typedOf(duty: DutyDetails): Typed {
  return {
    ...blank,
    label: duty.label ?? '',
    task: duty.task ?? '',
    basis: duty.basis ?? '',
    sourceNote: duty.sourceNote ?? '',
    interval: String(duty.intervalDays ?? duty.intervalMonths ?? ''),
    unit: duty.intervalDays === null ? 'months' : 'days',
    counting: duty.counting,
    responsibleUserId: duty.responsibleUserId ?? '',
    performer: duty.performer,
    performerNote: duty.performerNote ?? '',
  }
}

/** The interval as the model takes it: a whole number where one was typed, else what was typed, for the model to refuse. */
function intervalOf(typed: Typed) {
  const said = typed.interval.trim()
  const value = /^\d+$/.test(said) ? Number(said) : said

  return typed.unit === 'months' ? { intervalMonths: value } : { intervalDays: value }
}

/** What the form says about the duty itself, as the route and the model take it. */
function described(typed: Typed) {
  return {
    label: typed.label.trim(),
    task: typed.task === '' ? null : typed.task,
    basis: typed.basis === '' ? null : typed.basis,
    sourceNote: typed.sourceNote.trim(),
    ...intervalOf(typed),
    responsibleUserId: typed.responsibleUserId === '' ? null : typed.responsibleUserId,
    performer: typed.performer,
    // The note names the contractor, and goes only with one.
    performerNote:
      typed.performer === 'contractor' && typed.performerNote.trim() !== ''
        ? typed.performerNote.trim()
        : null,
  }
}

/** What is wrong with what the form says about the duty itself, by field. */
function problemsOf(typed: Typed, counting: Counting): Record<string, string> {
  const values = described(typed)
  const wrong: Record<string, string> = {
    ...dutyProblems(values),
    ...(values.label === '' ? { label: dutyFormWords.noLabel } : {}),
    ...(values.task === null ? { task: dutyFormWords.noTask } : {}),
    ...(values.basis === null ? { basis: dutyFormWords.noBasis } : {}),
    ...(values.sourceNote === '' ? { sourceNote: dutyFormWords.noSource } : {}),
  }
  const intervalWrong =
    typed.interval.trim() === ''
      ? dutyFormWords.noInterval
      : dutyIntervalProblem(intervalOf(typed), counting, null)

  if (intervalWrong !== null) {
    wrong['interval'] = intervalWrong
  }

  return wrong
}

function DutyForm({ at }: { readonly at: Places | null }) {
  const client = useSync()
  const status = useSyncStatus()
  const queries = useQueryClient()
  const navigate = useNavigate()
  const properties = useRecords('properties')
  const buildings = useRecords('buildings')

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
  const [typed, setTyped] = useState<Typed>(blank)
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

  async function save(event: FormEvent) {
    event.preventDefault()
    setTrouble(null)

    const values = { ...hangsOn(), ...described(typed), counting: typed.counting }
    const wrong: Record<string, string> = {
      ...dutyProblems(values),
      ...problemsOf(typed, typed.counting),
      ...(at === null && propertyId === '' ? { propertyId: dutyFormWords.noProperty } : {}),
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
              <DutyFields typed={typed} set={set} problems={problems} named={null} />
            </div>
          </Panel>
          <div className="flex min-w-0 flex-col gap-3.5">
            <GoodToKnow
              lines={[
                dutyFormWords.likeTheCatalogue,
                dutyFormWords.neverRecorded,
                dutyFormWords.recurring,
              ]}
            />
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

/**
 * The form over a duty of the operator's own there is (#178). It sends what
 * changed and nothing else, at the route of the duty; nothing changed is
 * nothing to ask the server for. What the duty hangs on and how it counts
 * stay as they were confirmed, and the route takes neither.
 */
function EditDutyForm({ duty, target }: { readonly duty: DutyDetails; readonly target: string }) {
  const client = useSync()
  const status = useSyncStatus()
  const queries = useQueryClient()
  const navigate = useNavigate()
  const [typed, setTyped] = useState<Typed>(() => typedOf(duty))
  const [problems, setProblems] = useState<Readonly<Record<string, string>>>({})
  const [trouble, setTrouble] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  const set = (values: Partial<Typed>) => {
    setTyped((current) => ({ ...current, ...values }))
  }

  const back = () => {
    void navigate({ to: dutyPlaces.duty(duty.id) })
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    setTrouble(null)

    const wrong = problemsOf(typed, duty.counting)

    setProblems(wrong)

    if (Object.keys(wrong).length > 0) {
      setTrouble(dutyFormWords.check)

      return
    }

    // What differs from what the duty said, field by field: a unit that
    // changed sends the interval under its own name, and the route lets the
    // other one go.
    const was: Readonly<Record<string, unknown>> = described(typedOf(duty))
    const changes = Object.fromEntries(
      Object.entries(described(typed)).filter(([field, value]) => was[field] !== value),
    )

    if (Object.keys(changes).length === 0) {
      back()

      return
    }

    setWorking(true)

    try {
      const result = await askAt(client, 'PATCH', `/duties/${duty.id}`, duty.id, changes)

      if (result.outcome === 'refused') {
        setTrouble(refusalFor(result))

        return
      }

      // The page and the register are read again, and what was read of the
      // assets is dropped: the file of an asset names its duties.
      await queries.invalidateQueries({ queryKey: ['duties'] })
      queries.removeQueries({ queryKey: ['assets'] })
      back()
    } finally {
      setWorking(false)
    }
  }

  return (
    <Screen>
      <PageHead
        title={`${duty.title} bearbeiten`}
        sub={target}
        crumbs={[dutyRegisterPlace, { to: dutyPlaces.duty(duty.id), label: duty.title }]}
      />
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
                  {dutyFormWords.noConnectionToChange}
                </p>
              )}
              <DutyFields
                typed={typed}
                set={set}
                problems={problems}
                named={duty.responsible}
                fixedCounting={duty.counting}
              />
            </div>
          </Panel>
          <div className="flex min-w-0 flex-col gap-3.5">
            <GoodToKnow
              lines={[
                dutyFormWords.placeStays,
                dutyFormWords.intervalCounts,
                dutyFormWords.removeOrEnd,
              ]}
            />
          </div>
        </div>
        {trouble ? (
          <p role="alert" className="text-[13px] font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {duty.removable ? (
            <>
              <RemovePlace
                label="Pflicht entfernen"
                question={`„${duty.title}“ entfernen?`}
                disabled={working || !status.online}
                remove={() => askAt(client, 'DELETE', `/duties/${duty.id}`, duty.id)}
                onRemoved={async () => {
                  queries.removeQueries({ queryKey: ['duties'] })
                  queries.removeQueries({ queryKey: ['assets'] })
                  await navigate({ to: dutyRegisterPlace.to })
                }}
              >
                {dutyFormWords.removeAsks}
              </RemovePlace>
              <div className="grow" />
            </>
          ) : null}
          <Button onClick={back} disabled={working}>
            Abbrechen
          </Button>
          <Button type="submit" tone="primary" icon={Check} disabled={working || !status.online}>
            {working ? 'Wird gespeichert' : 'Speichern'}
          </Button>
        </div>
      </form>
    </Screen>
  )
}

/**
 * The fields of a duty of the operator's own, as making it and changing it
 * share them: its name and task, its basis and source, its interval with how
 * it counts, and who answers for it and who performs it. Over a duty there
 * is, the counting stands there and is not offered.
 */
function DutyFields({
  typed,
  set,
  problems,
  named,
  fixedCounting,
}: {
  readonly typed: Typed
  readonly set: (values: Partial<Typed>) => void
  readonly problems: Readonly<Record<string, string>>
  /** Whom the duty names, who stays a choice when shut out; none for a new one. */
  readonly named: DutyDetails['responsible']
  readonly fixedCounting?: Counting
}) {
  const colleagues = useQuery(dutyColleaguesQuery)

  return (
    <>
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
        {fixedCounting === undefined ? (
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
        ) : (
          <Field
            label="Gezählt"
            value={countingLabel[fixedCounting]}
            readOnly
            hint={dutyFormWords.countingStays}
            // Grey as the board draws a field that cannot be changed.
            className="bg-surface-sunken!"
          />
        )}
      </div>
      <PanelLabel>Zuständig</PanelLabel>
      <div className="grid items-start gap-3 sm:grid-cols-2">
        <SelectField
          label="Verantwortlich"
          options={responsibleChoices(colleagues.data, named)}
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
    </>
  )
}

/** "Gut zu wissen" beside the form, a paragraph for each line. */
function GoodToKnow({ lines }: { readonly lines: readonly string[] }) {
  return (
    <Panel title="Gut zu wissen">
      <div className="flex flex-col gap-[9px] text-[13px] leading-[1.45] text-ink max-sm:text-[15px]">
        {lines.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
    </Panel>
  )
}
