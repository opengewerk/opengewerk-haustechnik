import type { Right } from './rights.js'

/**
 * Push messages to the devices of the people of an operator (#126, section 3
 * of the concept), beside the mail a deadline reminds with.
 *
 * An occasion is something that happened anyway: a deadline came within its
 * lead, an activity went to somebody, a work order was sent back, a round or
 * a work order waits for the second signature, a task falls due. Push adds
 * nothing of its own to raise. Each person switches off under "Konto" what
 * they do not want as push, and every occasion is on until they do. The one
 * thing nobody switches off is a work order of the urgency "sofort": it
 * reaches whoever leads it whatever they chose (section 4.8).
 *
 * In the order the account lists them.
 */
export const pushOccasions = [
  'deadline_due',
  'assigned',
  'task_due',
  'waiting',
  'work_order_rejected',
  'fault_received',
  'fault_answered',
] as const

export type PushOccasion = (typeof pushOccasions)[number]

export function isPushOccasion(value: unknown): value is PushOccasion {
  return typeof value === 'string' && (pushOccasions as readonly string[]).includes(value)
}

/**
 * How an occasion is named and explained where a person switches it on or
 * off, and the right without which it never concerns a person (#398): the
 * account offers it only to whoever holds that right. A Melder is asked about
 * its own reports and nothing else, and nobody who may not accept faults is
 * asked about a fault received.
 */
export const pushOccasionWords: Readonly<
  Record<PushOccasion, { readonly label: string; readonly about: string; readonly right: Right }>
> = {
  // A deadline reminds whoever is responsible for its duty.
  deadline_due: {
    label: 'Fristen',
    about: 'Wenn eine Frist, für die Sie verantwortlich sind, erinnert.',
    right: 'duty.read',
  },
  assigned: {
    label: 'Zuteilungen',
    about: 'Wenn Ihnen ein Rundgang, eine Prüfung oder ein Auftrag zugeteilt wird.',
    right: 'activity.perform',
  },
  task_due: {
    label: 'Fällige Aufgaben',
    about: 'Am Morgen des Tages, an dem eine Aufgabe für Sie fällig ist.',
    right: 'task.read',
  },
  // Whoever leads a work order, or accepts in the area of a round.
  waiting: {
    label: 'Wartet auf Gegenzeichnung oder Abnahme',
    about: 'Wenn ein Rundgang oder ein Auftrag in Ihren Bereichen auf Sie wartet.',
    right: 'activity.read',
  },
  work_order_rejected: {
    label: 'Zurückgewiesene Aufträge',
    about: 'Wenn ein Auftrag, den Sie unterschrieben haben, zurückgewiesen wird.',
    right: 'activity.perform',
  },
  // The two occasions of the fault reports (#331, sections 3 and 4.7 of the concept).
  fault_received: {
    label: 'Eingegangene Störungen',
    about: 'Wenn in einem Bereich, in dem Sie Störungen annehmen, eine Störung gemeldet wird.',
    right: 'fault.accept',
  },
  fault_answered: {
    label: 'Ihre Störmeldungen',
    about: 'Wenn eine Störung, die Sie gemeldet haben, angenommen oder erledigt ist.',
    right: 'fault.report',
  },
}

/** Where a device opens the application: in the office or on site. */
export const pushEntries = ['office', 'site'] as const

export type PushEntry = (typeof pushEntries)[number]
