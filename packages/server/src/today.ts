import type { IsoDate } from '@opengewerk/haustechnik-domain'

/**
 * The day it is in Germany at a moment. A date in this application, the first
 * day of a life cycle or the day an asset kind is looked up for, means the day
 * in Germany, whatever time zone the server runs in.
 */
const germany = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' })

export function dayInGermany(moment: Date = new Date()): IsoDate {
  return germany.format(moment)
}

/** The year it is in Germany at a moment, which a number drawn then carries. */
export function yearInGermany(moment: Date): number {
  return Number(dayInGermany(moment).slice(0, 4))
}
