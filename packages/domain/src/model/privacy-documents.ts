import type { Id, TenantOwned } from '@opengewerk/platform-domain'

/**
 * The three documents on data protection an operator makes besides the
 * description of the processing (#358): the record of the processing, the
 * technical and organisational measures and the deletion concept. Made by the
 * Leitung under "Einstellungen", "Datenschutz", each kept with its day.
 */
export const privacyDocumentKinds = ['record', 'measures', 'deletion'] as const

export type PrivacyDocumentKind = (typeof privacyDocumentKinds)[number]

export function isPrivacyDocumentKind(value: string): value is PrivacyDocumentKind {
  return (privacyDocumentKinds as readonly string[]).includes(value)
}

/** The words of each kind: its title, and what the list of the made ones calls it. */
export const privacyDocumentWords: Readonly<
  Record<PrivacyDocumentKind, { readonly title: string; readonly short: string }>
> = {
  record: { title: 'Verzeichnis der Verarbeitungstätigkeiten', short: 'Verzeichnis' },
  measures: { title: 'Technische und organisatorische Maßnahmen', short: 'Maßnahmen' },
  deletion: { title: 'Löschkonzept', short: 'Löschkonzept' },
}

/** One document made, as the list of the made ones shows it. */
export interface PrivacyDocumentVersion {
  readonly id: string
  readonly kind: PrivacyDocumentKind
  /** ISO 8601. */
  readonly madeAt: string
  /** Who made it, by name, or null for an account that is gone. */
  readonly madeBy: string | null
  readonly holdsFor: string | null
  /** The sections that differ from the one of its kind before, or null for the first. */
  readonly changed: readonly string[] | null
}

/** What the screen shows of each kind, and every document made, newest first. */
export interface PrivacyDocuments {
  readonly kinds: readonly {
    readonly kind: PrivacyDocumentKind
    readonly facts: readonly { readonly label: string; readonly value: string }[]
    /** The sections a document made now would change, or null while there is none of the kind. */
    readonly changedSinceNewest: readonly string[] | null
  }[]
  readonly versions: readonly PrivacyDocumentVersion[]
}

export type PrivacyDocumentId = Id<'privacy-document'>
export type ProcessingRecordSettingId = Id<'processing-record-setting'>
export type ProcessingRecordActivityId = Id<'processing-record-activity'>

/** A document the Leitung made, as the table holds it; `createdAt` is the moment it was made. */
export interface PrivacyDocument extends TenantOwned {
  readonly id: PrivacyDocumentId
  readonly kind: string
  readonly madeBy: string
  readonly holdsFor: string | null
  readonly text: string
  /** The sections that differ from the one of its kind before, null for the first. */
  readonly changed: string[] | null
}

/** Who is responsible and the data protection officer, one row per operator that wrote them. */
export interface ProcessingRecordSetting extends TenantOwned {
  readonly id: ProcessingRecordSettingId
  readonly controller: string | null
  readonly officer: string | null
}

/** What the Leitung wrote for one activity of the record. */
export interface ProcessingRecordActivity extends TenantOwned {
  readonly id: ProcessingRecordActivityId
  readonly activity: string
  readonly purpose: string | null
  readonly legalBasis: string | null
  readonly recipients: string | null
}
