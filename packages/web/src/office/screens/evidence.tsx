import {
  correctionProblems,
  countingLabel,
  evidenceLimits,
  evidenceOriginLabel,
  type EvidencePage,
  evidenceResultLabel,
  evidenceResults,
  intervalWords,
  originsFromAnActivity,
  type RecordState,
  retentionKindLabel,
  signatureRoleLabel,
  type StatedPlace,
  type StatedRetention,
  statedReasonProblem,
} from '@opengewerk/haustechnik-domain'
import {
  Button,
  Cell,
  Column,
  Dialog,
  DialogActions,
  Field,
  NumberBadge,
  Panel,
  SelectField,
  Status,
  TablePanel,
  TextArea,
} from '@opengewerk/platform-web'
import { date, moment, today } from '@opengewerk/platform-web/format'
import {
  Empty,
  type Fact,
  FactList,
  NoteBox,
  PageHead,
  Screen,
} from '@opengewerk/platform-web/office'
import { useRight } from '@opengewerk/platform-web/session'
import {
  refusalFor,
  request,
  RequestRefused,
  useRecords,
  useSync,
} from '@opengewerk/platform-web/sync'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { Ban, Lock, Pencil } from 'lucide-react'
import { useState } from 'react'

import { placePath } from '../../app/place-path.js'
import { placeAbove } from '../../app/place-records.js'
import { useCatalogue } from '../../sync/catalogue.js'
import { askAt, makeAt } from '../../sync/made-at.js'
import { dutyPlaces, dutyRegisterPlace, evidencePlaces } from '../duty-addresses.js'
import { ResultMark, StandingMark } from '../evidence-words.js'
import { factLink } from '../links.js'
import { officePlaces } from '../place-addresses.js'
import { dutyQuery } from './duty.js'

/** An evidence whole, from the server: it never travels to a device. */
export function evidenceQuery(id: string) {
  return {
    queryKey: ['evidence', 'page', id],
    queryFn: () => request<EvidencePage>(`/evidence/${id}`),
  } as const
}

/**
 * Where the server hands out a file the evidence rests on, by its place among
 * the files of the frozen state: the evidence keeps it, whatever becomes of
 * the document it was filed as (#110).
 */
export function evidenceFilePath(evidenceId: string, position: number): string {
  return `/evidence/${encodeURIComponent(evidenceId)}/files/${String(position)}`
}

export const evidencePageWords = {
  notThere:
    'Diesen Nachweis gibt es nicht, oder er liegt in einem Bereich, den dieser Zugang nicht sieht.',
  noConnection: 'Ein Nachweis kommt vom Server. Gerade ist keine Verbindung da.',
  loading: 'Der Nachweis wird geladen.',
  failed: 'Der Nachweis ließ sich nicht laden. Er kommt vom Server, mit Verbindung.',
  unchangeable:
    'Ein Nachweis wird nie geändert. Ist etwas falsch, entsteht mit „Berichtigen“ ein neuer, der diesen nennt; beide bleiben lesbar.',
  unchangeableVoided:
    'Was für ungültig erklärt ist, bleibt lesbar. Zurücknehmen lässt sich eine Ungültigerklärung nicht; war sie falsch, wird der Nachweis neu eingetragen.',
  fingerprint:
    'SHA-256 über den eingefrorenen Stand. Der Server hat ihn beim Festschreiben berechnet; jede Ausgabe dieses Nachweises entsteht aus genau diesem Stand.',
  countsNoMore: 'Für die Frist zählt dieser Nachweis nicht mehr.',
  signedOnTheReplaced: 'Die Unterschriften stehen am Nachweis, den diese Berichtigung ersetzt.',
  correctionReasonHint: 'Der Grund steht am neuen Nachweis und bleibt lesbar.',
  voidingReasonHint: 'Der Grund und Ihr Name stehen am Nachweis und bleiben lesbar.',
  whatVoidingDoes:
    'Der Nachweis bleibt lesbar und zählt für die Frist nicht mehr: die Pflicht ist fällig, als hätte es ihn nicht gegeben. Zurücknehmen lässt sich das nicht.',
} as const

/** The place of the duty in words, as it was on the day the evidence was written down. */
function placeWords(place: StatedPlace): string {
  return [
    `${place.property.name}, ${place.property.address}`,
    place.building?.name,
    place.room === null ? null : [place.room.number, place.room.name].filter(Boolean).join(' '),
  ]
    .filter(Boolean)
    .join('; ')
}

/** "Ab dem Tag der Durchführung" in the middle of a sentence. */
function lowerFirst(words: string): string {
  return words.charAt(0).toLowerCase() + words.slice(1)
}

function retentionWords(retention: StatedRetention | null): string | null {
  if (retention === null) {
    return null
  }

  return retention.kind === 'years'
    ? `${String(retention.years)} ${retention.years === 1 ? 'Jahr' : 'Jahre'}`
    : retentionKindLabel[retention.kind]
}

/**
 * The page of one evidence, as the boards "Nachweis (2.6)" and "Nachweis für
 * ungültig erklärt (2.6)" draw it (2.6 of the concept): the frozen state as it was written down, the signatures,
 * the fingerprint, and what became of it since. Everything about the work
 * comes from the frozen state and never from the records as they are today;
 * only the path above the page is drawn from the places on the device.
 *
 * Whoever enters evidence corrects it and declares it invalid, as long as
 * neither happened to it: a correction is corrected in turn, and what was
 * declared invalid stays so.
 */
export function EvidenceScreen() {
  const { evidenceId } = useParams({ strict: false }) as { evidenceId?: string }
  const keeps = useRight('evidence.write')
  const seesDuties = useRight('duty.read')
  const [doing, setDoing] = useState<'correct' | 'void' | null>(null)
  const page = useQuery({ ...evidenceQuery(evidenceId ?? ''), enabled: evidenceId !== undefined })
  const shown = page.data
  const duty = useQuery({
    ...dutyQuery(shown?.dutyId ?? ''),
    enabled: shown !== undefined && seesDuties,
  })
  const properties = useRecords('properties')
  const buildings = useRecords('buildings')
  const floors = useRecords('floors')
  const rooms = useRecords('rooms')
  const assets = useRecords('assets')
  const catalogue = useCatalogue()

  if (shown === undefined || evidenceId === undefined) {
    const gone = page.error instanceof RequestRefused && page.error.status === 404

    return (
      <Screen>
        <PageHead title={gone ? 'Nicht gefunden' : 'Nachweis'} crumbs={[dutyRegisterPlace]} />
        <Empty>
          {gone
            ? evidencePageWords.notThere
            : page.isError
              ? evidencePageWords.failed
              : page.fetchStatus === 'paused'
                ? evidencePageWords.noConnection
                : evidencePageWords.loading}
        </Empty>
      </Screen>
    )
  }

  const { state } = shown
  const byId = (records: readonly RecordState[], id: string | null) =>
    id === null ? null : (records.find((record) => record['id'] === id) ?? null)
  const property = byId(properties, shown.place.propertyId)
  const room = byId(rooms, shown.place.roomId)
  const crumbs = property
    ? placePath(
        placeAbove({
          property,
          building: byId(buildings, shown.place.buildingId),
          floor: room ? byId(floors, String(room['floorId'])) : null,
          room,
          asset: byId(assets, shown.place.assetId),
        }),
        officePlaces,
      )
    : [dutyRegisterPlace]
  const open = shown.standing === 'counts' || shown.standing === 'does_not_meet'
  const voided = shown.voiding !== null
  const sub = [
    state.place.asset === null
      ? null
      : [state.place.asset.number, state.place.asset.name].filter(Boolean).join(' '),
    state.place.building?.name,
  ]
    .filter(Boolean)
    .join(', ')
  const performer =
    state.performer === null
      ? null
      : 'examiner' in state.performer
        ? `${state.performer.examiner}, ${state.performer.organisation}`
        : state.performer.person
  const facts: Fact[] = [
    { label: 'Nummer', value: <span className="numeric">{state.number}</span> },
    {
      label: 'Herkunft',
      value:
        state.activity === null
          ? evidenceOriginLabel[state.origin]
          : `${evidenceOriginLabel[state.origin]}: ${state.activity.title}`,
    },
    {
      label: 'Pflicht',
      value: (
        <Link to={dutyPlaces.duty(shown.dutyId)} className={factLink}>
          {state.duty.label}
        </Link>
      ),
    },
    { label: 'Quelle', value: state.duty.source },
    {
      label: 'Frist',
      value: `${intervalWords(state.duty.interval)}, ${lowerFirst(countingLabel[state.duty.counting])}`,
    },
    { label: 'Ort', value: placeWords(state.place) },
    ...(state.place.asset === null
      ? []
      : [
          {
            label: 'Anlage',
            value: [
              [state.place.asset.number, state.place.asset.name].filter(Boolean).join(' '),
              state.place.asset.kindLabel,
              state.place.asset.serialNumber === null
                ? null
                : `Seriennummer ${state.place.asset.serialNumber}`,
            ]
              .filter(Boolean)
              .join(', '),
          },
        ]),
    {
      label: state.origin === 'report' ? 'Geprüft' : 'Durchgeführt',
      value: [`am ${date(state.performedOn)}`, performer === null ? null : `von ${performer}`]
        .filter(Boolean)
        .join(' '),
    },
    { label: 'Ergebnis', value: <ResultMark result={state.result} /> },
    ...(state.resultReason === null ? [] : [{ label: 'Grund', value: state.resultReason }]),
    // A state written before the fourth version says nothing of a remark.
    ...((state.remark ?? null) === null ? [] : [{ label: 'Bemerkung', value: state.remark }]),
    ...(state.replaces === null
      ? []
      : [
          {
            label: 'Berichtigt',
            value: (
              <span>
                {shown.replaces === null ? (
                  state.replaces.number
                ) : (
                  <Link to={evidencePlaces.evidence(shown.replaces.id)} className={factLink}>
                    {state.replaces.number}
                  </Link>
                )}
                : {state.replaces.reason}
              </span>
            ),
          },
        ]),
    ...(state.files.length === 0
      ? []
      : [
          {
            label: 'Belege',
            value: (
              <span className="flex flex-col gap-0.5">
                {state.files.map((file, position) => (
                  <a
                    key={`${String(position)} ${file.sha256}`}
                    href={evidenceFilePath(shown.id, position)}
                    target="_blank"
                    rel="noopener"
                    className={factLink}
                  >
                    {file.name}
                  </a>
                ))}
              </span>
            ),
          },
        ]),
    { label: 'Aufbewahrung', value: retentionWords(state.retention) },
  ]
  const appointment = duty.data?.appointment ?? null

  return (
    <Screen>
      <PageHead
        title={state.duty.label}
        crumbs={crumbs}
        phoneBack={{ to: dutyPlaces.duty(shown.dutyId), label: state.duty.label }}
        sub={sub === '' ? undefined : sub}
        badges={
          <>
            <NumberBadge>{state.number}</NumberBadge>
            {voided ? (
              <StandingMark standing="voided" />
            ) : (
              <>
                <Status tone="locked">Festgeschrieben</Status>
                <ResultMark result={state.result} />
                {shown.standing === 'replaced' ? <StandingMark standing="replaced" /> : null}
              </>
            )}
          </>
        }
        actions={
          keeps && open ? (
            <>
              <Button
                icon={Pencil}
                onClick={() => {
                  setDoing('correct')
                }}
              >
                Berichtigen
              </Button>
              <Button
                tone="danger"
                icon={Ban}
                onClick={() => {
                  setDoing('void')
                }}
              >
                Für ungültig erklären
              </Button>
            </>
          ) : null
        }
      />
      <div className="grid items-start gap-3.5 lg:grid-cols-[minmax(0,1fr)_310px]">
        <div className="flex min-w-0 flex-col gap-3.5">
          {shown.voiding === null ? null : (
            <NoteBox tone="conflict" icon={Ban}>
              Für ungültig erklärt am {moment(shown.voiding.voidedAt)} von {shown.voiding.voidedBy}.
              Grund: {shown.voiding.reason} {evidencePageWords.countsNoMore}
            </NoteBox>
          )}
          {shown.replacedBy === null ? null : (
            <NoteBox>
              Berichtigt mit{' '}
              <Link to={evidencePlaces.evidence(shown.replacedBy.id)} className={factLink}>
                {shown.replacedBy.number}
              </Link>
              . Für die Frist zählt die Berichtigung; dieser Nachweis bleibt, wie er ist.
            </NoteBox>
          )}
          <Panel
            title={`Eingefrorener Stand, Fassung ${String(state.version)}`}
            action={
              <span className="text-[12px] text-ink-muted">
                festgeschrieben am {moment(state.writtenAt)} von {state.writtenBy}
              </span>
            }
          >
            <FactList keyWidth={110} facts={facts} />
          </Panel>
          {voided ? (
            <History page={shown} />
          ) : state.signatures.length > 0 ? (
            <Panel title="Unterschriften">
              <ul className="flex flex-col">
                {state.signatures.map((signature) => (
                  <li
                    key={`${signature.role}-${signature.signedAt}`}
                    className="border-b border-row py-2.5 leading-[1.4] last:border-b-0"
                  >
                    <div className="font-condensed text-[12px] font-semibold tracking-[1px] text-ink-faint uppercase">
                      {signatureRoleLabel[signature.role]}
                    </div>
                    <div className="text-[14px] font-semibold">{signature.name}</div>
                    <div className="text-[13px] text-ink-muted">{moment(signature.signedAt)}</div>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : state.replaces === null || !originsFromAnActivity.includes(state.origin) ? null : (
            <Panel title="Unterschriften">
              <p className="text-[13px] leading-[1.4] text-ink-muted">
                {evidencePageWords.signedOnTheReplaced}
              </p>
            </Panel>
          )}
          <Panel title="Fingerabdruck des Nachweises">
            <div className="flex flex-col gap-2">
              <p className="text-[12px] leading-[1.45] text-ink-muted">
                {evidencePageWords.fingerprint}
              </p>
              <code className="font-mono text-[12px] break-all text-ink">{shown.fingerprint}</code>
            </div>
          </Panel>
        </div>
        <div className="flex min-w-0 flex-col gap-3.5">
          {state.defects.length === 0 ? null : (
            <Panel title={state.defects.length === 1 ? 'Mangel daraus' : 'Mängel daraus'}>
              <ul className="flex flex-col gap-2.5">
                {state.defects.map((defect, index) => (
                  <li key={index} className="leading-[1.35]">
                    <div className="text-[14px] font-medium">{defect.description}</div>
                    <div className="text-[12px] text-ink-muted">
                      {[
                        // The state keeps the key of the class; its word comes
                        // from the catalogue, and the key stands where there is none.
                        defect.defectClass === null
                          ? null
                          : (catalogue?.defectClass(defect.defectClass)?.defectClass.label ??
                            defect.defectClass),
                        defect.dueOn === null ? null : `Frist ${date(defect.dueOn)}`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          <Panel title="Für die Frist">
            <FactList
              keyWidth={96}
              facts={[
                { label: 'Dieser', value: <StandingMark standing={shown.standing} /> },
                ...(seesDuties
                  ? [
                      {
                        label: 'Termin jetzt',
                        value:
                          duty.data === undefined
                            ? null
                            : appointment === null
                              ? 'keiner'
                              : date(appointment.dueOn),
                      },
                      ...(duty.data?.lastMetOn === null || duty.data === undefined
                        ? []
                        : [{ label: 'Gezählt ab', value: date(duty.data.lastMetOn) }]),
                    ]
                  : []),
              ]}
            />
          </Panel>
          <Panel title="Unveränderlich">
            <p className="text-[12px] leading-[1.45] text-ink-muted">
              {voided ? evidencePageWords.unchangeableVoided : evidencePageWords.unchangeable}
            </p>
          </Panel>
        </div>
      </div>
      {doing === 'correct' ? (
        <CorrectEvidenceDialog
          page={shown}
          sub={sub}
          onClose={() => {
            setDoing(null)
          }}
        />
      ) : null}
      {doing === 'void' ? (
        <VoidEvidenceDialog
          page={shown}
          sub={sub}
          onClose={() => {
            setDoing(null)
          }}
        />
      ) : null}
    </Screen>
  )
}

/**
 * "Verlauf" of an evidence declared invalid, as the board "Nachweis für
 * ungültig erklärt (2.6)" draws it:
 * the signatures, the moment it was written down and the declaration, all
 * of them as the evidence and the declaration say.
 */
function History({ page }: { readonly page: EvidencePage }) {
  const { state, voiding } = page
  const rows = [
    ...state.signatures.map((signature) => ({
      at: signature.signedAt,
      what: signatureRoleLabel[signature.role],
      who: signature.name,
      strong: false,
    })),
    { at: state.writtenAt, what: 'Festgeschrieben', who: state.writtenBy, strong: false },
    ...(voiding === null
      ? []
      : [
          {
            at: voiding.voidedAt,
            what: 'Für ungültig erklärt, mit Grund',
            who: voiding.voidedBy,
            strong: true,
          },
        ]),
  ]

  return (
    <TablePanel
      title="Verlauf"
      caption="Verlauf des Nachweises: Unterschriften, Festschreibung und Ungültigerklärung"
      cards={rows.map((row) => ({
        key: `${row.what}-${row.at}`,
        title: row.what,
        sub: `${moment(row.at)} · ${row.who}`,
      }))}
    >
      <thead>
        <tr>
          <Column className="w-[150px] min-w-[140px]">Wann</Column>
          <Column className="min-w-[160px]">Was</Column>
          <Column className="w-[170px] min-w-[140px]">Wer</Column>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={`${row.what}-${row.at}`}>
            <Cell className={row.strong ? 'font-semibold' : ''}>{moment(row.at)}</Cell>
            <Cell className={row.strong ? 'font-semibold text-conflict' : ''}>{row.what}</Cell>
            <Cell>{row.who}</Cell>
          </tr>
        ))}
      </tbody>
    </TablePanel>
  )
}

/**
 * After a correction or a declaration of invalidity what was read of the
 * duty, its evidence and its asset is read again: the state of the duty, its
 * appointment and the condition of the asset follow from the evidence.
 */
async function readAgain(queries: ReturnType<typeof useQueryClient>): Promise<void> {
  await queries.invalidateQueries({ queryKey: ['evidence'] })
  await queries.invalidateQueries({ queryKey: ['duties'] })
  queries.removeQueries({ queryKey: ['assets'] })
}

/**
 * "Nachweis berichtigen", `berichtigen()` of the boards (ADR 0004, point
 * 14): why, and the corrected day and result, with the examiner of a report.
 * A new evidence comes about that names this one, and the page of the new
 * one opens. Asked of the route, with a connection.
 */
export function CorrectEvidenceDialog({
  page,
  sub,
  onClose,
}: {
  readonly page: EvidencePage
  readonly sub: string
  readonly onClose: () => void
}) {
  const client = useSync()
  const queries = useQueryClient()
  const navigate = useNavigate()
  const { state } = page
  const report = state.origin === 'report'
  const [reason, setReason] = useState('')
  const [performedOn, setPerformedOn] = useState<string>(state.performedOn)
  const [result, setResult] = useState<string>(state.result)
  const [resultReason, setResultReason] = useState(state.resultReason ?? '')
  const [examiner, setExaminer] = useState(
    state.performer !== null && 'examiner' in state.performer ? state.performer.examiner : '',
  )
  const [organisation, setOrganisation] = useState(
    state.performer !== null && 'examiner' in state.performer ? state.performer.organisation : '',
  )
  const [problems, setProblems] = useState<Readonly<Record<string, string>>>({})
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const filled = (value: string) => (value.trim() === '' ? null : value.trim())

  async function save() {
    const values = {
      reason: reason.trim(),
      performedOn: performedOn === '' ? null : performedOn,
      result,
      resultReason: result === 'not_performed' ? filled(resultReason) : null,
      examiner: report ? filled(examiner) : null,
      examinerOrganisation: report ? filled(organisation) : null,
    }
    const wrong = correctionProblems(values, state.origin, today())

    setProblems(wrong)
    setTrouble(null)

    if (Object.keys(wrong).length > 0) {
      return
    }

    setWorking(true)

    try {
      const made = await makeAt(client, `/evidence/${page.id}/correction`, values)

      if (made.outcome === 'refused') {
        setTrouble(refusalFor(made))

        return
      }

      await readAgain(queries)
      onClose()
      await navigate({ to: evidencePlaces.evidence(made.id) })
    } finally {
      setWorking(false)
    }
  }

  return (
    <Dialog
      title="Nachweis berichtigen"
      width={640}
      onClose={onClose}
      sub={[`${state.number} ${state.duty.label}`, sub].filter(Boolean).join(', ')}
    >
      <form
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <TextArea
          label="Was falsch ist"
          rows={3}
          required
          starred
          maxLength={evidenceLimits.replacementReason}
          value={reason}
          hint={evidencePageWords.correctionReasonHint}
          problem={problems['reason']}
          onChange={(event) => {
            setReason(event.target.value)
          }}
        />
        <p className="font-condensed text-[12px] font-semibold tracking-[1.1px] text-ink-faint uppercase">
          Der berichtigte Stand
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Tag der Durchführung"
            type="date"
            required
            value={performedOn}
            problem={problems['performedOn']}
            onChange={(event) => {
              setPerformedOn(event.target.value)
            }}
          />
          <SelectField
            label="Ergebnis"
            value={result}
            options={evidenceResults.map((each) => ({
              value: each,
              label: evidenceResultLabel[each],
            }))}
            problem={problems['result']}
            onChange={setResult}
          />
          {result === 'not_performed' ? (
            <div className="sm:col-span-2">
              <Field
                label="Warum nicht durchgeführt"
                required
                maxLength={evidenceLimits.resultReason}
                value={resultReason}
                problem={problems['resultReason']}
                onChange={(event) => {
                  setResultReason(event.target.value)
                }}
              />
            </div>
          ) : null}
          {report ? (
            <>
              <Field
                label="Prüfer"
                required
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
                maxLength={evidenceLimits.examinerOrganisation}
                value={organisation}
                problem={problems['examinerOrganisation']}
                onChange={(event) => {
                  setOrganisation(event.target.value)
                }}
              />
            </>
          ) : null}
        </div>
        <NoteBox>
          Es entsteht ein neuer Nachweis, der {state.number} ersetzt. Beide bleiben lesbar; für die
          Frist zählt der neue.
        </NoteBox>
        {trouble ? (
          <p role="alert" className="text-[13px] font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}
        <DialogActions>
          <Button type="button" disabled={working} onClick={onClose}>
            Abbrechen
          </Button>
          <Button type="submit" tone="primary" icon={Lock} disabled={working}>
            {working ? 'Einen Moment' : 'Berichtigung festschreiben'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

/**
 * "Nachweis für ungültig erklären", as its board draws it (ADR 0004, point
 * 15): with the reason; the person and the moment are the
 * server's. The page shows the declaration afterwards. Asked of the route,
 * with a connection, and not taken back.
 */
export function VoidEvidenceDialog({
  page,
  sub,
  onClose,
}: {
  readonly page: EvidencePage
  readonly sub: string
  readonly onClose: () => void
}) {
  const client = useSync()
  const queries = useQueryClient()
  const { state } = page
  const [reason, setReason] = useState('')
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  async function save() {
    const wrong = statedReasonProblem(
      reason,
      evidenceLimits.voidingReason,
      'Eine Ungültigerklärung nennt ihren Grund.',
    )

    setProblem(wrong)
    setTrouble(null)

    if (wrong !== undefined) {
      return
    }

    setWorking(true)

    try {
      const result = await askAt(client, 'POST', `/evidence/${page.id}/voiding`, page.id, {
        reason: reason.trim(),
      })

      if (result.outcome === 'refused') {
        setTrouble(refusalFor(result))

        return
      }

      await readAgain(queries)
      onClose()
    } finally {
      setWorking(false)
    }
  }

  return (
    <Dialog
      title="Nachweis für ungültig erklären"
      width={520}
      onClose={onClose}
      sub={[`${state.number} ${state.duty.label}`, sub].filter(Boolean).join(', ')}
    >
      <form
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <TextArea
          label="Grund"
          rows={3}
          required
          starred
          maxLength={evidenceLimits.voidingReason}
          value={reason}
          hint={evidencePageWords.voidingReasonHint}
          problem={problem}
          onChange={(event) => {
            setReason(event.target.value)
          }}
        />
        <NoteBox tone="conflict" icon={Ban}>
          {evidencePageWords.whatVoidingDoes}
        </NoteBox>
        {trouble ? (
          <p role="alert" className="text-[13px] font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}
        <DialogActions>
          <Button type="button" disabled={working} onClick={onClose}>
            Abbrechen
          </Button>
          <Button type="submit" tone="danger" icon={Ban} disabled={working}>
            {working ? 'Einen Moment' : 'Für ungültig erklären'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
