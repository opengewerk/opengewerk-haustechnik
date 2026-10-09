import {
  type Catalogue,
  type FormUnitKey,
  formUnits,
  forms,
  type MeasurementField,
  type TemplateDefinition,
  type TemplateField,
} from '@opengewerk/haustechnik-domain'

/**
 * The draft of a template in the editor (#112): what the person changes
 * before it becomes the next version. Every change makes a new draft; the
 * version it began from stays as it was until "Als neue Fassung speichern".
 */

/** The kinds of point the editor offers, in the order of its list, with the words of the board. */
export const pointKinds = [
  { value: 'check_point', label: 'Prüfpunkt' },
  { value: 'measurement', label: 'Messwert' },
  { value: 'meter_reading', label: 'Zählerstand' },
  { value: 'photo', label: 'Foto' },
  { value: 'remark', label: 'Bemerkung' },
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Zahl' },
  { value: 'choice', label: 'Auswahl' },
  { value: 'yes_no', label: 'Ja oder nein' },
] as const

export type PointKind = (typeof pointKinds)[number]['value']

/** The kind of point a field is, a remark being a text of several lines. */
export function pointKindOf(field: TemplateField): PointKind {
  return field.kind === 'text' && field.multiline === true ? 'remark' : field.kind
}

export function pointKindLabel(field: TemplateField): string {
  const kind = pointKindOf(field)

  return pointKinds.find((each) => each.value === kind)?.label ?? kind
}

/** The number in a key like `p12`, or nothing. */
function numberOf(key: string, prefix: string): number {
  const match = new RegExp(`^${prefix}(\\d+)$`).exec(key)

  return match ? Number(match[1]) : 0
}

/** A key that no point, or no chapter, of the draft has yet: `p13`, `k3`. */
export function nextKey(draft: TemplateDefinition, prefix: 'p' | 'k'): string {
  const keys =
    prefix === 'k'
      ? draft.sections.map((section) => section.key)
      : draft.sections.flatMap((section) => section.fields.map((field) => field.key))

  return `${prefix}${String(Math.max(0, ...keys.map((key) => numberOf(key, prefix))) + 1)}`
}

/** A template that is begun empty: one chapter without points. */
export function emptyTemplate(): TemplateDefinition {
  return { title: '', sections: [{ key: 'k1', title: 'Kapitel 1', fields: [] }] }
}

/** A point of a kind, as it starts in the dialog. */
export function newPoint(kind: PointKind, key: string, label = ''): TemplateField {
  switch (kind) {
    case 'remark':
      return { kind: 'text', key, label, multiline: true }
    case 'measurement':
      return {
        kind: 'measurement',
        key,
        label,
        unit: 'degrees_celsius',
        decimals: 1,
        required: true,
      }
    case 'meter_reading':
      return {
        kind: 'meter_reading',
        key,
        label,
        unit: 'kilowatt_hours',
        decimals: 0,
        required: true,
      }
    case 'number':
      return { kind: 'number', key, label, unit: 'degrees_celsius', decimals: 0 }
    case 'choice':
      return {
        kind: 'choice',
        key,
        label,
        options: [
          { value: 'o1', label: '' },
          { value: 'o2', label: '' },
        ],
      }
    default:
      return { kind, key, label } as TemplateField
  }
}

/** Where a point stands: its chapter and its place in it. */
export interface PointSpot {
  readonly chapter: string
  readonly index: number
}

export function spotOf(draft: TemplateDefinition, key: string): PointSpot | null {
  for (const section of draft.sections) {
    const index = section.fields.findIndex((field) => field.key === key)

    if (index >= 0) {
      return { chapter: section.key, index }
    }
  }

  return null
}

/** A chapter whose points may be changed in place, while a draft is put together. */
interface Open {
  readonly key: string
  readonly title: string
  fields: TemplateField[]
}

function withSections(
  draft: TemplateDefinition,
  change: (sections: Open[]) => void,
): TemplateDefinition {
  const sections = draft.sections.map((section) => ({ ...section, fields: [...section.fields] }))

  change(sections)

  return { ...draft, sections }
}

/** The draft with a point put at a place, taken from where it stood. */
export function placePoint(
  draft: TemplateDefinition,
  point: TemplateField,
  to: PointSpot,
): TemplateDefinition {
  return withSections(draft, (sections) => {
    for (const section of sections) {
      const at = section.fields.findIndex((field) => field.key === point.key)

      if (at >= 0) {
        section.fields.splice(at, 1)
      }
    }

    const target = sections.find((section) => section.key === to.chapter)

    target?.fields.splice(Math.min(Math.max(to.index, 0), target.fields.length), 0, point)
  })
}

/**
 * The draft with a point one place up or down. At the edge of its chapter it
 * goes to the end of the chapter before or the start of the one after; at the
 * edge of the template it stays.
 */
export function movePoint(
  draft: TemplateDefinition,
  key: string,
  step: -1 | 1,
): TemplateDefinition {
  const spot = spotOf(draft, key)

  if (spot === null) {
    return draft
  }

  const chapter = draft.sections.findIndex((section) => section.key === spot.chapter)
  const section = draft.sections[chapter]
  const point = section?.fields[spot.index]

  if (section === undefined || point === undefined) {
    return draft
  }

  const inside = spot.index + step

  if (inside >= 0 && inside < section.fields.length) {
    return placePoint(draft, point, { chapter: section.key, index: inside })
  }

  const neighbour = draft.sections[chapter + step]

  return neighbour === undefined
    ? draft
    : placePoint(draft, point, {
        chapter: neighbour.key,
        index: step === -1 ? neighbour.fields.length : 0,
      })
}

/** The draft with a chapter at another place among the chapters. */
export function placeChapter(
  draft: TemplateDefinition,
  key: string,
  index: number,
): TemplateDefinition {
  const chapter = draft.sections.find((section) => section.key === key)

  if (chapter === undefined) {
    return draft
  }

  const others = draft.sections.filter((section) => section.key !== key)

  others.splice(Math.min(Math.max(index, 0), others.length), 0, chapter)

  return { ...draft, sections: others }
}

export function moveChapter(
  draft: TemplateDefinition,
  key: string,
  step: -1 | 1,
): TemplateDefinition {
  const index = draft.sections.findIndex((section) => section.key === key)

  return index < 0 ? draft : placeChapter(draft, key, index + step)
}

/** The draft with a point changed in place, or put at the end of another chapter. */
export function withPoint(
  draft: TemplateDefinition,
  point: TemplateField,
  chapter: string,
): TemplateDefinition {
  const spot = spotOf(draft, point.key)

  if (spot !== null && spot.chapter === chapter) {
    return withSections(draft, (sections) => {
      const section = sections.find((each) => each.key === chapter)

      section?.fields.splice(spot.index, 1, point)
    })
  }

  const target = draft.sections.find((section) => section.key === chapter)

  return placePoint(draft, point, { chapter, index: target?.fields.length ?? 0 })
}

export function withoutPoint(draft: TemplateDefinition, key: string): TemplateDefinition {
  return withSections(draft, (sections) => {
    for (const section of sections) {
      section.fields = section.fields.filter((field) => field.key !== key)
    }
  })
}

export function withChapter(
  draft: TemplateDefinition,
  key: string,
  title: string,
): TemplateDefinition {
  return draft.sections.some((section) => section.key === key)
    ? {
        ...draft,
        sections: draft.sections.map((section) =>
          section.key === key ? { ...section, title } : section,
        ),
      }
    : { ...draft, sections: [...draft.sections, { key, title, fields: [] }] }
}

export function withoutChapter(draft: TemplateDefinition, key: string): TemplateDefinition {
  return { ...draft, sections: draft.sections.filter((section) => section.key !== key) }
}

/** "2 Kapitel, 8 Punkte". */
export function sizeWords(draft: TemplateDefinition): string {
  const points = draft.sections.reduce((sum, section) => sum + section.fields.length, 0)

  return `${String(draft.sections.length)} Kapitel, ${String(points)} ${points === 1 ? 'Punkt' : 'Punkte'}`
}

/** The sign of a unit: °C, kWh. */
export function unitSign(unit: FormUnitKey): string {
  return formUnits[unit].sign
}

const noRules = { at: () => null } as unknown as Catalogue['ruleSet']

/** The limit of a measured value in words with its source, on a day: "Grenzwert mindestens 60,0 °C, DVGW W 551". */
export function limitWords(
  field: MeasurementField,
  catalogue: Catalogue | null,
  on: string,
): string {
  if (field.limit === undefined) {
    return 'ohne Grenzwert'
  }

  if (catalogue === null && 'rule' in field.limit) {
    return 'Grenzwert aus einer Regel, der Katalog ist noch nicht auf diesem Gerät'
  }

  // A stated limit asks no rule; one of a rule has returned above without a catalogue.
  const verdict = forms.limitVerdict(field, null, {
    rules: catalogue?.ruleSet ?? noRules,
    on: on as Parameters<typeof forms.limitVerdict>[2]['on'],
  })
  const said = verdict.text.replace(/^Grenzwert: /, 'Grenzwert ').replace(/\.$/, '')

  return verdict.source === null ? said : `${said}, ${verdict.source}`
}

/** What a point asks, in a line under its label, as the board writes it. */
export function pointDetail(field: TemplateField, catalogue: Catalogue | null, on: string): string {
  const optional = field.required === true ? 'muss ausgefüllt werden' : 'freiwillig'

  switch (field.kind) {
    case 'check_point':
      return 'in Ordnung, nicht in Ordnung, entfällt, nicht möglich'
    case 'measurement':
      return `in ${unitSign(field.unit)}, ${limitWords(field, catalogue, on)}`
    case 'meter_reading':
      return `Stand in ${unitSign(field.unit)}, ${optional}`
    case 'number':
      return `Zahl in ${unitSign(field.unit)}, ${optional}`
    case 'choice':
      return `${field.options.map((option) => option.label).join(', ')}; ${optional}`
    case 'yes_no':
      return `ja oder nein, ${optional}`
    case 'photo':
      return optional
    default:
      return `Text, ${optional}`
  }
}
