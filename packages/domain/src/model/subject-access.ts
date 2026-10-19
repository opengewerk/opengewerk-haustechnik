/**
 * The information about a person (#355, section 3 of the concept): what the
 * application holds about one person, from every module, as a file to read
 * and a machine-readable one. The Leitung makes it (decided on 15.10.2026),
 * for a person with an access by the access, for one without by a search for
 * a name or an address (decided on 19.10.2026). Evidence stands in it with
 * its number, day, duty, place, what the person did and their drawing; the
 * answers and the measured values belong to the asset and stay out.
 *
 * The parts here say what the file holds; the server reads their rows. Every
 * field of appendix B of the description of the processing, a column that
 * points at a person, is the source of exactly one part, which a test holds.
 * Nothing in a part names another person: a substitution says when, not who
 * else, and an evidence what this person did, not who signed beside them.
 */

/** How a value of a column reads in the file to read; the machine-readable file keeps it as it is. */
export const subjectAccessColumnKinds = [
  'text',
  'day',
  'moment',
  'flag',
  'number',
  'drawing',
] as const

export type SubjectAccessColumnKind = (typeof subjectAccessColumnKinds)[number]

export interface SubjectAccessColumn {
  /** The key of the value in a row, English as every field name. */
  readonly key: string
  readonly label: string
  readonly kind: SubjectAccessColumnKind
}

export type SubjectAccessValue = string | number | boolean | null

/** One part as the file holds it: what one module holds about the person, a row each. */
export interface SubjectAccessPart {
  readonly key: SubjectAccessPartKey
  readonly title: string
  readonly note: string | null
  readonly columns: readonly SubjectAccessColumn[]
  readonly rows: readonly Readonly<Record<string, SubjectAccessValue>>[]
}

/** Whom an information is about: an access of this operator, or what a search for a name or an address found. */
export type SubjectAccessAbout =
  | { readonly kind: 'account'; readonly name: string; readonly email: string }
  | { readonly kind: 'search'; readonly term: string }

/** The whole information, as the machine-readable file holds it. */
export interface SubjectAccess {
  readonly format: typeof subjectAccessFormat
  readonly version: 1
  readonly operator: string
  /** ISO 8601. */
  readonly madeAt: string
  readonly about: SubjectAccessAbout
  readonly parts: readonly SubjectAccessPart[]
}

/** The name of the machine-readable format, so that a reader knows the file. */
export const subjectAccessFormat = 'opengewerk-haustechnik-subject-access'

const column = (key: string, label: string, kind: SubjectAccessColumnKind = 'text') =>
  ({ key, label, kind }) as const satisfies SubjectAccessColumn

/** What the person did or was, the column most parts share. */
const what = column('what', 'Was')
const place = column('place', 'Ort')

/**
 * A part as it is defined: its title, a sentence under it, its columns, the
 * fields of appendix B it reads (`table.field`), and whether the file to read
 * prints it; a part that is not printed stands in the machine-readable file
 * only, and another part sums it up for print.
 */
export interface SubjectAccessPartDefinition {
  readonly title: string
  readonly note: string | null
  readonly columns: readonly SubjectAccessColumn[]
  readonly sources: readonly string[]
  readonly printed: boolean
}

/** The parts of the information about a person with an access, in the order of the file. */
export const subjectAccessParts = {
  account: {
    title: 'Konto',
    note: 'Ein Passwort und ein zweiter Faktor stehen nur als Hash; die Auskunft sagt, ob sie eingerichtet sind.',
    columns: [
      column('name', 'Name'),
      column('email', 'E-Mail-Adresse'),
      column('password', 'Passwort gesetzt', 'flag'),
      column('secondFactor', 'Zweiter Faktor', 'flag'),
    ],
    sources: ['auth_accounts.user_id', 'auth_two_factors.user_id'],
    printed: true,
  },
  passkeys: {
    title: 'Passkeys',
    note: null,
    columns: [
      column('name', 'Name'),
      column('createdAt', 'Angelegt', 'moment'),
      column('lastUsedAt', 'Zuletzt benutzt', 'moment'),
      column('here', 'Gilt bei diesem Betreiber', 'flag'),
    ],
    sources: ['auth_passkeys.user_id', 'member_passkeys.user_id'],
    printed: true,
  },
  corrections: {
    title: 'Berichtigte Angaben',
    note: 'Name und E-Mail-Adresse, wie sie vor und nach einer Berichtigung standen.',
    columns: [
      column('at', 'Zeitpunkt', 'moment'),
      column('nameBefore', 'Name vorher'),
      column('nameAfter', 'Name nachher'),
      column('emailBefore', 'E-Mail-Adresse vorher'),
      column('emailAfter', 'E-Mail-Adresse nachher'),
    ],
    sources: ['account_corrections.user_id'],
    printed: true,
  },
  membership: {
    title: 'Zugang bei diesem Betreiber',
    note: null,
    columns: [
      column('roles', 'Rollen'),
      column('since', 'Seit', 'moment'),
      column('lastDay', 'Letzter Tag', 'day'),
      column('blockedAt', 'Gesperrt seit', 'moment'),
      column('areas', 'Bereiche'),
      column('limits', 'Beschränkt auf'),
      column('removedAt', 'Angaben entfernt am', 'moment'),
    ],
    sources: [
      'memberships.user_id',
      'member_areas.user_id',
      'member_all_areas.user_id',
      'member_limit_properties.user_id',
      'member_limit_asset_kinds.user_id',
      'membership_removals.user_id',
    ],
    printed: true,
  },
  substitutions: {
    title: 'Vertretungen',
    note: 'Wer vertritt oder vertreten wird, nennt die Auskunft nicht: das ist eine Angabe über eine andere Person.',
    columns: [what, column('startsOn', 'Von', 'day'), column('endsOn', 'Bis', 'day')],
    sources: ['substitutions.absent_user_id', 'substitutions.substitute_user_id'],
    printed: true,
  },
  sessions: {
    title: 'Sitzungen und Anmeldungen',
    note: 'Die Sitzungen bei diesem Betreiber, die noch gelten, und jede An- und Abmeldung hier.',
    columns: [
      what,
      column('at', 'Zeitpunkt', 'moment'),
      column('until', 'Bis', 'moment'),
      column('device', 'Gerät'),
      column('address', 'IP-Adresse'),
      column('method', 'Weg der Anmeldung'),
    ],
    sources: ['auth_sessions.user_id', 'tenant_sessions.user_id'],
    printed: true,
  },
  push: {
    title: 'Benachrichtigungen',
    note: null,
    columns: [what, column('label', 'Gerät oder Anlass')],
    sources: ['push_subscriptions.user_id', 'push_opt_outs.user_id'],
    printed: true,
  },
  duties: {
    title: 'Pflichten',
    note: null,
    columns: [column('duty', 'Pflicht'), place, what, column('on', 'Am', 'moment')],
    sources: ['duties.responsible_user_id', 'duties.confirmed_by', 'duty_dismissals.dismissed_by'],
    printed: true,
  },
  deadlines: {
    title: 'Fristen',
    note: null,
    columns: [
      column('deadline', 'Frist'),
      column('dueOn', 'Fällig', 'day'),
      what,
      column('status', 'Stand'),
    ],
    sources: [
      'deadlines.responsible_user_id',
      'deadlines.natural_user_id',
      'deadlines.closed_by',
      'deadlines.member_user_id',
      'deadline_settings.responsible_user_id',
    ],
    printed: true,
  },
  tasks: {
    title: 'Aufgaben',
    note: null,
    columns: [
      column('task', 'Aufgabe'),
      column('dueOn', 'Fällig', 'day'),
      what,
      column('status', 'Stand'),
    ],
    sources: ['tasks.assignee_user_id', 'tasks.created_by'],
    printed: true,
  },
  activities: {
    title: 'Vorgänge und Rundgänge',
    note: null,
    columns: [column('activity', 'Vorgang'), place, column('on', 'Tag', 'day'), what],
    sources: [
      'activities.responsible_user_id',
      'activities.performer_user_id',
      'round_plans.performer_user_id',
    ],
    printed: true,
  },
  evidence: {
    title: 'Nachweise',
    note: 'Nachweise, an denen die Person beteiligt war, mit ihrem Schriftzug, wo sie unterschrieben hat. Antworten und Messwerte gehören zur Anlage und stehen nicht hier.',
    columns: [
      column('number', 'Nummer'),
      column('day', 'Tag', 'day'),
      column('duty', 'Pflicht'),
      place,
      what,
      column('drawing', 'Schriftzug', 'drawing'),
    ],
    sources: [
      'evidence.performed_by',
      'evidence.written_by',
      'activity_signatures.signed_by',
      'evidence_voidings.voided_by',
      'evidence_emptyings.confirmed_by',
      'evidence_signed_prints.filed_by',
    ],
    printed: true,
  },
  delegations: {
    title: 'Pflichtenübertragungen',
    note: null,
    columns: [
      what,
      column('startsOn', 'Von', 'day'),
      column('endsOn', 'Bis', 'day'),
      column('at', 'Am', 'moment'),
      column('drawing', 'Schriftzug', 'drawing'),
    ],
    sources: [
      'duty_delegations.delegate_user_id',
      'duty_delegation_signatures.signed_by',
      'duty_delegation_revocations.revoked_by',
    ],
    printed: true,
  },
  workOrders: {
    title: 'Aufträge',
    note: 'Was die Person an einem Auftrag getan hat. Wer auf ihrem Gerät unterschrieben hat, ein Auftraggeber oder eine Person einer Fremdfirma, steht nicht hier.',
    columns: [
      column('order', 'Auftrag'),
      what,
      column('at', 'Am', 'moment'),
      column('text', 'Text'),
    ],
    sources: [
      'work_order_participants.user_id',
      'work_order_decisions.decided_by',
      'work_order_materials.taken_by',
      'work_order_notes.written_by',
      'service_reports.signed_by',
      'briefings.signed_by',
      'work_permits.signed_by',
    ],
    printed: true,
  },
  meters: {
    title: 'Zähler',
    note: 'Wann die Person einen Stand eingetragen oder eine Notiz geschrieben hat; der Stand selbst gehört zur Anlage.',
    columns: [column('meter', 'Zähler'), what, column('on', 'Tag', 'day'), column('text', 'Notiz')],
    sources: ['meter_readings.recorded_by', 'meter_points.note_by'],
    printed: true,
  },
  stock: {
    title: 'Lager',
    note: null,
    columns: [column('article', 'Artikel'), what, column('at', 'Am', 'moment')],
    sources: ['stock_movements.booked_by'],
    printed: true,
  },
  faults: {
    title: 'Störmeldungen',
    note: null,
    columns: [
      column('at', 'Gemeldet', 'moment'),
      place,
      column('text', 'Meldung'),
      column('status', 'Stand'),
    ],
    sources: ['fault_reports.reported_by'],
    printed: true,
  },
  qualifications: {
    title: 'Qualifikationen',
    note: null,
    columns: [
      column('qualification', 'Qualifikation'),
      column('validUntil', 'Gültig bis', 'day'),
      column('text', 'Notiz'),
    ],
    sources: ['qualifications.user_id'],
    printed: true,
  },
  documents: {
    title: 'Abgelegte Dateien',
    note: null,
    columns: [
      column('document', 'Dokument'),
      column('file', 'Datei'),
      column('at', 'Abgelegt', 'moment'),
    ],
    sources: ['attachment_versions.created_by'],
    printed: true,
  },
  auditorReads: {
    title: 'Zugriffe als Prüfer von außen',
    note: null,
    columns: [column('at', 'Zeitpunkt', 'moment'), column('route', 'Was')],
    sources: ['auditor_reads.user_id'],
    printed: true,
  },
  invitations: {
    title: 'Einladungen und E-Mails',
    note: 'Dass die Person jemanden eingeladen oder eine E-Mail angestoßen hat; an wen, nennt die Auskunft nicht.',
    columns: [what, column('at', 'Am', 'moment')],
    sources: ['invitations.invited_by', 'mail_outbox.requested_by'],
    printed: true,
  },
  instance: {
    title: 'Verwaltung der Instanz',
    note: null,
    columns: [
      what,
      column('at', 'Am', 'moment'),
      column('record', 'Datensatz'),
      column('field', 'Feld'),
    ],
    sources: ['instance_operators.user_id', 'instance_changes.user_id'],
    printed: true,
  },
  processingDescriptions: {
    title: 'Erzeugte Verfahrensbeschreibungen',
    note: null,
    columns: [column('at', 'Erzeugt', 'moment')],
    sources: ['processing_descriptions.made_by'],
    printed: true,
  },
  // The record, the measures and the deletion concept the person made (#358).
  privacyDocuments: {
    title: 'Erzeugte Dokumente zum Datenschutz',
    note: null,
    columns: [column('what', 'Dokument'), column('at', 'Erzeugt', 'moment')],
    sources: ['privacy_documents.made_by'],
    printed: true,
  },
  log: {
    title: 'Änderungsprotokoll',
    note: 'Jede Änderung, die die Person gemacht hat, Feld für Feld, ohne die Werte: sie gehören zum Datensatz.',
    columns: [
      column('at', 'Zeitpunkt', 'moment'),
      column('record', 'Art'),
      column('recordId', 'Datensatz'),
      column('field', 'Feld'),
      what,
    ],
    sources: ['audit_entries.user_id', 'audit_redactions.redacted_by'],
    printed: false,
  },
  logSummary: {
    title: 'Änderungsprotokoll',
    note: 'Die einzelnen Änderungen stehen in der maschinenlesbaren Datei.',
    columns: [
      column('record', 'Art'),
      column('count', 'Änderungen', 'number'),
      column('first', 'Erste', 'moment'),
      column('last', 'Letzte', 'moment'),
    ],
    sources: [],
    printed: true,
  },
  lastChanges: {
    title: 'Zuletzt geänderte Datensätze',
    note: 'Jeder Datensatz hält fest, wer ihn zuletzt geändert hat.',
    columns: [column('record', 'Art'), column('count', 'Datensätze', 'number')],
    sources: ['*.updated_by'],
    printed: true,
  },
} as const satisfies Readonly<Record<string, SubjectAccessPartDefinition>>

/** The parts of what a search for a name or an address finds about a person without an access. */
export const subjectAccessSearchParts = {
  contacts: {
    title: 'Ansprechpartner',
    note: null,
    columns: [
      column('name', 'Name'),
      column('role', 'Funktion'),
      column('email', 'E-Mail-Adresse'),
      column('phone', 'Telefon'),
      column('where', 'Wo'),
    ],
    sources: ['contacts'],
    printed: true,
  },
  clients: {
    title: 'Unterschrift als Auftraggeber',
    note: null,
    columns: [
      column('name', 'Name'),
      column('order', 'Auftrag'),
      column('at', 'Unterschrieben', 'moment'),
      column('drawing', 'Schriftzug', 'drawing'),
    ],
    sources: ['service_reports'],
    printed: true,
  },
  briefings: {
    title: 'Einweisungen',
    note: null,
    columns: [
      column('name', 'Name'),
      column('subject', 'Worin'),
      column('order', 'Auftrag'),
      column('at', 'Unterschrieben', 'moment'),
      column('drawing', 'Schriftzug', 'drawing'),
    ],
    sources: ['briefings'],
    printed: true,
  },
  permits: {
    title: 'Erlaubnisscheine',
    note: 'Die Angaben eines Erlaubnisscheins, die zur Suche passen.',
    columns: [
      column('order', 'Auftrag'),
      column('at', 'Ausgestellt', 'moment'),
      column('text', 'Angaben'),
    ],
    sources: ['work_permits'],
    printed: true,
  },
  faultAddresses: {
    title: 'Störmeldungen über das Etikett',
    note: 'Die Adresse für die Antwort bleibt, bis die Antwort verschickt ist.',
    columns: [
      column('email', 'E-Mail-Adresse'),
      column('at', 'Gemeldet', 'moment'),
      column('text', 'Meldung'),
    ],
    sources: ['fault_report_contacts'],
    printed: true,
  },
  examiners: {
    title: 'Prüfer eines Berichts von außen',
    note: null,
    columns: [
      column('name', 'Prüfer'),
      column('organisation', 'Organisation'),
      column('number', 'Nachweis'),
      column('day', 'Tag', 'day'),
    ],
    sources: ['evidence.examiner'],
    printed: true,
  },
} as const satisfies Readonly<Record<string, SubjectAccessPartDefinition>>

export type SubjectAccessPartKey =
  keyof typeof subjectAccessParts | keyof typeof subjectAccessSearchParts

/** Every field of appendix B the parts read, `table.field`, each once. */
export function subjectAccessSources(): readonly string[] {
  return Object.values(subjectAccessParts).flatMap((part) => part.sources)
}

/** How short a search may be: three characters find a name, fewer find half the operator. */
export const subjectAccessTermLength = { min: 3, max: 200 } as const

/** Why a search is not one, or null. */
export function subjectAccessTermProblem(term: unknown): string | null {
  if (typeof term !== 'string') {
    return 'Gesucht wird nach einem Namen oder einer E-Mail-Adresse.'
  }

  const trimmed = term.trim()

  return trimmed.length < subjectAccessTermLength.min ||
    trimmed.length > subjectAccessTermLength.max
    ? `Gesucht wird nach mindestens ${String(subjectAccessTermLength.min)} und höchstens ${String(subjectAccessTermLength.max)} Zeichen.`
    : null
}

/** The two files of an information. */
export const subjectAccessFormats = ['pdf', 'json'] as const

export type SubjectAccessFormat = (typeof subjectAccessFormats)[number]

/** One hit of a search, as the screen lists it before the file is made. */
export interface SubjectAccessMatch {
  readonly part: keyof typeof subjectAccessSearchParts
  /** Where it was found, in words. */
  readonly where: string
  readonly name: string | null
  readonly email: string | null
}

/** A person with an access the information can be about. */
export interface SubjectAccessPerson {
  readonly userId: string
  readonly name: string
  readonly email: string
}

/** What the card on the screen needs: whom the information can be about, and whether the asking person sees every area. */
export interface SubjectAccessChoice {
  readonly people: readonly SubjectAccessPerson[]
  readonly everyArea: boolean
}

/** Why the information is refused to a Leitung that does not see every area: it would leave out what lies elsewhere. */
export const subjectAccessNeedsEveryArea =
  'Eine vollständige Auskunft erzeugt nur, wer alle Bereiche sieht.'
