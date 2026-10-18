import type { IsoDate } from '@opengewerk/platform-domain'

import type {
  AssetField,
  AssetKind,
  Catalogue,
  CatalogueEntry,
  ChoiceOption,
  ExpectedDemand,
  ExpectedDocument,
} from './catalogue.js'
import { type DocumentKind, documentKinds } from './document.js'
import { type Problems, required } from './fields.js'

/**
 * Asset kinds and fields of the operator's own (#62, sections 2.5 and 4.2 of
 * the concept, ADR 0002 point 6, ADR 0005 point 2).
 *
 * An own kind stands beside the kinds of the packages under the key
 * `eigen.<key>`, which no package can take (decided 15.10.2026): it holds at
 * this operator alone, for assets no package describes, with what it is
 * called, its cost group, its fields and the documents an asset of it is
 * expected to have. The catalogue proposes no duty for it; an asset of it
 * gets duties of its own (4.3).
 *
 * A field of the operator's own is the same thing at an own kind and at a
 * kind of a package (decided 15.10.2026): the package stays as it is, and
 * the field stands beside its fields wherever the kind is asked about. Its
 * key begins with `eigen_`, which no field of a package begins with, so the
 * values of both stand in the one object of an asset without meeting.
 *
 * Neither travels as a record. Both come to a device with the catalogue,
 * which the server hands out with what its operator added (`OwnCatalogue`),
 * so that a form on site knows them without a network.
 */

/** The first part of the key of an own kind, where a package has its name. */
export const ownPackage = 'eigen'

/** What the key of every own field begins with. */
export const ownFieldPrefix = 'eigen_'

/** Whether a key of an asset kind is one of the operator's own. */
export function isOwnKind(key: string): boolean {
  return key.startsWith(`${ownPackage}.`)
}

/** The sorts of an own field: the sorts of a field of a package. */
export const ownFieldSorts = ['text', 'number', 'date', 'flag', 'choice'] as const

export type OwnFieldSort = (typeof ownFieldSorts)[number]

/** What each sort is called, in the words of the boards. */
export const ownFieldSortLabel: Readonly<Record<OwnFieldSort, string>> = {
  text: 'Text',
  number: 'Zahl',
  date: 'Datum',
  flag: 'Ja oder nein',
  choice: 'Auswahl',
}

/** The bounds of what an own kind and an own field say, the same in the form, the route and the database. */
export const ownKindLimits = {
  label: 120,
  unit: 20,
  option: 80,
  /** The choices of one field, as many as a list of choices sensibly holds. */
  options: 30,
  /** The fields one operator adds to one kind. */
  fields: 40,
  /** The documents one own kind expects. */
  documents: 20,
  /** The kinds of its own one operator keeps. */
  kinds: 200,
  source: 200,
} as const

/** An own kind as the office keeps it. */
export interface OwnAssetKind {
  readonly id: string
  /** `eigen.<key>`, made from the first label and kept when the label changes. */
  readonly key: string
  readonly label: string
  readonly costGroup: string
  readonly expectedDocuments: readonly ExpectedDocument[]
  /** Counted up with every change, as the version of a kind of a package. */
  readonly version: number
  /** The day of its last change, which stands where an entry of a package has its check. */
  readonly changedOn: IsoDate
}

/** An own field as the office keeps it, at an own kind or at a kind of a package. */
export interface OwnAssetField {
  readonly id: string
  /** The key of the kind it stands at, `<package>.<key>` or `eigen.<key>`. */
  readonly assetKind: string
  /** `eigen_<key>`, the name its value stands under in the values of an asset. */
  readonly key: string
  readonly label: string
  readonly sort: OwnFieldSort
  /** As a number is shown, "m³/h"; only a number has one. */
  readonly unit: string | null
  /** The choices of a choice, each with the value an asset keeps; the value stays when the label changes. */
  readonly options: readonly ChoiceOption[]
  readonly position: number
}

/** What the office reads of the own kinds and fields: each with how many assets use it, which decides what may go. */
export interface OwnKindsReading {
  readonly kinds: readonly (OwnAssetKind & {
    readonly assets: number
    readonly fields: readonly (OwnAssetField & { readonly values: number })[]
  })[]
  /** The own fields at kinds of packages, by kind and position. */
  readonly fields: readonly (OwnAssetField & { readonly values: number })[]
}

/**
 * What a catalogue holds of the operator's own, beside its packages: the own
 * kinds in the version they are in now, each with its fields, and the own
 * fields at kinds of packages by the key of the kind.
 */
export interface OwnCatalogue {
  readonly assetKinds: readonly CatalogueEntry<AssetKind>[]
  readonly fields: Readonly<Record<string, readonly AssetField[]>>
}

/** An own field as a kind lists its fields. */
export function assetFieldOf(field: OwnAssetField): AssetField {
  switch (field.sort) {
    case 'number':
      return {
        key: field.key,
        label: field.label,
        kind: 'number',
        ...(field.unit === null ? {} : { unit: field.unit }),
      }
    case 'choice':
      return { key: field.key, label: field.label, kind: 'choice', options: field.options }
    default:
      return { key: field.key, label: field.label, kind: field.sort }
  }
}

/** The day an own kind holds from: every day, since it has no history an asset could be read in. */
const ownFrom: IsoDate = '2000-01-01'

/**
 * The catalogue of one operator from the own kinds and fields it keeps: the
 * fields in the order they were given, removed ones left out by whoever reads
 * them.
 */
export function ownCatalogueOf(
  kinds: readonly OwnAssetKind[],
  fields: readonly OwnAssetField[],
): OwnCatalogue {
  const ordered = [...fields].sort(
    (left, right) => left.position - right.position || (left.key < right.key ? -1 : 1),
  )
  const at = (kind: string) => ordered.filter((field) => field.assetKind === kind).map(assetFieldOf)
  const own = new Set(kinds.map((kind) => kind.key))
  const fieldsOfPackages: Record<string, AssetField[]> = {}

  for (const field of ordered) {
    if (!own.has(field.assetKind)) {
      fieldsOfPackages[field.assetKind] = [
        ...(fieldsOfPackages[field.assetKind] ?? []),
        assetFieldOf(field),
      ]
    }
  }

  return {
    assetKinds: [...kinds]
      .sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0))
      .map((kind) => ({
        key: kind.key,
        version: kind.version,
        validFrom: ownFrom,
        definition: {
          label: kind.label,
          costGroup: kind.costGroup,
          characteristics: [],
          fields: at(kind.key),
          expectedDocuments: kind.expectedDocuments,
          meter: null,
        },
        review: { checkedOn: kind.changedOn, accepted: null },
      })),
    fields: fieldsOfPackages,
  }
}

/** Whether an operator has added anything to the catalogue. */
export function ownIsEmpty(own: OwnCatalogue): boolean {
  return own.assetKinds.length === 0 && Object.keys(own.fields).length === 0
}

/**
 * A catalogue with what an operator added: an own kind is asked like a kind of
 * a package, and a kind of a package carries the own fields after its own.
 * Everything else is the catalogue as it was. The checksum is the one the
 * server took over both, so that a device fetches the catalogue again when
 * the operator changes a kind of its own.
 */
export function withOwn(base: Catalogue, own: OwnCatalogue, sha256: string): Catalogue {
  const ownKinds = new Map(own.assetKinds.map((entry) => [entry.key, entry] as const))
  const extended = (entry: CatalogueEntry<AssetKind>): CatalogueEntry<AssetKind> => {
    const more = Object.hasOwn(own.fields, entry.key) ? own.fields[entry.key] : undefined

    return more === undefined || more.length === 0
      ? entry
      : {
          ...entry,
          definition: { ...entry.definition, fields: [...entry.definition.fields, ...more] },
        }
  }

  return {
    ...base,
    bundle: { ...base.bundle, sha256, own },
    sha256,
    assetKind: (key, on) => {
      if (isOwnKind(key)) {
        return ownKinds.get(key) ?? null
      }

      const entry = base.assetKind(key, on)

      return entry === null ? null : extended(entry)
    },
    assetKinds: (on) => [...base.assetKinds(on).map(extended), ...own.assetKinds],
  }
}

/**
 * The part of a key made of a label: lower case, the letters of German spelled
 * out the way an address writes them, every other run of signs an
 * underscore. A key is read by programs and never shown; the label stays as it
 * was typed.
 */
export function ownKeyStem(label: string): string {
  const spelled: Readonly<Record<string, string>> = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' }
  const words = label
    .toLowerCase()
    .replace(/[äöüß]/gu, (letter) => spelled[letter] ?? letter)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/gu, '')
    .split(/[^a-z0-9]+/u)
    .filter((word) => word !== '')
  let stem = ''

  for (const word of words) {
    const next = stem === '' ? word : `${stem}_${word}`

    if (next.length > 40) {
      break
    }

    stem = next
  }

  return stem === '' ? 'art' : stem
}

/** The first of `stem`, `stem_2`, `stem_3` … that is not taken. */
export function freeKey(prefix: string, stem: string, taken: ReadonlySet<string>): string {
  if (!taken.has(`${prefix}${stem}`)) {
    return `${prefix}${stem}`
  }

  for (let count = 2; ; count += 1) {
    const key = `${prefix}${stem}_${String(count)}`

    if (!taken.has(key)) {
      return key
    }
  }
}

/**
 * What is wrong with an own kind: its label, and a cost group the catalogue
 * knows from its kinds, so that the register orders an asset of it where it
 * orders the others of its group.
 */
export function ownKindProblems(
  kind: Readonly<Record<string, unknown>>,
  costGroups: readonly string[],
): Readonly<Problems> {
  const problems: Problems = {}

  required(problems, kind, 'label', ownKindLimits.label, 'Die Bezeichnung')

  const group = kind['costGroup']

  if (group !== undefined && !costGroups.includes(group as string)) {
    problems['costGroup'] = 'Die Kostengruppe ist keine, die der Katalog kennt.'
  }

  return problems
}

/** An expected document as the form of an own kind gives it, before it has a key. */
export interface OwnExpectedDocument {
  readonly key?: string
  readonly label: string
  readonly kind: DocumentKind
  readonly demand: ExpectedDemand
  readonly source: string | null
}

/**
 * What is wrong with the documents an own kind expects: each with its label
 * and the kind of document that fulfils it, required with its source or
 * recommended, and no more of them than a kind sensibly expects.
 */
export function expectedDocumentsProblem(value: unknown): string | null {
  if (!Array.isArray(value) || value.length > ownKindLimits.documents) {
    return `Eine Anlagenart erwartet höchstens ${String(ownKindLimits.documents)} Unterlagen.`
  }

  for (const entry of value as unknown[]) {
    const document = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<
      string,
      unknown
    >
    const label = document['label']
    const source = document['source']

    if (
      typeof label !== 'string' ||
      label.trim() === '' ||
      label.trim().length > ownKindLimits.label
    ) {
      return `Eine Unterlage hat eine Bezeichnung mit höchstens ${String(ownKindLimits.label)} Zeichen.`
    }

    if (!(documentKinds as readonly unknown[]).includes(document['kind'])) {
      return `Zur Unterlage „${label.trim()}“ fehlt die Art des Dokuments.`
    }

    if (document['demand'] === 'required') {
      if (
        typeof source !== 'string' ||
        source.trim() === '' ||
        source.trim().length > ownKindLimits.source
      ) {
        return `Eine verlangte Unterlage nennt ihre Fundstelle, „${label.trim()}“ nicht.`
      }
    } else if (document['demand'] !== 'recommended') {
      return `Die Unterlage „${label.trim()}“ ist verlangt oder empfohlen.`
    }
  }

  return null
}

/**
 * What is wrong with an own field: its label, its sort, a unit only at a
 * number, and the choices of a choice, at least two and each once.
 */
export function ownFieldProblems(field: Readonly<Record<string, unknown>>): Readonly<Problems> {
  const problems: Problems = {}

  required(problems, field, 'label', ownKindLimits.label, 'Die Bezeichnung')

  const sort = field['sort']

  if (sort !== undefined && !(ownFieldSorts as readonly unknown[]).includes(sort)) {
    problems['sort'] = 'Die Sorte ist Text, Zahl, Datum, Ja oder nein oder Auswahl.'
  }

  const unit = field['unit']

  if (unit !== undefined && unit !== null) {
    if (sort !== undefined && sort !== 'number') {
      problems['unit'] = 'Eine Einheit hat nur eine Zahl.'
    } else if (typeof unit !== 'string' || unit.trim().length > ownKindLimits.unit) {
      problems['unit'] = `Die Einheit hat höchstens ${String(ownKindLimits.unit)} Zeichen.`
    }
  }

  const options = field['options']

  if (options !== undefined) {
    const labels = Array.isArray(options)
      ? options.map((option) => (typeof option === 'string' ? option.trim() : ''))
      : []

    if (sort !== undefined && sort !== 'choice' && labels.length > 0) {
      problems['options'] = 'Auswahlen hat nur eine Auswahl.'
    } else if (
      (sort === 'choice' && labels.length < 2) ||
      labels.length > ownKindLimits.options ||
      labels.some((label) => label === '' || label.length > ownKindLimits.option) ||
      new Set(labels.map((label) => label.toLowerCase())).size !== labels.length
    ) {
      problems['options'] =
        `Eine Auswahl hat 2 bis ${String(ownKindLimits.options)} Möglichkeiten mit höchstens ${String(ownKindLimits.option)} Zeichen, jede einmal.`
    }
  }

  return problems
}
