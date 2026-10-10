import {
  activityLimits,
  answeredField,
  answerFindings,
  answersMissing,
  type EvidenceResult,
  evidenceLimits,
  evidenceResultLabel,
  finishesWorkOrder,
  type RecordState,
  resultAgainstFindings,
} from '@opengewerk/haustechnik-domain'
import { Button, Field, Panel } from '@opengewerk/platform-web'
import { clockTime, today } from '@opengewerk/platform-web/format'
import { accountQuery, useRight, useWho } from '@opengewerk/platform-web/session'
import {
  SiteActionBar,
  SiteHeader,
  SiteRow,
  SiteRows,
  SiteScreen,
  SiteText,
  SiteTrouble,
} from '@opengewerk/platform-web/site'
import {
  maybeText,
  refusalFor,
  text,
  useRecord,
  useRelated,
  useSync,
} from '@opengewerk/platform-web/sync'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from '@tanstack/react-router'
import { Check, ChevronLeft, Plus, Signature } from 'lucide-react'
import { useCallback, useId, useMemo, useRef, useState } from 'react'

import { answerAt, beginActivity, filledOf, type FormPoint, lackOf } from '../../app/answers.js'
import { useDeferredWrite } from '../../app/form-points.js'
import { offeredResults, resultNotes } from '../../app/results.js'
import { type GivenSignature, SignatureWays } from '../../app/signature-ways.js'
import { signActivity } from '../../app/signing.js'
import { NotOnDevice, PlainRow } from '../kit.js'
import { siteForms } from '../places.js'
import { siteFormWords, useActivityForm, useWhere } from './form.js'

export const resultWords = {
  title: 'Ergebnis',
  day: 'Tag der Prüfung',
  result: 'Ergebnis',
  reason: 'Warum nicht durchgeführt',
  remark: 'Bemerkung',
  remarkHint: 'Steht mit dem Ergebnis im Nachweis.',
  optional: 'freiwillig',
  withoutDefectsWhileFound: 'Nicht, solange das Protokoll einen Mangel festhält.',
  defects: 'Mängel',
  noDefect: 'Noch kein Mangel festgehalten.',
  addDefect: 'Mangel hinzufügen',
  notOk: 'Nicht in Ordnung, wird mit der Unterschrift ein Mangel',
  outside: 'Außerhalb des Grenzwerts, wird mit der Unterschrift ein Mangel',
  reported: 'Gemeldet',
  missing: 'Noch ohne Antwort:',
  noRemark: 'Die Bemerkung fehlt',
  noReason: 'Der Grund fehlt',
  signature: 'Unterschrift',
  pad: 'Feld für die Unterschrift',
  sign: 'Unterschreiben',
  signNote: 'Mit der Unterschrift entsteht der Nachweis, der Termin rückt weiter.',
  orderNote: 'Danach wartet der Auftrag auf die Abnahme durch die Objektleitung.',
  onlyResponsible: 'Abschließen kann einen Auftrag nur, wer ihn führt.',
  toOrder: 'Zurück zum Auftrag',
  missingNote:
    'Unterschrieben wird, wenn jeder Pflichtpunkt eine Antwort hat. „Entfällt“ und „nicht möglich“ sind Antworten, mit Grund.',
  signed: 'Unterschrieben',
  waits: 'Mit der Übertragung entsteht der Nachweis, und der Termin rückt weiter.',
  written: 'Der Nachweis ist entstanden, und der Termin rückt weiter.',
  signedAt: (at: string, sent: boolean) =>
    `unterschrieben um ${at}, ${sent ? 'übertragen' : 'wartet auf die Übertragung'}`,
  found: 'Festgestellt',
  fixed: 'Die Prüfung lässt sich jetzt nicht mehr ändern. Was falsch ist, wird im Büro berichtigt.',
  toPlace: 'Zurück',
} as const

/** Whether a record is there and not marked. */
function live(record: RecordState): boolean {
  return record['deletedAt'] === null || record['deletedAt'] === undefined
}

/** A defect of the protocol in the list "Mängel": what it is and where it comes from. */
interface FoundLine {
  readonly key: string
  readonly title: string
  readonly meta: string
}

/**
 * The four results as the board draws them on site: a card each, large enough
 * for a thumb, with what picking it means under its name. The choice of the
 * office is the same group of radio buttons at the size of a desk.
 */
function ResultCards({
  value,
  onChange,
  noteOf,
  disabled,
}: {
  readonly value: EvidenceResult | null
  readonly onChange: (result: EvidenceResult) => void
  readonly noteOf: (result: EvidenceResult) => string | undefined
  readonly disabled: boolean
}) {
  const id = useId()

  return (
    <fieldset className="flex min-w-0 flex-col gap-2" disabled={disabled}>
      <legend className="sr-only">{resultWords.result}</legend>
      {offeredResults.map((each) => {
        const picked = each === value
        const note = noteOf(each)

        return (
          <label
            key={each}
            className={`flex min-h-14 items-start gap-3 rounded-[6px] bg-surface px-3.5 py-3 ${
              picked ? 'border-2 border-ink' : 'border border-control'
            } ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
          >
            <input
              type="radio"
              name={id}
              checked={picked}
              aria-labelledby={`${id}-${each}`}
              aria-describedby={note === undefined ? undefined : `${id}-${each}-note`}
              className="mt-px size-[22px] shrink-0 accent-copper-solid"
              onChange={() => {
                onChange(each)
              }}
            />
            <span className="min-w-0">
              <span id={`${id}-${each}`} className="block text-[17px] font-semibold">
                {evidenceResultLabel[each]}
              </span>
              {note === undefined ? null : (
                <span
                  id={`${id}-${each}-note`}
                  className="mt-0.5 block text-[15px] leading-[1.35] text-ink-muted"
                >
                  {note}
                </span>
              )}
            </span>
          </label>
        )
      })}
    </fieldset>
  )
}

/**
 * The result of an inspection or a maintenance on site, with the signature,
 * the board "Prüfung: Ergebnis und Unterschrift (4.4)" (#108): the day it was
 * performed, the result of its duties, a remark, the defects the signature
 * makes of its answers beside those reported in it, and the signature for
 * the page as it stands. An activity without a form has nothing but this.
 *
 * What is chosen and typed is on the device at once, as every answer is.
 * Signing waits until every point that asks for an answer has one, and
 * "ohne Mangel" is not signed while the protocol holds a defect: the server
 * would refuse both. Once signed, nothing here changes any more; the server
 * writes the evidence when the signature arrives.
 */
export function SiteResultScreen() {
  const { activityId } = useParams({ strict: false }) as { activityId: string }

  // Keyed by the activity, so that what it starts from is read once.
  return <ResultOf key={activityId} activityId={activityId} />
}

function ResultOf({ activityId }: { readonly activityId: string }) {
  const client = useSync()
  const navigate = useNavigate()
  const who = useWho()
  const me = useQuery(accountQuery).data?.userId ?? ''
  const reports = useRight('defect.report')
  const form = useActivityForm(activityId, [])
  const where = useWhere(form.activity)
  const asset = useRecord('assets', maybeText(form.activity, 'assetId') ?? undefined)
  const lines = useRelated('activity_duties', 'activityId', activityId).filter(live)
  const reported = useRelated('defects', 'foundInActivityId', activityId).filter(
    (defect) => live(defect) && maybeText(defect, 'foundInAnswerId') === null,
  )
  // The signature that counts, the latest; one the office turned back on a
  // work order counts no more (`useActivityForm`, #118).
  const signatures = useRelated('activity_signatures', 'activityId', activityId)
  const signature = form.signed
    ? signatures
        .filter((each) => each['role'] === 'signer')
        .sort((left, right) => (text(left, 'signedAt') < text(right, 'signedAt') ? 1 : -1))[0]
    : undefined
  const first = lines[0]
  const [chosen, setChosen] = useState<EvidenceResult | null>(
    (maybeText(first, 'result') as EvidenceResult | null) ?? null,
  )
  const [reason, setReason] = useState(maybeText(first, 'resultReason') ?? '')
  const [remark, setRemark] = useState(maybeText(first, 'remark') ?? '')
  const [given, setGiven] = useState<GivenSignature | null>(null)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const queue = useRef<Promise<void>>(Promise.resolve())

  /** One write after the other, the activity begun before the first; what went wrong is said. */
  const enqueue = useCallback(
    (write: () => Promise<string | null>) => {
      queue.current = queue.current.then(async () => {
        const problem = (await beginActivity(client, activityId)) ?? (await write())

        if (problem !== null) {
          setTrouble(problem)
        }
      })

      return queue.current
    },
    [client, activityId],
  )
  // Every duty of the activity takes the result, looked up at the moment of
  // writing, as an answer is (`saveAnswer`).
  const writeLines = useCallback(
    (change: Readonly<Record<string, unknown>>) =>
      enqueue(async () => {
        const held = client
          .list('activity_duties')
          .filter((line) => line['activityId'] === activityId && live(line))

        for (const line of held) {
          const done = await client.update('activity_duties', String(line['id']), change)

          if (done.outcome === 'refused') {
            return refusalFor(done)
          }
        }

        return null
      }),
    [enqueue, client, activityId],
  )
  const reasonWrite = useDeferredWrite((typed: string) => {
    if (chosen === 'not_performed' && typed.trim() !== '') {
      void writeLines({ result: 'not_performed', resultReason: typed.trim() })
    }
  })
  const remarkWrite = useDeferredWrite((typed: string) => {
    void writeLines({ remark: typed.trim() === '' ? null : typed.trim() })
  })
  const filled = useMemo(() => form.answers.map(filledOf), [form.answers])

  if (form.activity === null || form.context === null) {
    return <NotOnDevice what="Diesen Vorgang" back={{ to: '/', label: 'Zum Start' }} />
  }

  const activity = form.activity
  const context = form.context
  const definition = form.definition ?? null
  const findings = definition === null ? [] : answerFindings(definition, filled, context)
  const found: readonly FoundLine[] = [
    ...findings.map((finding) => {
      const field = definition === null ? null : answeredField(definition, finding.answer)?.field

      return {
        key: `${finding.answer.groupKey ?? ''}.${finding.answer.blockKey ?? ''}.${finding.answer.fieldKey}`,
        title: field?.label ?? finding.description,
        meta: field?.kind === 'measurement' ? resultWords.outside : resultWords.notOk,
      }
    }),
    ...reported.map((defect) => ({
      key: String(defect['id']),
      title: text(defect, 'description'),
      meta: resultWords.reported,
    })),
  ]
  const filledAt = (point: FormPoint) => {
    const record = answerAt(form.answers, point)

    return record === undefined ? undefined : filledOf(record)
  }
  /** What a point still lacks before the signature, in a word, or null (`lackOf`). */
  const lacking = (point: FormPoint): string | null => {
    const lack = lackOf(point, filledAt(point), context)

    return lack === null
      ? null
      : lack === 'answer'
        ? point.section.title
        : lack === 'remark'
          ? resultWords.noRemark
          : resultWords.noReason
  }
  const open = form.points.flatMap((point) => {
    const why = lacking(point)

    return why === null ? [] : [{ point, why }]
  })
  const missing = definition === null ? [] : answersMissing(definition, filled, context)
  const contradiction = resultAgainstFindings(chosen, found.length)
  const sub = [text(activity, 'title'), maybeText(asset, 'number')].filter(Boolean).join(', ')
  const performedOn = maybeText(activity, 'performedOn')
  // A work order is finished by the person who leads it (#118), and its
  // protocol and its page stand under it.
  const order = text(activity, 'kind') === 'work_order'
  const finishes =
    me !== '' &&
    finishesWorkOrder(
      { kind: text(activity, 'kind'), responsibleUserId: maybeText(activity, 'responsibleUserId') },
      me,
    )
  const back = form.definition
    ? {
        to: order ? siteForms.protocol(activityId) : siteForms.form(activityId),
        label: 'Zurück zum Protokoll',
      }
    : order
      ? { to: siteForms.form(activityId), label: resultWords.toOrder }
      : where.back
  const done = order ? { to: siteForms.form(activityId), label: resultWords.toOrder } : where.back

  if (signature !== undefined || text(activity, 'status') === 'done') {
    const pending =
      signature !== undefined && client.isPending('activity_signatures', String(signature['id']))
    const signedAt = signature === undefined ? null : maybeText(signature, 'signedAt')

    return (
      <>
        <SiteHeader title={resultWords.title} sub={sub} back={done} />
        <SiteScreen>
          <div className="rounded-[8px] border border-done-edge bg-done-fill px-4 py-5 text-center">
            <span className="inline-flex size-14 items-center justify-center rounded-full bg-done text-on-status">
              <Check size={30} strokeWidth={3} aria-hidden="true" />
            </span>
            <h2 className="mt-2.5 text-[22px] font-bold text-done">{resultWords.signed}</h2>
            <p className="mt-1 text-[16px] leading-[1.4] text-ink">
              {text(activity, 'status') === 'done' ? resultWords.written : resultWords.waits}
            </p>
            {signedAt === null ? null : (
              <p className="mt-1.5 text-[14px] text-ink-muted">
                {resultWords.signedAt(clockTime(new Date(signedAt)), !pending)}
              </p>
            )}
          </div>
          {found.length === 0 ? null : (
            <Panel title={resultWords.found}>
              <ul aria-label={resultWords.found} className="flex flex-col">
                {found.map((line) => (
                  <PlainRow key={line.key} title={line.title} meta={line.meta} />
                ))}
              </ul>
            </Panel>
          )}
          <SiteText muted size={15}>
            {resultWords.fixed}
          </SiteText>
        </SiteScreen>
        <SiteActionBar>
          <Button
            tone="dark"
            wide
            height={60}
            icon={ChevronLeft}
            onClick={() => {
              void navigate({ to: done.to })
            }}
          >
            {done.label}
          </Button>
        </SiteActionBar>
      </>
    )
  }

  const editable = form.editable
  const complete = chosen !== null && (chosen !== 'not_performed' || reason.trim() !== '')
  const canSign =
    editable &&
    finishes &&
    !working &&
    missing.length === 0 &&
    complete &&
    contradiction === null &&
    given !== null

  async function sign() {
    if (given === null) {
      return
    }

    setWorking(true)
    setTrouble(null)

    try {
      reasonWrite.flush()
      remarkWrite.flush()
      await queue.current
      // The day comes with the first input; one opened only to sign has none yet.
      await enqueue(() => Promise.resolve(null))

      const problem = await signActivity(client, activityId, given)

      if (problem !== null) {
        setTrouble(problem)
      }
    } finally {
      setWorking(false)
    }
  }

  return (
    <>
      <SiteHeader title={resultWords.title} sub={sub} back={back} />
      <SiteScreen>
        {form.open ? null : <SiteText muted>{siteFormWords.closed}</SiteText>}
        {form.open && !form.performs ? <SiteText muted>{siteFormWords.mayNot}</SiteText> : null}
        {missing.length === 0 ? null : (
          <Panel>
            <p className="text-[17px] font-semibold">{resultWords.missing}</p>
            {open.length > 0 ? (
              <SiteRows label={resultWords.missing}>
                {open.map(({ point, why }) => (
                  <SiteRow
                    key={point.key}
                    to={siteForms.point(activityId, point.key)}
                    title={point.field.label}
                    meta={why}
                  />
                ))}
              </SiteRows>
            ) : (
              <ul aria-label={resultWords.missing} className="flex flex-col">
                {missing.map((sentence) => (
                  <PlainRow key={sentence} title={sentence} />
                ))}
              </ul>
            )}
          </Panel>
        )}
        <Field
          label={resultWords.day}
          type="date"
          value={performedOn ?? today()}
          max={today()}
          disabled={!editable}
          onChange={(event) => {
            const day = event.target.value

            if (day !== '') {
              void enqueue(async () => {
                const done = await client.update('activities', activityId, { performedOn: day })

                return done.outcome === 'refused' ? refusalFor(done) : null
              })
            }
          }}
        />
        <ResultCards
          value={chosen}
          disabled={!editable}
          noteOf={(each) =>
            each === 'without_defects' && found.length > 0
              ? resultWords.withoutDefectsWhileFound
              : resultNotes[each]
          }
          onChange={(picked) => {
            setChosen(picked)

            if (picked !== 'not_performed') {
              void writeLines({ result: picked, resultReason: null })
            } else if (reason.trim() !== '') {
              void writeLines({ result: picked, resultReason: reason.trim() })
            }
          }}
        />
        {contradiction === null ? null : <SiteTrouble>{contradiction}</SiteTrouble>}
        {chosen === 'not_performed' ? (
          <div onBlur={reasonWrite.flush}>
            <Field
              label={resultWords.reason}
              required
              starred
              maxLength={evidenceLimits.resultReason}
              value={reason}
              disabled={!editable}
              onChange={(event) => {
                setReason(event.target.value)
                reasonWrite.put(event.target.value)
              }}
            />
          </div>
        ) : null}
        <div onBlur={remarkWrite.flush}>
          <Field
            label={resultWords.remark}
            placeholder={resultWords.optional}
            hint={resultWords.remarkHint}
            maxLength={activityLimits.remark}
            value={remark}
            disabled={!editable}
            onChange={(event) => {
              setRemark(event.target.value)
              remarkWrite.put(event.target.value)
            }}
          />
        </div>
        <Panel title={resultWords.defects}>
          {found.length === 0 ? (
            <SiteText muted>{resultWords.noDefect}</SiteText>
          ) : (
            <ul aria-label={resultWords.defects} className="flex flex-col">
              {found.map((line) => (
                <PlainRow key={line.key} title={line.title} meta={line.meta} />
              ))}
            </ul>
          )}
          {editable &&
          reports &&
          (maybeText(activity, 'assetId') !== null || maybeText(activity, 'roomId') !== null) ? (
            <div className="pt-3">
              <Button
                icon={Plus}
                height={48}
                wide
                onClick={() => {
                  void navigate({ to: siteForms.defect(activityId) })
                }}
              >
                {resultWords.addDefect}
              </Button>
            </div>
          ) : null}
        </Panel>
        {editable && finishes ? (
          <div className="flex flex-col gap-1.5">
            <p className="font-condensed text-[15px] font-semibold tracking-[1.2px] text-ink-faint uppercase">
              {resultWords.signature}
            </p>
            <SignatureWays label={resultWords.pad} name={who.name} onChange={setGiven} />
            {who.name === '' ? null : <p className="text-[16px] font-semibold">{who.name}</p>}
          </div>
        ) : null}
        {editable && !finishes ? <SiteText muted>{resultWords.onlyResponsible}</SiteText> : null}
        {trouble ? <SiteTrouble>{trouble}</SiteTrouble> : null}
      </SiteScreen>
      <SiteActionBar
        note={
          missing.length > 0
            ? resultWords.missingNote
            : order
              ? resultWords.orderNote
              : resultWords.signNote
        }
      >
        <Button
          tone="primary"
          wide
          height={60}
          icon={Signature}
          disabled={!canSign}
          onClick={() => {
            void sign()
          }}
        >
          {resultWords.sign}
        </Button>
      </SiteActionBar>
    </>
  )
}
