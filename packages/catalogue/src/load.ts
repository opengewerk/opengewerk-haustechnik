import {
  type AssetKind,
  type CatalogueBundle,
  type CatalogueEntry,
  catalogueFormat,
  type CataloguePackage,
  type CatalogueReview,
  type CatalogueRule,
  type CatalogueRuleRecord,
  countingUnits,
  type DutyKind,
  federalStates,
  type FormField,
  type FormUnit,
  formUnits,
  generalPackage,
  type IsoDate,
  nationwide,
  type PackagedForm,
  RuleError,
  ruleHoles,
  ruleScopeNames,
  ruleSet,
  type RuleUnit,
  type ScopeCondition,
} from '@opengewerk/haustechnik-domain'

import { defectClassChecksum, entryChecksum, ruleChecksum, sha256 } from './checksum.js'
import {
  type Acceptances,
  Findings,
  type Manifest,
  type PackageAcceptance,
  type PackageDefectClass,
  type PackageRuleRecord,
  readAcceptances,
  readAssetKind,
  readDefectClasses,
  readDutyKind,
  readForm,
  readManifest,
  type ReadEntry,
  readRules,
  type Spot,
  spotIn,
} from './format.js'
import { classify, type EntryFolder, entryFolders, entryNoun } from './paths.js'

/**
 * The loader: from the files in the folder pakete/ to the bundle server and
 * interface load, or to the list of everything that keeps it from being one
 * (ADR 0005, points 7 to 16). A faulty package builds no catalogue: the build
 * stops, and the list says what a contribution without code got wrong.
 */
export interface LoadOptions {
  /** The version of the application, which a package may require at least. */
  readonly applicationVersion: string
  /** Today in Germany: nothing was checked or accepted after it. */
  readonly today: IsoDate
}

export type LoadResult =
  | { readonly bundle: CatalogueBundle; readonly problems: readonly [] }
  | { readonly bundle: null; readonly problems: readonly string[] }

type Part = (typeof entryFolders)[EntryFolder]

/** One version of an entry, read if its file could be read. */
interface Version<Definition> {
  readonly file: string
  readonly folder: EntryFolder
  readonly key: string
  readonly version: number
  readonly bytes: Uint8Array
  readonly read: ReadEntry<Definition> | undefined
}

interface RuleInFile {
  readonly file: string
  readonly record: PackageRuleRecord
}

interface PackageContent {
  readonly name: string
  manifest: Manifest | undefined
  manifestSeen: boolean
  acceptances: Acceptances | undefined
  acceptancesSeen: boolean
  readonly assetKinds: Version<AssetKind>[]
  readonly dutyKinds: Version<DutyKind>[]
  readonly forms: Version<PackagedForm>[]
  readonly roundTemplates: Version<PackagedForm>[]
  readonly rules: RuleInFile[]
  /** In the order of the file, which is the order they are offered in. */
  readonly defectClasses: PackageDefectClass[]
}

function emptyPackage(name: string): PackageContent {
  return {
    name,
    manifest: undefined,
    manifestSeen: false,
    acceptances: undefined,
    acceptancesSeen: false,
    assetKinds: [],
    dutyKinds: [],
    forms: [],
    roundTemplates: [],
    rules: [],
    defectClasses: [],
  }
}

const unread = Symbol('unread')

/** The one file of a package that names its defect classes. */
const defectClassesFile = 'mangelklassen.json'

/** The content of a JSON file, or nothing after saying why it is none. */
function parsed(bytes: Uint8Array, file: string, findings: Findings): unknown {
  let content: string

  try {
    // A BOM is kept in the text here, so that it can be named; left to the
    // decoder, it would disappear without a word.
    content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch {
    findings.say(spotIn(file), 'Die Datei ist kein gültiges UTF-8.')
    return unread
  }

  if (content.startsWith('\uFEFF')) {
    findings.say(spotIn(file), 'Die Datei beginnt mit einer BOM; gespeichert wird UTF-8 ohne BOM.')
    return unread
  }

  try {
    return JSON.parse(content) as unknown
  } catch (error) {
    findings.say(
      spotIn(file),
      `Die Datei ist kein gültiges JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
    return unread
  }
}

/** A reference split into its package and its key: without a dot, the home package. */
interface Reference {
  readonly packageName: string
  readonly key: string
  readonly qualified: string
}

function resolve(reference: string, home: string): Reference {
  const dot = reference.indexOf('.')

  return dot < 0
    ? { packageName: home, key: reference, qualified: `${home}.${reference}` }
    : {
        packageName: reference.slice(0, dot),
        key: reference.slice(dot + 1),
        qualified: reference,
      }
}

function byVersion<Definition>(versions: readonly Version<Definition>[]): Version<Definition>[] {
  return [...versions].sort((left, right) => left.version - right.version)
}

function grouped<Item>(items: readonly Item[], keyOf: (item: Item) => string): Map<string, Item[]> {
  const groups = new Map<string, Item[]>()

  for (const item of items) {
    groups.set(keyOf(item), [...(groups.get(keyOf(item)) ?? []), item])
  }

  return groups
}

/** Versions count from one without a gap, and a later one never begins before an earlier one. */
function checkVersions<Definition>(
  content: PackageContent,
  folder: EntryFolder,
  versions: readonly Version<Definition>[],
  findings: Findings,
): void {
  for (const [key, ofKey] of grouped(versions, (version) => version.key)) {
    const ordered = byVersion(ofKey)
    const highest = ordered.at(-1)?.version ?? 0
    const present = new Set(ordered.map((version) => version.version))
    const gaps = Array.from({ length: highest }, (_, index) => index + 1).filter(
      (number) => !present.has(number),
    )

    if (gaps.length > 0) {
      findings.say(
        spotIn(`${content.name}/${folder}/${key}`),
        `Fassung ${gaps.join(', ')} fehlt. Die Fassungen zählen von 1 an ohne Lücke, und eine gemergte bleibt stehen.`,
      )
    }

    for (let index = 1; index < ordered.length; index += 1) {
      const earlier = ordered[index - 1]?.read
      const later = ordered[index]

      if (earlier && later?.read && later.read.validFrom < earlier.validFrom) {
        findings.say(
          spotIn(later.file),
          `Die Fassung beginnt am ${later.read.validFrom}, vor der Fassung davor (${earlier.validFrom}). Eine spätere Fassung beginnt nie vor einer früheren.`,
        )
      }
    }
  }
}

/** A key names one thing in its package: one entry of one kind, one rule, or one defect class. */
function checkKeys(content: PackageContent, findings: Findings): void {
  const folderOf = new Map<string, EntryFolder>()

  for (const folder of Object.keys(entryFolders) as EntryFolder[]) {
    for (const version of content[entryFolders[folder]]) {
      const known = folderOf.get(version.key)

      if (known !== undefined && known !== folder) {
        findings.say(
          spotIn(version.file),
          `Den Schlüssel ${version.key} trägt im Paket schon ${entryNoun[known]} gleichen Namens. Ein Schlüssel nennt in seinem Paket genau ein Ding.`,
        )
      }

      folderOf.set(version.key, known ?? folder)
    }
  }

  for (const { file, record } of content.rules) {
    const folder = folderOf.get(record.key)

    if (folder !== undefined) {
      findings.say(
        spotIn(file),
        `Die Regel ${record.key} heißt wie ${entryNoun[folder]} ${record.key}. Ein Schlüssel nennt in seinem Paket genau ein Ding.`,
      )
    }
  }

  const ruleKeys = new Set(content.rules.map(({ record }) => record.key))

  for (const { key } of content.defectClasses) {
    const folder = folderOf.get(key)
    const taken = folder !== undefined ? entryNoun[folder] : ruleKeys.has(key) ? 'die Regel' : null

    if (taken !== null) {
      findings.say(
        spotIn(`${content.name}/${defectClassesFile}`),
        `Die Mängelklasse ${key} heißt wie ${taken} ${key}. Ein Schlüssel nennt in seinem Paket genau ein Ding.`,
      )
    }
  }
}

/** Everything the packages hold, by the name outside their package. */
class Index {
  constructor(private readonly packages: ReadonlyMap<string, PackageContent>) {}

  known(reference: Reference): PackageContent | undefined {
    return this.packages.get(reference.packageName)
  }

  versions<Definition>(part: Part, reference: Reference): Version<Definition>[] {
    const content = this.known(reference)

    return content
      ? (content[part] as Version<Definition>[]).filter((version) => version.key === reference.key)
      : []
  }

  rules(reference: Reference): PackageRuleRecord[] {
    return (this.known(reference)?.rules ?? [])
      .filter(({ record }) => record.key === reference.key)
      .map(({ record }) => record)
  }
}

const unitNames: Readonly<Record<RuleUnit, string>> = {
  basis_points: 'Basispunkten',
  cents: 'Cent',
  days: 'Tagen',
  flag: 'ja oder nein',
  minutes: 'Minuten',
  years: 'Jahren',
  kiloohms: 'Kiloohm',
  milliseconds: 'Millisekunden',
  volts: 'Volt',
  factor: 'einem Faktor',
  months: 'Monaten',
  decidegrees_celsius: 'Zehntelgrad Celsius',
  kilowatts: 'Kilowatt',
  kilograms_co2e: 'Kilogramm CO2-Äquivalent',
  tonnes_co2e: 'Tonnen CO2-Äquivalent',
  count_per_100_ml: 'Anzahl je 100 ml',
}

/** Says so when a reference to a rule leads nowhere or to a rule in another unit. */
function checkRuleReference(
  spot: Spot,
  rule: string,
  home: string,
  index: Index,
  findings: Findings,
  role: string,
  units: readonly RuleUnit[],
): void {
  const reference = resolve(rule, home)

  if (!index.known(reference)) {
    findings.say(
      spot,
      `${role} nennt die Regel ${rule} aus dem Paket ${reference.packageName}, das es nicht gibt.`,
    )
    return
  }

  const records = index.rules(reference)

  if (records.length === 0) {
    findings.say(
      spot,
      `${role} nennt die Regel ${rule}, die es nicht gibt. Eine Regel steht unter regeln/ mit Gültigkeitszeitraum und Fundstelle.`,
    )
    return
  }

  for (const record of records) {
    if (!units.includes(record.unit)) {
      findings.say(
        spot,
        `${role} nennt die Regel ${rule}, die ab ${record.validFrom} in ${unitNames[record.unit]} zählt; gezählt wird hier in ${alternatives(units.map((unit) => unitNames[unit]))}.`,
      )
    }
  }
}

/** "Tagen, Monaten oder Jahren". */
function alternatives(words: readonly string[]): string {
  return words.length < 2
    ? words.join('')
    : `${words.slice(0, -1).join(', ')} oder ${String(words.at(-1))}`
}

function conditionRule(condition: ScopeCondition): string | undefined {
  if ('atLeast' in condition) {
    return condition.atLeast
  }

  return 'below' in condition ? condition.below : undefined
}

/** Says so when a condition asks for a characteristic one of the asset kinds in scope does not have in that way. */
function checkCondition(
  spot: Spot,
  condition: ScopeCondition,
  kinds: readonly Reference[],
  home: string,
  index: Index,
  findings: Findings,
): void {
  for (const kind of kinds) {
    for (const version of index.versions<AssetKind>('assetKinds', kind)) {
      if (!version.read) {
        continue
      }

      const characteristic = version.read.definition.characteristics.find(
        (each) => each.key === condition.characteristic,
      )
      const where = `${kind.qualified} in Fassung ${String(version.version)}`

      if (!characteristic) {
        findings.say(
          spot,
          `Das Merkmal ${condition.characteristic} hat die Anlagenart ${where} nicht. Eine Bedingung fragt nur nach einem Merkmal, das jede Fassung jeder Anlagenart im Geltungsbereich hat.`,
        )
        continue
      }

      const rule = conditionRule(condition)

      if (rule !== undefined) {
        if (characteristic.kind !== 'number') {
          findings.say(spot, `Das Merkmal ${condition.characteristic} von ${where} ist keine Zahl.`)
        } else {
          checkRuleReference(spot, rule, home, index, findings, 'Die Bedingung', [
            characteristic.unit,
          ])
        }
      } else if ('is' in condition && characteristic.kind !== 'flag') {
        findings.say(
          spot,
          `Das Merkmal ${condition.characteristic} von ${where} ist kein Ja oder Nein.`,
        )
      } else if ('oneOf' in condition) {
        if (characteristic.kind !== 'choice') {
          findings.say(
            spot,
            `Das Merkmal ${condition.characteristic} von ${where} ist keine Auswahl.`,
          )
        } else {
          const offered = new Set(characteristic.options.map((option) => option.value))

          for (const value of condition.oneOf.filter((each) => !offered.has(each))) {
            findings.say(
              spot,
              `${value} ist keine Möglichkeit des Merkmals ${condition.characteristic} von ${where}.`,
            )
          }
        }
      }
    }
  }
}

function checkDutyKind(
  version: Version<DutyKind>,
  dutyKind: DutyKind,
  home: string,
  index: Index,
  findings: Findings,
): void {
  const spot = spotIn(version.file)
  const kinds = dutyKind.scope.assetKinds.map((kind) => resolve(kind, home))

  for (const kind of kinds) {
    if (!index.known(kind)) {
      findings.say(
        spot,
        `Der Geltungsbereich nennt die Anlagenart ${kind.qualified} aus dem Paket ${kind.packageName}, das es nicht gibt.`,
      )
    } else if (index.versions('assetKinds', kind).length === 0) {
      findings.say(
        spot,
        `Der Geltungsbereich nennt die Anlagenart ${kind.qualified}, die es nicht gibt.`,
      )
    } else if (kind.packageName === generalPackage) {
      // The general kinds stand in for a package that is still missing
      // (section 5 of the concept). A duty kind naming one would be proposed
      // for every asset nobody has sorted yet.
      findings.say(
        spot,
        `Der Geltungsbereich nennt die allgemeine Anlagenart ${kind.qualified}. Eine allgemeine Anlagenart trägt keine Pflichtart: sie steht für eine Anlage, deren Fachpaket noch fehlt, und ihre Pflichten kommen mit der Anlagenart dieses Pakets.`,
      )
    }
  }

  if (dutyKind.interval.kind !== 'none') {
    // § 14 Abs. 5 BetrSichV gives the due day as a month and a year, so a
    // duty kind counted that way takes its interval in months or years.
    checkRuleReference(
      spot,
      dutyKind.interval.rule,
      home,
      index,
      findings,
      dutyKind.counting === 'betrsichv' ? 'Die Frist nach § 14 Abs. 5 BetrSichV' : 'Die Frist',
      countingUnits[dutyKind.counting],
    )

    // The interval has to answer wherever the duty kind applies: a rule of
    // one state under a duty kind of the whole country would leave every
    // other state without an interval, and nobody would notice.
    const records = index.rules(resolve(dutyKind.interval.rule, home))
    const states = dutyKind.scope.states.length > 0 ? dutyKind.scope.states : federalStates
    const unanswered = states.filter(
      (state) =>
        records.length > 0 &&
        !records.some(
          (record) => (record.scope ?? nationwide) === nationwide || record.scope === state,
        ),
    )

    if (unanswered.length > 0) {
      findings.say(
        spot,
        `Die Pflichtart gilt in ${unanswered.map((state) => ruleScopeNames[state]).join(', ')}, ihre Frist ${dutyKind.interval.rule} hat dort keine Regel.`,
      )
    }
  }

  if (dutyKind.retention.kind === 'years') {
    checkRuleReference(spot, dutyKind.retention.rule, home, index, findings, 'Die Aufbewahrung', [
      'years',
    ])
  }

  for (const condition of dutyKind.scope.conditions) {
    checkCondition(spot, condition, kinds, home, index, findings)
  }

  if (dutyKind.evidence.form !== undefined) {
    const form = resolve(dutyKind.evidence.form, home)

    if (index.versions('forms', form).length === 0) {
      findings.say(spot, `Der Nachweis nennt das Formular ${form.qualified}, das es nicht gibt.`)
    }
  }
}

/** Every field of a form, the fields of its groups included. */
function fieldsOfForm(form: PackagedForm): readonly FormField[] {
  return form.sections.flatMap((section) =>
    section.fields.flatMap((field): readonly FormField[] =>
      field.kind === 'group' ? [field, ...field.fields] : [field],
    ),
  )
}

/**
 * The limits of a form lead to rules that exist, in a unit the field can be
 * measured in: a limit that leads nowhere would only show on site, as a
 * measured value without a verdict.
 */
function checkForm(
  version: Version<PackagedForm>,
  form: PackagedForm,
  home: string,
  index: Index,
  findings: Findings,
): void {
  const spot = spotIn(version.file)

  for (const field of fieldsOfForm(form)) {
    if (field.kind !== 'measurement' || field.limit === undefined || !('rule' in field.limit)) {
      continue
    }

    const unit: FormUnit = formUnits[field.unit]
    const units = Object.keys(unit.fromRule ?? {}) as RuleUnit[]

    if (units.length === 0) {
      findings.say(
        spot,
        `Der Grenzwert von ${field.key} nennt die Regel ${field.limit.rule}, doch ein Wert in ${unit.sign} lässt sich mit keiner Regel vergleichen.`,
      )
      continue
    }

    checkRuleReference(
      spot,
      field.limit.rule,
      home,
      index,
      findings,
      `Der Grenzwert von ${field.key}`,
      units,
    )
  }
}

function ruleIdentity(rule: {
  readonly key: string
  readonly scope?: string
  readonly validFrom: IsoDate
}): string {
  return `${rule.key} (${rule.scope ?? nationwide}) ab ${rule.validFrom}`
}

/** Says so when an acceptance does not match what it claims to accept. */
function checkAcceptance(
  spot: Spot,
  accepted: PackageAcceptance | undefined,
  checksum: string,
  today: IsoDate,
  findings: Findings,
): void {
  if (!accepted) {
    return
  }

  if (accepted.on > today) {
    findings.say(
      spot,
      `Die Abnahme ist auf den ${accepted.on} datiert, einen Tag, der noch nicht war.`,
    )
  }

  if (accepted.sha256 !== checksum) {
    findings.say(
      spot,
      `Die Abnahme nennt die Prüfsumme ${accepted.sha256}, der Eintrag hat ${checksum}. Wer einen abgenommenen Eintrag ändert, nimmt seine Abnahme heraus, bis jemand vom Fach ihn erneut ansieht.`,
    )
  }
}

/** Every version and every rule of a package has exactly one review, and every review a target. */
function checkReviews(content: PackageContent, today: IsoDate, findings: Findings): void {
  const acceptances = content.acceptances

  if (!acceptances) {
    return
  }

  const file = `${content.name}/abnahmen.json`
  const versions = (Object.values(entryFolders) as Part[]).flatMap(
    (part) => content[part] as Version<unknown>[],
  )
  const reviewsOfFile = grouped(acceptances.entries, (review) => review.file)

  for (const version of versions) {
    const local = version.file.slice(content.name.length + 1)
    const reviews = reviewsOfFile.get(local) ?? []

    if (reviews.length === 0) {
      findings.say(
        spotIn(file),
        `Für ${local} fehlt ein Eintrag, mindestens mit dem Tag, an dem die Fassung zuletzt gegen ihre Quelle geprüft wurde ("checkedOn").`,
      )
    } else if (reviews.length > 1) {
      findings.say(
        spotIn(file),
        `Für ${local} stehen ${String(reviews.length)} Einträge da, einer gehört hin.`,
      )
    }

    for (const review of reviews) {
      if (review.checkedOn > today) {
        findings.say(
          spotIn(file),
          `${local} ist am ${review.checkedOn} geprüft, einem Tag, der noch nicht war.`,
        )
      }

      checkAcceptance(
        { file, at: local },
        review.accepted,
        entryChecksum(version.bytes),
        today,
        findings,
      )
    }
  }

  const localFiles = new Set(versions.map((version) => version.file.slice(content.name.length + 1)))

  for (const review of acceptances.entries) {
    if (!localFiles.has(review.file)) {
      findings.say(
        spotIn(file),
        `Der Eintrag für ${review.file} nennt keine Fassung, die es im Paket gibt.`,
      )
    }
  }

  const reviewsOfRule = grouped(acceptances.rules, ruleIdentity)

  for (const { record } of content.rules) {
    const identity = ruleIdentity(record)
    const reviews = reviewsOfRule.get(identity) ?? []

    if (reviews.length === 0) {
      findings.say(
        spotIn(file),
        `Für die Regel ${identity} fehlt ein Eintrag, mindestens mit dem Tag, an dem sie zuletzt gegen ihre Quelle geprüft wurde ("checkedOn").`,
      )
    } else if (reviews.length > 1) {
      findings.say(
        spotIn(file),
        `Für die Regel ${identity} stehen ${String(reviews.length)} Einträge da, einer gehört hin.`,
      )
    }

    for (const review of reviews) {
      if (review.checkedOn > today) {
        findings.say(
          spotIn(file),
          `Die Regel ${identity} ist am ${review.checkedOn} geprüft, einem Tag, der noch nicht war.`,
        )
      }

      checkAcceptance(
        { file, at: identity },
        review.accepted,
        ruleChecksum(record),
        today,
        findings,
      )
    }
  }

  const ruleIdentities = new Set(content.rules.map(({ record }) => ruleIdentity(record)))

  for (const review of acceptances.rules) {
    if (!ruleIdentities.has(ruleIdentity(review))) {
      findings.say(
        spotIn(file),
        `Der Eintrag für die Regel ${ruleIdentity(review)} nennt keine Regel, die es im Paket gibt.`,
      )
    }
  }

  const reviewsOfClass = grouped(acceptances.classes, (review) => review.key)

  for (const defectClass of content.defectClasses) {
    const reviews = reviewsOfClass.get(defectClass.key) ?? []

    if (reviews.length === 0) {
      findings.say(
        spotIn(file),
        `Für die Mängelklasse ${defectClass.key} fehlt ein Eintrag, mindestens mit dem Tag, an dem sie zuletzt gegen ihre Quelle geprüft wurde ("checkedOn").`,
      )
    } else if (reviews.length > 1) {
      findings.say(
        spotIn(file),
        `Für die Mängelklasse ${defectClass.key} stehen ${String(reviews.length)} Einträge da, einer gehört hin.`,
      )
    }

    for (const review of reviews) {
      if (review.checkedOn > today) {
        findings.say(
          spotIn(file),
          `Die Mängelklasse ${defectClass.key} ist am ${review.checkedOn} geprüft, einem Tag, der noch nicht war.`,
        )
      }

      checkAcceptance(
        { file, at: `Mängelklasse ${defectClass.key}` },
        review.accepted,
        defectClassChecksum(defectClass),
        today,
        findings,
      )
    }
  }

  const classKeys = new Set(content.defectClasses.map((defectClass) => defectClass.key))

  for (const review of acceptances.classes) {
    if (!classKeys.has(review.key)) {
      findings.say(
        spotIn(file),
        `Der Eintrag für die Mängelklasse ${review.key} nennt keine Klasse, die es im Paket gibt.`,
      )
    }
  }
}

/**
 * Text compared by its code units and nothing else. `localeCompare` orders
 * by the language of the machine it runs on, and the bundle, its checksum
 * with it, would come out differently in the CI than on a desk in Germany.
 */
function byText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/** The review of an entry in the bundle. The loader has made sure there is one for each. */
function review(
  reviewed: { readonly checkedOn: IsoDate; readonly accepted?: PackageAcceptance } | undefined,
  what: string,
): CatalogueReview {
  if (!reviewed) {
    throw new Error(`${what} ist ohne Eintrag in abnahmen.json ins Bündel gekommen.`)
  }

  const { checkedOn, accepted } = reviewed

  return { checkedOn, accepted: accepted ? { by: accepted.by, on: accepted.on } : null }
}

/** The duty kind with every reference written the way it is named outside its package. */
function qualified(dutyKind: DutyKind, home: string): DutyKind {
  const name = (reference: string) => resolve(reference, home).qualified

  return {
    ...dutyKind,
    interval:
      dutyKind.interval.kind === 'none'
        ? dutyKind.interval
        : { ...dutyKind.interval, rule: name(dutyKind.interval.rule) },
    evidence:
      dutyKind.evidence.form === undefined
        ? dutyKind.evidence
        : { ...dutyKind.evidence, form: name(dutyKind.evidence.form) },
    retention:
      dutyKind.retention.kind === 'years'
        ? { ...dutyKind.retention, rule: name(dutyKind.retention.rule) }
        : dutyKind.retention,
    scope: {
      ...dutyKind.scope,
      assetKinds: dutyKind.scope.assetKinds.map(name),
      conditions: dutyKind.scope.conditions.map((condition) => {
        if ('atLeast' in condition) {
          return { ...condition, atLeast: name(condition.atLeast) }
        }

        return 'below' in condition ? { ...condition, below: name(condition.below) } : condition
      }),
    },
  }
}

/** The form with every rule its limits name written the way it is named outside its package. */
function qualifiedForm(form: PackagedForm, home: string): PackagedForm {
  const named = <Field extends FormField>(field: Field): Field =>
    field.kind === 'measurement' && field.limit !== undefined && 'rule' in field.limit
      ? { ...field, limit: { ...field.limit, rule: resolve(field.limit.rule, home).qualified } }
      : field

  return {
    ...form,
    sections: form.sections.map((section) => ({
      ...section,
      fields: section.fields.map((field) =>
        field.kind === 'group' ? { ...field, fields: field.fields.map(named) } : named(field),
      ),
    })),
  }
}

function bundled(content: PackageContent): CataloguePackage {
  const acceptances = content.acceptances as Acceptances
  const manifest = content.manifest as Manifest
  const entryReviews = new Map(acceptances.entries.map((each) => [each.file, each]))
  const ruleReviews = new Map(acceptances.rules.map((each) => [ruleIdentity(each), each]))
  const classReviews = new Map(acceptances.classes.map((each) => [each.key, each]))

  const entries = <Definition>(
    versions: readonly Version<Definition>[],
    definitionOf: (definition: Definition) => Definition = (definition) => definition,
  ): CatalogueEntry<Definition>[] =>
    [...versions]
      .sort((left, right) => byText(left.key, right.key) || left.version - right.version)
      .map((version) => {
        const read = version.read as ReadEntry<Definition>

        return {
          key: `${content.name}.${version.key}`,
          version: version.version,
          validFrom: read.validFrom,
          definition: definitionOf(read.definition),
          review: review(
            entryReviews.get(version.file.slice(content.name.length + 1)),
            version.file,
          ),
        }
      })

  const rules: CatalogueRule[] = [...content.rules]
    .sort(
      (left, right) =>
        byText(left.record.key, right.record.key) ||
        byText(left.record.scope ?? nationwide, right.record.scope ?? nationwide) ||
        byText(left.record.validFrom, right.record.validFrom),
    )
    .map(({ record }) => {
      const catalogueRecord: CatalogueRuleRecord = {
        ...record,
        key: `${content.name}.${record.key}`,
      }

      return {
        record: catalogueRecord,
        review: review(ruleReviews.get(ruleIdentity(record)), `Die Regel ${ruleIdentity(record)}`),
      }
    })

  return {
    name: manifest.name,
    title: manifest.title,
    version: manifest.version,
    minimumCore: manifest.minimumCore,
    assetKinds: entries(content.assetKinds),
    dutyKinds: entries(content.dutyKinds, (dutyKind) => qualified(dutyKind, content.name)),
    forms: entries(content.forms, (form) => qualifiedForm(form, content.name)),
    roundTemplates: entries(content.roundTemplates, (form) => qualifiedForm(form, content.name)),
    rules,
    // Not sorted: the order of the file is the order the classes are offered in.
    defectClasses: content.defectClasses.map((defectClass) => ({
      defectClass: {
        key: `${content.name}.${defectClass.key}`,
        label: defectClass.label,
        unsafe: defectClass.unsafe,
        source: defectClass.source ?? null,
      },
      review: review(
        classReviews.get(defectClass.key),
        `Die Mängelklasse ${content.name}.${defectClass.key}`,
      ),
    })),
  }
}

/** The bundle, or every finding that keeps the packages from being one. */
export function loadCatalogue(
  files: ReadonlyMap<string, Uint8Array>,
  options: LoadOptions,
): LoadResult {
  const findings = new Findings()
  const packages = new Map<string, PackageContent>()
  const contentOf = (name: string): PackageContent => {
    const known = packages.get(name) ?? emptyPackage(name)
    packages.set(name, known)
    return known
  }

  for (const [path, bytes] of [...files].sort(([left], [right]) => byText(left, right))) {
    const place = classify(path)

    switch (place.kind) {
      case 'readme':
        break
      case 'unknown':
        findings.say(spotIn(path), place.reason)
        break
      case 'manifest': {
        const content = contentOf(place.packageName)
        const value = parsed(bytes, path, findings)
        content.manifestSeen = true
        content.manifest =
          value === unread
            ? undefined
            : readManifest(value, path, findings, place.packageName, options.applicationVersion)
        break
      }
      case 'acceptances': {
        const content = contentOf(place.packageName)
        const value = parsed(bytes, path, findings)
        content.acceptancesSeen = true
        content.acceptances = value === unread ? undefined : readAcceptances(value, path, findings)
        break
      }
      case 'defectClasses': {
        const content = contentOf(place.packageName)
        const value = parsed(bytes, path, findings)
        const classes = value === unread ? undefined : readDefectClasses(value, path, findings)

        content.defectClasses.push(...(classes ?? []))
        break
      }
      case 'entry': {
        const content = contentOf(place.packageName)
        const value = parsed(bytes, path, findings)
        const common = {
          file: path,
          folder: place.folder,
          key: place.key,
          version: place.version,
          bytes,
        }

        switch (entryFolders[place.folder]) {
          case 'assetKinds':
            content.assetKinds.push({
              ...common,
              read: value === unread ? undefined : readAssetKind(value, path, findings),
            })
            break
          case 'dutyKinds':
            content.dutyKinds.push({
              ...common,
              read: value === unread ? undefined : readDutyKind(value, path, findings),
            })
            break
          case 'forms':
            content.forms.push({
              ...common,
              read:
                value === unread
                  ? undefined
                  : readForm(value, path, findings, { key: place.key, version: place.version }),
            })
            break
          case 'roundTemplates':
            content.roundTemplates.push({
              ...common,
              read:
                value === unread
                  ? undefined
                  : readForm(value, path, findings, { key: place.key, version: place.version }),
            })
            break
        }
        break
      }
      case 'rules': {
        const content = contentOf(place.packageName)
        const value = parsed(bytes, path, findings)
        const records = value === unread ? undefined : readRules(value, path, findings)

        for (const record of records ?? []) {
          content.rules.push({ file: path, record })
        }
        break
      }
    }
  }

  for (const content of packages.values()) {
    if (!content.manifestSeen) {
      findings.say(spotIn(`${content.name}/manifest.json`), 'Das Manifest fehlt.')
    }

    if (!content.acceptancesSeen) {
      findings.say(
        spotIn(`${content.name}/abnahmen.json`),
        'Die Datei fehlt. Sie nennt für jeden Eintrag, wann er zuletzt gegen seine Quelle geprüft wurde, und wer ihn abgenommen hat.',
      )
    }
  }

  // First the files and their form, then how they hang together. A file that
  // could not be read leaves a hole every relation to it would fall into, and
  // a contributor would be told that a rule does not exist when it only has a
  // typo. So the second stage only runs once the first has nothing to say.
  if (findings.problems.length > 0) {
    return { bundle: null, problems: findings.problems }
  }

  const index = new Index(packages)

  for (const content of packages.values()) {
    for (const folder of Object.keys(entryFolders) as EntryFolder[]) {
      checkVersions(content, folder, content[entryFolders[folder]] as Version<unknown>[], findings)
    }

    checkKeys(content, findings)

    for (const version of content.dutyKinds) {
      if (version.read) {
        checkDutyKind(version, version.read.definition, content.name, index, findings)
      }
    }

    for (const version of [...content.forms, ...content.roundTemplates]) {
      if (version.read) {
        checkForm(version, version.read.definition, content.name, index, findings)
      }
    }

    checkReviews(content, options.today, findings)
  }

  // The rules of every package together, the way server and device will ask
  // them: two records of one key on one day, or a hole inside a run, would
  // only show up as a question without an answer on one particular day.
  const qualifiedRules = [...packages.values()].flatMap((content) =>
    content.rules.map(({ file, record }) => ({
      file,
      record: { ...record, key: `${content.name}.${record.key}` } as CatalogueRuleRecord,
    })),
  )

  try {
    ruleSet(qualifiedRules.map(({ record }) => record))
  } catch (error) {
    if (!(error instanceof RuleError)) {
      throw error
    }

    findings.say(spotIn('regeln'), error.message)
  }

  for (const hole of ruleHoles(qualifiedRules.map(({ record }) => record))) {
    const later = qualifiedRules.find(
      ({ record }) =>
        record.key === hole.key &&
        (record.scope ?? nationwide) === hole.scope &&
        record.validFrom === hole.before,
    )

    findings.say(
      spotIn(later?.file ?? 'regeln'),
      `Zwischen ${hole.after} und ${hole.before} gilt keine Regel ${hole.key}${hole.scope === nationwide ? '' : ` in ${ruleScopeNames[hole.scope]}`}. Eine Lücke am Ende einer Reihe ist, wo das Wissen aufhört; eine mitten darin ist ein Versehen.`,
    )
  }

  if (findings.problems.length > 0) {
    return { bundle: null, problems: findings.problems }
  }

  const content = [...packages.values()]
    .sort((left, right) => byText(left.name, right.name))
    .map(bundled)

  return {
    bundle: {
      format: catalogueFormat,
      sha256: sha256(JSON.stringify({ format: catalogueFormat, packages: content })),
      packages: content,
    },
    problems: [],
  }
}
