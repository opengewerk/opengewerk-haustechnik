import {
  type AssetField,
  type AssetKind,
  type BuildingKind,
  buildingKinds,
  type CatalogueOrigin,
  catalogueOrigins,
  type Characteristic,
  type ChoiceOption,
  dutyBindingnesses,
  type DutyInterval,
  type DutyKind,
  dutyTasks,
  type EvidenceKind,
  evidenceKinds,
  type ExpectedDocument,
  type FederalState,
  federalStates,
  intervalKinds,
  type IsoDate,
  type PackagedForm,
  qualificationLevels,
  type Retention,
  retentionKinds,
  type RuleScope,
  ruleScopes,
  type RuleUnit,
  ruleUnits,
  type ScopeCondition,
} from '@opengewerk/haustechnik-domain'

import { keyMaximum, keyPattern } from './paths.js'

/**
 * The schema of every file a package holds, and the reading against it.
 *
 * Not a JSON Schema, for the reason the Handwerkersoftware gave in its
 * addendum to ADR 0004 there: what a package has to get right goes beyond the
 * shape of its data, and in JSON Schema all of that would be extensions, a
 * second language in the first. Instead every file is read here field by
 * field, and every finding is a German sentence that names the file and the
 * field, for whoever contributes without writing code (ADR 0005, point 16).
 *
 * A field the schema does not know is a finding too: a misspelt optional
 * field would otherwise be dropped without a word.
 */

/** Where a finding is: the file, and the field inside it if there is one. */
export interface Spot {
  readonly file: string
  readonly at: string
}

export function spotIn(file: string): Spot {
  return { file, at: '' }
}

function below(spot: Spot, step: string | number): Spot {
  const at =
    typeof step === 'number'
      ? `${spot.at}[${String(step)}]`
      : spot.at === ''
        ? step
        : `${spot.at}.${step}`

  return { file: spot.file, at }
}

/** The findings of one reading, each a sentence with its place in front. */
export class Findings {
  readonly problems: string[] = []

  say(spot: Spot, sentence: string): void {
    this.problems.push(
      spot.at === '' ? `${spot.file}: ${sentence}` : `${spot.file}, ${spot.at}: ${sentence}`,
    )
  }
}

type Fields = Readonly<Record<string, unknown>>

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** An object with exactly the fields the schema names, or nothing after saying why. */
function fields(
  value: unknown,
  spot: Spot,
  findings: Findings,
  known: readonly string[] | 'any',
): Fields | undefined {
  if (!isFields(value)) {
    findings.say(
      spot,
      spot.at === '' ? 'Die Datei enthält kein JSON-Objekt.' : 'Hier gehört ein Objekt hin.',
    )
    return undefined
  }

  if (known !== 'any') {
    for (const name of Object.keys(value)) {
      if (!known.includes(name)) {
        findings.say(below(spot, name), 'Dieses Feld gibt es hier nicht. Ein Tippfehler?')
      }
    }
  }

  return value
}

/** Says why a value is missing, and stands for it. */
function noted(findings: Findings, spot: Spot, sentence: string): undefined {
  findings.say(spot, sentence)
  return undefined
}

function missing(from: Fields, name: string): boolean {
  return from[name] === undefined
}

function text(
  from: Fields,
  name: string,
  spot: Spot,
  findings: Findings,
  missingSentence = 'Das Feld fehlt.',
): string | undefined {
  const value = from[name]

  if (typeof value !== 'string' || value.trim() === '') {
    findings.say(
      below(spot, name),
      value === undefined ? missingSentence : 'Hier gehört ein Text hin, der nicht leer ist.',
    )
    return undefined
  }

  return value
}

function optionalText(
  from: Fields,
  name: string,
  spot: Spot,
  findings: Findings,
): string | undefined {
  return missing(from, name) ? undefined : text(from, name, spot, findings)
}

/** Whether a text is a day of the calendar in ISO 8601, `2015-06-01` and not `2015-02-30`. */
export function isCalendarDay(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)

  if (!match) {
    return false
  }

  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)

  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  )
}

function day(from: Fields, name: string, spot: Spot, findings: Findings): IsoDate | undefined {
  const value = from[name]

  if (typeof value !== 'string' || !isCalendarDay(value)) {
    findings.say(
      below(spot, name),
      value === undefined ? 'Das Feld fehlt.' : 'Hier gehört ein Tag hin, geschrieben 2026-10-03.',
    )
    return undefined
  }

  return value
}

/** A day, or null for one that has not come: the end of a rule still in force. */
function dayOrNull(
  from: Fields,
  name: string,
  spot: Spot,
  findings: Findings,
): IsoDate | null | undefined {
  if (from[name] === null) {
    return null
  }

  if (missing(from, name)) {
    findings.say(below(spot, name), 'Das Feld fehlt; null, solange die Regel gilt.')
    return undefined
  }

  return day(from, name, spot, findings)
}

function oneOf<Value extends string>(
  from: Fields,
  name: string,
  values: readonly Value[],
  spot: Spot,
  findings: Findings,
  missingSentence = 'Das Feld fehlt.',
): Value | undefined {
  const value = from[name]

  if (typeof value !== 'string' || !(values as readonly string[]).includes(value)) {
    findings.say(
      below(spot, name),
      value === undefined
        ? missingSentence
        : `${JSON.stringify(value)} ist keiner der Werte ${values.join(', ')}.`,
    )
    return undefined
  }

  return value as Value
}

function isKey(value: unknown): value is string {
  return typeof value === 'string' && keyPattern.test(value) && value.length <= keyMaximum
}

const keySentence = `Ein Schlüssel hat kleine Buchstaben, Ziffern und Unterstriche, höchstens ${String(keyMaximum)} Zeichen, und beginnt mit einem Buchstaben.`

function key(from: Fields, name: string, spot: Spot, findings: Findings): string | undefined {
  const value = from[name]

  if (!isKey(value)) {
    findings.say(below(spot, name), value === undefined ? 'Das Feld fehlt.' : keySentence)
    return undefined
  }

  return value
}

/**
 * A reference to an entry or a rule: its key in the same package, or
 * `<package>.<key>` in another one.
 */
export const referencePattern = /^(?:[a-z][a-z0-9-]*\.)?[a-z][a-z0-9_]*$/

function reference(value: unknown, spot: Spot, findings: Findings): string | undefined {
  if (typeof value !== 'string' || !referencePattern.test(value)) {
    findings.say(
      spot,
      value === undefined
        ? 'Das Feld fehlt.'
        : 'Ein Verweis ist ein Schlüssel aus diesem Paket oder <paket>.<schlüssel> aus einem anderen.',
    )
    return undefined
  }

  return value
}

function list(
  from: Fields,
  name: string,
  spot: Spot,
  findings: Findings,
  needed: 'required' | 'optional',
): readonly unknown[] | undefined {
  const value = from[name]

  if (value === undefined && needed === 'optional') {
    return []
  }

  if (!Array.isArray(value)) {
    findings.say(
      below(spot, name),
      value === undefined ? 'Das Feld fehlt.' : 'Hier gehört eine Liste hin.',
    )
    return undefined
  }

  return value as readonly unknown[]
}

/** Says so when a value stands twice in a list where each belongs once. */
function once(values: readonly string[], spot: Spot, findings: Findings, noun: string): void {
  const seen = new Set<string>()

  for (const value of values) {
    if (seen.has(value)) {
      findings.say(spot, `${noun} ${value} steht zweimal da.`)
    }
    seen.add(value)
  }
}

function defined<Value>(values: readonly (Value | undefined)[]): values is readonly Value[] {
  return values.every((value) => value !== undefined)
}

function options(value: unknown, spot: Spot, findings: Findings): ChoiceOption[] | undefined {
  if (!Array.isArray(value) || value.length < 2) {
    findings.say(
      spot,
      value === undefined ? 'Das Feld fehlt.' : 'Eine Auswahl hat mindestens zwei Möglichkeiten.',
    )
    return undefined
  }

  const read = (value as readonly unknown[]).map((each, index) => {
    const at = below(spot, index)
    const option = fields(each, at, findings, ['value', 'label'])
    const optionValue = option ? key(option, 'value', at, findings) : undefined
    const label = option ? text(option, 'label', at, findings) : undefined

    return optionValue !== undefined && label !== undefined
      ? { value: optionValue, label }
      : undefined
  })

  const offered = read.filter((option): option is ChoiceOption => option !== undefined)

  if (offered.length !== read.length) {
    return undefined
  }

  once(
    offered.map((option) => option.value),
    spot,
    findings,
    'Der Wert',
  )

  return offered
}

/** What an asset of a kind carries: a characteristic a scope may ask about, or a field. */
function characteristic(
  value: unknown,
  spot: Spot,
  findings: Findings,
): Characteristic | undefined {
  const from = fields(value, spot, findings, ['key', 'label', 'kind', 'unit', 'options'])

  if (!from) {
    return undefined
  }

  const before = findings.problems.length
  const name = key(from, 'key', spot, findings)
  const label = text(from, 'label', spot, findings)
  const kind = oneOf(from, 'kind', ['number', 'flag', 'choice'] as const, spot, findings)

  if (kind !== 'number' && !missing(from, 'unit')) {
    findings.say(below(spot, 'unit'), 'Eine Einheit hat nur ein Merkmal mit einer Zahl.')
  }

  if (kind !== 'choice' && !missing(from, 'options')) {
    findings.say(below(spot, 'options'), 'Möglichkeiten hat nur ein Merkmal mit einer Auswahl.')
  }

  const unit =
    kind === 'number'
      ? oneOf(
          from,
          'unit',
          ruleUnits,
          spot,
          findings,
          'Das Feld fehlt. Ein Merkmal mit einer Zahl ist eine ganze Zahl in einer Einheit der Regel-Engine.',
        )
      : undefined
  const choices =
    kind === 'choice' ? options(from['options'], below(spot, 'options'), findings) : undefined

  if (findings.problems.length > before || name === undefined || label === undefined) {
    return undefined
  }

  switch (kind) {
    case 'number':
      return unit === undefined ? undefined : { key: name, label, kind, unit }
    case 'flag':
      return { key: name, label, kind }
    case 'choice':
      return choices === undefined ? undefined : { key: name, label, kind, options: choices }
    default:
      return undefined
  }
}

function assetField(value: unknown, spot: Spot, findings: Findings): AssetField | undefined {
  const from = fields(value, spot, findings, ['key', 'label', 'kind', 'unit', 'options'])

  if (!from) {
    return undefined
  }

  const before = findings.problems.length
  const name = key(from, 'key', spot, findings)
  const label = text(from, 'label', spot, findings)
  const kind = oneOf(
    from,
    'kind',
    ['text', 'number', 'date', 'flag', 'choice'] as const,
    spot,
    findings,
  )

  if (kind !== 'number' && !missing(from, 'unit')) {
    findings.say(below(spot, 'unit'), 'Eine Einheit hat nur ein Feld mit einer Zahl.')
  }

  if (kind !== 'choice' && !missing(from, 'options')) {
    findings.say(below(spot, 'options'), 'Möglichkeiten hat nur ein Feld mit einer Auswahl.')
  }

  const unit = kind === 'number' ? optionalText(from, 'unit', spot, findings) : undefined
  const choices =
    kind === 'choice' ? options(from['options'], below(spot, 'options'), findings) : undefined

  if (findings.problems.length > before || name === undefined || label === undefined) {
    return undefined
  }

  switch (kind) {
    case 'number':
      return unit === undefined ? { key: name, label, kind } : { key: name, label, kind, unit }
    case 'text':
    case 'date':
    case 'flag':
      return { key: name, label, kind }
    case 'choice':
      return choices === undefined ? undefined : { key: name, label, kind, options: choices }
    default:
      return undefined
  }
}

function expectedDocument(
  value: unknown,
  spot: Spot,
  findings: Findings,
): ExpectedDocument | undefined {
  const from = fields(value, spot, findings, ['key', 'label'])
  const name = from ? key(from, 'key', spot, findings) : undefined
  const label = from ? text(from, 'label', spot, findings) : undefined

  return name !== undefined && label !== undefined ? { key: name, label } : undefined
}

function each<Value>(
  values: readonly unknown[],
  spot: Spot,
  findings: Findings,
  read: (value: unknown, spot: Spot, findings: Findings) => Value | undefined,
): Value[] | undefined {
  const readValues = values.map((value, index) => read(value, below(spot, index), findings))

  return defined(readValues) ? [...readValues] : undefined
}

/** One version of an entry as its file states it, its references still those of its package. */
export interface ReadEntry<Definition> {
  readonly validFrom: IsoDate
  readonly definition: Definition
}

/** A cost group of DIN 276: three digits, the first one to eight. */
const costGroupPattern = /^[1-8][0-9]{2}$/

/** A version of an asset kind, `anlagenarten/<key>.v<n>.json`. */
export function readAssetKind(
  value: unknown,
  file: string,
  findings: Findings,
): ReadEntry<AssetKind> | undefined {
  const spot = spotIn(file)
  const from = fields(value, spot, findings, [
    'validFrom',
    'label',
    'costGroup',
    'characteristics',
    'fields',
    'expectedDocuments',
  ])

  if (!from) {
    return undefined
  }

  const before = findings.problems.length
  const validFrom = day(from, 'validFrom', spot, findings)
  const label = text(from, 'label', spot, findings)
  const costGroup = from['costGroup']

  if (typeof costGroup !== 'string' || !costGroupPattern.test(costGroup)) {
    findings.say(
      below(spot, 'costGroup'),
      costGroup === undefined
        ? 'Die Kostengruppe nach DIN 276 fehlt.'
        : 'Die Kostengruppe nach DIN 276 hat drei Ziffern, etwa "461" für Aufzugsanlagen.',
    )
  }

  const characteristicList = list(from, 'characteristics', spot, findings, 'optional')
  const fieldList = list(from, 'fields', spot, findings, 'optional')
  const documentList = list(from, 'expectedDocuments', spot, findings, 'optional')
  const characteristics = characteristicList
    ? each(characteristicList, below(spot, 'characteristics'), findings, characteristic)
    : undefined
  const assetFields = fieldList
    ? each(fieldList, below(spot, 'fields'), findings, assetField)
    : undefined
  const expectedDocuments = documentList
    ? each(documentList, below(spot, 'expectedDocuments'), findings, expectedDocument)
    : undefined

  if (characteristics && assetFields) {
    // A characteristic and a field are both values an asset carries, and one
    // name means one value.
    once(
      [...characteristics, ...assetFields].map((entry) => entry.key),
      spot,
      findings,
      'Der Schlüssel',
    )
  }

  if (expectedDocuments) {
    once(
      expectedDocuments.map((entry) => entry.key),
      below(spot, 'expectedDocuments'),
      findings,
      'Der Schlüssel',
    )
  }

  if (
    findings.problems.length > before ||
    validFrom === undefined ||
    label === undefined ||
    typeof costGroup !== 'string' ||
    characteristics === undefined ||
    assetFields === undefined ||
    expectedDocuments === undefined
  ) {
    return undefined
  }

  return {
    validFrom,
    definition: { label, costGroup, characteristics, fields: assetFields, expectedDocuments },
  }
}

function interval(
  value: unknown,
  spot: Spot,
  findings: Findings,
  origin: CatalogueOrigin | undefined,
): DutyInterval | undefined {
  const from = fields(value, spot, findings, ['kind', 'rule', 'legalClearance'])

  if (!from) {
    return undefined
  }

  const before = findings.problems.length
  const kind = oneOf(from, 'kind', intervalKinds, spot, findings)

  if (kind === 'none') {
    if (!missing(from, 'rule')) {
      findings.say(below(spot, 'rule'), 'Eine Frist ohne Vorgabe nennt keine Regel.')
    }

    if (!missing(from, 'legalClearance')) {
      findings.say(below(spot, 'legalClearance'), 'Eine Frist ohne Vorgabe braucht keinen Vermerk.')
    }

    return findings.problems.length > before ? undefined : { kind }
  }

  const rule = missing(from, 'rule')
    ? noted(
        findings,
        below(spot, 'rule'),
        'Die Regel fehlt. Eine Frist steht nie als Zahl in der Pflichtart, sondern als Regel mit Gültigkeitszeitraum.',
      )
    : reference(from['rule'], below(spot, 'rule'), findings)
  const legalClearance = optionalText(from, 'legalClearance', spot, findings)

  // What a package may say about a private standard (section 5 of the
  // concept): its interval only where the legal review bears it, and the
  // note saying so belongs to that case and no other.
  if (
    origin === 'private_standard' &&
    legalClearance === undefined &&
    missing(from, 'legalClearance')
  ) {
    findings.say(
      below(spot, 'legalClearance'),
      'Eine Pflichtart aus einer privaten Norm nennt eine Frist nur mit dem Vermerk, dass die rechtliche Prüfung sie trägt. Bis dahin hat sie "kind": "none", und der Betreiber trägt die Frist ein.',
    )
  }

  if (origin !== undefined && origin !== 'private_standard' && !missing(from, 'legalClearance')) {
    findings.say(
      below(spot, 'legalClearance'),
      'Der Vermerk der rechtlichen Prüfung gehört nur zu einer Pflichtart aus einer privaten Norm.',
    )
  }

  if (findings.problems.length > before || kind === undefined || rule === undefined) {
    return undefined
  }

  return legalClearance === undefined ? { kind, rule } : { kind, rule, legalClearance }
}

function retention(value: unknown, spot: Spot, findings: Findings): Retention | undefined {
  const from = fields(value, spot, findings, ['kind', 'rule'])

  if (!from) {
    return undefined
  }

  const before = findings.problems.length
  const kind = oneOf(from, 'kind', retentionKinds, spot, findings)

  if (kind === 'years') {
    const rule = missing(from, 'rule')
      ? noted(findings, below(spot, 'rule'), 'Die Regel mit der Zahl der Jahre fehlt.')
      : reference(from['rule'], below(spot, 'rule'), findings)

    return findings.problems.length > before || rule === undefined ? undefined : { kind, rule }
  }

  if (!missing(from, 'rule')) {
    findings.say(
      below(spot, 'rule'),
      'Eine Regel hat nur die Aufbewahrung über eine Zahl von Jahren.',
    )
  }

  return findings.problems.length > before || kind === undefined ? undefined : { kind }
}

function condition(value: unknown, spot: Spot, findings: Findings): ScopeCondition | undefined {
  const comparisons = ['atLeast', 'below', 'is', 'oneOf'] as const
  const from = fields(value, spot, findings, ['characteristic', ...comparisons])

  if (!from) {
    return undefined
  }

  const before = findings.problems.length
  const name = key(from, 'characteristic', spot, findings)
  const given = comparisons.filter((comparison) => !missing(from, comparison))

  if (given.length !== 1) {
    findings.say(
      spot,
      'Eine Bedingung vergleicht auf genau eine Art: "atLeast" oder "below" mit einer Regel, "is" mit ja oder nein, "oneOf" mit Werten einer Auswahl.',
    )
    return undefined
  }

  const [comparison] = given

  switch (comparison) {
    case 'atLeast':
    case 'below': {
      const rule = reference(from[comparison], below(spot, comparison), findings)

      if (findings.problems.length > before || name === undefined || rule === undefined) {
        return undefined
      }

      return comparison === 'atLeast'
        ? { characteristic: name, atLeast: rule }
        : { characteristic: name, below: rule }
    }
    case 'is': {
      const is = from['is']

      if (typeof is !== 'boolean') {
        findings.say(below(spot, 'is'), 'Hier gehört true oder false hin.')
        return undefined
      }

      return findings.problems.length > before || name === undefined
        ? undefined
        : { characteristic: name, is }
    }
    case 'oneOf': {
      const values = from['oneOf']

      if (!Array.isArray(values) || values.length === 0 || !values.every(isKey)) {
        findings.say(below(spot, 'oneOf'), 'Hier gehört eine Liste von Werten einer Auswahl hin.')
        return undefined
      }

      once(values as readonly string[], below(spot, 'oneOf'), findings, 'Der Wert')

      return findings.problems.length > before || name === undefined
        ? undefined
        : { characteristic: name, oneOf: [...(values as readonly string[])] }
    }
    default:
      return undefined
  }
}

function scope(value: unknown, spot: Spot, findings: Findings): DutyKind['scope'] | undefined {
  const from = fields(value, spot, findings, [
    'assetKinds',
    'conditions',
    'buildingKinds',
    'states',
  ])

  if (!from) {
    return undefined
  }

  const before = findings.problems.length
  const kindList = list(from, 'assetKinds', spot, findings, 'required')

  if (kindList?.length === 0) {
    findings.say(below(spot, 'assetKinds'), 'Eine Pflichtart gilt für mindestens eine Anlagenart.')
  }

  const assetKinds = kindList?.map((entry, index) =>
    reference(entry, below(below(spot, 'assetKinds'), index), findings),
  )
  const conditionList = list(from, 'conditions', spot, findings, 'optional')
  const conditions = conditionList
    ? each(conditionList, below(spot, 'conditions'), findings, condition)
    : undefined
  const buildingList = list(from, 'buildingKinds', spot, findings, 'optional')
  const stateList = list(from, 'states', spot, findings, 'optional')

  const buildings = buildingList?.map((entry, index) => {
    if (typeof entry !== 'string' || !(buildingKinds as readonly string[]).includes(entry)) {
      findings.say(
        below(below(spot, 'buildingKinds'), index),
        `Das ist keine der Gebäudearten ${buildingKinds.join(', ')}.`,
      )
      return undefined
    }

    return entry as BuildingKind
  })
  const states = stateList?.map((entry, index) => {
    if (typeof entry !== 'string' || !(federalStates as readonly string[]).includes(entry)) {
      findings.say(
        below(below(spot, 'states'), index),
        'Das ist keines der sechzehn Länder, geschrieben wie DE-BW.',
      )
      return undefined
    }

    return entry as FederalState
  })

  if (assetKinds && defined(assetKinds)) {
    once(assetKinds, below(spot, 'assetKinds'), findings, 'Die Anlagenart')
  }

  if (buildings && defined(buildings)) {
    once(buildings, below(spot, 'buildingKinds'), findings, 'Die Gebäudeart')
  }

  if (states && defined(states)) {
    once(states, below(spot, 'states'), findings, 'Das Land')
  }

  if (
    findings.problems.length > before ||
    assetKinds === undefined ||
    !defined(assetKinds) ||
    conditions === undefined ||
    buildings === undefined ||
    !defined(buildings) ||
    states === undefined ||
    !defined(states)
  ) {
    return undefined
  }

  return {
    assetKinds: [...assetKinds],
    conditions,
    buildingKinds: [...buildings],
    states: [...states],
  }
}

/** A version of a duty kind, `pflichten/<key>.v<n>.json`. */
export function readDutyKind(
  value: unknown,
  file: string,
  findings: Findings,
): ReadEntry<DutyKind> | undefined {
  const spot = spotIn(file)
  const from = fields(value, spot, findings, [
    'validFrom',
    'label',
    'description',
    'task',
    'origin',
    'bindingness',
    'source',
    'interval',
    'qualification',
    'evidence',
    'retention',
    'scope',
  ])

  if (!from) {
    return undefined
  }

  const before = findings.problems.length
  const validFrom = day(from, 'validFrom', spot, findings)
  const label = text(from, 'label', spot, findings)
  const description = text(
    from,
    'description',
    spot,
    findings,
    'Die Pflicht in eigenen Worten fehlt.',
  )
  const task = oneOf(from, 'task', dutyTasks, spot, findings)
  const origin = oneOf(
    from,
    'origin',
    catalogueOrigins,
    spot,
    findings,
    'Die Herkunft fehlt: staatliches Recht, ein Regelwerk der Unfallversicherungsträger und der staatlichen Ausschüsse, oder eine private Norm.',
  )
  const bindingness = oneOf(from, 'bindingness', dutyBindingnesses, spot, findings)
  const source = text(
    from,
    'source',
    spot,
    findings,
    'Die Fundstelle fehlt. Eine Pflichtart ohne Fundstelle wird nicht aufgenommen: der Paragraf mit Gesetz oder Verordnung, die Norm mit Ausgabe und Abschnitt, oder die Regel der Technik, die sie trägt.',
  )
  const readInterval = missing(from, 'interval')
    ? noted(
        findings,
        below(spot, 'interval'),
        'Die Frist fehlt, auch "kind": "none" ist eine Angabe.',
      )
    : interval(from['interval'], below(spot, 'interval'), findings, origin)

  const qualificationFields = missing(from, 'qualification')
    ? noted(findings, below(spot, 'qualification'), 'Die geforderte Qualifikation fehlt.')
    : fields(from['qualification'], below(spot, 'qualification'), findings, ['level', 'note'])
  const level = qualificationFields
    ? oneOf(
        qualificationFields,
        'level',
        qualificationLevels,
        below(spot, 'qualification'),
        findings,
      )
    : undefined
  const qualificationNote = qualificationFields
    ? optionalText(qualificationFields, 'note', below(spot, 'qualification'), findings)
    : undefined

  const evidenceFields = missing(from, 'evidence')
    ? noted(findings, below(spot, 'evidence'), 'Die Art des Nachweises fehlt.')
    : fields(from['evidence'], below(spot, 'evidence'), findings, ['kinds', 'form'])
  const evidenceList = evidenceFields
    ? list(evidenceFields, 'kinds', below(spot, 'evidence'), findings, 'required')
    : undefined
  const kinds = evidenceList?.map((entry, index) => {
    if (typeof entry !== 'string' || !(evidenceKinds as readonly string[]).includes(entry)) {
      findings.say(
        below(below(below(spot, 'evidence'), 'kinds'), index),
        `Das ist keine der Arten ${evidenceKinds.join(', ')}.`,
      )
      return undefined
    }

    return entry as EvidenceKind
  })

  if (evidenceList?.length === 0) {
    findings.say(below(below(spot, 'evidence'), 'kinds'), 'Ein Nachweis hat mindestens eine Art.')
  }

  if (kinds && defined(kinds)) {
    once(kinds, below(below(spot, 'evidence'), 'kinds'), findings, 'Die Art')
  }

  const form =
    evidenceFields && !missing(evidenceFields, 'form')
      ? reference(evidenceFields['form'], below(below(spot, 'evidence'), 'form'), findings)
      : undefined

  if (form !== undefined && kinds && !kinds.includes('protocol')) {
    findings.say(
      below(below(spot, 'evidence'), 'form'),
      'Ein Formular gehört zu einem Nachweis durch ein Protokoll; "protocol" fehlt unter den Arten.',
    )
  }

  const readRetention = missing(from, 'retention')
    ? noted(findings, below(spot, 'retention'), 'Die Aufbewahrung fehlt.')
    : retention(from['retention'], below(spot, 'retention'), findings)
  const readScope = missing(from, 'scope')
    ? noted(findings, below(spot, 'scope'), 'Der Geltungsbereich fehlt.')
    : scope(from['scope'], below(spot, 'scope'), findings)

  if (
    findings.problems.length > before ||
    validFrom === undefined ||
    label === undefined ||
    description === undefined ||
    task === undefined ||
    origin === undefined ||
    bindingness === undefined ||
    source === undefined ||
    readInterval === undefined ||
    level === undefined ||
    kinds === undefined ||
    !defined(kinds) ||
    readRetention === undefined ||
    readScope === undefined
  ) {
    return undefined
  }

  return {
    validFrom,
    definition: {
      label,
      description,
      task,
      origin,
      bindingness,
      source,
      interval: readInterval,
      qualification:
        qualificationNote === undefined ? { level } : { level, note: qualificationNote },
      evidence: form === undefined ? { kinds: [...kinds] } : { kinds: [...kinds], form },
      retention: readRetention,
      scope: readScope,
    },
  }
}

/**
 * A version of a form or a round template. Only its envelope is read here:
 * the first day, the title and that it has sections. What the sections hold,
 * the form engine checks once it is part of the foundation
 * (opengewerk-haustechnik#28); until then a field it does not know is no
 * finding.
 */
export function readForm(
  value: unknown,
  file: string,
  findings: Findings,
): ReadEntry<PackagedForm> | undefined {
  const spot = spotIn(file)
  const from = fields(value, spot, findings, 'any')

  if (!from) {
    return undefined
  }

  const before = findings.problems.length
  const validFrom = day(from, 'validFrom', spot, findings)
  const title = text(from, 'title', spot, findings)

  if (!Array.isArray(from['sections'])) {
    findings.say(below(spot, 'sections'), 'Ein Formular hat eine Liste von Abschnitten.')
  }

  if (findings.problems.length > before || validFrom === undefined || title === undefined) {
    return undefined
  }

  const content = Object.fromEntries(Object.entries(from).filter(([name]) => name !== 'validFrom'))

  return { validFrom, definition: { ...content, title } }
}

/** A rule as its package states it, its key still the one of its package. */
export interface PackageRuleRecord {
  readonly key: string
  readonly scope?: RuleScope
  readonly validFrom: IsoDate
  readonly validUntil: IsoDate | null
  readonly unit: RuleUnit
  readonly value: number
  readonly source: string
  readonly origin: CatalogueOrigin
  readonly note?: string
}

function ruleRecord(value: unknown, spot: Spot, findings: Findings): PackageRuleRecord | undefined {
  const from = fields(value, spot, findings, [
    'key',
    'scope',
    'validFrom',
    'validUntil',
    'unit',
    'value',
    'source',
    'origin',
    'note',
  ])

  if (!from) {
    return undefined
  }

  const before = findings.problems.length
  const name = key(from, 'key', spot, findings)
  const ruleScope = missing(from, 'scope')
    ? undefined
    : oneOf(from, 'scope', ruleScopes, spot, findings)
  const validFrom = day(from, 'validFrom', spot, findings)
  const validUntil = dayOrNull(from, 'validUntil', spot, findings)
  const unit = oneOf(from, 'unit', ruleUnits, spot, findings)
  const amount = from['value']
  const source = text(
    from,
    'source',
    spot,
    findings,
    'Die Fundstelle fehlt. Eine Regel ohne Fundstelle ist eine Zahl, die man glauben muss.',
  )
  const origin = oneOf(from, 'origin', catalogueOrigins, spot, findings, 'Die Herkunft fehlt.')
  const note = optionalText(from, 'note', spot, findings)

  if (typeof amount !== 'number' || !Number.isInteger(amount)) {
    findings.say(
      below(spot, 'value'),
      amount === undefined
        ? 'Das Feld fehlt.'
        : 'Der Wert einer Regel ist eine ganze Zahl in ihrer Einheit, 24 Monate und nicht 2 Jahre als 2.0.',
    )
  }

  if (typeof validFrom === 'string' && typeof validUntil === 'string' && validUntil < validFrom) {
    findings.say(below(spot, 'validUntil'), 'Die Regel endet vor ihrem Beginn.')
  }

  if (
    findings.problems.length > before ||
    name === undefined ||
    validFrom === undefined ||
    validUntil === undefined ||
    unit === undefined ||
    typeof amount !== 'number' ||
    source === undefined ||
    origin === undefined
  ) {
    return undefined
  }

  return {
    key: name,
    // A rule of the whole country says nothing about a scope; written out,
    // it would make two records of the same meaning look different.
    ...(ruleScope === undefined || ruleScope === 'DE' ? {} : { scope: ruleScope }),
    validFrom,
    validUntil,
    unit,
    value: amount,
    source,
    origin,
    ...(note === undefined ? {} : { note }),
  }
}

/** A file of rules, `regeln/<name>.json`: why they stand there, and the records. */
export function readRules(
  value: unknown,
  file: string,
  findings: Findings,
): readonly PackageRuleRecord[] | undefined {
  const spot = spotIn(file)
  const from = fields(value, spot, findings, ['note', 'records'])

  if (!from) {
    return undefined
  }

  const before = findings.problems.length

  text(
    from,
    'note',
    spot,
    findings,
    'Die Anmerkung fehlt: was diese Regeln sind und woher sie kommen.',
  )

  const records = list(from, 'records', spot, findings, 'required')

  if (records?.length === 0) {
    findings.say(below(spot, 'records'), 'Eine Datei mit Regeln hat mindestens eine.')
  }

  const read = records ? each(records, below(spot, 'records'), findings, ruleRecord) : undefined

  return findings.problems.length > before ? undefined : read
}

/** What the manifest of a package says. */
export interface Manifest {
  readonly name: string
  readonly title: string
  readonly version: string
  readonly minimumCore: string
}

const versionPattern = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/

/** Compares two versions written major.minor.patch, as a sort would. */
export function compareVersions(left: string, right: string): number {
  const [a, b] = [left, right].map((version) => version.split('.').map(Number))

  for (let index = 0; index < 3; index += 1) {
    const difference = (a?.[index] ?? 0) - (b?.[index] ?? 0)

    if (difference !== 0) {
      return difference
    }
  }

  return 0
}

/** The manifest of a package, `manifest.json`. */
export function readManifest(
  value: unknown,
  file: string,
  findings: Findings,
  packageName: string,
  applicationVersion: string,
): Manifest | undefined {
  const spot = spotIn(file)
  const from = fields(value, spot, findings, ['name', 'title', 'version', 'minimumCore'])

  if (!from) {
    return undefined
  }

  const before = findings.problems.length
  const name = from['name']
  const title = text(from, 'title', spot, findings)
  const version = from['version']
  const minimumCore = from['minimumCore']

  if (name !== packageName) {
    findings.say(
      below(spot, 'name'),
      `Ein Paket heißt wie sein Ordner, hier ${JSON.stringify(packageName)}.`,
    )
  }

  if (typeof version !== 'string' || !versionPattern.test(version)) {
    findings.say(below(spot, 'version'), 'Die Fassung des Pakets heißt wie 1.0.0.')
  }

  if (typeof minimumCore !== 'string' || !versionPattern.test(minimumCore)) {
    findings.say(below(spot, 'minimumCore'), 'Die benötigte Fassung der Anwendung heißt wie 0.1.0.')
  } else if (compareVersions(minimumCore, applicationVersion) > 0) {
    findings.say(
      below(spot, 'minimumCore'),
      `Das Paket verlangt die Anwendung ab ${minimumCore}, sie steht bei ${applicationVersion}.`,
    )
  }

  if (
    findings.problems.length > before ||
    typeof name !== 'string' ||
    title === undefined ||
    typeof version !== 'string' ||
    typeof minimumCore !== 'string'
  ) {
    return undefined
  }

  return { name, title, version, minimumCore }
}

/** Who accepted an entry with expertise, when, and the checksum of what was accepted. */
export interface PackageAcceptance {
  readonly by: string
  readonly on: IsoDate
  readonly sha256: string
}

export interface EntryReview {
  readonly file: string
  readonly checkedOn: IsoDate
  readonly accepted?: PackageAcceptance
}

export interface RuleReview {
  readonly key: string
  readonly scope?: RuleScope
  readonly validFrom: IsoDate
  readonly checkedOn: IsoDate
  readonly accepted?: PackageAcceptance
}

export interface Acceptances {
  readonly entries: readonly EntryReview[]
  readonly rules: readonly RuleReview[]
}

function acceptance(value: unknown, spot: Spot, findings: Findings): PackageAcceptance | undefined {
  const from = fields(value, spot, findings, ['by', 'on', 'sha256'])

  if (!from) {
    return undefined
  }

  const before = findings.problems.length
  const by = text(from, 'by', spot, findings, 'Wer abgenommen hat, fehlt.')
  const on = day(from, 'on', spot, findings)
  const sha256 = from['sha256']

  if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) {
    findings.say(
      below(spot, 'sha256'),
      'Die Prüfsumme dessen, was abgenommen wurde, fehlt: 64 Zeichen 0 bis 9 und a bis f. Der Bau nennt sie.',
    )
  }

  return findings.problems.length > before ||
    by === undefined ||
    on === undefined ||
    typeof sha256 !== 'string'
    ? undefined
    : { by, on, sha256 }
}

function entryReview(value: unknown, spot: Spot, findings: Findings): EntryReview | undefined {
  const from = fields(value, spot, findings, ['file', 'checkedOn', 'accepted'])

  if (!from) {
    return undefined
  }

  const before = findings.problems.length
  const file = text(from, 'file', spot, findings)
  const checkedOn = day(from, 'checkedOn', spot, findings)
  const accepted = missing(from, 'accepted')
    ? undefined
    : acceptance(from['accepted'], below(spot, 'accepted'), findings)

  if (findings.problems.length > before || file === undefined || checkedOn === undefined) {
    return undefined
  }

  return accepted === undefined ? { file, checkedOn } : { file, checkedOn, accepted }
}

function ruleReview(value: unknown, spot: Spot, findings: Findings): RuleReview | undefined {
  const from = fields(value, spot, findings, ['key', 'scope', 'validFrom', 'checkedOn', 'accepted'])

  if (!from) {
    return undefined
  }

  const before = findings.problems.length
  const name = key(from, 'key', spot, findings)
  const ruleScope = missing(from, 'scope')
    ? undefined
    : oneOf(from, 'scope', ruleScopes, spot, findings)
  const validFrom = day(from, 'validFrom', spot, findings)
  const checkedOn = day(from, 'checkedOn', spot, findings)
  const accepted = missing(from, 'accepted')
    ? undefined
    : acceptance(from['accepted'], below(spot, 'accepted'), findings)

  if (
    findings.problems.length > before ||
    name === undefined ||
    validFrom === undefined ||
    checkedOn === undefined
  ) {
    return undefined
  }

  return {
    key: name,
    ...(ruleScope === undefined || ruleScope === 'DE' ? {} : { scope: ruleScope }),
    validFrom,
    checkedOn,
    ...(accepted === undefined ? {} : { accepted }),
  }
}

/** The reviews of a package, `abnahmen.json`. */
export function readAcceptances(
  value: unknown,
  file: string,
  findings: Findings,
): Acceptances | undefined {
  const spot = spotIn(file)
  const from = fields(value, spot, findings, ['entries', 'rules'])

  if (!from) {
    return undefined
  }

  const before = findings.problems.length
  const entryList = list(from, 'entries', spot, findings, 'required')
  const ruleList = list(from, 'rules', spot, findings, 'required')
  const entries = entryList
    ? each(entryList, below(spot, 'entries'), findings, entryReview)
    : undefined
  const rules = ruleList ? each(ruleList, below(spot, 'rules'), findings, ruleReview) : undefined

  return findings.problems.length > before || entries === undefined || rules === undefined
    ? undefined
    : { entries, rules }
}
