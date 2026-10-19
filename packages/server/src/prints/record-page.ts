import {
  collectiveStatement,
  stockUnitLabel,
  evidenceOriginLabel,
  legacyNote,
  evidenceResultLabel,
  workOrderKindLabel,
  type EvidenceState,
  type IsoDate,
  type RoundRecordState,
  type ServiceReportState,
  signatureRoleLabel,
  signatureWayLabel,
  type StatedAnswer,
  type StatedCollective,
  type StatedPlace,
  type StatedSignature,
  statedPointWords,
} from '@opengewerk/haustechnik-domain'
import { fontFaces, type PrintJob, text, typeface } from '@opengewerk/platform-server'

// The PDF of a frozen state (section 2.6 of the concept, #111): an evidence or
// a round as it was written down, on A4, from the state alone and never from
// the records as they are now. The page is a template string, as every page
// the renderer prints: escaping is all it needs to be safe. Photos come in as
// data addresses, read from the store by the hash the state names, and a
// signature as the drawing it kept.

/** A photo of an answer, read from the store by its hash. */
export interface PrintedPhoto {
  readonly caption: string
  readonly mediaType: string
  readonly bytes: Uint8Array
}

/** What only the day of printing knows: that an evidence was declared invalid since. */
export interface PrintedVoiding {
  readonly on: IsoDate
  readonly reason: string
}

const results: Readonly<Record<string, string>> = {
  ok: 'in Ordnung',
  not_ok: 'nicht in Ordnung',
  not_applicable: 'entfällt',
  not_possible: 'nicht möglich',
}

const weekdays = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']

/** A day as the pages write it, `05.10.2026`. */
function day(iso: string): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`
}

/** A moment in German time, `05.10.2026, 07:38`. */
function moment(iso: string): string {
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

/** "Montag, 05.10.2026, Woche 41". */
function dueWords(iso: IsoDate): string {
  const date = new Date(`${iso}T12:00:00Z`)
  const thursday = new Date(date)

  thursday.setUTCDate(date.getUTCDate() + 3 - ((date.getUTCDay() + 6) % 7))

  const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4))
  const week =
    1 +
    Math.round(
      ((thursday.getTime() - firstThursday.getTime()) / 86_400_000 -
        3 +
        ((firstThursday.getUTCDay() + 6) % 7)) /
        7,
    )

  return `${weekdays[date.getUTCDay()] ?? ''}, ${day(iso)}, Woche ${String(week)}`
}

/** Where it was: the property with its address, and the building, the room and the asset. */
function placeWords(place: StatedPlace): string {
  const room =
    place.room === null
      ? null
      : [place.room.number, place.room.name].filter(Boolean).join(' ') || null

  return [
    `${place.property.name}, ${place.property.address}`,
    place.building?.name ?? null,
    room === null ? null : `Raum ${room}`,
    place.asset === null ? null : [place.asset.number, place.asset.name].filter(Boolean).join(' '),
  ]
    .filter(Boolean)
    .join('; ')
}

/** The answer of a point in a word or a figure, and what was said with it. */
function answerCells(answer: StatedAnswer): { said: string; remark: string } {
  // A photo stands under "Fotos", with the point as its caption.
  const said =
    answer.result !== null
      ? (results[answer.result] ?? answer.result)
      : answer.value !== null
        ? answer.value
        : answer.photo !== null
          ? (answer.morePhotos ?? []).length > 0
            ? `${String(1 + (answer.morePhotos ?? []).length)} Fotos`
            : 'Foto'
          : 'keine Angabe'
  // The limit says itself whether the value is within it, as on the page of the round.
  const limit =
    answer.limit === null
      ? null
      : answer.limit.source === null
        ? answer.limit.text
        : `${answer.limit.text} Fundstelle: ${answer.limit.source}.`
  const remark = [limit, answer.remark].filter(Boolean).join(' ')

  return { said, remark }
}

/** The answers by the chapter of the form, each with the place of its block in a group. */
function chapters(answers: readonly StatedAnswer[]): string {
  const bySection = new Map<string, StatedAnswer[]>()

  for (const answer of answers) {
    bySection.set(answer.section, [...(bySection.get(answer.section) ?? []), answer])
  }

  return [...bySection.entries()]
    .map(
      ([title, rows]) => `
    <h2>${text(title)}</h2>
    <table>
      <thead><tr><th class="point">Punkt</th><th class="said">Antwort</th><th>Bemerkung</th></tr></thead>
      <tbody>${rows
        .map((answer) => {
          const { said, remark } = answerCells(answer)
          const point = statedPointWords(answer)

          return `<tr><td>${text(point)}</td><td class="said"><strong>${text(said)}</strong></td><td class="muted">${text(remark)}</td></tr>`
        })
        .join('')}</tbody>
    </table>`,
    )
    .join('')
}

/** The photos of the answers, two to a row, each under the point it was taken for. */
function photosOf(photos: readonly PrintedPhoto[]): string {
  if (photos.length === 0) {
    return ''
  }

  return `
    <h2>Fotos</h2>
    <div class="photos">${photos
      .map(
        (photo) =>
          `<figure><img src="data:${text(photo.mediaType)};base64,${Buffer.from(photo.bytes).toString('base64')}" alt="${text(photo.caption)}"><figcaption>${text(photo.caption)}</figcaption></figure>`,
      )
      .join('')}</div>`
}

/** The drawing of a signature, scaled into its box by the points it is made of. */
/**
 * When the server took a signature, beside the moment of the device it was
 * given on (#79); nothing for one stated before it was kept.
 */
function receivedOf(signature: StatedSignature): string {
  return signature.receivedAt === null
    ? ''
    : `<p class="muted">beim Server ${text(moment(signature.receivedAt))}</p>`
}

function drawingOf(signature: StatedSignature): string {
  const { path } = signature

  // Confirmed with the typed name (#209): the name in the box, and the way it says.
  if (signature.way === 'name') {
    return `<div class="pad typed"><span class="typed-name">${text(signature.name)}</span><span class="way">${text(signatureWayLabel.name)}</span></div>`
  }

  if (path === null) {
    return '<div class="pad empty">Ohne Zeichnung eingefroren</div>'
  }

  return `<div class="pad">${pathDrawing(path)}</div>`
}

/**
 * The drawing of a signature as an image, fitted to the box it was drawn in.
 * The information about a person (#355) shows the same drawing.
 */
export function pathDrawing(path: string): string {
  const figures = (path.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)
  const xs = figures.filter((_, index) => index % 2 === 0)
  const ys = figures.filter((_, index) => index % 2 === 1)
  const left = Math.min(...xs, 0)
  const top = Math.min(...ys, 0)
  const width = Math.max(Math.max(...xs, 1) - left, 1)
  const height = Math.max(Math.max(...ys, 1) - top, 1)

  return `<svg viewBox="${String(left - 4)} ${String(top - 4)} ${String(width + 8)} ${String(height + 8)}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Zeichnung der Unterschrift"><path d="${text(path)}" fill="none" stroke="#1b2430" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`
}

function signaturesOf(signatures: readonly StatedSignature[]): string {
  if (signatures.length === 0) {
    return ''
  }

  return `<div class="signatures">${signatures
    .map(
      (signature) =>
        `<div class="signature"><p class="label">${text(signatureRoleLabel[signature.role])}</p>${drawingOf(signature)}<p class="name">${text(signature.name)}</p><p class="muted">${text(moment(signature.signedAt))}</p>${receivedOf(signature)}</div>`,
    )
    .join('')}</div>`
}

function factsOf(facts: readonly (readonly [string, string | null])[]): string {
  return `<dl>${facts
    .filter((fact): fact is readonly [string, string] => fact[1] !== null && fact[1] !== '')
    .map(([label, value]) => `<dt>${text(label)}</dt><dd>${text(value)}</dd>`)
    .join('')}</dl>`
}

function page(body: string): string {
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<style>
${fontFaces([400, 600])}
* { box-sizing: border-box; }
body { margin: 0; font-family: ${typeface}; font-size: 10pt; line-height: 1.35; color: #1b2430; }
header { display: flex; align-items: flex-end; gap: 16px; padding-bottom: 8px; border-bottom: 1.5px solid #1b2430; }
header h1 { margin: 0; flex-grow: 1; font-size: 17pt; font-weight: 600; }
header .over { text-align: right; color: #555; font-size: 9pt; line-height: 1.5; }
.mark { margin-top: 12px; padding: 8px 10px; border: 1px solid #b42318; color: #b42318; font-weight: 600; border-radius: 4px; }
.mark.neutral { border-color: #8a8178; color: #3d3a36; }
dl { display: grid; grid-template-columns: 30mm 1fr; gap: 2px 8px; margin: 14px 0 0; }
dt { color: #555; }
dd { margin: 0; }
h2 { margin: 18px 0 6px; font-size: 11pt; font-weight: 600; }
table { width: 100%; border-collapse: collapse; }
th { text-align: left; font-size: 8pt; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: #555; padding: 4px 6px; border-bottom: 1px solid #8a8178; background: #f1ede6; }
td { padding: 5px 6px; border-bottom: 1px solid #ddd6cc; vertical-align: top; }
th.point { width: 42%; } th.said { width: 17%; }
.muted { color: #555; }
.photos { display: flex; flex-wrap: wrap; gap: 10px 18px; }
figure { margin: 0; width: 40mm; break-inside: avoid; }
figure img { width: 40mm; height: 30mm; object-fit: cover; border: 1px solid #ddd6cc; }
figcaption { font-size: 8pt; color: #555; }
.signatures { display: flex; gap: 20mm; margin-top: 18px; break-inside: avoid; }
.signature { width: 54mm; }
.signature .label { margin: 0 0 4px; font-size: 8pt; letter-spacing: 0.06em; text-transform: uppercase; color: #555; }
.pad { height: 16mm; border: 1px solid #ddd6cc; border-radius: 4px; padding: 2px; }
.pad svg { width: 100%; height: 100%; }
.pad.empty { display: flex; align-items: center; justify-content: center; color: #8a8178; font-size: 8pt; }
.pad.typed { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; }
.pad.typed .typed-name { font-size: 13pt; font-style: italic; }
.pad.typed .way { color: #555; font-size: 8pt; }
.signature .name { margin: 6px 0 0; font-weight: 600; }
.signature p { margin: 0; }
.work p { margin: 0; padding: 5px 0; border-bottom: 1px solid #ddd6cc; }
.work .muted { display: block; font-size: 8pt; }
</style>
</head>
<body>${body}</body>
</html>`
}

/** The footer of every page: where the page comes from, its fingerprint, and the count. */
function footer(fingerprint: string): string {
  // The footer is a page of its own to the renderer: it loads the typeface itself.
  return `<style>${fontFaces([400])}</style><div style="font-family: ${typeface}; font-size: 7pt; color: #555; width: 100%; padding: 0 15mm; display: flex; justify-content: space-between; align-items: flex-end;"><div>Erzeugt aus dem eingefrorenen Stand. Fingerabdruck SHA-256:<br><span style="font-family: monospace;">${text(fingerprint)}</span></div><div>Seite <span class="pageNumber"></span> von <span class="totalPages"></span></div></div>`
}

const margin = { top: '15mm', right: '15mm', bottom: '22mm', left: '15mm' } as const

/** The PDF of a round as it was written down (`pdf()` of the boards, 4.5). */
export function roundPrintJob(
  record: RoundRecordState,
  fingerprint: string,
  photos: readonly PrintedPhoto[],
): PrintJob {
  const countersigned = record.signatures.find((each) => each.role === 'countersigner')
  const body = `
  <header><h1>Rundgang ${text(record.title)}</h1><div class="over">Rundgang vom ${text(day(record.performedOn))}${
    countersigned === undefined
      ? ''
      : `<br>gegengezeichnet am ${text(day(countersigned.signedAt.slice(0, 10)))}`
  }</div></header>
  ${factsOf([
    ['Ort', placeWords(record.place)],
    ['Fällig', record.dueOn === null ? null : dueWords(record.dueOn)],
    [
      'Vorlage',
      record.form === null ? null : `${record.form.title}, Fassung ${String(record.form.version)}`,
    ],
    [
      'Durchgeführt',
      `am ${day(record.performedOn)}${'person' in (record.performer ?? {}) ? ` von ${(record.performer as { person: string }).person}` : ''}`,
    ],
    [
      'Nachweise',
      record.evidence.length === 0
        ? 'Dieser Rundgang erfüllt keine Pflicht.'
        : record.evidence.map((each) => `${each.number} ${each.duty}`).join('; '),
    ],
    [
      'Mängel',
      record.defects.length === 0
        ? null
        : record.defects.map((each) => each.description).join('; '),
    ],
  ])}
  ${chapters(record.answers)}
  ${photosOf(photos)}
  ${signaturesOf(record.signatures)}`

  return { html: page(body), footerHtml: footer(fingerprint), margin }
}

/** The PDF of an evidence as it was written down, with what was declared about it since. */
export function evidencePrintJob(
  state: EvidenceState,
  fingerprint: string,
  photos: readonly PrintedPhoto[],
  voiding: PrintedVoiding | null,
): PrintJob {
  const performer =
    state.performer === null
      ? null
      : 'person' in state.performer
        ? state.performer.person
        : `${state.performer.examiner}, ${state.performer.organisation}`
  const marks = [
    voiding === null
      ? ''
      : `<p class="mark">Für ungültig erklärt am ${text(day(voiding.on))}: ${text(voiding.reason)}</p>`,
    state.origin === 'legacy'
      ? `<p class="mark neutral">${text(legacyNote(state.files.length > 0))}</p>`
      : '',
  ].join('')
  const body = `
  <header><h1>Nachweis ${text(state.number)}</h1><div class="over">${text(state.duty.label)}<br>vom ${text(day(state.performedOn))}</div></header>
  ${marks}
  ${factsOf([
    ['Pflicht', `${state.duty.label}${state.duty.source === '' ? '' : `, ${state.duty.source}`}`],
    ['Ort', placeWords(state.place)],
    ['Ergebnis', evidenceResultLabel[state.result]],
    ['Grund', state.resultReason],
    ['Bemerkung', state.remark],
    ['Herkunft', evidenceOriginLabel[state.origin]],
    ['Vorgang', state.activity === null ? null : state.activity.title],
    // Written with a collective activity, under its one signature (#342).
    [
      'Sammelvorgang',
      (state.collective ?? null) === null
        ? null
        : collectiveStatement(state.collective as StatedCollective),
    ],
    [
      'Formular',
      state.form === null ? null : `${state.form.title}, Fassung ${String(state.form.version)}`,
    ],
    [
      'Durchgeführt',
      `am ${day(state.performedOn)}${performer === null ? '' : ` von ${performer}`}`,
    ],
    [
      'Ersetzt',
      state.replaces === null ? null : `${state.replaces.number}: ${state.replaces.reason}`,
    ],
    [
      'Mängel',
      state.defects.length === 0 ? null : state.defects.map((each) => each.description).join('; '),
    ],
    [
      'Nächste Fälligkeit',
      state.nextDueOn === null
        ? null
        : `${day(state.nextDueOn)}, aus der Vorgängeranwendung übernommen`,
    ],
    // A report rests on its file, which lies at the evidence and is not printed with it.
    [
      state.origin === 'legacy' ? 'Ursprüngliches Dokument' : 'Bericht',
      state.files.length === 0
        ? null
        : `${state.files.map((file) => file.name).join('; ')}, liegt am Nachweis`,
    ],
    ['Eingetragen', `${state.writtenBy}, ${moment(state.writtenAt)}`],
  ])}
  ${chapters(state.answers)}
  ${photosOf(photos)}
  ${signaturesOf(state.signatures)}`

  return { html: page(body), footerHtml: footer(fingerprint), margin }
}

/** The time spent in hours and minutes, `0:45 Std.`, as the pages of a work order say it. */
function hours(minutes: number): string {
  return `${String(Math.floor(minutes / 60))}:${String(minutes % 60).padStart(2, '0')} Std.`
}

/** A quantity in thousandths as a person writes it, `85,5`. */
function quantityWords(milli: number): string {
  return (milli / 1000).toLocaleString('de-DE', { maximumFractionDigits: 3 })
}

/**
 * The PDF of a service report (#324, 4.8): what was done and how long it
 * took, from the state frozen when the server took the client's signature,
 * with no price; who wrote each note and when, and the moment of the
 * client's signature, only where the operator had them switched on, the day
 * otherwise. A report a rejection made invalid is printed with that on it.
 */
export function serviceReportPrintJob(
  state: ServiceReportState,
  fingerprint: string,
  voiding: { readonly on: IsoDate } | null,
): PrintJob {
  const number = state.workOrder.number ?? ''
  const work =
    state.work.length === 0
      ? '<p class="muted">Ohne Notizen von vor Ort.</p>'
      : `<div class="work">${state.work
          .map(
            (entry) =>
              `<p>${text(entry.text)}${
                entry.writtenBy === undefined || entry.writtenAt === undefined
                  ? ''
                  : `<span class="muted">${text(moment(entry.writtenAt))}, ${text(entry.writtenBy)}</span>`
              }</p>`,
          )
          .join('')}</div>`
  // The material from version 2 on (#326): how much of what, never a price.
  const material =
    state.materials === undefined || state.materials.length === 0
      ? ''
      : `<h2>Material</h2><div class="work">${state.materials
          .map(
            (each) =>
              `<p>${text(`${quantityWords(each.quantityMilli)} ${stockUnitLabel[each.unit]} ${each.designation}`)}</p>`,
          )
          .join('')}</div>`
  const client = {
    role: 'signer' as const,
    name: state.client.name,
    signedAt: state.client.signedAt ?? state.client.signedOn,
    receivedAt: null,
    path: state.client.path,
    way: 'drawing' as const,
  }
  const signed = `<div class="signatures"><div class="signature"><p class="label">Auftraggeber</p>${drawingOf(client)}<p class="name">${text(state.client.name)}</p><p class="muted">${text(state.client.signedAt === undefined ? day(state.client.signedOn) : moment(state.client.signedAt))}</p></div></div>`
  const body = `
  <header><h1>Leistungsnachweis ${text(number)}</h1><div class="over">${text(state.workOrder.title)}<br>vom ${text(day(state.client.signedOn))}</div></header>
  ${voiding === null ? '' : `<p class="mark">Ungültig: der Auftrag wurde am ${text(day(voiding.on))} zurückgewiesen.</p>`}
  ${factsOf([
    ['Auftrag', [number, state.workOrder.title].filter(Boolean).join(' ')],
    ['Art', workOrderKindLabel[state.workOrder.kind]],
    ['Ort', placeWords(state.place)],
    ['Dauer', state.durationMinutes === null ? null : hours(state.durationMinutes)],
    [
      'Aufgenommen',
      `auf dem Gerät von ${state.holder}; die Signatur dieses Kontos deckt die Seite mit Schriftzug und Namen`,
    ],
  ])}
  <h2>Geleistete Arbeit</h2>
  ${work}
  ${material}
  ${signed}`

  return { html: page(body), footerHtml: footer(fingerprint), margin }
}

/** What the PDF of a delegation of duties says (#336), read from the delegation as it was signed. */
export interface DelegationPrint {
  readonly operator: string
  readonly delegateName: string
  readonly areas: readonly string[]
  readonly scope: string
  readonly tasks: string
  readonly powers: string
  readonly startsOn: IsoDate
  readonly endsOn: IsoDate
  readonly signatures: readonly {
    readonly label: string
    readonly name: string
    readonly signedAt: string
    readonly path: string | null
    readonly typedName: string | null
  }[]
  readonly revocation: {
    readonly effectiveOn: IsoDate
    readonly reason: string
    readonly name: string
    readonly at: string
  } | null
  /** Whether both have signed: before that the page says it is a draft. */
  readonly signedByBoth: boolean
}

/**
 * The PDF of a delegation of duties (#336, section 4.3): the copy the person
 * keeps under "Konto", with what it says and both signatures, from the rows
 * that no longer change once somebody signed. Before both signatures it says
 * it does not hold yet; after a revocation, from when and why it ended.
 */
export function delegationPrintJob(print: DelegationPrint, fingerprint: string): PrintJob {
  const mark = !print.signedByBoth
    ? '<p class="mark neutral">Noch nicht von beiden unterschrieben: die Übertragung gilt erst mit beiden Unterschriften.</p>'
    : print.revocation === null
      ? ''
      : `<p class="mark neutral">${text(`Widerrufen am ${moment(print.revocation.at)} von ${print.revocation.name}, mit Wirkung zum ${day(print.revocation.effectiveOn)}: ${print.revocation.reason}`)}</p>`
  const signed = `<div class="signatures">${print.signatures
    .map((signature) => {
      const stated = {
        role: 'signer',
        name: signature.name,
        signedAt: signature.signedAt,
        receivedAt: null,
        path: signature.path,
        way: signature.typedName === null ? 'drawing' : 'name',
      } as StatedSignature

      return `<div class="signature"><p class="label">${text(signature.label)}</p>${drawingOf(stated)}<p class="name">${text(signature.name)}</p><p class="muted">${text(moment(signature.signedAt))}</p></div>`
    })
    .join('')}</div>`
  const body = `
  <header><h1>Pflichtenübertragung</h1><div class="over">${text(print.operator)}</div></header>
  ${mark}
  ${factsOf([
    ['Betreiber', print.operator],
    ['Beauftragte Person', print.delegateName],
    ['Bereiche', print.areas.join(', ')],
    ['Umfang', print.scope],
    ['Zeitraum', `${day(print.startsOn)} bis ${day(print.endsOn)}`],
  ])}
  <h2>Aufgaben</h2><p>${text(print.tasks)}</p>
  <h2>Befugnisse</h2><p>${text(print.powers)}</p>
  <h2>Grundlage</h2><p>Übertragung von Pflichten des Arbeitgebers nach § 13 Abs. 2 ArbSchG und § 13 DGUV Vorschrift 1.</p>
  ${signed}`

  return { html: page(body), footerHtml: footer(fingerprint), margin }
}
