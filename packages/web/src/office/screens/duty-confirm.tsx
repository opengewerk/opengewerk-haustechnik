import {
  type AssetDetails,
  bearsTheIntervalOf,
  byNameIn,
  type Catalogue,
  catalogueOriginLabel,
  type CatalogueEntry,
  type Counting,
  countingLabel,
  type DeadlineInterval,
  type DutyDetails,
  type DutyIntervalDocument,
  dutyIntervalProblem,
  type DutyKind,
  dutyLimits,
  dutyMaximum,
  type DutyPerformer,
  dutyPerformerLabel,
  dutyPerformers,
  type DutyPlaceChain,
  dutyProblems,
  dutyTaskLabel,
  evidenceKindLabel,
  type FederalState,
  type IntervalKind,
  intervalKindLabel,
  intervalNeedsReason,
  intervalOfRule,
  intervalWords,
  type IsoDate,
  onceDueWords,
  type OnceInterval,
  onceStartWords,
  qualificationLevelLabel,
  type RecordState,
} from '@opengewerk/haustechnik-domain'
import {
  Button,
  Choice,
  Field,
  Panel,
  PanelLabel,
  SelectField,
  TextArea,
} from '@opengewerk/platform-web'
import { useVersions } from '@opengewerk/platform-web/attachments'
import { date, today } from '@opengewerk/platform-web/format'
import { Empty, FactList, PageHead, Screen } from '@opengewerk/platform-web/office'
import { useRight } from '@opengewerk/platform-web/session'
import { refusalFor, text, useRecords, useSync, useSyncStatus } from '@opengewerk/platform-web/sync'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { Check, Info, X } from 'lucide-react'
import { type FormEvent, type ReactNode, useState } from 'react'

import { ContractorField, contractorFieldWords } from '../contractor-field.js'
import { isWaiting } from '../../app/documents.js'
import { ReviewMarks } from '../../app/review-marks.js'
import { useCatalogue } from '../../sync/catalogue.js'
import { askAt, makeAt } from '../../sync/made-at.js'
import { dutyPlaces, dutyRegisterPlace } from '../duty-addresses.js'
import { kindOfDuty } from '../duty-words.js'
import { officePlaces } from '../place-addresses.js'
import { packageOf, proposalFilterOf, proposalPlace } from '../proposal-addresses.js'
import { assetDutiesQuery, assetFileQuery, AssetFileUnread } from './asset.js'
import {
  dutyColleaguesQuery,
  dutyQuery,
  DutyUnread,
  responsibleChoices,
  useDutyPlaces,
} from './duty.js'
import { retentionWords } from './duty-kind.js'
import { afterADecision, assetName, DismissProposalDialog } from './proposals.js'

/**
 * Confirming a proposal of the catalogue with its interval, `bestaetigen()`
 * of the boards (#102, 4.3 of the concept), and the same form over a duty
 * from the catalogue there is, `pflicht_frist()`: the interval within what
 * the kind allows, its reason, who answers for the duty and who performs it.
 *
 * What the kind allows (2.3): a maximum may only be shortened, and needs no
 * reason for that; a guide is set by the operator, who gives a reason for an
 * interval that departs from it; without a value the operator determines the
 * interval and always gives a reason. The maximum stands beside the field.
 * The route of the duties holds the same rules, and the database the
 * maximum.
 *
 * The document that bears the interval (#74) comes under the reason, as a
 * reference the operator may give and need not: one filed at the asset, its
 * room, its building or its property, for whoever may look at documents. The
 * server keeps the newest version of it; over a duty there is, saving with
 * the same document takes the newest version again, which is how a duty
 * that says "Frist prüfen" is checked.
 *
 * A duty that falls due once (#439) has no interval but a due day, from its
 * kind: the day its source names, which the form shows and nobody changes,
 * or the distance of its rule from a day of the asset, which the form asks
 * for, from the commissioning in the file of the asset where its kind counts
 * from that. The due day stands beside the field as it follows from it.
 *
 * Whoever keeps the register fills it in, with a connection.
 */

export const confirmWords = {
  title: 'Pflicht bestätigen',
  intervalTitle: 'Frist festlegen',
  termTitle: 'Termin festlegen',
  mayNot: 'Eine Pflicht bestätigen kann nur, wer das Pflichtenverzeichnis führt.',
  mayNotChange: 'Die Frist einer Pflicht festlegen kann nur, wer das Pflichtenverzeichnis führt.',
  unknownKind: 'Diese Pflichtart kennt der Katalog dieses Geräts nicht.',
  otherKind: 'Diese Pflichtart gilt nicht für Anlagen dieser Art.',
  notNamed: 'Die Adresse nennt keine Anlage und keine Pflichtart.',
  ownDuty: 'Eine eigene Pflicht ändern Sie in ihrem Formular, unter „Bearbeiten“ auf ihrer Seite.',
  ended: 'Diese Pflicht ist beendet; eine beendete Pflicht ändert sich nicht mehr.',
  noConnection: 'Bestätigt wird eine Pflicht im Büro mit Verbindung. Gerade ist keine da.',
  noConnectionToChange: 'Geändert wird eine Pflicht im Büro mit Verbindung. Gerade ist keine da.',
  noInterval: 'Die Frist fehlt.',
  onceCounted:
    'Gibt die Pflichtart vor. Mit dem ersten Nachweis ist die Pflicht erledigt und kehrt nicht wieder.',
  fromTheFile:
    'Aus der Akte der Anlage. Wurde sie an einem anderen Tag in Betrieb genommen oder wieder in Betrieb genommen, tragen Sie diesen ein.',
  fromTheDay:
    'Von diesem Tag an zählt der Termin. Gilt ein neuer, etwa nach einer Wiederinbetriebnahme, tragen Sie diesen ein.',
  earlier: 'Geprüft werden darf früher.',
  check: 'Bitte prüfen Sie die markierten Felder.',
  countingGiven: 'Gibt die Pflichtart vor.',
  reasonForGuide: 'Pflicht, weil die Frist vom Richtwert abweicht.',
  reasonForNone: 'Pflicht, weil die Pflichtart keine Frist vorgibt.',
  reasonForMaximum: 'Auf Wunsch. Eine Höchstfrist zu verkürzen braucht keine Begründung.',
  reasonAtWill: 'Auf Wunsch.',
  noColleagues: 'Wer zur Wahl steht, ließ sich nicht laden. Das braucht eine Verbindung.',
  // The duty of the operator's own the proposal takes the place of (#514).
  replaces: 'Löst ab',
  replacesNone: 'Keine',
  replacesHint:
    'Die gewählte eigene Pflicht endet mit der Bestätigung, ihre Nachweise bleiben bei ihr. Ihr letzter Nachweis zählt für den Termin dieser Pflicht.',
  allows: {
    maximum:
      'Die Vorschrift nennt sie. Die Frist lässt sich nur verkürzen, dafür braucht es keine Begründung.',
    guide: 'Sie legen die Frist fest. Weicht sie vom Richtwert ab, begründen Sie es.',
    none: 'Sie ermitteln die Frist selbst, etwa in der Gefährdungsbeurteilung, und begründen sie immer.',
    once: 'Die Vorschrift nennt einen Tag oder einen Abstand zu einem Tag der Anlage. Mit dem ersten Nachweis ist die Pflicht erledigt.',
  },
  intervalCounts:
    'Ändert sich die Frist, rechnet der Termin mit ihr neu. Nachweise und Vorgänge bleiben bei der Pflicht.',
  termCounts:
    'Ändert sich der Tag, ab dem gezählt wird, rechnet der Termin neu, und ein Nachweis von vor diesem Tag erfüllt die Pflicht nicht mehr. Nachweise und Vorgänge bleiben bei der Pflicht.',
  maximumKept:
    'Die Höchstfrist ist die vom Tag der Bestätigung. Eine neue Fassung des Pakets ändert sie nicht still.',
  document: 'Dokument, das die Frist trägt',
  noDocument: 'Kein Dokument',
  documentFrom: 'Aus der Ablage der Anlage, ihres Raums, ihres Gebäudes oder ihrer Liegenschaft.',
  noDocumentThere:
    'In der Ablage der Anlage, ihres Raums, ihres Gebäudes und ihrer Liegenschaft liegt kein Dokument.',
  documentRemoved: 'aus der Ablage entfernt',
  removedChoose: 'Das Dokument ist aus der Ablage entfernt. Wählen Sie ein anderes oder keines.',
} as const

/** What the form holds, each field as the text that stands in it. */
interface Typed {
  readonly interval: string
  readonly unit: 'months' | 'days'
  readonly reason: string
  /** The document that bears the interval, or nothing. */
  readonly documentId: string
  readonly responsibleUserId: string
  readonly performer: DutyPerformer | null
  readonly performerNote: string
  /** The firm out of the list (#328), or empty. */
  readonly contractorId: string
  /** The day a duty that falls due once is counted from (#439), or empty. */
  readonly countedFrom: string
}

/** What a kind allows a duty: the kind of its interval, the maximum and the guide, or the due day of one that falls due once. */
interface Allowed {
  readonly kind: IntervalKind
  readonly maximum: DeadlineInterval | null
  readonly guide: DeadlineInterval | null
  readonly counting: Counting
  readonly once: OnceInterval | null
}

/** The due day of a kind that falls due once, as it allows a duty; nothing for one that recurs. */
function onceOf(definition: DutyKind): OnceInterval | null {
  return definition.interval.kind === 'once' ? definition.interval : null
}

/** Whether a kind that falls due once counts its due day from a day of the asset, which the form asks for. */
function countsFromADay(allowed: Allowed): boolean {
  return allowed.once !== null && 'rule' in allowed.once
}

/** The interval a kind names on a day, in the state of the place, or nothing. */
function namedInterval(
  catalogue: Catalogue,
  entry: CatalogueEntry<DutyKind>,
  on: IsoDate,
  state: FederalState | undefined,
): DeadlineInterval | null {
  const rule = catalogue.interval(entry.definition, on, state)

  return rule === null ? null : intervalOfRule(rule.record)
}

/** The state of the property of a record on this device, if it holds it. */
function stateOf(property: RecordState | null): FederalState | undefined {
  return property === null ? undefined : (String(property['federalState']) as FederalState)
}

/** The interval as the model takes it: a whole number where one was typed, else what was typed, for the model to refuse. */
function intervalOf(typed: Typed) {
  const said = typed.interval.trim()
  const value = /^\d+$/.test(said) ? Number(said) : said

  return typed.unit === 'months' ? { intervalMonths: value } : { intervalDays: value }
}

/** The interval typed, where it is a whole number. */
function typedInterval(typed: Typed): DeadlineInterval | null {
  const said = typed.interval.trim()

  return /^\d+$/.test(said)
    ? typed.unit === 'months'
      ? { months: Number(said) }
      : { days: Number(said) }
    : null
}

/**
 * What the form says, as the route takes it. A duty that falls due once
 * names the day it is counted from instead of an interval, where its kind
 * counts from one (#439).
 */
function described(typed: Typed, allowed: Allowed) {
  const term =
    allowed.kind === 'once'
      ? countsFromADay(allowed)
        ? { countedFrom: typed.countedFrom === '' ? null : typed.countedFrom }
        : {}
      : {
          ...intervalOf(typed),
          intervalReason: typed.reason.trim() === '' ? null : typed.reason.trim(),
          intervalDocumentId: typed.documentId === '' ? null : typed.documentId,
        }

  return {
    ...term,
    responsibleUserId: typed.responsibleUserId === '' ? null : typed.responsibleUserId,
    performer: typed.performer,
    // The note names the contractor, and goes only with one.
    performerNote:
      typed.performer === 'contractor' && typed.performerNote.trim() !== ''
        ? typed.performerNote.trim()
        : null,
    // The firm out of the list, with a contractor alone (#328).
    contractorId:
      typed.performer === 'contractor' && typed.contractorId !== '' ? typed.contractorId : null,
  }
}

/** Whether the interval typed needs its reason, as the route asks it. */
function needsReason(typed: Typed, allowed: Allowed): boolean {
  const interval = typedInterval(typed)

  return (
    allowed.kind === 'none' ||
    (interval !== null && intervalNeedsReason(allowed.kind, interval, allowed.guide))
  )
}

/** What is wrong with what the form says, by field. */
function problemsOf(typed: Typed, allowed: Allowed): Record<string, string> {
  const values = described(typed, allowed)
  const wrong: Record<string, string> = { ...dutyProblems(values) }

  if (allowed.kind === 'once') {
    if (allowed.once !== null && 'rule' in allowed.once && typed.countedFrom === '') {
      wrong['countedFrom'] = `Der ${onceStartWords[allowed.once.from].day} fehlt.`
    }

    return wrong
  }

  const intervalWrong =
    typed.interval.trim() === ''
      ? confirmWords.noInterval
      : dutyIntervalProblem(intervalOf(typed), allowed.counting, allowed.maximum)

  if (intervalWrong !== null) {
    wrong['interval'] = intervalWrong
  } else if (needsReason(typed, allowed) && typed.reason.trim() === '') {
    wrong['reason'] =
      allowed.kind === 'guide' && allowed.guide !== null
        ? `Der Richtwert beträgt ${intervalWords(allowed.guide)}; eine Frist, die davon abweicht, braucht eine Begründung.`
        : 'Die Frist dieser Pflichtart legt der Betreiber fest; sie braucht eine Begründung, etwa den Verweis auf die Gefährdungsbeurteilung.'
  }

  return wrong
}

/**
 * A form that starts from an interval the kind names, or from nothing; for a
 * kind that falls due once and counts from the commissioning, from the day
 * the file of the asset keeps (#439).
 */
function startingWith(
  interval: DeadlineInterval | null,
  once: OnceInterval | null = null,
  commissionedOn: IsoDate | null = null,
): Typed {
  return {
    interval: interval === null ? '' : String('days' in interval ? interval.days : interval.months),
    unit: interval !== null && 'days' in interval ? 'days' : 'months',
    reason: '',
    documentId: '',
    responsibleUserId: '',
    performer: null,
    performerNote: '',
    contractorId: '',
    countedFrom:
      once !== null && 'rule' in once && once.from === 'commissioning'
        ? (commissionedOn ?? '')
        : '',
  }
}

/** The form over a duty there is: what it says, as text. */
function typedOf(duty: DutyDetails): Typed {
  return {
    interval: String(duty.intervalDays ?? duty.intervalMonths ?? ''),
    unit: duty.intervalDays === null ? 'months' : 'days',
    reason: duty.intervalReason ?? '',
    documentId: duty.intervalDocumentId ?? '',
    responsibleUserId: duty.responsibleUserId ?? '',
    performer: duty.performer,
    performerNote: duty.performerNote ?? '',
    contractorId: duty.contractorId ?? '',
    countedFrom: duty.countedFrom ?? '',
  }
}

export function ConfirmDutyScreen() {
  const search = useSearch({ strict: false })
  const { assetId, dutyKind } = proposalFilterOf(search)
  const keeps = useRight('duty.write')
  const catalogue = useCatalogue()
  const properties = useRecords('properties')
  const on = today()
  const file = useQuery({
    ...assetFileQuery(assetId ?? ''),
    enabled: keeps && assetId !== undefined,
  })
  const asset = file.data
  const entry = dutyKind === undefined ? null : (catalogue?.dutyKind(dutyKind, on) ?? null)

  const unread = (words: string) => (
    <Screen>
      <PageHead title={confirmWords.title} crumbs={[dutyRegisterPlace, proposalPlace]} />
      <Empty>{words}</Empty>
    </Screen>
  )

  if (!keeps) {
    return unread(confirmWords.mayNot)
  }

  if (assetId === undefined || dutyKind === undefined) {
    return unread(confirmWords.notNamed)
  }

  if (asset === undefined) {
    return <AssetFileUnread file={file} />
  }

  if (catalogue === null || entry === null) {
    return unread(confirmWords.unknownKind)
  }

  if (!entry.definition.scope.assetKinds.includes(asset.kind)) {
    return unread(confirmWords.otherKind)
  }

  const property = properties.find((record) => record['id'] === asset.propertyId) ?? null
  const state = stateOf(property)

  // A new form once the place of the asset is known: its state may name an
  // interval of its own.
  return (
    <ConfirmForm
      key={`${asset.id} ${entry.key} ${state ?? ''}`}
      asset={asset}
      catalogue={catalogue}
      entry={entry}
      state={state}
    />
  )
}

function ConfirmForm({
  asset,
  catalogue,
  entry,
  state,
}: {
  readonly asset: AssetDetails
  readonly catalogue: Catalogue
  readonly entry: CatalogueEntry<DutyKind>
  readonly state: FederalState | undefined
}) {
  const client = useSync()
  const status = useSyncStatus()
  const queries = useQueryClient()
  const navigate = useNavigate()
  const on = today()
  const kind = entry.definition.interval.kind
  const named = namedInterval(catalogue, entry, on, state)
  const allowed: Allowed = {
    kind,
    maximum: kind === 'maximum' ? named : null,
    guide: kind === 'guide' ? named : null,
    counting: entry.definition.counting,
    once: onceOf(entry.definition),
  }
  const [typed, setTyped] = useState<Typed>(() =>
    startingWith(named, allowed.once, asset.commissionedOn),
  )
  const [problems, setProblems] = useState<Readonly<Record<string, string>>>({})
  const [trouble, setTrouble] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const [dismissing, setDismissing] = useState(false)
  // The duties of the operator's own at the asset that stand, one of which the
  // proposal may take the place of (#514).
  const duties = useQuery(assetDutiesQuery(asset.id))
  const own = (duties.data ?? []).filter((duty) => duty.kind === null && duty.endsOn === null)
  const [replaces, setReplaces] = useState('')

  const set = (values: Partial<Typed>) => {
    setTyped((current) => ({ ...current, ...values }))
  }
  const back = () => {
    void navigate({ to: proposalPlace.to })
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    setTrouble(null)

    const wrong = problemsOf(typed, allowed)

    setProblems(wrong)

    if (Object.keys(wrong).length > 0) {
      setTrouble(confirmWords.check)

      return
    }

    setWorking(true)

    try {
      const result = await makeAt(client, '/duties', {
        assetId: asset.id,
        kind: entry.key,
        ...described(typed, allowed),
        ...(replaces === '' ? {} : { replacesDutyId: replaces }),
      })

      if (result.outcome === 'refused') {
        setTrouble(refusalFor(result))

        return
      }

      await afterADecision(queries)
      await navigate({ to: dutyPlaces.duty(result.id) })
    } finally {
      setWorking(false)
    }
  }

  return (
    <Screen>
      <PageHead
        title={confirmWords.title}
        sub={`${entry.definition.label} an ${assetName(asset)}`}
        crumbs={[
          dutyRegisterPlace,
          proposalPlace,
          { to: officePlaces.asset(asset.id), label: assetName(asset) },
        ]}
        phoneBack={proposalPlace}
      />
      <form
        noValidate
        className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]"
        onSubmit={(event) => {
          void save(event)
        }}
      >
        <div className="flex min-w-0 flex-col gap-3">
          <Panel roomy>
            <div className="flex flex-col gap-3">
              {status.online ? null : (
                <p role="status" className="text-[13px] font-medium text-ink-muted">
                  {confirmWords.noConnection}
                </p>
              )}
              <IntervalFields
                typed={typed}
                set={set}
                problems={problems}
                allowed={allowed}
                named={null}
                term={{ catalogue, entry, state, fromTheFile: true }}
                chain={{
                  propertyId: asset.propertyId,
                  buildingId: asset.buildingId,
                  roomId: asset.roomId,
                  assetId: asset.id,
                }}
                pointedAt={null}
                beforeResponsible={
                  own.length === 0 ? null : (
                    <SelectField
                      label={confirmWords.replaces}
                      options={[
                        { value: '', label: confirmWords.replacesNone },
                        ...own.map((duty) => ({
                          value: duty.id,
                          label:
                            duty.lastMetOn === null
                              ? duty.title
                              : `${duty.title}, zuletzt am ${date(duty.lastMetOn)}`,
                        })),
                      ]}
                      value={replaces}
                      hint={confirmWords.replacesHint}
                      onChange={setReplaces}
                    />
                  )
                }
              />
            </div>
          </Panel>
          {trouble ? (
            <p role="alert" className="text-[13px] font-semibold text-conflict">
              {trouble}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              icon={X}
              disabled={working}
              onClick={() => {
                setDismissing(true)
              }}
            >
              Verwerfen
            </Button>
            <div className="grow" />
            <Button disabled={working} onClick={back}>
              Abbrechen
            </Button>
            <Button type="submit" tone="primary" icon={Check} disabled={working || !status.online}>
              {working ? 'Einen Moment' : 'Pflicht bestätigen'}
            </Button>
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-3.5">
          <KindPanel catalogue={catalogue} entry={entry} allowed={allowed} state={state} />
          <Panel title="Was die Pflichtart zulässt">
            <div className="flex flex-col gap-[7px] text-[13px] leading-[1.45] max-sm:text-[15px]">
              {(['maximum', 'guide', 'none', 'once'] as const).map((each) => (
                <p key={each}>
                  <span className="font-semibold">{intervalKindLabel[each]}.</span>{' '}
                  {confirmWords.allows[each]}
                </p>
              ))}
            </div>
          </Panel>
        </div>
      </form>
      {dismissing ? (
        <DismissProposalDialog
          asset={asset}
          kind={entry.key}
          label={entry.definition.label}
          onClose={() => {
            setDismissing(false)
          }}
          onDismissed={back}
        />
      ) : null}
    </Screen>
  )
}

export function DutyIntervalScreen() {
  const { dutyId } = useParams({ strict: false }) as { dutyId?: string }
  const keeps = useRight('duty.write')
  const catalogue = useCatalogue()
  const page = useQuery({ ...dutyQuery(dutyId ?? ''), enabled: dutyId !== undefined && keeps })
  const duty = page.data
  const { property } = useDutyPlaces(duty)

  const unread = (words: string) => (
    <Screen>
      <PageHead
        title={confirmWords.intervalTitle}
        crumbs={[
          dutyRegisterPlace,
          ...(duty ? [{ to: dutyPlaces.duty(duty.id), label: duty.title }] : []),
        ]}
      />
      <Empty>{words}</Empty>
    </Screen>
  )

  if (!keeps) {
    return unread(confirmWords.mayNotChange)
  }

  if (duty === undefined) {
    return <DutyUnread page={page} />
  }

  if (duty.kind === null) {
    return unread(confirmWords.ownDuty)
  }

  if (duty.ended) {
    return unread(confirmWords.ended)
  }

  const entry = kindOfDuty(duty, catalogue)

  if (catalogue === null || entry === null) {
    return unread(confirmWords.unknownKind)
  }

  const state = stateOf(property)

  return (
    <IntervalForm
      key={`${duty.id} ${state ?? ''}`}
      duty={duty}
      catalogue={catalogue}
      entry={entry}
      state={state}
    />
  )
}

function IntervalForm({
  duty,
  catalogue,
  entry,
  state,
}: {
  readonly duty: DutyDetails
  readonly catalogue: Catalogue
  readonly entry: CatalogueEntry<DutyKind>
  readonly state: FederalState | undefined
}) {
  const client = useSync()
  const status = useSyncStatus()
  const queries = useQueryClient()
  const navigate = useNavigate()
  const kind = entry.definition.interval.kind
  // The maximum is the one kept beside the duty; the guide is the one of
  // today, which the route holds a reason against.
  const allowed: Allowed = {
    kind,
    maximum: dutyMaximum(duty),
    guide: kind === 'guide' ? namedInterval(catalogue, entry, today(), state) : null,
    counting: duty.counting,
    once: onceOf(entry.definition),
  }
  const title = allowed.once === null ? confirmWords.intervalTitle : confirmWords.termTitle
  const [typed, setTyped] = useState<Typed>(() => typedOf(duty))
  const [problems, setProblems] = useState<Readonly<Record<string, string>>>({})
  const [trouble, setTrouble] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const asset = duty.asset

  const set = (values: Partial<Typed>) => {
    setTyped((current) => ({ ...current, ...values }))
  }
  const back = () => {
    void navigate({ to: dutyPlaces.duty(duty.id) })
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    setTrouble(null)

    const wrong = problemsOf(typed, allowed)

    setProblems(wrong)

    if (Object.keys(wrong).length > 0) {
      setTrouble(confirmWords.check)

      return
    }

    // What differs from what the duty said, field by field: a unit that
    // changed sends the interval under its own name, and the route lets the
    // other one go.
    const was: Readonly<Record<string, unknown>> = described(typedOf(duty), allowed)
    const changes = Object.fromEntries(
      Object.entries(described(typed, allowed)).filter(([field, value]) => was[field] !== value),
    )

    // A newer version lies over the one the duty points at: saving with the
    // same document is the check, and the duty points at the newest (#74).
    if (checksTheNewest(duty.intervalDocument, typed.documentId)) {
      changes['intervalDocumentId'] = typed.documentId
    }

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

      await afterADecision(queries)
      back()
    } finally {
      setWorking(false)
    }
  }

  return (
    <Screen>
      <PageHead
        title={title}
        sub={asset ? `${duty.title} an ${assetName(asset)}` : duty.title}
        crumbs={[dutyRegisterPlace, { to: dutyPlaces.duty(duty.id), label: duty.title }]}
        phoneBack={{ to: dutyPlaces.duty(duty.id), label: duty.title }}
      />
      <form
        noValidate
        className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]"
        onSubmit={(event) => {
          void save(event)
        }}
      >
        <div className="flex min-w-0 flex-col gap-3">
          <Panel roomy>
            <div className="flex flex-col gap-3">
              {status.online ? null : (
                <p role="status" className="text-[13px] font-medium text-ink-muted">
                  {confirmWords.noConnectionToChange}
                </p>
              )}
              <IntervalFields
                typed={typed}
                set={set}
                problems={problems}
                allowed={allowed}
                named={duty.responsible}
                keptMaximum
                term={{ catalogue, entry, state, fromTheFile: false }}
                chain={{
                  propertyId: duty.propertyId,
                  buildingId: duty.asset?.buildingId ?? duty.buildingId,
                  roomId: duty.asset?.roomId ?? duty.roomId,
                  assetId: duty.assetId,
                }}
                pointedAt={duty.intervalDocument}
              />
            </div>
          </Panel>
          {trouble ? (
            <p role="alert" className="text-[13px] font-semibold text-conflict">
              {trouble}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button disabled={working} onClick={back}>
              Abbrechen
            </Button>
            <Button type="submit" tone="primary" icon={Check} disabled={working || !status.online}>
              {working ? 'Wird gespeichert' : 'Speichern'}
            </Button>
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-3.5">
          <KindPanel
            catalogue={catalogue}
            entry={entry}
            allowed={allowed}
            version={duty.kindVersion}
            keptMaximum
            state={state}
          />
          <Panel title="Gut zu wissen">
            <div className="flex flex-col gap-[7px] text-[13px] leading-[1.45] max-sm:text-[15px]">
              <p>{allowed.once === null ? confirmWords.intervalCounts : confirmWords.termCounts}</p>
              {allowed.maximum === null ? null : <p>{confirmWords.maximumKept}</p>}
            </div>
          </Panel>
        </div>
      </form>
    </Screen>
  )
}

/**
 * Whether saving takes the newest version of the document a duty points at:
 * one lies over it, the document is still in the records, and the form still
 * names it.
 */
function checksTheNewest(pointedAt: DutyIntervalDocument | null, documentId: string): boolean {
  return (
    pointedAt !== null &&
    !pointedAt.removed &&
    pointedAt.newer !== null &&
    pointedAt.id === documentId
  )
}

/**
 * The documents that may bear the interval of a duty at a place (#74), as
 * the choice offers them: those of this device filed at the place or above
 * it, whose newest version has arrived at the server, by their names. The
 * one a duty points at stays a choice, also once it was taken out of the
 * records.
 */
function useDocumentChoices(chain: DutyPlaceChain, pointedAt: DutyIntervalDocument | null) {
  const client = useSync()
  const documents = useRecords('attachments')
  const versions = useVersions()

  const offered = documents
    .filter((document) => bearsTheIntervalOf(document, chain))
    .flatMap((document) => {
      const id = String(document['id'])
      const newest = (versions.get(id) ?? []).find((version) => !isWaiting(client, version))

      return newest === undefined
        ? []
        : [{ value: id, label: `${text(document, 'title')} (${text(newest, 'fileName')})` }]
    })
    .sort((left, right) => byNameIn(left.label, right.label))
  const kept =
    pointedAt === null || offered.some((choice) => choice.value === pointedAt.id)
      ? []
      : [
          {
            value: pointedAt.id,
            label: pointedAt.removed
              ? `${pointedAt.title} (${confirmWords.documentRemoved})`
              : pointedAt.title,
          },
        ]

  return [...offered, ...kept]
}

/**
 * The field of the document that bears the interval, with what it says
 * under the choice: where the documents come from, or that the duty points
 * at an older version and saving takes the newest, or that the document was
 * taken out of the records.
 */
function DocumentField({
  typed,
  set,
  chain,
  pointedAt,
}: {
  readonly typed: Typed
  readonly set: (values: Partial<Typed>) => void
  readonly chain: DutyPlaceChain
  readonly pointedAt: DutyIntervalDocument | null
}) {
  const choices = useDocumentChoices(chain, pointedAt)
  const named = pointedAt !== null && pointedAt.id === typed.documentId ? pointedAt : null
  const waiting = (words: string) => (
    <span className="inline-flex items-start gap-1.5 text-waiting">
      <Info size={15} strokeWidth={2.2} aria-hidden="true" className="mt-px shrink-0" />
      <span>{words}</span>
    </span>
  )

  return (
    <SelectField
      label={confirmWords.document}
      options={[{ value: '', label: confirmWords.noDocument }, ...choices]}
      value={typed.documentId}
      hint={
        named?.removed === true
          ? waiting(confirmWords.removedChoose)
          : named !== null && named.newer !== null
            ? waiting(
                `Die Pflicht zeigt auf Fassung ${String(named.version.number)} vom ${date(named.version.filedOn)}. Fassung ${String(named.newer.number)} vom ${date(named.newer.filedOn)} liegt vor; mit „Speichern“ zeigt sie auf diese.`,
              )
            : choices.length === 0
              ? confirmWords.noDocumentThere
              : confirmWords.documentFrom
      }
      onChange={(value) => {
        set({ documentId: value })
      }}
    />
  )
}

/**
 * The fields of the form: the interval with its unit and what the kind
 * says beside it, how it is counted, its reason and the document that bears
 * it, and who answers for the duty and who performs it.
 */
function IntervalFields({
  typed,
  set,
  problems,
  allowed,
  named,
  term,
  keptMaximum = false,
  chain,
  pointedAt,
  beforeResponsible = null,
}: {
  readonly typed: Typed
  readonly set: (values: Partial<Typed>) => void
  readonly problems: Readonly<Record<string, string>>
  readonly allowed: Allowed
  /** Whom the duty names, who stays a choice when shut out; none for a new one. */
  readonly named: DutyDetails['responsible']
  /** What the due day of a duty that falls due once is worked out from (#439). */
  readonly term: TermSource
  /** The maximum is the one kept at the duty since the day it was confirmed. */
  readonly keptMaximum?: boolean
  /** Where the duty hangs and what lies above it, where the document that bears its interval may lie. */
  readonly chain: DutyPlaceChain
  /** The document a duty there is points at; none for a new one. */
  readonly pointedAt: DutyIntervalDocument | null
  /** What stands before who answers for the duty: the duty a proposal takes the place of (#514). */
  readonly beforeResponsible?: ReactNode
}) {
  const seesDocuments = useRight('document.read')
  const interval = typedInterval(typed)
  const departs =
    allowed.kind === 'guide' &&
    allowed.guide !== null &&
    interval !== null &&
    intervalNeedsReason('guide', interval, allowed.guide)
  const reasonNeeded = needsReason(typed, allowed)
  const beside =
    allowed.kind === 'maximum' && allowed.maximum !== null
      ? `Höchstfrist: ${intervalWords(allowed.maximum)}${keptMaximum ? ', am Tag der Bestätigung' : ''}`
      : allowed.kind === 'guide' && allowed.guide !== null
        ? departs
          ? `Weicht vom Richtwert ab: ${intervalWords(allowed.guide)}`
          : `Richtwert: ${intervalWords(allowed.guide)}`
        : allowed.kind === 'none'
          ? 'Die Pflichtart gibt keine Frist vor.'
          : null

  if (allowed.once !== null) {
    return (
      <>
        <OnceFields typed={typed} set={set} problems={problems} once={allowed.once} term={term} />
        {beforeResponsible}
        <ResponsibleFields typed={typed} set={set} problems={problems} named={named} />
      </>
    )
  }

  return (
    <>
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
        {beside === null ? null : (
          <p
            className={`flex items-center gap-1.5 self-end pb-2 text-[13px] ${departs ? 'text-waiting' : 'text-ink-muted'}`}
          >
            <Info size={15} strokeWidth={2.2} aria-hidden="true" className="shrink-0" />
            {beside}
          </p>
        )}
      </div>
      <Field
        label="Gezählt"
        value={countingLabel[allowed.counting]}
        readOnly
        hint={confirmWords.countingGiven}
        // Grey as the board draws a field that cannot be changed.
        className="bg-surface-sunken!"
      />
      <TextArea
        label="Begründung der Frist"
        rows={3}
        required={reasonNeeded}
        starred={reasonNeeded}
        value={typed.reason}
        maxLength={dutyLimits.intervalReason}
        hint={
          allowed.kind === 'none'
            ? confirmWords.reasonForNone
            : departs
              ? confirmWords.reasonForGuide
              : allowed.kind === 'maximum'
                ? confirmWords.reasonForMaximum
                : confirmWords.reasonAtWill
        }
        problem={problems['reason']}
        onChange={(event) => {
          set({ reason: event.target.value })
        }}
      />
      {seesDocuments ? (
        <DocumentField typed={typed} set={set} chain={chain} pointedAt={pointedAt} />
      ) : null}
      {beforeResponsible}
      <ResponsibleFields typed={typed} set={set} problems={problems} named={named} />
    </>
  )
}

/** What the due day of a duty that falls due once is worked out from, and whether its day comes from the file of the asset. */
interface TermSource {
  readonly catalogue: Catalogue
  readonly entry: CatalogueEntry<DutyKind>
  readonly state: FederalState | undefined
  /** A new duty takes the commissioning from the file of its asset; a duty there is has its own day. */
  readonly fromTheFile: boolean
}

/**
 * The due day of a duty that falls due once (#439): the day its source names,
 * grey because nobody changes it, or the day of the asset it is counted from,
 * with the due day it gives beside it. Then that it is counted once.
 */
function OnceFields({
  typed,
  set,
  problems,
  once,
  term,
}: {
  readonly typed: Typed
  readonly set: (values: Partial<Typed>) => void
  readonly problems: Readonly<Record<string, string>>
  readonly once: OnceInterval
  readonly term: TermSource
}) {
  const { catalogue, entry, state } = term
  const { definition } = entry

  if ('dueOn' in once) {
    return (
      <>
        <PanelLabel>Termin</PanelLabel>
        <Field
          label="Termin"
          value={date(once.dueOn)}
          readOnly
          hint={`Gibt ${definition.source} vor. ${confirmWords.earlier}`}
          className="bg-surface-sunken!"
        />
        <OnceCounting />
      </>
    )
  }

  const from = /^\d{4}-\d{2}-\d{2}$/.test(typed.countedFrom) ? typed.countedFrom : null
  const due = from === null ? null : catalogue.onceDue(entry, from, state)

  return (
    <>
      <PanelLabel>Termin</PanelLabel>
      <div className="grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)]">
        <Field
          label={onceStartWords[once.from].day}
          type="date"
          required
          starred
          value={typed.countedFrom}
          problem={problems['countedFrom']}
          onChange={(event) => {
            set({ countedFrom: event.target.value })
          }}
        />
        {due === null || from === null ? null : (
          <p className="flex items-center gap-1.5 self-end pb-2 text-[13px] text-ink-muted">
            <Info size={15} strokeWidth={2.2} aria-hidden="true" className="shrink-0" />
            {`Fällig bis ${date(due)}: ${onceDueWords(catalogue, once, from < entry.validFrom ? entry.validFrom : from, state)}`}
          </p>
        )}
      </div>
      <p className="text-[12px] leading-[1.45] text-ink-muted max-sm:text-[14px]">
        {term.fromTheFile && once.from === 'commissioning'
          ? confirmWords.fromTheFile
          : confirmWords.fromTheDay}
      </p>
      <OnceCounting />
    </>
  )
}

/** That a duty that falls due once is counted once, as its kind says. */
function OnceCounting() {
  return (
    <Field
      label="Gezählt"
      value={countingLabel.once}
      readOnly
      hint={confirmWords.onceCounted}
      className="bg-surface-sunken!"
    />
  )
}

/** Who answers for a duty and who performs it, under the interval or the due day. */
function ResponsibleFields({
  typed,
  set,
  problems,
  named,
}: {
  readonly typed: Typed
  readonly set: (values: Partial<Typed>) => void
  readonly problems: Readonly<Record<string, string>>
  readonly named: DutyDetails['responsible']
}) {
  const colleagues = useQuery(dutyColleaguesQuery)

  return (
    <>
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
          {confirmWords.noColleagues}
        </p>
      ) : null}
      {typed.performer === 'contractor' ? (
        <ContractorField
          value={typed.contractorId}
          note={typed.performerNote}
          noneLabel={contractorFieldWords.none}
          problem={problems['contractorId'] ?? problems['performerNote']}
          onChange={(value) => {
            set({ contractorId: value })
          }}
        />
      ) : null}
    </>
  )
}

/**
 * The card "Pflichtart" beside the form: the kind with its marks, where it
 * comes from, its interval and who performs it, and who accepted it.
 */
function KindPanel({
  catalogue,
  entry,
  allowed,
  version,
  keptMaximum = false,
  state,
}: {
  readonly catalogue: Catalogue
  readonly entry: CatalogueEntry<DutyKind>
  readonly allowed: Allowed
  /** The version a duty there is was confirmed in; a new one is the version in force. */
  readonly version?: number | null
  readonly keptMaximum?: boolean
  readonly state?: FederalState | undefined
}) {
  const kind = entry.definition
  const on = today()
  const once = onceOf(kind)
  const itsPackage = catalogue.packages.find((each) => each.name === packageOf(entry.key))
  const value =
    allowed.kind === 'maximum' ? allowed.maximum : allowed.kind === 'guide' ? allowed.guide : null

  return (
    <Panel title="Pflichtart">
      <div className="flex flex-col gap-[9px]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[14px] font-semibold">{kind.label}</span>
          <ReviewMarks review={entry.review} />
        </div>
        <FactList
          keyWidth={96}
          facts={[
            {
              label: 'Paket',
              value: `${itsPackage?.title ?? packageOf(entry.key)}, Fassung ${String(version ?? entry.version)}${version === undefined ? '' : ' der Pflichtart'}`,
            },
            { label: 'Herkunft', value: catalogueOriginLabel[kind.origin] },
            { label: 'Fundstelle', value: kind.source },
            { label: 'Tätigkeit', value: dutyTaskLabel[kind.task] },
            { label: 'Art der Frist', value: intervalKindLabel[allowed.kind] },
            ...(value === null
              ? []
              : [
                  {
                    label: intervalKindLabel[allowed.kind],
                    value: `${intervalWords(value)}${keptMaximum && allowed.kind === 'maximum' ? ', am Tag der Bestätigung' : ''}`,
                  },
                ]),
            // The due day of a kind that falls due once (#439).
            ...(once === null
              ? []
              : [{ label: 'Termin', value: onceDueWords(catalogue, once, on, state) }]),
            { label: 'Gezählt', value: countingLabel[allowed.counting] },
            {
              label: 'Qualifikation',
              value: qualificationLevelLabel[kind.qualification.level],
            },
            {
              label: 'Nachweis',
              value: kind.evidence.kinds.map((each) => evidenceKindLabel[each]).join(', '),
            },
            { label: 'Aufbewahrung', value: retentionWords(catalogue, kind, on) },
          ]}
        />
        <p className="border-t border-line pt-[9px] text-[12px] leading-[1.5] text-ink-faint">
          {entry.review.accepted === null
            ? 'Die fachkundige Abnahme steht aus.'
            : `Abgenommen von ${entry.review.accepted.by} am ${date(entry.review.accepted.on)}.`}{' '}
          Zuletzt gegen die Quelle geprüft am {date(entry.review.checkedOn)}.
        </p>
      </div>
    </Panel>
  )
}
