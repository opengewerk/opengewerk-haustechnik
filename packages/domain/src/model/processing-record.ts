import { plainInMarkdown } from './processing-description.js'

/**
 * The record of the processing (#358, sections 3 and 9 of the concept,
 * Art. 30 Abs. 1 DSGVO): what the operator processes with this application,
 * activity by activity. Who is concerned, which data and how long they stay
 * the application knows; the purpose and the legal basis it proposes until the
 * Leitung confirms or changes them on "Einstellungen", "Datenschutz",
 * "Verzeichnis", and the recipients the Leitung writes there (decided on
 * 19.10.2026). Who is responsible and the data protection officer come from
 * there as well.
 *
 * Every activity names the sections of the description of the processing it
 * comes from, and every section 3.x of the description stands in one of them:
 * `processing-record.test.ts` holds both against the template, so that an area
 * of data added to the description is missing from the record no longer than
 * a red test.
 */

/** The rules of the deletion concept an activity points at, by their key. */
export type DeletionRuleKey =
  | 'evidence'
  | 'emptied-activity'
  | 'activity-without-evidence'
  | 'remedied-defect'
  | 'done-task'
  | 'person-at-record'
  | 'access-data'
  | 'sessions'
  | 'password-link'
  | 'outside-answer'
  | 'outside-count'
  | 'push-subscription'
  | 'device-store'
  | 'substitution'
  | 'backups'

export interface ProcessingActivity {
  readonly key: string
  readonly title: string
  /** The sections of the description of the processing, "3.1". */
  readonly sections: readonly string[]
  /** Who is concerned. */
  readonly subjects: string
  /** Which data, in a few words. */
  readonly data: string
  /** The purpose the application proposes. */
  readonly purpose: string
  /** The legal basis the application proposes. */
  readonly legalBasis: string
  /** The rules of the deletion concept for its data; none where nothing goes by a period. */
  readonly deletion: readonly DeletionRuleKey[]
}

export const processingActivities = [
  {
    key: 'accounts',
    title: 'Konten und Anmeldung',
    sections: ['3.1', '3.3'],
    subjects: 'Beschäftigte mit Zugang, Prüfer von außen',
    data: 'Name, E-Mail-Adresse, Passwort als Hash, Passkeys, zweiter Faktor, Sitzungen mit Gerät, Beginn und Netzadresse',
    purpose: 'Anmeldung an der Anwendung und Schutz der Konten vor fremdem Zugriff',
    legalBasis: 'Art. 6 Abs. 1 lit. b DSGVO; Art. 6 Abs. 1 lit. c mit Art. 32 DSGVO',
    deletion: ['sessions', 'password-link', 'access-data'],
  },
  {
    key: 'access',
    title: 'Zugänge, Rollen, Bereiche und Vertretung',
    sections: ['3.2'],
    subjects: 'Beschäftigte mit Zugang, Prüfer von außen',
    data: 'Zugehörigkeit mit Rollen, Bereichen, letztem Tag und Sperre, Vertretungen',
    purpose: 'Festlegen, wer was sehen und tun darf, und einen Zugang beenden',
    legalBasis: 'Art. 6 Abs. 1 lit. b DSGVO; Art. 6 Abs. 1 lit. c mit Art. 32 DSGVO',
    deletion: ['substitution', 'access-data'],
  },
  {
    key: 'work',
    title: 'Planung, Zuteilung und Aufgaben',
    sections: ['3.4', '3.7', '3.14'],
    subjects: 'Beschäftigte',
    data: 'Zuständigkeit für Pflichten, Zuteilung von Vorgängen und Rundgängen, Aufgaben, was ein Gerät nach den Bereichen seiner Person hält',
    purpose: 'Arbeiten an Anlagen planen, verteilen und vor Ort erledigen, auch ohne Netz',
    legalBasis: 'Art. 6 Abs. 1 lit. b DSGVO',
    deletion: ['device-store', 'activity-without-evidence', 'done-task'],
  },
  {
    key: 'evidence',
    title: 'Nachweise und Unterschriften',
    sections: ['3.5'],
    subjects: 'Beschäftigte, Prüfer und Beschäftigte von Fremdfirmen',
    data: 'Wer ausgeführt, eingetragen, unterschrieben und gegengezeichnet hat, Zeitpunkte, eine Angabe zum Gerät, der Schriftzug',
    purpose: 'Nachweisen, dass Prüfungen, Wartungen und Unterweisungen stattgefunden haben',
    legalBasis: 'Art. 6 Abs. 1 lit. c DSGVO, Betreiberpflichten',
    deletion: ['evidence', 'emptied-activity'],
  },
  {
    key: 'records',
    title: 'Änderungsprotokoll und Stempel',
    sections: ['3.6'],
    subjects: 'Beschäftigte',
    data: 'Wer einen Datensatz zuletzt geändert hat, von welchem Gerät und wann; jede Änderung Feld für Feld',
    purpose: 'Nachvollziehbar halten, wer was geändert hat, damit Nachweise unverfälscht bleiben',
    legalBasis: 'Art. 6 Abs. 1 lit. c mit Art. 5 Abs. 2 und Art. 32 DSGVO',
    deletion: [],
  },
  {
    key: 'assets',
    title: 'Unterlagen und Zustand der Anlagen',
    sections: ['3.9', '3.10', '3.11', '3.12', '3.13', '3.16'],
    subjects: 'Beschäftigte',
    data: 'Wer ein Dokument abgelegt, einen Import gemacht, einen Zählerstand eingetragen oder im Lager gebucht hat',
    purpose: 'Dokumente, Etiketten, Mängel, Zählerstände und Material der Anlagen festhalten',
    legalBasis: 'Art. 6 Abs. 1 lit. b DSGVO',
    deletion: ['remedied-defect', 'person-at-record'],
  },
  {
    key: 'third-parties',
    title: 'Ansprechpartner und Fremdfirmen',
    sections: ['3.8'],
    subjects: 'Ansprechpartner an Liegenschaften, Prüfer und Beschäftigte von Fremdfirmen',
    data: 'Vorname, Name, Funktion, E-Mail-Adresse, Telefon- und Mobilnummer; Prüfer und Organisation auf einem Bericht',
    purpose: 'Ansprechpartner und Fremdfirmen erreichen und fremde Prüfungen nachweisen',
    legalBasis: 'Art. 6 Abs. 1 lit. f DSGVO',
    deletion: [],
  },
  {
    key: 'notifications',
    title: 'Benachrichtigungen',
    sections: ['3.15'],
    subjects: 'Beschäftigte',
    data: 'E-Mail-Adresse, die Geräte für Push, was ansteht und der Tag',
    purpose: 'Beschäftigten sagen, was für sie ansteht',
    legalBasis: 'Art. 6 Abs. 1 lit. b DSGVO',
    deletion: ['push-subscription'],
  },
  {
    key: 'fault-reports',
    title: 'Störmeldungen',
    sections: ['3.17'],
    subjects: 'Beschäftigte, Melder ohne Konto',
    data: 'Die Meldung mit Ort und Foto, wer gemeldet hat, die Adresse für die Antwort an einen Melder ohne Konto, für die Grenzen der Seite eines Etiketts der Hashwert seines Anschlusses',
    purpose: 'Störungen aufnehmen, beheben und dem Melder antworten',
    legalBasis: 'Art. 6 Abs. 1 lit. b DSGVO; für Melder ohne Konto Art. 6 Abs. 1 lit. f DSGVO',
    deletion: ['outside-answer', 'outside-count'],
  },
  {
    key: 'delegations',
    title: 'Pflichtenübertragungen',
    sections: ['3.18'],
    subjects: 'Beschäftigte',
    data: 'Die beauftragte Person, Bereiche, Umfang, Aufgaben und Befugnisse, Unterschriften',
    purpose: 'Die Übertragung von Betreiberpflichten schriftlich festhalten',
    legalBasis: 'Art. 6 Abs. 1 lit. c DSGVO',
    deletion: [],
  },
  {
    key: 'qualifications',
    title: 'Qualifikationen',
    sections: ['3.19'],
    subjects: 'Beschäftigte',
    data: 'Art, Gültigkeit, Notiz und auf Wunsch der Nachweis als Datei',
    purpose: 'Nachweisen, dass nur befähigte Personen prüfen',
    legalBasis: 'Art. 6 Abs. 1 lit. c DSGVO',
    deletion: [],
  },
  {
    key: 'auditors',
    title: 'Prüfer von außen',
    sections: ['3.20'],
    subjects: 'Prüfer von außen',
    data: 'Name, E-Mail-Adresse, Zugang mit letztem Tag und Beschränkung, was der Prüfer gelesen hat',
    purpose:
      'Behörden, Versicherern und Prüforganisationen Einsicht in Pflichten und Nachweise geben',
    legalBasis: 'Art. 6 Abs. 1 lit. c DSGVO',
    deletion: ['access-data'],
  },
  {
    key: 'privacy',
    title: 'Datenschutz',
    sections: ['3.21', '3.22'],
    subjects: 'Beschäftigte und Dritte, über die Auskunft verlangt wird',
    data: 'Wer ein Dokument zum Datenschutz erzeugt hat; eine Auskunft wird nicht aufbewahrt',
    purpose: 'Auskunft geben, Verfahren beschreiben und dieses Verzeichnis führen',
    legalBasis: 'Art. 6 Abs. 1 lit. c mit Art. 15 und Art. 30 DSGVO',
    deletion: [],
  },
] as const satisfies readonly ProcessingActivity[]

export type ProcessingActivityKey = (typeof processingActivities)[number]['key']

const activityKeys = new Set<string>(processingActivities.map((activity) => activity.key))

export function isProcessingActivity(key: string): key is ProcessingActivityKey {
  return activityKeys.has(key)
}

/** What the Leitung wrote for one activity. A purpose or a legal basis of null is the proposal. */
export interface ProcessingActivityEntry {
  readonly purpose: string | null
  readonly legalBasis: string | null
  readonly recipients: string | null
}

/** What the Leitung wrote for the whole record. */
export interface ProcessingRecordInputs {
  readonly controller: string | null
  readonly officer: string | null
  readonly activities: Readonly<Partial<Record<ProcessingActivityKey, ProcessingActivityEntry>>>
}

/** One activity as the page of the record shows it, with the proposals and what was written. */
export interface ProcessingActivityView {
  readonly key: ProcessingActivityKey
  readonly title: string
  readonly sections: readonly string[]
  readonly subjects: string
  readonly data: string
  readonly proposedPurpose: string
  readonly proposedLegalBasis: string
  readonly purpose: string | null
  readonly legalBasis: string | null
  readonly recipients: string | null
  /** The numbers of the rules of the deletion concept, "L4". */
  readonly deletion: readonly string[]
}

export interface ProcessingRecordView {
  readonly controller: string | null
  readonly officer: string | null
  readonly activities: readonly ProcessingActivityView[]
}

/** How long a line and a text of the record may be. */
export const recordLimits = { text: 2_000 } as const

/** A text of the Leitung as it is kept: without spaces around it, an empty one as none, or why not. */
export function recordText(
  value: unknown,
  label: string,
): string | null | { readonly problem: string } {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value !== 'string') {
    return { problem: `„${label}“ ist ein Text.` }
  }

  const text = value.replace(/\r\n?/g, '\n').trim()

  if (text.length > recordLimits.text) {
    return {
      problem: `„${label}“: höchstens ${recordLimits.text.toLocaleString('de-DE')} Zeichen.`,
    }
  }

  return text === '' ? null : text
}

/** The version a document holds for, as its head says it, or that there is none released yet. */
export function holdsForInWords(version: string | null): string {
  return version === null ? 'noch keine veröffentlichte Fassung' : `Fassung ${version}`
}

/** For whom and when a record is made, with what the Leitung wrote. */
export interface ProcessingRecordMade {
  readonly operator: string
  readonly at: string
  /** The version, "0.2.0", or null before the first one. */
  readonly holdsFor: string | null
  readonly inputs: ProcessingRecordInputs
  /** The number of each rule of the deletion concept by its key, "L4". */
  readonly ruleNumbers: Readonly<Record<DeletionRuleKey, string>>
}

const unconfirmed = ' (Vorschlag der Anwendung, nicht bestätigt)'

function written(value: string | null): string {
  return value === null ? '' : plainInMarkdown(value)
}

function lines(value: string): string {
  // A line break the Leitung typed stays one in the document.
  return value
    .split('\n')
    .map((line) => plainInMarkdown(line))
    .join(', ')
}

/** The record as Markdown, as the PDF prints it and as it is kept. */
export function describeRecord(made: ProcessingRecordMade): string {
  const { inputs } = made
  const head = [
    `# Verzeichnis der Verarbeitungstätigkeiten für ${plainInMarkdown(made.operator)}`,
    '',
    `- **Gilt für:** ${holdsForInWords(made.holdsFor)}`,
    `- **Erzeugt:** am ${made.at} für ${plainInMarkdown(made.operator)}`,
    '',
    '---',
    '',
    '## 1. Was dieses Verzeichnis ist',
    '',
    'Das Verzeichnis der Verarbeitungstätigkeiten nach Art. 30 Abs. 1 DSGVO für die Verarbeitungen mit OpenGewerk Haustechnik. Betroffene Personen, Daten und Löschung kennt die Anwendung selbst; Zweck, Rechtsgrundlage und Empfänger kommen aus den Angaben der Leitung unter „Einstellungen“, „Datenschutz“. Wo die Leitung einen Vorschlag der Anwendung nicht bestätigt hat, sagt es das Verzeichnis. Verarbeitungen außerhalb der Anwendung stehen nicht darin.',
    '',
    '## 2. Für alle Tätigkeiten',
    '',
    // Here and not in the head: a change of the head is no change of the record (changedSections).
    `- **Verantwortlicher:** ${inputs.controller === null ? 'noch nicht angegeben' : lines(inputs.controller)}`,
    `- **Datenschutzbeauftragter:** ${inputs.officer === null ? 'keiner angegeben' : lines(inputs.officer)}`,
    '- **Übermittlung in ein Drittland:** Die Anwendung übermittelt nichts in ein Drittland. Wo die Instanz läuft und wer für sie arbeitet, steht in den technischen und organisatorischen Maßnahmen, Teil B und Anlage 2.',
    '- **Löschung:** nach dem Löschkonzept; jede Tätigkeit nennt seine Regeln.',
    '- **Sicherheit der Verarbeitung:** nach den technischen und organisatorischen Maßnahmen.',
    '',
    '## 3. Die Tätigkeiten',
  ]
  const activities = processingActivities.flatMap((activity, index) => {
    const entry = inputs.activities[activity.key]
    const purpose = entry?.purpose ?? null
    const legalBasis = entry?.legalBasis ?? null
    const deletion = activity.deletion.map((key) => made.ruleNumbers[key])

    return [
      '',
      `### 3.${String(index + 1)} ${activity.title}`,
      '',
      `- **Zweck:** ${purpose === null ? `${activity.purpose}${unconfirmed}` : written(purpose)}`,
      `- **Rechtsgrundlage:** ${legalBasis === null ? `${activity.legalBasis}${unconfirmed}` : written(legalBasis)}`,
      `- **Betroffene Personen:** ${activity.subjects}`,
      `- **Daten:** ${activity.data}`,
      `- **Empfänger:** ${entry?.recipients ? lines(entry.recipients) : 'keine außerhalb des Betreibers angegeben'}`,
      `- **Löschung:** ${deletion.length === 0 ? 'keine Frist; was bleibt, sagt Abschnitt 3 des Löschkonzepts' : `Regel ${deletion.join(', ')} des Löschkonzepts`}`,
      `- **Beschrieben in:** Abschnitt ${activity.sections.join(', ')} der Verfahrensbeschreibung`,
    ]
  })

  return [...head, ...activities, ''].join('\n')
}
