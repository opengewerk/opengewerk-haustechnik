import {
  dayInWords,
  type DefectEntry,
  defectReportWords,
  defectStatusLabel,
  defectTableWords,
  type IsoDate,
} from '@opengewerk/haustechnik-domain'
import { fontFaces, type PrintJob, text, typeface } from '@opengewerk/platform-server'

// The report of the defects as a PDF (#345, the board "Mängelbericht als
// PDF, A4 quer"): a block per building, a row per defect with its first
// photo, on A4 turned on its side, made for the moment it is asked for and
// never kept. Its head and its foot name the day and the hour.

/** What the head and the line under it say: the moment, the operator, the choice in words and the count. */
export interface DefectReportHead {
  readonly day: IsoDate
  /** The hour and the minute in Germany, `09:14`. */
  readonly time: string
  readonly operator: string
  readonly choice: string
  readonly count: string
}

/** A photo as the report shows it: the picture, or the word that it stays at the defect. */
export type DefectReportPhoto =
  { readonly mediaType: string; readonly bytes: Uint8Array } | 'elsewhere' | null

/** A defect as a row of the report, with what it says in words. */
export interface DefectReportLine {
  readonly defect: DefectEntry
  readonly where: { readonly name: string; readonly sub: string }
  /** Where it comes from, in a word. */
  readonly origin: string
  /** The class as the catalogue names it; null for a defect without one. */
  readonly defectClass: string | null
  readonly unsafe: boolean
  /** The number of its work order, for whoever reads work orders. */
  readonly order: string | null
  readonly photo: DefectReportPhoto
}

export interface DefectReportPart {
  readonly title: string
  readonly sub: string
  readonly lines: readonly DefectReportLine[]
}

function sub(words: string | null): string {
  return words === null || words === '' ? '' : `<div class="sub">${text(words)}</div>`
}

function mark(words: string): string {
  return `<span class="mark">${text(words)}</span>`
}

function photoOf(photo: DefectReportPhoto): string {
  if (photo === null) {
    return `<span class="muted">${text(defectReportWords.noPhoto)}</span>`
  }

  if (photo === 'elsewhere') {
    return `<span class="muted">${text(defectReportWords.photoElsewhere)}</span>`
  }

  return `<img src="data:${text(photo.mediaType)};base64,${Buffer.from(photo.bytes).toString('base64')}" alt="">`
}

function line(entry: DefectReportLine): string {
  const { defect } = entry

  return `<tr><td>${text(defect.description)}${sub(entry.origin)}</td><td>${text(entry.where.name)}${sub(entry.where.sub)}</td><td>${text(entry.defectClass ?? defectTableWords.withoutClass)}${entry.unsafe ? `<div>${mark(defectReportWords.unsafe)}</div>` : ''}</td><td>${text(dayInWords(defect.foundOn))}</td><td>${defect.dueOn === null ? '' : text(dayInWords(defect.dueOn))}${defect.overdue ? `<div>${mark(defectReportWords.overdue)}</div>` : ''}</td><td>${text(defectStatusLabel[defect.status])}${sub(entry.order)}</td><td class="photo">${photoOf(entry.photo)}</td></tr>`
}

function partOf(part: DefectReportPart): string {
  return `<tbody><tr class="block"><td colspan="7"><strong>${text(part.title)}</strong> <span class="muted">${text(part.sub)}</span></td></tr>${part.lines.map(line).join('')}</tbody>`
}

/** The print of the report, for the renderer. */
export function defectReportPrintJob(
  head: DefectReportHead,
  parts: readonly DefectReportPart[],
): PrintJob {
  const moment = `${dayInWords(head.day)}, ${head.time} Uhr`
  const body = `
  <header><h1>${text(defectReportWords.title)}</h1><div class="over">Stand ${text(moment)}<br>${text(head.operator)}</div></header>
  <p class="choice">${text(head.choice)} ${text(head.count)}</p>
  <table><thead><tr><th class="what">Mangel</th><th class="where">Anlage oder Ort</th><th class="class">Klasse</th><th class="found">Festgestellt</th><th class="due">Frist</th><th class="status">Stand</th><th>Foto</th></tr></thead>
  ${parts.map(partOf).join('')}</table>`
  const html = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<style>
${fontFaces([400, 600])}
* { box-sizing: border-box; }
body { margin: 0; font-family: ${typeface}; font-size: 9pt; line-height: 1.35; color: #1b2430; }
header { display: flex; align-items: flex-end; gap: 16px; padding-bottom: 8px; border-bottom: 1.5px solid #1b2430; }
header h1 { margin: 0; flex-grow: 1; font-size: 17pt; font-weight: 600; }
header .over { text-align: right; color: #555; font-size: 9pt; line-height: 1.5; }
.choice { margin: 8px 0 0; color: #555; }
table { width: 100%; border-collapse: collapse; margin-top: 10px; table-layout: fixed; }
th { text-align: left; font-size: 7.5pt; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: #555; padding: 4px 6px; border-bottom: 1px solid #8a8178; background: #f1ede6; }
th.what { width: 22%; } th.where { width: 19%; } th.class { width: 11%; } th.found { width: 9%; } th.due { width: 10%; } th.status { width: 11%; }
td { padding: 4px 6px; border-bottom: 1px solid #ddd6cc; vertical-align: top; }
tbody { break-inside: avoid; }
tr { break-inside: avoid; }
tr.block td { padding-top: 9px; border-bottom: 1px solid #8a8178; }
td.photo img { display: block; max-width: 32mm; max-height: 22mm; border: 1px solid #ddd6cc; border-radius: 2px; }
.muted, .sub { color: #555; }
.sub { font-size: 8pt; }
.mark { display: inline-block; margin-top: 2px; padding: 0 5px; border: 1px solid #8a8178; border-radius: 3px; font-size: 7.5pt; font-weight: 600; color: #3d3a36; }
</style>
</head>
<body>${body}</body>
</html>`
  const footerHtml = `<style>${fontFaces([400])}</style><div style="font-family: ${typeface}; font-size: 7pt; color: #555; width: 100%; padding: 0 12mm; display: flex; justify-content: space-between; align-items: flex-end;"><div>Erzeugt am ${text(dayInWords(head.day))} um ${text(head.time)} Uhr. ${text(defectReportWords.footer)}</div><div>Seite <span class="pageNumber"></span> von <span class="totalPages"></span></div></div>`

  return {
    html,
    footerHtml,
    margin: { top: '12mm', right: '12mm', bottom: '18mm', left: '12mm' },
    landscape: true,
  }
}
