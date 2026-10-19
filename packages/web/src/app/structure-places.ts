import { type RecordState } from '@opengewerk/haustechnik-domain'
import { maybeText, text } from '@opengewerk/platform-web/sync'

/**
 * Where a board and a circuit of it are opened, below the asset they hang on
 * (#349), and how a circuit is named. Apart from `electrical.ts`, which
 * brings the whole building block of the foundation with it, so that a page
 * that only links to a circuit, as a defect found on one does (#350), stays
 * light. The same words in both entries; the one on site lives under `/m`.
 */
export const structurePlaces = {
  board: (assetId: string, boardId: string) => `/anlagen/${assetId}/verteiler/${boardId}`,
  circuit: (assetId: string, boardId: string, circuitId: string) =>
    `/anlagen/${assetId}/verteiler/${boardId}/stromkreise/${circuitId}`,
} as const

/** "F3 Steckdosen Werkbank": a circuit by its designation and what it feeds. */
export function circuitTitle(circuit: RecordState): string {
  return [text(circuit, 'designation'), maybeText(circuit, 'consumer')].filter(Boolean).join(' ')
}
