import {
  type AttachmentId,
  type BlockCircuit,
  type CheckPointResult,
  type CircuitFacts,
  checkPointResults,
  type FieldValue,
  type FormValues,
  type GroupBlock,
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
import type { AssetId } from './asset.js'
import { defectLimits } from './defect.js'
import { circuitProtectionWords, type ChartedCircuit } from './electrical.js'
import type { StatedAnswer, StatedAnswerAsset, StatedCircuit, StatedFile } from './evidence.js'
import { oneOf, type Problems } from './fields.js'
import {
  type BlockField,
  blockKeys,
  type FormDefinition,
  type FormSection,
  forms,
  type GroupField,
  type MeasurementField,
  type WorkedOutLimitKind,
  workedOutLimits,
} from './forms.js'
import type { PropertyId } from './location.js'
import type { FormVersions } from './round-template.js'

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
  /** The photos of one point, the first among them (#451). */
  photos: 20,
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
  /**
   * The photos of the point after the first, in the order they were added
   * (#451): documents at the activity like the first, and only beside one.
   * Empty for every answer from before, whose page they do not change.
   */
  readonly moreAttachmentIds: readonly AttachmentId[]
  /**
   * The asset an answer to a point for every asset of a kind is about (#343):
   * one of those its round was given for the point, and null for every
   * other answer. A point for every asset is answered once for each of them.
   */
  readonly assetId: AssetId | null
}

/**
 * Where an answer stands in its form: the field, in a repeating group the
 * group and its block, and for a point for every asset of a kind the asset.
 * An answer that says no asset is about none.
 */
export type AnswerPoint = Pick<ActivityAnswer, 'groupKey' | 'blockKey' | 'fieldKey'> & {
  readonly assetId?: AssetId | null
}

/**
 * The assets a round asks a point for every asset of a kind about (#343), by
 * the key of the point, in the order the round shows them: fixed when the
 * round is made, from the assets of the kind under the place of its plan.
 */
export type PointAssets = Readonly<Record<string, readonly string[]>>

/** The kind of asset a point asks about each of, where it is a point for every asset of a kind (#343). */
export function everyAssetOf(field: object): string | null {
  const kind = (field as { readonly everyAssetOf?: unknown }).everyAssetOf

  return typeof kind === 'string' ? kind : null
}

/** The asset an answer is about, null for one about none. */
export function assetOfAnswer(answer: AnswerPoint): string | null {
  return answer.assetId ?? null
}

/**
 * What an answer says, as the form and the engine read it. The photos after
 * the first are not there where an answer has none (#451).
 */
export type AnswerContent = Pick<ActivityAnswer, 'value' | 'result' | 'remark' | 'attachmentId'> & {
  readonly moreAttachmentIds?: readonly AttachmentId[]
}

/** The photos of an answer, the first and those after it, in their order (#451). */
export function photosOfAnswer(answer: AnswerContent): AttachmentId[] {
  return [
    ...(answer.attachmentId === null ? [] : [answer.attachmentId]),
    ...(answer.moreAttachmentIds ?? []),
  ]
}

/**
 * The photos of an answer as its two columns hold them: the first, and those
 * after it (#451). A photo taken out moves the next one up.
 */
export function photoColumns(
  photos: readonly AttachmentId[],
): Required<Pick<AnswerContent, 'attachmentId' | 'moreAttachmentIds'>> {
  return { attachmentId: photos[0] ?? null, moreAttachmentIds: photos.slice(1) }
}

/** An answer as far as its form asks it. */
export type FilledAnswer = AnswerPoint & AnswerContent

/**
 * A circuit of the installation as the answers of a form are judged with it
 * (#350): its id, which is the key of its block in a group over the
 * circuits, how it is named on paper and what its limits are worked out
 * from, the designation of the board it is on, and its place in the order of
 * the circuit chart, counted from nought. The page that is signed holds the
 * circuits so, and the answers are judged against that page.
 */
export type AnswerCircuit = BlockCircuit & {
  readonly id: string
  readonly board: string
  readonly place: number
}

/** The circuits an activity is asked about, none where nobody gave any. */
type Circuits = readonly AnswerCircuit[] | null | undefined

/** Whether a group repeats over the circuits of the installation (#350). */
function overCircuits(group: GroupField | null): boolean {
  return group !== null && group.repeat === 'circuits'
}

/**
 * What the sync says to an answer in a group over the circuits for a circuit
 * that is not one of the asset of the activity (#350), on the device and on
 * the server alike.
 */
export function foreignCircuitWords(groupLabel: string): string {
  return `„${groupLabel}“ fragt nur nach den Stromkreisen der Anlage des Vorgangs.`
}

/** Whether a form has a group over the circuits of the installation (#350). */
export function asksCircuits(definition: Pick<FormDefinition, 'sections'>): boolean {
  return definition.sections.some((section) =>
    section.fields.some((field) => field.kind === 'group' && overCircuits(field)),
  )
}

/**
 * Whether the page of an activity names the circuits of its asset (#350):
 * where the form of the activity, out of the catalogue, has a group over the
 * circuits and the activity has an asset. Device and server ask the same
 * catalogue, so that both work out the same page; a template of a round has
 * no such group.
 */
export function pageAsksCircuits(
  catalogue: FormVersions | null | undefined,
  activity: {
    readonly formKey: string | null
    readonly formVersion: number | null
    readonly assetId: string | null
  },
): boolean {
  if (catalogue === null || catalogue === undefined || activity.assetId === null) {
    return false
  }

  const definition = formOfActivity(catalogue, activity)

  return definition !== null && definition !== undefined && asksCircuits(definition)
}

/**
 * The circuit an answer in a block of a group over the circuits is about,
 * found by the key of its block among the circuits given; null for an
 * answer in any other place, and for one about a circuit not among them.
 */
function circuitOf(
  found: AnsweredField | null,
  point: AnswerPoint,
  circuits: Circuits,
): AnswerCircuit | null {
  if (found === null || !overCircuits(found.group) || point.blockKey === null) {
    return null
  }

  return circuits?.find((circuit) => circuit.id === point.blockKey) ?? null
}

/** The circuit an answer of a form is about (#350), among those given, or null. */
export function circuitOfAnswer(
  definition: FormDefinition,
  point: AnswerPoint,
  circuits: Circuits,
): AnswerCircuit | null {
  return circuitOf(answeredField(definition, point), point, circuits)
}

/** What a block keeps of its circuit: how it is named and what its limits are worked out from. */
function blockCircuitOf(circuit: AnswerCircuit): BlockCircuit {
  return {
    designation: circuit.designation,
    consumer: circuit.consumer,
    tripCharacteristic: circuit.tripCharacteristic,
    ratedCurrentMilli: circuit.ratedCurrentMilli,
    ratedResidualCurrentMilli: circuit.ratedResidualCurrentMilli,
  }
}

/** A circuit in words, as the chart names it: "F3 Steckdosen Werkbank". */
function circuitWords(circuit: AnswerCircuit): string {
  const consumer = circuit.consumer?.trim() ?? ''

  return consumer === '' ? circuit.designation : `${circuit.designation} ${consumer}`
}

/** Small letters, digits and underscores, the shape of a key of a field in a form. */
const fieldKeyShape = /^[a-z][a-z0-9_]*$/

/**
 * The key of a block, which the device draws when a block is opened: letters,
 * digits, hyphens and underscores, a UUID among them. Blocks stand in the
 * order of their keys, on the device and on the server alike.
 */
const blockKeyShape = /^[A-Za-z0-9_-]+$/

/** The shape of the key of an asset: a UUID, in small letters as the database writes it. */
const assetIdShape = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

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

  const asset = answer['assetId']

  if (asset !== undefined && asset !== null) {
    if (typeof asset !== 'string' || !assetIdShape.test(asset)) {
      problems['assetId'] = 'Das ist keine Anlage.'
    } else if (group !== undefined && group !== null) {
      problems['assetId'] = 'Eine Antwort zu einer Anlage steht in keiner Gruppe.'
    }
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
  const more = answer.moreAttachmentIds ?? []

  // More than one photo at a check point and at a photo field, and only
  // beside the first (#451).
  if (more.length > 0) {
    if (field.kind !== 'check_point' && field.kind !== 'photo') {
      return `${label}: Fotos nur an einem Prüfpunkt und an einem Foto.`
    }

    if (answer.attachmentId === null) {
      return `${label}: weitere Fotos nur neben einem ersten.`
    }

    const photos = photosOfAnswer(answer)

    if (photos.length > answerLimits.photos) {
      return `${label}: höchstens ${String(answerLimits.photos)} Fotos.`
    }

    if (new Set(photos).size !== photos.length) {
      return `${label}: jedes Foto nur einmal.`
    }
  }

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
 *
 * An answer to a point for every asset of a kind names one of its assets,
 * of those the round was given where they are handed in (#343); every
 * other answer names none.
 *
 * An answer in a group over the circuits stands in the block of one of the
 * circuits of the installation, where they are handed in (#350): the key of
 * its block is the id of the circuit.
 */
export function answerFitProblem(
  definition: FormDefinition,
  answer: FilledAnswer,
  pointAssets?: PointAssets | null,
  circuits?: readonly { readonly id: string }[] | null,
): string | null {
  const found = answeredField(definition, answer)

  if (found === null) {
    return answer.groupKey === null
      ? `Das Feld ${answer.fieldKey} gibt es in ${definition.title} nicht.`
      : `Das Feld ${answer.fieldKey} gibt es in der Gruppe ${answer.groupKey} von ${definition.title} nicht.`
  }

  const asset = assetOfAnswer(answer)
  const every = found.group === null ? everyAssetOf(found.field) : null

  if (every === null && asset !== null) {
    return `Der Punkt „${found.field.label}“ fragt nach keiner Anlage.`
  }

  if (every !== null && asset === null) {
    return `Der Punkt „${found.field.label}“ wird für jede seiner Anlagen beantwortet, die Antwort nennt ihre Anlage.`
  }

  if (
    asset !== null &&
    pointAssets !== undefined &&
    !(pointAssets?.[found.field.key] ?? []).includes(asset)
  ) {
    return `Nach dieser Anlage fragt der Punkt „${found.field.label}“ in diesem Rundgang nicht.`
  }

  if (
    found.group !== null &&
    overCircuits(found.group) &&
    circuits !== undefined &&
    !(circuits ?? []).some((circuit) => circuit.id === answer.blockKey)
  ) {
    return foreignCircuitWords(found.group.label)
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
 *
 * A block of a group over the circuits carries its circuit, under the keys
 * the engine keeps an item under (#350). A block of a circuit that is not
 * among those given is left out, since the engine would refuse it, and
 * `answersMissing` names it.
 */
export function formValuesOf(
  definition: FormDefinition,
  answers: readonly FilledAnswer[],
  circuits?: readonly AnswerCircuit[] | null,
): FormValues {
  const values: Record<string, FieldValue | readonly GroupBlock[]> = {}
  const groups = new Map<string, Map<string, Record<string, FieldValue>>>()
  const circuitOfBlock = new Map<string, AnswerCircuit>()

  for (const answer of answers) {
    const found = answeredField(definition, answer)
    const value = found === null ? undefined : answerValue(found.field, answer)

    // A point for every asset has many answers under one key (#343): the
    // engine asks none of them, `answersMissing` asks each.
    if (found === null || value === undefined || assetOfAnswer(answer) !== null) {
      continue
    }

    if (found.group === null || answer.groupKey === null || answer.blockKey === null) {
      values[answer.fieldKey] = value
      continue
    }

    if (overCircuits(found.group)) {
      const circuit = circuitOf(found, answer, circuits)

      if (circuit === null) {
        continue
      }

      circuitOfBlock.set(`${answer.groupKey}/${answer.blockKey}`, circuit)
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
      .map(([key, block]): GroupBlock => {
        const circuit = circuitOfBlock.get(`${groupKey}/${key}`)

        return circuit === undefined
          ? { values: block }
          : ({
              [blockKeys.id]: key,
              [blockKeys.item]: blockCircuitOf(circuit),
              values: block,
            } as GroupBlock)
      })
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
    .filter((answer) => assetOfAnswer(answer) === null)
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

/**
 * What the answers of a round are asked with beside the limits (#343): the
 * assets it asks each point for every asset about, and how an asset is
 * named in a sentence. Without them such a point asks about no asset, and an
 * asset is named by its place among those of its point.
 *
 * What the answers of a form with a group over the circuits are asked with
 * (#350): the circuits of the installation, as the page that is signed holds
 * them. A measured value in the block of a circuit is judged with the facts
 * of that circuit, every circuit needs its answers before the signature, and
 * a block of a circuit not among them is one too many. Without them a group
 * over the circuits has no circuit to answer for.
 */
export interface AnswersContext extends LimitContext {
  readonly pointAssets?: PointAssets | null
  readonly assetName?: (id: string) => string | null
  readonly circuits?: readonly AnswerCircuit[] | null
}

/** An asset of a point for every asset in words: its name, or its place among the assets of the point. */
function assetWords(context: AnswersContext, fieldKey: string, asset: string): string {
  const place = (context.pointAssets?.[fieldKey] ?? []).indexOf(asset) + 1

  return context.assetName?.(asset) ?? (place > 0 ? `Anlage ${String(place)}` : 'Anlage')
}

/**
 * How a measured answer stands against the limit of its field. A value in the
 * block of a circuit is judged with the facts of that circuit (#350), which
 * a limit worked out of the circuit needs.
 */
export function answerVerdict(
  field: MeasurementField,
  answer: AnswerContent,
  context: LimitContext & { readonly circuit?: CircuitFacts | null },
): LimitVerdict {
  const value = answer.value === null ? undefined : parsed(answer.value)

  return forms.limitVerdict(field, typeof value === 'number' ? value : null, {
    rules: context.rules,
    on: context.on,
    item: context.circuit ?? null,
  })
}

/**
 * Where a field stands, in words: its label, in a group the group and the
 * place of its block, for a point for every asset the asset, and in the
 * block of a circuit the group and the circuit (#350).
 */
function placeOf(
  found: AnsweredField,
  block: number | null,
  asset: string | null = null,
  circuit: AnswerCircuit | null = null,
): string {
  if (asset !== null) {
    return `${found.field.label}, ${asset}`
  }

  if (found.group !== null && circuit !== null) {
    return `${found.group.label}, ${circuitWords(circuit)}: ${found.field.label}`
  }

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
 *
 * A group over the circuits needs the answers it asks for every circuit of
 * the installation, named by the circuit, whether a block holds any yet or
 * not, and a block of a circuit the installation does not have is missing
 * its circuit (#350).
 */
export function answersMissing(
  definition: FormDefinition,
  answers: readonly FilledAnswer[],
  context: AnswersContext,
): readonly string[] {
  // A point for every asset is asked below, once for each of its assets
  // (#343), and a group over the circuits once for each circuit, by its name
  // (#350); the engine is asked about the rest.
  const asked = withoutCircuitGroups(withoutEveryAsset(definition))
  const missing = [
    ...forms.sealProblems(asked, formValuesOf(asked, answers), {
      seal: false,
      items: {},
    }),
  ]

  for (const section of definition.sections) {
    for (const field of section.fields) {
      if (field.kind === 'group' || field.kind === 'signature' || everyAssetOf(field) === null) {
        continue
      }

      for (const asset of context.pointAssets?.[field.key] ?? []) {
        const given = answers.find(
          (answer) =>
            answer.groupKey === null &&
            answer.fieldKey === field.key &&
            assetOfAnswer(answer) === asset,
        )
        const value = given === undefined ? undefined : answerValue(field, given)
        const label = placeOf(
          { section, group: null, field },
          null,
          assetWords(context, field.key, asset),
        )

        missing.push(
          ...forms.sealProblems(
            { ...definition, sections: [{ ...section, fields: [{ ...field, label }] }] },
            value === undefined ? {} : { [field.key]: value },
            { seal: false, items: {} },
          ),
        )
      }
    }
  }

  missing.push(...circuitsMissing(definition, answers, context.circuits))

  const blockOf = blockPlaces(answers)

  for (const answer of answers) {
    const found = answeredField(definition, answer)
    const asset = assetOfAnswer(answer)
    const circuit = circuitOf(found, answer, context.circuits)

    if (
      found?.field.kind === 'measurement' &&
      answerVerdict(found.field, answer, { ...context, circuit }).within === false &&
      (answer.remark ?? '').trim() === ''
    ) {
      missing.push(
        `${placeOf(found, blockOf(answer), asset === null ? null : assetWords(context, answer.fieldKey, asset), circuit)}: außerhalb des Grenzwerts, die Bemerkung fehlt.`,
      )
    }
  }

  return missing
}

/**
 * What a group over the circuits misses (#350): for every circuit given, in
 * the order of the chart, the answers its block needs, each named with the
 * group and the circuit, and a block of a circuit that is not among them.
 */
function circuitsMissing(
  definition: FormDefinition,
  answers: readonly FilledAnswer[],
  circuits: Circuits,
): readonly string[] {
  const missing: string[] = []
  const inChartOrder = [...(circuits ?? [])].sort((left, right) => left.place - right.place)

  for (const section of definition.sections) {
    for (const group of section.fields) {
      if (group.kind !== 'group' || !overCircuits(group)) {
        continue
      }

      const blocks = new Map<string, Record<string, FieldValue>>()

      for (const answer of answers) {
        const found = answeredField(definition, answer)
        const value = found === null ? undefined : answerValue(found.field, answer)

        if (found?.group?.key !== group.key || answer.blockKey === null) {
          continue
        }

        const block = blocks.get(answer.blockKey) ?? {}

        if (value !== undefined) {
          block[answer.fieldKey] = value
        }

        blocks.set(answer.blockKey, block)
      }

      for (const circuit of inChartOrder) {
        const where = `${group.label}, ${circuitWords(circuit)}`

        // The fields of the block as fields of their own, each named with
        // the group and the circuit: the engine then asks of them what it
        // asks of a block, and says where.
        missing.push(
          ...forms.sealProblems(
            {
              ...definition,
              sections: [
                {
                  ...section,
                  fields: group.fields.map((field) => ({
                    ...field,
                    label: `${where}: ${field.label}`,
                  })),
                },
              ],
            },
            blocks.get(circuit.id) ?? {},
            { seal: false, items: {} },
          ),
        )
      }

      for (const key of blocks.keys()) {
        if (!inChartOrder.some((circuit) => circuit.id === key)) {
          missing.push(`${group.label}: Antworten zu einem Stromkreis, den die Anlage nicht hat.`)
        }
      }
    }
  }

  return missing
}

/** A form without its groups over the circuits, which the engine is asked about circuit by circuit (#350). */
function withoutCircuitGroups(definition: FormDefinition): FormDefinition {
  return {
    ...definition,
    sections: definition.sections.map((section) => ({
      ...section,
      fields: section.fields.filter((field) => field.kind !== 'group' || !overCircuits(field)),
    })),
  }
}

/** A form without its points for every asset, which the engine is not asked about (#343). */
function withoutEveryAsset(definition: FormDefinition): FormDefinition {
  return {
    ...definition,
    sections: definition.sections.map((section) => ({
      ...section,
      fields: section.fields.filter((field) => everyAssetOf(field) === null),
    })),
  }
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
  /**
   * The circuit of the block the answer stands in (#350): a defect at the
   * installation, with the circuit it was found on. None for every other
   * answer.
   */
  readonly circuitId?: string
}

/** The defects the answers of an activity come to, in the order of the form. */
export function answerFindings<Answer extends FilledAnswer>(
  definition: FormDefinition,
  answers: readonly Answer[],
  context: AnswersContext,
): readonly AnswerFinding<Answer>[] {
  const blockOf = blockPlaces(answers)
  const findings: AnswerFinding<Answer>[] = []

  for (const answer of inFormOrder(definition, answers, context.pointAssets, context.circuits)) {
    const found = answeredField(definition, answer)

    if (found === null) {
      continue
    }

    const circuit = circuitOf(found, answer, context.circuits)
    const where = placeOf(found, blockOf(answer), null, circuit)
    const remark = answer.remark?.trim() ?? ''
    let description: string | null = null

    if (found.field.kind === 'check_point' && answer.result === 'not_ok') {
      description = remark === '' ? `${where}: nicht in Ordnung.` : `${where}: ${remark}`
    }

    if (found.field.kind === 'measurement') {
      const field = found.field
      const verdict = answerVerdict(field, answer, { ...context, circuit })
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
        // An answer about one asset of a point for every asset is found at
        // that asset (#343).
        about: aboutOf(found, answer),
        // One in the block of a circuit at the installation, with its circuit (#350).
        ...(circuit === null ? {} : { circuitId: circuit.id }),
      })
    }
  }

  return findings
}

/** A reading a point of a form gives its measuring point. */
export interface AnswerReading<Answer extends FilledAnswer = FilledAnswer> {
  readonly answer: Answer
  readonly assetId: string
  readonly valueMilli: number
}

/**
 * The readings the answers of an activity give (section 4.9 of the concept,
 * #120): a point "Zählerstand" about an asset, outside a group, answered with
 * a figure, in thousandths, in the order of the form. Whether the asset is a
 * measuring point that takes the reading is the server's to ask.
 */
export function answerReadings<Answer extends FilledAnswer>(
  definition: FormDefinition,
  answers: readonly Answer[],
): readonly AnswerReading<Answer>[] {
  return inFormOrder(definition, answers).flatMap((answer) => {
    const found = answeredField(definition, answer)
    const value = answer.value === null ? undefined : parsed(answer.value)

    return found !== null &&
      found.group === null &&
      found.field.kind === 'meter_reading' &&
      found.field.about?.kind === 'asset' &&
      typeof value === 'number' &&
      Number.isInteger(value) &&
      value >= 0
      ? [{ answer, assetId: found.field.about.id, valueMilli: value }]
      : []
  })
}

/**
 * The answers in the order of their form: section by section, field by field,
 * the blocks of a group by their keys, and those of a group over the
 * circuits in the order of the chart (#350).
 */
function inFormOrder<Answer extends FilledAnswer>(
  definition: FormDefinition,
  answers: readonly Answer[],
  pointAssets: PointAssets | null = null,
  circuits: Circuits = null,
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

  // The answers of a point for every asset in the order of its assets (#343).
  const place = (answer: FilledAnswer) => {
    const asset = assetOfAnswer(answer)

    return asset === null ? 0 : (pointAssets?.[answer.fieldKey] ?? []).indexOf(asset)
  }

  // The answers of a group over the circuits by the place of their circuit
  // on the chart, a circuit the chart no longer has after every one it has.
  const places = new Map(
    answers.map((answer) => [
      answer,
      circuitOfAnswer(definition, answer, circuits)?.place ?? Number.MAX_SAFE_INTEGER,
    ]),
  )
  const onChart = (answer: Answer) => places.get(answer) ?? Number.MAX_SAFE_INTEGER

  return [...answers].sort(
    (left, right) =>
      rank(left) - rank(right) ||
      onChart(left) - onChart(right) ||
      compare(left.blockKey ?? '', right.blockKey ?? '') ||
      place(left) - place(right) ||
      compare(assetOfAnswer(left) ?? '', assetOfAnswer(right) ?? ''),
  )
}

/** The asset or the room an answer is about: the asset of a point for every asset, else what its field names outside a group. */
function aboutOf(found: AnsweredField, answer: FilledAnswer): RecordPointer | null {
  const asset = assetOfAnswer(answer)

  if (asset !== null) {
    return { kind: 'asset', id: asset }
  }

  return found.group === null ? (found.field.about ?? null) : null
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
 * The photos of an answer after the first, as an evidence keeps them (#451):
 * nothing where there are none, so that a state says what it said before.
 */
function morePhotosOf(
  answer: AnswerContent,
  fileOf: (id: AttachmentId) => StatedFile | null,
): { readonly morePhotos?: readonly StatedFile[] } {
  const files = (answer.moreAttachmentIds ?? [])
    .map((id) => fileOf(id))
    .filter((file): file is StatedFile => file !== null)

  return files.length === 0 ? {} : { morePhotos: files }
}

/**
 * The answers of an activity as its evidence freezes them (ADR 0004, point
 * 3): in the order of the form, each with its section, its label, the group
 * and the place of its block, the value in words, a check point with its
 * result and remark, a measured value with its limit and where the limit
 * comes from, and a photo by the hash of its file. Nothing of it is read from
 * the records again.
 *
 * An answer about one asset of a point for every asset names the asset as it
 * stood (#343), number and name, in the order of the assets of the round.
 * The photos after the first follow it where there are any (#451).
 */
export function statedAnswers(
  definition: FormDefinition,
  answers: readonly FilledAnswer[],
  context: AnswersContext & {
    readonly fileOf: (id: AttachmentId) => StatedFile | null
    readonly assetOf?: (id: string) => StatedAnswerAsset | null
  },
): readonly StatedAnswer[] {
  const blockOf = blockPlaces(answers)
  const stated: StatedAnswer[] = []

  for (const answer of inFormOrder(definition, answers, context.pointAssets, context.circuits)) {
    const found = answeredField(definition, answer)

    if (found === null) {
      continue
    }

    const { field } = found
    const circuit = circuitOf(found, answer, context.circuits)
    // The block of a circuit stands at the place of its circuit on the chart (#350).
    const block = circuit === null ? blockOf(answer) : circuit.place + 1
    const verdict =
      field.kind === 'measurement' ? answerVerdict(field, answer, { ...context, circuit }) : null
    const asset = assetOfAnswer(answer)
    const workedOut = field.kind === 'measurement' ? workedOutKind(field) : null

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
          : {
              text: verdict.text,
              source: verdict.source,
              within: verdict.within,
              // The limit itself beside the value in the table of the circuits (#350).
              ...(circuit === null ? {} : boundOf(verdict.text)),
            },
      photo: answer.attachmentId === null ? null : context.fileOf(answer.attachmentId),
      ...morePhotosOf(answer, context.fileOf),
      ...(asset === null
        ? {}
        : {
            asset: context.assetOf?.(asset) ?? {
              number: null,
              name: assetWords(context, answer.fieldKey, asset),
            },
          }),
      // The circuit of its block, by its key (#350), and how a limit worked
      // out of the circuit comes about, also where the circuit gave none.
      ...(circuit === null
        ? {}
        : { circuit: circuit.id, ...(workedOut === null ? {} : { workedOut }) }),
    })
  }

  return stated
}

/** The kind of a limit worked out of the circuit a measured value is about, or null (#350). */
function workedOutKind(field: MeasurementField): WorkedOutLimitKind | null {
  const kind = field.limit?.kind

  return kind !== undefined && Object.hasOwn(workedOutLimits, kind)
    ? (kind as WorkedOutLimitKind)
    : null
}

/**
 * The limit of a verdict without the verdict, `höchstens 2,87 Ω`, out of the
 * sentence the engine says it in: "Grenzwert: …", "Innerhalb des
 * Grenzwerts, …" or "Außerhalb des Grenzwerts, …". Nothing where the
 * sentence is none of them.
 */
export function boundOf(text: string): { readonly bound?: string } {
  const found = /^(?:Grenzwert: |(?:Innerhalb|Außerhalb) des Grenzwerts, )(.+)\.$/.exec(text)

  return found?.[1] === undefined ? {} : { bound: found[1] }
}

/**
 * The circuits of an installation as an evidence keeps them (#350): in the
 * order of the chart, each with its board and the kind of the board, its
 * designation and what it supplies, and what protects it in words.
 */
export function statedCircuitsOf(circuits: readonly ChartedCircuit[]): readonly StatedCircuit[] {
  return [...circuits]
    .sort((left, right) => left.place - right.place)
    .map((circuit) => ({
      id: circuit.id,
      board: circuit.board,
      boardKind: circuit.boardKind,
      designation: circuit.designation,
      consumer: circuit.consumer,
      protection: circuitProtectionWords(circuit),
      place: circuit.place,
    }))
}

/**
 * The form an activity is filled in, in the version the activity names: out
 * of the catalogue, or for a round the version of its template, which the
 * caller gives beside the catalogue (`withTemplates`). Null for an activity
 * without a form, undefined for a version nobody here knows, which nobody can
 * fill in or sign.
 */
export function formOfActivity(
  catalogue: FormVersions,
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
