import { boardAssetKind } from '@opengewerk/haustechnik-domain'

/**
 * Whether an asset of this kind has boards: only a low-voltage installation
 * has (#349). Apart from `electrical.ts`, which hands it on, so that the page
 * of an asset on site asks it without pulling the foundation's electrical
 * structure into the entry on site (`scripts/budget.js`).
 */
export function holdsBoards(kind: string | null | undefined): boolean {
  return kind === boardAssetKind
}
