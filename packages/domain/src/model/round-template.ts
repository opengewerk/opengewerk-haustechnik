import {
  checkPointResultLabel,
  type FormUnit,
  type Id,
  type RuleLimit,
  type RuleUnit,
  type Synced,
} from '@opengewerk/platform-domain'

import { type AnswerContent, answerVerdict, type LimitContext } from './answer.js'
import type { DutyId } from './duty-record.js'
import { evidenceLimits, type EvidenceResult } from './evidence.js'
import type { Problems } from './fields.js'
import {
  type BlockField,
  type FormDefinition,
  type FormRecordKind,
  formRecordKinds,
  formUnits,
  forms,
  isStatedLimit,
  type MeasurementField,
  type StatedLimit,
} from './forms.js'

/**
 * The templates of the rounds of an operator (sections 2.5 and 4.5 of the
 * concept, #112): chapters and points, kept in the office as a form with
 * versions. A version once saved is never changed; a change is the next
 * version, and a round stays on the version it began in, because its
 * activity names the version (`formKey`, `formVersion`) and the answers name
 * the points of it.
 *
 * A template belongs to the operator and not to an area, but a point may be
 * about a certain asset or a certain room, and fulfil a certain duty there.
 * Who changes a template has to see every one of them, in the version that
 * stands and in the one that follows (decided on 04.10.2026), so a template
 * that points into an area is changed only by somebody who sees it.
 *
 * Both tables travel to every device of the operator, to read: a round is
 * filled on site in the version it names, without a network.
 */
export type RoundTemplateId = Id<'round_template'>
export type RoundTemplateVersionId = Id<'round_template_version'>

/** A template, whatever its versions say. */
export interface RoundTemplate extends Synced {
  readonly id: RoundTemplateId
  /**
   * The title of its newest version, written with it: what the list and the
   * change log call the template. The title a round shows is the one of its
   * own version.
   */
  readonly title: string
  /**
   * The template of a package it was taken over from, `<package>.<key>`, and
   * the version of it, both or neither (section 5 of the concept). What was
   * taken over is the operator's own from then on.
   */
  readonly sourceKey: string | null
  readonly sourceVersion: number | null
}

/**
 * A point of a template: a field of a form, and on request the duty it
 * fulfils (section 4.5). Its answer is then the evidence of that duty, with
 * no second entry; the duty is a certain one, at the asset or the room the
 * point is about, as the point is about a certain asset.
 */
export type TemplateField = (Exclude<BlockField, MeasurementField> | TemplateMeasurement) & {
  readonly fulfils?: DutyId
}

/** A measured value of a template, whose limit is a rule or a value the operator states. */
export type TemplateMeasurement = Omit<MeasurementField, 'limit'> & {
  readonly limit?: RuleLimit | StatedLimit
}

/** A chapter of a template: a title and its points, in order. */
export interface TemplateSection {
  readonly key: string
  readonly title: string
  readonly fields: readonly TemplateField[]
}

/** What a version says: the title and the chapters. Key and version are the row's. */
export interface TemplateDefinition {
  readonly title: string
  readonly sections: readonly TemplateSection[]
}

/** A version of a template, never changed once it is saved. */
export interface RoundTemplateVersion extends Synced {
  readonly id: RoundTemplateVersionId
  readonly templateId: RoundTemplateId
  /** Counted from one per template. Named so beside the version of the row the sync keeps. */
  readonly formVersion: number
  readonly definition: TemplateDefinition
  /**
   * Whether the evidence of a round counts only with the countersignature of
   * the site management besides the signature of whoever made it (4.5).
   */
  readonly asksCountersignature: boolean
}

/** The bounds of a template, the same in the editor, at the route and in the database. */
export const templateLimits = {
  title: 120,
  chapterTitle: 120,
  label: 200,
  hint: 300,
  chapters: 30,
  points: 200,
  options: 30,
  optionLabel: 80,
  /** The text of a version's definition as JSON, whole. */
  definition: 400_000,
} as const

const templateKeyPrefix = 'template-'
const uuidShape = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * The key an activity names the form of its round by. A form of a package is
 * always named `<package>.<key>`, with a dot, and this key never has one, so
 * the two never meet.
 */
export function templateFormKey(id: RoundTemplateId): string {
  return `${templateKeyPrefix}${id}`
}

/** The template a form key names, or null for a form of a package. */
export function templateOfFormKey(key: string): RoundTemplateId | null {
  const rest = key.startsWith(templateKeyPrefix) ? key.slice(templateKeyPrefix.length) : ''

  return uuidShape.test(rest) ? (rest as RoundTemplateId) : null
}

/** One version of a form by its key, as a catalogue answers and the templates beside it. */
export interface FormVersions {
  readonly formVersion: (
    key: string,
    version: number,
  ) => {
    readonly key: string
    readonly version: number
    readonly definition: Pick<FormDefinition, 'title' | 'sections'>
  } | null
}

/**
 * The forms of the catalogue and the versions of templates given beside it,
 * as one place to ask for the form of an activity: a key of a template is
 * answered by its versions, every other key by the catalogue.
 */
export function withTemplates(
  catalogue: FormVersions,
  versions: readonly Pick<RoundTemplateVersion, 'templateId' | 'formVersion' | 'definition'>[],
): FormVersions {
  return {
    formVersion: (key, version) => {
      const template = templateOfFormKey(key)

      if (template === null) {
        return catalogue.formVersion(key, version)
      }

      const found = versions.find(
        (entry) => entry.templateId === template && entry.formVersion === version,
      )

      return found ? { key, version, definition: found.definition } : null
    },
  }
}

/** The points of a template, in order, with the chapter each stands in. */
export function templatePoints(
  definition: TemplateDefinition,
): readonly { readonly section: TemplateSection; readonly field: TemplateField }[] {
  return definition.sections.flatMap((section) =>
    section.fields.map((field) => ({ section, field })),
  )
}

/** The point of a template that fulfils a duty, if one does. */
export function pointFulfilling(
  definition: Pick<FormDefinition, 'sections'>,
  duty: string,
): BlockField | null {
  for (const section of definition.sections) {
    for (const field of section.fields) {
      if (
        field.kind !== 'group' &&
        field.kind !== 'signature' &&
        (field as { readonly fulfils?: unknown }).fulfils === duty
      ) {
        return field
      }
    }
  }

  return null
}

/** What a template names outside itself: assets, rooms, duties and rules. */
export interface TemplatePointers {
  readonly assets: readonly string[]
  readonly rooms: readonly string[]
  readonly duties: readonly string[]
  readonly rules: readonly string[]
}

/** Every record and rule a template names, each once. */
export function templatePointers(definition: TemplateDefinition): TemplatePointers {
  const assets = new Set<string>()
  const rooms = new Set<string>()
  const duties = new Set<string>()
  const rules = new Set<string>()

  for (const { field } of templatePoints(definition)) {
    if (field.about?.kind === 'asset') {
      assets.add(field.about.id)
    } else if (field.about?.kind === 'room') {
      rooms.add(field.about.id)
    }

    if (typeof field.fulfils === 'string') {
      duties.add(field.fulfils)
    }

    if (field.kind === 'measurement' && field.limit && 'rule' in field.limit) {
      rules.add(field.limit.rule)
    }
  }

  return { assets: [...assets], rooms: [...rooms], duties: [...duties], rules: [...rules] }
}

/** A duty as a template asks about it: where it hangs, and whether a point of a round is evidence for it. */
export interface TemplateDuty {
  readonly assetId: string | null
  readonly roomId: string | null
  readonly takesRoundPoint: boolean
}

/**
 * What a template is checked against beside itself: the assets and rooms that
 * are there for the person and alive, the duties likewise, and the units of
 * the records of a rule, none for a rule the catalogue does not know.
 */
export interface TemplateRecords {
  readonly record: (kind: FormRecordKind, id: string) => boolean
  readonly duty: (id: string) => TemplateDuty | null
  readonly ruleUnits: (key: string) => readonly RuleUnit[] | null
}

/** A sentence of the engine about a field, with the field named by its label and not by its key. */
function engineSentence(sentence: string, prefix: string, field: { key: string; label: string }) {
  const bare = sentence.startsWith(`${prefix}: `) ? sentence.slice(prefix.length + 2) : sentence
  const named = bare.replace(new RegExp(`\\b${field.key}\\b`, 'g'), `„${field.label}“`)

  return named.charAt(0).toUpperCase() + named.slice(1)
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isText(value: unknown): value is string {
  return typeof value === 'string'
}

/**
 * Whether what arrives at a route has the shape of a definition at all: a
 * title, chapters with a key, a title and their points, each point with a
 * key, a kind and a label. What the points say beyond that is asked by
 * `templateProblems`, and by the engine.
 */
export function isTemplateDefinition(value: unknown): value is TemplateDefinition {
  return (
    isObject(value) &&
    isText(value['title']) &&
    Array.isArray(value['sections']) &&
    value['sections'].every(
      (section: unknown) =>
        isObject(section) &&
        isText(section['key']) &&
        isText(section['title']) &&
        Array.isArray(section['fields']) &&
        section['fields'].every(
          (field: unknown) =>
            isObject(field) &&
            isText(field['key']) &&
            isText(field['kind']) &&
            isText(field['label']) &&
            (field['fulfils'] === undefined || isText(field['fulfils'])),
        ),
    )
  )
}

/** A text the template has to have, trimmed, within its bound. */
function textProblem(value: string, most: number, subject: string): string | null {
  if (value.trim() === '') {
    return `${subject} fehlt.`
  }

  if (value.trim() !== value) {
    return `${subject} beginnt und endet nicht mit Leerzeichen.`
  }

  return value.length > most ? `${subject} hat höchstens ${String(most)} Zeichen.` : null
}

/** What is wrong with one point by what the engine does not know, as one sentence. */
function pointProblem(
  field: TemplateField,
  records: TemplateRecords,
  fulfilledBy: Map<string, string>,
): string | null {
  const label = textProblem(field.label, templateLimits.label, 'Die Bezeichnung')

  if (label !== null) {
    return label
  }

  if (field.hint !== undefined && field.hint.length > templateLimits.hint) {
    return `Der Hinweis hat höchstens ${String(templateLimits.hint)} Zeichen.`
  }

  if (field.kind === 'choice') {
    if (!Array.isArray(field.options) || field.options.length < 2) {
      return 'Eine Auswahl braucht mindestens zwei Möglichkeiten.'
    }

    if (field.options.length > templateLimits.options) {
      return `Eine Auswahl hat höchstens ${String(templateLimits.options)} Möglichkeiten.`
    }

    if (
      field.options.some(
        (option) =>
          typeof option.label !== 'string' || option.label.length > templateLimits.optionLabel,
      )
    ) {
      return `Eine Möglichkeit hat höchstens ${String(templateLimits.optionLabel)} Zeichen.`
    }
  }

  if (field.kind === 'measurement' && field.limit !== undefined) {
    const limit: unknown = field.limit

    if (isObject(limit) && limit['kind'] === 'stated') {
      if (!isStatedLimit(limit)) {
        return 'Ein eigener Grenzwert braucht einen Wert und seine Quelle.'
      }
    } else if (isObject(limit) && isText(limit['rule'])) {
      const units = records.ruleUnits(limit['rule'])
      const unit: FormUnit = formUnits[field.unit]
      const fits = unit.fromRule

      if (units === null || units.length === 0) {
        return 'Diese Regel kennt der Katalog nicht.'
      }

      if (!units.every((unit) => fits !== undefined && unit in fits)) {
        return 'Die Regel misst in einer anderen Einheit als der Punkt.'
      }
    }
  }

  if (field.about !== undefined && isObject(field.about)) {
    const { kind, id } = field.about

    if (
      (formRecordKinds as readonly string[]).includes(kind) &&
      typeof id === 'string' &&
      !records.record(kind as FormRecordKind, id)
    ) {
      return kind === 'asset'
        ? 'Die Anlage gibt es nicht mehr oder nicht in Ihren Bereichen.'
        : 'Den Raum gibt es nicht mehr oder nicht in Ihren Bereichen.'
    }
  }

  if (field.fulfils !== undefined) {
    if (
      field.kind !== 'check_point' &&
      !(field.kind === 'measurement' && field.limit !== undefined)
    ) {
      return 'Eine Pflicht erfüllt nur ein Prüfpunkt oder ein Messwert mit Grenzwert.'
    }

    if (field.kind === 'measurement' && field.required !== true) {
      return 'Ein Messwert, der eine Pflicht erfüllt, muss ausgefüllt werden.'
    }

    const duty = records.duty(field.fulfils)

    if (duty === null) {
      return 'Die Pflicht gibt es nicht mehr oder nicht in Ihren Bereichen.'
    }

    const at =
      field.about?.kind === 'asset'
        ? duty.assetId === field.about.id
        : field.about?.kind === 'room'
          ? duty.roomId === field.about.id
          : false

    if (!at) {
      return 'Ein Punkt, der eine Pflicht erfüllt, zeigt auf ihre Anlage oder ihren Raum.'
    }

    if (!duty.takesRoundPoint) {
      return 'Diese Pflicht nimmt keinen Punkt eines Rundgangs als Nachweis.'
    }

    const other = fulfilledBy.get(field.fulfils)

    if (other !== undefined && other !== field.key) {
      return 'Diese Pflicht erfüllt schon ein anderer Punkt.'
    }

    fulfilledBy.set(field.fulfils, field.key)
  }

  return null
}

/**
 * What is wrong with a version before it is saved (#112), one sentence per
 * place: `title`, `chapter.<key>`, `point.<key>` and `form` for what belongs
 * to no point. The editor shows each sentence at its place, and the route
 * refuses a version with any.
 *
 * Each point is asked twice: first what only this application knows, the
 * records it names, the duty it fulfils and the limit an operator states;
 * then by the form engine of the foundation, alone in a form of its own, so
 * that what the engine says lands at the point it is about. Last the engine
 * asks the whole version, for what lies between points, a key twice.
 */
export function templateProblems(
  definition: TemplateDefinition,
  records: TemplateRecords,
): Readonly<Problems> {
  const problems: Problems = {}
  const title = textProblem(definition.title, templateLimits.title, 'Die Bezeichnung')

  if (title !== null) {
    problems['title'] = title
  }

  if (definition.sections.length === 0) {
    problems['form'] = 'Eine Vorlage hat mindestens ein Kapitel.'
  } else if (definition.sections.length > templateLimits.chapters) {
    problems['form'] = `Eine Vorlage hat höchstens ${String(templateLimits.chapters)} Kapitel.`
  } else if (templatePoints(definition).length > templateLimits.points) {
    problems['form'] = `Eine Vorlage hat höchstens ${String(templateLimits.points)} Punkte.`
  }

  const fulfilledBy = new Map<string, string>()

  for (const section of definition.sections) {
    const chapter =
      textProblem(section.title, templateLimits.chapterTitle, 'Die Bezeichnung des Kapitels') ??
      (section.fields.length === 0 ? 'Das Kapitel hat keine Punkte.' : null)

    if (chapter !== null) {
      problems[`chapter.${section.key}`] = chapter
    }

    for (const field of section.fields) {
      const own = pointProblem(field, records, fulfilledBy)

      if (own !== null) {
        problems[`point.${field.key}`] = own
        continue
      }

      const [said] = forms.definitionProblems({
        key: 'point',
        version: 1,
        title: 'Punkt',
        sections: [{ key: 'point', title: 'Punkt', fields: [field] }],
      })

      if (said !== undefined) {
        problems[`point.${field.key}`] = engineSentence(said, 'point', field)
      }
    }
  }

  if (Object.keys(problems).length === 0) {
    const [said] = forms.definitionProblems({ key: 'template', version: 1, ...definition })

    if (said !== undefined) {
      problems['form'] = engineSentence(said, 'template', { key: 'template', label: 'Vorlage' })
    }
  }

  return problems
}

/** What a point found, as the evidence of the duty it fulfils states it. */
export interface PointOutcome {
  readonly result: EvidenceResult
  readonly reason: string | null
}

/**
 * The result of a duty out of the answer to the point that fulfils it
 * (section 4.5, #112): a check point in order is without defects and not in
 * order with defects; one that did not apply or could not be checked was not
 * performed, with its remark as the reason. A measured value within its limit
 * is without defects and outside it with defects. Null where the answer says
 * nothing: no answer, or a value with no limit on that day.
 */
export function pointOutcome(
  field: BlockField,
  answer: AnswerContent | null,
  context: LimitContext,
): PointOutcome | null {
  if (answer === null) {
    return null
  }

  if (field.kind === 'check_point') {
    switch (answer.result) {
      case 'ok':
        return { result: 'without_defects', reason: null }
      case 'not_ok':
        return { result: 'with_defects', reason: null }
      case 'not_applicable':
      case 'not_possible': {
        const said = `${checkPointResultLabel[answer.result]}: ${answer.remark ?? ''}`.trim()

        return {
          result: 'not_performed',
          reason: said.slice(0, evidenceLimits.resultReason),
        }
      }
      default:
        return null
    }
  }

  if (field.kind === 'measurement') {
    const verdict = answerVerdict(field, answer, context)

    return verdict.within === null
      ? null
      : { result: verdict.within ? 'without_defects' : 'with_defects', reason: null }
  }

  return null
}

/**
 * The problems of a version as lines that name their place, the point by its
 * label and the chapter by its title: what a route says when it refuses a
 * version, so that the editor names the field and the reason even for what
 * only the server knows.
 */
export function templateProblemLines(
  definition: TemplateDefinition,
  problems: Readonly<Problems>,
): readonly string[] {
  const points = templatePoints(definition)

  return Object.entries(problems).map(([place, sentence]) => {
    if (place === 'title') {
      return `Bezeichnung der Vorlage: ${sentence}`
    }

    const section = definition.sections.find((each) => place === `chapter.${each.key}`)

    if (section !== undefined) {
      return `Kapitel „${section.title}“: ${sentence}`
    }

    const point = points.find((each) => place === `point.${each.field.key}`)

    if (point === undefined) {
      return sentence
    }

    const named = `„${point.field.label}“`

    // A sentence of the engine names the point already.
    return sentence.includes(named) ? sentence : `${named}: ${sentence}`
  })
}

/** The properties a point keeps, by its kind, beside key, kind, label and hint. */
const pointProperties: Readonly<Record<string, readonly string[]>> = {
  text: ['multiline'],
  number: ['unit', 'decimals'],
  measurement: ['unit', 'decimals', 'limit'],
  choice: ['options'],
  yes_no: [],
  photo: [],
  check_point: [],
  meter_reading: ['unit', 'decimals'],
}

function picked(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): Record<string, unknown> {
  return Object.fromEntries(
    keys.filter((key) => value[key] !== undefined).map((key) => [key, value[key]]),
  )
}

/**
 * A version as it is stored: what a template says and nothing else. What
 * arrives at a route may carry anything beside it, and a version is kept for
 * as long as a round of it is; so each part keeps the properties its kind
 * has, a limit those of a rule or of a stated value, a choice its options by
 * value and label, a pointer its kind and id. Whatever is wrong with what is
 * kept is `templateProblems`' to say.
 */
export function storedTemplate(definition: TemplateDefinition): TemplateDefinition {
  return {
    title: definition.title,
    sections: definition.sections.map((section) => ({
      key: section.key,
      title: section.title,
      fields: section.fields.map((field) => {
        const raw = field as unknown as Readonly<Record<string, unknown>>
        const kept = picked(raw, [
          'key',
          'kind',
          'label',
          'hint',
          'required',
          'fulfils',
          ...(pointProperties[field.kind] ?? []),
        ])

        if (isObject(raw['about'])) {
          kept['about'] = picked(raw['about'], ['kind', 'id'])
        }

        if (isObject(raw['limit'])) {
          kept['limit'] = picked(
            raw['limit'],
            raw['limit']['kind'] === 'stated'
              ? ['kind', 'bound', 'milli', 'source']
              : ['kind', 'rule'],
          )
        }

        if (Array.isArray(raw['options'])) {
          kept['options'] = raw['options'].map((option: unknown) =>
            isObject(option) ? picked(option, ['value', 'label']) : option,
          )
        }

        return kept as unknown as TemplateField
      }),
    })),
  }
}
