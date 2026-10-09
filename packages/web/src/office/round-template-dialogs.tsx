import {
  type DutyId,
  type FormUnitKey,
  formUnits,
  isStatedLimit,
  type LimitBound,
  type TemplateDefinition,
  type TemplateField,
  templateProblems,
  type TemplateRecords,
} from '@opengewerk/haustechnik-domain'
import {
  Button,
  Choice,
  Dialog,
  DialogActions,
  Field,
  IconButton,
  SelectField,
} from '@opengewerk/platform-web'
import { Check, Plus, Trash2, X } from 'lucide-react'
import { useState } from 'react'

import { newPoint, type PointKind, pointKindOf, pointKinds, withPoint } from './template-draft.js'

/**
 * The dialogs of the editor of a template (#112): a point, as
 * `vorlage_punkt()` of the boards draws it, and a chapter, as
 * `vorlage_kapitel()` does. Each changes the draft and nothing else; the
 * version is saved with "Als neue Fassung speichern".
 */

export const pointWords = {
  saved: 'Gespeichert wird mit „Als neue Fassung speichern“.',
  limitHint:
    'Ein eigener Wert steht in der Fassung der Vorlage. Eine Regel eines Pakets folgt dessen Fassungen.',
  aboutHint:
    'Was hier festgestellt wird, steht in der Akte der Anlage oder des Raums; „nicht in Ordnung“ und ein Wert außerhalb des Grenzwerts werden dort ein Mangel.',
  dutyHint:
    'Die Antwort ist der Nachweis dieser Pflicht, ohne zweite Erfassung. Zur Wahl stehen die Pflichten der Anlage oder des Raums, die einen Punkt eines Rundgangs als Nachweis nehmen.',
  noDuty: 'Keine',
  required: 'Muss ausgefüllt werden',
  requiredAlways: 'Ein Prüfpunkt und ein Punkt, der eine Pflicht erfüllt, immer.',
  notANumber: 'Der Grenzwert ist eine Zahl, etwa 60,0.',
  chapterHint: 'Steht im Rundgang über seinen Punkten.',
} as const

/** What the editor offers to choose from in a point: assets, rooms, the duties at one, the rules of a unit. */
export interface PointChoices {
  readonly assets: readonly { readonly value: string; readonly label: string }[]
  readonly rooms: readonly { readonly value: string; readonly label: string }[]
  readonly duties: (
    kind: 'asset' | 'room',
    id: string,
  ) => readonly { readonly value: string; readonly label: string }[]
  readonly rules: (
    unit: FormUnitKey,
  ) => readonly { readonly value: string; readonly label: string }[]
}

type LimitChoice = 'none' | 'rule' | 'stated'

const units = (Object.keys(formUnits) as FormUnitKey[]).map((unit) => ({
  value: unit,
  label: formUnits[unit].sign,
}))

const decimals = ['0', '1', '2', '3'].map((value) => ({ value, label: value }))

/** A value in thousandths as the field writes it: 60000 with one place is "60,0". */
function milliText(milli: number, places: number): string {
  return (milli / 1000).toLocaleString('de-DE', {
    minimumFractionDigits: places,
    maximumFractionDigits: 3,
    useGrouping: false,
  })
}

/** "60,0" or "60.0" as thousandths, or null for what is no number. */
function milliOf(text: string): number | null {
  const trimmed = text.trim().replace(',', '.')

  if (!/^-?\d+(\.\d{1,3})?$/.test(trimmed)) {
    return null
  }

  return Math.round(Number(trimmed) * 1000)
}

function limitChoiceOf(field: TemplateField): LimitChoice {
  if (field.kind !== 'measurement' || field.limit === undefined) {
    return 'none'
  }

  return 'rule' in field.limit ? 'rule' : 'stated'
}

export function PointDialog({
  point,
  chapter,
  draft,
  isNew,
  records,
  choices,
  onApply,
  onRemove,
  onClose,
}: {
  readonly point: TemplateField
  readonly chapter: string
  readonly draft: TemplateDefinition
  readonly isNew: boolean
  readonly records: TemplateRecords
  readonly choices: PointChoices
  readonly onApply: (point: TemplateField, chapter: string) => void
  readonly onRemove: () => void
  readonly onClose: () => void
}) {
  const [field, setField] = useState<TemplateField>(point)
  const [chapterKey, setChapterKey] = useState(chapter)
  const [limit, setLimit] = useState<LimitChoice>(limitChoiceOf(point))
  const stated = point.kind === 'measurement' && isStatedLimit(point.limit) ? point.limit : null
  const [bound, setBound] = useState<LimitBound>(stated?.bound ?? 'at_least')
  const [valueText, setValueText] = useState(
    stated === null || point.kind !== 'measurement' ? '' : milliText(stated.milli, point.decimals),
  )
  const [source, setSource] = useState(stated?.source ?? '')
  const [rule, setRule] = useState(
    point.kind === 'measurement' && point.limit !== undefined && 'rule' in point.limit
      ? point.limit.rule
      : '',
  )
  const [problem, setProblem] = useState<string | null>(null)

  const kind = pointKindOf(field)
  const counted =
    field.kind === 'number' || field.kind === 'measurement' || field.kind === 'meter_reading'
  const canFulfil =
    field.kind === 'check_point' || (field.kind === 'measurement' && limit !== 'none')
  const target = field.about?.kind === 'asset' || field.about?.kind === 'room' ? field.about : null
  const dutyChoices =
    target === null ? [] : choices.duties(target.kind as 'asset' | 'room', target.id)
  const section = draft.sections.findIndex((each) => each.key === chapterKey)
  const place = draft.sections[section]?.fields.findIndex((each) => each.key === field.key) ?? -1

  const changeKind = (next: PointKind) => {
    const made = newPoint(next, field.key, field.label)
    const kept: Record<string, unknown> = { ...made }

    if (field.hint !== undefined) {
      kept['hint'] = field.hint
    }

    if (field.about !== undefined) {
      kept['about'] = field.about
    }

    setField(kept as unknown as TemplateField)
    setLimit('none')
  }

  /** The point as the dialog says it, or the sentence why it cannot be taken. */
  const finished = (): TemplateField | string => {
    const base: Record<string, unknown> = { ...field }

    delete base['limit']

    if (field.kind === 'measurement' && limit === 'stated') {
      const milli = milliOf(valueText)

      if (milli === null) {
        return pointWords.notANumber
      }

      base['limit'] = { kind: 'stated', bound, milli, source: source.trim() }
    } else if (field.kind === 'measurement' && limit === 'rule') {
      base['limit'] = { kind: bound, rule }
    }

    if (!canFulfil) {
      delete base['fulfils']
    }

    if (base['fulfils'] !== undefined && field.kind === 'measurement') {
      base['required'] = true
    }

    if (typeof base['hint'] === 'string' && base['hint'].trim() === '') {
      delete base['hint']
    }

    return base as unknown as TemplateField
  }

  const apply = () => {
    const made = finished()

    if (typeof made === 'string') {
      setProblem(made)
      return
    }

    const found = templateProblems(withPoint(draft, made, chapterKey), records)[`point.${made.key}`]

    if (found !== undefined) {
      setProblem(found)
      return
    }

    onApply(made, chapterKey)
  }

  const set = (changes: Record<string, unknown>) => {
    setField({ ...field, ...changes } as unknown as TemplateField)
  }

  return (
    <Dialog
      title={isNew ? 'Punkt hinzufügen' : 'Punkt bearbeiten'}
      sub={`${draft.sections[section]?.title ?? ''}${place >= 0 ? `, Punkt ${String(place + 1)} von ${String(draft.sections[section]?.fields.length ?? 0)}` : ''}. ${pointWords.saved}`}
      width={640}
      onClose={onClose}
    >
      <div className="grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)]">
        <SelectField
          label="Art"
          value={kind}
          options={pointKinds}
          onChange={(value) => {
            changeKind(value as PointKind)
          }}
        />
        <Field
          label="Bezeichnung"
          required
          value={field.label}
          onChange={(event) => {
            set({ label: event.target.value })
          }}
        />
      </div>
      <Field
        label="Hinweis"
        hint="Steht auf dem Gerät unter dem Punkt."
        value={field.hint ?? ''}
        onChange={(event) => {
          set({ hint: event.target.value })
        }}
      />
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_140px_160px]">
        <SelectField
          label="Kapitel"
          value={chapterKey}
          options={draft.sections.map((each) => ({ value: each.key, label: each.title }))}
          onChange={setChapterKey}
        />
        {counted ? (
          <>
            <SelectField
              label="Einheit"
              value={field.unit}
              options={units}
              onChange={(value) => {
                set({ unit: value })
                setRule('')
              }}
            />
            <SelectField
              label="Nachkommastellen"
              value={String(field.decimals)}
              options={decimals}
              onChange={(value) => {
                set({ decimals: Number(value) })
              }}
            />
          </>
        ) : null}
      </div>
      {field.kind === 'choice' ? (
        <div className="flex flex-col gap-2">
          {field.options.map((option, index) => (
            <div key={option.value} className="flex items-end gap-2">
              <div className="grow">
                <Field
                  label={`Möglichkeit ${String(index + 1)}`}
                  value={option.label}
                  onChange={(event) => {
                    set({
                      options: field.options.map((each) =>
                        each.value === option.value ? { ...each, label: event.target.value } : each,
                      ),
                    })
                  }}
                />
              </div>
              {field.options.length > 2 ? (
                <IconButton
                  label={`Möglichkeit ${String(index + 1)} entfernen`}
                  onClick={() => {
                    set({ options: field.options.filter((each) => each.value !== option.value) })
                  }}
                >
                  <X size={15} aria-hidden="true" />
                </IconButton>
              ) : null}
            </div>
          ))}
          <div>
            <Button
              size="small"
              icon={Plus}
              onClick={() => {
                const taken = field.options.map((each) => Number(each.value.slice(1)) || 0)

                set({
                  options: [
                    ...field.options,
                    { value: `o${String(Math.max(0, ...taken) + 1)}`, label: '' },
                  ],
                })
              }}
            >
              Möglichkeit hinzufügen
            </Button>
          </div>
        </div>
      ) : null}
      {field.kind === 'measurement' ? (
        <div className="flex flex-col gap-1.5">
          <Choice
            label="Grenzwert"
            value={limit}
            options={[
              { value: 'none', label: 'Keiner' },
              { value: 'rule', label: 'Regel eines Pakets' },
              { value: 'stated', label: 'Eigener Wert' },
            ]}
            onChange={setLimit}
          />
          {limit === 'none' ? null : (
            <div
              className={
                limit === 'stated'
                  ? 'grid gap-2.5 sm:grid-cols-[140px_120px_minmax(0,1fr)]'
                  : 'grid gap-2.5 sm:grid-cols-[140px_minmax(0,1fr)]'
              }
            >
              <SelectField
                label="Grenze"
                value={bound}
                options={[
                  { value: 'at_least', label: 'mindestens' },
                  { value: 'at_most', label: 'höchstens' },
                ]}
                onChange={(value) => {
                  setBound(value as LimitBound)
                }}
              />
              {limit === 'stated' ? (
                <>
                  <Field
                    label="Wert"
                    required
                    numeric
                    unit={formUnits[field.unit].sign}
                    value={valueText}
                    onChange={(event) => {
                      setValueText(event.target.value)
                    }}
                  />
                  <Field
                    label="Quelle"
                    required
                    value={source}
                    onChange={(event) => {
                      setSource(event.target.value)
                    }}
                  />
                </>
              ) : (
                <SelectField
                  label="Regel"
                  required
                  value={rule}
                  options={[{ value: '', label: 'Bitte wählen' }, ...choices.rules(field.unit)]}
                  onChange={setRule}
                />
              )}
            </div>
          )}
          <p className="text-[12px] text-ink-faint">{pointWords.limitHint}</p>
        </div>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <Choice
          label="Zeigt auf"
          value={target === null ? 'none' : target.kind}
          options={[
            { value: 'none', label: 'Nichts' },
            { value: 'asset', label: 'Eine Anlage' },
            { value: 'room', label: 'Einen Raum' },
          ]}
          onChange={(value) => {
            const next = { ...field } as Record<string, unknown>

            delete next['fulfils']

            if (value === 'none') {
              delete next['about']
            } else {
              const first = (value === 'asset' ? choices.assets : choices.rooms)[0]

              next['about'] = { kind: value, id: first?.value ?? '' }
            }

            setField(next as unknown as TemplateField)
          }}
        />
        {target === null ? null : (
          <SelectField
            label={target.kind === 'asset' ? 'Anlage' : 'Raum'}
            value={target.id}
            options={
              (target.kind === 'asset' ? choices.assets : choices.rooms).some(
                (each) => each.value === target.id,
              )
                ? target.kind === 'asset'
                  ? choices.assets
                  : choices.rooms
                : [
                    {
                      value: target.id,
                      label:
                        target.kind === 'asset' ? 'Anlage nicht gefunden' : 'Raum nicht gefunden',
                    },
                    ...(target.kind === 'asset' ? choices.assets : choices.rooms),
                  ]
            }
            hint={pointWords.aboutHint}
            onChange={(value) => {
              const next = { ...field, about: { kind: target.kind, id: value } } as Record<
                string,
                unknown
              >

              delete next['fulfils']
              setField(next as unknown as TemplateField)
            }}
          />
        )}
      </div>
      {canFulfil && target !== null ? (
        <SelectField
          label="Erfüllt die Pflicht"
          value={field.fulfils ?? ''}
          options={[{ value: '', label: pointWords.noDuty }, ...dutyChoices]}
          hint={pointWords.dutyHint}
          onChange={(value) => {
            const next = { ...field } as Record<string, unknown>

            if (value === '') {
              delete next['fulfils']
            } else {
              next['fulfils'] = value as DutyId
            }

            setField(next as unknown as TemplateField)
          }}
        />
      ) : null}
      {field.kind === 'check_point' ? null : (
        <label className="flex items-start gap-2.5 text-[14px] leading-[1.4]">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-solid"
            checked={field.required === true || field.fulfils !== undefined}
            disabled={field.fulfils !== undefined}
            onChange={(event) => {
              set({ required: event.target.checked })
            }}
          />
          <span>
            {pointWords.required}
            <span className="block text-[12px] text-ink-muted">{pointWords.requiredAlways}</span>
          </span>
        </label>
      )}
      {problem === null ? null : (
        <p role="alert" className="text-[13px] font-medium text-conflict">
          {problem}
        </p>
      )}
      <DialogActions>
        {isNew ? null : (
          <span className="mr-auto">
            <Button tone="danger" icon={Trash2} onClick={onRemove}>
              Punkt entfernen
            </Button>
          </span>
        )}
        <Button onClick={onClose}>Abbrechen</Button>
        <Button tone="primary" icon={Check} onClick={apply}>
          Übernehmen
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export function ChapterDialog({
  title,
  points,
  isNew,
  onApply,
  onRemove,
  onClose,
}: {
  readonly title: string
  readonly points: number
  readonly isNew: boolean
  readonly onApply: (title: string) => void
  readonly onRemove: () => void
  readonly onClose: () => void
}) {
  const [said, setSaid] = useState(title)
  const [problem, setProblem] = useState<string | null>(null)

  return (
    <Dialog
      title={isNew ? 'Kapitel hinzufügen' : 'Kapitel bearbeiten'}
      width={520}
      onClose={onClose}
    >
      <Field
        label="Bezeichnung"
        required
        hint={pointWords.chapterHint}
        value={said}
        {...(problem === null ? {} : { problem })}
        onChange={(event) => {
          setSaid(event.target.value)
        }}
      />
      {isNew ? null : (
        <p className="text-[12px] text-ink-muted">
          {points === 0
            ? 'Ein Kapitel ohne Punkte lässt sich entfernen.'
            : `Ein Kapitel entfernen nimmt seine ${String(points)} ${points === 1 ? 'Punkt' : 'Punkte'} mit. ${pointWords.saved}`}
        </p>
      )}
      <DialogActions>
        {isNew ? null : (
          <span className="mr-auto">
            <Button tone="danger" icon={Trash2} onClick={onRemove}>
              Kapitel entfernen
            </Button>
          </span>
        )}
        <Button onClick={onClose}>Abbrechen</Button>
        <Button
          tone="primary"
          icon={Check}
          onClick={() => {
            if (said.trim() === '') {
              setProblem('Die Bezeichnung fehlt.')
              return
            }

            onApply(said.trim())
          }}
        >
          Übernehmen
        </Button>
      </DialogActions>
    </Dialog>
  )
}
