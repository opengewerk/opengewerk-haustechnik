import {
  type ActivityDetails,
  activityLimits,
  byNameIn,
  type CollectiveCandidate,
  type CollectiveCandidates,
  collectivePlanProblems,
  collectiveReportField,
  collectiveReportProblems,
  collectiveTitle,
  defectClassChoices,
  dueWithin,
  type DutyPerformer,
  type EvidenceLink,
  type EvidenceResult,
  evidenceLimits,
  evidenceResultLabel,
  type IsoDate,
  mayBecomeAPart,
  reportDefectField,
  resultsWithDefects,
  untitledDocument,
} from '@opengewerk/haustechnik-domain'
import {
  Button,
  Cell,
  Choice,
  Column,
  Field,
  Panel,
  SelectField,
  TablePanel,
} from '@opengewerk/platform-web'
import { prepareVersion } from '@opengewerk/platform-web/attachments'
import { date, fileSize, today } from '@opengewerk/platform-web/format'
import { Empty, FactList, NoteBox, PageHead, Screen } from '@opengewerk/platform-web/office'
import { useRight } from '@opengewerk/platform-web/session'
import {
  maybeText,
  refusalFor,
  request,
  RequestRefused,
  useRecords,
  useSync,
} from '@opengewerk/platform-web/sync'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { FileText, Lock, Plus, Trash2 } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'

import { DutyStateMark } from '../../app/asset-marks.js'
import { failureSentence } from '../../app/failure.js'
import { titleOfRoom } from '../../app/place-records.js'
import { useCatalogue } from '../../sync/catalogue.js'
import { makeAt } from '../../sync/made-at.js'
import { activityListPlace, activityPlaces } from '../activity-addresses.js'
import { ContractorField, contractorFieldWords, useContractorNames } from '../contractor-field.js'
import { EvidenceNumber, ResultMark } from '../evidence-words.js'
import { factLink } from '../links.js'
import { officePlaces } from '../place-addresses.js'
import { QualificationNotes } from '../qualification-note.js'
import { activityQuery } from './activities.js'
import { reportWords } from './report.js'

export const collectiveWords = {
  title: 'Sammelvorgang zusammenstellen',
  sub: 'Viele Anlagen einer Pflichtart in einem Zug: ein Protokoll und ein Nachweis je Pflicht, eine Unterschrift für alle.',
  wholeProperty: 'Die ganze Liegenschaft',
  wholeHint: 'Leer heißt: die ganze Liegenschaft.',
  kindHint: 'Eine Pflichtart je Sammelvorgang, mit dem Formular ihres Pakets.',
  chooseKind: 'Pflichtart wählen',
  chooseProperty: 'Liegenschaft wählen',
  noKind: 'An diesem Ort läuft keine Pflicht mit einer Pflichtart aus dem Katalog.',
  pickFirst: 'Wählen Sie Liegenschaft und Pflichtart; dann stehen ihre Anlagen hier.',
  loading: 'Die Pflichten werden geladen.',
  failed: 'Die Pflichten ließen sich nicht laden. Sie kommen vom Server, mit Verbindung.',
  noConnection: 'Ein Sammelvorgang wird mit Verbindung zusammengestellt. Gerade ist keine da.',
  notForYou: 'Einen Sammelvorgang stellt zusammen, wer Vorgänge plant und verteilt.',
  none: 'An diesem Ort läuft keine Pflicht dieser Art.',
  noActivity: 'kein Vorgang',
  openActivity: 'Prüfung offen',
  goesUp: 'geht im Sammelvorgang auf',
  started: (performer: string | null) =>
    performer === null ? 'läuft für sich weiter' : `von ${performer}, läuft für sich weiter`,
  begun: 'Vorgang begonnen',
  signed: 'Vorgang unterschrieben',
  partOfOne: 'Teil eines Sammelvorgangs',
  workOrder: 'Auftrag für den Termin',
  stays: 'bleibt für sich',
  preselected: (from: IsoDate, to: IsoDate) =>
    `Vorausgewählt ist, was zwischen dem ${date(from)} und dem ${date(to)} fällig wird, und was schon überfällig ist. Zur Wahl stehen alle Pflichten dieser Art am Ort, die laufen; eine begonnene Prüfung bleibt für sich.`,
  elsewhere: (count: number) =>
    count === 1
      ? 'Eine Anlage liegt in einem Gebäude mit eigenem Bereich und steht nicht zur Wahl; sie kommt in einen Sammelvorgang an diesem Gebäude.'
      : `${String(count)} Anlagen liegen in Gebäuden mit eigenem Bereich und stehen nicht zur Wahl; sie kommen in einen Sammelvorgang am jeweiligen Gebäude.`,
  chosen: (count: number, of: number) => `${String(count)} von ${String(of)} gewählt`,
  ownNote:
    'Vor Ort Anlage für Anlage, mit dem Protokoll aus dem Paket und einer Unterschrift am Ende',
  foreignNote: 'Eine Fremdfirma prüft, danach ein Bericht für alle Anlagen im Büro',
  ownPlanned: 'Vor Ort Anlage für Anlage, eine Unterschrift am Ende',
  foreignPlanned: 'Ein Bericht für alle Anlagen, im Büro eingetragen',
  dueHint: 'Der früheste Termin der gewählten Anlagen.',
  what: 'Jede Anlage bekommt ihr Protokoll und ihre Pflicht ihren Nachweis. Ihr Termin rückt nur mit diesem Nachweis weiter, nie mit dem Anlegen des Sammelvorgangs.',
  nobody: 'noch niemand',
  nobodyNamed: 'Niemand benannt',
  // The page of a collective activity.
  parts: 'Anlagen dieses Sammelvorgangs',
  withResult: (count: number, of: number) => `${String(count)} von ${String(of)} mit Ergebnis`,
  noneYet: 'noch keines',
  mark: 'Sammelvorgang',
  stepParts:
    'Vor Ort hat jede Anlage ihr Protokoll und ihr Ergebnis. Eine, die nicht erreichbar ist, bekommt „nicht durchgeführt“ mit Grund.',
  stepSignature:
    'Unterschrieben wird einmal, unter einer Seite mit jeder Anlage und ihrem Ergebnis. Daraus entsteht je Pflicht ein Nachweis, der diese Unterschrift nennt, und jeder Termin rückt mit seinem Nachweis weiter.',
  stepContractor:
    'Die Fremdfirma prüft jede Anlage; ihr Bericht wird hier eingetragen, mit einem Ergebnis je Anlage und der Datei einmal.',
  stepReport:
    'Mit dem Festschreiben entsteht je Pflicht ein Nachweis, und jeder Termin rückt mit seinem weiter.',
  whatClosingDoes:
    'Der Sammelvorgang ist damit geschlossen, mit jeder seiner Anlagen, auch auf den Geräten. Ein Ergebnis, das vor Ort schon eingetragen ist, wird kein Nachweis. Die Termine bleiben, wie sie sind.',
  partNote: 'Diese Anlage ist Teil des Sammelvorgangs',
  partRest: 'Geplant, geschlossen und unterschrieben wird dort, einmal für alle seine Anlagen.',
  // The report for many assets.
  reportTitle: 'Bericht für viele Anlagen eintragen',
  results: 'Ergebnis je Anlage',
  resultsNote: '„Nicht durchgeführt“ verlangt einen Grund; die Pflicht behält ihren Termin.',
  noReason: 'kein Grund nötig',
  reason: 'Grund',
  asset: 'Anlage',
  reportOutcome: (count: number) =>
    `Mit dem Festschreiben entstehen ${String(count)} Nachweise, einer je Pflicht, und die Datei liegt einmal am Ort des Sammelvorgangs und in jedem Nachweis. Jeder Termin rückt mit seinem Nachweis weiter, ab dem Tag der Durchführung; eine Anlage „nicht durchgeführt“ behält ihren Termin. Die Mängel kommen in die Liste der Mängel, an der Anlage, die sie nennen.`,
  notACollective:
    'Diesen Sammelvorgang gibt es nicht, oder er liegt außerhalb dessen, was dieser Zugang sieht.',
  reportClosed:
    'Ein Bericht wird eingetragen, solange der Sammelvorgang offen ist und niemand vor Ort eine seiner Anlagen begonnen hat.',
} as const

/** The first day of the month of a day, and the last day of the month after it. */
export function monthsAround(day: IsoDate): { readonly from: IsoDate; readonly to: IsoDate } {
  const [year, month] = day.split('-').map(Number) as [number, number]
  const last = new Date(Date.UTC(year, month + 1, 0))

  return {
    from: `${day.slice(0, 8)}01` as IsoDate,
    to: last.toISOString().slice(0, 10) as IsoDate,
  }
}

/** Where a candidate's asset is, by number and name, or the duty where it hangs on no asset. */
function nameOf(candidate: Pick<CollectiveCandidate, 'asset' | 'title'>): string {
  return candidate.asset === null
    ? candidate.title
    : [candidate.asset.number, candidate.asset.name].filter(Boolean).join(' ')
}

/** What a candidate's activity is, in the column "Vorgang". */
function ActivityOfCandidate({ candidate }: { readonly candidate: CollectiveCandidate }) {
  const activity = candidate.activity

  if (activity === null) {
    return <span className="text-ink-faint">{collectiveWords.noActivity}</span>
  }

  const [main, sub] = mayBecomeAPart(candidate)
    ? [collectiveWords.openActivity, collectiveWords.goesUp]
    : activity.partOfOne
      ? [collectiveWords.partOfOne, collectiveWords.stays]
      : activity.kind === 'work_order'
        ? [collectiveWords.workOrder, collectiveWords.stays]
        : activity.status === 'signed'
          ? [collectiveWords.signed, collectiveWords.stays]
          : [collectiveWords.begun, collectiveWords.started(activity.performer)]

  return (
    <div className="leading-[1.32]">
      <Link to={activityPlaces.activity(activity.id)}>{main}</Link>
      <div className="text-[12px] text-ink-faint">{sub}</div>
    </div>
  )
}

/**
 * "Sammelvorgang zusammenstellen (4.4)", `zusammenstellen()` of the boards
 * (#342): whoever plans and hands out work names the place, a property and a
 * building or a room of it, the duty kind and the days, and the duties of
 * that kind there stand in a table; what falls due between the days is
 * chosen already, and what is overdue. An open inspection of a duty goes up
 * in the collective activity, one somebody began stays on its own and cannot
 * be chosen. The plan says who performs it, which every part takes over.
 *
 * Read from the server and made there, with a connection.
 */
export function CollectiveComposeScreen() {
  const plans = useRight('activity.write')
  const client = useSync()
  const queries = useQueryClient()
  const navigate = useNavigate()
  const properties = useRecords('properties')
  const buildings = useRecords('buildings')
  const rooms = useRecords('rooms')
  const around = useMemo(() => monthsAround(today()), [])
  const [propertyId, setPropertyId] = useState('')
  const [place, setPlace] = useState('')
  const [kind, setKind] = useState('')
  const [from, setFrom] = useState<string>(around.from)
  const [to, setTo] = useState<string>(around.to)
  const [picked, setPicked] = useState<{
    readonly key: string
    readonly ids: ReadonlySet<string>
  } | null>(null)
  const [performer, setPerformer] = useState<DutyPerformer>('own_staff')
  const [responsible, setResponsible] = useState('')
  const [person, setPerson] = useState('')
  const [contractorId, setContractorId] = useState('')
  const [typedTitle, setTitle] = useState<string | null>(null)
  const [typedDue, setDueOn] = useState<string | null>(null)
  const [problems, setProblems] = useState<Readonly<Record<string, string>>>({})
  const [trouble, setTrouble] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  const [buildingId, roomId] = place.startsWith('room:')
    ? [null, place.slice(5)]
    : place.startsWith('building:')
      ? [place.slice(9), null]
      : [null, null]
  const asked = new URLSearchParams({
    property: propertyId,
    ...(buildingId === null ? {} : { building: buildingId }),
    ...(roomId === null ? {} : { room: roomId }),
    ...(kind === '' ? {} : { kind }),
    from,
    to,
  })
  const found = useQuery({
    queryKey: ['collectives', 'candidates', asked.toString()],
    queryFn: () => request<CollectiveCandidates>(`/collectives/candidates?${asked.toString()}`),
    enabled: plans && propertyId !== '',
    retry: (count, error) => !(error instanceof RequestRefused) && count < 2,
  })
  const candidates = kind === '' ? [] : (found.data?.candidates ?? [])
  const days = { from: from as IsoDate, to: to as IsoDate }
  const preselected = new Set(
    candidates
      .filter(
        (candidate) => mayBecomeAPart(candidate) && dueWithin(candidate.appointment, days, today()),
      )
      .map((candidate) => candidate.dutyId as string),
  )
  // What was chosen by hand holds as long as the question is the same.
  const chosen = picked !== null && picked.key === asked.toString() ? picked.ids : preselected
  const choose = (dutyId: string, on: boolean) => {
    const next = new Set(chosen)

    if (on) {
      next.add(dutyId)
    } else {
      next.delete(dutyId)
    }

    setPicked({ key: asked.toString(), ids: next })
  }
  const kindLabel = found.data?.kinds.find((each) => each.key === kind)?.label ?? ''
  const placeName =
    roomId !== null
      ? (() => {
          const room = rooms.find((each) => each['id'] === roomId)
          const building = buildings.find((each) => each['id'] === room?.['buildingId'])

          return [maybeText(building, 'name'), room ? titleOfRoom(room) : null]
            .filter(Boolean)
            .join(', ')
        })()
      : buildingId !== null
        ? (maybeText(
            buildings.find((each) => each['id'] === buildingId),
            'name',
          ) ?? '')
        : (maybeText(
            properties.find((each) => each['id'] === propertyId),
            'name',
          ) ?? '')
  const title = typedTitle ?? (kindLabel === '' ? '' : collectiveTitle(kindLabel, placeName))
  const earliest = candidates
    .filter((candidate) => chosen.has(candidate.dutyId))
    .map((candidate) => candidate.appointment ?? today())
    .sort()[0]
  const dueOn = typedDue ?? earliest ?? today()
  const propertyChoices = properties
    .map((property) => ({
      value: String(property['id']),
      label: maybeText(property, 'name') ?? '',
    }))
    .sort((left, right) => byNameIn(left.label, right.label))
  const placeChoices = [
    { value: '', label: collectiveWords.wholeProperty },
    ...buildings
      .filter((building) => building['propertyId'] === propertyId && building['deletedAt'] == null)
      .sort((left, right) =>
        byNameIn(maybeText(left, 'name') ?? '', maybeText(right, 'name') ?? ''),
      )
      .flatMap((building) => [
        { value: `building:${String(building['id'])}`, label: maybeText(building, 'name') ?? '' },
        ...rooms
          .filter((room) => room['buildingId'] === building['id'] && room['deletedAt'] == null)
          .map((room) => ({
            value: `room:${String(room['id'])}`,
            label: `${maybeText(building, 'name') ?? ''}, ${titleOfRoom(room)}`,
          }))
          .sort((left, right) => byNameIn(left.label, right.label)),
      ]),
  ]
  const people = found.data?.people
  const options = (
    offered: readonly { userId: string; name: string }[] | undefined,
    empty: string,
  ) => [
    { value: '', label: empty },
    ...(offered ?? []).map((each) => ({ value: each.userId, label: each.name })),
  ]

  async function save() {
    const values = {
      dutyKind: kind,
      propertyId,
      buildingId,
      roomId,
      title: title.trim(),
      dutyIds: candidates.filter((each) => chosen.has(each.dutyId)).map((each) => each.dutyId),
      responsibleUserId: responsible === '' ? null : responsible,
      performer,
      performerUserId: performer === 'own_staff' && person !== '' ? person : null,
      contractorNote: null,
      contractorId: performer === 'contractor' && contractorId !== '' ? contractorId : null,
      dueOn,
    }
    const wrong = collectivePlanProblems(values)

    setProblems(wrong)
    setTrouble(null)

    if (Object.keys(wrong).length > 0) {
      return
    }

    setWorking(true)

    try {
      const made = await makeAt(client, '/collectives', values)

      if (made.outcome === 'refused') {
        setTrouble(refusalFor(made))

        return
      }

      await queries.invalidateQueries({ queryKey: ['activities'] })
      await queries.invalidateQueries({ queryKey: ['collectives'] })
      await navigate({ to: activityPlaces.activity(made.id) })
    } catch {
      setTrouble(failureSentence())
    } finally {
      setWorking(false)
    }
  }

  if (!plans) {
    return (
      <Screen>
        <PageHead
          title={collectiveWords.title}
          crumbs={[activityListPlace]}
          phoneBack={activityListPlace}
        />
        <Empty>{collectiveWords.notForYou}</Empty>
      </Screen>
    )
  }

  const table =
    propertyId === '' || kind === '' ? (
      <Panel>
        <Empty>
          {propertyId !== '' && found.data !== undefined && found.data.kinds.length === 0
            ? collectiveWords.noKind
            : collectiveWords.pickFirst}
        </Empty>
      </Panel>
    ) : found.data === undefined ? (
      <Panel>
        <Empty>
          {found.isError
            ? collectiveWords.failed
            : found.fetchStatus === 'paused'
              ? collectiveWords.noConnection
              : collectiveWords.loading}
        </Empty>
      </Panel>
    ) : candidates.length === 0 ? (
      <Panel>
        <Empty>{collectiveWords.none}</Empty>
      </Panel>
    ) : (
      <TablePanel
        title="Anlagen"
        caption="Anlagen der Pflichtart am Ort, mit Termin und Vorgang"
        note={
          <>
            {collectiveWords.preselected(days.from, days.to)}
            {found.data.elsewhere > 0 ? ` ${collectiveWords.elsewhere(found.data.elsewhere)}` : ''}
          </>
        }
        footer={<span>{collectiveWords.chosen(chosen.size, candidates.length)}</span>}
        cards={candidates.map((candidate) => ({
          key: candidate.dutyId,
          title: nameOf(candidate),
          sub: [
            candidate.where,
            candidate.appointment === null ? null : date(candidate.appointment),
          ]
            .filter(Boolean)
            .join(' · '),
          right: (
            <input
              type="checkbox"
              aria-label={`${nameOf(candidate)} wählen`}
              className="size-5 accent-copper-solid"
              checked={chosen.has(candidate.dutyId)}
              disabled={!mayBecomeAPart(candidate) || working}
              onChange={(event) => {
                choose(candidate.dutyId, event.target.checked)
              }}
            />
          ),
        }))}
      >
        <thead>
          <tr>
            <Column className="w-[34px]">
              <span className="sr-only">Gewählt</span>
            </Column>
            <Column className="min-w-[180px]">Anlage</Column>
            <Column className="w-[100px] min-w-[96px]">Termin</Column>
            <Column className="w-[200px] min-w-[150px]">Vorgang</Column>
          </tr>
        </thead>
        <tbody>
          {candidates.map((candidate) => (
            <tr key={candidate.dutyId}>
              <Cell>
                <input
                  type="checkbox"
                  aria-label={`${nameOf(candidate)} wählen`}
                  className="size-[16px] accent-copper-solid"
                  checked={chosen.has(candidate.dutyId)}
                  disabled={!mayBecomeAPart(candidate) || working}
                  onChange={(event) => {
                    choose(candidate.dutyId, event.target.checked)
                  }}
                />
              </Cell>
              <Cell>
                <div className="leading-[1.32]">
                  {candidate.asset === null ? (
                    nameOf(candidate)
                  ) : (
                    <Link to={officePlaces.asset(candidate.asset.id)}>{nameOf(candidate)}</Link>
                  )}
                  {candidate.where === '' ? null : (
                    <div className="text-[12px] text-ink-faint">{candidate.where}</div>
                  )}
                </div>
              </Cell>
              <Cell>
                {candidate.appointment === null ? (
                  <DutyStateMark state={candidate.state} until={null} />
                ) : candidate.state === 'overdue' ? (
                  <div className="leading-[1.32]">
                    <div className="font-semibold text-conflict">{date(candidate.appointment)}</div>
                    <div className="text-[12px] text-conflict">überfällig</div>
                  </div>
                ) : (
                  date(candidate.appointment)
                )}
              </Cell>
              <Cell>
                <ActivityOfCandidate candidate={candidate} />
              </Cell>
            </tr>
          ))}
        </tbody>
      </TablePanel>
    )

  return (
    <Screen>
      <PageHead
        title={collectiveWords.title}
        sub={collectiveWords.sub}
        crumbs={[activityListPlace]}
        phoneBack={activityListPlace}
      />
      <form
        noValidate
        className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <div className="flex min-w-0 flex-col gap-3.5">
          {table}
          {problems['dutyIds'] ? (
            <p role="alert" className="text-[13px] font-semibold text-conflict">
              {problems['dutyIds']}
            </p>
          ) : null}
          {/* The choice says what the card is about, as at the plan of an activity. */}
          <Panel>
            <div className="flex flex-col gap-3">
              <Choice<DutyPerformer>
                label="Durchführung"
                value={performer}
                onChange={setPerformer}
                disabled={working}
                options={[
                  {
                    value: 'own_staff',
                    label: 'Eigene Durchführung',
                    note: collectiveWords.ownNote,
                  },
                  {
                    value: 'contractor',
                    label: 'Fremde Durchführung',
                    note: collectiveWords.foreignNote,
                  },
                ]}
              />
              <Field
                label="Titel"
                required
                starred
                maxLength={activityLimits.title}
                value={title}
                onChange={(event) => {
                  setTitle(event.target.value)
                }}
                {...(problems['title'] ? { problem: problems['title'] } : {})}
              />
              <div className="grid gap-3 sm:grid-cols-3">
                <SelectField
                  label="Verantwortlich"
                  value={responsible}
                  onChange={setResponsible}
                  options={options(people?.responsible, collectiveWords.nobodyNamed)}
                />
                {performer === 'own_staff' ? (
                  <SelectField
                    label="Ausführend"
                    value={person}
                    onChange={setPerson}
                    options={options(people?.performers, collectiveWords.nobody)}
                    {...(problems['performerUserId']
                      ? { problem: problems['performerUserId'] }
                      : {})}
                  />
                ) : (
                  <ContractorField
                    value={contractorId}
                    noneLabel={contractorFieldWords.none}
                    problem={problems['contractorId']}
                    onChange={setContractorId}
                  />
                )}
                <Field
                  label="Fällig am"
                  type="date"
                  value={dueOn}
                  hint={collectiveWords.dueHint}
                  onChange={(event) => {
                    setDueOn(event.target.value)
                  }}
                  {...(problems['dueOn'] ? { problem: problems['dueOn'] } : {})}
                />
              </div>
              {/* The person chosen lacks the kind of the parts (#515): a note, not a refusal. */}
              {performer === 'own_staff' ? (
                <QualificationNotes
                  hints={found.data?.hints}
                  chosen={[person]}
                  nameOf={(userId) =>
                    people?.performers.find((each) => each.userId === userId)?.name ?? ''
                  }
                />
              ) : null}
            </div>
          </Panel>
        </div>
        <div className="flex min-w-0 flex-col gap-3.5">
          <Panel title="Was und wo">
            <div className="flex flex-col gap-3">
              <SelectField
                label="Liegenschaft"
                required
                starred
                value={propertyId}
                options={[{ value: '', label: collectiveWords.chooseProperty }, ...propertyChoices]}
                onChange={(value) => {
                  setPropertyId(value)
                  setPlace('')
                  setKind('')
                  setTitle(null)
                }}
                {...(problems['propertyId'] ? { problem: problems['propertyId'] } : {})}
              />
              <SelectField
                label="Gebäude oder Raum"
                value={place}
                hint={collectiveWords.wholeHint}
                options={placeChoices}
                disabled={propertyId === ''}
                onChange={(value) => {
                  setPlace(value)
                  setTitle(null)
                }}
              />
              <SelectField
                label="Pflichtart"
                required
                starred
                value={kind}
                hint={collectiveWords.kindHint}
                disabled={propertyId === ''}
                options={[
                  { value: '', label: collectiveWords.chooseKind },
                  ...(found.data?.kinds ?? []).map((each) => ({
                    value: each.key,
                    label: `${each.label} (${String(each.duties)})`,
                  })),
                ]}
                onChange={(value) => {
                  setKind(value)
                  setTitle(null)
                }}
                {...(problems['dutyKind'] ? { problem: problems['dutyKind'] } : {})}
              />
              <div className="grid grid-cols-2 gap-3">
                <Field
                  label="Fällig ab"
                  type="date"
                  value={from}
                  onChange={(event) => {
                    setFrom(event.target.value)
                  }}
                />
                <Field
                  label="Fällig bis"
                  type="date"
                  value={to}
                  onChange={(event) => {
                    setTo(event.target.value)
                  }}
                />
              </div>
            </div>
          </Panel>
          <NoteBox>{collectiveWords.what}</NoteBox>
          {trouble ? (
            <p role="alert" className="text-[13px] font-semibold text-conflict">
              {trouble}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              disabled={working}
              onClick={() => {
                void navigate({ to: activityListPlace.to })
              }}
            >
              Abbrechen
            </Button>
            <Button
              type="submit"
              tone="primary"
              icon={Plus}
              disabled={working || chosen.size === 0}
            >
              {working ? 'Einen Moment' : 'Sammelvorgang anlegen'}
            </Button>
          </div>
        </div>
      </form>
    </Screen>
  )
}

/**
 * The assets of a collective activity on its page, `sammelvorgang()` of the
 * boards: an asset to a row with where it is, the day its duty is due on and
 * what came of it, the reason of "not performed" under it, and the evidence
 * once it is written. Each row leads to the page of its part.
 */
export function CollectivePartsPanel({ activity }: { readonly activity: ActivityDetails }) {
  const parts = activity.parts ?? []
  const counted = activity.collective

  return (
    <TablePanel
      title={collectiveWords.parts}
      caption={collectiveWords.parts}
      action={
        counted === undefined ? null : (
          <span className="text-[13px] text-ink-muted">
            {collectiveWords.withResult(counted.withResult, counted.parts)}
          </span>
        )
      }
      cards={parts.map((part) => ({
        key: part.id,
        title: (
          <Link to={activityPlaces.activity(part.id)}>
            {part.asset === null
              ? part.dutyTitle
              : [part.asset.number, part.asset.name].filter(Boolean).join(' ')}
          </Link>
        ),
        sub: [part.where, part.appointment === null ? null : date(part.appointment)]
          .filter(Boolean)
          .join(' · '),
        right:
          part.result === null ? (
            <span className="text-ink-faint">{collectiveWords.noneYet}</span>
          ) : (
            <ResultMark result={part.result} />
          ),
      }))}
    >
      <thead>
        <tr>
          <Column className="min-w-[180px]">Anlage</Column>
          <Column className="w-[110px] min-w-[96px]">Termin</Column>
          <Column className="w-[260px] min-w-[160px]">Ergebnis</Column>
        </tr>
      </thead>
      <tbody>
        {parts.map((part) => (
          <tr key={part.id}>
            <Cell>
              <div className="leading-[1.32]">
                <Link to={activityPlaces.activity(part.id)} className={factLink}>
                  {part.asset === null
                    ? part.dutyTitle
                    : [part.asset.number, part.asset.name].filter(Boolean).join(' ')}
                </Link>
                {part.where === '' ? null : (
                  <div className="text-[12px] text-ink-faint">{part.where}</div>
                )}
              </div>
            </Cell>
            <Cell>
              {part.appointment === null ? (
                <span className="text-ink-faint">keiner</span>
              ) : part.result === null && part.appointment < today() ? (
                <div className="leading-[1.32]">
                  <div className="font-semibold text-conflict">{date(part.appointment)}</div>
                  <div className="text-[12px] text-conflict">überfällig</div>
                </div>
              ) : (
                date(part.appointment)
              )}
            </Cell>
            <Cell>
              {part.result === null ? (
                <span className="text-ink-faint">{collectiveWords.noneYet}</span>
              ) : (
                <div className="leading-[1.32]">
                  <ResultMark result={part.result} />
                  {part.resultReason === null ? null : (
                    <div className="mt-0.5 text-[12px] text-ink-faint">{part.resultReason}</div>
                  )}
                  {part.evidence === null ? null : (
                    <div className="mt-0.5 text-[12px]">
                      <EvidenceNumber id={part.evidence.id} number={part.evidence.number} />
                    </div>
                  )}
                </div>
              )}
            </Cell>
          </tr>
        ))}
      </tbody>
    </TablePanel>
  )
}

/** A row of the result of one asset in the report, as the form holds it. */
interface PartRow {
  readonly result: EvidenceResult
  readonly resultReason: string
}

/** A defect of the report as the form holds it, at the asset it names. */
interface DefectRow {
  readonly key: number
  readonly activityId: string
  readonly description: string
  readonly defectClass: string
  readonly dueOn: string
}

/**
 * "Bericht für viele Anlagen eintragen (4.4)", `sammelbericht()` of the
 * boards (#342): the report of a contractor for a collective activity, the
 * file once, the examiner, the organisation and the day, a result for each
 * asset with the reason of "not performed", and each defect at the asset it
 * names. Written down, it is one evidence per duty, and the page of the
 * collective activity opens again.
 */
export function CollectiveReportScreen() {
  const { activityId } = useParams({ strict: false }) as { activityId?: string }
  const page = useQuery({ ...activityQuery(activityId ?? ''), enabled: activityId !== undefined })
  const entersEvidence = useRight('evidence.write')
  const shown = page.data

  if (shown === undefined || activityId === undefined) {
    const gone = page.error instanceof RequestRefused && page.error.status === 404

    return (
      <Screen>
        <PageHead
          title={collectiveWords.reportTitle}
          crumbs={[activityListPlace]}
          phoneBack={activityListPlace}
        />
        <Empty>
          {gone
            ? collectiveWords.notACollective
            : page.isError
              ? reportWords.failed
              : page.fetchStatus === 'paused'
                ? reportWords.noConnection
                : reportWords.loading}
        </Empty>
      </Screen>
    )
  }

  if (shown.collective === undefined) {
    return (
      <Screen>
        <PageHead
          title={collectiveWords.reportTitle}
          crumbs={[activityListPlace]}
          phoneBack={activityListPlace}
        />
        <Empty>{collectiveWords.notACollective}</Empty>
      </Screen>
    )
  }

  const unwelcome = !entersEvidence
    ? reportWords.notForYou
    : shown.status !== 'open' || (shown.parts ?? []).some((part) => part.status !== 'open')
      ? collectiveWords.reportClosed
      : null

  return <CollectiveReportForm key={shown.id} activity={shown} unwelcome={unwelcome} />
}

function CollectiveReportForm({
  activity,
  unwelcome,
}: {
  readonly activity: ActivityDetails
  readonly unwelcome: string | null
}) {
  const client = useSync()
  const queries = useQueryClient()
  const navigate = useNavigate()
  const catalogue = useCatalogue()
  const firmNames = useContractorNames()
  const parts = activity.parts ?? []
  const picker = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [examiner, setExaminer] = useState('')
  const [firm, setFirm] = useState(activity.contractorId ?? '')
  const [typedOrganisation, setOrganisation] = useState<string | null>(null)
  const organisation = typedOrganisation ?? firmNames.get(firm) ?? activity.contractorNote ?? ''
  const [performedOn, setPerformedOn] = useState('')
  const [results, setResults] = useState<Readonly<Record<string, PartRow>>>(
    Object.fromEntries(
      parts.map((part) => [part.id, { result: 'without_defects', resultReason: '' }]),
    ),
  )
  const [defects, setDefects] = useState<readonly DefectRow[]>([])
  const [nextKey, setNextKey] = useState(1)
  const [problems, setProblems] = useState<Readonly<Record<string, string>>>({})
  const [trouble, setTrouble] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const self = { to: activityPlaces.activity(activity.id), label: activity.title }
  const classes =
    catalogue === null || activity.collective === undefined
      ? []
      : defectClassChoices(catalogue, [activity.collective.kind])
  const assetWords = (part: (typeof parts)[number]) =>
    part.asset === null
      ? part.dutyTitle
      : [part.asset.number, part.asset.name].filter(Boolean).join(' ')
  const filled = (value: string) => (value.trim() === '' ? null : value.trim())

  function changeDefect(key: number, change: Partial<DefectRow>) {
    setDefects((rows) => rows.map((row) => (row.key === key ? { ...row, ...change } : row)))
  }

  function said() {
    return {
      performedOn: performedOn === '' ? null : performedOn,
      examiner: filled(examiner),
      examinerOrganisation: filled(organisation),
      contractorId: firm === '' ? null : firm,
      parts: parts.map((part) => {
        const row = results[part.id] ?? { result: 'without_defects', resultReason: '' }

        return {
          activityId: part.id,
          result: row.result,
          resultReason: row.result === 'not_performed' ? filled(row.resultReason) : null,
          defects: resultsWithDefects.includes(row.result)
            ? defects
                .filter((defect) => defect.activityId === part.id)
                .map((defect) => ({
                  description: defect.description.trim(),
                  defectClass: defect.defectClass === '' ? null : defect.defectClass,
                  dueOn: defect.dueOn === '' ? null : defect.dueOn,
                }))
            : [],
        }
      }),
    }
  }

  /** The problem of a defect row, found at the part it names. */
  const defectProblem = (row: DefectRow, field: 'description' | 'defectClass' | 'dueOn') => {
    const index = parts.findIndex((part) => part.id === row.activityId)
    const among = defects.filter((each) => each.activityId === row.activityId).indexOf(row)

    return index < 0
      ? undefined
      : problems[collectiveReportField(index, reportDefectField(among, field))]
  }

  async function save() {
    const values = said()
    const known = new Set(classes.map((each) => each.defectClass.key))
    const wrong = collectiveReportProblems(
      {
        ...values,
        file:
          file === null
            ? null
            : {
                sha256: '0'.repeat(64),
                fileName: file.name,
                sizeBytes: file.size,
                previewSha256: null,
              },
      },
      today(),
      (key) => known.has(key),
    )

    setProblems(wrong)
    setTrouble(null)

    if (Object.keys(wrong).length > 0 || file === null) {
      return
    }

    setWorking(true)

    try {
      // A scan of a certificate stays as it was taken: it is the evidence.
      const prepared = await prepareVersion(client, file, {
        untitled: untitledDocument,
        keepOriginal: true,
      })

      if ('problem' in prepared) {
        setProblems({ file: prepared.problem })

        return
      }

      // The bytes go up ahead of the report, which names them.
      await client.synchronise()

      try {
        await request<readonly EvidenceLink[]>(`/collectives/${activity.id}/report`, {
          method: 'POST',
          body: JSON.stringify({
            ...values,
            file: {
              sha256: prepared.sha256,
              fileName: prepared.fileName,
              sizeBytes: prepared.sizeBytes,
              previewSha256: prepared.previewSha256,
            },
          }),
        })
      } catch (error) {
        setTrouble(error instanceof RequestRefused ? error.message : failureSentence())

        return
      }

      await client.synchronise()
      await queries.invalidateQueries({ queryKey: ['evidence'] })
      await queries.invalidateQueries({ queryKey: ['duties'] })
      await queries.invalidateQueries({ queryKey: ['activities'] })
      queries.removeQueries({ queryKey: ['assets'] })
      await navigate({ to: activityPlaces.activity(activity.id) })
    } catch {
      setTrouble(failureSentence())
    } finally {
      setWorking(false)
    }
  }

  const side = (
    <Panel title="Sammelvorgang">
      <FactList
        keyWidth={110}
        facts={[
          {
            label: 'Sammelvorgang',
            value: (
              <Link to={self.to} className={factLink}>
                {activity.title}
              </Link>
            ),
          },
          { label: 'Pflichtart', value: activity.collective?.label ?? null },
          { label: 'Anlagen', value: String(parts.length) },
        ]}
      />
    </Panel>
  )
  const sub = [activity.title, organisation === '' ? null : `durchgeführt von ${organisation}`]
    .filter(Boolean)
    .join(', ')

  if (unwelcome !== null) {
    return (
      <Screen>
        <PageHead
          title={collectiveWords.reportTitle}
          crumbs={[activityListPlace, self]}
          phoneBack={self}
          sub={sub}
        />
        <div className="grid items-start gap-3.5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Empty>{unwelcome}</Empty>
          {side}
        </div>
      </Screen>
    )
  }

  return (
    <Screen>
      <PageHead
        title={collectiveWords.reportTitle}
        crumbs={[activityListPlace, self]}
        phoneBack={self}
        sub={sub}
      />
      <form
        noValidate
        className="grid items-start gap-3.5 lg:grid-cols-[minmax(0,1fr)_320px]"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <div className="flex min-w-0 flex-col gap-3">
          <Panel roomy>
            <div className="flex flex-col gap-3.5">
              <input
                ref={picker}
                type="file"
                className="sr-only"
                aria-label="Datei wählen"
                tabIndex={-1}
                onChange={(event) => {
                  const chosen = event.target.files?.[0]

                  if (chosen) {
                    setFile(chosen)
                    setProblems(({ file: _, ...others }) => others)
                  }

                  event.target.value = ''
                }}
              />
              <div className="flex flex-col gap-1">
                <span className="text-[13px] font-medium text-ink max-lg:text-[15px]">
                  Bericht oder Prüfbescheinigung{' '}
                  <span aria-hidden="true" className="text-conflict">
                    *
                  </span>
                </span>
                <div className="flex flex-wrap items-center gap-2.5 rounded-control border border-dashed border-line-strong bg-surface-sunken px-3 py-2.5">
                  <FileText
                    size={22}
                    strokeWidth={1.9}
                    aria-hidden="true"
                    className="shrink-0 text-ink-muted"
                  />
                  <div className="min-w-0 grow leading-[1.35]">
                    {file === null ? (
                      <span className="text-[14px] text-ink-muted">{reportWords.noFile}</span>
                    ) : (
                      <>
                        <div className="text-[14px] font-medium [overflow-wrap:anywhere]">
                          {file.name}
                        </div>
                        <div className="text-[12px] text-ink-faint">{fileSize(file.size)}</div>
                      </>
                    )}
                  </div>
                  <Button
                    type="button"
                    size="small"
                    disabled={working}
                    onClick={() => {
                      picker.current?.click()
                    }}
                  >
                    {file === null ? 'Datei wählen' : 'Andere Datei'}
                  </Button>
                </div>
                {problems['file'] ? (
                  <p role="alert" className="text-[13px] font-semibold text-conflict">
                    {problems['file']}
                  </p>
                ) : null}
              </div>
              <div className="sm:w-[360px]">
                <ContractorField
                  value={firm}
                  noneLabel={contractorFieldWords.none}
                  hint={reportWords.firmHint}
                  onChange={(value) => {
                    setFirm(value)
                    setOrganisation(null)
                  }}
                />
              </div>
              <div className="grid gap-3.5 sm:grid-cols-2">
                <Field
                  label="Prüfer"
                  required
                  starred
                  maxLength={evidenceLimits.examiner}
                  value={examiner}
                  problem={problems['examiner']}
                  onChange={(event) => {
                    setExaminer(event.target.value)
                  }}
                />
                <Field
                  label="Organisation"
                  required
                  starred
                  maxLength={evidenceLimits.examinerOrganisation}
                  value={organisation}
                  problem={problems['examinerOrganisation']}
                  onChange={(event) => {
                    setOrganisation(event.target.value)
                  }}
                />
              </div>
              <div className="sm:w-[170px]">
                <Field
                  label="Tag der Durchführung"
                  type="date"
                  required
                  starred
                  max={today()}
                  value={performedOn}
                  problem={problems['performedOn']}
                  onChange={(event) => {
                    setPerformedOn(event.target.value)
                  }}
                />
              </div>
            </div>
          </Panel>
          <TablePanel
            title={collectiveWords.results}
            caption={collectiveWords.results}
            note={collectiveWords.resultsNote}
            cards={parts.map((part, index) => {
              const row = results[part.id] ?? { result: 'without_defects', resultReason: '' }

              return {
                key: part.id,
                title: assetWords(part),
                sub: part.where,
                form: (
                  <PartResult
                    label={assetWords(part)}
                    row={row}
                    disabled={working}
                    problem={
                      problems[collectiveReportField(index, 'result')] ??
                      problems[collectiveReportField(index, 'resultReason')] ??
                      problems[collectiveReportField(index, 'defects')]
                    }
                    onChange={(change) => {
                      setResults({ ...results, [part.id]: { ...row, ...change } })
                    }}
                  />
                ),
              }
            })}
          >
            <thead>
              <tr>
                <Column className="min-w-[180px]">Anlage</Column>
                <Column className="w-[170px] min-w-[150px]">Ergebnis</Column>
                <Column className="w-[220px] min-w-[160px]">Grund</Column>
              </tr>
            </thead>
            <tbody>
              {parts.map((part, index) => {
                const row = results[part.id] ?? { result: 'without_defects', resultReason: '' }
                const problem =
                  problems[collectiveReportField(index, 'result')] ??
                  problems[collectiveReportField(index, 'defects')]

                return (
                  <tr key={part.id}>
                    <Cell>
                      <div className="leading-[1.32]">
                        {assetWords(part)}
                        {part.where === '' ? null : (
                          <div className="text-[12px] text-ink-faint">{part.where}</div>
                        )}
                        {problem ? (
                          <p role="alert" className="text-[12px] font-semibold text-conflict">
                            {problem}
                          </p>
                        ) : null}
                      </div>
                    </Cell>
                    <Cell>
                      <CellSelect
                        label={`Ergebnis für ${assetWords(part)}`}
                        value={row.result}
                        disabled={working}
                        options={(
                          ['without_defects', 'with_defects', 'failed', 'not_performed'] as const
                        ).map((each) => ({ value: each, label: evidenceResultLabel[each] }))}
                        onChange={(value) => {
                          setResults({
                            ...results,
                            [part.id]: { ...row, result: value as EvidenceResult },
                          })
                        }}
                      />
                    </Cell>
                    <Cell>
                      {row.result === 'not_performed' ? (
                        <Field
                          label={`Grund für ${assetWords(part)}`}
                          hideLabel
                          maxLength={evidenceLimits.resultReason}
                          value={row.resultReason}
                          disabled={working}
                          problem={problems[collectiveReportField(index, 'resultReason')]}
                          onChange={(event) => {
                            setResults({
                              ...results,
                              [part.id]: { ...row, resultReason: event.target.value },
                            })
                          }}
                        />
                      ) : (
                        <span className="text-ink-faint">{collectiveWords.noReason}</span>
                      )}
                    </Cell>
                  </tr>
                )
              })}
            </tbody>
          </TablePanel>
          <Panel
            title="Mängel aus dem Bericht"
            action={
              <Button
                type="button"
                size="small"
                icon={Plus}
                disabled={working}
                onClick={() => {
                  const first =
                    parts.find((part) =>
                      resultsWithDefects.includes(results[part.id]?.result ?? 'without_defects'),
                    ) ?? parts[0]

                  setDefects([
                    ...defects,
                    {
                      key: nextKey,
                      activityId: first?.id ?? '',
                      description: '',
                      defectClass: '',
                      dueOn: '',
                    },
                  ])
                  setNextKey(nextKey + 1)
                }}
              >
                Mangel hinzufügen
              </Button>
            }
          >
            <div className="flex flex-col gap-3">
              {defects.length === 0 ? (
                <p className="text-[13px] text-ink-muted">{reportWords.noDefect}</p>
              ) : null}
              {defects.map((row, index) => (
                <div
                  key={row.key}
                  role="group"
                  aria-label={`Mangel ${String(index + 1)}`}
                  className="flex flex-col gap-2.5 border-b border-line pb-3 last:border-b-0 last:pb-0"
                >
                  <div className="sm:w-[360px]">
                    <SelectField
                      label={collectiveWords.asset}
                      required
                      starred
                      value={row.activityId}
                      options={parts.map((part) => ({ value: part.id, label: assetWords(part) }))}
                      onChange={(chosen) => {
                        changeDefect(row.key, { activityId: chosen })
                      }}
                    />
                  </div>
                  <div className="grid items-start gap-2.5 sm:grid-cols-[minmax(0,1fr)_150px_160px_auto]">
                    <Field
                      label="Beschreibung"
                      required
                      starred
                      value={row.description}
                      problem={defectProblem(row, 'description')}
                      onChange={(event) => {
                        changeDefect(row.key, { description: event.target.value })
                      }}
                    />
                    <SelectField
                      label="Klasse"
                      value={row.defectClass}
                      options={[
                        { value: '', label: reportWords.withoutClass },
                        ...classes.map((each) => ({
                          value: each.defectClass.key,
                          label: each.defectClass.label,
                        })),
                      ]}
                      problem={defectProblem(row, 'defectClass')}
                      onChange={(chosen) => {
                        changeDefect(row.key, { defectClass: chosen })
                      }}
                    />
                    <Field
                      label="Frist zur Beseitigung"
                      type="date"
                      value={row.dueOn}
                      problem={defectProblem(row, 'dueOn')}
                      onChange={(event) => {
                        changeDefect(row.key, { dueOn: event.target.value })
                      }}
                    />
                    <div className="sm:pt-[22px]">
                      <Button
                        type="button"
                        size="small"
                        icon={Trash2}
                        disabled={working}
                        aria-label={`Mangel ${String(index + 1)} entfernen`}
                        onClick={() => {
                          setDefects(defects.filter((each) => each.key !== row.key))
                        }}
                      >
                        Entfernen
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
          <NoteBox>{collectiveWords.reportOutcome(parts.length)}</NoteBox>
          {problems['parts'] ? (
            <p role="alert" className="text-[13px] font-semibold text-conflict">
              {problems['parts']}
            </p>
          ) : null}
          {trouble ? (
            <p role="alert" className="text-[13px] font-semibold text-conflict">
              {trouble}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              disabled={working}
              onClick={() => {
                void navigate({ to: self.to })
              }}
            >
              Abbrechen
            </Button>
            <Button type="submit" tone="primary" icon={Lock} disabled={working}>
              {working ? 'Einen Moment' : 'Nachweise festschreiben'}
            </Button>
          </div>
        </div>
        {side}
      </form>
    </Screen>
  )
}

/** The result of one asset as a box on a phone: the choice, and the reason of "not performed". */
function PartResult({
  label,
  row,
  disabled,
  problem,
  onChange,
}: {
  readonly label: string
  readonly row: PartRow
  readonly disabled: boolean
  readonly problem: string | undefined
  readonly onChange: (change: Partial<PartRow>) => void
}) {
  return (
    <div className="flex flex-col gap-2 px-3.5 py-3">
      <p className="text-[15px] font-medium">{label}</p>
      <SelectField
        label="Ergebnis"
        value={row.result}
        disabled={disabled}
        options={(['without_defects', 'with_defects', 'failed', 'not_performed'] as const).map(
          (each) => ({
            value: each,
            label: evidenceResultLabel[each],
          }),
        )}
        onChange={(value) => {
          onChange({ result: value as EvidenceResult })
        }}
      />
      {row.result === 'not_performed' ? (
        <Field
          label={collectiveWords.reason}
          maxLength={evidenceLimits.resultReason}
          value={row.resultReason}
          disabled={disabled}
          onChange={(event) => {
            onChange({ resultReason: event.target.value })
          }}
        />
      ) : null}
      {problem ? (
        <p role="alert" className="text-[13px] font-semibold text-conflict">
          {problem}
        </p>
      ) : null}
    </div>
  )
}

/** A choice in a cell of the table, its label for a screen reader, as the board draws none over it. */
function CellSelect({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  readonly label: string
  readonly value: string
  readonly options: readonly { readonly value: string; readonly label: string }[]
  readonly disabled: boolean
  readonly onChange: (value: string) => void
}) {
  return (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(event) => {
        onChange(event.target.value)
      }}
      className="h-8 w-full min-w-0 cursor-pointer rounded-control border border-line-strong bg-input px-2.5 text-[14px] text-ink"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}
