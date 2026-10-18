import {
  assetBookCountWords,
  assetBookFacts,
  type AssetBookHead,
  type AssetBookLine,
  assetBookWords,
  dayInWords,
  type EvidenceId,
} from '@opengewerk/haustechnik-domain'
import { fontFaces, type PrintJob, text, typeface } from '@opengewerk/platform-server'

import type { AttachedPages } from './evidence-bundle.js'

// The book of an asset as a PDF (#437, the board "Betriebstagebuch einer
// Verdunstungskühlanlage als PDF, A4 quer"): the head with what the file
// knows of the asset, then every entry in the order of time, on A4 turned on
// its side, made for the day it is asked for and never kept.

/** The pages of the evidence behind the book, by the evidence each line names. */
export type BookPages = AttachedPages<EvidenceId>

function sub(words: string | null): string {
  return words === null || words === '' ? '' : `<div class="sub">${text(words)}</div>`
}

function pageOf(line: AssetBookLine, attached: BookPages): string {
  const page = line.evidenceId === null ? undefined : attached.pages.get(line.evidenceId)

  return page === undefined ? '' : String(page)
}

function row(line: AssetBookLine, attached: BookPages | null): string {
  const under =
    line.kind === 'lifecycle'
      ? assetBookWords.lifecycle
      : [line.number, line.source].filter(Boolean).join(' · ')
  const mark = line.mark === null ? '' : `<span class="mark">${text(line.mark)}</span>`

  return `<tr><td class="day">${text(dayInWords(line.on))}</td><td>${text(line.entry)}${sub(under)}${mark}</td><td>${text(line.said ?? '')}${sub(line.defects)}</td><td>${text(line.result ?? '')}</td><td>${text(line.performer ?? '')}</td>${attached === null ? '' : `<td class="page">${pageOf(line, attached)}</td>`}</tr>`
}

/** What the line under the head says of the evidence behind the book. */
function behind(attached: BookPages | null): string {
  if (attached === null) {
    return ''
  }

  const follows =
    attached.pages.size === 0
      ? ' Kein Nachweis hat einen Stand, der folgen könnte.'
      : ` Die Nachweise folgen ab Seite ${String(attached.from)}.`
  const missing =
    attached.unattached === 0
      ? ''
      : ` ${String(attached.unattached)} ${attached.unattached === 1 ? 'Datei ließ' : 'Dateien ließen'} sich nicht anhängen; der Nachweis gibt sie selbst heraus.`

  return follows + missing
}

/**
 * The print of the book, for the renderer. With the evidence behind it, every
 * line of an evidence names the page it begins on, and the footer counts the
 * pages of the whole document.
 */
export function assetBookPrintJob(
  head: AssetBookHead,
  lines: readonly AssetBookLine[],
  attached: BookPages | null = null,
): PrintJob {
  const facts = assetBookFacts(head)
    .map(
      (fact) =>
        `<div><div class="label">${text(fact.label)}</div><div>${fact.value
          .split('\n')
          .map((part) => text(part))
          .join('<br>')}</div></div>`,
    )
    .join('')
  const count = assetBookCountWords(
    lines.filter((line) => line.kind === 'evidence').map((line) => line.on),
    lines.filter((line) => line.kind === 'lifecycle').map((line) => line.on),
  )
  const body = `
  <header><div class="titled"><h1>${text(head.title)}</h1>${head.source === null ? '' : `<div class="source">${text(head.source)}</div>`}</div><div class="over">Stand ${text(dayInWords(head.today))}<br>${text(head.operator)}</div></header>
  <div class="facts">${facts}</div>
  <p class="choice">Alle Nachweise der Anlage und ihr Lebenszyklus in zeitlicher Folge. ${text(count)}${text(behind(attached))}</p>
  <table><thead><tr><th class="day">Tag</th><th class="entry">Eintrag</th><th>Angaben</th><th class="result">Ergebnis</th><th class="by">Durchgeführt von</th>${attached === null ? '' : '<th class="page">Seite</th>'}</tr></thead>
  <tbody>${lines.map((line) => row(line, attached)).join('')}</tbody></table>`
  const html = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<style>
${fontFaces([400, 600])}
* { box-sizing: border-box; }
body { margin: 0; font-family: ${typeface}; font-size: 9pt; line-height: 1.35; color: #1b2430; }
header { display: flex; align-items: flex-end; gap: 16px; padding-bottom: 8px; border-bottom: 1.5px solid #1b2430; }
header .titled { flex-grow: 1; }
header h1 { margin: 0; font-size: 17pt; font-weight: 600; }
header .source { color: #555; font-size: 9pt; }
header .over { text-align: right; color: #555; font-size: 9pt; line-height: 1.5; }
.facts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px 18px; margin-top: 10px; }
.facts .label { font-size: 7.5pt; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: #555; }
.choice { margin: 10px 0 0; color: #555; }
table { width: 100%; border-collapse: collapse; margin-top: 8px; table-layout: fixed; }
th { text-align: left; font-size: 7.5pt; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: #555; padding: 4px 6px; border-bottom: 1px solid #8a8178; background: #f1ede6; }
th.day { width: 8%; } th.entry { width: 24%; } th.result { width: 11%; } th.by { width: 14%; } th.page { width: 5%; }
th.page, td.page { text-align: right; }
td { padding: 4px 6px; border-bottom: 1px solid #ddd6cc; vertical-align: top; }
td.day { white-space: nowrap; }
tr { break-inside: avoid; }
.sub { color: #555; font-size: 8pt; }
.mark { display: inline-block; margin-top: 2px; padding: 0 5px; border: 1px solid #8a8178; border-radius: 3px; font-size: 7.5pt; font-weight: 600; color: #3d3a36; }
</style>
</head>
<body>${body}</body>
</html>`
  const footerHtml = `<style>${fontFaces([400])}</style><div style="font-family: ${typeface}; font-size: 7pt; color: #555; width: 100%; padding: 0 12mm; display: flex; justify-content: space-between; align-items: flex-end;"><div>Erzeugt am ${text(dayInWords(head.today))}. Ein ersetzter oder für ungültig erklärter Nachweis bleibt mit seiner Kennzeichnung im Buch.</div><div>Seite <span class="pageNumber"></span> von ${attached === null ? '<span class="totalPages"></span>' : String(attached.total)}</div></div>`

  return {
    html,
    footerHtml,
    margin: { top: '12mm', right: '12mm', bottom: '18mm', left: '12mm' },
    landscape: true,
  }
}
