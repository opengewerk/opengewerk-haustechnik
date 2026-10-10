import {
  activityLimits,
  activityProblems,
  answerVerdict,
  type CheckPointResult,
  checkPointResultLabel,
  type FilledAnswer,
  type IsoDate,
  type LimitContext,
  roundClosable,
  type RoundDetails,
  type RoundSignature,
  type RoundState,
  roundStateLabel,
  signatureLimits,
  weekdayLabel,
  weekdayOf,
  weekNumberOf,
  weekOf,
} from '@opengewerk/haustechnik-domain'
import {
  Button,
  Cell,
  Column,
  Dialog,
  DialogActions,
  Panel,
  Status,
  type StatusTone,
  TablePanel,
  TextArea,
} from '@opengewerk/platform-web'
import { date, moment, today } from '@opengewerk/platform-web/format'
import {
  ChangesButton,
  Empty,
  FactList,
  NoteBox,
  PageHead,
  Screen,
} from '@opengewerk/platform-web/office'
import { useRight, useWho } from '@opengewerk/platform-web/session'
import {
  maybeText,
  refusalFor,
  request,
  RequestRefused,
  useRecords,
  useSync,
} from '@opengewerk/platform-web/sync'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import { Ban, Check, Clock, type LucideIcon, PenLine, Signature, X } from 'lucide-react'
import { Fragment, useState } from 'react'

import { type FormPoint, pointsOf, pointState } from '../../app/answers.js'
import { dutyNameOf, fulfilledDuty, useFormOf } from '../../app/form-of.js'
import { PhotoThumb } from '../../app/form-points.js'
import { roundPdfAddress } from '../../app/prints.js'
import {
  type GivenSignature,
  SignatureMark,
  SignatureWays,
  typedWay,
} from '../../app/signature-ways.js'
import { fingerprintOf } from '../../app/signing.js'
import { useCatalogue } from '../../sync/catalogue.js'
import { askAt } from '../../sync/made-at.js'
import { defectPlaces } from '../defect-addresses.js'
import { factLink } from '../links.js'
import { usePdf } from '../pdf-button.js'
import { dutyPlaces, evidencePlaces } from '../duty-addresses.js'
import { roundsPlace, weekPlace } from '../round-template-addresses.js'
import { DefectStatusMark } from './defects.js'

/**
 * A round in the office, the boards "Rundgang abgegeben, Gegenzeichnung"
 * (4.5, 2.6) and "Offenen Rundgang mit Grund schließen" (4.5) of #115: the
 * page that was signed with its answers, the signature, the countersignature
 * where the template asks for one, the duties its points fulfil and the
 * defects that came of its answers.
 *
 * Read from the server, which works the page out as it was signed. The
 * answers of a round nobody has signed yet are the work of whoever walks it
 * and stand here only once it is signed. Whoever countersigns rounds gives
 * the countersignature here, for the page as it is shown, with a connection;
 * whoever plans closes a round of a past day with the reason.
 */

export const roundWords = {
  notThere: 'Diesen Rundgang gibt es nicht oder nicht mehr.',
  failed: 'Der Rundgang ist gerade nicht zu laden. Die Seite braucht eine Verbindung.',
  loading: 'Der Rundgang wird geladen.',
  version: (version: number) => `Fassung ${String(version)} der Vorlage`,
  notHandedIn:
    'Der Rundgang ist noch nicht abgegeben. Seine Antworten stehen hier, sobald er unterschrieben ist.',
  notSigned: 'Noch nicht unterschrieben.',
  notPerformed:
    'Der Rundgang erfüllt keine Pflicht; was er erfüllen sollte, bleibt fällig. Wer ihn geschlossen hat, steht im Änderungsprotokoll.',
  unknownForm:
    'Das Formular dieses Rundgangs kennt dieses Gerät noch nicht. Es kommt mit dem nächsten Abgleich.',
  nothingSaid: 'keine Angabe',
  fulfils: (duty: string) => `erfüllt die Pflicht „${duty}“`,
  staysDue: (duty: string) => `die Pflicht „${duty}“ bleibt fällig`,
  becameDefect: 'wurde mit der Unterschrift ein Mangel',
  counterIntro:
    'Mit Ihrer Unterschrift bestätigen Sie die Antworten, wie sie hier stehen. Erst dann entstehen die Nachweise.',
  counterWaits: 'Wartet auf die Gegenzeichnung der Objektleitung.',
  counterAfter: 'Gegengezeichnet wird, sobald der Rundgang unterschrieben ist.',
  counterClosed: 'Entfällt, der Rundgang wurde nicht durchgeführt.',
  pad: 'Feld für die Gegenzeichnung',
  countersign: 'Gegenzeichnen',
  noPath: 'Bitte im Feld unterschreiben oder ohne Schriftzug mit dem eigenen Namen bestätigen.',
  void: 'gilt nicht mehr',
  noDuties: 'Kein Punkt dieses Rundgangs erfüllt eine Pflicht.',
  dutyWritten: (number: string) => `${number}, erfüllt`,
  dutyWithCounter: 'wird mit der Gegenzeichnung erfüllt',
  dutyWithSignature: 'wird mit der Unterschrift erfüllt',
  dutyNotMet: 'nicht durchgeführt, Grund im Punkt',
  dutyStaysDue: 'nicht erfüllt, bleibt fällig',
  noDefects: 'Aus diesem Rundgang ist kein Mangel entstanden.',
  withoutClass: 'Klasse noch nicht vergeben',
  close: 'Schließen mit Grund',
  closeTitle: 'Rundgang als nicht durchgeführt schließen',
  closeHint: 'Steht am Rundgang und im Änderungsprotokoll.',
  closeNote:
    'Der Rundgang bleibt sichtbar, als nicht durchgeführt mit Grund. Er erfüllt keine Pflicht; was er erfüllen sollte, bleibt fällig.',
} as const

/** The page of one round, read again after a countersignature or a closing. */
export function roundQuery(id: string) {
  return {
    queryKey: ['rounds', 'round', id],
    queryFn: () => request<RoundDetails>(`/rounds/${id}`),
  } as const
}

/** How a state of a round looks at the head of its page. */
const stateLooks: Readonly<Record<RoundState, { tone: StatusTone; icon: LucideIcon }>> = {
  open: { tone: 'neutral', icon: Clock },
  started: { tone: 'waiting', icon: PenLine },
  awaiting_countersignature: { tone: 'waiting', icon: Clock },
  submitted: { tone: 'done', icon: Check },
  not_performed: { tone: 'neutral', icon: Ban },
}

/** "Montag, 05.10.2026": the day of a round. */
export function roundDate(dueOn: IsoDate): string {
  return `${weekdayLabel[weekdayOf(dueOn)]}, ${date(dueOn)}`
}

/** "Montag, 05.10.2026, Woche 41": the day of a round and its week. */
export function roundDay(dueOn: IsoDate): string {
  return `${roundDate(dueOn)}, Woche ${String(weekNumberOf(dueOn))}`
}

export function RoundScreen() {
  const { roundId } = useParams({ strict: false }) as { roundId?: string }
  const page = useQuery({ ...roundQuery(roundId ?? ''), enabled: roundId !== undefined })
  const plans = useRight('activity.write')
  const [closing, setClosing] = useState(false)
  const shown = page.data
  const pdf = usePdf(roundPdfAddress(roundId ?? ''), `Rundgang ${shown?.title ?? ''}`)

  if (shown === undefined || roundId === undefined) {
    const gone = page.error instanceof RequestRefused && page.error.status === 404

    return (
      <Screen>
        <PageHead
          title={gone ? 'Nicht gefunden' : 'Rundgang'}
          crumbs={[roundsPlace]}
          phoneBack={roundsPlace}
        />
        <Empty>
          {gone ? roundWords.notThere : page.isError ? roundWords.failed : roundWords.loading}
        </Empty>
      </Screen>
    )
  }

  const look = stateLooks[shown.state]
  const closable = plans && roundClosable(shown, today() as IsoDate)
  const week =
    shown.dueOn === null
      ? []
      : [
          {
            to: weekPlace(weekOf(shown.dueOn)),
            label: `Woche ${String(weekNumberOf(shown.dueOn))}`,
          },
        ]

  return (
    <Screen>
      <PageHead
        title={shown.title}
        crumbs={[roundsPlace, ...week]}
        phoneBack={roundsPlace}
        sub={[
          shown.dueOn === null ? null : roundDay(shown.dueOn),
          shown.formVersion === null ? null : roundWords.version(shown.formVersion),
        ]
          .filter(Boolean)
          .join(', ')}
        badges={
          <>
            {shown.state === 'awaiting_countersignature' ? (
              <Status tone="waiting" icon={Signature}>
                Unterschrieben
              </Status>
            ) : null}
            <Status tone={look.tone} icon={look.icon}>
              {roundStateLabel[shown.state]}
            </Status>
          </>
        }
        actions={
          <>
            {/* The PDF is made of the state frozen when the round was written down. */}
            {shown.status === 'done' ? pdf.button : null}
            <ChangesButton table="activities" id={shown.id} />
            {closable ? (
              <Button
                icon={Ban}
                onClick={() => {
                  setClosing(true)
                }}
              >
                {roundWords.close}
              </Button>
            ) : null}
          </>
        }
      />
      <div className="grid items-start gap-3.5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-3.5">
          {shown.status === 'not_performed' ? (
            <Panel title="Nicht durchgeführt">
              <FactList facts={[{ label: 'Grund', value: shown.closingReason }]} />
              <NoteBox>{roundWords.notPerformed}</NoteBox>
            </Panel>
          ) : null}
          {pdf.trouble}
          <Answers round={shown} />
        </div>
        <div className="flex min-w-0 flex-col gap-3.5">
          <Panel title="Unterschrift">
            <Signatures
              signatures={shown.signatures.filter((each) => each.role === 'signer')}
              none={roundWords.notSigned}
            />
          </Panel>
          {shown.countersignatureRequired ? <Countersignature round={shown} /> : null}
          <Duties round={shown} />
          <Defects round={shown} />
        </div>
      </div>
      {closing ? (
        <CloseRoundDialog
          key={shown.id}
          round={shown}
          onClose={() => {
            setClosing(false)
          }}
        />
      ) : null}
    </Screen>
  )
}

/** The points of the form of a round as they were signed, chapter by chapter. */
function usePoints(round: RoundDetails) {
  const definition = useFormOf(round.formKey, round.formVersion)
  const catalogue = useCatalogue()
  const answers: readonly FilledAnswer[] = round.page?.answers ?? []
  const points = definition ? pointsOf(definition, answers) : []
  const answerOf = (point: FormPoint) =>
    answers.find(
      (answer) =>
        answer.fieldKey === point.field.key &&
        answer.groupKey === (point.group?.key ?? null) &&
        answer.blockKey === point.blockKey,
    )
  const context: LimitContext | null =
    catalogue === null ? null : { rules: catalogue.ruleSet, on: round.performedOn ?? today() }

  return { definition, points, answerOf, context }
}

/** A point by its label, in a block of a group with the group and the number of the block. */
function labelOf(point: FormPoint): string {
  return point.group === null
    ? point.field.label
    : `${point.group.label} ${String(point.block)}: ${point.field.label}`
}

/** Whether an answer leaves the duty of its point due: "nicht möglich" and "entfällt" fulfil nothing. */
function leavesDue(answer: FilledAnswer | undefined): boolean {
  return answer?.result === 'not_possible' || answer?.result === 'not_applicable'
}

/** "Antworten": every point with its answer and what was said with it. */
function Answers({ round }: { readonly round: RoundDetails }) {
  const { definition, points, answerOf, context } = usePoints(round)
  const duties = useRecords('duties')
  const catalogue = useCatalogue()

  if (round.page === null) {
    return round.status === 'not_performed' ? null : (
      <Panel title="Antworten">
        <Empty>{roundWords.notHandedIn}</Empty>
      </Panel>
    )
  }

  if (!definition || context === null) {
    return (
      <Panel title="Antworten">
        <Empty>{roundWords.unknownForm}</Empty>
      </Panel>
    )
  }

  const sections = [...new Set(points.map((point) => point.section))]
  const dutyName = (dutyId: string) => {
    const duty = duties.find((each) => each['id'] === dutyId)

    return (duty ? dutyNameOf(duty, catalogue) : null) ?? 'Pflicht'
  }
  // What is said under an answer: the duty it fulfils or leaves due, and the defect it became.
  const notesOf = (point: FormPoint, answer: FilledAnswer | undefined): string[] => {
    const duty = fulfilledDuty(point.field)

    return [
      duty === null
        ? null
        : leavesDue(answer)
          ? roundWords.staysDue(dutyName(duty))
          : roundWords.fulfils(dutyName(duty)),
      isFinding(point, answer, context) ? roundWords.becameDefect : null,
    ].filter((note) => note !== null)
  }

  return (
    <TablePanel
      title="Antworten"
      caption="Die Antworten des Rundgangs, wie er unterschrieben wurde"
      // On a phone each point is a card: its chapter and what was said under it, the answer beside it.
      cards={points.map((point) => {
        const answer = answerOf(point)

        return {
          key: point.key,
          title: labelOf(point),
          sub: [point.section.title, saidWith(point, answer, context), ...notesOf(point, answer)]
            .filter(Boolean)
            .join(' · '),
          right: <AnswerCell point={point} answer={answer} context={context} />,
        }
      })}
    >
      <thead>
        <tr>
          <Column className="w-[220px]">Punkt</Column>
          <Column className="w-[130px]">Antwort</Column>
          <Column>Bemerkung</Column>
        </tr>
      </thead>
      <tbody>
        {sections.map((section) => (
          <Fragment key={section.key}>
            {sections.length > 1 || section.title ? (
              <tr>
                <Cell colSpan={3}>
                  <span className="font-semibold">{section.title}</span>
                </Cell>
              </tr>
            ) : null}
            {points
              .filter((point) => point.section === section)
              .map((point) => {
                const answer = answerOf(point)
                const notes = notesOf(point, answer)

                return (
                  <tr key={point.key}>
                    <Cell>{labelOf(point)}</Cell>
                    <Cell>
                      <AnswerCell point={point} answer={answer} context={context} />
                    </Cell>
                    <Cell>
                      <div className="leading-[1.4]">
                        <div>{saidWith(point, answer, context)}</div>
                        {notes.map((note) => (
                          <div key={note} className="mt-0.5 text-[12px] text-ink-faint">
                            {note}
                          </div>
                        ))}
                      </div>
                    </Cell>
                  </tr>
                )
              })}
          </Fragment>
        ))}
      </tbody>
    </TablePanel>
  )
}

/** How each result of a check point is marked, as `answer()` of the boards. */
const resultLooks: Readonly<
  Record<CheckPointResult, { readonly tone: StatusTone; readonly icon: LucideIcon }>
> = {
  ok: { tone: 'done', icon: Check },
  not_ok: { tone: 'conflict', icon: X },
  not_possible: { tone: 'neutral', icon: Ban },
  not_applicable: { tone: 'neutral', icon: Ban },
}

/** "nicht in Ordnung" as a marker begins it: "Nicht in Ordnung". */
function capitalised(words: string): string {
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** The answer of a point: a result in its tone, a value in bold, a photo as a small picture. */
function AnswerCell({
  point,
  answer,
  context,
}: {
  readonly point: FormPoint
  readonly answer: FilledAnswer | undefined
  readonly context: LimitContext
}) {
  const state = pointState(point, answer, context)

  if (state.kind === 'open') {
    return <span className="text-disabled">{roundWords.nothingSaid}</span>
  }

  if (state.kind === 'result') {
    const look = resultLooks[state.result]

    return (
      <Status tone={look.tone} icon={look.icon}>
        {capitalised(checkPointResultLabel[state.result])}
      </Status>
    )
  }

  if (point.field.kind === 'photo' && answer?.attachmentId) {
    return <PhotoThumb attachmentId={answer.attachmentId} label={point.field.label} />
  }

  return (
    <span
      className={
        state.outside === true
          ? 'font-semibold text-conflict tabular-nums'
          : 'font-semibold tabular-nums'
      }
    >
      {state.text}
    </span>
  )
}

/** What was said with an answer: the remark, the text of a text point, or how a value stands against its limit. */
function saidWith(
  point: FormPoint,
  answer: FilledAnswer | undefined,
  context: LimitContext,
): string {
  if (answer === undefined) {
    return ''
  }

  if (answer.remark !== null) {
    return answer.remark
  }

  if (point.field.kind === 'text') {
    return answer.value ?? ''
  }

  if (point.field.kind === 'measurement' && answer.value !== null) {
    return answerVerdict(point.field, answer, context).text
  }

  return ''
}

/** Whether an answer became a defect with the signature: "nicht in Ordnung", or a value outside its limit. */
function isFinding(
  point: FormPoint,
  answer: FilledAnswer | undefined,
  context: LimitContext,
): boolean {
  if (answer === undefined) {
    return false
  }

  if (answer.result === 'not_ok') {
    return true
  }

  return (
    point.field.kind === 'measurement' &&
    answer.value !== null &&
    answerVerdict(point.field, answer, context).within === false
  )
}

/** Signatures with their drawings, who gave them and when. */
function Signatures({
  signatures,
  none,
}: {
  readonly signatures: readonly RoundSignature[]
  readonly none: string
}) {
  if (signatures.length === 0) {
    return <p className="text-[13px] leading-[1.45] text-ink-muted">{none}</p>
  }

  return (
    <ul className="flex flex-col gap-3">
      {signatures.map((signature) => (
        <li key={signature.id} className="flex items-center gap-3">
          <div className="w-[150px] shrink-0 rounded-control border border-line bg-surface p-1 max-sm:w-[120px]">
            <SignatureMark
              name={signature.name}
              path={signature.path}
              typedName={signature.typedName}
            />
          </div>
          <div className="min-w-0 leading-[1.4]">
            <div className="font-semibold">{signature.name}</div>
            <div className="text-[13px] text-ink-muted">
              {`${moment(signature.signedAt)}${typedWay(signature.typedName)}`}
            </div>
            {signature.valid ? null : (
              <div className="text-[13px] font-semibold text-conflict">{roundWords.void}</div>
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}

/**
 * "Gegenzeichnung": the one given, or for whoever countersigns rounds the
 * field to give it in, for the page as it is shown. Its fingerprint goes
 * with it, and the server takes it only for the page it works out itself.
 */
function Countersignature({ round }: { readonly round: RoundDetails }) {
  const accepts = useRight('activity.accept')
  const who = useWho()
  const client = useSync()
  const queries = useQueryClient()
  const [given, setGiven] = useState<GivenSignature | null>(null)
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const countersigned = round.signatures.filter((each) => each.role === 'countersigner')

  if (countersigned.length > 0) {
    return (
      <Panel title="Gegenzeichnung">
        <Signatures signatures={countersigned} none="" />
      </Panel>
    )
  }

  if (round.state !== 'awaiting_countersignature' || round.page === null) {
    return (
      <Panel title="Gegenzeichnung">
        <p className="text-[13px] leading-[1.45] text-ink-muted">
          {round.status === 'not_performed' ? roundWords.counterClosed : roundWords.counterAfter}
        </p>
      </Panel>
    )
  }

  if (!accepts) {
    return (
      <Panel title="Gegenzeichnung">
        <p className="text-[13px] leading-[1.45] text-ink-muted">{roundWords.counterWaits}</p>
      </Panel>
    )
  }

  const page = round.page

  async function countersign() {
    if (given === null) {
      setTrouble(roundWords.noPath)

      return
    }

    setTrouble(null)
    setWorking(true)

    try {
      const result = await askAt(client, 'POST', `/rounds/${round.id}/countersignature`, round.id, {
        path: given.path,
        typedName: given.typedName,
        pageFingerprint: await fingerprintOf(page),
        deviceInfo: globalThis.navigator.userAgent.slice(0, signatureLimits.deviceInfo),
      })

      if (result.outcome === 'refused') {
        setTrouble(refusalFor(result))

        return
      }

      await queries.invalidateQueries({ queryKey: ['rounds'] })
    } finally {
      setWorking(false)
    }
  }

  return (
    <Panel title="Gegenzeichnung">
      <div className="flex flex-col gap-2.5">
        <p className="text-[13px] leading-[1.45] text-ink-muted">{roundWords.counterIntro}</p>
        <SignatureWays label={roundWords.pad} name={who.name} onChange={setGiven} />
        {who.name === '' ? null : <p className="text-[13px] font-semibold">{who.name}</p>}
        {trouble ? (
          <p role="alert" className="text-[13px] font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}
        <div className="flex justify-end">
          <Button
            tone="primary"
            icon={Signature}
            disabled={working}
            onClick={() => {
              void countersign()
            }}
          >
            {working ? 'Einen Moment' : roundWords.countersign}
          </Button>
        </div>
      </div>
    </Panel>
  )
}

/** "Pflichten aus diesem Rundgang": each duty a point fulfils, and how it stands by this round. */
function Duties({ round }: { readonly round: RoundDetails }) {
  const { points, answerOf } = usePoints(round)
  const duties = useRecords('duties')
  const catalogue = useCatalogue()
  const fulfilling = points.flatMap((point) => {
    const dutyId = fulfilledDuty(point.field)

    return dutyId === null ? [] : [{ dutyId, answer: answerOf(point) }]
  })

  if (fulfilling.length === 0) {
    return null
  }

  const standing = (dutyId: string, answer: FilledAnswer | undefined) => {
    const evidence = round.evidence.find((each) => each.dutyId === dutyId)

    if (evidence !== undefined) {
      return {
        text: roundWords.dutyWritten(evidence.number),
        to: evidencePlaces.evidence(evidence.id),
      }
    }

    if (round.status === 'not_performed') {
      return { text: roundWords.dutyStaysDue, to: null }
    }

    if (round.page !== null && leavesDue(answer)) {
      return { text: roundWords.dutyNotMet, to: null }
    }

    return {
      text: round.countersignatureRequired
        ? roundWords.dutyWithCounter
        : roundWords.dutyWithSignature,
      to: null,
    }
  }

  return (
    <Panel title="Pflichten aus diesem Rundgang">
      <ul className="flex flex-col gap-[9px]">
        {fulfilling.map(({ dutyId, answer }) => {
          const duty = duties.find((each) => each['id'] === dutyId)
          const stands = standing(dutyId, answer)

          return (
            <li key={dutyId} className="leading-[1.35]">
              <Link to={dutyPlaces.duty(dutyId)} className={factLink}>
                {(duty ? dutyNameOf(duty, catalogue) : null) ?? 'Pflicht'}
              </Link>
              <div className="text-[12px] text-ink-faint">
                {stands.to === null ? (
                  stands.text
                ) : (
                  <Link to={stands.to} className={factLink}>
                    {stands.text}
                  </Link>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}

/** "Mangel daraus": the defects that came of the answers with the signature. */
function Defects({ round }: { readonly round: RoundDetails }) {
  const catalogue = useCatalogue()
  const rooms = useRecords('rooms')
  const assets = useRecords('assets')

  if (round.page === null) {
    return null
  }

  const where = (defect: RoundDetails['defects'][number]) => {
    const asset = assets.find((each) => each['id'] === defect.assetId)
    const room = rooms.find((each) => each['id'] === defect.roomId)

    return asset
      ? (maybeText(asset, 'name') ?? 'Anlage')
      : room
        ? `Raum ${[maybeText(room, 'number'), maybeText(room, 'name')].filter(Boolean).join(' ')}`
        : null
  }

  return (
    <Panel title={round.defects.length > 1 ? 'Mängel daraus' : 'Mangel daraus'}>
      {round.defects.length === 0 ? (
        <p className="text-[13px] leading-[1.45] text-ink-muted">{roundWords.noDefects}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {round.defects.map((defect) => (
            <li key={defect.id} className="flex flex-col gap-1.5 leading-[1.35]">
              <Link to={defectPlaces.defect(defect.id)} className={factLink}>
                {defect.description}
              </Link>
              <span className="text-[12px] text-ink-faint">
                {[
                  where(defect),
                  defect.defectClass === null
                    ? roundWords.withoutClass
                    : (catalogue?.defectClass(defect.defectClass)?.defectClass.label ??
                      defect.defectClass),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              <span>
                <DefectStatusMark status={defect.status} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

/**
 * "Rundgang als nicht durchgeführt schließen", the board "Offenen Rundgang
 * mit Grund schließen" (4.5): a round of a past day that is open or begun,
 * closed with the reason by whoever plans. It stays readable and fulfils
 * nothing; what it was to fulfil stays due. Asked of the route, with a
 * connection, and not taken back.
 */
export function CloseRoundDialog({
  round,
  sub,
  onClose,
}: {
  readonly round: Pick<RoundDetails, 'id' | 'title' | 'dueOn'>
  readonly sub?: string
  readonly onClose: () => void
}) {
  const client = useSync()
  const queries = useQueryClient()
  const [reason, setReason] = useState('')
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  async function save() {
    const values = { closingReason: reason.trim() }
    const wrong = activityProblems({ status: 'not_performed', ...values })['closingReason']

    setProblem(wrong)
    setTrouble(null)

    if (wrong !== undefined) {
      return
    }

    setWorking(true)

    try {
      const result = await askAt(client, 'POST', `/rounds/${round.id}/close`, round.id, values)

      if (result.outcome === 'refused') {
        setTrouble(refusalFor(result))

        return
      }

      // The week and the page are read again.
      await queries.invalidateQueries({ queryKey: ['rounds'] })
      onClose()
    } finally {
      setWorking(false)
    }
  }

  return (
    <Dialog
      title={roundWords.closeTitle}
      width={520}
      onClose={onClose}
      sub={[round.title, round.dueOn === null ? null : roundDate(round.dueOn), sub]
        .filter(Boolean)
        .join(', ')}
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
          maxLength={activityLimits.closingReason}
          value={reason}
          hint={roundWords.closeHint}
          problem={problem}
          onChange={(event) => {
            setReason(event.target.value)
          }}
        />
        <NoteBox>{roundWords.closeNote}</NoteBox>
        {trouble ? (
          <p role="alert" className="text-[13px] font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}
        <DialogActions>
          <Button type="button" disabled={working} onClick={onClose}>
            Abbrechen
          </Button>
          <Button type="submit" tone="primary" icon={Check} disabled={working}>
            {working ? 'Einen Moment' : 'Schließen'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
