import {
  type AnswerContent,
  answerLimits,
  type AttachmentId,
  answerVerdict,
  type CheckPointResult,
  forms,
  isStatedLimit,
  type LimitContext,
  type MeasurementField,
  type RecordState,
} from '@opengewerk/haustechnik-domain'
import { Choice, Field, TextArea } from '@opengewerk/platform-web'
import { usePreview, useVersions } from '@opengewerk/platform-web/attachments'
import {
  CheckPointAnswer,
  FigureBlock,
  limitMark,
  MeasurementBlock,
  PhotoTaker,
  RemarkField,
  remarkForCheckPoint,
  remarkForMeasurement,
} from '@opengewerk/platform-web/forms'
import { useSync } from '@opengewerk/platform-web/sync'
import { ImageIcon, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { beginActivity, filledOf, type FormPoint, saveAnswer, unitSign } from './answers.js'
import { fileDocumentAs } from './documents.js'

export const pointWords = {
  /** Under a check point that is not in order: what the signature makes of it. */
  becomesDefect: (target: string) =>
    `Wird mit der Unterschrift ein Mangel an ${target}. Klasse und Frist setzt, wer Mängel führt.`,
  /** Under a measured value outside its limit. */
  outsideBecomesDefect: (target: string) =>
    `Mit der Unterschrift wird daraus ein Mangel an ${target}, wie bei „nicht in Ordnung“.`,
  reasonIsAnswer: '„Entfällt“ und „nicht möglich“ sind Antworten und verlangen einen Grund.',
  photoOf: (label: string) => `Foto zu ${label}`,
  photoNotFiled: 'Das Foto ließ sich nicht ablegen.',
  yes: 'ja',
  no: 'nein',
} as const

/** A note under an answer, in the colours of a conflict: what the signature will make of it. */
export function DefectNote({ children }: { readonly children: string }) {
  return (
    <p className="flex gap-2.5 rounded-[6px] border border-conflict-edge bg-conflict-fill px-3.5 py-3 text-[15px] leading-[1.4] text-conflict-ink">
      <TriangleAlert
        size={20}
        strokeWidth={2.2}
        aria-hidden="true"
        className="shrink-0 text-conflict"
      />
      <span>{children}</span>
    </p>
  )
}

/** The photo of a point as a small picture, from the device or fetched once. */
function PhotoThumb({
  attachmentId,
  label,
}: {
  readonly attachmentId: string
  readonly label: string
}) {
  const newest = useVersions().get(attachmentId)?.[0]
  const href = usePreview(newest)

  return href === null ? (
    <span
      role="img"
      aria-label={label}
      className="flex h-[72px] w-24 shrink-0 items-center justify-center rounded-[5px] border border-line bg-surface-sunken text-ink-faint"
    >
      <ImageIcon size={22} strokeWidth={1.8} aria-hidden="true" />
    </span>
  ) : (
    <img
      src={href}
      alt={label}
      className="h-[72px] w-24 shrink-0 rounded-[5px] border border-line object-cover"
    />
  )
}

/**
 * Writes what is typed a moment after the last key, and at once when the
 * field is left, the page is hidden or the screen goes: a figure or a remark
 * is not written for every key, and none is lost to a page closed in a hurry.
 */
export function useDeferredWrite<T>(write: (value: T) => void): {
  readonly put: (value: T) => void
  readonly flush: () => void
} {
  const latest = useRef(write)
  const waiting = useRef<{ readonly value: T } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    latest.current = write
  })

  const flush = useCallback(() => {
    clearTimeout(timer.current)

    const held = waiting.current

    waiting.current = null

    if (held !== null) {
      latest.current(held.value)
    }
  }, [])

  useEffect(() => {
    window.addEventListener('pagehide', flush)

    return () => {
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [flush])

  const put = useCallback(
    (value: T) => {
      waiting.current = { value }
      clearTimeout(timer.current)
      timer.current = setTimeout(flush, 400)
    },
    [flush],
  )

  return { put, flush }
}

export interface PointInputProps {
  readonly activityId: string
  /** The property of the activity, where a photo of a point is filed. */
  readonly propertyId: string
  readonly point: FormPoint
  /** The answer to the point, as the device holds it. */
  readonly answer: RecordState | undefined
  /** The rules and the day a measured value is judged by. */
  readonly context: LimitContext
  /** What a finding here becomes a defect at, in words: `Raum E.14 Heizraum`. */
  readonly target: string
  /** Whether the answer may still be given or changed: the activity is open and the person performs. */
  readonly editable: boolean
  readonly onTrouble: (sentence: string | null) => void
  /**
   * `page` for a point on a screen of its own, under its question; `list` for
   * a point among the others of a protocol (#108), which says its label
   * itself and shows a remark and a photo where its answer asks for them.
   */
  readonly layout?: 'page' | 'list'
}

/**
 * Whether the screen of a point says its label as the question above the
 * input: a check point, a measured value, a number and a reading are asked
 * as a question; a text, a choice, yes or no and a photo carry their label at
 * the input, as a field does.
 */
export function askedAsQuestion(kind: FormPoint['field']['kind']): boolean {
  return (
    kind === 'check_point' ||
    kind === 'measurement' ||
    kind === 'number' ||
    kind === 'meter_reading'
  )
}

/**
 * The input of one point, for each kind of field the forms of this
 * application have (`forms.kinds`). A kind without its case here does not
 * compile, and the test that draws every kind turns red.
 */
export function PointInput(props: PointInputProps) {
  const field = props.point.field

  switch (field.kind) {
    case 'check_point':
      return <CheckPointInput {...props} />
    case 'measurement':
      return <MeasurementInput {...props} field={field} />
    case 'number':
    case 'meter_reading':
      return <FigurePointInput {...props} unit={unitSign(field)} />
    case 'text':
      return <TextPointInput {...props} multiline={field.multiline === true} />
    case 'choice':
      return <ChoicePointInput {...props} options={field.options} />
    case 'yes_no':
      return (
        <ChoicePointInput
          {...props}
          options={[
            { value: 'true', label: pointWords.yes },
            { value: 'false', label: pointWords.no },
          ]}
        />
      )
    case 'photo':
      return <PhotoPointInput {...props} />
  }
}

/**
 * Writes a change to the answer of a point, one after the other, and says
 * what went wrong. The first one begins the activity (#108).
 */
function useAnswerWrite({ activityId, point, onTrouble }: PointInputProps) {
  const client = useSync()
  const queue = useRef<Promise<void>>(Promise.resolve())

  return useCallback(
    (change: Partial<AnswerContent>) => {
      queue.current = queue.current.then(async () => {
        onTrouble(
          (await beginActivity(client, activityId)) ??
            (await saveAnswer(client, activityId, point, change)),
        )
      })

      return queue.current
    },
    [client, activityId, point, onTrouble],
  )
}

/** An answer with nothing in it, to ask the limit of a field before there is a value. */
const nothingYet: AnswerContent = { value: null, result: null, remark: null, attachmentId: null }

/** The value of an answer as its JSON, the text the device writes and the server keeps. */
function json(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value)
}

function parsedValue(answer: RecordState | undefined): unknown {
  const value = answer === undefined ? null : filledOf(answer).value

  if (value === null) {
    return undefined
  }

  try {
    return JSON.parse(value) as unknown
  } catch {
    return undefined
  }
}

/**
 * A check point: the four answers, the remark or reason under them and a
 * photo. Remark and photo given before the answer wait on the screen and go
 * with it, because an answer to a check point is its result first.
 */
function CheckPointInput(props: PointInputProps) {
  const { answer, point, editable, target, propertyId, activityId, onTrouble, layout } = props
  const client = useSync()
  const write = useAnswerWrite(props)
  const filled = answer === undefined ? undefined : filledOf(answer)
  const result = filled?.result ?? undefined
  const [remark, setRemark] = useState(filled?.remark ?? '')
  const [heldPhoto, setHeldPhoto] = useState<AttachmentId | null>(null)
  const photo = filled?.attachmentId ?? heldPhoto
  const deferred = useDeferredWrite((typed: string) => {
    if (result !== undefined) {
      void write({ remark: typed.trim() === '' ? null : typed })
    }
  })
  const asked = remarkForCheckPoint(result)
  const inList = layout === 'list'
  // In a list a point says more than its answer where the answer asks for a
  // remark or a reason, or where one was given.
  const more = !inList || asked.required || remark !== '' || photo !== null

  return (
    <div className={`flex min-w-0 flex-col ${inList ? 'gap-2.5' : 'gap-3.5'}`}>
      {inList ? (
        <h3 className="text-[17px] leading-[1.3] font-semibold [overflow-wrap:anywhere]">
          {point.field.label}
        </h3>
      ) : null}
      <CheckPointAnswer
        label={point.field.label}
        value={result}
        layout={inList ? 'row' : 'grid'}
        disabled={!editable}
        onChange={(picked: CheckPointResult) => {
          void write({
            result: picked,
            ...(result === undefined
              ? { remark: remark.trim() === '' ? null : remark, attachmentId: heldPhoto }
              : {}),
          })
        }}
      />
      {more ? (
        <div onBlur={deferred.flush}>
          <RemarkField
            asked={asked}
            value={remark}
            maxLength={answerLimits.remark}
            disabled={!editable}
            onChange={(typed) => {
              setRemark(typed)
              deferred.put(typed)
            }}
          />
        </div>
      ) : null}
      {more ? (
        <PhotoTaker
          label={pointWords.photoOf(point.field.label)}
          disabled={!editable}
          photo={
            photo === null ? undefined : (
              <PhotoThumb attachmentId={photo} label={pointWords.photoOf(point.field.label)} />
            )
          }
          onTake={(file) => {
            void (async () => {
              const filed = await fileDocumentAs(client, { propertyId, activityId }, file)

              if ('problem' in filed) {
                onTrouble(pointWords.photoNotFiled)

                return
              }

              const id = filed.id as AttachmentId

              if (result === undefined) {
                setHeldPhoto(id)
              } else {
                await write({ attachmentId: id })
              }
            })()
          }}
        />
      ) : null}
      {result === 'not_ok' ? <DefectNote>{pointWords.becomesDefect(target)}</DefectNote> : null}
      {result === 'not_applicable' || result === 'not_possible' ? (
        <p className="text-[15px] leading-[1.4] text-ink-muted">{pointWords.reasonIsAnswer}</p>
      ) : null}
    </div>
  )
}

/** A measured value with its limit and, outside it, the remark it asks for. */
function MeasurementInput(props: PointInputProps & { readonly field: MeasurementField }) {
  const { answer, field, context, editable, target } = props
  const write = useAnswerWrite(props)
  const filled = answer === undefined ? undefined : filledOf(answer)
  const value = parsedValue(answer)
  // Judged also before there is a value, so that the limit stands at the head from the start.
  const verdict =
    field.limit === undefined ? null : answerVerdict(field, filled ?? nothingYet, context)
  const [remark, setRemark] = useState(filled?.remark ?? '')
  const figure = useDeferredWrite((typed: number | undefined) => {
    void write(
      typed === undefined
        ? { value: null, remark: null }
        : { value: json(typed), ...(remark.trim() === '' ? {} : { remark }) },
    )
  })
  const words = useDeferredWrite((typed: string) => {
    if (filled !== undefined) {
      void write({ remark: typed.trim() === '' ? null : typed })
    }
  })
  const unit = unitSign(field)
  // A limit an operator states says its bound beside its kind (#112).
  const bound = isStatedLimit(field.limit)
    ? field.limit.bound
    : field.limit?.kind === 'at_least' || field.limit?.kind === 'at_most'
      ? field.limit.kind
      : undefined
  const limit =
    verdict === null || verdict.limitMilli === null || bound === undefined
      ? undefined
      : limitMark(bound, forms.formatMeasured(verdict.limitMilli, field.unit, field.decimals))

  return (
    <div className="flex min-w-0 flex-col gap-3.5">
      <div onBlur={figure.flush}>
        <MeasurementBlock
          label={field.label}
          unit={unit}
          value={typeof value === 'number' ? value : undefined}
          verdict={verdict}
          mark={limit}
          hint={field.hint}
          labelHidden={props.layout !== 'list'}
          disabled={!editable}
          onChange={figure.put}
        />
      </div>
      {/* In a list a measured value asks for its remark outside its limit, or shows the one given. */}
      {props.layout !== 'list' || verdict?.within === false || remark !== '' ? (
        <div onBlur={words.flush}>
          <RemarkField
            asked={remarkForMeasurement(verdict?.within ?? null)}
            value={remark}
            maxLength={answerLimits.remark}
            disabled={!editable}
            onChange={(typed) => {
              setRemark(typed)
              words.put(typed)
            }}
          />
        </div>
      ) : null}
      {verdict?.within === false ? (
        <DefectNote>{pointWords.outsideBecomesDefect(target)}</DefectNote>
      ) : null}
    </div>
  )
}

/** A number with its unit, and the reading of a meter. */
function FigurePointInput(props: PointInputProps & { readonly unit: string }) {
  const { answer, point, unit, editable } = props
  const write = useAnswerWrite(props)
  const value = parsedValue(answer)
  const figure = useDeferredWrite((typed: number | undefined) => {
    void write({ value: typed === undefined ? null : json(typed) })
  })

  return (
    <div onBlur={figure.flush}>
      <FigureBlock
        label={point.field.label}
        unit={unit}
        value={typeof value === 'number' ? value : undefined}
        hint={point.field.hint}
        labelHidden={props.layout !== 'list'}
        disabled={!editable}
        onChange={figure.put}
      />
    </div>
  )
}

/** A text, a line or more. */
function TextPointInput(props: PointInputProps & { readonly multiline: boolean }) {
  const { answer, point, multiline, editable } = props
  const write = useAnswerWrite(props)
  const value = parsedValue(answer)
  const [typed, setTyped] = useState(typeof value === 'string' ? value : '')
  const deferred = useDeferredWrite((text: string) => {
    void write({ value: text.trim() === '' ? null : json(text) })
  })
  const change = (text: string) => {
    setTyped(text)
    deferred.put(text)
  }

  return (
    <div onBlur={deferred.flush}>
      {multiline ? (
        <TextArea
          label={point.field.label}
          hint={point.field.hint}
          rows={4}
          value={typed}
          disabled={!editable}
          onChange={(event) => {
            change(event.target.value)
          }}
        />
      ) : (
        <Field
          label={point.field.label}
          hint={point.field.hint}
          autoComplete="off"
          value={typed}
          disabled={!editable}
          onChange={(event) => {
            change(event.target.value)
          }}
        />
      )}
    </div>
  )
}

/** One of the options of a choice, or yes or no; yes and no are kept as the values true and false. */
function ChoicePointInput(
  props: PointInputProps & {
    readonly options: readonly { readonly value: string; readonly label: string }[]
  },
) {
  const { answer, point, options, editable } = props
  const write = useAnswerWrite(props)
  const value = parsedValue(answer)
  const yesNo = point.field.kind === 'yes_no'

  return (
    <Choice
      label={point.field.label}
      options={options}
      value={value === undefined ? null : String(value)}
      disabled={!editable}
      onChange={(picked) => {
        void write({ value: json(yesNo ? picked === 'true' : picked) })
      }}
    />
  )
}

/** A photo the form asks for, filed as a document of the activity. */
function PhotoPointInput(props: PointInputProps) {
  const { answer, point, editable, propertyId, activityId, onTrouble } = props
  const client = useSync()
  const write = useAnswerWrite(props)
  const photo = answer === undefined ? null : filledOf(answer).attachmentId

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span aria-hidden="true" className="text-[16px] font-semibold text-ink">
        {point.field.label}
      </span>
      <PhotoTaker
        label={point.field.label}
        disabled={!editable}
        photo={
          photo === null ? undefined : (
            <PhotoThumb attachmentId={photo} label={pointWords.photoOf(point.field.label)} />
          )
        }
        onTake={(file) => {
          void (async () => {
            const filed = await fileDocumentAs(client, { propertyId, activityId }, file)

            if ('problem' in filed) {
              onTrouble(pointWords.photoNotFiled)
            } else {
              await write({ attachmentId: filed.id as AttachmentId })
            }
          })()
        }}
      />
    </div>
  )
}
