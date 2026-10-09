import {
  type AttachmentId,
  type CheckPointResult,
  checkPointResults,
  type FieldValue,
  type FormValues,
  type Id,
  type IsoDate,
  type LimitVerdict,
  longestFormText,
  type RecordPointer,
  type RuleSet,
  type Synced,
} from '@opengewerk/platform-domain'

import type { ActivityId } from './activity.js'
import type { AreaId } from './area.js'
import type { Catalogue } from './catalogue.js'
import { defectLimits } from './defect.js'
import type { StatedAnswer, StatedFile } from './evidence.js'
import { oneOf, type Problems } from './fields.js'
import {
  type BlockField,
  type FormDefinition,
  type FormSection,
  forms,
  type GroupField,
  type MeasurementField,
} from './forms.js'
import type { PropertyId } from './location.js'

/**
 * The answers of a round and of a protocol (section 2.7 of the concept, ADR
 * 0006, point 7): one row per point of the form, so that two people at
 * different points merge without anybody noticing, and two at the same point
 * are a conflict a person decides. Which form an activity is filled in, and
 * in which version, its activity says (`formKey`, `formVersion`); an answer
 * names its point in that form and nothing of the form itself.
 */

export type ActivityAnswerId = Id<'activity-answer'>

/** The bounds of an answer, the same on the device, in the sync and in the database. */
export const answerLimits = {
  /** The key of a field, of a group and of a block. */
  key: 64,
  /**
   * A value as the text of its JSON. The longest is a signature: a drawing of
   * up to 40 000 characters with the name beside it.
   */
  value: 50_000,
  /** What was found at a point that is not in order, or why it was not checked. */
  remark: longestFormText,
} as const

/**
 * The answer to one point of the form of an activity: the field, and for a
 * field of a repeating group the group and the block; then what was
 * answered. A check point keeps its result, its remark and a photo; a photo
 * field the document of the photo; a measured value its value and, outside
 * its limit, the remark; every other field its value. A value is the JSON of
 * the value the form engine knows, the text the device wrote, character for
 * character.
 *
 * A photo is a document at the activity (#97), and the answer names it.
 */
export interface ActivityAnswer extends Synced {
  readonly id: ActivityAnswerId
  readonly propertyId: PropertyId
  readonly areaId: AreaId
  readonly activityId: ActivityId
  readonly groupKey: string | null
  readonly blockKey: string | null
  readonly fieldKey: string
  readonly value: string | null
  readonly result: CheckPointResult | null
  readonly remark: string | null
  readonly attachmentId: AttachmentId | null
}

/** Where an answer stands in its form: the field, and in a repeating group the group and its block. */
export type AnswerPoint = Pick<ActivityAnswer, 'groupKey' | 'blockKey' | 'fieldKey'>

/** What an answer says, as the form and the engine read it. */
export type AnswerContent = Pick<ActivityAnswer, 'value' | 'result' | 'remark' | 'attachmentId'>

/** An answer as far as its form asks it. */
export type FilledAnswer = AnswerPoint & AnswerContent

/** Small letters, digits and underscores, the shape of a key of a field in a form. */
const fieldKeyShape = /^[a-z][a-z0-9_]*$/

/**
 * The key of a block, which the device draws when a block is opened: letters,
 * digits, hyphens and underscores, a UUID among them. Blocks stand in the
 * order of their keys, on the device and on the server alike.
 */
const blockKeyShape = /^[A-Za-z0-9_-]+$/

function keyProblem(
  problems: Problems,
  answer: Readonly<Record<string, unknown>>,
  field: 'groupKey' | 'blockKey' | 'fieldKey',
  shape: RegExp,
  sentence: string,
): void {
  const value = answer[field]

  if (value === undefined || (value === null && field !== 'fieldKey')) {
    return
  }

  if (typeof value !== 'string' || value.length > answerLimits.key || !shape.test(value)) {
    problems[field] = sentence
  }
}

/** The value of an answer read from its text, or undefined when it is not JSON. */
function parsed(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

/**
 * What is wrong with an answer as it arrives, one sentence per field, without
 * its form: the shape of its keys and its texts. Whether it fits the field of
 * its form is `answerFitProblem`. Undefined is a field that was not given,
 * as in a change of other fields, and is not asked about.
 */
export function answerProblems(answer: Readonly<Record<string, unknown>>): Readonly<Problems> {
  const problems: Problems = {}

  keyProblem(problems, answer, 'fieldKey', fieldKeyShape, 'Eine Antwort nennt ihr Feld.')
  keyProblem(problems, answer, 'groupKey', fieldKeyShape, 'Die Gruppe ist kein Feld des Formulars.')
  keyProblem(
    problems,
    answer,
    'blockKey',
    blockKeyShape,
    'Der Block hat keinen gültigen Schlüssel.',
  )

  const group = answer['groupKey']
  const block = answer['blockKey']

  if (
    group !== undefined &&
    block !== undefined &&
    (group === null) !== (block === null) &&
    problems['groupKey'] === undefined &&
    problems['blockKey'] === undefined
  ) {
    problems['blockKey'] =
      'Ein Block gehört zu einer Gruppe, und eine Antwort in einer Gruppe nennt ihren Block.'
  }

  const value = answer['value']

  if (
    value !== undefined &&
    value !== null &&
    (typeof value !== 'string' || value.length > answerLimits.value || parsed(value) === undefined)
  ) {
    problems['value'] = 'Das ist kein Wert eines Formulars.'
  }

  oneOf(
    problems,
    answer,
    'result',
    checkPointResults,
    'Ein Prüfpunkt ist in Ordnung, nicht in Ordnung, entfällt oder ist nicht möglich.',
  )

  const remark = answer['remark']

  if (
    remark !== undefined &&
    remark !== null &&
    (typeof remark !== 'string' || remark.trim().length > answerLimits.remark)
  ) {
    problems['remark'] = `Die Bemerkung hat höchstens ${String(answerLimits.remark)} Zeichen.`
  }

  if (
    value !== undefined &&
    value !== null &&
    answer['result'] !== undefined &&
    answer['result'] !== null &&
    problems['value'] === undefined
  ) {
    problems['value'] = 'Ein Prüfpunkt hält sein Ergebnis und keinen Wert.'
  }

  return problems
}

/** A field of a form with where it stands: its section, and the group it is a field of. */
export interface AnsweredField {
  readonly section: FormSection
  readonly group: GroupField | null
  readonly field: BlockField
}

/**
 * The field an answer is about, or null when the form has none there: a
 * field outside a group for an answer without a group, a field of the named
 * group for one in a block.
 */
export function answeredField(
  definition: FormDefinition,
  point: AnswerPoint,
): AnsweredField | null {
  for (const section of definition.sections) {
    for (const field of section.fields) {
      if (point.groupKey === null) {
        if (field.key === point.fieldKey && field.kind !== 'group' && field.kind !== 'signature') {
          return { section, group: null, field }
        }

        continue
      }

      if (field.kind === 'group' && field.key === point.groupKey) {
        const nested = field.fields.find((candidate) => candidate.key === point.fieldKey)

        return nested ? { section, group: field, field: nested } : null
      }
    }
  }

  return null
}

/**
 * The value of an answer as the form engine knows it, or undefined where the
 * answer holds none: a check point without a result, a photo without a
 * document, a value that is not JSON.
 */
export function answerValue(field: BlockField, answer: AnswerContent): FieldValue | undefined {
  if (field.kind === 'check_point') {
    return answer.result === null
      ? undefined
      : {
          result: answer.result,
          ...(answer.remark === null ? {} : { remark: answer.remark }),
          ...(answer.attachmentId === null ? {} : { photo: answer.attachmentId }),
        }
  }

  if (field.kind === 'photo') {
    return answer.attachmentId ?? undefined
  }

  return answer.value === null ? undefined : (parsed(answer.value) as FieldValue | undefined)
}

/** The columns each kind of field fills, and the remark of a measured value outside its limit. */
function columnsProblem(field: BlockField, answer: AnswerContent): string | null {
  const label = field.label

  switch (field.kind) {
    case 'check_point':
      if (answer.result === null) {
        return `${label}: in Ordnung, nicht in Ordnung, entfällt oder nicht möglich.`
      }

      return answer.value === null
        ? null
        : `${label}: ein Prüfpunkt hält sein Ergebnis und keinen Wert.`
    case 'photo':
      return answer.attachmentId !== null &&
        answer.value === null &&
        answer.result === null &&
        answer.remark === null
        ? null
        : `${label}: ein Foto aus den Dokumenten des Vorgangs.`
    case 'measurement':
      return answer.value !== null && answer.result === null && answer.attachmentId === null
        ? null
        : `${label}: ein Messwert, und außerhalb seines Grenzwerts eine Bemerkung.`
    default:
      return answer.value !== null &&
        answer.result === null &&
        answer.remark === null &&
        answer.attachmentId === null
        ? null
        : `${label}: ein Wert und sonst nichts.`
  }
}

/**
 * Whether an answer fits the form of its activity, as a sentence, or null:
 * the field is there, the answer fills the columns its kind fills, and the
 * value is one the field takes. Whether a measured value lies within its
 * limit is never a reason to refuse it.
 */
export function answerFitProblem(definition: FormDefinition, answer: FilledAnswer): string | null {
  const found = answeredField(definition, answer)

  if (found === null) {
    return answer.groupKey === null
      ? `Das Feld ${answer.fieldKey} gibt es in ${definition.title} nicht.`
      : `Das Feld ${answer.fieldKey} gibt es in der Gruppe ${answer.groupKey} von ${definition.title} nicht.`
  }

  return (
    columnsProblem(found.field, answer) ??
    forms.valueProblem(found.field, answerValue(found.field, answer))
  )
}

/** Code units, the same in every engine. */
function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/**
 * The values of a filled form, as the engine reads them, from the answers of
 * its activity: a field outside a group by its key, a group as its blocks in
 * the order of their keys. An answer the form has no field for is left out;
 * the sync refuses one before it is written.
 */
export function formValuesOf(
  definition: FormDefinition,
  answers: readonly FilledAnswer[],
): FormValues {
  const values: Record<string, FieldValue | { readonly values: Record<string, FieldValue> }[]> = {}
  const groups = new Map<string, Map<string, Record<string, FieldValue>>>()

  for (const answer of answers) {
    const found = answeredField(definition, answer)
    const value = found === null ? undefined : answerValue(found.field, answer)

    if (found === null || value === undefined) {
      continue
    }

    if (found.group === null || answer.groupKey === null || answer.blockKey === null) {
      values[answer.fieldKey] = value
      continue
    }

    const blocks = groups.get(answer.groupKey) ?? new Map<string, Record<string, FieldValue>>()
    const block = blocks.get(answer.blockKey) ?? {}

    block[answer.fieldKey] = value
    blocks.set(answer.blockKey, block)
    groups.set(answer.groupKey, blocks)
  }

  for (const [groupKey, blocks] of groups) {
    values[groupKey] = [...blocks.entries()]
      .sort(([left], [right]) => compare(left, right))
      .map(([, block]) => ({ values: block }))
  }

  return values
}

/**
 * The answers a new activity starts from when the last protocol of its asset
 * in the same form is its template (#108, section 4.4 of the concept: "das
 * letzte Protokoll einer Anlage ist die Vorlage des nächsten, soweit die
 * Definition es zulässt"): those to the fields of the new version that carry,
 * as their rows held them, a block keeping its key. What a check point, a
 * measured value and a reading said belongs to the day it was said, as the
 * engine has it; a photo stays with the activity it was taken in; an answer
 * that no longer fits its field is left out.
 */
export function templateAnswers(
  definition: FormDefinition,
  answers: readonly FilledAnswer[],
): readonly FilledAnswer[] {
  return answers
    .filter((answer) => {
      const field = answeredField(definition, answer)?.field

      return (
        field !== undefined &&
        field.carry === true &&
        field.kind !== 'check_point' &&
        field.kind !== 'measurement' &&
        field.kind !== 'meter_reading' &&
        field.kind !== 'photo' &&
        answer.attachmentId === null &&
        answerFitProblem(definition, answer) === null
      )
    })
    .map(({ groupKey, blockKey, fieldKey, value, result, remark, attachmentId }) => ({
      groupKey,
      blockKey,
      fieldKey,
      value,
      result,
      remark,
      attachmentId,
    }))
}

/** What a measured value is judged by: the rules of the catalogue, on the day the activity was performed. */
export interface LimitContext {
  readonly rules: RuleSet
  readonly on: IsoDate
}

/** How a measured answer stands against the limit of its field. */
export function answerVerdict(
  field: MeasurementField,
  answer: AnswerContent,
  context: LimitContext,
): LimitVerdict {
  const value = answer.value === null ? undefined : parsed(answer.value)

  return forms.limitVerdict(field, typeof value === 'number' ? value : null, context)
}

/** Where a field stands, in words: its label, and in a group the group and the place of its block. */
function placeOf(found: AnsweredField, block: number | null): string {
  return found.group === null || block === null
    ? found.field.label
    : `${found.group.label}, Block ${String(block)}: ${found.field.label}`
}

/** The place of each block among the blocks of its group, counted from one in the order of their keys. */
function blockPlaces(answers: readonly FilledAnswer[]): (answer: FilledAnswer) => number | null {
  const keys = new Map<string, string[]>()

  for (const answer of answers) {
    if (answer.groupKey === null || answer.blockKey === null) {
      continue
    }

    const blocks = keys.get(answer.groupKey) ?? []

    if (!blocks.includes(answer.blockKey)) {
      blocks.push(answer.blockKey)
    }

    keys.set(answer.groupKey, blocks)
  }

  for (const blocks of keys.values()) {
    blocks.sort(compare)
  }

  return (answer) =>
    answer.groupKey === null || answer.blockKey === null
      ? null
      : (keys.get(answer.groupKey)?.indexOf(answer.blockKey) ?? -1) + 1
}

/**
 * What is missing before an activity with a form is signed (section 4.5 of
 * the concept, ADR 0006, point 10): every point needs an answer, a required
 * field its value, an answer other than "in order" its remark, the blocks of
 * a group included, and a measured value outside its limit a remark that
 * says why (decided on 04.10.2026). It cannot be switched off: a form asks
 * nothing else of the engine than the sealing signature, which is the
 * signature of the activity here.
 */
export function answersMissing(
  definition: FormDefinition,
  answers: readonly FilledAnswer[],
  context: LimitContext,
): readonly string[] {
  // Every list a group may repeat over is named, so that a group over one has
  // to answer for each of its items; this application has none yet.
  const missing = [
    ...forms.sealProblems(definition, formValuesOf(definition, answers), {
      seal: false,
      items: {},
    }),
  ]
  const blockOf = blockPlaces(answers)

  for (const answer of answers) {
    const found = answeredField(definition, answer)

    if (
      found?.field.kind === 'measurement' &&
      answerVerdict(found.field, answer, context).within === false &&
      (answer.remark ?? '').trim() === ''
    ) {
      missing.push(
        `${placeOf(found, blockOf(answer))}: außerhalb des Grenzwerts, die Bemerkung fehlt.`,
      )
    }
  }

  return missing
}

/**
 * A defect that comes of an answer once the activity is signed (section 4.5
 * of the concept): a check point that is not in order, and a measured value
 * outside its limit, with value and limit. It is found at the asset or the
 * room the field is about, and where it is about nothing, at the place of the
 * activity.
 */
export interface AnswerFinding<Answer extends FilledAnswer = FilledAnswer> {
  readonly answer: Answer
  readonly description: string
  readonly about: RecordPointer | null
}

/** The defects the answers of an activity come to, in the order of the form. */
export function answerFindings<Answer extends FilledAnswer>(
  definition: FormDefinition,
  answers: readonly Answer[],
  context: LimitContext,
): readonly AnswerFinding<Answer>[] {
  const blockOf = blockPlaces(answers)
  const findings: AnswerFinding<Answer>[] = []

  for (const answer of inFormOrder(definition, answers)) {
    const found = answeredField(definition, answer)

    if (found === null) {
      continue
    }

    const where = placeOf(found, blockOf(answer))
    const remark = answer.remark?.trim() ?? ''
    let description: string | null = null

    if (found.field.kind === 'check_point' && answer.result === 'not_ok') {
      description = remark === '' ? `${where}: nicht in Ordnung.` : `${where}: ${remark}`
    }

    if (found.field.kind === 'measurement') {
      const field = found.field
      const verdict = answerVerdict(field, answer, context)
      const value = answer.value === null ? undefined : parsed(answer.value)

      if (verdict.within === false && typeof value === 'number') {
        const measured = forms.formatMeasured(value, field.unit, field.decimals)
        const source = verdict.source === null ? '' : ` (${verdict.source})`

        description = `${where}: ${measured} gemessen. ${verdict.text.slice(0, -1)}${source}.${
          remark === '' ? '' : ` ${remark}`
        }`
      }
    }

    if (description !== null) {
      findings.push({
        answer,
        description: description.slice(0, defectLimits.description).trim(),
        about: found.group === null ? (found.field.about ?? null) : null,
      })
    }
  }

  return findings
}

/** The answers in the order of their form: section by section, field by field, the blocks of a group by their keys. */
function inFormOrder<Answer extends FilledAnswer>(
  definition: FormDefinition,
  answers: readonly Answer[],
): Answer[] {
  const order = new Map<string, number>()

  for (const section of definition.sections) {
    for (const field of section.fields) {
      if (field.kind === 'group') {
        for (const nested of field.fields) {
          order.set(`${field.key}/${nested.key}`, order.size)
        }
      } else {
        order.set(field.key, order.size)
      }
    }
  }

  const rank = (answer: FilledAnswer) =>
    order.get(
      answer.groupKey === null ? answer.fieldKey : `${answer.groupKey}/${answer.fieldKey}`,
    ) ?? order.size

  return [...answers].sort(
    (left, right) => rank(left) - rank(right) || compare(left.blockKey ?? '', right.blockKey ?? ''),
  )
}

/** The words of "yes" and "no", as a form shows them and an evidence keeps them. */
const yesNo = { true: 'ja', false: 'nein' } as const

/** A value in words, as an evidence keeps it; none for a check point and a photo. */
function valueInWords(field: BlockField, value: FieldValue | undefined): string | null {
  if (value === undefined) {
    return null
  }

  switch (field.kind) {
    case 'text':
      return typeof value === 'string' ? value : null
    case 'number':
    case 'measurement':
    case 'meter_reading':
      return typeof value === 'number'
        ? forms.formatMeasured(value, field.unit, field.decimals)
        : null
    case 'choice':
      return field.options.find((option) => option.value === value)?.label ?? null
    case 'yes_no':
      return typeof value === 'boolean' ? yesNo[String(value) as 'true' | 'false'] : null
    default:
      return null
  }
}

/**
 * The answers of an activity as its evidence freezes them (ADR 0004, point
 * 3): in the order of the form, each with its section, its label, the group
 * and the place of its block, the value in words, a check point with its
 * result and remark, a measured value with its limit and where the limit
 * comes from, and a photo by the hash of its file. Nothing of it is read from
 * the records again.
 */
export function statedAnswers(
  definition: FormDefinition,
  answers: readonly FilledAnswer[],
  context: LimitContext & { readonly fileOf: (id: AttachmentId) => StatedFile | null },
): readonly StatedAnswer[] {
  const blockOf = blockPlaces(answers)
  const stated: StatedAnswer[] = []

  for (const answer of inFormOrder(definition, answers)) {
    const found = answeredField(definition, answer)

    if (found === null) {
      continue
    }

    const { field } = found
    const block = blockOf(answer)
    const verdict = field.kind === 'measurement' ? answerVerdict(field, answer, context) : null

    stated.push({
      section: found.section.title,
      label: field.label,
      group: found.group === null || block === null ? null : { label: found.group.label, block },
      kind: field.kind,
      value: valueInWords(field, answerValue(field, answer)),
      result: field.kind === 'check_point' ? answer.result : null,
      remark: answer.remark,
      limit:
        verdict === null || verdict.limitMilli === null
          ? null
          : { text: verdict.text, source: verdict.source, within: verdict.within },
      photo: answer.attachmentId === null ? null : context.fileOf(answer.attachmentId),
    })
  }

  return stated
}

/**
 * The form an activity is filled in, as the catalogue holds the version the
 * activity names: null for an activity without a form, undefined for a
 * version the catalogue does not know, which nobody can fill in or sign.
 */
export function formOfActivity(
  catalogue: Pick<Catalogue, 'formVersion'>,
  activity: { readonly formKey: string | null; readonly formVersion: number | null },
): FormDefinition | null | undefined {
  if (activity.formKey === null || activity.formVersion === null) {
    return null
  }

  const entry = catalogue.formVersion(activity.formKey, activity.formVersion)

  return entry === null
    ? undefined
    : {
        key: entry.key,
        version: entry.version,
        title: entry.definition.title,
        sections: entry.definition.sections,
      }
}
