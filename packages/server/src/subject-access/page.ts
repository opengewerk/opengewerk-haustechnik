import {
  signaturePathIsValid,
  type SubjectAccess,
  type SubjectAccessColumn,
  subjectAccessParts,
  subjectAccessSearchParts,
  type SubjectAccessValue,
} from '@opengewerk/haustechnik-domain'
import { type PrintJob, text } from '@opengewerk/platform-server'

import { pathDrawing } from '../prints/record-page.js'
import { documentPrintJob } from '../processing-description/page.js'

// The information about a person as a PDF (#355, the board "Die Auskunft als
// PDF, erste Seite"): a head with the operator, the moment and the ground,
// then every printed part with its sentence and a table, or a line that it
// holds nothing. Every value is escaped; a drawing is drawn only from a path
// in the shape a signature has.

const dayInGermany = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'UTC',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})
const momentInGermany = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

/** "19.10.2026", from a day as the database keeps it. */
function dayWords(value: string): string {
  const day = new Date(`${value.slice(0, 10)}T00:00:00Z`)

  return Number.isNaN(day.getTime()) ? value : dayInGermany.format(day)
}

/** "19.10.2026, 09:12", by the clock of Germany. */
function momentWords(value: string): string {
  const moment = new Date(value)

  return Number.isNaN(moment.getTime()) ? value : momentInGermany.format(moment)
}

/** One value in its cell, escaped. */
export function cellHtml(
  column: SubjectAccessColumn,
  value: SubjectAccessValue | undefined,
): string {
  if (value === null || value === undefined || value === '') {
    return ''
  }

  switch (column.kind) {
    case 'flag':
      return value === true ? 'ja' : 'nein'
    case 'day':
      return text(dayWords(String(value)))
    case 'moment':
      return text(momentWords(String(value)))
    case 'drawing':
      return signaturePathIsValid(String(value)) ? pathDrawing(String(value)) : ''
    default:
      return text(String(value))
  }
}

/** Whether the file to read prints a part; the single changes of the log stand in the machine-readable file only. */
function printed(key: string): boolean {
  const definition =
    key in subjectAccessParts
      ? subjectAccessParts[key as keyof typeof subjectAccessParts]
      : subjectAccessSearchParts[key as keyof typeof subjectAccessSearchParts]

  return definition.printed
}

/** The title of the information: whom it is about. */
export function subjectAccessTitle(access: SubjectAccess): string {
  return access.about.kind === 'account'
    ? `Auskunft über ${access.about.name}`
    : `Auskunft zur Suche nach „${access.about.term}“`
}

/** The body of the page, every value escaped. */
export function subjectAccessHtml(access: SubjectAccess): string {
  const ground =
    access.about.kind === 'account'
      ? 'Art. 15 DSGVO; dieselben Angaben stehen maschinenlesbar in der JSON-Datei, die einzelnen Änderungen im Änderungsprotokoll nur dort.'
      : 'Art. 15 DSGVO, für eine Person ohne Zugang: alles, was zu dieser Suche nach einem Namen oder einer E-Mail-Adresse passt. Dieselben Angaben stehen maschinenlesbar in der JSON-Datei.'
  const head = [
    ['Betreiber', access.operator],
    ['Erzeugt', `am ${momentWords(access.madeAt).replace(', ', ' um ')}`],
    ...(access.about.kind === 'account' ? [['E-Mail-Adresse', access.about.email]] : []),
    ['Grundlage', ground],
  ]
  const parts = access.parts.filter((each) => printed(each.key))
  const sections = parts.map((each, index) => {
    const note = each.note === null ? '' : `<p class="note">${text(each.note)}</p>`
    const body =
      each.rows.length === 0
        ? '<p class="none">Keine Einträge.</p>'
        : `<table><thead><tr>${each.columns.map((column) => `<th>${text(column.label)}</th>`).join('')}</tr></thead><tbody>${each.rows
            .map(
              (row) =>
                `<tr>${each.columns.map((column) => `<td class="${column.kind}">${cellHtml(column, row[column.key])}</td>`).join('')}</tr>`,
            )
            .join('')}</tbody></table>`

    return `<h2>${String(index + 1)}. ${text(each.title)}</h2>${note}${body}`
  })

  return `<h1>${text(subjectAccessTitle(access))}</h1><ul>${head
    .map(([key, value]) => `<li><strong>${text(key ?? '')}:</strong> ${text(value ?? '')}</li>`)
    .join('')}</ul><hr>${sections.join('')}`
}

/** The information as a job for the renderer. */
export function subjectAccessPrintJob(access: SubjectAccess): PrintJob {
  return documentPrintJob(
    subjectAccessHtml(access),
    `${subjectAccessTitle(access)}, erzeugt am ${momentWords(access.madeAt).replace(', ', ' um ')}.`,
    `.note { color: #555; }
.none { color: #555; }
td.drawing { width: 34mm; }
td.drawing svg { width: 32mm; height: 10mm; }`,
  )
}
