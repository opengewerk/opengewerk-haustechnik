import {
  type AnswerFinding,
  answerFindings,
  answersMissing,
  type FilledAnswer,
  type RecordState,
} from '@opengewerk/haustechnik-domain'
import { Button, Panel } from '@opengewerk/platform-web'
import { AnswerMark } from '@opengewerk/platform-web/forms'
import { clockTime, date } from '@opengewerk/platform-web/format'
import { useWho } from '@opengewerk/platform-web/session'
import {
  SignaturePad,
  SiteActionBar,
  SiteFacts,
  SiteHeader,
  SiteLabel,
  SiteRow,
  SiteRows,
  SiteScreen,
  SiteText,
  SiteTrouble,
} from '@opengewerk/platform-web/site'
import { maybeText, text, useRelated, useSync } from '@opengewerk/platform-web/sync'
import { useNavigate, useParams } from '@tanstack/react-router'
import { Check, House, Signature } from 'lucide-react'
import { useMemo, useState } from 'react'

import {
  answerAt,
  beginActivity,
  filledOf,
  type FormPoint,
  isAnswered,
  isDemanded,
  lackOf,
  pointState,
} from '../../app/answers.js'
import { signActivity } from '../../app/signing.js'
import { NotOnDevice, PlainRow } from '../kit.js'
import { siteForms } from '../places.js'
import {
  roundSub,
  siteFormWords,
  toStart,
  Unshowable,
  useAboutWords,
  useActivityForm,
  useWhere,
} from './form.js'

export const handInWords = {
  overview: 'Übersicht',
  answered: 'Beantwortet',
  answeredOf: (done: number, total: number, notOk: number) =>
    `${String(done)} von ${String(total)} Punkten${
      notOk === 0 ? '' : `, davon ${String(notOk)} „nicht in Ordnung“`
    }`,
  optionalOpen: 'Freiwillig offen',
  countersignature: 'Gegenzeichnung',
  countersignatureAsked: 'verlangt, durch die Objektleitung',
  countersignatureNone: 'nicht verlangt',
  missing: 'Noch ohne Antwort:',
  pointAt: (section: string, at: number) => `${section}, Punkt ${String(at)}`,
  noRemark: 'Die Bemerkung fehlt',
  noReason: 'Der Grund fehlt',
  rule: 'Abgeben geht erst, wenn jeder Punkt eine Antwort hat. „Entfällt“ und „nicht möglich“ sind Antworten, mit Grund. Das lässt sich nicht abschalten.',
  handIn: 'Abgeben und unterschreiben',
  signTitle: 'Unterschreiben',
  backToHandIn: 'Zurück zur Abgabe',
  whatIsSigned: 'Was Sie unterschreiben',
  follows: 'Daraus folgt',
  noDefect: 'Kein Mangel.',
  oneDefect: (target: string, label: string) => `1 Mangel an ${target}: ${label}.`,
  defects: (count: number, lines: readonly string[]) =>
    `${String(count)} Mängel: ${lines.join('; ')}.`,
  defectLine: (label: string, target: string) => `${label} an ${target}`,
  evidenceLater: 'Die Nachweise entstehen mit der Gegenzeichnung.',
  evidenceNow: 'Mit der Übertragung entstehen die Nachweise.',
  signature: 'Unterschrift',
  pad: 'Feld für die Unterschrift',
  sign: 'Unterschreiben',
  signNote: 'Die Unterschrift gilt für genau diese Seite. Danach ändert niemand mehr etwas daran.',
  handedIn: 'Abgegeben',
  handedInOn: (on: string) => `abgegeben am ${date(on)}`,
  waitsForCountersignature: 'Wartet auf die Gegenzeichnung der Objektleitung.',
  doneOnArrival: 'Mit der Übertragung ist der Rundgang erledigt.',
  done: 'Der Rundgang ist erledigt.',
  signedAt: (at: string, sent: boolean) =>
    `unterschrieben um ${at}, ${sent ? 'übertragen' : 'wartet auf die Übertragung'}`,
  found: 'Festgestellt',
  defectAt: (target: string) => `Mangel an ${target}`,
  fixed:
    'Der Rundgang lässt sich jetzt nicht mehr ändern. Was falsch ist, wird im Büro berichtigt oder für ungültig erklärt.',
  toStart: 'Zum Start',
} as const

function live(record: RecordState): boolean {
  return record['deletedAt'] === null || record['deletedAt'] === undefined
}

/** The point an answer belongs to. */
function pointOf(points: readonly FormPoint[], answer: FilledAnswer): FormPoint | undefined {
  return points.find(
    (point) =>
      point.field.key === answer.fieldKey &&
      (point.group?.key ?? null) === answer.groupKey &&
      point.blockKey === answer.blockKey,
  )
}

/**
 * Everything the three screens of the end of a round read: the round, its
 * points with their answers, the defects the signature makes of them and the
 * signatures the device holds.
 */
function useRoundEnd(activityId: string) {
  const form = useActivityForm(activityId, [])
  const where = useWhere(form.activity)
  const aboutWords = useAboutWords()
  const signatures = useRelated('activity_signatures', 'activityId', activityId)
  const duties = useRelated('activity_duties', 'activityId', activityId).filter(live)
  const filled = useMemo(() => form.answers.map(filledOf), [form.answers])
  const findings: readonly AnswerFinding[] =
    form.definition && form.context ? answerFindings(form.definition, filled, form.context) : []

  /** A defect the signature makes, by its point: what it is called and where it is. */
  const defectOf = (finding: AnswerFinding) => {
    const point = pointOf(form.points, finding.answer)

    return {
      label: point?.field.label ?? finding.description,
      target: (point === undefined ? null : aboutWords(point)) ?? where.words,
      remark: finding.answer.remark?.trim() ?? '',
    }
  }

  return {
    form,
    where,
    filled,
    findings,
    defectOf,
    duties,
    signature: signatures.find((each) => each['role'] === 'signer'),
    countersigned: signatures.some((each) => each['role'] === 'countersigner'),
  }
}

/**
 * The handing in of a round, the board "Abgabe erst vollständig (4.5)": how
 * much is answered, what is optional and open, whether the site management
 * countersigns, and every point that still lacks an answer, or the remark
 * or reason its answer asks for, with the way to it. "Abgeben und
 * unterschreiben" stays grey until nothing lacks; the server refuses a
 * signature for less, so nothing here switches that off.
 *
 * Once the round is signed, here or on another device, the same address
 * says so, the board "Abgegeben, wartet auf Gegenzeichnung (4.5)".
 */
export function RoundHandInScreen() {
  const { activityId } = useParams({ strict: false }) as { activityId: string }

  return <HandInOf key={activityId} activityId={activityId} />
}

function HandInOf({ activityId }: { readonly activityId: string }) {
  const navigate = useNavigate()
  const end = useRoundEnd(activityId)
  const { form, where } = end

  if (form.activity === null) {
    return <NotOnDevice what="Diesen Rundgang" back={toStart} />
  }

  if (!form.definition || form.context === null) {
    return (
      <Unshowable
        title={text(form.activity, 'title')}
        back={toStart}
        catalogue={form.catalogue}
        definition={form.definition}
      />
    )
  }

  if (end.signature !== undefined || ['signed', 'done'].includes(text(form.activity, 'status'))) {
    return <HandedIn activityId={activityId} />
  }

  const context = form.context
  const activity = form.activity
  const filledAt = (point: FormPoint) => {
    const record = answerAt(form.answers, point)

    return record === undefined ? undefined : filledOf(record)
  }
  const answered = form.points.filter((point) => isAnswered(point, filledAt(point)))
  const notOk = answered.filter((point) => filledAt(point)?.result === 'not_ok').length
  const optionalOpen = form.points.filter(
    (point) => !isDemanded(point) && !isAnswered(point, filledAt(point)),
  )
  const lacking = form.points.flatMap((point, index) => {
    const lack = lackOf(point, filledAt(point), context)

    return lack === null ? [] : [{ point, index, lack }]
  })
  const missing = answersMissing(form.definition, end.filled, context)
  const ready = form.editable && lacking.length === 0 && missing.length === 0

  return (
    <>
      <SiteHeader
        title={text(activity, 'title')}
        sub={roundSub(activity, where.words)}
        back={{ to: siteForms.form(activityId), label: 'Zurück zum Rundgang' }}
      />
      <SiteScreen>
        <Panel title={handInWords.overview}>
          <SiteFacts
            facts={[
              {
                label: handInWords.answered,
                value: handInWords.answeredOf(answered.length, form.points.length, notOk),
              },
              ...(optionalOpen.length === 0
                ? []
                : [
                    {
                      label: handInWords.optionalOpen,
                      value: optionalOpen.map((point) => point.field.label).join(', '),
                    },
                  ]),
              {
                label: handInWords.countersignature,
                value:
                  activity['countersignatureRequired'] === true
                    ? handInWords.countersignatureAsked
                    : handInWords.countersignatureNone,
              },
            ]}
          />
        </Panel>
        {lacking.length === 0 && missing.length === 0 ? null : (
          <Panel>
            <p className="text-[17px] font-semibold">{handInWords.missing}</p>
            {lacking.length > 0 ? (
              <SiteRows label={handInWords.missing}>
                {lacking.map(({ point, index, lack }) => (
                  <SiteRow
                    key={point.key}
                    to={siteForms.point(activityId, point.key)}
                    title={point.field.label}
                    meta={
                      lack === 'answer'
                        ? handInWords.pointAt(point.section.title, index + 1)
                        : lack === 'remark'
                          ? handInWords.noRemark
                          : handInWords.noReason
                    }
                  />
                ))}
              </SiteRows>
            ) : (
              <ul aria-label={handInWords.missing} className="flex flex-col">
                {missing.map((sentence) => (
                  <PlainRow key={sentence} title={sentence} />
                ))}
              </ul>
            )}
          </Panel>
        )}
        {form.open && !form.performs ? <SiteText muted>{siteFormWords.mayNot}</SiteText> : null}
        <SiteText muted size={15}>
          {handInWords.rule}
        </SiteText>
      </SiteScreen>
      <SiteActionBar>
        <Button
          tone="primary"
          wide
          height={60}
          icon={Signature}
          disabled={!ready}
          onClick={() => {
            void navigate({ to: siteForms.sign(activityId) })
          }}
        >
          {handInWords.handIn}
        </Button>
      </SiteActionBar>
    </>
  )
}

/**
 * The signature of a round, the board "Unterschrift (4.5, 2.6)": every point
 * with its answer, what follows from them, the field for the drawing and the
 * name of whoever signs. The signature is for exactly this page (ADR 0004,
 * point 7), goes through the outbox, also without a network, and after it
 * nothing here changes any more. Until every point is answered, the address
 * is the handing in, which says what lacks.
 */
export function RoundSignScreen() {
  const { activityId } = useParams({ strict: false }) as { activityId: string }

  return <SignOf key={activityId} activityId={activityId} />
}

function SignOf({ activityId }: { readonly activityId: string }) {
  const client = useSync()
  const navigate = useNavigate()
  const who = useWho()
  const end = useRoundEnd(activityId)
  const { form } = end
  const [path, setPath] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  if (
    form.activity === null ||
    !form.definition ||
    form.context === null ||
    // Signed here or elsewhere, a round is no longer open: the handing in says so.
    !form.editable ||
    answersMissing(form.definition, end.filled, form.context).length > 0
  ) {
    return <HandInOf activityId={activityId} />
  }

  const context = form.context
  const activity = form.activity
  const filledAt = (point: FormPoint) => {
    const record = answerAt(form.answers, point)

    return record === undefined ? undefined : filledOf(record)
  }
  const answered = form.points.filter((point) => isAnswered(point, filledAt(point)))
  const defects = end.findings.map(end.defectOf)
  const found =
    defects.length === 0
      ? handInWords.noDefect
      : defects.length === 1 && defects[0] !== undefined
        ? handInWords.oneDefect(defects[0].target, defects[0].label)
        : handInWords.defects(
            defects.length,
            defects.map((each) => handInWords.defectLine(each.label, each.target)),
          )
  const evidence =
    end.duties.length === 0
      ? null
      : activity['countersignatureRequired'] === true
        ? handInWords.evidenceLater
        : handInWords.evidenceNow

  async function sign() {
    if (path === null) {
      return
    }

    setWorking(true)
    setTrouble(null)

    try {
      // The day comes with the first answer; a round signed without one has none yet.
      const problem =
        (await beginActivity(client, activityId)) ?? (await signActivity(client, activityId, path))

      if (problem === null) {
        void navigate({ to: siteForms.handIn(activityId), replace: true })
      } else {
        setTrouble(problem)
      }
    } finally {
      setWorking(false)
    }
  }

  return (
    <>
      <SiteHeader
        title={handInWords.signTitle}
        sub={text(activity, 'title')}
        back={{ to: siteForms.handIn(activityId), label: handInWords.backToHandIn }}
      />
      <SiteScreen>
        <Panel title={handInWords.whatIsSigned}>
          <ul aria-label={handInWords.whatIsSigned} className="flex flex-col">
            {answered.map((point) => (
              <li
                key={point.key}
                className="flex min-h-[34px] items-center gap-2 border-b border-row py-1 last:border-b-0"
              >
                <span className="min-w-0 grow text-[16px] [overflow-wrap:anywhere]">
                  {point.field.label}
                </span>
                <AnswerMark state={pointState(point, filledAt(point), context)} />
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title={handInWords.follows}>
          <SiteText size={16}>{[found, evidence].filter(Boolean).join(' ')}</SiteText>
        </Panel>
        <div className="flex flex-col gap-1.5">
          <SiteLabel>{handInWords.signature}</SiteLabel>
          <SignaturePad label={handInWords.pad} onChange={setPath} />
          {who.name === '' ? null : (
            <p className="text-[16px] font-semibold">
              {[who.name, who.roles].filter(Boolean).join(', ')}
            </p>
          )}
        </div>
        {trouble ? <SiteTrouble>{trouble}</SiteTrouble> : null}
      </SiteScreen>
      <SiteActionBar note={handInWords.signNote}>
        <Button
          tone="primary"
          wide
          height={60}
          icon={Signature}
          disabled={path === null || working}
          onClick={() => {
            void sign()
          }}
        >
          {handInWords.sign}
        </Button>
      </SiteActionBar>
    </>
  )
}

/**
 * A round that is signed, the board "Abgegeben, wartet auf Gegenzeichnung
 * (4.5)": whether it waits for the countersignature of the site management,
 * when it was signed and whether that has reached the server, and the defects
 * its answers come to. Nothing about it changes on site any more.
 */
function HandedIn({ activityId }: { readonly activityId: string }) {
  const client = useSync()
  const navigate = useNavigate()
  const end = useRoundEnd(activityId)
  const activity = end.form.activity

  if (activity === null) {
    return <NotOnDevice what="Diesen Rundgang" back={toStart} />
  }

  const status = text(activity, 'status')
  const signedAt = end.signature === undefined ? null : maybeText(end.signature, 'signedAt')
  const pending =
    end.signature !== undefined &&
    client.isPending('activity_signatures', String(end.signature['id']))
  const waits =
    activity['countersignatureRequired'] === true && !end.countersigned && status !== 'done'
  const defects = end.findings.map((finding) => ({
    key: `${finding.answer.groupKey ?? ''}.${finding.answer.blockKey ?? ''}.${finding.answer.fieldKey}`,
    ...end.defectOf(finding),
  }))

  return (
    <>
      <SiteHeader
        title={text(activity, 'title')}
        sub={
          signedAt === null
            ? roundSub(activity, end.where.words)
            : handInWords.handedInOn(signedAt.slice(0, 10))
        }
        back={toStart}
      />
      <SiteScreen>
        <div className="rounded-[8px] border border-done-edge bg-done-fill px-4 py-5 text-center">
          <span className="inline-flex size-14 items-center justify-center rounded-full bg-done text-on-status">
            <Check size={30} strokeWidth={3} aria-hidden="true" />
          </span>
          <h2 className="mt-2.5 text-[22px] font-bold text-done">{handInWords.handedIn}</h2>
          <p className="mt-1 text-[16px] leading-[1.4] text-ink">
            {waits
              ? handInWords.waitsForCountersignature
              : status === 'done'
                ? handInWords.done
                : handInWords.doneOnArrival}
          </p>
          {signedAt === null ? null : (
            <p className="mt-1.5 text-[14px] text-ink-muted">
              {handInWords.signedAt(clockTime(new Date(signedAt)), !pending)}
            </p>
          )}
        </div>
        {defects.length === 0 ? null : (
          <Panel title={handInWords.found}>
            <ul aria-label={handInWords.found} className="flex flex-col">
              {defects.map((defect) => (
                <PlainRow
                  key={defect.key}
                  title={defect.remark === '' ? defect.label : defect.remark}
                  meta={handInWords.defectAt(defect.target)}
                />
              ))}
            </ul>
          </Panel>
        )}
        <SiteText muted size={15}>
          {handInWords.fixed}
        </SiteText>
      </SiteScreen>
      <SiteActionBar>
        <Button
          tone="dark"
          wide
          height={60}
          icon={House}
          onClick={() => {
            void navigate({ to: '/' })
          }}
        >
          {handInWords.toStart}
        </Button>
      </SiteActionBar>
    </>
  )
}
