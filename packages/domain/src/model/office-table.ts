import {
  addDays,
  compareTasksForWork,
  isPicture,
  type IsoDate,
  isTaskOverdue,
  type TaskStanding,
} from '@opengewerk/platform-domain'

import { assetConditionLabel, type AssetEntry, type AssetStanding } from './asset-condition.js'
import { lifecycleStateLabel } from './asset.js'
import {
  type ActivityStatus,
  activityKindLabel,
  activityStatusLabel,
  workOrderKindLabel,
  workOrderUrgencyLabel,
} from './activity.js'
import type { ActivityEntry } from './activity-register.js'
import type { Catalogue } from './catalogue.js'
import type { DeadlineFacts } from './deadlines.js'
import { defectStatusLabel } from './defect.js'
import type {
  DefectClassSetting,
  DefectEntry,
  DefectOrigin,
  DefectPlace,
} from './defect-register.js'
import {
  type DismissedProposal,
  type DutyProposal,
  packageOf,
  type ProposedAsset,
} from './duty-proposal.js'
import { dutyInterval, intervalWords } from './duty-record.js'
import type { DutyEntry } from './duty-register.js'
import { byNameIn } from './name-order.js'
import {
  dutySourceWords,
  dutyStandingWords,
  intervalCheckWords,
  intervalKindWords,
  nobodyWords,
  performerWords,
} from './duty-words.js'
import { type DocumentHome, type DocumentKind, documentKindLabel } from './document.js'
import { roomTitle } from './location.js'
import { meterMediumLabel, meterUnitSymbol } from './meter.js'
import { type MeterEntry, meterStateLabel } from './meter-register.js'
import type { PlaceTarget } from './target.js'
import type { WorkOrderEntry } from './work-order-register.js'
import type { PlaceToDo } from './overview.js'
import { closureOn } from './closure.js'
import {
  isPassDay,
  passSearchDays,
  type PlanCalendar,
  planStateOn,
  type RoundPlan,
  type RoundState,
  roundStateLabel,
} from './round-plan.js'

/**
 * The lists of the office as tables (#138, section 3 of the concept): "Als
 * Tabelle" gives what the list shows under its filter, in its order, under
 * its columns. The server writes the table, so that it also holds a list
 * that is read a page at a time, and reads it under the rights and in the
 * areas of the person, as it reads the list.
 *
 * What a column is called and what stands in it is said here once, for the
 * list on the screen and for the route that writes its table. A table never
 * holds more than its list: no field the list does not show, and none of the
 * stamp of the last change, which stays on the server (#157).
 */

/** A cell of a table as it goes out: text, a number, a day, or nothing. */
export type TableValue = string | number | { readonly day: IsoDate } | null

/** A row of a table as it goes out. */
export type TableRow = readonly TableValue[]

/** A day as the office writes it: 24.09.2028. */
export function dayInWords(day: IsoDate): string {
  const [year, month, date] = day.split('-')

  return `${date ?? ''}.${month ?? ''}.${year ?? ''}`
}

/** The condition of an asset in words: "In Ordnung bis 24.09.2028" for one in order with a day. */
export function conditionWords(standing: AssetStanding): string {
  return standing.condition === 'in_order' && standing.until !== null
    ? `${assetConditionLabel.in_order} bis ${dayInWords(standing.until)}`
    : assetConditionLabel[standing.condition]
}

/** "Schulzentrum Am Lindenhain, Schulhaus, E.14": the parts there are, in their order. */
export function placeWords(parts: readonly (string | null | undefined)[]): string {
  return parts.filter((part) => part !== null && part !== undefined && part !== '').join(', ')
}

// --- The register of assets -------------------------------------------------------------------

/** The columns of the register of assets, as the list heads them (4.2). */
export const assetTableColumns = [
  'Nummer',
  'Anlage',
  'Anlagenart',
  'Standort',
  'Zustand',
  'Lebenszyklus',
] as const

/**
 * An asset of the register as a row of its table: what its columns show.
 * The kind and the place come in as words, as the list reads them: the kind
 * from the catalogue, the place from the property, the building and the
 * room. An asset without an entry in its life cycle has an empty cell, as
 * the list shows none.
 */
export function assetTableRow(entry: AssetEntry, kind: string, place: string): TableRow {
  return [
    entry.number,
    entry.name,
    kind,
    place,
    conditionWords(entry),
    entry.lifecycleState === null ? null : lifecycleStateLabel[entry.lifecycleState],
  ]
}

// --- The properties ---------------------------------------------------------------------------

/** What each number of a place is called, in the order the list shows them (#121). */
export const toDoNumbers: readonly { readonly key: keyof PlaceToDo; readonly label: string }[] = [
  { key: 'overdue', label: 'Überfällig' },
  { key: 'due', label: 'Fällig' },
  { key: 'neverRecorded', label: 'Nie erfasst' },
  { key: 'openDefects', label: 'Offene Mängel' },
  { key: 'missingReadings', label: 'Zählerstände fehlen' },
]

/**
 * The more urgent place first: more overdue, then more never recorded, more
 * open defects, more due and more readings missing. A place without numbers
 * counts as nothing to do.
 */
export function byUrgency(left: PlaceToDo | undefined, right: PlaceToDo | undefined): number {
  for (const key of [
    'overdue',
    'neverRecorded',
    'openDefects',
    'due',
    'missingReadings',
  ] as const) {
    const difference = (right?.[key] ?? 0) - (left?.[key] ?? 0)

    if (difference !== 0) {
      return difference
    }
  }

  return 0
}

/** Where a property is, as the list writes it under its name. */
export interface PropertyAddress {
  readonly street: string
  readonly postalCode: string
  readonly city: string
}

/** "Musterweg 1, 00001 Beispielstadt". */
export function addressWords(property: PropertyAddress): string {
  return `${property.street}, ${property.postalCode} ${property.city}`
}

/** What the search of the list finds a property by: its name, where it is, and its buildings. */
export function propertySearchText(
  property: PropertyAddress & { readonly name: string },
  buildingNames: readonly string[],
): string {
  return [property.name, property.street, property.postalCode, property.city, ...buildingNames]
    .join(' ')
    .toLocaleLowerCase('de')
}

/** What a search typed into the list looks for, as the list compares it. */
export function searchedFor(typed: string): string {
  return typed.trim().toLocaleLowerCase('de')
}

/**
 * The columns of the properties as a table. The list shows a property with
 * its address under its name and its buildings indented under it; a table
 * gives each its own column, and every row of a building names the property
 * it stands on, so that a row says where it is wherever a spreadsheet sorts
 * it. The area stands where the list shows it, for whoever sees more than
 * one, and the numbers where the person may read them.
 */
export const propertyTableColumns = {
  property: 'Liegenschaft',
  building: 'Gebäude',
  address: 'Adresse',
  area: 'Bereich',
} as const

// --- The deadlines ----------------------------------------------------------------------------

/** What a deadline of the meters of a property is called in the list (#120). */
export const meterDeadlineSubject = 'Zähler ablesen'

/** What a deadline is called in the column "Betrifft": its defect, its plan, its duty, the meters, or its document (#327). */
export function deadlineSubject(facts: DeadlineFacts): string {
  switch (facts.follows) {
    case 'defect':
      return facts.description
    case 'round':
      return facts.title
    case 'duty':
      return facts.dutyTitle
    case 'meter':
      return meterDeadlineSubject
    case 'document':
      return facts.title
    case 'contract':
      return facts.contract.title
    case 'warranty':
      return facts.workOrder === null
        ? warrantyDeadlineSubject
        : `${warrantyDeadlineSubject} ${facts.workOrder.number}`
    case 'delegation':
      return `${delegationDeadlineSubject} an ${facts.delegation.delegateName}`
    case 'qualification':
      return facts.qualification.personName === null
        ? facts.qualification.kindLabel
        : `${facts.qualification.kindLabel}, ${facts.qualification.personName}`
    case 'evidence':
      return `${evidenceDeadlineSubject} ${facts.evidence.number}, ${facts.evidence.dutyTitle}`
  }
}

/** What the end of the retention of an evidence is called in the list (#340), with its number and duty behind it. */
export const evidenceDeadlineSubject = 'Aufbewahrung von'

/** What the end of a delegation of duties is called in the list (#336), with the person behind it. */
export const delegationDeadlineSubject = 'Pflichtenübertragung'

/** What the end of a warranty is called in the list (#329), with the number of a work order behind it where it is one's. */
export const warrantyDeadlineSubject = 'Gewährleistung'

/** The column of this application in the list "Fristen", between "Betrifft" and "Verantwortlich". */
export const deadlineTableColumns = { where: 'Anlage und Ort' } as const

/** The names of the places a deadline can hang on, by their ids, as the person reads them. */
export interface PlaceNames {
  readonly property: (id: string) => string | null
  readonly building: (id: string) => string | null
  readonly room: (id: string) => {
    readonly number: string | null
    readonly name: string | null
    readonly buildingId: string
  } | null
}

/**
 * "Anlage und Ort" of a deadline as two parts: the asset or the place it
 * hangs on, and where that stands. A place whose name the person does not
 * read is named by what it is, as the list names it without the record, and
 * so is an asset where `readsAssets` says the person does not read assets.
 */
export function deadlineWhere(
  facts: DeadlineFacts,
  names: PlaceNames | null,
  readsAssets = true,
): { readonly name: string; readonly sub: string } {
  // A contract stands nowhere either: its firm is what the deadline names (#329).
  if (facts.follows === 'contract') {
    return { name: facts.contractor.name, sub: 'Vertrag' }
  }

  // Nor does a delegation of duties (#336): it is the operator's, in the areas it names.
  if (facts.follows === 'delegation') {
    return { name: facts.delegation.delegateName, sub: 'Pflichtenübertragung' }
  }

  // Nor does a qualification (#337): it is a person's.
  if (facts.follows === 'qualification') {
    return { name: facts.qualification.personName ?? 'Eine Person', sub: 'Qualifikation' }
  }

  // The document of a contractor stands nowhere: the contractor is what it hangs on (#328),
  // and so does the document of a contract (#329).
  if (facts.follows === 'document' && facts.propertyId === null) {
    return facts.contract === null
      ? { name: facts.contractor?.name ?? 'Fremdfirma', sub: 'Fremdfirma' }
      : { name: facts.contract.title, sub: 'Vertrag' }
  }

  const property =
    facts.propertyId === null
      ? 'Liegenschaft'
      : (names?.property(facts.propertyId) ?? 'Liegenschaft')
  const building = facts.buildingId === null ? null : (names?.building(facts.buildingId) ?? null)
  const place = placeWords([property, building])

  if (facts.asset !== null) {
    const asset = readsAssets
      ? [facts.asset.number, facts.asset.name].filter((part) => part !== null && part !== '')
      : []

    return { name: asset.join(' ') || 'Anlage', sub: place }
  }

  if (facts.roomId !== null) {
    const room = names?.room(facts.roomId) ?? null
    // A duty at a room names no building; the room stands in one.
    const itsBuilding = building ?? (room === null ? null : names?.building(room.buildingId))

    return {
      name: room === null ? 'Raum' : roomTitle(room),
      sub: placeWords([property, itsBuilding]),
    }
  }

  if (facts.buildingId !== null) {
    return { name: building ?? 'Gebäude', sub: property }
  }

  return { name: property, sub: 'Liegenschaft' }
}

/** "Anlage und Ort" in one cell: "Aufzug 1, Schulzentrum Am Lindenhain, Schulhaus". */
export function deadlineWhereWords(
  facts: DeadlineFacts,
  names: PlaceNames | null,
  readsAssets = true,
): string {
  const { name, sub } = deadlineWhere(facts, names, readsAssets)

  return `${name}, ${sub}`
}

// --- The classes of defects -----------------------------------------------------------------------

/** The columns of "Mängelklassen" under "Einstellungen", as the list heads them (#116). */
export const defectClassTableColumns = {
  label: 'Klasse',
  effect: 'Wirkung',
  term: 'Vorgabe der Frist',
  from: 'Woher',
} as const

/** What a class does to the asset, the line under its name. */
export const defectClassEffectWords = {
  unsafe: 'macht die Anlage unsicher',
  safe: 'die Anlage bleibt in Betrieb',
} as const

/** A class as a row of its table: its name, what it does, the days of its default, its package. */
export function defectClassTableRow(setting: DefectClassSetting): TableRow {
  return [
    setting.label,
    setting.unsafe ? defectClassEffectWords.unsafe : defectClassEffectWords.safe,
    setting.dueDays,
    setting.packageTitle,
  ]
}

// --- Where a record hangs -----------------------------------------------------------------------

/** An asset by its id, as the person reads it: its number and name where they read assets. */
export type AssetLookup = (id: string) => {
  readonly number: string | null
  readonly name: string | null
  readonly buildingId: string | null
} | null

/**
 * Where an activity or a work order hangs (#236): the asset, the room, the
 * building or the property, and below it where that is, as the lists name
 * it. A name the person does not read is said by what it is.
 */
export function targetWhere(
  target: Pick<PlaceTarget, 'propertyId' | 'buildingId' | 'roomId' | 'assetId'>,
  names: PlaceNames | null,
  assets: AssetLookup | null,
): { readonly name: string; readonly sub: string; readonly line: string } {
  const property = names?.property(target.propertyId) ?? 'Liegenschaft'
  const room = target.roomId === null ? null : (names?.room(target.roomId) ?? null)
  const asset = target.assetId === null ? null : (assets?.(target.assetId) ?? null)
  const buildingId = target.buildingId ?? asset?.buildingId ?? room?.buildingId ?? null
  const building = buildingId === null ? null : (names?.building(buildingId) ?? null)
  const line = placeWords([property, building])

  if (target.assetId !== null) {
    const named = [asset?.number, asset?.name].filter(
      (part): part is string => part !== null && part !== undefined && part !== '',
    )

    return { name: named.join(' ') || 'Anlage', sub: line, line }
  }

  if (target.roomId !== null) {
    return {
      name: roomTitle({ number: room?.number ?? null, name: room?.name ?? null }),
      sub: line,
      line,
    }
  }

  if (target.buildingId !== null) {
    return { name: building ?? 'Gebäude', sub: property, line }
  }

  return { name: property, sub: 'Liegenschaft', line }
}

/** Where something is in one cell: the thing, and after a comma where it stands. */
export function whereWords(where: { readonly name: string; readonly sub: string }): string {
  return placeWords([where.name, where.sub])
}

/** Whether something still to be done is past the day it is due on. */
function pastItsDay(
  record: { readonly dueOn: IsoDate | null; readonly status: ActivityStatus },
  today: IsoDate,
): boolean {
  return (
    record.dueOn !== null &&
    record.dueOn < today &&
    (record.status === 'open' || record.status === 'started' || record.status === 'signed')
  )
}

// --- The activities -----------------------------------------------------------------------------

/** The columns of "Prüfungen", as the list heads them (4.4); the day past due has its own column. */
export const activityTableColumns = {
  due: 'Fällig am',
  late: 'Überfällig',
  title: 'Vorgang',
  kind: 'Art',
  where: 'Anlage und Ort',
  responsible: 'Verantwortlich',
  performer: 'Ausführend',
  status: 'Stand',
} as const

/** What the list "Prüfungen" says in its cells. */
export const activityTableWords = {
  nobody: 'noch niemand',
  contractor: 'Fremdfirma',
  late: 'überfällig',
} as const

/** Whether an activity still to be done is past the day it is due on. */
export function activityIsLate(
  activity: Pick<ActivityEntry, 'dueOn' | 'status'>,
  today: IsoDate,
): boolean {
  return pastItsDay(activity, today)
}

/** Who performs an activity in words: the person, the contractor, or nobody yet. */
export function activityPerformerWords(
  activity: Pick<ActivityEntry, 'performer' | 'performerPerson' | 'contractorNote'>,
): string {
  if (activity.performer === 'contractor') {
    return activity.contractorNote ?? activityTableWords.contractor
  }

  return activity.performerPerson?.name ?? activityTableWords.nobody
}

/** The columns of the table of activities, with the people only where it names them. */
export function activityTableHeads(names: boolean): readonly string[] {
  const columns = activityTableColumns

  return [
    columns.due,
    columns.late,
    columns.title,
    columns.kind,
    columns.where,
    ...(names ? [columns.responsible] : []),
    columns.performer,
    columns.status,
  ]
}

/**
 * An activity as a row of its table. Who answers for it stands only where
 * `names` says so, and who performs it as well; a contractor is no person
 * and stands for everybody, as its note or "Fremdfirma".
 */
export function activityTableRow(
  activity: ActivityEntry,
  where: string,
  names: boolean,
  today: IsoDate,
): TableRow {
  const performer =
    activity.performer === 'contractor' || names ? activityPerformerWords(activity) : null

  return [
    activity.dueOn === null ? null : { day: activity.dueOn },
    activityIsLate(activity, today) ? activityTableWords.late : null,
    activity.title,
    activityKindLabel[activity.kind],
    where,
    ...(names ? [activity.responsible?.name ?? activityTableWords.nobody] : []),
    performer,
    activityStatusLabel[activity.status],
  ]
}

// --- The work orders ----------------------------------------------------------------------------

/** The columns of "Aufträge", as the list heads them (4.8); the day past due has its own column. */
export const workOrderTableColumns = {
  number: 'Nummer',
  title: 'Auftrag',
  kind: 'Art',
  where: 'Ort oder Anlage',
  urgency: 'Dringlichkeit',
  due: 'Frist',
  late: 'Überschritten',
  responsible: 'Verantwortlich',
  status: 'Stand',
} as const

/** What the list "Aufträge" says in its cells. */
export const workOrderTableWords = {
  nobody: 'noch niemand',
  late: 'überschritten',
  rejected: 'Zurückgewiesen',
  waiting: 'Wartet auf Abnahme',
  accepted: 'Abgenommen',
} as const

/** The state of an order in words: turned back, waiting for its acceptance, accepted, or that of its activity. */
export function workOrderStatusWords(order: Pick<WorkOrderEntry, 'status' | 'rejected'>): string {
  if (order.rejected) {
    return workOrderTableWords.rejected
  }

  if (order.status === 'signed') {
    return workOrderTableWords.waiting
  }

  return order.status === 'done' ? workOrderTableWords.accepted : activityStatusLabel[order.status]
}

/** Whether an order still to be done is past its day. */
export function workOrderIsLate(
  order: Pick<WorkOrderEntry, 'dueOn' | 'status'>,
  today: IsoDate,
): boolean {
  return pastItsDay(order, today)
}

/** The columns of the table of work orders, with "Verantwortlich" only where it names people. */
export function workOrderTableHeads(names: boolean): readonly string[] {
  const columns = workOrderTableColumns

  return [
    columns.number,
    columns.title,
    columns.kind,
    columns.where,
    columns.urgency,
    columns.due,
    columns.late,
    ...(names ? [columns.responsible] : []),
    columns.status,
  ]
}

/** A work order as a row of its table; who answers for it only where `names` says so. */
export function workOrderTableRow(
  order: WorkOrderEntry,
  where: string,
  names: boolean,
  today: IsoDate,
): TableRow {
  return [
    order.number,
    order.title,
    workOrderKindLabel[order.kind],
    where,
    workOrderUrgencyLabel[order.urgency],
    order.dueOn === null ? null : { day: order.dueOn },
    workOrderIsLate(order, today) ? workOrderTableWords.late : null,
    ...(names ? [order.responsible?.name ?? workOrderTableWords.nobody] : []),
    workOrderStatusWords(order),
  ]
}

// --- The defects --------------------------------------------------------------------------------

/** The columns of "Mängel", as the list heads them (4.6); the day found and past due have their own. */
export const defectTableColumns = {
  description: 'Mangel',
  where: 'Anlage oder Ort',
  defectClass: 'Klasse',
  due: 'Frist',
  late: 'Über der Frist',
  status: 'Stand',
  origin: 'Herkunft',
  found: 'Festgestellt am',
  order: 'Auftrag',
} as const

/** What the list "Mängel" says in its cells. */
export const defectTableWords = {
  withoutClass: 'ohne Klasse',
  noOrder: 'keiner',
  late: 'über der Frist',
} as const

/** Where a defect comes from, in a word: the kind of its activity, "Bericht", "Störmeldung" or "von Hand". */
export function defectOriginWord(origin: DefectOrigin): string {
  switch (origin.kind) {
    case 'activity':
      return activityKindLabel[origin.activityKind]
    case 'report':
      return 'Bericht'
    case 'fault':
      return 'Störmeldung'
    case 'hand':
      return 'von Hand'
  }
}

/**
 * Where a defect is: the asset, the room, the building or the property, and
 * below it where that is. The server names them; `reads` leaves out what the
 * person does not read, the names of the places and those of the asset.
 */
export function defectWhere(
  place: DefectPlace,
  reads: { readonly places: boolean; readonly assets: boolean } = { places: true, assets: true },
): { readonly name: string; readonly sub: string } {
  const propertyName = reads.places ? place.propertyName : 'Liegenschaft'
  const buildingName = reads.places ? place.buildingName : null
  const roomLabel = reads.places ? place.roomLabel : null
  const line = placeWords([propertyName, buildingName])

  if (place.asset !== null) {
    const named = reads.assets
      ? [place.asset.number, place.asset.name].filter(
          (part): part is string => part !== null && part !== '',
        )
      : []

    return { name: named.join(' ') || 'Anlage', sub: placeWords([line, roomLabel]) }
  }

  if (place.roomId !== null) {
    return { name: roomLabel ?? 'Raum', sub: line }
  }

  if (place.buildingId !== null) {
    return { name: buildingName ?? 'Gebäude', sub: propertyName }
  }

  return { name: propertyName, sub: 'Liegenschaft' }
}

/**
 * A defect as a row of its table, with its class named as the catalogue
 * names it. Its work order stands only for whoever reads work orders.
 */
export function defectTableRow(
  defect: DefectEntry,
  where: string,
  defectClass: string | null,
  readsOrders: boolean,
): TableRow {
  const order =
    defect.workOrder === null
      ? defectTableWords.noOrder
      : (defect.workOrder.number ?? defect.workOrder.title)

  return [
    defect.description,
    where,
    defectClass ?? defectTableWords.withoutClass,
    defect.dueOn === null ? null : { day: defect.dueOn },
    defect.overdue ? defectTableWords.late : null,
    defectStatusLabel[defect.status],
    defectOriginWord(defect.origin),
    { day: defect.foundOn },
    readsOrders ? order : null,
  ]
}

// --- The meters -----------------------------------------------------------------------------------

/** The columns of "Zähler" as a table; the list heads its own with the same words (4.9). */
export const meterTableColumns = {
  meter: 'Messstelle',
  main: 'Hauptzähler',
  place: 'Ort',
  medium: 'Medium',
  unit: 'Einheit',
  meterNumber: 'Zählernummer',
  lastReading: 'Letzter Stand',
  readOn: 'Abgelesen am',
  atKeyDate: 'Stand zum Stichtag',
} as const

/** A measuring point in words: its mark and its name. */
export function meterTitle(meter: Pick<MeterEntry, 'mark' | 'name'>): string {
  return [meter.mark, meter.name].filter(Boolean).join(' ')
}

/** The measuring points with each sub meter under its main meter, as far as both are listed. */
export function metersNested(
  meters: readonly MeterEntry[],
): { readonly meter: MeterEntry; readonly sub: boolean }[] {
  const listed = new Set(meters.map((meter) => meter.assetId))
  const top = meters.filter((meter) => meter.mainMeterId === null || !listed.has(meter.mainMeterId))
  const below = (main: MeterEntry) => meters.filter((meter) => meter.mainMeterId === main.assetId)

  return top.flatMap((meter) => [
    { meter, sub: false },
    ...below(meter).map((each) => ({ meter: each, sub: true })),
  ])
}

/** Where a measuring point is, in a line: the property, the building and the number of the room. */
export function meterPlaceWords(
  meter: Pick<MeterEntry, 'propertyId' | 'buildingId' | 'roomId'>,
  names: PlaceNames,
): string {
  return placeWords([
    names.property(meter.propertyId),
    meter.buildingId === null ? null : names.building(meter.buildingId),
    meter.roomId === null ? null : (names.room(meter.roomId)?.number ?? null),
  ])
}

/**
 * The measuring points of the list as the rows of its table, a sub meter
 * under its main meter as in the list and with the main meter named in a
 * column of its own. The place stands for whoever reads places; the last
 * reading is a number in the unit of the column beside it.
 */
export function meterTableRows(
  meters: readonly MeterEntry[],
  names: PlaceNames | null,
): readonly TableRow[] {
  const byId = new Map<string, MeterEntry>(meters.map((meter) => [meter.assetId, meter]))

  return metersNested(meters).map(({ meter, sub }) => {
    const main = sub && meter.mainMeterId !== null ? (byId.get(meter.mainMeterId) ?? null) : null

    return [
      meterTitle(meter),
      main === null ? null : meterTitle(main),
      names === null ? null : meterPlaceWords(meter, names),
      meter.medium === null ? null : meterMediumLabel[meter.medium],
      meterUnitSymbol[meter.unit],
      meter.meterNumber,
      meter.lastReading === null ? null : meter.lastReading.valueMilli / 1000,
      meter.lastReading === null ? null : { day: meter.lastReading.readOn },
      meterStateLabel[meter.state],
    ]
  })
}

// --- The register of duties -------------------------------------------------------------------------

/** The columns of "Pflichtenverzeichnis" as a table; what the list shows in two lines has two columns (4.3). */
export const dutyTableColumns = {
  where: 'Anlage oder Ort',
  duty: 'Pflicht',
  source: 'Grundlage',
  interval: 'Frist',
  intervalKind: 'Art der Frist',
  intervalCheck: 'Frist prüfen',
  responsible: 'Zuständig',
  performer: 'Ausführung',
  lastEvidence: 'Letzter Nachweis',
  evidenceOn: 'Nachweis vom',
  next: 'Nächster Termin',
  state: 'Zustand',
} as const

/** What the register says in its cells beside the words of a duty. */
export const dutyTableWords = {
  none: 'keiner',
  legacy: 'Altbestand',
  /** Why the register narrowed to a person is no table for whoever may not see the staff. */
  narrowedToAPerson:
    'Auf eine Person eingegrenzt gibt es das Pflichtenverzeichnis als Tabelle nur für die Leitung.',
} as const

/** The columns of the table of duties, with who answers for each only where it names people. */
export function dutyTableHeads(names: boolean): readonly string[] {
  const { responsible, ...columns } = dutyTableColumns

  return Object.values(columns).flatMap((column) =>
    column === columns.performer && names ? [responsible, column] : [column],
  )
}

/** The day a duty is due on next, as the register shows it: none for one that has ended, rests or has none. */
export function dutyNextDay(
  duty: Pick<DutyEntry, 'ended' | 'state' | 'appointment'>,
): IsoDate | null {
  return duty.ended || duty.state === 'dormant' || duty.appointment === null
    ? null
    : duty.appointment.dueOn
}

/**
 * A duty of the register as a row of its table. Who answers for it stands
 * only where `names` says so; who performs it is the operator's own people
 * or a contractor, and no person. "Frist prüfen" has its own column (#74).
 */
export function dutyTableRow(
  duty: DutyEntry,
  where: string,
  catalogue: Catalogue | null,
  names: boolean,
): TableRow {
  const next = dutyNextDay(duty)
  const last = duty.lastEvidence

  return [
    where,
    duty.title,
    dutySourceWords(duty, catalogue),
    intervalWords(dutyInterval(duty)),
    intervalKindWords(duty, catalogue),
    duty.intervalToCheck ? intervalCheckWords : null,
    ...(names ? [duty.responsible?.name ?? nobodyWords] : []),
    performerWords(duty),
    last === null
      ? dutyTableWords.none
      : last.origin === 'legacy'
        ? dutyTableWords.legacy
        : last.number,
    last === null ? null : { day: last.performedOn },
    next === null ? null : { day: next },
    dutyStandingWords(duty),
  ]
}

// --- The proposals of the catalogue -----------------------------------------------------------------

/** The columns of "Vorschläge" as a table: a row for each duty kind at each asset (#102). */
export const proposalTableColumns = {
  kind: 'Pflichtart',
  package: 'Paket',
  asset: 'Anlage',
  place: 'Ort',
  enteredOn: 'Angelegt am',
} as const

/** The columns of the proposals dismissed as a table, each with its reason and its day. */
export const dismissedTableColumns = {
  asset: 'Anlage',
  place: 'Ort',
  kind: 'Pflichtart',
  package: 'Paket',
  reason: 'Begründung',
  dismissedOn: 'Verworfen am',
} as const

/** "AN-00015 Betriebsmittel Werkstatt": an asset by its number and its name. */
export function proposedAssetName(asset: Pick<ProposedAsset, 'number' | 'name'>): string {
  return [asset.number, asset.name].filter(Boolean).join(' ')
}

/** Where a proposed asset stands: "Feuerwache Nord, Wache". */
export function proposedAssetPlace(
  asset: Pick<ProposedAsset, 'propertyId' | 'buildingId'>,
  names: PlaceNames,
): string {
  return placeWords([names.property(asset.propertyId), names.building(asset.buildingId)])
}

/**
 * Two duty kinds in the order of the proposals: that of the catalogue, and
 * a kind the catalogue at hand does not know last, by its key.
 */
export function byProposedKind(
  catalogue: Pick<Catalogue, 'dutyKinds'> | null,
  on: IsoDate,
): (left: string, right: string) => number {
  const order = new Map((catalogue?.dutyKinds(on) ?? []).map((entry, index) => [entry.key, index]))
  const rank = (kind: string) => order.get(kind) ?? Number.MAX_SAFE_INTEGER

  return (left, right) => rank(left) - rank(right) || left.localeCompare(right)
}

/** What a duty kind and its package are called, as far as the catalogue at hand knows them. */
function kindAndPackage(
  catalogue: Pick<Catalogue, 'dutyKind' | 'packages'> | null,
  kind: string,
  on: IsoDate,
): readonly [string, string | null] {
  return [
    catalogue?.dutyKind(kind, on)?.definition.label ?? kind,
    catalogue?.packages.find((each) => each.name === packageOf(kind))?.title ?? null,
  ]
}

/** What a table says of the asset of a proposal: its name and its place, each for whoever reads it. */
export interface ProposalReads {
  readonly assets: boolean
  readonly names: PlaceNames | null
}

function assetCells(asset: ProposedAsset, reads: ProposalReads): readonly [string, string | null] {
  return [
    reads.assets ? proposedAssetName(asset) : 'Anlage',
    reads.names === null ? null : proposedAssetPlace(asset, reads.names),
  ]
}

/**
 * The open proposals as the rows of their table, in the order of the list:
 * by duty kind as the catalogue orders them, the assets of a kind as they
 * were read.
 */
export function proposalTableRows(
  proposals: readonly DutyProposal[],
  catalogue: Pick<Catalogue, 'dutyKind' | 'dutyKinds' | 'packages'> | null,
  on: IsoDate,
  reads: ProposalReads,
): readonly TableRow[] {
  const inOrder = byProposedKind(catalogue, on)

  return proposals
    .map((proposal, index) => ({ proposal, index }))
    .sort(
      (left, right) => inOrder(left.proposal.kind, right.proposal.kind) || left.index - right.index,
    )
    .map(({ proposal }) => [
      ...kindAndPackage(catalogue, proposal.kind, on),
      ...assetCells(proposal.asset, reads),
      { day: proposal.asset.enteredOn },
    ])
}

/** The proposals dismissed as the rows of their table, in the order they were read. */
export function dismissedTableRows(
  dismissed: readonly DismissedProposal[],
  catalogue: Pick<Catalogue, 'dutyKind' | 'packages'> | null,
  on: IsoDate,
  reads: ProposalReads,
): readonly TableRow[] {
  return dismissed.map((each) => [
    ...assetCells(each.asset, reads),
    ...kindAndPackage(catalogue, each.kind, on),
    each.reason,
    { day: each.dismissedOn },
  ])
}

// --- The areas --------------------------------------------------------------------------------------

/** The columns of "Bereiche" under "Einstellungen" as a table; what lies in an area has its own. */
export const areaTableColumns = {
  area: 'Bereich',
  extent: 'Umfang',
  properties: 'Liegenschaften und Gebäude',
  members: 'Zugänge mit diesem Bereich',
} as const

/** What the list of the areas says where an area holds nothing or is named for nobody. */
export const areaTableWords = { noProperty: 'keine', nobody: 'niemand' } as const

/**
 * "7 Liegenschaften, 12 Gebäude" under the name of an area, or that nothing
 * lies in it. The buildings count those with the area of their own beside
 * those on its properties (#306), so an area may hold buildings and no
 * property.
 */
export function whatLiesIn(area: {
  readonly properties: readonly unknown[]
  readonly buildings: number
}): string {
  const properties = area.properties.length

  if (properties === 0 && area.buildings === 0) {
    return 'keine Liegenschaft'
  }

  const buildings =
    area.buildings === 0
      ? 'kein Gebäude'
      : area.buildings === 1
        ? '1 Gebäude'
        : `${String(area.buildings)} Gebäude`

  const held =
    properties === 0
      ? 'keine Liegenschaft'
      : properties === 1
        ? '1 Liegenschaft'
        : `${String(properties)} Liegenschaften`

  return `${held}, ${buildings}`
}

/**
 * The buildings with an area of their own, as the list of the areas names
 * them: "Gebäude: Mensa (Schulzentrum)", or nothing where there is none.
 */
export function ownBuildingsIn(area: {
  readonly ownBuildings: readonly { readonly name: string; readonly propertyName: string }[]
}): string | null {
  return area.ownBuildings.length === 0
    ? null
    : `Gebäude: ${area.ownBuildings.map((each) => `${each.name} (${each.propertyName})`).join(', ')}`
}

/** The columns of the table of the areas, with who an area is named for only where it names people. */
export function areaTableHeads(names: boolean): readonly string[] {
  const { members, ...columns } = areaTableColumns

  return [...Object.values(columns), ...(names ? [members] : [])]
}

/**
 * An area as a row of its table: every property in it by name, and not the
 * first few as the list shows them. The names of the properties stand for
 * whoever reads places, the people an area is named for only where `people`
 * says so.
 */
export function areaTableRow(
  area: {
    readonly name: string
    readonly properties: readonly { readonly name: string }[]
    readonly buildings: number
    readonly ownBuildings: readonly { readonly name: string; readonly propertyName: string }[]
    readonly members: readonly { readonly name: string }[]
  },
  reads: { readonly places: boolean; readonly people: boolean },
): TableRow {
  const names = (named: readonly { readonly name: string }[]) =>
    named.map((each) => each.name).join(', ')
  const held = [
    ...(area.properties.length === 0 ? [] : [names(area.properties)]),
    ...(area.ownBuildings.length === 0 ? [] : [ownBuildingsIn(area)]),
  ]

  return [
    area.name,
    whatLiesIn(area),
    !reads.places ? null : held.length === 0 ? areaTableWords.noProperty : held.join('; '),
    ...(reads.people
      ? [area.members.length === 0 ? areaTableWords.nobody : names(area.members)]
      : []),
  ]
}

// --- The tasks ----------------------------------------------------------------------------------------

/** The columns of "Aufgaben" as a table: the two lists of the screen are a column of it (#124). */
export const taskTableColumns = {
  list: 'Liste',
  title: 'Aufgabe',
  due: 'Fällig am',
  late: 'Überfällig',
  where: 'Hängt an',
  responsible: 'Verantwortlich',
} as const

/** What the two lists of "Aufgaben" are called, and what a task past its day says. */
export const taskListWords = {
  mine: 'Ihre Aufgaben',
  others: 'Offen bei anderen',
  late: 'überfällig',
} as const

/** An open task as its table reads it: what it hangs on in words, and who it is for by name. */
export interface TaskLine extends TaskStanding {
  readonly title: string
  readonly assigneeUserId: string
  /** Who it is for, by name; null where the table names nobody. */
  readonly responsible: string | null
  readonly where: string
}

/** The columns of the table of tasks, with who a task is for only where it names people. */
export function taskTableHeads(names: boolean): readonly string[] {
  const { responsible, ...columns } = taskTableColumns

  return [...Object.values(columns), ...(names ? [responsible] : [])]
}

/**
 * The open tasks as the rows of their table: the person's own first, then
 * those open with the others, each list in the order somebody works through
 * it. Who a task is for stands only where `names` says so; that it is one's
 * own or somebody else's is said by its list.
 */
export function taskTableRows(
  tasks: readonly TaskLine[],
  me: string,
  today: IsoDate,
  names: boolean,
): readonly TableRow[] {
  const own = (task: TaskLine) => task.assigneeUserId === me

  return [...tasks]
    .sort(
      (left, right) => Number(own(right)) - Number(own(left)) || compareTasksForWork(left, right),
    )
    .map((task) => [
      own(task) ? taskListWords.mine : taskListWords.others,
      task.title,
      { day: task.dueOn },
      isTaskOverdue(task, today) ? taskListWords.late : null,
      task.where,
      ...(names ? [task.responsible] : []),
    ])
}

// --- The documents ------------------------------------------------------------------------------------

/**
 * The columns of "Dokumente" as a table; the file under the name of a
 * document has its own (4.10). The last one holds the day the newest version
 * was filed. The list heads it "Geändert"; a table says what the day is, so
 * that nobody takes it for the stamp of the last change (#157).
 */
export const documentTableColumns = {
  title: 'Dokument',
  file: 'Datei',
  kind: 'Art',
  home: 'Hängt an',
  versions: 'Fassung',
  filedOn: 'Abgelegt am',
} as const

/** What a list says of a document without a kind: "Foto" for a picture, which a photo of a type plate is. */
export const documentKindWords = {
  photo: 'Foto',
  noKind: 'Ohne Art',
  /** Behind the kind of a document taken over from a predecessor application (#130). */
  legacy: 'Altbestand',
} as const

/** What a kind of place a document can hang on is called. */
export const documentHomeLabel: Readonly<Record<DocumentHome, string>> = {
  propertyId: 'Liegenschaft',
  buildingId: 'Gebäude',
  roomId: 'Raum',
  assetId: 'Anlage',
  activityId: 'Vorgang',
  defectId: 'Mangel',
  contractorId: 'Fremdfirma',
  contractId: 'Vertrag',
}

/**
 * The kind of a document as a list says it: its kind, or "Foto" for a
 * picture without one. A document taken over from a predecessor application
 * says so behind its kind, wherever its kind is said (section 11 of the
 * concept, #130).
 */
export function documentKindOf(
  kind: string | null,
  newestMediaType: string | null,
  legacy = false,
): string {
  const words =
    kind !== null && Object.hasOwn(documentKindLabel, kind)
      ? documentKindLabel[kind as DocumentKind]
      : newestMediaType !== null && isPicture(newestMediaType)
        ? documentKindWords.photo
        : documentKindWords.noKind

  return legacy ? `${words}, ${documentKindWords.legacy}` : words
}

/**
 * What a document hangs on, in words: an asset by its number and name, a
 * room, a building, an activity and a defect by what they are called with
 * their property behind, the property by its name. A record the person does
 * not read, `named` null, is named by its kind alone.
 */
export function documentHomeWords(
  home: DocumentHome,
  named: string | null,
  property: string | null,
): string {
  if (home === 'propertyId') {
    return `${documentHomeLabel.propertyId} ${property ?? ''}`.trim()
  }

  // A contractor has no property (#328), nor has a contract (#329): its name, or the kind where the person does not read it.
  if (home === 'contractorId' || home === 'contractId') {
    return `${documentHomeLabel[home]} ${named ?? ''}`.trim()
  }

  if (home === 'assetId' && named !== null) {
    return named
  }

  const kind = home === 'roomId' || home === 'buildingId' ? `${documentHomeLabel[home]} ` : ''

  return placeWords([named === null ? documentHomeLabel[home] : `${kind}${named}`, property])
}

/** A document as its table reads it: what it hangs on in words, and its newest version. */
export interface DocumentLine {
  readonly title: string
  readonly kind: string | null
  /** Whether it was taken over from a predecessor application (#130). */
  readonly legacy?: boolean
  readonly home: string
  /** How many versions it has. */
  readonly versions: number
  readonly newest: {
    readonly fileName: string
    readonly mediaType: string
    /** The day it was filed. */
    readonly filedOn: IsoDate
  } | null
}

/**
 * A document as a row of its table. The day is the one its newest version
 * was filed on, as the list shows it: the day and never the time, and never
 * who filed it (section 9 of the concept).
 */
export function documentTableRow(document: DocumentLine): TableRow {
  return [
    document.title,
    document.newest?.fileName ?? null,
    documentKindOf(document.kind, document.newest?.mediaType ?? null, document.legacy === true),
    document.home,
    Math.max(document.versions, 1),
    document.newest === null ? null : { day: document.newest.filedOn },
  ]
}

// --- The rounds ---------------------------------------------------------------------------------------

/** The columns of "Rundgänge" as a table: a row for each round of the week, and of those left open (4.5). */
export const roundWeekTableColumns = {
  list: 'Liste',
  place: 'Gebäude',
  within: 'Liegenschaft',
  title: 'Rundgang',
  rhythm: 'Rhythmus',
  due: 'Fällig am',
  walker: 'Zuständig',
  state: 'Stand',
} as const

/** What the overview of a week says in its cells. */
export const roundWeekWords = {
  week: 'In der Woche',
  before: 'Offen aus vergangenen Wochen',
  wholeProperty: 'ganze Liegenschaft',
  round: 'Rundgang',
} as const

/** Who walks a round that is given to nobody: everybody in its area, which is no person. */
export function everybodyIn(area: string | null): string {
  return `Alle im Bereich${area ? ` ${area}` : ''}`
}

/**
 * Where the rounds of a plan are walked, as the overview shows it in two
 * lines: the building and its property, or the property as a whole. A name
 * the person does not read is said by what it is.
 */
export function roundPlace(
  plan: { readonly propertyId: string; readonly buildingId: string | null },
  names: PlaceNames | null,
): { readonly place: string; readonly within: string } {
  const property = names?.property(plan.propertyId) ?? 'Liegenschaft'

  return plan.buildingId === null
    ? { place: property, within: roundWeekWords.wholeProperty }
    : { place: names?.building(plan.buildingId) ?? 'Gebäude', within: property }
}

/** A round of the overview as its table reads it: its plan in words, and who walks it. */
export interface RoundLine {
  readonly before: boolean
  readonly place: string
  readonly within: string
  readonly title: string
  readonly rhythm: string
  readonly dueOn: IsoDate
  /** Who walks it: a person by name where the table names people, everybody in the area, or nothing. */
  readonly walker: string | null
  readonly state: RoundState
}

/**
 * The rounds of the overview as the rows of their table: those of the week
 * by property, building and round as the list orders its rows, each plan
 * with its rounds in the order of their days, then those left open from
 * earlier weeks as they were read, the latest first.
 */
export function roundWeekTableRows(rounds: readonly RoundLine[]): readonly TableRow[] {
  const inOrder = (left: RoundLine, right: RoundLine) =>
    byNameIn(left.within, right.within) ||
    byNameIn(left.place, right.place) ||
    byNameIn(left.title, right.title) ||
    left.dueOn.localeCompare(right.dueOn)

  return [
    ...rounds.filter((round) => !round.before).sort(inOrder),
    ...rounds.filter((round) => round.before),
  ].map((round) => [
    round.before ? roundWeekWords.before : roundWeekWords.week,
    round.place,
    round.within,
    round.title,
    round.rhythm,
    { day: round.dueOn },
    round.walker,
    roundStateLabel[round.state],
  ])
}

/** The columns of the operator's own templates of rounds as a table (#112). */
export const roundTemplateTableColumns = {
  title: 'Vorlage',
  size: 'Umfang',
  version: 'Fassung',
  since: 'Seit',
  countersignature: 'Gegenzeichnung',
  rounds: 'Rundgänge',
} as const

/** Whether a round of a template asks for a countersignature, as the list says it. */
export const countersignatureWords = { asked: 'verlangt', none: 'nein' } as const

/** "2 Kapitel, 8 Punkte". */
export function templateSizeWords(definition: {
  readonly sections: readonly { readonly fields: readonly unknown[] }[]
}): string {
  const points = definition.sections.reduce((sum, section) => sum + section.fields.length, 0)

  return `${String(definition.sections.length)} Kapitel, ${String(points)} ${points === 1 ? 'Punkt' : 'Punkte'}`
}

/** A template of the operator as its table reads it: its newest version and the rounds made of it. */
export interface TemplateLine {
  readonly title: string
  readonly size: string
  readonly formVersion: number
  /** The day its newest version was made. */
  readonly since: IsoDate
  readonly asksCountersignature: boolean
  readonly rounds: number
}

/** The templates as the rows of their table, by their names. */
export function roundTemplateTableRows(templates: readonly TemplateLine[]): readonly TableRow[] {
  return [...templates]
    .sort((left, right) => byNameIn(left.title, right.title))
    .map((template) => [
      template.title,
      template.size,
      template.formVersion,
      { day: template.since },
      template.asksCountersignature ? countersignatureWords.asked : countersignatureWords.none,
      template.rounds,
    ])
}

/** The columns of "Pläne" as a table: every plan with its place, who walks its rounds and its next pass. */
export const roundPlanTableColumns = {
  title: 'Rundgang',
  rhythm: 'Rhythmus',
  place: 'Gebäude',
  within: 'Liegenschaft',
  walker: 'Zuständig',
  next: 'Nächster Durchgang',
  state: 'Stand',
} as const

/** Where a plan stands, by its state and its days: "Läuft bis 31.12.2026", "Ruht", "Beendet am 30.09.2026". */
export function planStateText(
  plan: Pick<RoundPlan, 'startsOn' | 'endsOn' | 'resting'>,
  on: IsoDate,
): string {
  switch (planStateOn(plan, on)) {
    case 'ended':
      return `Beendet am ${plan.endsOn === null ? '' : dayInWords(plan.endsOn)}`
    case 'resting':
      return 'Ruht'
    case 'upcoming':
      return `Beginnt am ${dayInWords(plan.startsOn)}`
    case 'running':
      return plan.endsOn === null ? 'Läuft' : `Läuft bis ${dayInWords(plan.endsOn)}`
  }
}

/** The first pass of a plan from a day on that its building is open for, or none. */
export function planNextPass(
  calendar: PlanCalendar,
  closures: readonly { readonly startsOn: IsoDate; readonly endsOn: IsoDate }[],
  from: IsoDate,
): IsoDate | null {
  for (let day = from, step = 0; step < passSearchDays; day = addDays(day, 1), step += 1) {
    if (calendar.endsOn !== null && day > calendar.endsOn) {
      return null
    }

    if (isPassDay(calendar, day) && closureOn(closures, day) === null) {
      return day
    }
  }

  return null
}

/** A plan as its table reads it: its template and its place in words, who walks its rounds, its next pass. */
export interface PlanLine {
  readonly title: string
  readonly rhythm: string
  readonly place: string
  readonly within: string
  /** Who walks its rounds: a person by name where the table names people, everybody in the area, or nothing. */
  readonly walker: string | null
  readonly next: IsoDate | null
  readonly state: string
}

/** The plans as the rows of their table, by property, building and round as the list orders them. */
export function roundPlanTableRows(plans: readonly PlanLine[]): readonly TableRow[] {
  return [...plans]
    .sort(
      (left, right) =>
        byNameIn(left.within, right.within) ||
        byNameIn(left.place, right.place) ||
        byNameIn(left.title, right.title),
    )
    .map((plan) => [
      plan.title,
      plan.rhythm,
      plan.place,
      plan.within,
      plan.walker,
      plan.next === null ? null : { day: plan.next },
      plan.state,
    ])
}
