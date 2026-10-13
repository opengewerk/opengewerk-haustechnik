import {
  dayOfCell,
  type IsoDate,
  type TableField,
  type TableRecord,
} from '@opengewerk/platform-domain'

import { duplicateKey } from './asset-duplicate.js'
import { stepsOf } from './asset-values.js'
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
import { type MeterUnit, meterUnitSymbol } from './meter.js'
import {
  type ConsumptionInput,
  keyDateFor,
  meterFigure,
  meterLimits,
  readingDoubt,
  readingJump,
  replacedMeterAdvice,
} from './meter-reading.js'

/**
 * The history of the meters of a predecessor application (#130, section 11
 * of the concept: "Messstellen und Stände mit Tauschen und Stilllegungen"),
 * as a plan.
 *
 * The measuring points themselves are assets and come with the import of the
 * assets, with their meter number and their unit. Here follows what hangs at
 * them: a line of the list names a measuring point that is here and is one
 * of three, a reading with the day it was read, the replacement of the meter
 * with both numbers and both figures, or a period the measuring point
 * rested.
 *
 * A reading taken over is a reading like any other: it is the one for the
 * key date of its day, it is held against the readings beside it and against
 * the replacements, and one that cannot be is a line to clear up. What it
 * says of itself is that it was taken over, and nobody here read it.
 *
 * The plan writes nothing. It is worked out for the preview and once more
 * inside the transaction that writes, like the plan of every import.
 */

const markNames = [
  'Inventar-Nr.',
  'Inventarnummer',
  'Anlagenkennzeichen',
  'Kennzeichnung',
  'AKS',
] as const

/** The fields of a line, in the order the page offers them. None is needed for every line. */
export const meterImportFields: readonly TableField[] = [
  {
    key: 'meterNumber',
    label: 'Zählernummer',
    names: ['Zähler-Nr.', 'Zählernr', 'Zähler', 'Nummer des Zählers'],
  },
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
  { key: 'entry', label: 'Eintrag', names: ['Art', 'Art des Eintrags', 'Vorgang'] },
  {
    key: 'day',
    label: 'Tag',
    names: ['Datum', 'Abgelesen am', 'Ablesedatum', 'Ablesetag', 'Tag der Ablesung'],
  },
  { key: 'value', label: 'Stand', names: ['Zählerstand', 'Ablesewert', 'Wert'] },
  {
    key: 'oldNumber',
    label: 'Alte Zählernummer',
    names: ['Alter Zähler', 'Zählernummer alt', 'Ausgebauter Zähler'],
  },
  { key: 'oldEnd', label: 'Endstand alt', names: ['Endstand', 'Endstand des alten Zählers'] },
  {
    key: 'newNumber',
    label: 'Neue Zählernummer',
    names: ['Neuer Zähler', 'Zählernummer neu', 'Eingebauter Zähler'],
  },
  {
    key: 'newStart',
    label: 'Anfangsstand neu',
    names: ['Anfangsstand', 'Anfangsstand des neuen Zählers'],
  },
  { key: 'until', label: 'Bis', names: ['Letzter Tag', 'Stillgelegt bis', 'Ende'] },
  { key: 'reason', label: 'Grund', names: ['Begründung', 'Grund der Stilllegung'] },
]

/** What a line of the list is: a reading, the replacement of the meter, or a period it rested. */
export const meterImportEntries = ['reading', 'exchange', 'pause'] as const

export type MeterImportEntry = (typeof meterImportEntries)[number]

export const meterImportEntryLabel: Readonly<Record<MeterImportEntry, string>> = {
  reading: 'Stand',
  exchange: 'Tausch',
  pause: 'Stilllegung',
}

/** What a list writes in the column "Eintrag", without spaces and in lower case. */
const entryWords: Readonly<Record<string, MeterImportEntry>> = {
  stand: 'reading',
  zählerstand: 'reading',
  ablesung: 'reading',
  tausch: 'exchange',
  zählertausch: 'exchange',
  wechsel: 'exchange',
  zählerwechsel: 'exchange',
  stilllegung: 'pause',
  stillgelegt: 'pause',
  ruht: 'pause',
}

/** The fields only one kind of line reads; what stands in another is said and not taken over. */
const fieldsOfEntry: Readonly<Record<MeterImportEntry, readonly string[]>> = {
  reading: ['value'],
  exchange: ['oldNumber', 'oldEnd', 'newNumber', 'newStart'],
  pause: ['until', 'reason'],
}

/** A measuring point a line may name, with what it holds. */
export interface MeterImportMeter {
  readonly id: string
  readonly number: string | null
  readonly name: string
  readonly mark: string | null
  readonly serialNumber: string | null
  /** The number of its meter today; none for an asset that is no measuring point. */
  readonly meterNumber: string | null
  readonly unit: MeterUnit
  /** The day of the month its readings are due on: its own, or the operator's. */
  readonly keyDay: number
  readonly conversionFactor: number | null
  /** Its readings that count: those no other reading corrects. */
  readonly readings: readonly {
    readonly keyDate: IsoDate
    readonly readOn: IsoDate
    readonly valueMilli: number
  }[]
  readonly exchanges: readonly {
    readonly exchangedOn: IsoDate
    readonly oldNumber: string
    readonly oldEndMilli: number
    readonly newNumber: string
    readonly newStartMilli: number
  }[]
  readonly pauses: readonly { readonly startsOn: IsoDate; readonly endsOn: IsoDate | null }[]
}

/** What a plan is held against: the assets the person importing sees, and the day. */
export interface MeterImportStock {
  readonly meters: readonly MeterImportMeter[]
  readonly today: IsoDate
}

export interface PlannedReading {
  readonly line: number
  readonly assetId: string
  readonly keyDate: IsoDate
  readonly readOn: IsoDate
  readonly valueMilli: number
  /** That the figure lies far above the one before, and whoever takes the list over says it is right. */
  readonly jumpConfirmed: boolean
}

export interface PlannedExchange {
  readonly line: number
  readonly assetId: string
  readonly exchangedOn: IsoDate
  readonly oldNumber: string
  readonly oldEndMilli: number
  readonly newNumber: string
  readonly newStartMilli: number
}

export interface PlannedPause {
  readonly line: number
  readonly assetId: string
  readonly startsOn: IsoDate
  readonly endsOn: IsoDate | null
  readonly reason: string
}

/** A line as the preview shows it. */
export interface MeterImportRow {
  readonly line: number
  readonly meter: {
    readonly id: string
    readonly number: string | null
    readonly name: string
    readonly meterNumber: string
  }
  readonly entry: MeterImportEntry
  /** The day read, the day of the replacement, or the first day of the rest. */
  readonly day: IsoDate
  /** What the line becomes, in words: the figure with its key date, both meters, the period. */
  readonly what: string
  /** Why the figure is asked about once more, where it lies far above the one before. */
  readonly jump: string | null
}

export interface MeterImportCounts {
  readonly readings: number
  readonly exchanges: number
  readonly pauses: number
  /** Lines that name what is here already, and make nothing. */
  readonly known: number
}

export interface MeterImportPlan {
  readonly lines: number
  readonly counts: MeterImportCounts
  readonly problems: readonly ImportProblem[]
  readonly notes: readonly ImportNote[]
  /**
   * The figures far above the one before them. They are taken over, and
   * whoever takes the list over says with it that they are right; so they
   * are said apart from what is left out.
   */
  readonly jumps: readonly ImportNote[]
  readonly rows: readonly MeterImportRow[]
  /** What taking over writes. Empty while there is a problem. */
  readonly create: {
    readonly readings: readonly PlannedReading[]
    readonly exchanges: readonly PlannedExchange[]
    readonly pauses: readonly PlannedPause[]
  }
}

const missingMeter =
  'Die Messstelle fehlt: Zählernummer, Anlagennummer, Kennzeichen oder Seriennummer'

/** A day as people write it in Germany: "14.09.2024". */
function written(day: IsoDate): string {
  return `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}`
}

/** A unit as it is compared: "m3" is "m³" to whoever typed it. */
const unitKey = (unit: string) => nameKey(unit).replace('³', '3')

/** Digits, and on request a comma with digits behind it: how a list writes a figure. */
const figureShape = /^\d+(?:,\d+)?/

interface ReadingLine {
  readonly line: number
  readonly readOn: IsoDate
  readonly keyDate: IsoDate
  readonly valueMilli: number
}

type ExchangeLine = Omit<PlannedExchange, 'assetId'>

type PauseLine = Omit<PlannedPause, 'assetId'>

/** A replacement the measuring point holds, or one of the list, which has its line. */
type Replacement = MeterImportMeter['exchanges'][number] & { readonly line?: number }

interface Named {
  readonly meter: MeterImportMeter & { readonly meterNumber: string }
  readonly readings: ReadingLine[]
  readonly exchanges: ExchangeLine[]
  readonly pauses: PauseLine[]
}

/**
 * What a list of the history of meters would make of what is there.
 *
 * Every line is read on its own first, then every measuring point as a
 * whole: a reading is in doubt only beside the readings and the replacements
 * around it, and those may stand further down in the same list.
 */
export function planMeters(
  records: readonly TableRecord[],
  stock: MeterImportStock,
): MeterImportPlan {
  const problems = new ImportProblems()
  const notes = new ImportNotes()
  const jumps = new ImportNotes()
  const rows: MeterImportRow[] = []
  const readings: PlannedReading[] = []
  const exchanges: PlannedExchange[] = []
  const pauses: PlannedPause[] = []
  let known = 0

  const measuring = stock.meters.filter((meter) => meter.meterNumber !== null)
  const namings: readonly AssetNaming<MeterImportMeter>[] = [
    {
      field: 'meterNumber',
      word: 'Zählernummer',
      article: 'der',
      index: grouped(measuring, (meter) => duplicateKey(meter.meterNumber)),
    },
    {
      field: 'assetNumber',
      word: 'Anlagennummer',
      article: 'der',
      index: grouped(stock.meters, (meter) => duplicateKey(meter.number)),
    },
    {
      field: 'mark',
      word: 'Kennzeichen',
      article: 'dem',
      index: grouped(stock.meters, (meter) => duplicateKey(meter.mark)),
    },
    {
      field: 'serialNumber',
      word: 'Seriennummer',
      article: 'der',
      index: grouped(stock.meters, (meter) => duplicateKey(meter.serialNumber)),
    },
  ]
  const labelOf = (field: string) =>
    meterImportFields.find((each) => each.key === field)?.label ?? field

  /** The lines of each measuring point, in the order it was first named. */
  const named = new Map<string, Named>()

  for (const { line, values } of records) {
    const cell = (field: string) => values[field] ?? ''
    const found = namedAsset(line, cell, namings, problems, missingMeter)

    if (found === null) {
      continue
    }

    if (found.meterNumber === null) {
      problems.add(
        line,
        `${assetWords(found)} ist keine Messstelle: die Anlage hat keine Zählernummer`,
        'Zählernummer und Einheit an der Anlage eintragen oder die Zeile entfernen',
      )

      continue
    }

    const meter = { ...found, meterNumber: found.meterNumber }
    const entry = entryOf(line, cell, problems)

    if (entry === null) {
      continue
    }

    for (const [other, fields] of Object.entries(fieldsOfEntry)) {
      for (const field of other === entry ? [] : fields) {
        if (cell(field) !== '') {
          notes.add(
            line,
            labelOf(field),
            `steht in einer Zeile „${meterImportEntryLabel[entry]}“ und wird nicht übernommen`,
          )
        }
      }
    }

    const day = dayOf(line, cell('day'), entry, stock.today, problems)
    const lines = named.get(meter.id) ?? { meter, readings: [], exchanges: [], pauses: [] }

    named.set(meter.id, lines)

    if (entry === 'reading') {
      const valueMilli = figureOf(line, cell('value'), 'Der Stand', meter.unit, problems)

      if (day !== null && valueMilli !== null) {
        lines.readings.push({
          line,
          readOn: day,
          keyDate: keyDateFor(day, meter.keyDay),
          valueMilli,
        })
      }
    } else if (entry === 'exchange') {
      const oldNumber = numberOf(line, cell('oldNumber'), 'Die alte Zählernummer', problems)
      const newNumber = numberOf(line, cell('newNumber'), 'Die neue Zählernummer', problems)
      const oldEndMilli = figureOf(line, cell('oldEnd'), 'Der Endstand', meter.unit, problems)
      const newStartMilli = figureOf(
        line,
        cell('newStart'),
        'Der Anfangsstand',
        meter.unit,
        problems,
      )

      if (oldNumber !== null && newNumber !== null && oldNumber === newNumber) {
        problems.add(line, 'Der neue Zähler hat eine andere Nummer als der alte')
      } else if (
        day !== null &&
        oldNumber !== null &&
        newNumber !== null &&
        oldEndMilli !== null &&
        newStartMilli !== null
      ) {
        lines.exchanges.push({
          line,
          exchangedOn: day,
          oldNumber,
          oldEndMilli,
          newNumber,
          newStartMilli,
        })
      }
    } else {
      const endsOn = untilOf(line, cell('until'), day, problems)
      const reason = cell('reason')

      if (reason === '') {
        problems.add(line, 'Der Grund der Stilllegung fehlt')
      } else if (reason.length > meterLimits.reason) {
        problems.add(line, `Der Grund hat höchstens ${String(meterLimits.reason)} Zeichen`)
      } else if (day !== null && endsOn !== undefined) {
        lines.pauses.push({ line, startsOn: day, endsOn, reason })
      }
    }
  }

  for (const { meter, ...lines } of named.values()) {
    const about = { id: meter.id, number: meter.number, name: meter.name }
    const row = (
      line: number,
      entry: MeterImportEntry,
      day: IsoDate,
      what: string,
      jump?: string,
    ) => {
      rows.push({
        line,
        meter: { ...about, meterNumber: meter.meterNumber },
        entry,
        day,
        what,
        jump: jump ?? null,
      })
    }

    // The replacements first: a reading is held against them.
    const replaced: Replacement[] = [...meter.exchanges]
    const taken: ExchangeLine[] = []

    for (const each of [...lines.exchanges].sort((one, other) => one.line - other.line)) {
      const sameDay = replaced.find((other) => other.exchangedOn === each.exchangedOn)

      if (sameDay === undefined) {
        replaced.push(each)
        taken.push(each)
      } else if (
        sameDay.line === undefined &&
        sameDay.oldNumber === each.oldNumber &&
        sameDay.newNumber === each.newNumber &&
        sameDay.oldEndMilli === each.oldEndMilli &&
        sameDay.newStartMilli === each.newStartMilli
      ) {
        known += 1
      } else {
        problems.add(
          sameDay.line === undefined ? each.line : [sameDay.line, each.line],
          `Am ${written(each.exchangedOn)} steht an ${assetWords(meter)} schon ein Tausch mit anderen Angaben`,
          sameDay.line === undefined
            ? 'Die Zeile entfernen: der Tausch an der Messstelle bleibt, wie er ist'
            : undefined,
        )
      }
    }

    replaced.sort((one, other) => (one.exchangedOn < other.exchangedOn ? -1 : 1))

    // Every meter is the one the replacement before it put in, and the last one is today's.
    for (const [at, each] of replaced.entries()) {
      const next = replaced[at + 1]
      const isNew = (one: Replacement) => one.line !== undefined
      const linesOf = (ones: readonly Replacement[]) =>
        ones.flatMap((one) => (one.line === undefined ? [] : [one.line]))

      if (next === undefined) {
        if (isNew(each) && duplicateKey(each.newNumber) !== duplicateKey(meter.meterNumber)) {
          problems.add(
            linesOf([each]),
            `Nach dem Tausch vom ${written(each.exchangedOn)} trägt ${assetWords(meter)} den Zähler „${each.newNumber}“, an der Anlage steht „${meter.meterNumber}“`,
            'Die Zählernummer der Anlage oder die Liste berichtigen',
          )
        }
      } else if (
        (isNew(each) || isNew(next)) &&
        duplicateKey(each.newNumber) !== duplicateKey(next.oldNumber)
      ) {
        problems.add(
          linesOf([each, next]),
          `An ${assetWords(meter)} wird am ${written(each.exchangedOn)} der Zähler „${each.newNumber}“ eingebaut und am ${written(next.exchangedOn)} der Zähler „${next.oldNumber}“ ausgebaut`,
        )
      }
    }

    // The readings: one for a key date, and none that cannot be beside the others.
    const standing = [...meter.readings]
    const fresh: ReadingLine[] = []

    for (const each of [...lines.readings].sort((one, other) => one.line - other.line)) {
      const there = meter.readings.find((reading) => reading.keyDate === each.keyDate)
      const twice = fresh.find((reading) => reading.keyDate === each.keyDate)

      if (there !== undefined) {
        if (there.valueMilli === each.valueMilli) {
          known += 1
        } else {
          problems.add(
            each.line,
            `Für den Stichtag ${written(each.keyDate)} steht an ${assetWords(meter)} schon der Stand ${meterFigure(there.valueMilli, meter.unit)}`,
            'Den Stand an der Messstelle berichtigen oder die Zeile entfernen',
          )
        }
      } else if (twice !== undefined) {
        problems.add(
          [twice.line, each.line],
          `Für den Stichtag ${written(each.keyDate)} nennt die Liste an ${assetWords(meter)} zwei Stände`,
          'Einen der beiden entfernen und neu hochladen',
        )
      } else {
        fresh.push(each)
        standing.push(each)
      }
    }

    const input: ConsumptionInput = {
      readings: standing,
      exchanges: replaced,
      pauses: meter.pauses,
      conversionFactor: meter.conversionFactor,
    }

    for (const each of fresh) {
      const doubt = readingDoubt(each, input, meter.unit)

      if (doubt !== null) {
        const advised = doubt.includes(replacedMeterAdvice)

        problems.addSentence(
          each.line,
          `${meterFigure(each.valueMilli, meter.unit)} an ${assetWords(meter)}`,
          doubt.replace(replacedMeterAdvice, '').trim(),
          advised
            ? 'Wurde der Zähler getauscht, den Tausch als Zeile nennen; sonst in der Datei berichtigen'
            : undefined,
        )

        continue
      }

      const jump = readingJump(each, input)

      if (jump !== null) {
        jumps.add(each.line, labelOf('value'), jump)
      }

      readings.push({
        line: each.line,
        assetId: meter.id,
        keyDate: each.keyDate,
        readOn: each.readOn,
        valueMilli: each.valueMilli,
        jumpConfirmed: jump !== null,
      })
      row(
        each.line,
        'reading',
        each.readOn,
        `${meterFigure(each.valueMilli, meter.unit)} zum Stichtag ${written(each.keyDate)}`,
        jump ?? undefined,
      )
    }

    // A replacement fits the readings around it: the old meter ends at or above its last reading.
    for (const each of taken) {
      const earlier = replaced
        .filter((other) => other.exchangedOn < each.exchangedOn)
        .map((other) => other.exchangedOn)
        .sort()
        .at(-1)
      const before = standing
        .filter(
          (reading) =>
            reading.readOn <= each.exchangedOn &&
            (earlier === undefined || reading.readOn > earlier),
        )
        .sort((one, other) => (one.readOn < other.readOn ? 1 : -1))[0]
      const later = replaced
        .filter((other) => other.exchangedOn > each.exchangedOn)
        .map((other) => other.exchangedOn)
        .sort()[0]
      const after = standing
        .filter(
          (reading) =>
            reading.readOn > each.exchangedOn && (later === undefined || reading.readOn < later),
        )
        .sort((one, other) => (one.readOn < other.readOn ? -1 : 1))[0]

      if (before !== undefined && each.oldEndMilli < before.valueMilli) {
        problems.add(
          each.line,
          `Der Endstand ${meterFigure(each.oldEndMilli, meter.unit)} an ${assetWords(meter)} ist kleiner als der letzte Stand des alten Zählers vom ${written(before.keyDate)}, ${meterFigure(before.valueMilli, meter.unit)}`,
        )
      } else if (
        after !== undefined &&
        each.newStartMilli > after.valueMilli &&
        // A reading of the list below the first figure has said so itself.
        !fresh.includes(after as ReadingLine)
      ) {
        problems.add(
          each.line,
          `Der Anfangsstand ${meterFigure(each.newStartMilli, meter.unit)} an ${assetWords(meter)} ist größer als der Stand danach vom ${written(after.keyDate)}, ${meterFigure(after.valueMilli, meter.unit)}`,
        )
      } else {
        exchanges.push({ ...each, assetId: meter.id })
        row(
          each.line,
          'exchange',
          each.exchangedOn,
          `Zähler ${each.oldNumber} mit ${meterFigure(each.oldEndMilli, meter.unit)} gegen ${each.newNumber} mit ${meterFigure(each.newStartMilli, meter.unit)}`,
        )
      }
    }

    // The periods it rested: none twice, and none over another.
    const resting: { startsOn: IsoDate; endsOn: IsoDate | null; line?: number }[] = [
      ...meter.pauses,
    ]

    for (const each of [...lines.pauses].sort((one, other) => one.line - other.line)) {
      const same = meter.pauses.some(
        (pause) => pause.startsOn === each.startsOn && pause.endsOn === each.endsOn,
      )
      const over = resting.find((pause) => overlap(pause, each))

      if (same) {
        known += 1
      } else if (over !== undefined) {
        problems.add(
          over.line === undefined ? each.line : [over.line, each.line],
          `${assetWords(meter)} ruht ${periodWords(over)} schon`,
          over.line === undefined
            ? 'Die Zeile entfernen oder die Stilllegung an der Messstelle beenden'
            : undefined,
        )
      } else {
        resting.push(each)
        pauses.push({ ...each, assetId: meter.id })
        row(each.line, 'pause', each.startsOn, `Ruht ${periodWords(each)}: ${each.reason}`)
      }
    }
  }

  const open = problems.list()
  const clear = open.length === 0

  return {
    lines: records.length,
    counts: {
      readings: readings.length,
      exchanges: exchanges.length,
      pauses: pauses.length,
      known,
    },
    problems: open,
    notes: notes.list(),
    jumps: jumps.list(),
    rows: rows.sort((one, other) => one.line - other.line),
    create: clear ? { readings, exchanges, pauses } : { readings: [], exchanges: [], pauses: [] },
  }
}

/** A period in words: "vom 15.07.2024 bis 31.08.2024", "seit dem 15.07.2024". */
function periodWords(period: { readonly startsOn: IsoDate; readonly endsOn: IsoDate | null }) {
  return period.endsOn === null
    ? `seit dem ${written(period.startsOn)}`
    : `vom ${written(period.startsOn)} bis ${written(period.endsOn)}`
}

/** Whether two periods share a day; one without an end runs on. */
function overlap(
  one: { readonly startsOn: IsoDate; readonly endsOn: IsoDate | null },
  other: { readonly startsOn: IsoDate; readonly endsOn: IsoDate | null },
): boolean {
  return (
    (other.endsOn === null || one.startsOn <= other.endsOn) &&
    (one.endsOn === null || other.startsOn <= one.endsOn)
  )
}

/**
 * What a line is. The column "Eintrag" says it; without it a line with a new
 * meter number is a replacement, one with a reason a period of rest, and
 * every other a reading, so that a plain list of readings needs no such
 * column.
 */
function entryOf(
  line: number,
  cell: (field: string) => string,
  problems: ImportProblems,
): MeterImportEntry | null {
  const said = cell('entry')

  if (said === '') {
    return cell('newNumber') !== '' ? 'exchange' : cell('reason') !== '' ? 'pause' : 'reading'
  }

  const entry = entryWords[nameKey(said)]

  if (entry === undefined) {
    problems.add(
      line,
      `Der Eintrag „${said}“ ist keiner von ${listed(meterImportEntries.map((each) => meterImportEntryLabel[each]))}`,
    )

    return null
  }

  return entry
}

function dayOf(
  line: number,
  cell: string,
  entry: MeterImportEntry,
  today: IsoDate,
  problems: ImportProblems,
): IsoDate | null {
  const word = {
    reading: 'Der Tag der Ablesung',
    exchange: 'Der Tag des Tauschs',
    pause: 'Der erste Tag der Stilllegung',
  }[entry]

  if (cell === '') {
    problems.add(line, `${word} fehlt`)

    return null
  }

  const day = dayOfCell(cell)

  if (day === null) {
    problems.add(line, `${word} ist kein Tag, geschrieben 02.10.2026 oder 2026-10-02`)

    return null
  }

  if (entry !== 'pause' && day > today) {
    problems.add(
      line,
      entry === 'reading'
        ? 'Abgelesen wird heute oder früher, nicht in der Zukunft'
        : 'Getauscht wird heute oder früher, nicht in der Zukunft',
    )

    return null
  }

  return day
}

/** The last day of a period of rest: none for one that runs on, undefined where the cell says none. */
function untilOf(
  line: number,
  cell: string,
  startsOn: IsoDate | null,
  problems: ImportProblems,
): IsoDate | null | undefined {
  if (cell === '') {
    return null
  }

  const day = dayOfCell(cell)

  if (day === null) {
    problems.add(
      line,
      'Der letzte Tag der Stilllegung ist kein Tag, geschrieben 02.10.2026 oder 2026-10-02',
    )

    return undefined
  }

  if (startsOn !== null && day < startsOn) {
    problems.add(line, 'Der letzte Tag der Stilllegung liegt nicht vor dem ersten')

    return undefined
  }

  return day
}

/** The number of a meter a replacement names. */
function numberOf(
  line: number,
  cell: string,
  word: string,
  problems: ImportProblems,
): string | null {
  if (cell === '') {
    problems.add(line, `${word} fehlt`)

    return null
  }

  if (cell.length > meterLimits.meterNumber) {
    problems.add(line, `${word} hat höchstens ${String(meterLimits.meterNumber)} Zeichen`)

    return null
  }

  return cell
}

/**
 * The figure a cell holds, in thousandths of the unit of its meter. Written
 * with a comma and without a point between the thousands, alone or with the
 * unit of the meter behind it, as the import of the assets reads a figure:
 * "4.812" may be four thousand eight hundred and twelve or four and four
 * fifths, and neither is worked out.
 */
function figureOf(
  line: number,
  cell: string,
  word: string,
  unit: MeterUnit,
  problems: ImportProblems,
): number | null {
  const sign = meterUnitSymbol[unit]

  if (cell === '') {
    problems.add(line, `${word} fehlt`)

    return null
  }

  const [digits] = figureShape.exec(cell) ?? []
  const behind = digits === undefined ? '' : cell.slice(digits.length).trim()
  const milli = digits === undefined ? Number.NaN : stepsOf(digits, 3)

  if (
    !Number.isInteger(milli) ||
    milli > meterLimits.valueMilli ||
    (behind !== '' && unitKey(behind) !== unitKey(sign))
  ) {
    problems.add(
      line,
      `${word} ist eine Zahl in ${sign} mit höchstens drei Stellen hinter dem Komma, geschrieben ohne Tausenderpunkt wie 4812 oder 4812,5, und nicht „${cell}“`,
    )

    return null
  }

  return milli
}

/** How many of the lines of a plan are taken over as something. */
export function meterImportTotal(counts: MeterImportCounts): number {
  return counts.readings + counts.exchanges + counts.pauses
}

/** What an import of the history of meters made, as the log and the page say it. */
export function meterImportSummary(counts: MeterImportCounts): string {
  const parts = [
    counts.readings === 0 ? null : counted(counts.readings, 'Zählerstand', 'Zählerstände'),
    counts.exchanges === 0 ? null : counted(counts.exchanges, 'Zählertausch', 'Zählertausche'),
    counts.pauses === 0 ? null : counted(counts.pauses, 'Stilllegung', 'Stilllegungen'),
  ].filter((part): part is string => part !== null)

  return parts.length === 0 ? '' : `${listed(parts)} übernommen`
}
