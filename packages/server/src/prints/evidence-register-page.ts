import {
  dayInWords,
  type EvidenceRegisterBlock,
  type EvidenceId,
  type EvidenceRegisterCount,
  evidenceRegisterWords,
  type IsoDate,
} from '@opengewerk/haustechnik-domain'
import { fontFaces, type PrintJob, text, typeface } from '@opengewerk/platform-server'

import type { AttachedPages } from './evidence-bundle.js'

// The register of evidence as a PDF (#338, the board "Nachweisverzeichnis
// als PDF, A4 quer"): a block per asset, a line per duty, on A4 turned on
// its side, made for the day it is asked for and never kept. Evidence from
// the old stock carries its mark, a duty without evidence says so.

/** What the head and the line under it say: the day, the operator, the choice in words and the count. */
export interface EvidenceRegisterHead {
  readonly today: IsoDate
  readonly operator: string
  readonly choice: string
  readonly count: EvidenceRegisterCount
}

type Line = EvidenceRegisterBlock['lines'][number]

/** The pages of the evidence behind the list, by the evidence each row names. */
export type EvidencePages = AttachedPages<EvidenceId>

function line(entry: Line, attached: EvidencePages | null): string {
  const sub = (words: string | null) =>
    words === null || words === '' ? '' : `<div class="sub">${text(words)}</div>`
  const mark = entry.mark === null ? '' : `<span class="mark">${text(entry.mark)}</span>`

  return `<tr><td>${text(entry.duty)}</td><td>${text(entry.reference)}${sub(entry.document)}</td><td>${text(entry.interval)}</td><td class="muted">${text(entry.reason ?? 'Keine, die Frist des Pakets.')}</td><td>${entry.last === null ? '' : text(entry.last)}${sub(entry.evidenceNumber)}${mark}</td><td>${entry.nextDue === null ? '' : text(dayInWords(entry.nextDue))}</td>${attached === null ? '' : `<td class="page">${pageOf(entry, attached)}</td>`}</tr>`
}

function pageOf(entry: Line, attached: EvidencePages): string {
  const page = entry.evidenceId === null ? undefined : attached.pages.get(entry.evidenceId)

  return page === undefined ? '' : String(page)
}

function blockOf(
  block: EvidenceRegisterBlock,
  named: { asset: string; place: string },
  attached: EvidencePages | null,
): string {
  return `<tbody><tr class="block"><td colspan="${attached === null ? 6 : 7}"><strong>${text(named.asset)}</strong> <span class="muted">${text(named.place)}</span></td></tr>${block.lines.map((entry) => line(entry, attached)).join('')}</tbody>`
}

/** What the line under the head says of the evidence behind the list. */
function behind(attached: EvidencePages | null): string {
  if (attached === null) {
    return ''
  }

  const follows =
    attached.pages.size === 0
      ? ' Keine Pflicht hat einen Nachweis, der folgen könnte.'
      : ` Die Nachweise folgen ab Seite ${String(attached.from)}.`
  const missing =
    attached.unattached === 0
      ? ''
      : ` ${String(attached.unattached)} ${attached.unattached === 1 ? 'Datei ließ' : 'Dateien ließen'} sich nicht anhängen; der Nachweis gibt sie selbst heraus.`

  return follows + missing
}

function counted(count: EvidenceRegisterCount): string {
  const duties = `${String(count.duties)} ${count.duties === 1 ? 'Pflicht' : 'Pflichten'}`
  const assets = `${String(count.assets)} ${count.assets === 1 ? 'Anlage' : 'Anlagen'}`

  return `${duties} an ${assets}, davon ${String(count.never)} ${evidenceRegisterWords.never.toLowerCase()}.`
}

/**
 * The print of the register, for the renderer. With the evidence behind it,
 * every row names the page its evidence begins on, and the footer counts the
 * pages of the whole document.
 */
export function evidenceRegisterPrintJob(
  head: EvidenceRegisterHead,
  blocks: readonly EvidenceRegisterBlock[],
  named: (block: EvidenceRegisterBlock) => { readonly asset: string; readonly place: string },
  attached: EvidencePages | null = null,
): PrintJob {
  const body = `
  <header><h1>${text(evidenceRegisterWords.title)}</h1><div class="over">Stand ${text(dayInWords(head.today))}<br>${text(head.operator)}</div></header>
  <p class="choice">${text(head.choice)} ${text(counted(head.count))}${text(behind(attached))}</p>
  <table><thead><tr><th class="duty">Pflicht</th><th class="reference">Fundstelle</th><th class="interval">Frist</th><th>Begründung</th><th class="last">Letzter Nachweis</th><th class="next">Nächste Fälligkeit</th>${attached === null ? '' : '<th class="page">Seite</th>'}</tr></thead>
  ${blocks.map((block) => blockOf(block, named(block), attached)).join('')}</table>`
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
${
  attached === null
    ? 'th.duty { width: 20%; } th.reference { width: 18%; } th.interval { width: 9%; } th.last { width: 19%; } th.next { width: 11%; }'
    : 'th.duty { width: 19%; } th.reference { width: 17%; } th.interval { width: 8%; } th.last { width: 18%; } th.next { width: 11%; } th.page { width: 5%; }'
}
th.page, td.page { text-align: right; }
td { padding: 4px 6px; border-bottom: 1px solid #ddd6cc; vertical-align: top; }
tbody { break-inside: avoid; }
tr.block td { padding-top: 9px; border-bottom: 1px solid #8a8178; }
.muted, .sub { color: #555; }
.sub { font-size: 8pt; }
.mark { display: inline-block; margin-top: 2px; padding: 0 5px; border: 1px solid #8a8178; border-radius: 3px; font-size: 7.5pt; font-weight: 600; color: #3d3a36; }
</style>
</head>
<body>${body}</body>
</html>`
  const footerHtml = `<style>${fontFaces([400])}</style><div style="font-family: ${typeface}; font-size: 7pt; color: #555; width: 100%; padding: 0 12mm; display: flex; justify-content: space-between; align-items: flex-end;"><div>Erzeugt am ${text(dayInWords(head.today))}. Ein Nachweis aus dem Altbestand ist übernommen und nicht in dieser Anwendung unterschrieben.</div><div>Seite <span class="pageNumber"></span> von ${attached === null ? '<span class="totalPages"></span>' : String(attached.total)}</div></div>`

  return {
    html,
    footerHtml,
    margin: { top: '12mm', right: '12mm', bottom: '18mm', left: '12mm' },
    landscape: true,
  }
}
