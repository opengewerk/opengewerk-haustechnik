import type { TableField, TableRecord } from '@opengewerk/platform-domain'

import { stepsOf } from './asset-values.js'
import { type FormUnitKey, formUnits, type LimitBound } from './forms.js'
import {
  counted,
  type ImportNote,
  ImportNotes,
  type ImportProblem,
  ImportProblems,
  listed,
  nameKey,
} from './import.js'
import { type MeterUnit, meterUnits, meterUnitSymbol } from './meter.js'
import { meterDecimals } from './meter-reading.js'
import {
  type TemplateDefinition,
  type TemplateField,
  templateLimits,
  templateProblems,
  type TemplateRecords,
  type TemplateSection,
} from './round-template.js'

/**
 * The templates of the rounds of a predecessor application (#130, section 11
 * of the concept), as a plan.
 *
 * A line of the list is a point: it names its template and its chapter, what
 * is asked and how it is answered. The lines of one template become that
 * template with its first version, the chapters and the points in the order
 * of the list. A template taken over is the operator's own from then on, kept
 * in the office like one begun there; none of them goes into a package of
 * the project (section 5).
 *
 * A point of a list is about nothing yet: which asset or room it means, and
 * which duty its answer fulfils, is said afterwards in the editor, where the
 * assets can be chosen (section 11: "die Punkte nachträglich Anlagen
 * zugeordnet"). A limit comes over as a value the operator states, with its
 * source; a limit of a rule of a package is chosen in the editor as well.
 *
 * The plan writes nothing. It is worked out for the preview and once more
 * inside the transaction that writes, like the plan of every import.
 */

/** The fields of a line, in the order the page offers them. */
export const templateImportFields: readonly TableField[] = [
  {
    key: 'template',
    label: 'Vorlage',
    required: true,
    names: ['Rundgang', 'Checkliste', 'Formular', 'Name der Vorlage'],
  },
  { key: 'chapter', label: 'Kapitel', names: ['Abschnitt', 'Gruppe', 'Bereich'] },
  {
    key: 'point',
    label: 'Punkt',
    required: true,
    names: ['Prüfpunkt', 'Kontrollpunkt', 'Frage', 'Aufgabe'],
  },
  { key: 'kind', label: 'Art', names: ['Art des Punkts', 'Feldart', 'Typ'] },
  { key: 'hint', label: 'Hinweis', names: ['Erläuterung', 'Beschreibung', 'Hilfetext'] },
  { key: 'required', label: 'Pflichtfeld', names: ['Pflicht', 'Erforderlich'] },
  { key: 'unit', label: 'Einheit', names: [] },
  { key: 'decimals', label: 'Nachkommastellen', names: ['Stellen', 'Kommastellen'] },
  { key: 'options', label: 'Möglichkeiten', names: ['Auswahl', 'Optionen', 'Antworten'] },
  { key: 'atLeast', label: 'Mindestens', names: ['Mindestwert', 'Untergrenze', 'Min'] },
  { key: 'atMost', label: 'Höchstens', names: ['Höchstwert', 'Obergrenze', 'Max'] },
  { key: 'limitSource', label: 'Quelle des Grenzwerts', names: ['Quelle'] },
  { key: 'countersignature', label: 'Gegenzeichnung', names: ['Gegenzeichnen'] },
]

/** The kinds of point a list names, with the words of the editor. */
export const templatePointKinds = [
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

export type TemplatePointKind = (typeof templatePointKinds)[number]['value']

/** The name a chapter gets where a list names none, as an empty template begins in the editor. */
export const firstChapterTitle = 'Kapitel 1'

/** What separates the possibilities of a choice in their cell. */
export const optionSeparator = ';'

/** What a plan is held against: the titles of the templates the operator has. */
export interface TemplateImportStock {
  readonly templates: readonly { readonly title: string }[]
}

export interface PlannedTemplate {
  /** The first line of the list that names it. */
  readonly line: number
  readonly definition: TemplateDefinition
  readonly asksCountersignature: boolean
}

/** A template as the preview shows it. */
export interface TemplateImportRow {
  readonly line: number
  readonly title: string
  readonly chapters: number
  readonly points: number
  /** How many of its points measure against a limit the list states. */
  readonly limits: number
  readonly asksCountersignature: boolean
}

export interface TemplateImportCounts {
  readonly templates: number
  readonly chapters: number
  readonly points: number
  /** Lines of a template that is here already, and make nothing. */
  readonly known: number
}

export interface TemplateImportPlan {
  readonly lines: number
  readonly counts: TemplateImportCounts
  readonly problems: readonly ImportProblem[]
  readonly notes: readonly ImportNote[]
  readonly rows: readonly TemplateImportRow[]
  /** What taking over writes. Empty while there is a problem. */
  readonly create: { readonly templates: readonly PlannedTemplate[] }
}

/** A list knows no asset, no room, no duty, no rule and no kind: a point of it names none. */
const nothingNamed: TemplateRecords = {
  record: () => false,
  duty: () => null,
  ruleUnits: () => null,
  assetKind: () => false,
  dutyKind: () => null,
}

/** A unit as it is compared: "m3" is "m³" to whoever typed it, and "C" is "°C". */
const unitKey = (unit: string) => nameKey(unit).replace('³', '3').replace('°', '')

/** The units a meter counts in, as they are written. */
const meterSigns = meterUnits.map((each) => meterUnitSymbol[each])

/** A figure of a limit: digits, on request below nought and with a comma. */
const limitShape = /^-?\d+(?:,\d+)?/

const yes = new Set(['ja', 'x', 'wahr', 'true', '1'])
const no = new Set(['nein', 'falsch', 'false', '0'])

/** Yes, no, or what a cell says that is neither; null for an empty one. */
function flagOf(cell: string): boolean | null | undefined {
  const said = nameKey(cell)

  return said === '' ? null : yes.has(said) ? true : no.has(said) ? false : undefined
}

interface Draft {
  readonly line: number
  readonly title: string
  readonly lines: number[]
  readonly sections: { key: string; title: string; line: number; fields: TemplateField[] }[]
  /** The line of each point, by its key. */
  readonly pointLines: Map<string, number>
  readonly countersigned: { line: number; says: boolean }[]
  /** That a line of it has a problem of its own; the template as a whole is not asked then. */
  broken: boolean
}

/** What a list of templates would make of what is there. */
export function planTemplates(
  records: readonly TableRecord[],
  stock: TemplateImportStock,
): TemplateImportPlan {
  const problems = new ImportProblems()
  const notes = new ImportNotes()
  const here = new Set(stock.templates.map((template) => nameKey(template.title)))
  const drafts = new Map<string, Draft>()
  const labelOf = (field: string) =>
    templateImportFields.find((each) => each.key === field)?.label ?? field
  let known = 0

  for (const { line, values } of records) {
    const cell = (field: string) => values[field] ?? ''
    const title = cell('template')

    if (title === '') {
      problems.add(line, 'Die Vorlage fehlt')

      continue
    }

    if (here.has(nameKey(title))) {
      known += 1

      continue
    }

    const draft = drafts.get(nameKey(title)) ?? {
      line,
      title,
      lines: [],
      sections: [],
      pointLines: new Map<string, number>(),
      countersigned: [],
      broken: false,
    }
    const before = problems.added

    drafts.set(nameKey(title), draft)
    draft.lines.push(line)

    const asked = flagOf(cell('countersignature'))

    if (asked === undefined) {
      problems.add(line, `Die Gegenzeichnung ist ja oder nein, nicht „${cell('countersignature')}“`)
    } else if (asked !== null) {
      draft.countersigned.push({ line, says: asked })
    }

    // A line without a chapter belongs to the one above it, the first one to "Kapitel 1".
    const chapter = cell('chapter') || (draft.sections.at(-1)?.title ?? firstChapterTitle)
    const section = draft.sections.find((each) => nameKey(each.title) === nameKey(chapter)) ?? {
      key: `k${String(draft.sections.length + 1)}`,
      title: chapter,
      line,
      fields: [],
    }

    if (!draft.sections.includes(section)) {
      draft.sections.push(section)
    }

    const label = cell('point')

    if (label === '') {
      problems.add(line, 'Der Punkt fehlt')
    } else {
      const key = `p${String(draft.pointLines.size + 1)}`
      const field = pointOf(line, key, label, cell, problems, (column, why) => {
        notes.add(line, labelOf(column), why)
      })

      draft.pointLines.set(key, line)

      if (field !== null) {
        section.fields.push(field)
      }
    }

    draft.broken ||= problems.added > before
  }

  const templates: PlannedTemplate[] = []
  const rows: TemplateImportRow[] = []

  for (const draft of drafts.values()) {
    const says = new Set(draft.countersigned.map((each) => each.says))

    if (says.size > 1) {
      problems.add(
        draft.countersigned.map((each) => each.line),
        `Die Vorlage „${draft.title}“ verlangt die Gegenzeichnung in einer Zeile und in einer anderen nicht`,
      )
    }

    // A point that could not be read is left out above, and would leave its chapter short here.
    if (draft.broken || says.size > 1) {
      continue
    }

    const before = problems.added
    const definition: TemplateDefinition = {
      title: draft.title,
      sections: draft.sections.map(({ key, title, fields }): TemplateSection => ({
        key,
        title,
        fields,
      })),
    }

    for (const [place, sentence] of Object.entries(templateProblems(definition, nothingNamed))) {
      const section = draft.sections.find((each) => place === `chapter.${each.key}`)
      const point = place.startsWith('point.') ? place.slice('point.'.length) : null
      const label =
        point === null
          ? null
          : (draft.sections.flatMap((each) => each.fields).find((each) => each.key === point)
              ?.label ?? null)

      if (section !== undefined) {
        problems.addSentence(section.line, `Kapitel „${section.title}“`, sentence)
      } else if (point !== null && label !== null) {
        problems.addSentence(
          draft.pointLines.get(point) ?? draft.line,
          `Punkt „${label}“`,
          sentence,
        )
      } else {
        problems.addSentence(draft.line, `Vorlage „${draft.title}“`, sentence)
      }
    }

    if (JSON.stringify(definition).length > templateLimits.definition) {
      problems.add(draft.line, `Die Vorlage „${draft.title}“ ist zu groß, um sie zu speichern`)
    }

    if (problems.added > before) {
      continue
    }

    const points = definition.sections.flatMap((section) => section.fields)

    templates.push({
      line: draft.line,
      definition,
      asksCountersignature: says.has(true),
    })
    rows.push({
      line: draft.line,
      title: draft.title,
      chapters: definition.sections.length,
      points: points.length,
      limits: points.filter((point) => point.kind === 'measurement' && point.limit !== undefined)
        .length,
      asksCountersignature: says.has(true),
    })
  }

  const open = problems.list()
  const clear = open.length === 0

  return {
    lines: records.length,
    counts: {
      templates: templates.length,
      chapters: rows.reduce((sum, row) => sum + row.chapters, 0),
      points: rows.reduce((sum, row) => sum + row.points, 0),
      known,
    },
    problems: open,
    notes: notes.list(),
    rows,
    create: { templates: clear ? templates : [] },
  }
}

/** The unit a cell names, by its sign or by its key. */
function unitOf(cell: string): FormUnitKey | null {
  const said = unitKey(cell)

  return (
    (Object.keys(formUnits) as FormUnitKey[]).find(
      (unit) => unitKey(formUnits[unit].sign) === said || nameKey(unit) === said,
    ) ?? null
  )
}

/**
 * The point a line is, or null where the line cannot be read. What a cell
 * says that the kind of the point has no use for is noted and left out.
 */
function pointOf(
  line: number,
  key: string,
  label: string,
  cell: (field: string) => string,
  problems: ImportProblems,
  note: (column: string, why: string) => void,
): TemplateField | null {
  const before = problems.added
  const said = cell('kind')
  const kind: TemplatePointKind | undefined =
    said === ''
      ? 'check_point'
      : templatePointKinds.find(
          (each) => nameKey(each.label) === nameKey(said) || each.value === nameKey(said),
        )?.value

  if (kind === undefined) {
    problems.add(
      line,
      `Die Art „${said}“ ist keine von ${listed(templatePointKinds.map((each) => each.label))}`,
    )

    return null
  }

  const word = templatePointKinds.find((each) => each.value === kind)?.label ?? kind
  const counts = kind === 'measurement' || kind === 'meter_reading' || kind === 'number'
  const unused = (fields: readonly string[], why: string) => {
    for (const field of fields) {
      if (cell(field) !== '') {
        note(field, why)
      }
    }
  }

  if (!counts) {
    unused(
      ['unit', 'decimals'],
      `gilt für keinen Punkt der Art „${word}“ und wird nicht übernommen`,
    )
  }

  if (kind !== 'choice') {
    unused(['options'], `gilt nur für eine Auswahl und wird nicht übernommen`)
  }

  if (kind !== 'measurement') {
    unused(
      ['atLeast', 'atMost', 'limitSource'],
      `gilt nur für einen Messwert und wird nicht übernommen`,
    )
  }

  const required = flagOf(cell('required'))

  if (required === undefined) {
    problems.add(line, `Das Pflichtfeld ist ja oder nein, nicht „${cell('required')}“`)
  }

  const hint = cell('hint')
  const base = {
    key,
    label,
    ...(hint === '' ? {} : { hint }),
    // A measured value and a reading are asked for unless the list says otherwise, as in the editor.
    ...((required ?? (kind === 'measurement' || kind === 'meter_reading'))
      ? { required: true }
      : {}),
  }

  if (kind === 'choice') {
    const options = cell('options')
      .split(optionSeparator)
      .map((option) => option.trim())
      .filter((option) => option !== '')

    return problems.added > before
      ? null
      : {
          ...base,
          kind,
          options: options.map((option, at) => ({ value: `o${String(at + 1)}`, label: option })),
        }
  }

  if (!counts) {
    return problems.added > before
      ? null
      : kind === 'remark'
        ? { ...base, kind: 'text', multiline: true }
        : ({ ...base, kind } as TemplateField)
  }

  const unit = unitOf(cell('unit'))

  if (unit === null) {
    problems.add(
      line,
      cell('unit') === ''
        ? `Die Einheit fehlt: ein Punkt der Art „${word}“ nennt eine von ${listed(Object.values(formUnits).map((each) => each.sign))}`
        : `Die Einheit „${cell('unit')}“ ist keine von ${listed(Object.values(formUnits).map((each) => each.sign))}`,
    )

    return null
  }

  if (kind === 'meter_reading' && !(meterUnits as readonly string[]).includes(unit)) {
    problems.add(
      line,
      `Ein Zählerstand zählt in ${meterSigns.slice(0, -1).join(', ')} oder ${meterSigns.at(-1) ?? ''}, nicht in ${formUnits[unit].sign}`,
    )

    return null
  }

  const places = cell('decimals')
  const decimals =
    places === ''
      ? kind === 'measurement'
        ? 1
        : kind === 'meter_reading'
          ? ((meterDecimals as Readonly<Record<string, number>>)[unit as MeterUnit] ?? 0)
          : 0
      : /^[0-3]$/.test(places)
        ? Number(places)
        : null

  if (decimals === null) {
    problems.add(line, `Die Nachkommastellen sind eine Zahl von 0 bis 3, nicht „${places}“`)

    return null
  }

  if (kind !== 'measurement') {
    return problems.added > before ? null : { ...base, kind, unit, decimals }
  }

  const bounds = (
    [
      ['atLeast', 'at_least'],
      ['atMost', 'at_most'],
    ] as const
  ).filter(([field]) => cell(field) !== '')

  if (bounds.length > 1) {
    problems.add(line, 'Ein Messwert hat einen Grenzwert: mindestens oder höchstens, nicht beide')

    return null
  }

  const [bound] = bounds

  if (bound === undefined) {
    if (cell('limitSource') !== '') {
      note('limitSource', 'steht ohne Grenzwert und wird nicht übernommen')
    }

    return problems.added > before ? null : { ...base, kind, unit, decimals }
  }

  const milli = limitOf(line, cell(bound[0]), unit, problems)

  return milli === null || problems.added > before
    ? null
    : {
        ...base,
        kind,
        unit,
        decimals,
        limit: {
          kind: 'stated',
          bound: bound[1] satisfies LimitBound,
          milli,
          source: cell('limitSource'),
        },
      }
}

/** The value of a limit in thousandths of the unit of its point, written like every figure of a list. */
function limitOf(
  line: number,
  cell: string,
  unit: FormUnitKey,
  problems: ImportProblems,
): number | null {
  const sign = formUnits[unit].sign
  const [digits] = limitShape.exec(cell) ?? []
  const behind = digits === undefined ? '' : cell.slice(digits.length).trim()
  const milli = digits === undefined ? Number.NaN : stepsOf(digits, 3)

  if (!Number.isInteger(milli) || (behind !== '' && unitKey(behind) !== unitKey(sign))) {
    problems.add(
      line,
      `Der Grenzwert ist eine Zahl in ${sign} mit höchstens drei Stellen hinter dem Komma, geschrieben ohne Tausenderpunkt wie 55 oder 7,5, und nicht „${cell}“`,
    )

    return null
  }

  return milli
}

/**
 * A version of a template as a list the import takes in again (#558): a line
 * a point, in the columns of `templateImportFields` and in the words the
 * import reads, with its chapter, its kind and what that kind asks for, a
 * limit the operator states with its source. What a list cannot say is left
 * out, as the import leaves it to the editor: the asset, room or duty a point
 * is about, and a limit of a rule.
 */
export function templateLines(
  title: string,
  definition: TemplateDefinition,
  asksCountersignature: boolean,
): string[][] {
  const yesOrNo = (flag: boolean) => (flag ? 'ja' : 'nein')

  return definition.sections.flatMap((section) =>
    section.fields.map((field) => {
      const unit = (field as { readonly unit?: FormUnitKey }).unit
      const decimals = (field as { readonly decimals?: number }).decimals
      const limit = field.kind === 'measurement' ? field.limit : undefined
      const stated = limit?.kind === 'stated' ? limit : undefined
      const cells: Readonly<Record<string, string>> = {
        template: title,
        chapter: section.title,
        point: field.label,
        kind:
          field.kind === 'text' && (field as { readonly multiline?: boolean }).multiline === true
            ? 'Bemerkung'
            : (templatePointKinds.find((each) => each.value === field.kind)?.label ?? field.kind),
        hint: field.hint ?? '',
        required: yesOrNo(field.required === true),
        unit: unit === undefined ? '' : formUnits[unit].sign,
        decimals: decimals === undefined ? '' : String(decimals),
        options:
          field.kind === 'choice'
            ? field.options.map((option) => option.label).join(`${optionSeparator} `)
            : '',
        atLeast: stated?.bound === 'at_least' ? figureOf(stated.milli) : '',
        atMost: stated?.bound === 'at_most' ? figureOf(stated.milli) : '',
        limitSource: stated?.source ?? '',
        countersignature: yesOrNo(asksCountersignature),
      }

      return templateImportFields.map((column) => cells[column.key] ?? '')
    }),
  )
}

/** Thousandths of a unit as a list writes the figure: 55, 7,5 or -0,125. */
function figureOf(milli: number): string {
  return String(milli / 1000).replace('.', ',')
}

/** What an import of templates made, as the log and the page say it. */
export function templateImportSummary(counts: TemplateImportCounts): string {
  return `${counted(counts.templates, 'Vorlage', 'Vorlagen')} mit ${counted(counts.points, 'Punkt', 'Punkten')} übernommen`
}
