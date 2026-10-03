import type { RecordWords } from '@opengewerk/platform-web'

/**
 * What the screens of the conflicts say about a record of this application
 * (ADR 0010 in the repository opengewerk): what a kind of record and its
 * fields are called, the name a record goes by, and how a value is written.
 *
 * No record of this application travels yet (#27), so there is nothing to
 * name: a conflict that arrives anyway, from a newer server, shows the raw
 * names, which the foundation does where an application knows none. The
 * names come with the records, each with its policy.
 */
export const records: RecordWords = {
  entityLabel: (entity) => entity,
  fieldLabel: (field) => field,
  titleOf: (entity) => entity,
  valueText: () => null,
  settledElsewhere: {},
}
