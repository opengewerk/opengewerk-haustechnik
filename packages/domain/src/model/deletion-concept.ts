import { membershipRemovalDays } from './membership-end.js'
import { plainInMarkdown } from './processing-description.js'
import { type DeletionRuleKey, holdsForInWords } from './processing-record.js'
import {
  type RecordRetentionKind,
  type RecordRetentionSettings,
  recordRetentionYearsOf,
} from './record-retention.js'
import { closedActivitiesStayDays } from './sync.js'

/**
 * The deletion concept (#358, sections 3 and 9 of the concept): which data
 * the application deletes or empties, and when, out of its own rules (#340,
 * #356 and what the foundation brings) and the settings of the operator; and
 * what it keeps. The rules are numbered in the order they stand here, "L1",
 * and the record of the processing names them by those numbers.
 *
 * That no deletion is left out is held by `deletion-concept.test.ts` in the
 * server: every place in the server and in the foundation that deletes a row
 * of the database is given to a rule here, or named as a removal by hand.
 */

/** What the rules take from the operator and the instance. */
export interface DeletionFacts {
  /** The years every evidence stays at least, or none beyond the rule of its kind (#340). */
  readonly minimumYears: number | null
  /** The years of what hangs on no evidence that the operator set, null per kind for the law (#412). */
  readonly recordYears: RecordRetentionSettings | null
  /** The days after the last day of an access before its data goes (#356). */
  readonly removalDays: number
  /** How long a session holds, and one of a device registered for the sync, from the foundation. */
  readonly sessionHours: number
  readonly deviceDays: number
  /** How long a closed activity stays on a device. */
  readonly deviceStoreDays: number
  /** How long after a signature the reply address of a report without an account stays at most. */
  readonly outsideAnswerDays: number
  /** The generations of backups, as whoever runs the instance wrote them in part B, or null. */
  readonly backupGenerations: string | null
}

export interface DeletionRule {
  readonly key: DeletionRuleKey
  /** Which data. */
  readonly data: string
  /** When they go. */
  readonly when: string
  /** What the operator sets for it, or "nein". */
  readonly setting: string
  /** The proofs out of annex A of the description of the processing. */
  readonly proofs: readonly string[]
}

function count(value: number, one: string, many: string): string {
  return `${String(value)} ${value === 1 ? one : many}`
}

/** The years of a kind that count for the operator, in words. */
function years(facts: DeletionFacts, kind: RecordRetentionKind): string {
  return count(recordRetentionYearsOf(facts.recordYears, kind), 'Jahr', 'Jahre')
}

/** The rules in their order, with what the operator and the instance set. */
export function deletionRules(facts: DeletionFacts): readonly DeletionRule[] {
  return [
    {
      key: 'evidence',
      data: 'Ein Nachweis mit seinen Antworten, Messwerten, Unterschriften, dem Schriftzug, seinem PDF, den höher signierten PDFs und der Prüfbescheinigung eines Berichts',
      when: `nach Ablauf der Aufbewahrung, die seine Pflichtart nennt (Jahre, bis zur nächsten Prüfung oder solange die Anlage in Gebrauch ist)${facts.minimumYears === null ? '' : `, frühestens nach ${count(facts.minimumYears, 'Jahr', 'Jahren')}`}. Die Anwendung schlägt das Leeren vor, die Leitung bestätigt es; es bleibt eine leere Hülle mit Nummer und Tag.`,
      setting: 'Mindestjahre unter „Aufbewahrung“',
      proofs: ['B357', 'B358', 'B359', 'B361'],
    },
    {
      key: 'emptied-activity',
      data: 'Der Vorgang hinter einem Nachweis, mit Unterschrift, Namen und Dokumenten',
      when: 'mit seinem letzten Nachweis',
      setting: 'nein',
      proofs: ['B368', 'B369'],
    },
    {
      key: 'activity-without-evidence',
      data: 'Ein Vorgang ohne Nachweis, mit Antworten, Unterschriften, Namen, Notizen und Dokumenten',
      when: `${years(facts, 'activity')} ab dem Ende des Jahres, in dem er erledigt oder als nicht durchgeführt geschlossen wurde. Die Anwendung schlägt das Leeren vor, die Leitung bestätigt es; es bleibt eine leere Hülle mit Art, Ort, Tag und Stand.`,
      setting: 'Jahre unter „Aufbewahrung“',
      proofs: ['B442', 'B444', 'B445', 'B457'],
    },
    {
      key: 'remedied-defect',
      data: 'Beschreibung, Bemerkung der Nachprüfung und Fotos eines behobenen Mangels',
      when: `${years(facts, 'defect')} nach der Beseitigung. Die Anwendung schlägt es vor, die Leitung bestätigt es; die Zeile des Mangels bleibt.`,
      setting: 'Jahre unter „Aufbewahrung“',
      proofs: ['B448', 'B449'],
    },
    {
      key: 'done-task',
      data: 'Eine erledigte Aufgabe',
      when: `${years(facts, 'task')} nach ihrer Erledigung, mit dem Fristenlauf`,
      setting: 'Jahre unter „Aufbewahrung“',
      proofs: ['B452', 'B453'],
    },
    {
      key: 'person-at-record',
      data: 'Wer einen Zählerstand abgelesen, im Lager gebucht oder Material am Auftrag entnommen hat',
      when: `${years(facts, 'reading_person')} nach der Ablesung, ${years(facts, 'booking_person')} nach Buchung oder Entnahme, mit dem Fristenlauf; Stand, Buchung und Entnahme bleiben`,
      setting: 'Jahre unter „Aufbewahrung“',
      proofs: ['B454', 'B455'],
    },
    {
      key: 'access-data',
      data: 'Die Geräte, Passkeys und Push-Geräte einer Person; wo ihr Konto für keinen anderen Betreiber mehr arbeitet, auch Adresse, zweiter Faktor, Passwort und Anmeldungen. Der Name bleibt bei dem, was sie unterschrieben hat.',
      when: `${count(facts.removalDays, 'Tag', 'Tage')} nach dem letzten Tag ihres Zugangs`,
      setting: 'Tage unter „Zugänge“',
      proofs: ['B392', 'B393'],
    },
    {
      key: 'outside-answer',
      data: 'Die Adresse für die Antwort an einen Melder ohne Konto',
      when: `wenn die Meldung abgelehnt ist, mit der Nachricht, dass sie erledigt ist, oder ${count(facts.outsideAnswerDays, 'Tag', 'Tage')} nach der Unterschrift, wenn keine Nachricht hinausging`,
      setting: 'nein',
      proofs: ['B434', 'B435'],
    },
    {
      key: 'sessions',
      data: 'Eine Sitzung',
      when: `beim Abmelden, wenn die Person oder die Leitung ein Gerät abmeldet und wenn der Zugang gesperrt wird. Sitzungen ohne zweiten Faktor enden außerdem, sobald sich das Konto, das eine Authenticator-App hat, mit zweitem Faktor anmeldet, etwa beim Einrichten der App. Eine Sitzung gilt ${count(facts.sessionHours, 'Stunde', 'Stunden')}, ein Gerät für den Abgleich ${count(facts.deviceDays, 'Tag', 'Tage')}.`,
      setting: 'nein',
      proofs: ['B47', 'B49', 'B51', 'B44'],
    },
    {
      key: 'push-subscription',
      data: 'Ein Gerät für Push',
      when: 'wenn die Person Push dort abschaltet oder sich abmeldet, und wenn der Push-Dienst das Gerät nicht mehr kennt',
      setting: 'nein',
      proofs: ['B234', 'B248'],
    },
    {
      key: 'substitution',
      data: 'Eine Vertretung, die vor ihrem letzten Tag endet',
      when: 'sofort; das Änderungsprotokoll behält sie',
      setting: 'nein',
      proofs: ['B436'],
    },
    {
      key: 'password-link',
      data: 'Ein offener Link zu einem neuen Passwort',
      when: 'wenn sich die Adresse des Kontos ändert; sonst gilt er eine Stunde',
      setting: 'nein',
      proofs: ['B437', 'B438'],
    },
    {
      key: 'device-store',
      data: 'Was auf einem Gerät liegt',
      when: `ein abgeschlossener Vorgang und eine erledigte Aufgabe nach ${count(facts.deviceStoreDays, 'Tag', 'Tagen')}, was die Person nicht mehr sieht beim nächsten Abgleich, alles beim Abmelden`,
      setting: 'nein',
      proofs: ['B23', 'B19', 'B58'],
    },
    {
      key: 'backups',
      data: 'Eine Sicherung der Instanz',
      when:
        facts.backupGenerations === null
          ? 'wenn die Zahl der Generationen erreicht ist, die die Instanz aufbewahrt; nach der Vorgabe vierzehn'
          : `wenn ${facts.backupGenerations} Generationen erreicht sind, laut Verwaltung der Instanz (Teil B der Maßnahmen)`,
      setting: 'bei der Verwaltung der Instanz',
      proofs: ['B64'],
    },
  ]
}

/** The number of each rule by its key, "L1", in the order the rules stand. */
export function deletionRuleNumbers(): Readonly<Record<DeletionRuleKey, string>> {
  const numbers = {} as Record<DeletionRuleKey, string>

  for (const [index, rule] of deletionRules(defaultDeletionFacts).entries()) {
    numbers[rule.key] = `L${String(index + 1)}`
  }

  return numbers
}

/**
 * What the rules say before anything is set: no minimum years, the standard
 * days, no part B. The hours of a session and the days of an answer are the
 * ones of the foundation and the server, which `deletionFactsOf` reads there.
 */
export const defaultDeletionFacts: DeletionFacts = {
  minimumYears: null,
  recordYears: null,
  removalDays: membershipRemovalDays.standard,
  sessionHours: 12,
  deviceDays: 30,
  deviceStoreDays: closedActivitiesStayDays,
  outsideAnswerDays: 2,
  backupGenerations: null,
}

/** What the application keeps as long as the instance is there, and why. */
export const keptData: readonly { readonly data: string; readonly why: string }[] = [
  {
    data: 'Das Änderungsprotokoll',
    why: 'Es wird nur ergänzt, damit es Nachweise belegt. Einen einzelnen Wert schwärzt die Leitung, mit Grund; die Kette bleibt dabei ganz.',
  },
  {
    data: 'Zugehörigkeiten, Einladungen, Anmeldungen und Abmeldungen',
    why: 'Sie belegen, wer wann Zugang hatte. Nach dem Ende eines Zugangs gehen seine Angaben nach Regel {access-data}, der Name bleibt.',
  },
  {
    data: 'Die Zeile eines Mangels, Zählerstände und Buchungen im Lager',
    why: 'Sie gehören zur Anlage und zum Bestand. Inhalt und Fotos eines behobenen Mangels gehen nach Regel {remedied-defect}, wer abgelesen oder gebucht hat, nach Regel {person-at-record}.',
  },
  {
    data: 'Störmeldungen',
    why: 'Die Meldung bleibt; die Adresse eines Melders ohne Konto geht nach Regel {outside-answer}.',
  },
  {
    data: 'Das Protokoll der Zugriffe eines Prüfers',
    why: 'Wie lange es bleibt, sagt das Planungskonzept noch nicht.',
  },
  {
    data: 'Dokumente mit ihren Fassungen, Ansprechpartner, Fremdfirmen und was sonst jemand entfernt',
    why: 'Was jemand entfernt, wird als entfernt markiert und nicht gelöscht; die Datei eines Dokuments bleibt im Dateispeicher.',
  },
  {
    data: 'Die Zeile eines Imports',
    why: 'Sie nennt die Datei, die Zahl ihrer Zeilen und das Ergebnis; die Datei selbst wird nicht gespeichert.',
  },
  {
    data: 'Pflichtenübertragungen und Qualifikationen',
    why: 'Eine widerrufene Übertragung bleibt lesbar, eine herausgenommene Qualifikation bleibt im Änderungsprotokoll.',
  },
  {
    data: 'Erzeugte Verfahrensbeschreibungen und Dokumente zum Datenschutz',
    why: 'Jede Fassung bleibt mit ihrem Tag.',
  },
]

/** For whom and when the deletion concept is made. */
export interface DeletionMade {
  readonly operator: string
  readonly at: string
  readonly holdsFor: string | null
  readonly facts: DeletionFacts
}

/**
 * A cell of the table as plain text: what whoever runs the instance wrote, the
 * generations of the backups, comes in unescaped and is escaped here whole, a
 * backslash and a bar of a table included, like every value of an operator.
 */
function cell(value: string): string {
  return plainInMarkdown(value)
}

/** The deletion concept as Markdown, as the PDF prints it and as it is kept. */
export function describeDeletion(made: DeletionMade): string {
  const rules = deletionRules(made.facts)
  const numbers = deletionRuleNumbers()
  const named = (text: string) =>
    text.replace(/\{([a-z-]+)\}/g, (_, key: string) => numbers[key as DeletionRuleKey])

  return [
    `# Löschkonzept für ${plainInMarkdown(made.operator)}`,
    '',
    `- **Gilt für:** ${holdsForInWords(made.holdsFor)}`,
    `- **Erzeugt:** am ${made.at} für ${plainInMarkdown(made.operator)}`,
    '',
    '---',
    '',
    '## 1. Was dieses Dokument ist',
    '',
    'Welche personenbezogenen Daten OpenGewerk Haustechnik wann löscht oder leert, und was sie aufbewahrt. Die Regeln kommen aus der Anwendung selbst, die Fristen aus dem, was bei diesem Betreiber eingestellt ist, und für die Sicherungen aus dem, was die Verwaltung der Instanz eingetragen hat. Jede Regel nennt ihre Belege aus Anhang A der Verfahrensbeschreibung. Das Verzeichnis der Verarbeitungstätigkeiten verweist je Tätigkeit auf diese Regeln.',
    '',
    '## 2. Was gelöscht oder geleert wird',
    '',
    '| Nr. | Daten | Wann | Einstellbar | Belege |',
    '|---|---|---|---|---|',
    ...rules.map(
      (rule) =>
        `| ${numbers[rule.key]} | ${cell(rule.data)} | ${cell(rule.when)} | ${cell(rule.setting)} | ${rule.proofs.join(', ')} |`,
    ),
    '',
    'Einstellungen und Zuordnungen, die keine Angaben über eine Person sind, löscht, wer sie pflegt: Bereiche und ihre Zuordnung, eigene Rollen, Positionen eines Vertrags, Begriffe einer Mängelklasse, den Entwurf einer Pflichtenübertragung, die Beschränkungen eines Prüfers, den Mailserver des Betreibers und eine abgeschaltete Art von Push. Das Änderungsprotokoll behält, was es war.',
    '',
    '## 3. Was aufbewahrt wird',
    '',
    ...keptData.map((entry) => `- **${entry.data}:** ${named(entry.why)}`),
    '',
  ].join('\n')
}
