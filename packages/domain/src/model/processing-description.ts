import {
  type DeadlineReminder,
  deadlineReminderLabel,
  type Id,
  type TenantOwned,
} from '@opengewerk/platform-domain'

import { deadlineKinds } from './deadlines.js'
import { defaultFaultReportSettings } from './fault-report.js'
import { membershipRemovalDays } from './membership-end.js'
import { type Right, rightLabel, shippedRoles } from './rights.js'
import { defaultWorkOrderSettings } from './service-report.js'

// The description of the processing as the application makes it (#357,
// section 9 of the concept): a template, written by hand like the description
// before it, and what is switched on and set at one operator. The template
// has four places the application fills: the title, the line "Erzeugt", a
// paragraph of section 1 on how the document came about, and the part "Bei
// diesem Betreiber" at the end of section 2. Everything else is the text of
// the template, the same for every operator. The file in the repository is
// the template with the defaults, for an operator before the installation.

export type ProcessingDescriptionId = Id<'processing-description'>

/** A description the Leitung made, as the table holds it; `createdAt` is the moment it was made. */
export interface ProcessingDescription extends TenantOwned {
  readonly id: ProcessingDescriptionId
  readonly madeBy: string
  readonly holdsFor: string | null
  readonly text: string
  /** The sections that differ from the one before, null for the first. */
  readonly changed: string[] | null
}

/** A role of the operator as the description names it. */
export interface ProcessingRole {
  readonly label: string
  /** One of the roles the application ships, which stays as it is. */
  readonly shipped: boolean
  /** How many accesses hold it, blocked ones included. */
  readonly holders: number
  readonly rights: readonly Right[]
  readonly secondFactor: boolean
}

/** How a kind of deadline reminds at the operator. */
export interface ProcessingReminder {
  readonly kind: string
  readonly leadDays: number
  readonly reminder: DeadlineReminder
}

/** What is switched on and set at one operator, as far as it concerns the people who work for it. */
export interface ProcessingFacts {
  readonly roles: readonly ProcessingRole[]
  /** Names and times of whoever performed a work order on its service report (#324). */
  readonly namesAndTimes: boolean
  /** A label opens the page for reporting a fault without an account (#332). */
  readonly openByLabel: boolean
  /** The years every evidence stays at least, or none beyond the rule (#340). */
  readonly minimumYears: number | null
  /** The days after the last day of an access before its data goes (#356). */
  readonly removalDays: number
  /** Whether the operator set up a mail server; without one no mail goes out. */
  readonly mailServer: boolean
  readonly reminders: readonly ProcessingReminder[]
}

/** For whom and when a description is made. Without it, the description is made with the defaults. */
export interface ProcessingMade {
  readonly operator: string
  /** The moment in the words of Germany, "19.10.2026 um 09:12". */
  readonly at: string
  readonly facts: ProcessingFacts
}

/** The places of the template the application fills, each standing once. */
export const processingPlaces = ['for', 'made', 'how-made', 'at-this-operator'] as const

/** What an operator starts with: the shipped roles, nothing switched on, the leads of the kinds. */
export const defaultProcessingFacts: ProcessingFacts = {
  roles: shippedRoles.map((role) => ({
    label: role.label,
    shipped: true,
    holders: 0,
    rights: role.rights,
    secondFactor: role.secondFactor,
  })),
  namesAndTimes: defaultWorkOrderSettings.namesAndTimes,
  openByLabel: defaultFaultReportSettings.openByLabel,
  minimumYears: null,
  removalDays: membershipRemovalDays.standard,
  mailServer: false,
  reminders: deadlineKinds.map((kind) => ({
    kind: kind.title,
    leadDays: kind.leadDays,
    reminder: 'email_and_push',
  })),
}

/**
 * A value from the operator as plain text in Markdown: a mark that would make
 * it bold, code, a link or a cell of a table is escaped, so that a name stays
 * the name it is.
 */
export function plainInMarkdown(value: string): string {
  return value.replace(/[\\`*_[\]|<>]/g, (mark) => `\\${mark}`).replace(/\s+/g, ' ')
}

function days(count: number): string {
  return count === 1 ? '1 Tag' : `${String(count)} Tagen`
}

function listed(parts: readonly string[]): string {
  return parts.length <= 1
    ? (parts[0] ?? '')
    : `${parts.slice(0, -1).join(', ')} und ${parts[parts.length - 1] ?? ''}`
}

/** The roles in one cell: the shipped ones by name, with their accesses where an operator is meant, then its own. */
function rolesInWords(roles: readonly ProcessingRole[], counted: boolean): string {
  const named = (role: ProcessingRole) =>
    counted
      ? `${plainInMarkdown(role.label)} (${String(role.holders)} ${role.holders === 1 ? 'Zugang' : 'Zugänge'})`
      : plainInMarkdown(role.label)
  const shipped = roles.filter((role) => role.shipped).map(named)
  const own = roles.filter((role) => !role.shipped).map(named)

  return `mitgeliefert: ${listed(shipped)}; ${own.length === 0 ? 'keine eigene' : `eigene: ${listed(own)}`}`
}

/** The settings of an operator as label and value, in the order the description and the screen name them. */
export function processingFactLines(
  facts: ProcessingFacts,
  counted: boolean,
): readonly { readonly label: string; readonly value: string }[] {
  return [
    { label: 'Rollen', value: rolesInWords(facts.roles, counted) },
    {
      label: 'Namen und Uhrzeiten der Ausführenden auf dem Leistungsnachweis',
      value: facts.namesAndTimes ? 'eingeschaltet' : 'aus',
    },
    {
      label: 'Störmeldung über das Etikett ohne Konto',
      value: facts.openByLabel ? 'eingeschaltet' : 'aus',
    },
    {
      label: 'Nachweise mindestens aufbewahren',
      value:
        facts.minimumYears === null
          ? 'keine Zahl von Jahren; es gilt die Regel der Pflichtart'
          : `${String(facts.minimumYears)} ${facts.minimumYears === 1 ? 'Jahr' : 'Jahre'}, länger, wo die Regel der Pflichtart es sagt`,
    },
    {
      label: 'Angaben eines beendeten Zugangs entfernen',
      value: `nach ${days(facts.removalDays)}, gezählt ab dem Tag nach dem letzten Tag`,
    },
    {
      label: 'Mailserver',
      value: facts.mailServer
        ? 'eingerichtet'
        : 'nicht eingerichtet; ohne ihn geht keine E-Mail hinaus',
    },
  ]
}

function row(cells: readonly string[]): string {
  return `| ${cells.join(' | ')} |`
}

/** The part "Bei diesem Betreiber" at the end of section 2. */
function atThisOperator(made: ProcessingMade | null): string {
  const facts = made?.facts ?? defaultProcessingFacts
  const own = facts.roles.filter((role) => !role.shipped)
  const lines = [
    '### Bei diesem Betreiber',
    '',
    made === null
      ? 'Diese Fassung nennt die Vorgaben, mit denen ein Betreiber beginnt. Was ein Betreiber davon geändert hat, nennt die Fassung, die seine Leitung unter „Einstellungen“, „Datenschutz“ erzeugt.'
      : `So war es bei ${plainInMarkdown(made.operator)} eingestellt, als diese Fassung erzeugt wurde. Wo der Text unten eine dieser Einstellungen nennt, gilt, was hier steht.`,
    '',
    row(['Einstellung', 'Stand']),
    row(['---', '---']),
    ...processingFactLines(facts, made !== null).map((line) => row([line.label, line.value])),
  ]

  if (own.length > 0) {
    lines.push('', 'Die eigenen Rollen und was sie dürfen:', '')

    for (const role of own) {
      const rights = role.rights.map((right) => rightLabel[right])

      lines.push(
        `- **${plainInMarkdown(role.label)}**${role.secondFactor ? ', mit zweitem Faktor' : ''}: ${rights.length === 0 ? 'kein Recht' : rights.join('; ')}.`,
      )
    }
  }

  lines.push(
    '',
    'Wie jede Art von Frist erinnert (Abschnitte 3.15 und 6):',
    '',
    row(['Fristart', 'Vorlauf', 'Erinnerung']),
    row(['---', '---', '---']),
    ...facts.reminders.map((reminder) =>
      row([
        plainInMarkdown(reminder.kind),
        reminder.leadDays === 0 ? 'am Tag selbst' : `${String(reminder.leadDays)} Tage`,
        deadlineReminderLabel[reminder.reminder],
      ]),
    ),
  )

  return lines.join('\n')
}

/** What the application fills in at each place of the template. */
function filled(
  made: ProcessingMade | null,
): Readonly<Record<(typeof processingPlaces)[number], string>> {
  if (made === null) {
    return {
      for: '',
      made: 'mit den Vorgaben, für einen Betreiber vor der Installation',
      'how-made':
        '**Mit den Vorgaben.** Die Anwendung erzeugt dieses Dokument selbst, aus einer Vorlage und dem, was bei einem Betreiber eingeschaltet und eingestellt ist. Diese Fassung im Repository nennt die Vorgaben, für einen Betreiber vor der Installation. Für einen Betreiber erzeugt seine Leitung es unter „Einstellungen“, „Datenschutz“; jede erzeugte Fassung bleibt dort mit ihrem Tag, damit sich nachlesen lässt, was sich geändert hat.',
      'at-this-operator': atThisOperator(null),
    }
  }

  const operator = plainInMarkdown(made.operator)

  return {
    for: ` für ${operator}`,
    made: `am ${made.at} für ${operator}`,
    'how-made': `**Erzeugt für ${operator}.** Die Anwendung hat dieses Dokument aus einer Vorlage und aus dem erzeugt, was bei diesem Betreiber eingeschaltet und eingestellt war; wann, steht oben unter „Erzeugt“, und was eingestellt war, in Abschnitt 2 unter „Bei diesem Betreiber“. Jede erzeugte Fassung bleibt bei der Leitung unter „Einstellungen“, „Datenschutz“ mit ihrem Tag, damit sich nachlesen lässt, was sich geändert hat.`,
    'at-this-operator': atThisOperator(made),
  }
}

/** Why a template cannot be filled: a place missing, standing twice, or one the application does not know. */
export class ProcessingTemplateError extends Error {}

/**
 * The description of the processing from the template: with the defaults
 * where nothing is made, for the file in the repository, or for one operator
 * at one moment.
 */
export function describeProcessing(template: string, made: ProcessingMade | null): string {
  const values = filled(made)
  const found = [...template.matchAll(/\{\{([a-z-]+)\}\}/g)].map((match) => match[1] ?? '')

  for (const place of processingPlaces) {
    if (found.filter((name) => name === place).length !== 1) {
      throw new ProcessingTemplateError(`Die Vorlage nennt „${place}“ nicht genau einmal.`)
    }
  }

  const unknown = found.filter((name) => !(processingPlaces as readonly string[]).includes(name))

  if (unknown.length > 0) {
    throw new ProcessingTemplateError(`Die Vorlage nennt „${unknown[0] ?? ''}“, das es nicht gibt.`)
  }

  return template.replace(
    /\{\{([a-z-]+)\}\}/g,
    (_, name: string) => values[name as (typeof processingPlaces)[number]],
  )
}

/** The version a description holds for, from its line "Gilt für", or null where it names none. */
export function processingHoldsFor(text: string): string | null {
  return /^- \*\*Gilt für:\*\* Fassung (\d+\.\d+\.\d+)/m.exec(text)?.[1] ?? null
}

/** The sections of a description by their headings, without the head above the first. */
function sectionsOf(text: string): ReadonlyMap<string, string> {
  const sections = new Map<string, string>()
  let heading: string | null = null
  let body: string[] = []

  for (const line of text.split('\n')) {
    if (line.startsWith('## ')) {
      if (heading !== null) {
        sections.set(heading, body.join('\n').trimEnd())
      }

      heading = line.slice(3)
      body = []
    } else if (heading !== null) {
      body.push(line)
    }
  }

  if (heading !== null) {
    sections.set(heading, body.join('\n').trimEnd())
  }

  return sections
}

/** How a section is named in a list of changes: "4" for "4. Wer was sieht", "Anhang B" for an appendix. */
function sectionName(heading: string): string {
  return /^(\d+)\. /.exec(heading)?.[1] ?? /^(Anhang [A-Z])\b/.exec(heading)?.[1] ?? heading
}

/**
 * The sections whose text differs between two descriptions, in the order of
 * the newer one, and a section the older had and the newer has not at the
 * end. The head with the moment of making is not among them.
 */
export function changedSections(before: string, after: string): readonly string[] {
  const old = sectionsOf(before)
  const now = sectionsOf(after)
  const changed = [...now].filter(([heading, body]) => old.get(heading) !== body)
  const gone = [...old.keys()].filter((heading) => !now.has(heading))

  return [...changed.map(([heading]) => heading), ...gone].map(sectionName)
}

/** A list of changed sections in words, "Abschnitte 2 und 4, Anhang B", or what stands for none and for the first. */
export function changedInWords(changed: readonly string[] | null): string {
  if (changed === null) {
    return 'Die erste Fassung'
  }

  if (changed.length === 0) {
    return 'Unverändert'
  }

  const numbered = changed.filter((name) => /^\d+$/.test(name))
  const rest = changed.filter((name) => !/^\d+$/.test(name))
  const parts = [
    ...(numbered.length === 0
      ? []
      : [`${numbered.length === 1 ? 'Abschnitt' : 'Abschnitte'} ${listed(numbered)}`]),
    ...rest,
  ]

  return parts.join(', ')
}

/** A description the operator made, as the list of them names it. */
export interface ProcessingVersion {
  readonly id: string
  readonly madeAt: string
  readonly madeBy: string | null
  readonly holdsFor: string | null
  /** The sections that differ from the version before, null for the first. */
  readonly changed: readonly string[] | null
}

/** What the screen "Datenschutz" reads: the settings now, what a description made now would change, and the versions. */
export interface ProcessingDescriptions {
  readonly facts: readonly { readonly label: string; readonly value: string }[]
  /** What would change against the newest version, null where there is none yet. */
  readonly changedSinceNewest: readonly string[] | null
  readonly versions: readonly ProcessingVersion[]
}

/** The words of the screen "Datenschutz" and of the PDF. */
export const processingWords = {
  title: 'Datenschutz',
  about:
    'Die Verfahrensbeschreibung für eine Arbeitnehmervertretung, Verzeichnis, Maßnahmen und Löschkonzept dieses Betreibers und die Auskunft über eine Person.',
  card: 'Verfahrensbeschreibung',
  explanation:
    'Für einen Betriebsrat, einen Personalrat oder eine Mitarbeitervertretung: welche Daten über Beschäftigte wo stehen, wer sie sieht, welche Auswertungen es gibt und welche nicht, was eingeschaltet ist und wie lange aufbewahrt wird. Erzeugt aus dem, was bei diesem Betreiber gerade eingeschaltet und eingestellt ist, als PDF.',
  make: 'Jetzt erzeugen',
  made: 'Erzeugt.',
  noneYet: 'Noch keine Fassung erzeugt',
  unchanged: 'Seit der neuesten Fassung unverändert',
  changedSince: (changed: readonly string[]) =>
    `Seit der neuesten Fassung geändert: ${changedInWords(changed)}`,
  versions: 'Erzeugte Fassungen',
  versionsNote:
    'Jede Fassung bleibt mit ihrem Tag, damit eine Arbeitnehmervertretung nachlesen kann, was sich geändert hat. Erzeugen und ansehen kann nur die Leitung.',
  versionsEmpty: 'Noch keine. Jede erzeugte Fassung bleibt hier mit ihrem Tag.',
  repository:
    'Die Fassung im Repository ist dieselbe Beschreibung mit den Vorgaben, für Betreiber vor der Installation. Was hier erzeugt wird, nennt dazu, was bei diesem Betreiber eingestellt ist.',
  pdfOf: (day: string) => `Verfahrensbeschreibung vom ${day} als PDF`,
} as const
