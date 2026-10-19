import { randomUUID } from 'node:crypto'

import {
  assetImportFields,
  type CollectiveCandidates,
  collectiveTitle,
  type FaultCategory,
  type FaultPlaceChoice,
  mayBecomeAPart,
  suggestedMapping,
  tableBodyType,
  tableColumns,
  type TableSheet,
  type WorkOrderKind,
  type WorkOrderUrgency,
} from '@opengewerk/haustechnik-domain'

import { dayInGermany } from '../today.js'
import type { PreviewArea } from './preview-database.js'
import {
  layLaterVersions,
  plantDocument,
  type SampleDocument,
  samplePdf,
  storeSampleFile,
} from './sample-documents.js'

/**
 * The sample operator of the preview: two areas, two properties in each, with
 * buildings, floors and rooms, and assets of the kinds of the probe package,
 * a main water meter with its sub meters among them (#29), and one asset of a
 * general kind, a ventilation unit no package describes yet (#61). One property has
 * two buildings and a note, so that the list and the page of a property show
 * both (#85), and the people to talk to there: one with everything known
 * about them and one without an address. At another property only a name is
 * known, and two have nobody entered. The school house has the times it is
 * closed (#86): the holidays that come next, counted from the year the
 * preview is started in, so that they lie ahead in every year. Every asset is
 * in service; one sub meter is out of service since the first day of the
 * year. The main meter of the school house supplies the whole building, and
 * its sub meter the gym, which it does not stand in, so that the page of a
 * room shows what supplies it from elsewhere. Some assets have duties, met a
 * while ago, long ago or never, one rests with its asset and one elevator has
 * an open defect, so that the register of assets and the file of an asset
 * show every condition (#87). The school centre has documents (#97): one of
 * the property, one of the school house, a plan in its boiler room with
 * three versions, and at its elevator a manual with two, a photo of the
 * type plate and the risk assessment its main test points at, which has a
 * newer version since, so that the duty says "Frist prüfen" (#74). Beside
 * the colleagues the
 * preview admits, one person is asked to join and one stands in for another
 * from next week on, so that "Zugänge" shows an invitation and a substitution
 * (#84). The hall of the depot has electrical equipment of the package
 * Elektro that nobody has decided on, and one proposal dismissed, so that
 * the proposals of the catalogue show (#102).
 *
 * Written for the preview and taken from nowhere: the names, streets and
 * places are made up, the postal codes and the phone numbers begin with 0000,
 * which no place and no line in Germany has, and the addresses end in
 * `.example`. Nothing here is a template, a building, an asset or a person of
 * a real operator.
 *
 * Planted through the routes the interface uses, as the Leitung, so that a
 * route which changes its mind about a field breaks the test of the preview
 * and not its next start.
 */

interface SampleRoom {
  readonly number: string
  readonly name: string
  readonly use?: string
  /** Duties that hang on the room itself, of the operator's own. */
  readonly duties?: readonly SampleDuty[]
  readonly documents?: readonly SampleDocument[]
  /** A label on its door. */
  readonly label?: true
}

interface SampleFloor {
  readonly name: string
  readonly level: number
  readonly rooms: readonly SampleRoom[]
}

interface SampleAsset {
  readonly kind:
    | 'probe.elevator'
    | 'messstellen.water_meter'
    | 'allgemein.ventilation_and_air_conditioning'
    | 'elektro.portable_equipment'
    | 'elektro.low_voltage_installation'
    | 'elektro.residual_current_device'
    | 'elektro.safety_lighting'
  readonly name: string
  readonly manufacturer?: string
  readonly model?: string
  /** With a serial number and a mark an asset can be found again as a possible duplicate. */
  readonly serialNumber?: string
  readonly mark?: string
  readonly yearBuilt?: number
  readonly values: Readonly<Record<string, unknown>>
  readonly meterNumber?: string
  /** The number of the room it stands in, if it stands in one. */
  readonly room?: string
  readonly components?: readonly SampleAsset[]
  /** The state it is in from a day on, after being in service from the start. */
  readonly lifecycle?: readonly SampleState[]
  /** The buildings of its property it supplies, by name: its own as a whole, or one it does not stand in. */
  readonly supplies?: readonly string[]
  readonly duties?: readonly SampleDuty[]
  /** Proposals of the catalogue dismissed at it, by the key of their kind, with the reason (#102). */
  readonly dismissed?: readonly { readonly kind: string; readonly reason: string }[]
  /** The defects somebody found at it, reported by hand in the office (#116). */
  readonly defects?: readonly SampleDefect[]
  readonly documents?: readonly SampleDocument[]
  /** A label on it: a valid one, or one that was lost and blocked, with no new one made yet. */
  readonly label?: 'valid' | 'blocked'
  /**
   * Exchanged some days ago for a new asset of its kind, as the office does
   * it (#89): this one is removed and keeps its file, the new one stands
   * where it stood, and each names the other.
   */
  readonly exchanged?: {
    readonly daysAgo: number
    readonly successor: {
      readonly name: string
      readonly manufacturer?: string
      readonly serialNumber?: string
    }
  }
}

/**
 * A defect at a sample asset, reported by hand through the route (#116), a
 * class given or not; a class without a day takes the default of the
 * operator. A defect with an order gets one through the route of the work
 * orders (#117), and goes as far as the order goes.
 */
interface SampleDefect {
  readonly description: string
  readonly foundDaysAgo: number
  readonly defectClass?: string
  readonly order?: SampleOrder
}

/**
 * A duty at a sample asset or a sample room: confirmed from the catalogue by
 * the key of its kind, or one of the operator's own, after the instructions
 * of the maker unless it names another basis, with the days it was met on,
 * counted back from the day the preview starts.
 *
 * Who answers for it is one of the colleagues of the preview
 * (`previewColleagues`), by the id of their account; a duty without one is
 * what the register points out.
 */
export interface SampleDuty {
  readonly kind?:
    | 'probe.elevator_main_test'
    | 'elektro.installation_test_dguv_v3'
    | 'elektro.portable_equipment_test_dguv_v3'
  readonly label?: string
  readonly basis?: 'manufacturer' | 'own_decision'
  readonly sourceNote?: string
  /** What one of the operator's own has somebody do: a maintenance, unless it names another task. */
  readonly task?: 'inspection' | 'maintenance' | 'visual_check'
  readonly intervalMonths: number
  readonly metDaysAgo?: readonly number[]
  readonly responsible?: PreviewColleagueId
  readonly performer?: 'own_staff' | 'contractor'
  readonly performerNote?: string
  /** It ended this many days ago, and calls for nothing since. */
  readonly endedDaysAgo?: number
  /**
   * The title of a document of its asset that bears its interval (#74),
   * filed before the duty is confirmed.
   */
  readonly intervalDocument?: string
  /**
   * Evidence beside what met it, so that the page of a duty shows each thing
   * an evidence can mean for the appointment: a test that failed, an evidence
   * declared invalid, and one a correction replaced.
   */
  readonly alsoRecorded?: readonly SampleEvidence[]
}

/** An evidence of a sample duty that does not simply count. */
export interface SampleEvidence {
  readonly daysAgo: number
  readonly result?: 'failed'
  /** Declared invalid, for this reason. */
  readonly voidedBecause?: string
  /** A correction of the evidence of that many days ago, which it replaces. */
  readonly correctsDaysAgo?: number
}

type PreviewColleagueId = 'preview-albrecht' | 'preview-lindner' | 'preview-roth' | 'preview-yilmaz'

/** Who performs a duty: the operator's own people, or a contractor by name. */
const ownStaff = { performer: 'own_staff' } as const
const contractor = (performerNote: string) => ({ performer: 'contractor', performerNote }) as const

/** A state of a life cycle, from a day on. */
export interface SampleState {
  readonly state: 'in_service' | 'out_of_service'
  readonly validFrom: string
}

interface SampleBuilding {
  readonly name: string
  readonly shortCode: string
  readonly kinds: readonly string[]
  readonly yearBuilt: number
  /** An area of its own, where it is not the one of its property (#306). */
  readonly ownArea?: PreviewArea
  readonly closures?: readonly SampleClosure[]
  readonly documents?: readonly SampleDocument[]
  readonly floors: readonly SampleFloor[]
  readonly assets: readonly SampleAsset[]
}

/** A time a building is closed, from a day to a day. */
export interface SampleClosure {
  readonly startsOn: string
  readonly endsOn: string
  readonly reason?: string
}

/** The year the preview is started in, in Germany. */
const thisYear = Number(dayInGermany().slice(0, 4))

/** The holidays of the school that come next: over the turn of the year, and the summer after it. */
export const schoolHolidays: readonly SampleClosure[] = [
  {
    startsOn: `${String(thisYear)}-12-24`,
    endsOn: `${String(thisYear + 1)}-01-06`,
    reason: 'Weihnachtsferien',
  },
  {
    startsOn: `${String(thisYear + 1)}-07-27`,
    endsOn: `${String(thisYear + 1)}-09-06`,
    reason: 'Sommerferien',
  },
]

/** Somebody to talk to at a property. */
export interface SampleContact {
  readonly givenName?: string
  readonly familyName: string
  readonly role?: string
  readonly phone?: string
  /** The second number, mostly the mobile one (#428). */
  readonly mobile?: string
  readonly email?: string
}

interface SampleProperty {
  readonly area: PreviewArea
  readonly name: string
  readonly street: string
  readonly postalCode: string
  readonly city: string
  /** What somebody has to know before going there, in the lines it was typed in. */
  readonly note?: string
  readonly contacts?: readonly SampleContact[]
  readonly documents?: readonly SampleDocument[]
  readonly buildings: readonly SampleBuilding[]
}

/** Every sample asset is in service from this day on. */
export const inServiceSince = '2020-01-01'

/** Out of service since the first day of the year the preview is started in. */
export const outOfServiceThisYear: readonly SampleState[] = [
  { state: 'out_of_service', validFrom: `${String(thisYear)}-01-01` },
]

/** The main test of an elevator from the catalogue, every two years, met on these days. */
const mainTest = (...metDaysAgo: number[]): SampleDuty => ({
  kind: 'probe.elevator_main_test',
  intervalMonths: 24,
  metDaysAgo,
})

/** A duty of the operator's own, every year, met on these days. */
const yearly = (label: string, ...metDaysAgo: number[]): SampleDuty => ({
  label,
  intervalMonths: 12,
  metDaysAgo,
})

const waterMeter = (
  name: string,
  meterNumber: string,
  room: string,
  components: readonly SampleAsset[] = [],
  further: Pick<SampleAsset, 'lifecycle' | 'supplies' | 'duties'> = {},
): SampleAsset => ({
  kind: 'messstellen.water_meter',
  name,
  values: {},
  meterNumber,
  room,
  components,
  ...further,
})

/**
 * The exchange among the sample assets (#89): the luminaire in the staircase
 * of the residential building went three weeks ago, and an LED one came.
 */
export const exchangedSample = {
  daysAgo: 21,
  successor: {
    name: 'Sicherheitsleuchte Treppenhaus LED',
    manufacturer: 'Beispiellicht',
    serialNumber: 'SL-2026-0907',
  },
} as const

export const sampleProperties: readonly SampleProperty[] = [
  {
    area: 'Nord',
    name: 'Verwaltung Am Probehang',
    street: 'Am Probehang 4',
    postalCode: '00001',
    city: 'Beispielstadt',
    buildings: [
      {
        name: 'Haus A',
        shortCode: 'A',
        kinds: ['office'],
        yearBuilt: 1998,
        floors: [
          {
            name: 'Erdgeschoss',
            level: 0,
            rooms: [
              { number: '0.01', name: 'Empfang' },
              { number: '0.12', name: 'Technikraum', use: 'Haustechnik' },
            ],
          },
          {
            name: '1. Obergeschoss',
            level: 1,
            rooms: [
              { number: '1.05', name: 'Besprechung' },
              { number: '1.20', name: 'Teeküche' },
            ],
          },
        ],
        assets: [
          {
            kind: 'probe.elevator',
            name: 'Aufzug Haus A',
            // Its label was lost and blocked, and nobody has made a new one.
            label: 'blocked',
            manufacturer: 'Beispiel Aufzüge',
            yearBuilt: 1998,
            values: { firefighters_lift: false, stops: 2 },
            // In order: both met, the next one falls due in months.
            duties: [
              {
                ...mainTest(200),
                responsible: 'preview-lindner',
                ...contractor('Prüfdienst Beispiel GmbH'),
              },
              {
                ...yearly('Wartung des Aufzugs', 405, 40),
                responsible: 'preview-lindner',
                ...contractor('Beispiel Aufzüge, Kundendienst'),
                // What the last maintenance counts from stays the one of
                // forty days ago: none of these three counts.
                alsoRecorded: [
                  { daysAgo: 404, correctsDaysAgo: 405 },
                  { daysAgo: 25, result: 'failed' },
                  {
                    daysAgo: 12,
                    voidedBecause: 'Der Bericht gehört zum Aufzug im Nachbarhaus.',
                  },
                ],
              },
            ],
          },
          waterMeter(
            'Hauptwasserzähler Haus A',
            'WZ-1001',
            '0.12',
            [
              // Due: a year is over in two weeks.
              waterMeter('Unterzähler Teeküche', 'WZ-1002', '1.20', [], {
                duties: [
                  {
                    ...yearly('Sichtprüfung der Zähleranlage', 350),
                    task: 'visual_check',
                    responsible: 'preview-lindner',
                    ...ownStaff,
                  },
                ],
              }),
            ],
            // Overdue: the year was over a month ago.
            {
              duties: [
                {
                  ...yearly('Sichtprüfung der Zähleranlage', 400),
                  task: 'visual_check',
                  responsible: 'preview-albrecht',
                  ...ownStaff,
                },
              ],
            },
          ),
        ],
      },
    ],
  },
  {
    area: 'Nord',
    name: 'Werkhof Nord',
    street: 'Lagerweg 12',
    postalCode: '00002',
    city: 'Beispielstadt',
    contacts: [{ familyName: 'Albers' }],
    buildings: [
      {
        name: 'Halle 1',
        shortCode: 'H1',
        kinds: ['commercial'],
        yearBuilt: 2009,
        floors: [
          {
            name: 'Erdgeschoss',
            level: 0,
            rooms: [
              { number: 'E.01', name: 'Werkstatt' },
              { number: 'E.02', name: 'Lager' },
            ],
          },
        ],
        assets: [
          // Never checked: confirmed, no evidence yet, and nobody answers
          // for it. Beside it a duty that ended a month ago.
          waterMeter('Wasserzähler Werkstatt', 'WZ-2001', 'E.01', [], {
            duties: [
              { ...yearly('Sichtprüfung der Zähleranlage'), task: 'visual_check', ...ownStaff },
              {
                ...yearly('Eichung des alten Zählers', 500),
                task: 'inspection',
                responsible: 'preview-lindner',
                endedDaysAgo: 30,
              },
            ],
          }),
          // The electrical equipment of the hall, which nobody has decided on
          // yet (#102): the catalogue proposes the tests of the package
          // Elektro, after DGUV Vorschrift 3 and 4 alike, as the package
          // cannot know which of the two holds for the operator. At the
          // switch of the hall the one after Vorschrift 4 is dismissed.
          // Both tested after DGUV Vorschrift 3, one of them overdue: what a
          // collective activity of the hall takes in one go (#342).
          {
            kind: 'elektro.portable_equipment',
            name: 'Betriebsmittel Werkstatt',
            values: { work_area: 'workshop' },
            room: 'E.01',
            duties: [
              {
                kind: 'elektro.portable_equipment_test_dguv_v3',
                intervalMonths: 6,
                metDaysAgo: [190],
                responsible: 'preview-lindner',
              },
            ],
          },
          {
            kind: 'elektro.portable_equipment',
            name: 'Betriebsmittel Lager',
            values: { work_area: 'workshop' },
            room: 'E.02',
            duties: [
              {
                kind: 'elektro.portable_equipment_test_dguv_v3',
                intervalMonths: 6,
                metDaysAgo: [175],
                responsible: 'preview-lindner',
              },
            ],
          },
          {
            kind: 'elektro.low_voltage_installation',
            name: 'Elektrische Anlage Halle 1',
            values: { special_location: false },
            // Tested by an Elektrofachkraft, due within the lead: the inspection
            // the engine makes names who lacks the qualification (#337).
            duties: [
              {
                kind: 'elektro.installation_test_dguv_v3',
                intervalMonths: 48,
                metDaysAgo: [1450],
                responsible: 'preview-lindner',
              },
            ],
          },
          {
            kind: 'elektro.residual_current_device',
            name: 'Fehlerstrom-Schutzschalter Verteilung Halle 1',
            values: {},
            dismissed: [
              {
                kind: 'elektro.rcd_test_button_dguv_v4',
                reason:
                  'Der Betrieb ist Mitglied einer Berufsgenossenschaft; für ihn gilt DGUV Vorschrift 3.',
              },
            ],
          },
          {
            kind: 'elektro.safety_lighting',
            name: 'Sicherheitsbeleuchtung Halle 1',
            values: {},
          },
          // No package describes it yet: the general kind of its cost group,
          // which the catalogue proposes nothing for, and a duty of the
          // operator's own, which such an asset may carry from the start.
          {
            kind: 'allgemein.ventilation_and_air_conditioning',
            name: 'Lüftungsgerät Werkstatt',
            manufacturer: 'Beispiel Lufttechnik',
            yearBuilt: 2009,
            values: {},
            room: 'E.01',
            duties: [
              {
                ...yearly('Filterwechsel nach Angabe des Herstellers', 60),
                responsible: 'preview-yilmaz',
                ...ownStaff,
              },
            ],
          },
        ],
      },
    ],
  },
  {
    area: 'Süd',
    name: 'Schulzentrum Am Lindenhain',
    street: 'Am Lindenhain 7',
    postalCode: '00003',
    city: 'Musterhausen',
    note: 'Zufahrt über den Hof an der Lindenstraße.\nSchlüssel beim Hausmeister, Raum E.10.',
    contacts: [
      {
        givenName: 'Klaus',
        familyName: 'Becker',
        role: 'Hausmeister',
        phone: '0000 4471',
        mobile: '0000 4479',
        email: 'hausmeister@schulzentrum.example',
      },
      // A title is typed with the given name: a contact has no field of its own for one.
      { givenName: 'Dr. Ines', familyName: 'Hartmann', role: 'Schulleitung', phone: '0000 4400' },
    ],
    // A document of the property as a whole.
    documents: [
      {
        title: 'Brandschutzkonzept Schulzentrum',
        kind: 'concept',
        versions: [
          {
            fileName: 'brandschutzkonzept-2019.pdf',
            words: 'Brandschutzkonzept Schulzentrum, 2019',
          },
        ],
      },
    ],
    buildings: [
      {
        name: 'Schulhaus',
        shortCode: 'S',
        kinds: ['school'],
        yearBuilt: 1975,
        closures: schoolHolidays,
        documents: [
          {
            title: 'Revisionsunterlagen Heizung',
            kind: 'as_built_documentation',
            versions: [
              { fileName: 'revision-heizung.pdf', words: 'Revisionsunterlagen Heizung Schulhaus' },
            ],
          },
        ],
        floors: [
          {
            name: 'Erdgeschoss',
            level: 0,
            rooms: [
              { number: 'E.10', name: 'Hausmeister' },
              {
                number: 'E.14',
                label: true,
                name: 'Heizraum',
                use: 'Haustechnik',
                // A duty of the room itself, due within three weeks, and
                // nobody is named for it.
                duties: [
                  {
                    label: 'Heizraum frei von Brandlasten',
                    basis: 'own_decision',
                    sourceNote: 'Brandschutzordnung Teil C',
                    task: 'visual_check',
                    intervalMonths: 3,
                    metDaysAgo: [72],
                    ...ownStaff,
                  },
                ],
                // A plan somebody redrew twice: three versions, each readable.
                documents: [
                  {
                    title: 'Schaltplan Heizraum',
                    kind: 'circuit_diagram',
                    versions: [
                      {
                        fileName: 'schaltplan-heizraum.pdf',
                        words: 'Schaltplan Heizraum, Stand 2021',
                      },
                      {
                        fileName: 'schaltplan-heizraum.pdf',
                        words: 'Schaltplan Heizraum, Stand 2024',
                      },
                      {
                        fileName: 'schaltplan-heizraum.pdf',
                        words: 'Schaltplan Heizraum, Stand 2026',
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            name: '1. Obergeschoss',
            level: 1,
            rooms: [{ number: '1.03', name: 'Klassenraum 5a' }],
          },
        ],
        assets: [
          {
            kind: 'probe.elevator',
            name: 'Aufzug Schulhaus',
            label: 'valid',
            manufacturer: 'Beispiel Aufzüge',
            model: 'BA 630',
            // The serial number the form of a new asset is tried with: the
            // same one typed there names this asset as a possible duplicate.
            serialNumber: 'BA-630-12-0193',
            mark: 'AZ-01',
            yearBuilt: 2012,
            values: { firefighters_lift: false, stops: 2 },
            duties: [
              {
                ...mainTest(100),
                // Every year, as its risk assessment says: within the maximum
                // of the version to come, so it may be left as it is (#139).
                intervalMonths: 12,
                responsible: 'preview-roth',
                ...contractor('Prüfdienst Beispiel GmbH'),
                // Its interval stands on the risk assessment, of which a
                // newer version came since: the duty says "Frist prüfen" (#74).
                intervalDocument: 'Gefährdungsbeurteilung Aufzug Schulhaus',
              },
            ],
            // What the list "Mängel" is looked at with (#116): one over its
            // deadline, as the default of its class is a day; one within
            // it; one without a class yet; one a work order set right that
            // waits to be checked again; and one checked again.
            defects: [
              {
                description: 'Notruf im Fahrkorb ohne Verbindung',
                foundDaysAgo: 4,
                defectClass: 'allgemein.dangerous',
              },
              {
                description: 'Kabine hält zwei Zentimeter unter Bündigkeit',
                foundDaysAgo: 9,
                defectClass: 'allgemein.minor',
                order: { title: 'Haltegenauigkeit der Kabine nachstellen', leads: 'preview-wendt' },
              },
              // Today: newer than the defect of the round, which has the last
              // Wednesday before today. Two days ago it was older on most days
              // and newer on a Thursday, and the list changed its order with the
              // day of the week.
              { description: 'Kratzgeräusch an der Schachttür im 1. OG', foundDaysAgo: 0 },
              {
                description: 'Beleuchtung im Fahrkorb flackert',
                foundDaysAgo: 20,
                defectClass: 'allgemein.significant',
                order: {
                  title: 'Leuchtmittel im Fahrkorb tauschen',
                  leads: 'preview-wendt',
                  urgency: 'urgent',
                  goes: 'signed',
                },
              },
              {
                description: 'Schild mit der Notrufnummer fehlt',
                foundDaysAgo: 40,
                defectClass: 'allgemein.significant',
                order: {
                  title: 'Schild mit der Notrufnummer anbringen',
                  leads: 'preview-roth',
                  goes: 'checked',
                },
              },
            ],
            // What the card "Dokumente" of its file shows: a manual with a
            // second version laid over the first, and a photo without a kind.
            documents: [
              {
                title: 'Betriebsanleitung BA 630',
                kind: 'operating_manual',
                versions: [
                  {
                    fileName: 'betriebsanleitung-ba630.pdf',
                    words: 'Betriebsanleitung BA 630, Ausgabe 2012',
                  },
                  {
                    fileName: 'betriebsanleitung-ba630.pdf',
                    words: 'Betriebsanleitung BA 630, Ausgabe 2024',
                  },
                ],
              },
              { title: 'Typenschild', versions: [{ fileName: 'typenschild.png' }] },
              {
                title: 'Gefährdungsbeurteilung Aufzug Schulhaus',
                kind: 'risk_assessment',
                versions: [
                  {
                    fileName: 'gefaehrdungsbeurteilung-aufzug.pdf',
                    words: 'Gefährdungsbeurteilung Aufzug Schulhaus, Stand 2024',
                  },
                ],
                laterVersions: [
                  {
                    fileName: 'gefaehrdungsbeurteilung-aufzug.pdf',
                    words: 'Gefährdungsbeurteilung Aufzug Schulhaus, Stand 2026',
                    // Its review, which stands in "Fristen" (#327).
                    validUntil: daysAhead(40),
                  },
                ],
              },
            ],
          },
          waterMeter(
            'Hauptwasserzähler Schulhaus',
            'WZ-3001',
            'E.14',
            [
              // Rests: out of service, whatever its duty says.
              waterMeter('Unterzähler Sporthalle', 'WZ-3002', 'E.14', [], {
                lifecycle: outOfServiceThisYear,
                supplies: ['Sporthalle'],
                duties: [
                  {
                    ...yearly('Sichtprüfung der Zähleranlage', 500),
                    task: 'visual_check',
                    responsible: 'preview-roth',
                    ...ownStaff,
                  },
                ],
              }),
            ],
            { supplies: ['Schulhaus'] },
          ),
        ],
      },
      {
        name: 'Sporthalle',
        shortCode: 'SH',
        kinds: ['school', 'assembly'],
        yearBuilt: 1982,
        // Looked after from the north, like the Mensa on the boards (#306):
        // whoever holds only the north sees the school centre and this hall.
        ownArea: 'Nord',
        floors: [
          {
            name: 'Erdgeschoss',
            level: 0,
            rooms: [
              { number: 'H.01', name: 'Halle' },
              { number: 'H.02', name: 'Geräteraum' },
            ],
          },
        ],
        assets: [],
      },
    ],
  },
  {
    area: 'Süd',
    name: 'Wohnanlage Birkenweg',
    street: 'Birkenweg 2',
    postalCode: '00004',
    city: 'Musterhausen',
    buildings: [
      {
        name: 'Haus 2',
        shortCode: '2',
        kinds: ['residential'],
        yearBuilt: 1987,
        floors: [
          {
            name: 'Keller',
            level: -1,
            rooms: [{ number: 'K.01', name: 'Hausanschlussraum', use: 'Haustechnik' }],
          },
          { name: 'Erdgeschoss', level: 0, rooms: [{ number: 'E.01', name: 'Treppenhaus' }] },
        ],
        assets: [
          {
            kind: 'probe.elevator',
            name: 'Aufzug Haus 2',
            values: { firefighters_lift: false, stops: 5 },
          },
          waterMeter('Hauptwasserzähler Haus 2', 'WZ-4001', 'K.01'),
          // Exchanged three weeks ago (#89): the old luminaire is removed and
          // keeps its file, the new one stands in the staircase and names
          // it, and the catalogue proposes its duties anew. The last asset of
          // the sample, so that no number before it moves.
          {
            kind: 'elektro.safety_lighting',
            name: 'Sicherheitsleuchte Treppenhaus',
            manufacturer: 'Beispiellicht',
            serialNumber: 'SL-2011-0412',
            yearBuilt: 2011,
            values: {},
            room: 'E.01',
            exchanged: exchangedSample,
          },
        ],
      },
    ],
  },
]

/** The name the sample operator goes by, so that nobody takes it for a real one. */
export const sampleOperatorName = 'Liegenschaften Beispielstadt (Vorschau)'

/** Somebody the Leitung asked to join the building services, as the route takes it. */
export const sampleInvitation = {
  name: 'Kai Neumann',
  email: 'k.neumann@beispielstadt.example',
  roles: ['technician'],
  send: 'link',
} as const

/** The area that invitation names. */
export const sampleInvitationArea: PreviewArea = 'Süd'

/** A day counted from the one the preview is started on, so that it lies ahead on every start. */
function daysAhead(days: number): string {
  const day = new Date(`${dayInGermany()}T00:00:00Z`)

  day.setUTCDate(day.getUTCDate() + days)

  return day.toISOString().slice(0, 10)
}

/**
 * Who leads the north stands in for who leads the south, from next week on
 * for twelve days: the two are colleagues of the preview
 * (`previewColleagues`), named by the id of their account.
 */
export const sampleSubstitution = {
  substitute: 'preview-lindner',
  absent: 'preview-roth',
  startsOn: daysAhead(7),
  endsOn: daysAhead(18),
} as const

/** What the planting reads from a route, which fails with the answer of the server when it is refused. */
async function read<Answer>(address: string, path: string): Promise<Answer> {
  const response = await fetch(`${address}${path}`)

  if (!response.ok) {
    throw new Error(`${path} lehnte ab (${String(response.status)}): ${await response.text()}`)
  }

  return (await response.json()) as Answer
}

/** A request of the planting, which fails with the answer of the server when it is refused. */
async function send(
  address: string,
  path: string,
  body: unknown,
  method: 'POST' | 'PUT' | 'PATCH' = 'POST',
): Promise<{ id: string }> {
  const response = await fetch(`${address}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    throw new Error(`${path} lehnte ab (${String(response.status)}): ${await response.text()}`)
  }

  return (await response.json()) as { id: string }
}

/**
 * The firms of the list a sample duty names by its note, filled when the
 * contractors are planted (#328). A note that is no firm of the list, as
 * "Beispiel Aufzüge, Kundendienst", stays text, so that the list of the
 * contractors offers to take it over.
 */
const sampleFirms = new Map<string, string>()

/**
 * The contractors of the sample operator (#328), as the board "Fremdfirmen"
 * draws them: three firms with their address and the cost groups they work in.
 */
async function plantSampleContractors(address: string): Promise<void> {
  const firms = [
    {
      name: 'Prüfdienst Beispiel GmbH',
      street: 'Industriestraße 12',
      postalCode: '68169',
      city: 'Mannheim',
      phone: '0621 445566',
      email: 'service@pruefdienst-beispiel.example',
      services: ['440', '450'],
      note: 'Rufbereitschaft am Wochenende.',
    },
    {
      name: 'Heizungsbau Beispiel GmbH',
      postalCode: '69115',
      city: 'Heidelberg',
      services: ['410', '420'],
    },
    { name: 'Wasserlabor Beispielstadt', postalCode: '68159', city: 'Mannheim', services: ['410'] },
  ]

  for (const firm of firms) {
    sampleFirms.set(firm.name, (await send(address, '/contractors', firm)).id)
  }

  // The people and the papers of the first firm, as the board "Fremdfirma"
  // draws them: its certificate and its insurance, each with its day, which
  // become deadlines (#328).
  const first = sampleFirms.get('Prüfdienst Beispiel GmbH') ?? ''

  await send(address, '/contacts', {
    contractorId: first,
    givenName: 'Petra',
    familyName: 'Krämer',
    role: 'Disposition',
    phone: '0621 445567',
    mobile: '0000 4468',
  })
  await send(address, '/contacts', {
    contractorId: first,
    familyName: 'Weber',
    role: 'Prüfsachverständiger',
    email: 'weber@pruefdienst-beispiel.example',
  })

  for (const document of [
    {
      title: 'Zertifikat Fachbetrieb nach DIN 14675',
      kind: 'test_certificate' as const,
      versions: [
        { fileName: 'zertifikat-din-14675.pdf', words: 'Zertifikat', validUntil: daysAhead(165) },
      ],
    },
    {
      title: 'Betriebshaftpflicht 2026',
      versions: [
        {
          fileName: 'betriebshaftpflicht-2026.pdf',
          words: 'Versicherung',
          validUntil: daysAhead(76),
        },
      ],
    },
  ]) {
    await plantDocument(address, { contractorId: first }, document)
  }
}

/**
 * The contracts of the sample operator (#329), as the board "Verträge" draws
 * them: the maintenance of the elevator, renewed every year with three
 * months' notice and covering the building of the elevator, with its paper;
 * an open-ended one with the laboratory; and one that has ended, which a duty
 * of its firm still names, so that it says "Vertrag abgelaufen".
 */
async function plantSampleContracts(address: string): Promise<void> {
  const tester = sampleFirms.get('Prüfdienst Beispiel GmbH') ?? ''
  const laboratory = sampleFirms.get('Wasserlabor Beispielstadt') ?? ''
  const lifts = await send(address, '/contracts', {
    contractorId: tester,
    title: 'Wartung der Aufzüge',
    startsOn: daysAhead(-1000),
    endsOn: daysAhead(-1000 + 364),
    renewalMonths: 12,
    noticeAmount: 3,
    noticeUnit: 'months',
    responseTime: '4 Stunden bei Personeneinschluss, sonst 24 Stunden',
    price: '4.800 € netto im Jahr',
    note: 'Notdienst rund um die Uhr über die Leitstelle.',
  })
  const register = await read<{
    assets: readonly { id: string; name: string; buildingId: string }[]
  }>(address, '/assets?limit=200')
  const elevator = register.assets.find((asset) => asset.name === 'Aufzug Haus A')

  if (elevator !== undefined) {
    await send(address, `/contracts/${lifts.id}/items`, { buildingId: elevator.buildingId })
  }

  await plantDocument(
    address,
    { contractId: lifts.id },
    {
      title: 'Wartungsvertrag Aufzüge',
      versions: [{ fileName: 'wartungsvertrag-aufzuege.pdf', words: 'Wartungsvertrag' }],
    },
  )
  await send(address, '/contracts', {
    contractorId: laboratory,
    title: 'Untersuchung des Trinkwassers',
    startsOn: daysAhead(-500),
    price: 'nach Aufwand, Preisliste 2026',
  })

  const ended = await send(address, '/contracts', {
    contractorId: tester,
    title: 'Elektroprüfung 2025',
    startsOn: daysAhead(-400),
    endsOn: daysAhead(-30),
    noticeAmount: 6,
    noticeUnit: 'weeks',
  })
  const ofTheTester = await read<{ duties: readonly { id: string }[] }>(
    address,
    `/duties/register?contractorId=${encodeURIComponent(tester)}&offset=0&limit=1`,
  )
  const named = ofTheTester.duties[0]

  if (named !== undefined) {
    await send(address, `/duties/${named.id}`, { contractId: ended.id }, 'PATCH')
  }
}

/**
 * The stores of the sample operator (#325), as the board "Lager" draws them:
 * two stores, articles with and without a barcode, two suppliers, the
 * minimums of the main store, receipts and a count with its reason, so that
 * three articles stand below their minimum.
 */
async function plantSampleStores(address: string): Promise<void> {
  const main = await send(address, '/stores', {
    name: 'Hauptlager Betriebshof',
    location: 'Betriebshof, Halle 2',
  })

  await send(address, '/stores', {
    name: 'Werkstatt Schulzentrum',
    location: 'Schulhaus, Raum U.03',
  })

  const wholesaler = await send(address, '/suppliers', {
    name: 'Elektro-Großhandel Beispiel GmbH',
    customerNumber: '10458',
    email: 'bestellung@elektro-beispiel.example',
    phone: '0621 123456',
  })

  await send(address, '/suppliers', {
    name: 'Filtertechnik Süd',
    email: 'service@filter-sued.example',
  })

  // Number, designation, barcode, unit, price in cents, stock and minimum.
  const stock: readonly (readonly [
    string,
    string,
    string | null,
    string,
    number | null,
    number,
    number | null,
  ])[] = [
    ['A-1001', 'LED-Röhre T8 18 W, 4000 K', '4006381333931', 'piece', 640, 24, 20],
    ['A-1002', 'Akku Notleuchte 3,6 V 1,6 Ah', null, 'piece', 890, 3, 10],
    ['A-1010', 'Leitungsschutzschalter B16', null, 'piece', 315, 12, 6],
    ['A-1011', 'FI-Schutzschalter 40 A 30 mA', null, 'piece', 4200, 1, 2],
    ['A-1020', 'Mantelleitung NYM-J 3×1,5', null, 'metre', 98, 85.5, 50],
    ['A-1030', 'Taschenfilter G4 592×592', null, 'piece', 1150, 0, 8],
    ['A-1040', 'Kugelhahn DN 20', null, 'piece', null, 4, null],
  ]

  for (const [number, designation, ean, unit, priceCents, level, minimum] of stock) {
    const article = await send(address, '/articles', { number, designation, ean, unit, priceCents })

    await send(
      address,
      `/stores/${main.id}/movements`,
      level > 0
        ? {
            articleId: article.id,
            kind: 'receipt',
            quantityMilli: Math.round(level * 1000),
            supplierId: wholesaler.id,
            reason: 'Lieferschein 4690-11',
          }
        : {
            articleId: article.id,
            kind: 'count',
            quantityMilli: 0,
            reason: 'Inventur, Regal leer',
          },
    )

    if (minimum !== null) {
      await send(
        address,
        `/stores/${main.id}/articles/${article.id}/minimum`,
        { minimumMilli: minimum * 1000 },
        'PUT',
      )
    }

    // Where it lies in the main store (#385); the ball valve has no place written down yet.
    const bin = bins[number]

    if (bin !== undefined) {
      await send(address, `/stores/${main.id}/articles/${article.id}/bin`, { bin }, 'PUT')
    }
  }
}

/** Where the articles lie in the main store of the preview (#385). */
const bins: Readonly<Record<string, string>> = {
  'A-1001': 'Regal 1, Fach 2',
  'A-1002': 'Schrank Notlicht',
  'A-1010': 'Regal 3, Fach 1',
  'A-1011': 'Regal 3, Fach 1',
  'A-1020': 'Kabeltrommel 2',
  'A-1030': 'Regal 5',
}

/** What an asset supplies, kept until every building of its property is there to be named. */
interface Supplying {
  readonly assetId: string
  readonly buildings: readonly string[]
}

/** The report of an examiner a sample duty was met with, on a day. */
interface SampleReport {
  readonly dutyId: string
  readonly performedOn: string
  readonly result?: 'failed'
  readonly voidedBecause?: string
  /** The day of the evidence of the same duty this one corrects. */
  readonly corrects?: string
}

/**
 * A work order of the sample operator (#117): what it is, who leads it, who
 * else works on it, and how far it goes. Signed is what a device sends, and
 * the preview writes the signature behind the routes; the acceptance, the
 * rejection and the check of its defect go through their routes.
 */
interface SampleOrder {
  readonly title: string
  readonly leads: string
  readonly kind?: WorkOrderKind
  readonly urgency?: WorkOrderUrgency
  readonly participants?: readonly string[]
  readonly goes?: 'signed' | 'accepted' | 'checked' | 'rejected'
  /** The firm of the list that carries it out (#330), by its name. */
  readonly firm?: string
}

/** A work order made by hand at a property of the sample operator, by its name. */
interface SampleOrderByHand extends SampleOrder {
  readonly property: string
}

/**
 * What the list "Aufträge" is looked at with beside the orders of the
 * defects: one at once, for a fault that holds up the running of the
 * kitchen, and one turned back at its acceptance.
 */
const sampleOrdersByHand: readonly SampleOrderByHand[] = [
  {
    property: 'Schulzentrum Am Lindenhain',
    title: 'Heizkessel Mensa entlüften',
    leads: 'preview-wendt',
    participants: ['preview-roth'],
    kind: 'fault',
    urgency: 'immediate',
  },
  {
    property: 'Werkhof Nord',
    title: 'Fensterflügel Werkstatt einstellen',
    leads: 'preview-vogt',
    participants: ['preview-yilmaz'],
    kind: 'other',
    goes: 'rejected',
  },
  // A firm of the list at work (#330): its people are briefed on site and a
  // permit for the hot work is issued before it begins.
  {
    property: 'Schulzentrum Am Lindenhain',
    title: 'Undichte Lötstelle am Heizungsrücklauf instand setzen',
    leads: 'preview-wendt',
    kind: 'other',
    firm: 'Heizungsbau Beispiel GmbH',
  },
]

/** A work order the planting made, with how far it is to go and the defect it came of. */
export interface PlantedOrder {
  readonly activityId: string
  readonly leads: string
  readonly goes: NonNullable<SampleOrder['goes']>
  readonly defectId: string | null
}

/**
 * What no route writes and the preview writes behind them once the planting
 * is done (`sample-standings.ts`): the signature under a work order, which a
 * device sends, and the labels of a sheet. What follows a signature goes
 * through the routes again (`decideSampleOrders`).
 */
export interface BehindTheRoutes {
  readonly orders: PlantedOrder[]
  /** The fault reports the viewer is to see among the own (#331). */
  readonly faults: readonly string[]
  /** The orders a firm of the list carries out, briefed and with a permit on a device (#330). */
  readonly visits: { readonly activityId: string; readonly leads: string }[]
  /** Labels of a sheet printed for a property, which hang on nothing yet. */
  readonly sheets: { readonly propertyId: string; readonly labels: number }[]
}

/**
 * What the planting collects on its way: the reports of the duties, sent
 * through their route once every duty is there, and what goes behind the
 * routes.
 */
interface PlantedStandings extends BehindTheRoutes {
  readonly evidence: SampleReport[]
}

/**
 * The evidence of the sample duties as the office enters it (#110): the
 * report of an examiner from outside through the route of a report, with a
 * sample PDF as its file, in the order the work was done, so that the numbers
 * run with the days. One duty has evidence that does not simply count (#101):
 * a test that failed, a correction through the route of a correction, after
 * the evidence it corrects whatever day it names, and an evidence declared
 * invalid through its own route. Each report files its PDF as a certificate
 * at the asset or the room of its duty, as every report does.
 */
async function sendSampleReports(address: string, reports: readonly SampleReport[]): Promise<void> {
  const bytes = samplePdf('Prüfbericht der Prüfdienst Beispiel GmbH')
  const sha256 = await storeSampleFile(address, bytes, 'application/pdf')
  const byDay = [...reports].sort(
    (left, right) =>
      Number(left.corrects !== undefined) - Number(right.corrects !== undefined) ||
      left.performedOn.localeCompare(right.performedOn),
  )
  const written = new Map<string, string>()
  const keyOf = (dutyId: string, performedOn: string) => `${dutyId} ${performedOn}`

  for (const report of byDay) {
    const replaced =
      report.corrects === undefined ? undefined : written.get(keyOf(report.dutyId, report.corrects))

    if (report.corrects !== undefined && replaced === undefined) {
      throw new Error(
        `Die Beispieldaten berichtigen einen Nachweis vom ${report.corrects}, den es nicht gibt.`,
      )
    }

    const said = {
      performedOn: report.performedOn,
      result: report.result ?? 'without_defects',
      resultReason: null,
      examiner: 'Erika Beispiel',
      examinerOrganisation: 'Prüfdienst Beispiel GmbH',
    }
    const { id } =
      replaced === undefined
        ? await send(address, `/duties/${report.dutyId}/report`, {
            ...said,
            file: {
              sha256,
              fileName: `Prüfbericht ${report.performedOn}.pdf`,
              sizeBytes: bytes.length,
              previewSha256: null,
            },
            defects: [],
          })
        : await send(address, `/evidence/${replaced}/correction`, {
            ...said,
            reason: 'Im Bericht steht ein anderer Tag.',
          })

    written.set(keyOf(report.dutyId, report.performedOn), id)

    if (report.voidedBecause !== undefined) {
      await send(address, `/evidence/${id}/voiding`, { reason: report.voidedBecause })
    }
  }
}

/**
 * A duty at an asset or a room, confirmed through the route as whoever keeps
 * the register would, and ended through its route where it has ended.
 */
async function plantDuty(
  address: string,
  target: { readonly assetId: string } | { readonly roomId: string },
  duty: SampleDuty,
  standings: PlantedStandings,
  documents: ReadonlyMap<string, string> = new Map(),
): Promise<void> {
  const {
    metDaysAgo = [],
    kind,
    label,
    basis = 'manufacturer',
    sourceNote = 'Betriebsanleitung des Herstellers',
    task = 'maintenance',
    intervalMonths,
    responsible,
    performer,
    performerNote,
    endedDaysAgo,
    alsoRecorded = [],
    intervalDocument,
  } = duty
  const intervalDocumentId =
    intervalDocument === undefined ? undefined : documents.get(intervalDocument)
  const made = await send(address, '/duties', {
    ...target,
    intervalMonths,
    ...(kind === undefined ? { label, basis, sourceNote, task } : { kind }),
    ...(responsible === undefined ? {} : { responsibleUserId: responsible }),
    ...(performer === undefined ? {} : { performer }),
    // A note that names a firm of the list names the firm (#328).
    ...(performerNote === undefined
      ? {}
      : sampleFirms.has(performerNote)
        ? { contractorId: sampleFirms.get(performerNote) }
        : { performerNote }),
    ...(intervalDocumentId === undefined ? {} : { intervalDocumentId }),
  })

  for (const days of metDaysAgo) {
    standings.evidence.push({ dutyId: made.id, performedOn: daysAhead(-days) })
  }

  for (const { daysAgo, result, voidedBecause, correctsDaysAgo } of alsoRecorded) {
    standings.evidence.push({
      dutyId: made.id,
      performedOn: daysAhead(-daysAgo),
      ...(result === undefined ? {} : { result }),
      ...(voidedBecause === undefined ? {} : { voidedBecause }),
      ...(correctsDaysAgo === undefined ? {} : { corrects: daysAhead(-correctsDaysAgo) }),
    })
  }

  if (endedDaysAgo !== undefined) {
    await send(address, `/duties/${made.id}/end`, {
      endsOn: daysAhead(-endedDaysAgo),
      endReason: 'Der Zähler wurde getauscht.',
    })
  }
}

async function plantAsset(
  address: string,
  path: string,
  propertyId: string,
  asset: SampleAsset,
  rooms: ReadonlyMap<string, string>,
  supplying: Supplying[],
  standings: PlantedStandings,
): Promise<void> {
  const {
    components = [],
    room,
    lifecycle = [],
    supplies = [],
    duties = [],
    dismissed = [],
    documents = [],
    defects = [],
    label,
    exchanged,
    ...fields
  } = asset
  const roomId = room === undefined ? undefined : rooms.get(room)
  const created = await send(address, path, {
    ...fields,
    ...(asset.meterNumber === undefined ? {} : { meterUnit: 'cubic_metres' }),
    ...(roomId === undefined ? {} : { roomId }),
  })

  for (const entry of [{ state: 'in_service', validFrom: inServiceSince }, ...lifecycle]) {
    await send(address, `/assets/${created.id}/lifecycle`, entry)
  }

  if (supplies.length > 0) {
    supplying.push({ assetId: created.id, buildings: supplies })
  }

  // The documents first: a duty may point at one that bears its interval
  // (#74), and a later version of it is laid over once the duties stand.
  const filed = new Map<string, string>()

  for (const document of documents) {
    filed.set(
      document.title,
      await plantDocument(address, { propertyId, assetId: created.id }, document),
    )
  }

  for (const duty of duties) {
    await plantDuty(address, { assetId: created.id }, duty, standings, filed)
  }

  for (const document of documents) {
    await layLaterVersions(address, filed.get(document.title) ?? '', document)
  }

  for (const { kind, reason } of dismissed) {
    await send(address, '/duty-dismissals', { assetId: created.id, kind, reason })
  }

  for (const { description, foundDaysAgo, defectClass, order } of defects) {
    const reported = await send(address, '/defects', {
      assetId: created.id,
      description,
      foundOn: daysAhead(-foundDaysAgo),
      ...(defectClass === undefined ? {} : { defectClass }),
    })

    if (order !== undefined) {
      await plantOrder(address, standings, order, { origin: 'defect', defectId: reported.id })
    }
  }

  // Made as the office makes one, at the route that draws its code (#98).
  if (label !== undefined) {
    const made = await send(address, `/assets/${created.id}/labels`, {})

    if (label === 'blocked') {
      await send(address, `/assets/${created.id}/labels/${made.id}/block`, {})
    }
  }

  for (const component of components) {
    await plantAsset(
      address,
      `/assets/${created.id}/components`,
      propertyId,
      component,
      rooms,
      supplying,
      standings,
    )
  }

  // Last, at the route of the exchange: what was planted at the old asset
  // ends with it, as it does in the office.
  if (exchanged !== undefined) {
    await send(address, `/assets/${created.id}/exchange`, {
      on: daysAhead(-exchanged.daysAgo),
      asset: { kind: asset.kind, ...exchanged.successor },
    })
  }
}

/** How many labels of a sheet wait at each sample property, to be given to an asset on site (#99). */
export const sheetLabelsPerProperty = 4

/**
 * Plants the sample operator through the routes of the preview at `address`,
 * as whoever that preview answers as, which has to be somebody who sees every
 * area and keeps the places: the Leitung. Hands back what is left to write
 * behind the routes.
 */
export async function plantSampleData(
  address: string,
  areas: ReadonlyMap<PreviewArea, string>,
): Promise<BehindTheRoutes> {
  const standings: PlantedStandings = {
    evidence: [],
    orders: [],
    sheets: [],
    visits: [],
    faults: [],
  }
  const propertyIds = new Map<string, string>()

  // The defaults of the three general classes of defects, which the Leitung
  // sets under "Einstellungen" (#116).
  for (const [key, dueDays] of [
    ['allgemein.dangerous', 1],
    ['allgemein.significant', 14],
    ['allgemein.minor', 90],
  ] as const) {
    await send(address, `/settings/defect-classes/${key}`, { dueDays }, 'PUT')
  }

  // The stores of the operator (#325).
  await plantSampleStores(address)

  // The contractors of the operator (#328), which the duties name before they are planted.
  await plantSampleContractors(address)

  // The mail server of the operator, as the board "E-Mail-Einstellungen"
  // draws it (#126). The connection of the preview takes it and sends nothing.
  await send(
    address,
    '/settings/mail/server',
    {
      host: 'smtp.beispielstadt.example',
      port: null,
      security: 'starttls',
      username: 'haustechnik@beispielstadt.example',
      // Made up at every start: the connection of the preview takes any.
      password: randomUUID(),
      fromAddress: 'haustechnik@beispielstadt.example',
      signature: `Viele Grüße\n{benutzer}\n\n${sampleOperatorName}\nHaustechnik, Am Probehang 4, 00001 Beispielstadt`,
    },
    'PUT',
  )

  for (const property of sampleProperties) {
    const { buildings, area, contacts = [], documents = [], ...fields } = property
    const created = await send(address, '/properties', {
      ...fields,
      federalState: 'DE-BW',
      areaId: areas.get(area),
    })

    propertyIds.set(fields.name, created.id)

    for (const contact of contacts) {
      await send(address, '/contacts', { ...contact, propertyId: created.id })
    }

    for (const document of documents) {
      await plantDocument(address, { propertyId: created.id }, document)
    }

    // A sheet for taking stock, printed for every property: its labels are
    // rows behind the routes, because printing one needs the renderer.
    standings.sheets.push({ propertyId: created.id, labels: sheetLabelsPerProperty })

    const buildingIds = new Map<string, string>()
    const supplying: Supplying[] = []

    for (const building of buildings) {
      const {
        floors,
        assets,
        closures = [],
        documents: buildingDocuments = [],
        ownArea,
        ...buildingFields
      } = building
      const madeBuilding = await send(address, `/properties/${created.id}/buildings`, {
        ...buildingFields,
        ...(ownArea === undefined ? {} : { ownAreaId: areas.get(ownArea) }),
      })
      const rooms = new Map<string, string>()

      buildingIds.set(building.name, madeBuilding.id)

      for (const closure of closures) {
        await send(address, `/buildings/${madeBuilding.id}/closures`, closure)
      }

      for (const document of buildingDocuments) {
        await plantDocument(
          address,
          { propertyId: created.id, buildingId: madeBuilding.id },
          document,
        )
      }

      for (const floor of floors) {
        const madeFloor = await send(address, `/buildings/${madeBuilding.id}/floors`, {
          name: floor.name,
          level: floor.level,
        })

        for (const {
          duties = [],
          documents: roomDocuments = [],
          label: onTheDoor,
          ...room
        } of floor.rooms) {
          const madeRoom = await send(address, `/floors/${madeFloor.id}/rooms`, room)
          rooms.set(room.number, madeRoom.id)

          if (onTheDoor) {
            await send(address, `/rooms/${madeRoom.id}/labels`, {})
          }

          for (const duty of duties) {
            await plantDuty(address, { roomId: madeRoom.id }, duty, standings)
          }

          for (const document of roomDocuments) {
            await plantDocument(address, { propertyId: created.id, roomId: madeRoom.id }, document)
          }
        }
      }

      for (const asset of assets) {
        await plantAsset(
          address,
          `/buildings/${madeBuilding.id}/assets`,
          created.id,
          asset,
          rooms,
          supplying,
          standings,
        )
      }
    }

    // Once every building of the property is there: an asset may supply one
    // that was made after its own.
    for (const { assetId, buildings: names } of supplying) {
      await send(
        address,
        `/assets/${assetId}/supplies`,
        { buildingIds: names.map((name) => buildingIds.get(name)) },
        'PUT',
      )
    }
  }

  // Somebody asked to join, with a role and an area, and somebody who stands
  // in for a colleague, so that "Zugänge" shows both (#84). The link of the
  // invitation is handed back once and kept nowhere: nobody takes it up.
  await send(address, '/staff', {
    ...sampleInvitation,
    additions: { all: false, areaIds: [areas.get(sampleInvitationArea)] },
  })
  await send(address, '/substitutions', sampleSubstitution)
  await sendSampleReports(address, standings.evidence)

  for (const { property, ...order } of sampleOrdersByHand) {
    await plantOrder(address, standings, order, {
      origin: 'hand',
      propertyId: propertyIds.get(property),
    })
  }

  // The contracts with the firms (#329), once the duties and the assets they name are there.
  await plantSampleContracts(address)

  // The fault reports in the inbox, one accepted and one rejected (#331).
  const faults = await plantSampleFaults(address)

  // The safety lights of the school house, taken over from a list (#174).
  await importSampleAssets(address)

  // A kind and fields of the operator's own, and an asset of the kind (#62).
  await plantSampleOwnKinds(address)

  return { orders: standings.orders, sheets: standings.sheets, visits: standings.visits, faults }
}

/** The kind of the operator's own the preview keeps, and its asset (#62). */
export const sampleOwnKind = {
  label: 'Hebeanlage Schmutzwasser',
  costGroup: '410',
  asset: 'Hebeanlage Heizraum',
} as const

/**
 * What the operator added to the catalogue (#62), as the boards of "Katalog"
 * draw it: a lifting station with its flow, its pumps and the documents it
 * expects, one of them in the boiler room of the school house, and a field of
 * its own at the safety lighting of the package Elektro.
 */
async function plantSampleOwnKinds(address: string): Promise<void> {
  const kind = (await send(address, '/own-kinds', {
    label: sampleOwnKind.label,
    costGroup: sampleOwnKind.costGroup,
  })) as { id: string; key: string }
  const { key } = kind

  await send(address, '/own-kinds/fields', {
    assetKind: key,
    label: 'Fördermenge',
    sort: 'number',
    unit: 'm³/h',
  })
  await send(address, '/own-kinds/fields', {
    assetKind: key,
    label: 'Pumpen',
    sort: 'choice',
    options: ['Einzelanlage', 'Doppelanlage'],
  })
  await send(address, '/own-kinds/fields', {
    assetKind: key,
    label: 'Rückstauebene geprüft',
    sort: 'flag',
  })
  await send(
    address,
    `/own-kinds/${kind.id}`,
    {
      expectedDocuments: [
        { label: 'Betriebsanleitung', kind: 'operating_manual', demand: 'recommended' },
        {
          label: 'Wartungsnachweis nach Herstellervorgabe',
          kind: 'test_certificate',
          demand: 'required',
          source: 'DIN EN 12056-4, Abschnitt 8',
        },
      ],
    },
    'PATCH',
  )
  await send(address, '/own-kinds/fields', {
    assetKind: 'elektro.safety_lighting',
    label: 'Standortnummer im Plan',
    sort: 'text',
  })

  const properties = await read<{ id: string; name: string }[]>(address, '/properties')
  const school = properties.find((property) => property.name === 'Schulzentrum Am Lindenhain')
  const buildings = await read<{ id: string; name: string }[]>(
    address,
    `/properties/${String(school?.id)}/buildings`,
  )
  const house = buildings.find((building) => building.name === 'Schulhaus')
  const made = await send(address, `/buildings/${String(house?.id)}/assets`, {
    kind: key,
    name: sampleOwnKind.asset,
    values: { eigen_foerdermenge: 12, eigen_pumpen: 'o2' },
  })

  await send(address, `/assets/${made.id}/lifecycle`, {
    state: 'in_service',
    validFrom: inServiceSince,
  })
}

/** The file the safety lights of the school house come from, as its page names it (#174). */
export const sampleImportFile = 'bestand-schulzentrum.xlsx'

/** The lights the import makes, by name. */
export const sampleImportedAssets = [
  'Sicherheitsleuchte Flur Erdgeschoss',
  'Sicherheitsleuchte Heizraum',
  'Sicherheitsleuchte Treppenhaus',
] as const

/**
 * The safety lights of the school house in the south (#174), as the board
 * "Ein Import und was er angelegt hat" draws an import: taken over from a
 * list, the way an operator brings its stock, after everything else, so that
 * they draw the last numbers. Their log begins with the import, and its page
 * lists them. The word of the list is kept as the kind it means, as the
 * second step of the import keeps it.
 */
async function importSampleAssets(address: string): Promise<void> {
  await send(
    address,
    '/imports/asset-kinds',
    { names: [{ name: 'Sicherheitsbeleuchtung', kind: 'elektro.safety_lighting' }] },
    'PUT',
  )

  const sheet: TableSheet = {
    name: 'Anlagen',
    rows: [
      ['Liegenschaft', 'Gebäude', 'Raum', 'Anlagenart', 'Bezeichnung'],
      ...sampleImportedAssets.map((name) => [
        'Schulzentrum Am Lindenhain',
        'Schulhaus',
        name.endsWith('Heizraum') ? 'E.14' : '',
        'Sicherheitsbeleuchtung',
        name,
      ]),
    ],
  }
  const listed = { sheet, mapping: suggestedMapping(tableColumns(sheet), assetImportFields) }
  const asTable = (path: string, body: unknown) =>
    fetch(`${address}${path}`, {
      method: 'POST',
      headers: { 'content-type': tableBodyType },
      body: JSON.stringify(body),
    })
  const preview = await asTable('/imports/assets/preview', listed)

  if (!preview.ok) {
    throw new Error(`Die Vorschau des Imports lehnte ab: ${await preview.text()}`)
  }

  const { counts } = (await preview.json()) as { counts: unknown }
  const taken = await asTable('/imports/assets', {
    ...listed,
    fileName: sampleImportFile,
    expected: counts,
  })

  if (!taken.ok) {
    throw new Error(`Der Import lehnte ab: ${await taken.text()}`)
  }

  // In service since the same day as every other sample asset, entered afterwards at each of them.
  const { id } = (await taken.json()) as { id: string }
  const { records } = await read<{ records: readonly { id: string }[] }>(
    address,
    `/imports/${id}/made`,
  )

  for (const asset of records) {
    await send(address, `/assets/${asset.id}/lifecycle`, {
      state: 'in_service',
      validFrom: inServiceSince,
    })
  }
}

/**
 * The fault reports of the sample operator (#331), as the boards "Störungen"
 * draw them: two of the same cold radiator in the inbox, a running cistern
 * accepted as a work order, and a jammed window rejected with the reason. All
 * at the school house in the south, through the routes, by the Leitung; who
 * reported three of them is the viewer afterwards (`giveSampleFaults`).
 */
async function plantSampleFaults(address: string): Promise<string[]> {
  // The label of a room takes a report without an account (#332), to be seen
  // in a preview started with `PREVIEW_SIGNED_OUT=1`.
  await send(address, '/settings/fault-reports', { openByLabel: true }, 'PUT')

  const categories = await read<FaultCategory[]>(address, '/fault-reports/categories')
  const places = await read<FaultPlaceChoice[]>(address, '/fault-reports/places')
  const school = places.find(
    (each) => each.property === 'Schulzentrum Am Lindenhain' && each.building === 'Schulhaus',
  )
  const [first, second] = school?.rooms ?? []

  if (school === undefined || first === undefined || second === undefined) {
    throw new Error('Das Schulhaus der Beispieldaten hat keine zwei Räume für die Störmeldungen.')
  }

  const report = (category: string, description: string, place: Record<string, string>) =>
    send(address, '/fault-reports', {
      categoryId: categories.find((each) => each.name === category)?.id,
      description,
      ...place,
    })
  const cold = await report(
    'Heizung und Lüftung',
    'Heizkörper bleibt kalt, auch wenn das Thermostat ganz aufgedreht ist.',
    { roomId: first.id },
  )

  await report('Heizung und Lüftung', 'Raum kalt, Heizung aus?', { roomId: first.id })

  const cistern = await report(
    'Sanitär',
    'Spülung im WC läuft ständig nach, man hört es im ganzen Flur.',
    { roomId: second.id },
  )
  const window = await report('Sonstiges', 'Fenster im Treppenhaus klemmt.', {
    buildingId: school.buildingId,
  })

  await send(address, '/work-orders', {
    origin: 'fault',
    faultReportId: cistern.id,
    title: `Sanitär, ${second.name}`,
    kind: 'fault',
    urgency: 'normal',
    dueOn: daysAhead(1),
    responsibleUserId: 'preview-wendt',
    participantUserIds: [],
  })
  await send(address, `/fault-reports/${window.id}/reject`, {
    reason: 'Fenster gehören zum Bauunterhalt der Stadt, bitte dem Hochbauamt melden.',
  })

  return [cold.id, cistern.id, window.id]
}

/**
 * A work order through its route, as whoever plans makes one (#117), due in
 * a week, and kept with how far it is to go.
 */
async function plantOrder(
  address: string,
  standings: PlantedStandings,
  order: SampleOrder,
  origin: Readonly<Record<string, unknown>>,
): Promise<void> {
  const made = await send(address, '/work-orders', {
    ...origin,
    title: order.title,
    kind: order.kind ?? 'defect_remedy',
    // Another kind chooses its basic measure after DIN 31051 (#333): adjusting a window is a repair.
    ...(order.kind === 'other' ? { measure: 'repair' } : {}),
    urgency: order.urgency ?? 'normal',
    dueOn: daysAhead(7),
    responsibleUserId: order.leads,
    participantUserIds: order.participants ?? [],
    ...(order.firm === undefined ? {} : { contractorId: sampleFirms.get(order.firm) }),
  })

  if (order.firm !== undefined) {
    standings.visits.push({ activityId: made.id, leads: order.leads })
  }

  if (order.goes !== undefined) {
    standings.orders.push({
      activityId: made.id,
      leads: order.leads,
      goes: order.goes,
      defectId: typeof origin['defectId'] === 'string' ? origin['defectId'] : null,
    })
  }
}

/**
 * What follows the signature of a sample order, through the routes (#117):
 * the acceptance, after which the defect of the order is checked again, and
 * a rejection with its reason.
 */
export async function decideSampleOrders(
  address: string,
  orders: readonly PlantedOrder[],
): Promise<void> {
  for (const order of orders) {
    if (order.goes === 'accepted' || order.goes === 'checked') {
      await send(address, `/work-orders/${order.activityId}/decision`, { decision: 'accepted' })
    }

    if (order.goes === 'rejected') {
      await send(address, `/work-orders/${order.activityId}/decision`, {
        decision: 'rejected',
        reason: 'Der Flügel schleift unten noch am Rahmen.',
      })
    }

    if (order.goes === 'checked' && order.defectId !== null) {
      await send(address, `/defects/${order.defectId}/check`, {
        outcome: 'verified',
        checkedOn: daysAhead(0),
        note: 'Bei der Nachprüfung in Ordnung.',
      })
    }
  }
}

/**
 * Two of the inspections the engine made of the due days, planned through
 * the route as whoever plans would (#105): one in the south for Tobias Wendt,
 * who works there, with the Objektleitung of the south answering for it, and
 * another one for a contractor named in words, whose day has passed without
 * its report (#122). A third is closed as not performed, with the reason, and
 * its duty gets a new one by hand (#183). The rest stay as the engine made
 * them, with nobody performing them yet.
 */
export async function planSampleActivities(
  address: string,
  areas: ReadonlyMap<PreviewArea, string>,
): Promise<void> {
  const { activities } = await read<{
    readonly activities: readonly {
      readonly id: string
      readonly propertyId: string
      readonly areaId: string
      readonly dueOn: string | null
      readonly responsible: { readonly userId: string } | null
    }[]
  }>(address, '/activities?limit=200')
  const south = areas.get('Süd')
  const forWendt = activities.find((activity) => activity.areaId === south)
  const forContractor = activities.find((activity) => activity.id !== forWendt?.id)

  if (forWendt) {
    await send(
      address,
      `/activities/${forWendt.id}/plan`,
      {
        responsibleUserId: 'preview-roth',
        performer: 'own_staff',
        performerUserId: 'preview-wendt',
        contractorNote: null,
        dueOn: forWendt.dueOn ?? daysAhead(14),
      },
      'PUT',
    )
  }

  if (forContractor) {
    await send(
      address,
      `/activities/${forContractor.id}/plan`,
      {
        responsibleUserId: forContractor.responsible?.userId ?? null,
        performer: 'contractor',
        performerUserId: null,
        contractorNote: 'Brandschutz Beispiel GmbH',
        // Three days ago, and no report yet: "Nachweis fehlt" on the overview (#122).
        dueOn: daysAhead(-3),
      },
      'PUT',
    )
  }

  const toClose = activities.find(
    (activity) => activity.id !== forWendt?.id && activity.id !== forContractor?.id,
  )

  if (toClose) {
    const { duties } = await read<{ readonly duties: readonly { readonly dutyId: string }[] }>(
      address,
      `/activities/${toClose.id}`,
    )

    await send(address, `/activities/${toClose.id}/close`, {
      closingReason: 'Der Raum war wegen eines Wasserschadens gesperrt.',
    })

    for (const { dutyId } of duties) {
      await send(address, '/activities', { dutyId })
    }
  }

  await composeSampleCollective(address, activities)
}

/**
 * A collective activity (#342), composed through the route as whoever plans
 * would: on the first property with two duties of one kind that are free to
 * take, all of them, given to nobody, so that every device of the area holds it.
 */
async function composeSampleCollective(
  address: string,
  activities: readonly { readonly propertyId?: string }[],
): Promise<void> {
  const propertyIds = [
    ...new Set(
      activities.flatMap((activity) => (activity.propertyId ? [activity.propertyId] : [])),
    ),
  ]

  for (const propertyId of propertyIds) {
    const { kinds } = await read<CollectiveCandidates>(
      address,
      `/collectives/candidates?property=${propertyId}`,
    )

    for (const kind of kinds.filter((each) => each.duties >= 2)) {
      const { candidates } = await read<CollectiveCandidates>(
        address,
        `/collectives/candidates?property=${propertyId}&kind=${encodeURIComponent(kind.key)}`,
      )
      const free = candidates.filter(mayBecomeAPart)

      if (free.length < 2) {
        continue
      }

      const { name } = await read<{ readonly name: string }>(address, `/properties/${propertyId}`)

      await send(address, '/collectives', {
        dutyKind: kind.key,
        propertyId,
        buildingId: null,
        roomId: null,
        title: collectiveTitle(kind.label, name),
        dutyIds: free.map((each) => each.dutyId),
        // Given to nobody, so that every device that sees the area holds it.
        responsibleUserId: null,
        performer: 'own_staff',
        performerUserId: null,
        contractorNote: null,
        contractorId: null,
        dueOn:
          free
            .map((each) => each.appointment)
            .filter((day) => day !== null)
            .sort()[0] ?? daysAhead(7),
      })

      return
    }
  }
}
