import {
  dayOfCell,
  type DeadlineInterval,
  type FederalState,
  type IsoDate,
  type TableField,
  type TableRecord,
} from '@opengewerk/platform-domain'

import { duplicateKey } from './asset-duplicate.js'
import {
  type Catalogue,
  type CatalogueEntry,
  type Counting,
  countingLabel,
  countings,
  type DutyKind,
  type DutyTask,
  dutyTaskLabel,
  dutyTasks,
} from './catalogue.js'
import { type DocumentKind, documentLimits, documentTitleOf } from './document.js'
import { nextAppointment } from './duty.js'
import {
  dutyBases,
  type DutyBasis,
  dutyBasisLabel,
  dutyIntervalProblem,
  dutyLimits,
  intervalNeedsReason,
  intervalOfRule,
  intervalWords,
} from './duty-record.js'
import { ceilingOf } from './duty-update.js'
import { type EvidenceResult, evidenceResultLabel } from './evidence.js'
import {
  type AssetNaming,
  assetWords,
  counted,
  grouped,
  type ImportNote,
  ImportNotes,
  type ImportProblem,
  ImportProblems,
  listed,
  namedAsset,
  nameKey,
} from './import.js'

/**
 * The running deadlines of a predecessor application and its old evidence
 * (#130, section 11 of the concept), as a plan.
 *
 * No deadline begins anew with the change of application. A line of the list
 * names an asset that is here, a duty, the day it was last met and, on
 * request, the day it is due next. Where the duty does not stand at the asset
 * yet, the import confirms it. The latest line of a duty becomes an evidence
 * of the origin "Altbestand": it counts for the deadline like any other, and
 * it never looks like a signed one. What lies before it, and a line that names
 * no duty, is an old evidence beyond that: a document with its original file,
 * marked as taken over, neither signed anew nor rewritten.
 *
 * The plan writes nothing. It is worked out for the preview and once more
 * inside the transaction that writes, like the plan of every import.
 */

/** The bounds of what a list says beside the fields of a duty and of a document. */
export const deadlineImportLimits = { remark: 500, fileName: 200 } as const

const markNames = [
  'Inventar-Nr.',
  'Inventarnummer',
  'Anlagenkennzeichen',
  'Kennzeichnung',
  'AKS',
] as const

/** The fields of a line, in the order the page offers them. None is needed for every line. */
export const deadlineImportFields: readonly TableField[] = [
  {
    key: 'assetNumber',
    label: 'Anlagennummer',
    names: ['Anlagen-Nr.', 'Anlagennr', 'Nummer der Anlage'],
  },
  { key: 'mark', label: 'Kennzeichen', names: markNames },
  {
    key: 'serialNumber',
    label: 'Seriennummer',
    names: ['Serien-Nr.', 'Seriennr', 'Fabriknummer', 'Fabrik-Nr.', 'SN'],
  },
  {
    key: 'duty',
    label: 'Pflicht',
    names: ['Pflichtart', 'Prüfung', 'Prüfart', 'Art der Prüfung', 'Prüfpflicht'],
  },
  {
    key: 'performedOn',
    label: 'Letzter Nachweis',
    names: ['Letzte Prüfung', 'Letzte Durchführung', 'Geprüft am', 'Durchgeführt am'],
  },
  {
    key: 'nextDueOn',
    label: 'Nächste Fälligkeit',
    names: ['Nächste Prüfung', 'Fällig am', 'Fälligkeit', 'Nächster Termin'],
  },
  { key: 'result', label: 'Ergebnis', names: ['Prüfergebnis', 'Befund'] },
  { key: 'remark', label: 'Vermerk', names: ['Bemerkung', 'Anmerkung', 'Hinweis'] },
  { key: 'file', label: 'Datei', names: ['Dateiname', 'PDF', 'Prüfbericht', 'Bericht'] },
  { key: 'title', label: 'Bezeichnung des Dokuments', names: ['Dokumentname', 'Titel'] },
  { key: 'basis', label: 'Grundlage', names: ['Grundlage der Pflicht'] },
  { key: 'sourceNote', label: 'Quelle', names: ['Fundstelle', 'Rechtsgrundlage'] },
  { key: 'task', label: 'Tätigkeit', names: ['Art der Tätigkeit'] },
  { key: 'interval', label: 'Frist', names: ['Intervall', 'Turnus', 'Prüffrist', 'Prüfintervall'] },
  { key: 'counting', label: 'Zählweise', names: ['Zählung'] },
  { key: 'intervalReason', label: 'Begründung der Frist', names: ['Begründung'] },
]

/** An asset a line may name, with what a duty at it is counted by. */
export interface DeadlineImportAsset {
  readonly id: string
  readonly number: string | null
  readonly name: string
  readonly mark: string | null
  readonly serialNumber: string | null
  readonly kind: string
  readonly federalState: FederalState
}

/** A duty that stands at one of the assets, with the days of the evidence that stands for it. */
export interface DeadlineImportDuty {
  readonly id: string
  readonly assetId: string
  readonly kind: string | null
  readonly label: string | null
  readonly counting: Counting
  readonly intervalDays: number | null
  readonly intervalMonths: number | null
  /** The days of its evidence that stands, whatever the result. */
  readonly evidenceDays: readonly IsoDate[]
}

/** What a plan is held against: what the person importing sees, the catalogue and the day. */
export interface DeadlineImportStock {
  readonly assets: readonly DeadlineImportAsset[]
  readonly duties: readonly DeadlineImportDuty[]
  /** The documents taken over before, by their asset and the name of their file. */
  readonly takenOver: readonly { readonly assetId: string; readonly fileName: string }[]
  /** The names of the files chosen beside the table. */
  readonly files: readonly string[]
  readonly catalogue: Pick<Catalogue, 'dutyKind' | 'dutyKinds' | 'interval'>
  readonly today: IsoDate
}

const missingAsset = 'Die Anlage fehlt: Anlagennummer, Kennzeichen oder Seriennummer'

/** A duty the import confirms: one of the catalogue with its kind, or one of the operator's own. */
export interface PlannedDuty {
  readonly assetId: string
  readonly kind: string | null
  readonly kindVersion: number | null
  readonly label: string | null
  readonly basis: DutyBasis | null
  readonly sourceNote: string | null
  readonly task: DutyTask | null
  readonly counting: Counting
  readonly interval: DeadlineInterval
  readonly intervalReason: string | null
  readonly maximum: DeadlineInterval | null
  readonly guide: DeadlineInterval | null
}

/** The evidence of a duty a line is taken over as. */
export interface PlannedEvidence {
  readonly line: number
  readonly assetId: string
  /** The duty it meets: one that stands, or the place of one in `create.duties`. */
  readonly duty: { readonly id: string } | { readonly planned: number }
  readonly performedOn: IsoDate
  readonly nextDueOn: IsoDate | null
  readonly result: EvidenceResult
  readonly remark: string | null
  /** The file it rests on, by the name it was chosen under; none where the list names none. */
  readonly file: string | null
}

/** An old evidence beyond the last: a document at its asset, with its original file. */
export interface PlannedDocument {
  readonly line: number
  readonly assetId: string
  readonly title: string
  readonly kind: DocumentKind
  readonly file: string
}

/** Where the next due day of a line that is taken over comes from. */
export type DueFrom = 'list' | 'month_of_list' | 'counted'

/** What the preview says under such a day. */
export const dueFromWords: Readonly<Record<DueFrom, string>> = {
  list: 'aus der Liste',
  month_of_list: 'Monat aus der Liste',
  counted: 'gerechnet',
}

/** A line as the preview shows it under "Übernommen wird". */
export interface DeadlineImportRow {
  readonly line: number
  readonly asset: { readonly id: string; readonly number: string | null; readonly name: string }
  /** The duty in words; none for a document that names none. */
  readonly duty: string | null
  /** What the line becomes: the evidence of its duty, or a document. */
  readonly becomes: 'evidence' | 'document'
  /** Whether the import confirms the duty, which did not stand at the asset. */
  readonly confirms: boolean
  readonly performedOn: IsoDate | null
  /** The day the duty is due next once the line is taken over; none for a document. */
  readonly dueOn: IsoDate | null
  /**
   * Where that day comes from: the list names it, the list names a day of its
   * month (under § 14 Abs. 5 BetrSichV an appointment is a month), or it is
   * counted from the evidence.
   */
  readonly dueFrom: DueFrom
  readonly remark: string | null
  readonly file: string | null
}

export interface DeadlineImportCounts {
  /** Duties the import confirms. */
  readonly duties: number
  /** Lines that become the evidence of a duty. */
  readonly evidence: number
  /** Lines that become a document. */
  readonly documents: number
  /** Lines that name what is here already, and make nothing. */
  readonly known: number
}

export interface DeadlineImportPlan {
  readonly lines: number
  readonly counts: DeadlineImportCounts
  readonly problems: readonly ImportProblem[]
  readonly notes: readonly ImportNote[]
  readonly rows: readonly DeadlineImportRow[]
  /** What taking over writes. Empty while there is a problem. */
  readonly create: {
    readonly duties: readonly PlannedDuty[]
    readonly evidence: readonly PlannedEvidence[]
    readonly documents: readonly PlannedDocument[]
  }
}

/** The name of a file as it is compared: without the spaces around it and without regard to capitals. */
export function fileNameKey(name: string): string {
  return name.trim().toLowerCase()
}

/** A day as people write it in Germany: "14.09.2024". */
function written(day: IsoDate): string {
  return `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}`
}

/**
 * The interval a cell names: a count with its unit, "24 Monate", "2 Jahre",
 * "90 Tage", "6 Wochen", or a bare count, which is one of months. Years
 * become months and weeks days, because a duty counts in days or in months.
 */
export function intervalOfCell(text: string): DeadlineInterval | null {
  const found = /^(\d{1,4}) ?([a-zäöü]{0,8})\.?$/iu.exec(text.trim())
  const count = Number(found?.[1] ?? 0)
  const unit = (found?.[2] ?? '').toLowerCase()

  if (!found || count < 1) {
    return null
  }

  if (['', 'm', 'mon', 'monat', 'monate', 'monaten'].includes(unit)) {
    return { months: count }
  }

  if (['j', 'jahr', 'jahre', 'jahren'].includes(unit)) {
    return { months: count * 12 }
  }

  if (['t', 'tag', 'tage', 'tagen'].includes(unit)) {
    return { days: count }
  }

  return ['w', 'woche', 'wochen'].includes(unit) ? { days: count * 7 } : null
}

/** The one of a list of choices a cell names by its word, without regard to spaces and capitals. */
function chosen<Key extends string>(
  cell: string,
  choices: readonly Key[],
  label: Readonly<Record<Key, string>>,
): Key | null {
  const key = nameKey(cell)

  return choices.find((choice) => nameKey(label[choice]) === key || choice === key) ?? null
}

/** What a list writes for a result that meets a duty; a duty is not taken over with any other. */
const resultWords: Readonly<Record<string, EvidenceResult>> = {
  ohnemangel: 'without_defects',
  ohnemängel: 'without_defects',
  mängelfrei: 'without_defects',
  mitmängeln: 'with_defects',
  mitmangel: 'with_defects',
  mitmängel: 'with_defects',
}

/** What a list writes for the basis of a duty of the operator's own, beside the words of the form. */
const basisWords: Readonly<Record<string, DutyBasis>> = {
  hersteller: 'manufacturer',
  auflage: 'authority',
  versicherer: 'insurer',
  eigen: 'own_decision',
}

/** The duty kinds of the catalogue that apply to an asset kind today. */
function kindsFor(stock: DeadlineImportStock, assetKind: string): CatalogueEntry<DutyKind>[] {
  return stock.catalogue
    .dutyKinds(stock.today)
    .filter((entry) => entry.definition.scope.assetKinds.includes(assetKind))
}

/** A duty a line names, before it is known whether it stands: what identifies it at its asset, and how it counts. */
interface NamedDuty {
  /** What tells it from the other duties of the asset: the key of its kind, or the name of one of the operator's own. */
  readonly identity: string
  readonly label: string
  readonly kind: string | null
  readonly counting: Counting
  readonly interval: DeadlineInterval
  /** The duty to confirm where it does not stand yet. */
  readonly confirm: Omit<PlannedDuty, 'assetId'>
}

/** A line that names a duty, read as far as its own cells go. */
interface EvidenceLine {
  readonly line: number
  readonly asset: DeadlineImportAsset
  readonly named: NamedDuty
  readonly performedOn: IsoDate
  readonly nextDueOn: IsoDate | null
  readonly result: EvidenceResult
  readonly remark: string | null
  readonly file: string | null
  readonly title: string | null
}

/**
 * What the lines of a table would make of duties, evidence and documents,
 * against what is there.
 */
export function planDeadlines(
  records: readonly TableRecord[],
  stock: DeadlineImportStock,
): DeadlineImportPlan {
  const problems = new ImportProblems()
  const notes = new ImportNotes()
  const rows: DeadlineImportRow[] = []
  const duties: PlannedDuty[] = []
  const evidence: PlannedEvidence[] = []
  const documents: PlannedDocument[] = []
  let known = 0

  const byNumber = grouped(stock.assets, (asset) => duplicateKey(asset.number))
  const byMark = grouped(stock.assets, (asset) => duplicateKey(asset.mark))
  const bySerial = grouped(stock.assets, (asset) => duplicateKey(asset.serialNumber))
  const namings: readonly AssetNaming<DeadlineImportAsset>[] = [
    { field: 'assetNumber', word: 'Anlagennummer', article: 'der', index: byNumber },
    { field: 'mark', word: 'Kennzeichen', article: 'dem', index: byMark },
    { field: 'serialNumber', word: 'Seriennummer', article: 'der', index: bySerial },
  ]
  const files = new Map(stock.files.map((name) => [fileNameKey(name), name]))
  const takenOver = new Set(
    stock.takenOver.map((each) => `${each.assetId}\u0000${fileNameKey(each.fileName)}`),
  )
  const standing = new Map<string, DeadlineImportDuty>()

  for (const duty of stock.duties) {
    standing.set(`${duty.assetId}\u0000${duty.kind ?? `own ${nameKey(duty.label ?? '')}`}`, duty)
  }

  /** The lines that name a duty, by the duty at its asset, in the order they were first named. */
  const named = new Map<string, EvidenceLine[]>()

  const fileOf = (line: number, cell: string): string | null | undefined => {
    if (cell === '') {
      return null
    }

    const found = files.get(fileNameKey(cell))

    if (found === undefined) {
      problems.add(
        line,
        `Die Datei „${cell}“ ist nicht gewählt`,
        'Im ersten Schritt die Dateien der Liste dazu wählen',
      )
    }

    return found
  }

  const document = (
    line: number,
    asset: DeadlineImportAsset,
    file: string,
    title: string,
    row: Pick<DeadlineImportRow, 'duty' | 'performedOn' | 'remark'>,
  ) => {
    if (takenOver.has(`${asset.id}\u0000${fileNameKey(file)}`)) {
      known += 1

      return
    }

    documents.push({ line, assetId: asset.id, title, kind: 'test_certificate', file })
    rows.push({
      line,
      asset: { id: asset.id, number: asset.number, name: asset.name },
      ...row,
      becomes: 'document',
      confirms: false,
      dueOn: null,
      dueFrom: 'counted',
      file,
    })
  }

  for (const { line, values } of records) {
    const cell = (field: string) => values[field] ?? ''
    const before = problems.added
    const asset = namedAsset(line, cell, namings, problems, missingAsset)
    const file = fileOf(line, cell('file'))
    const title = cell('title')

    if (title.length > documentLimits.title) {
      problems.add(
        line,
        `Die Bezeichnung des Dokuments hat höchstens ${String(documentLimits.title)} Zeichen`,
      )
    }

    if (cell('duty') === '') {
      if (file === null) {
        problems.add(
          line,
          'Eine Zeile ohne Pflicht ist ein Dokument und nennt seine Datei',
          'Die Pflicht oder die Datei nennen und neu hochladen',
        )
      }

      if (asset !== null && typeof file === 'string' && problems.added === before) {
        document(line, asset, file, title === '' ? documentTitleOf(file) : title, {
          duty: null,
          performedOn: dayOfCell(cell('performedOn')),
          remark: null,
        })
      }

      continue
    }

    const performedOn = performedOnOf(line, cell('performedOn'), stock.today, problems)
    const nextDueOn = nextDueOnOf(line, cell('nextDueOn'), performedOn, problems)
    const result = resultOf(line, cell('result'), problems)
    const remark = cell('remark')

    if (remark.length > deadlineImportLimits.remark) {
      problems.add(line, `Der Vermerk hat höchstens ${String(deadlineImportLimits.remark)} Zeichen`)
    }

    const duty = asset === null ? null : dutyOf(line, cell, asset, stock, problems)

    if (
      asset === null ||
      duty === null ||
      performedOn === null ||
      result === null ||
      file === undefined ||
      problems.added > before
    ) {
      continue
    }

    const key = `${asset.id}\u0000${duty.identity}`

    named.set(key, [
      ...(named.get(key) ?? []),
      {
        line,
        asset,
        named: duty,
        performedOn,
        nextDueOn,
        result,
        remark: remark === '' ? null : remark,
        file,
        title: title === '' ? null : title,
      },
    ])
  }

  for (const [key, lines] of named) {
    const inOrder = [...lines].sort((one, other) =>
      one.performedOn === other.performedOn
        ? one.line - other.line
        : one.performedOn < other.performedOn
          ? -1
          : 1,
    )
    const twice = inOrder.filter(
      (each, index) => index > 0 && inOrder[index - 1]?.performedOn === each.performedOn,
    )

    for (const each of twice) {
      const first = inOrder.find((other) => other.performedOn === each.performedOn)

      problems.add(
        [first?.line ?? each.line, each.line],
        `${each.named.label} an ${assetWords(each.asset)} steht für den ${written(each.performedOn)} zweimal in der Datei`,
        'Eine der Zeilen streichen und neu hochladen',
      )
    }

    if (twice.length > 0) {
      continue
    }

    const last = inOrder.at(-1) as EvidenceLine
    const there = standing.get(key)
    const days = there?.evidenceDays ?? []
    const latestThere = [...days].sort().at(-1)
    /** The line that becomes the evidence: the last of the list, unless the duty has one of that day or a later. */
    const taken = latestThere !== undefined && latestThere >= last.performedOn ? null : last

    for (const each of inOrder) {
      if (each === taken) {
        continue
      }

      if (days.includes(each.performedOn)) {
        known += 1
      } else if (each.file === null) {
        notes.add(
          each.line,
          'Datei',
          'Ein älterer Nachweis ohne Datei wird nicht übernommen: für die Frist zählt der letzte',
        )
      } else {
        document(
          each.line,
          each.asset,
          each.file,
          each.title ??
            `${each.named.label} vom ${written(each.performedOn)}`.slice(0, documentLimits.title),
          { duty: each.named.label, performedOn: each.performedOn, remark: each.remark },
        )
      }
    }

    if (taken === null) {
      continue
    }

    const interval =
      there === undefined
        ? taken.named.interval
        : there.intervalMonths !== null
          ? { months: there.intervalMonths }
          : { days: there.intervalDays ?? 0 }
    const counting = there?.counting ?? taken.named.counting
    const appointment = nextAppointment(
      {
        counting,
        interval,
        ceiling: {
          on: ceilingOf(stock.catalogue, taken.named.kind, taken.asset.federalState),
          today: stock.today,
        },
        takenOver:
          taken.nextDueOn === null
            ? null
            : { performedOn: taken.performedOn, dueOn: taken.nextDueOn },
      },
      [taken.performedOn],
    )
    const asNamed =
      taken.nextDueOn === null
        ? null
        : counting === 'betrsichv'
          ? `${taken.nextDueOn.slice(0, 7)}-01`
          : taken.nextDueOn

    if (appointment !== null && asNamed !== null && appointment.dueOn !== asNamed) {
      problems.add(
        taken.line,
        `Die nächste Fälligkeit ${written(taken.nextDueOn ?? asNamed)} liegt hinter der Höchstfrist der Pflicht ${taken.named.label}: fällig spätestens am ${written(appointment.dueOn)}`,
      )

      continue
    }

    let duty: PlannedEvidence['duty']

    if (there === undefined) {
      duties.push({ assetId: taken.asset.id, ...taken.named.confirm })
      duty = { planned: duties.length - 1 }
    } else {
      duty = { id: there.id }
    }

    evidence.push({
      line: taken.line,
      assetId: taken.asset.id,
      duty,
      performedOn: taken.performedOn,
      nextDueOn: taken.nextDueOn,
      result: taken.result,
      remark: taken.remark,
      file: taken.file,
    })
    rows.push({
      line: taken.line,
      asset: { id: taken.asset.id, number: taken.asset.number, name: taken.asset.name },
      duty: taken.named.label,
      becomes: 'evidence',
      confirms: there === undefined,
      performedOn: taken.performedOn,
      dueOn: appointment?.dueOn ?? null,
      dueFrom:
        taken.nextDueOn === null
          ? 'counted'
          : appointment?.dueOn === taken.nextDueOn
            ? 'list'
            : 'month_of_list',
      remark: taken.remark,
      file: taken.file,
    })
  }

  const open = problems.list()
  const clear = open.length === 0

  return {
    lines: records.length,
    counts: {
      duties: duties.length,
      evidence: evidence.length,
      documents: documents.length,
      known,
    },
    problems: open,
    notes: notes.list(),
    rows: rows.sort((one, other) => one.line - other.line),
    create: clear ? { duties, evidence, documents } : { duties: [], evidence: [], documents: [] },
  }
}

function performedOnOf(
  line: number,
  cell: string,
  today: IsoDate,
  problems: ImportProblems,
): IsoDate | null {
  if (cell === '') {
    problems.add(line, 'Der Tag des letzten Nachweises fehlt')

    return null
  }

  const day = dayOfCell(cell)

  if (day === null) {
    problems.add(line, 'Der letzte Nachweis ist kein Tag, geschrieben 02.10.2026 oder 2026-10-02')

    return null
  }

  if (day > today) {
    problems.add(line, 'Ein Nachweis gilt für einen Tag, der schon war')

    return null
  }

  return day
}

function nextDueOnOf(
  line: number,
  cell: string,
  performedOn: IsoDate | null,
  problems: ImportProblems,
): IsoDate | null {
  if (cell === '') {
    return null
  }

  const day = dayOfCell(cell)

  if (day === null) {
    problems.add(
      line,
      'Die nächste Fälligkeit ist kein Tag, geschrieben 02.10.2026 oder 2026-10-02',
    )

    return null
  }

  if (performedOn !== null && day <= performedOn) {
    problems.add(line, 'Die nächste Fälligkeit liegt nach dem Tag des letzten Nachweises')

    return null
  }

  return day
}

function resultOf(line: number, cell: string, problems: ImportProblems): EvidenceResult | null {
  if (cell === '') {
    return 'without_defects'
  }

  const result = resultWords[nameKey(cell)] ?? null

  if (result === null) {
    problems.add(
      line,
      `Das Ergebnis ist „${evidenceResultLabel.without_defects}“ oder „${evidenceResultLabel.with_defects}“: übernommen wird, was die Frist weiterlaufen lässt`,
    )
  }

  return result
}

/** The interval a line names, or nothing for an empty cell; what is no interval is a problem. */
function intervalOf(
  line: number,
  cell: string,
  problems: ImportProblems,
): DeadlineInterval | null | undefined {
  if (cell === '') {
    return null
  }

  const interval = intervalOfCell(cell)

  if (interval === null) {
    problems.add(
      line,
      'Die Frist ist eine Zahl mit Monaten, Jahren, Wochen oder Tagen, etwa „24 Monate“',
    )

    return undefined
  }

  return interval
}

const asColumns = (interval: DeadlineInterval) =>
  'days' in interval ? { intervalDays: interval.days } : { intervalMonths: interval.months }

/**
 * The duty a line names at its asset: one of the operator's own where the
 * line gives a basis, else a duty kind of the catalogue that applies to the
 * kind of the asset, by its name or its key.
 */
function dutyOf(
  line: number,
  cell: (field: string) => string,
  asset: DeadlineImportAsset,
  stock: DeadlineImportStock,
  problems: ImportProblems,
): NamedDuty | null {
  const before = problems.added
  const name = cell('duty')
  const interval = intervalOf(line, cell('interval'), problems)
  const reason = cell('intervalReason')

  if (reason.length > dutyLimits.intervalReason) {
    problems.add(
      line,
      `Die Begründung der Frist hat höchstens ${String(dutyLimits.intervalReason)} Zeichen`,
    )
  }

  if (cell('basis') !== '') {
    const basis =
      chosen(cell('basis'), dutyBases, dutyBasisLabel) ?? basisWords[nameKey(cell('basis'))] ?? null
    const task = chosen(cell('task'), dutyTasks, dutyTaskLabel)
    const counting =
      cell('counting') === ''
        ? 'from_performance'
        : chosen(cell('counting'), countings, countingLabel)
    const source = cell('sourceNote')

    if (name.length > dutyLimits.label) {
      problems.add(line, `Die Bezeichnung hat höchstens ${String(dutyLimits.label)} Zeichen`)
    }

    if (basis === null) {
      problems.add(
        line,
        'Die Grundlage ist eine von: Hersteller, Auflage, Versicherer, Eigene Festlegung',
      )
    }

    if (source === '' || source.length > dutyLimits.sourceNote) {
      problems.add(
        line,
        source === ''
          ? 'Die Quelle einer eigenen Pflicht fehlt'
          : `Die Quelle hat höchstens ${String(dutyLimits.sourceNote)} Zeichen`,
      )
    }

    if (task === null) {
      problems.add(
        line,
        `Die Tätigkeit einer eigenen Pflicht ist eine von: ${dutyTasks.map((each) => dutyTaskLabel[each]).join(', ')}`,
      )
    }

    if (counting === null) {
      problems.add(
        line,
        `Die Zählweise ist eine von: ${countings.map((each) => countingLabel[each]).join(', ')}`,
      )
    }

    if (interval === null) {
      problems.add(line, 'Die Frist einer eigenen Pflicht fehlt')
    }

    if (interval && counting !== null) {
      const problem = dutyIntervalProblem(asColumns(interval), counting, null)

      if (problem !== null) {
        problems.addSentence(line, name, problem)
      }
    }

    if (problems.added > before || !interval || counting === null) {
      return null
    }

    return {
      identity: `own ${nameKey(name)}`,
      label: name,
      kind: null,
      counting,
      interval,
      confirm: {
        kind: null,
        kindVersion: null,
        label: name,
        basis,
        sourceNote: source,
        task,
        counting,
        interval,
        intervalReason: reason === '' ? null : reason,
        maximum: null,
        guide: null,
      },
    }
  }

  const applying = kindsFor(stock, asset.kind)
  const entry =
    applying.find(
      (each) => nameKey(each.definition.label) === nameKey(name) || each.key === name.toLowerCase(),
    ) ?? null

  if (entry === null) {
    problems.add(
      line,
      applying.length === 0
        ? `Für ${assetWords(asset)} kennt der Katalog keine Pflicht „${name}“: für Anlagen dieser Art nennt er keine`
        : `Für ${assetWords(asset)} kennt der Katalog keine Pflicht „${name}“, er nennt: ${listed(applying.map((each) => each.definition.label))}`,
      'Die Pflicht nennen, wie der Katalog sie nennt, oder mit Grundlage, Quelle, Tätigkeit und Frist als eigene Pflicht übernehmen',
    )

    return null
  }

  const kind = entry.definition.interval.kind
  const rule =
    kind === 'none'
      ? null
      : stock.catalogue.interval(entry.definition, stock.today, asset.federalState)
  const ofItsKind = rule === null ? null : intervalOfRule(rule.record)

  if (kind !== 'none' && ofItsKind === null) {
    problems.add(
      line,
      `Die Frist der Pflicht ${entry.definition.label} hat heute im Land der Anlage keine Regel`,
      'Diese Zeile nach dem nächsten Paket des Katalogs übernehmen',
    )

    return null
  }

  const maximum = kind === 'maximum' ? ofItsKind : null
  const guide = kind === 'guide' ? ofItsKind : null
  const counting = entry.definition.counting
  const taken = interval ?? ofItsKind

  if (interval === undefined) {
    return null
  }

  if (taken === null) {
    problems.add(
      line,
      `Die Frist der Pflicht ${entry.definition.label} legt der Betreiber fest: die Liste nennt sie, mit ihrer Begründung`,
    )

    return null
  }

  const problem = dutyIntervalProblem(asColumns(taken), counting, maximum)

  if (problem !== null) {
    problems.addSentence(line, entry.definition.label, problem)

    return null
  }

  if (intervalNeedsReason(kind, taken, guide) && reason === '') {
    problems.add(
      line,
      kind === 'guide' && guide !== null
        ? `Der Richtwert der Pflicht ${entry.definition.label} beträgt ${intervalWords(guide)}; eine Frist, die davon abweicht, braucht ihre Begründung`
        : `Die Frist der Pflicht ${entry.definition.label} legt der Betreiber fest; sie braucht ihre Begründung`,
    )

    return null
  }

  if (problems.added > before) {
    return null
  }

  return {
    identity: entry.key,
    label: entry.definition.label,
    kind: entry.key,
    counting,
    interval: taken,
    confirm: {
      kind: entry.key,
      kindVersion: entry.version,
      label: null,
      basis: null,
      sourceNote: null,
      task: null,
      counting,
      interval: taken,
      intervalReason: reason === '' ? null : reason,
      maximum,
      guide,
    },
  }
}

/** How many of the lines of a plan are taken over as something. */
export function deadlineImportTotal(counts: DeadlineImportCounts): number {
  return counts.evidence + counts.documents
}

/** What an import of running deadlines made, as the log and the page say it. */
export function deadlineImportSummary(counts: DeadlineImportCounts): string {
  const parts = [
    counts.evidence === 0
      ? null
      : `${counted(counts.evidence, 'Nachweis', 'Nachweise')} als Altbestand übernommen`,
    counts.duties === 0 ? null : `${counted(counts.duties, 'Pflicht', 'Pflichten')} bestätigt`,
    counts.documents === 0
      ? null
      : `${counted(counts.documents, 'Dokument', 'Dokumente')} als Altbestand abgelegt`,
  ].filter((part): part is string => part !== null)

  return parts.join(', ')
}
