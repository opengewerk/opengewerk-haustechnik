import {
  addDays,
  type CatalogueBundle,
  type CatalogueReview,
  catalogueOf,
  type IsoDate,
  reviewMarks,
} from '@opengewerk/haustechnik-domain'

import { type EntryFolder, entryNoun } from './paths.js'

// The reminder of the checks against the sources (section 5 of the concept,
// #95): "Liegt die Prüfung länger als ein Jahr zurück, ist der Eintrag
// gekennzeichnet, und ein geplanter Lauf erinnert daran." The run asks
// `reviewMarks`, the same reading as the marks on the screens, a few weeks
// ahead, so that the reminder comes before the mark. One issue holds every
// entry that is due; the next run brings it up to date instead of opening a
// second one.

/** How many days before an entry is marked the reminder comes. */
export const reminderLead = 30

/** The title of the one issue the run keeps. */
export const reminderTitle = 'Katalog: Prüfung gegen die Quelle fällig'

/** An entry whose check against its source is due, and where its date of the check is kept. */
export interface DueReview {
  readonly packageName: string
  /** What it is, as a reader is told: "die Pflichtart pflichten/elevator_main_test.v1.json". */
  readonly what: string
  readonly checkedOn: IsoDate
}

/** The open issues of the repository, as far as the run needs them. */
export interface OpenIssue {
  readonly number: number
  readonly title: string
}

export type ReminderAction =
  | { readonly kind: 'none' }
  | { readonly kind: 'create'; readonly title: string; readonly body: string }
  | {
      readonly kind: 'update'
      readonly number: number
      readonly title: string
      readonly body: string
    }

const folderOf = {
  assetKinds: 'anlagenarten',
  dutyKinds: 'pflichten',
  forms: 'formulare',
  roundTemplates: 'vorlagen',
} as const satisfies Readonly<Record<string, EntryFolder>>

/**
 * The entries of the packages as they are in force today whose check is due
 * within the lead, the earliest check first: the version in force of every
 * key, every rule that has not ended, every class of defects.
 */
export function dueReviews(bundle: CatalogueBundle, today: IsoDate): readonly DueReview[] {
  const ahead = addDays(today, reminderLead)
  const due = (review: CatalogueReview) => reviewMarks(review, ahead).checkedLongAgo
  const found: DueReview[] = []

  for (const contents of catalogueOf(bundle).contents(today)) {
    // As `abnahmen.json` of the package names it, without the name of the package.
    const local = (key: string) => key.slice(contents.name.length + 1)
    const add = (what: string, review: CatalogueReview) => {
      if (due(review)) {
        found.push({ packageName: contents.name, what, checkedOn: review.checkedOn })
      }
    }

    for (const kind of ['assetKinds', 'dutyKinds', 'forms', 'roundTemplates'] as const) {
      const folder = folderOf[kind]

      for (const entry of contents[kind]) {
        add(
          `${entryNoun[folder]} ${folder}/${local(entry.key)}.v${String(entry.version)}.json`,
          entry.review,
        )
      }
    }

    for (const rule of contents.rules) {
      const { key, scope, validFrom, validUntil } = rule.record

      if (validUntil === null || validUntil >= today) {
        add(
          `die Regel ${local(key)}${scope === undefined ? '' : ` für ${scope}`} ab ${validFrom}`,
          rule.review,
        )
      }
    }

    for (const entry of contents.defectClasses) {
      add(`die Mängelklasse ${local(entry.defectClass.key)}`, entry.review)
    }
  }

  return found.sort(
    (left, right) =>
      left.checkedOn.localeCompare(right.checkedOn) ||
      left.packageName.localeCompare(right.packageName) ||
      left.what.localeCompare(right.what),
  )
}

/** The text of the issue: every entry that is due, by package, and what to do. */
export function reminderBody(due: readonly DueReview[], today: IsoDate): string {
  const lines = due.map(
    (entry) =>
      `- [ ] \`${entry.packageName}\`: ${entry.what}, zuletzt geprüft am ${entry.checkedOn}`,
  )

  return [
    `Stand ${today}: Bei diesen Einträgen liegt die Prüfung gegen die Quelle in den nächsten ${String(reminderLead)} Tagen ein Jahr zurück oder schon länger. Danach kennzeichnet die Anwendung sie (Abschnitt 5 des Planungskonzepts).`,
    '',
    ...lines,
    '',
    '## Was zu tun ist',
    '',
    '- Jeden Eintrag gegen seine Fundstelle in der geltenden Fassung prüfen.',
    '- Stimmt er noch, in `abnahmen.json` des Pakets das Datum der Prüfung nachziehen; hat sich die Quelle geändert, eine neue Fassung anlegen.',
    '',
    'Angelegt und fortgeschrieben vom Workflow "Katalog prüfen lassen".',
  ].join('\n')
}

/**
 * What the run does: nothing without a due entry; otherwise the open issue
 * of its title is brought up to date, and only without one a new one is
 * opened.
 */
export function planReminder(
  due: readonly DueReview[],
  today: IsoDate,
  open: readonly OpenIssue[],
): ReminderAction {
  if (due.length === 0) {
    return { kind: 'none' }
  }

  const body = reminderBody(due, today)
  const existing = open.find((issue) => issue.title === reminderTitle)

  return existing === undefined
    ? { kind: 'create', title: reminderTitle, body }
    : { kind: 'update', number: existing.number, title: reminderTitle, body }
}
