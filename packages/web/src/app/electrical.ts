import { boardAssetKind, type RecordState } from '@opengewerk/haustechnik-domain'
import { maybeText, text } from '@opengewerk/platform-web/sync'
import { useBoardsOf } from '@opengewerk/platform-web/electrical'

/**
 * The electrical structure below a low-voltage installation (#349), as this
 * application binds it. The forms and parts are the foundation's (ADR 0014 in
 * the repository opengewerk) and come from here as well, so that a screen
 * asks one module; what is this application's is that a board hangs on an
 * asset of one kind, where its pages and its circuit chart are, and the words
 * both entries say about it.
 */
export * from '@opengewerk/platform-web/electrical'

/** Whether an asset of this kind has boards: only a low-voltage installation has. */
export function holdsBoards(kind: string | null | undefined): boolean {
  return kind === boardAssetKind
}

/** The boards of an asset, in their order. */
export function useBoards(assetId: string | undefined) {
  return useBoardsOf('assetId', assetId)
}

/**
 * The address of the chart, for a button that prints it: every board of the
 * asset, or the one whose door it is for.
 */
export function circuitChartAddress(assetId: string, boardId?: string): string {
  const base = `/assets/${encodeURIComponent(assetId)}/circuit-chart`

  return boardId === undefined ? base : `${base}?board=${encodeURIComponent(boardId)}`
}

/**
 * Where a board and a circuit of it are opened, below the asset they hang on.
 * The same words in both entries; the one on site lives under `/m`.
 */
export const structurePlaces = {
  board: (assetId: string, boardId: string) => `/anlagen/${assetId}/verteiler/${boardId}`,
  circuit: (assetId: string, boardId: string, circuitId: string) =>
    `/anlagen/${assetId}/verteiler/${boardId}/stromkreise/${circuitId}`,
} as const

/** What both entries say about the structure, so that a board reads the same on both. */
export const structureWords = {
  noBoards: 'Für diese Anlage ist noch kein Verteiler erfasst.',
  noCircuits: 'Für diesen Verteiler ist noch kein Stromkreis erfasst.',
  emptySection: 'In diesem Feld ist noch kein Stromkreis.',
  withoutSection: 'Ohne Feld',
  direct: 'direkt am Verteiler',
  nothingKnown: 'Noch nichts zu Schutzeinrichtung und Leitung erfasst.',
  noEquipment: 'Noch kein Betriebsmittel an diesem Stromkreis.',
  noFacts: 'Zu diesem Stromkreis ist noch nichts eingetragen außer der Bezeichnung.',
  saved: 'Auf dem Gerät gesichert, übertragen beim nächsten Abgleich.',
  mayNot: 'Anlagen aufnehmen gehört nicht zu den Rechten dieses Zugangs.',
  notSentInChart: 'Noch nicht Übertragenes fehlt im Stromkreisverzeichnis.',
  noChart: 'Ohne Verbindung zum Server gibt es kein Stromkreisverzeichnis.',
} as const

/** "1 Feld", "3 Felder". */
export function sectionsInWords(total: number): string {
  return total === 1 ? '1 Feld' : `${String(total)} Felder`
}

/** "F3 Steckdosen Werkbank": a circuit by its designation and what it feeds. */
export function circuitTitle(circuit: RecordState): string {
  return [text(circuit, 'designation'), maybeText(circuit, 'consumer')].filter(Boolean).join(' ')
}

/**
 * What a piece of equipment is, under its name: its kind, maker and model,
 * and its serial number where it is known. The office separates them with a
 * middle dot as in every line under a name there, the site with a comma.
 */
export function equipmentLine(item: RecordState, separator: string): string {
  const serial = maybeText(item, 'serialNumber')

  return [
    maybeText(item, 'kind'),
    [maybeText(item, 'manufacturer'), maybeText(item, 'model')].filter(Boolean).join(' '),
    serial === null ? null : `SN ${serial}`,
  ]
    .filter((part): part is string => part !== null && part !== '')
    .join(separator)
}

/** The circuits of one place on a board: a section, or the board directly. */
export interface CircuitGroup {
  /** The id of the section, or the empty text for the circuits on the board directly. */
  readonly key: string
  readonly section: RecordState | null
  readonly circuits: readonly RecordState[]
}

/**
 * The circuits of a board in the order of its chart: those on the board
 * directly first, under "Ohne Feld", then each section with its own, as the
 * server prints them. A circuit whose section this device no longer holds,
 * one removed a moment ago, stands on the board directly until the next
 * exchange, as the chart prints it. Without sections the board is one group.
 */
export function circuitGroups(
  sections: readonly RecordState[],
  circuits: readonly RecordState[],
): readonly CircuitGroup[] {
  const known = new Set(sections.map((section) => String(section['id'])))
  const direct = circuits.filter((circuit) => {
    const section = maybeText(circuit, 'boardSectionId')

    return section === null || !known.has(section)
  })

  return [
    ...(direct.length > 0 || sections.length === 0
      ? [{ key: '', section: null, circuits: direct }]
      : []),
    ...sections.map((section) => {
      const id = String(section['id'])

      return {
        key: id,
        section,
        circuits: circuits.filter((circuit) => circuit['boardSectionId'] === id),
      }
    }),
  ]
}
