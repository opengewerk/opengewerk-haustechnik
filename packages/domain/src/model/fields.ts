/**
 * What the checks of the records share: one sentence per field, and the
 * shapes a text or a whole number has to have. The same functions run in the
 * form on a device, in the sync and in a route, so that each says the same
 * sentence about the same mistake.
 */
export type Problems = Record<string, string>

/**
 * A text the record has to have, named by its subject ("Die Bezeichnung").
 * Undefined is a field that was not given, as in a change of other fields,
 * and is not asked about; null or nothing but spaces is a field that was
 * emptied.
 */
export function required(
  problems: Problems,
  record: Readonly<Record<string, unknown>>,
  field: string,
  most: number,
  subject: string,
): void {
  const value = record[field]

  if (value === undefined) {
    return
  }

  if (typeof value !== 'string' || value.trim() === '') {
    problems[field] = `${subject} fehlt.`
  } else if (value.trim().length > most) {
    problems[field] = `${subject} hat höchstens ${String(most)} Zeichen.`
  }
}

/** A text the record may leave empty. */
export function optional(
  problems: Problems,
  record: Readonly<Record<string, unknown>>,
  field: string,
  most: number,
  sentence: string,
): void {
  const value = record[field]

  if (value === undefined || value === null) {
    return
  }

  if (typeof value !== 'string' || value.trim().length > most) {
    problems[field] = sentence
  }
}

export function wholeFromTo(value: unknown, least: number, most: number): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= least && value <= most
}

/** Whether a value is a day of the calendar written in ISO 8601, `2026-10-03` and not `2026-02-30`. */
export function calendarDay(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)

  if (!match) {
    return false
  }

  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)

  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  )
}
