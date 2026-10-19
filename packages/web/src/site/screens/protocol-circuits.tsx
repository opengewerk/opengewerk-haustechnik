import {
  type AnswersContext,
  answerValue,
  type ChartedCircuit,
  circuitProtectionWords,
  distributionBoardKindLabel,
  type FormSection,
  type GroupField,
  type RecordState,
  statedCircuitWords,
} from '@opengewerk/haustechnik-domain'
import { Button, Panel } from '@opengewerk/platform-web'
import { AnswerMark } from '@opengewerk/platform-web/forms'
import { useRight } from '@opengewerk/platform-web/session'
import {
  SiteActionBar,
  SiteHeader,
  SiteRow,
  SiteRows,
  SiteScreen,
  SiteText,
} from '@opengewerk/platform-web/site'
import { maybeText, text, useRecord, useRecords } from '@opengewerk/platform-web/sync'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { Check, ChevronLeft, ChevronRight, Plus, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'

import { answerAt, filledOf, type FormPoint, pointState, pointVerdict } from '../../app/answers.js'
import { circuitBlockState, circuitStateWords } from '../../app/circuit-blocks.js'
import { structureWords } from '../../app/electrical.js'
import { DefectNote } from '../../app/form-points.js'
import { NotOffered, NotOnDevice } from '../kit.js'
import { siteForms, sitePlaces, siteStructure } from '../places.js'
import { FormButton } from './boards-block.js'
import { siteFormWords, Unshowable, useActivityForm, useWhere } from './form.js'

/**
 * The measurements per circuit of an electrical installation on site (#350,
 * the boards "Prüfung: Messen je Stromkreis", "Prüfung: der Block eines
 * Stromkreises" and "Prüfung: Messen, solange die Anlage keinen Stromkreis
 * hat"): in the protocol, the circuits of the installation board by board in
 * the order of the chart, each as its card with how far its block is; and the
 * block of one circuit with its points, each of which opens on its own
 * screen. There is no "Block hinzufügen": every circuit has its block, and the
 * key of the block is the id of the circuit. Fetched with the protocol that
 * has such a group, to keep the entry on site under its budget.
 */

export const circuitWords = {
  lead: 'Je Stromkreis der Anlage ein Block, in der Reihenfolge des Stromkreisverzeichnisses.',
  none: 'Die Messungen je Stromkreis brauchen die Stromkreise aus den Verteilern der Anlage. Sie hat noch keinen.',
  takeBoards: 'Verteiler aufnehmen',
  toBoards: 'Zu den Verteilern',
  thereAfter: 'Ein Stromkreis, der dort aufgenommen wird, steht danach hier, auch ohne Netz.',
  done: (done: number, total: number) => `${String(done)} von ${String(total)} fertig`,
  outside: 'außerhalb des Grenzwerts',
  notOk: 'nicht in Ordnung',
  noLimit: 'Ohne Grenzwert.',
  notHere: 'Diesen Stromkreis hat die Anlage dieses Vorgangs nicht.',
  toCircuit: (designation: string) => `Zu ${designation}`,
  onTo: (designation: string) => `Weiter zu ${designation}`,
  becomes: (label: string, target: string, designation: string) =>
    `Mit der Unterschrift wird aus „${label}“ ein Mangel an ${target}, mit dem Stromkreis ${designation} im Bezug.`,
} as const

/** The groups over the circuits in a section of a form. */
function circuitGroupsOf(section: FormSection): readonly GroupField[] {
  return section.fields.filter(
    (field): field is GroupField => field.kind === 'group' && field.repeat === 'circuits',
  )
}

/** The points of the block of one circuit in a group, in the order of the form. */
function blockOf(
  points: readonly FormPoint[],
  group: GroupField,
  circuitId: string,
): readonly FormPoint[] {
  return points.filter((point) => point.group?.key === group.key && point.blockKey === circuitId)
}

/** A designation on slate, as it is printed in the cabinet and on the card of the circuit. */
function Designation({
  children,
  large = false,
}: {
  readonly children: string
  readonly large?: boolean
}) {
  return (
    <span
      className={`shrink-0 rounded-[4px] bg-top px-2 py-[3px] font-condensed font-semibold text-top-ink ${large ? 'text-[19px]' : 'text-[17px]'}`}
    >
      {children}
    </span>
  )
}

/** What the state of a block says under its card: how far it is, and a finding in it. */
function StateLine({
  words,
  outside,
  notOk,
}: {
  readonly words: string
  readonly outside: boolean
  readonly notOk: boolean
}) {
  return (
    <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[15px] leading-[1.35]">
      <span
        className={
          words === 'fertig'
            ? 'inline-flex items-center gap-[5px] font-semibold text-done'
            : words === 'noch offen'
              ? 'text-ink-muted'
              : 'font-semibold text-waiting tabular-nums'
        }
      >
        {words === 'fertig' ? <Check size={16} strokeWidth={2.6} aria-hidden="true" /> : null}
        {words}
      </span>
      {outside || notOk ? (
        <span className="inline-flex items-center gap-[5px] font-semibold text-conflict">
          <TriangleAlert size={16} strokeWidth={2.4} aria-hidden="true" />
          {outside ? circuitWords.outside : circuitWords.notOk}
        </span>
      ) : null}
    </span>
  )
}

/**
 * The section of the protocol with a group over the circuits: the circuits
 * of the installation of the activity board by board, each as a card that
 * opens its block, and how many of them are done; without a circuit, what the
 * measurements need and the way to the boards of the installation, for
 * whoever takes stock of assets. The points of the section outside the group
 * stand above, as the protocol draws them.
 */
export function CircuitsSection({
  activityId,
  assetId,
  section,
  points,
  answers,
  context,
  circuits,
  children,
}: {
  readonly activityId: string
  readonly assetId: string | null
  readonly section: FormSection
  readonly points: readonly FormPoint[]
  readonly answers: readonly RecordState[]
  readonly context: AnswersContext
  readonly circuits: readonly ChartedCircuit[] | null
  readonly children?: ReactNode
}) {
  const records = useRight('asset.record')
  const boards = useRecords('distribution_boards').filter(
    (board) => board['assetId'] === assetId && (board['deletedAt'] ?? null) === null,
  )
  const filledAt = (point: FormPoint) => {
    const record = answerAt(answers, point)

    return record === undefined ? undefined : filledOf(record)
  }
  const shown = circuits ?? []
  const states = new Map(
    circuitGroupsOf(section).flatMap((group) =>
      shown.map((circuit) => [
        `${group.key}.${circuit.id}`,
        circuitBlockState(blockOf(points, group, circuit.id), filledAt, context),
      ]),
    ),
  )
  const doneOf = (group: GroupField, among: readonly ChartedCircuit[]) =>
    among.filter((circuit) => states.get(`${group.key}.${circuit.id}`)?.done === true).length
  const groups = circuitGroupsOf(section)
  const byBoard: {
    board: string
    kind: ChartedCircuit['boardKind']
    circuits: ChartedCircuit[]
  }[] = []

  for (const circuit of shown) {
    const last = byBoard.at(-1)

    if (last !== undefined && last.board === circuit.board) {
      last.circuits.push(circuit)
    } else {
      byBoard.push({ board: circuit.board, kind: circuit.boardKind, circuits: [circuit] })
    }
  }

  return (
    <Panel
      title={section.title}
      action={
        shown.length === 0 || groups[0] === undefined ? undefined : (
          <span className="text-[15px] text-ink-muted tabular-nums">
            {circuitWords.done(doneOf(groups[0], shown), shown.length)}
          </span>
        )
      }
    >
      {children}
      {groups.map((group) =>
        shown.length === 0 ? (
          <div key={group.key} className="flex flex-col gap-3 py-1">
            <SiteText>{circuitWords.none}</SiteText>
            {records && assetId !== null ? (
              <>
                {boards.length === 0 ? (
                  <FormButton to={siteStructure.newBoard(assetId)} icon={Plus}>
                    {circuitWords.takeBoards}
                  </FormButton>
                ) : (
                  <FormButton to={sitePlaces.asset(assetId)} icon={ChevronRight}>
                    {circuitWords.toBoards}
                  </FormButton>
                )}
                <SiteText muted>{circuitWords.thereAfter}</SiteText>
              </>
            ) : null}
          </div>
        ) : (
          <div key={group.key} className="flex flex-col gap-2 py-1">
            <p className="text-[15px] leading-[1.4] text-ink-muted">{circuitWords.lead}</p>
            {byBoard.map((board) => (
              <section key={board.board} aria-label={board.board} className="flex flex-col gap-2">
                <div className="mt-1.5 flex items-baseline gap-2">
                  <h3 className="m-0 text-[19px] font-bold">{board.board}</h3>
                  <span className="grow text-[15px] text-ink-muted">
                    {distributionBoardKindLabel[board.kind]}
                  </span>
                  <span className="text-[15px] text-ink-muted tabular-nums">
                    {circuitWords.done(doneOf(group, board.circuits), board.circuits.length)}
                  </span>
                </div>
                <ul aria-label={`${group.label}, ${board.board}`} className="flex flex-col gap-2">
                  {board.circuits.map((circuit) => {
                    const state = states.get(`${group.key}.${circuit.id}`)
                    const protection = circuitProtectionWords(circuit)
                    const finding = state !== undefined && (state.outside || state.notOk)

                    return (
                      <li key={circuit.id}>
                        <Link
                          to={siteForms.circuit(activityId, circuit.id)}
                          className={`flex min-h-16 items-center gap-2.5 rounded-[6px] border bg-surface px-3 py-2.5 text-ink no-underline ${finding ? 'border-line border-l-4 border-l-conflict' : 'border-line'}`}
                        >
                          <Designation>{circuit.designation}</Designation>{' '}
                          <span className="min-w-0 grow">
                            <span className="block text-[17px] font-semibold [overflow-wrap:anywhere]">
                              {circuit.consumer ?? circuit.designation}
                            </span>
                            <span
                              className={`mt-0.5 block text-[15px] leading-[1.35] ${protection === null ? 'text-waiting' : 'text-ink-muted'}`}
                            >
                              {protection ?? structureWords.nothingKnown}
                            </span>
                            {state === undefined ? null : (
                              <StateLine
                                words={circuitStateWords(state)}
                                outside={state.outside}
                                notOk={state.notOk}
                              />
                            )}
                          </span>
                          <ChevronRight
                            size={20}
                            strokeWidth={2.2}
                            aria-hidden="true"
                            className="shrink-0 text-ink-faint"
                          />
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}
          </div>
        ),
      )}
    </Panel>
  )
}

/**
 * The block of one circuit, the board "Prüfung: der Block eines
 * Stromkreises": the circuit with what protects it and where it hangs, its
 * points with the verdict of each value against the limit worked out of the
 * circuit, each opening its own screen, what the signature makes of a
 * finding, and the way to the circuit before and after it on the chart.
 */
export function SiteCircuitBlockScreen() {
  const { activityId, circuitId } = useParams({ strict: false }) as {
    activityId: string
    circuitId: string
  }
  const navigate = useNavigate()
  const form = useActivityForm(activityId, [])
  const where = useWhere(form.activity)
  const asset = useRecord('assets', maybeText(form.activity, 'assetId') ?? undefined)
  const section = useRecord(
    'board_sections',
    maybeText(useRecord('circuits', circuitId), 'boardSectionId') ?? undefined,
  )
  const protocol =
    text(form.activity, 'kind') === 'work_order'
      ? siteForms.protocol(activityId)
      : siteForms.form(activityId)

  if (form.activity === null) {
    return <NotOnDevice what="Diesen Vorgang" back={{ to: '/', label: 'Zum Start' }} />
  }

  const title = text(form.activity, 'title')
  const back = { to: protocol, label: 'Zurück zum Protokoll' }

  if (!form.definition || form.context === null) {
    return (
      <Unshowable
        title={title}
        back={back}
        catalogue={form.catalogue}
        definition={form.definition}
      />
    )
  }

  const circuits = form.circuits ?? []
  const at = circuits.findIndex((circuit) => circuit.id === circuitId)
  const circuit = circuits[at]
  const ofForm = form.definition.sections.flatMap((each) =>
    circuitGroupsOf(each).map((group) => ({ section: each, group })),
  )
  const found = ofForm[0]

  if (circuit === undefined || found === undefined) {
    return (
      <NotOffered title={title} back={back}>
        {circuitWords.notHere}
      </NotOffered>
    )
  }

  const context = form.context
  const filledAt = (point: FormPoint) => {
    const record = answerAt(form.answers, point)

    return record === undefined ? undefined : filledOf(record)
  }
  const points = blockOf(form.points, found.group, circuit.id)
  const state = circuitBlockState(points, filledAt, context)
  const before = circuits[at - 1]
  const after = circuits[at + 1]
  const target = maybeText(asset, 'number') ?? where.words
  const protection = circuitProtectionWords(circuit)
  const place = [circuit.board, maybeText(section, 'designation')].filter(Boolean).join(', ')

  return (
    <>
      <SiteHeader
        title={found.section.title}
        sub={[title, maybeText(asset, 'number')].filter(Boolean).join(', ')}
        back={back}
      />
      <SiteScreen gap={14}>
        <div className="flex items-center gap-3">
          <Designation large>{circuit.designation}</Designation>{' '}
          <div className="min-w-0">
            <h2 className="text-[22px] leading-[1.25] font-bold [overflow-wrap:anywhere]">
              {circuit.consumer ?? statedCircuitWords(circuit)}
            </h2>
            <p className="mt-0.5 text-[15px] text-ink-muted">
              {[protection ?? structureWords.nothingKnown, place].join(' · ')}
            </p>
          </div>
        </div>
        {form.open ? null : <SiteText muted>{siteFormWords.closed}</SiteText>}
        <Panel
          title={found.group.label}
          action={
            <span className="text-[15px] text-ink-muted tabular-nums">
              {`${String(state.answered)} von ${String(state.counted)}`}
            </span>
          }
        >
          <SiteRows label={found.group.label}>
            {points.map((point) => {
              const given = filledAt(point)
              const verdict =
                point.field.kind === 'measurement'
                  ? pointVerdict({ ...point, field: point.field }, given ?? emptyAnswer, context)
                  : null
              const written = given === undefined ? undefined : answerValue(point.field, given)
              const said =
                point.field.kind === 'text'
                  ? typeof written === 'string'
                    ? written
                    : null
                  : verdict === null
                    ? null
                    : point.field.kind === 'measurement' && point.field.limit === undefined
                      ? circuitWords.noLimit
                      : verdict.text

              return (
                <SiteRow
                  key={point.key}
                  to={siteForms.point(activityId, point.key)}
                  title={point.field.label}
                  meta={
                    said === null ? undefined : verdict?.within === false ? (
                      <span className="font-semibold text-conflict">{said}</span>
                    ) : (
                      said
                    )
                  }
                  right={<AnswerMark state={pointState(point, given, context)} />}
                />
              )
            })}
          </SiteRows>
        </Panel>
        {points.flatMap((point) => {
          const shown = pointState(point, filledAt(point), context)

          return (shown.kind === 'value' && shown.outside === true) ||
            (shown.kind === 'result' && shown.result === 'not_ok')
            ? [
                <DefectNote key={point.key}>
                  {circuitWords.becomes(point.field.label, target, circuit.designation)}
                </DefectNote>,
              ]
            : []
        })}
      </SiteScreen>
      <SiteActionBar>
        <div className="min-w-0 flex-1">
          <Button
            wide
            height={60}
            icon={ChevronLeft}
            onClick={() => {
              void navigate({ to: before ? siteForms.circuit(activityId, before.id) : protocol })
            }}
          >
            {before ? circuitWords.toCircuit(before.designation) : siteFormWords.back}
          </Button>
        </div>
        <div className="min-w-0 flex-[2]">
          <Button
            tone="primary"
            wide
            height={60}
            onClick={() => {
              void navigate({ to: after ? siteForms.circuit(activityId, after.id) : protocol })
            }}
          >
            {after ? circuitWords.onTo(after.designation) : siteFormWords.overview}
          </Button>
        </div>
      </SiteActionBar>
    </>
  )
}

/** An answer with nothing in it, to ask the limit of a field before there is a value. */
const emptyAnswer = { value: null, result: null, remark: null, attachmentId: null }
