import { shutsDownItsAsset } from './asset-condition.js'
import type { Catalogue } from './catalogue.js'
import type { Defect } from './defect.js'
import type { DefectEntry } from './defect-register.js'
import { byNameIn } from './name-order.js'
import { defectWhere } from './office-table.js'

/**
 * The report of the defects as a PDF (section 4.6 of the concept, #345):
 * what the list "Mängel" shows under its filters, a block for each building,
 * a row for each defect with where it is, its class, the day it was found and
 * the day by which it is to be set right, its status and its first photo.
 * Made for the moment it is asked for, which its head names with the hour,
 * and never kept (decided by Moritz on 15.10.2026): a later report says how
 * things stand then.
 */
export const defectReportWords = {
  title: 'Mängelbericht',
  unsafe: 'Anlage außer Betrieb',
  overdue: 'Über der Frist',
  noPhoto: 'Kein Foto',
  /** A photo that is no picture or too large to be put in the report, which stays at the defect. */
  photoElsewhere: 'Foto am Mangel',
  footer: 'Der Bericht zeigt den Stand beim Abruf und wird nicht aufbewahrt.',
} as const

/** The defects of the report at one building, or at a property apart from its buildings. */
export interface DefectReportBlock {
  /** The name of the building, or of the property for what hangs on it alone. */
  readonly title: string
  /** The property of a building; "Liegenschaft" for a property. */
  readonly sub: string
  readonly defects: readonly DefectEntry[]
}

/** What the places of a defect are named by: the places for whoever reads them, the assets as well. */
export interface DefectReportReads {
  readonly places: boolean
  readonly assets: boolean
}

/**
 * The defects of the report in blocks, one for each building and one for
 * what hangs on a property alone, the properties and their buildings in the
 * order of their names, a property before its buildings; within a block the
 * defects stay in the order of the list. Whoever does not read the places
 * gets the blocks with the words the list has for them.
 */
export function defectReportBlocks(
  defects: readonly DefectEntry[],
  reads: DefectReportReads,
): DefectReportBlock[] {
  const blocks = new Map<
    string,
    { property: string; building: string | null; defects: DefectEntry[] }
  >()

  for (const defect of defects) {
    const { place } = defect
    const key = `${place.propertyId}/${place.buildingId ?? ''}`
    const block = blocks.get(key) ?? {
      property: reads.places ? place.propertyName : 'Liegenschaft',
      building:
        place.buildingId === null
          ? null
          : reads.places
            ? (place.buildingName ?? 'Gebäude')
            : 'Gebäude',
      defects: [],
    }

    block.defects.push(defect)
    blocks.set(key, block)
  }

  return [...blocks.values()]
    .sort(
      (left, right) =>
        byNameIn(left.property, right.property) ||
        (left.building === null ? -1 : 0) - (right.building === null ? -1 : 0) ||
        byNameIn(left.building ?? '', right.building ?? ''),
    )
    .map((block) => ({
      title: block.building ?? block.property,
      sub: block.building === null ? 'Liegenschaft' : block.property,
      defects: block.defects,
    }))
}

/**
 * Where a defect of the report is, in two lines under its block, which names
 * the property and the building already: the asset with its room under it,
 * or the room, the building or the property alone.
 */
export function defectReportWhere(
  defect: DefectEntry,
  reads: DefectReportReads,
): { readonly name: string; readonly sub: string } {
  const where = defectWhere(defect.place, reads)
  const room = reads.places ? defect.place.roomLabel : null

  return { name: where.name, sub: defect.place.asset === null ? '' : (room ?? '') }
}

/**
 * The line of the report under its choice: how many defects it lists, how
 * many of them are past their deadline, and how many put their asset out of
 * service. "4 Mängel, davon 1 über der Frist; 1 setzt seine Anlage außer
 * Betrieb."
 */
export function defectReportCount(
  defects: readonly DefectEntry[],
  shutsDown: (defect: DefectEntry) => boolean,
): string {
  const total = defects.length
  const late = defects.filter((defect) => defect.overdue).length
  const unsafe = defects.filter(shutsDown).length
  const counted = `${String(total)} ${total === 1 ? 'Mangel' : 'Mängel'}`
  const overdue = late === 0 ? '' : `, davon ${String(late)} über der Frist`
  const shut =
    unsafe === 0
      ? ''
      : `; ${String(unsafe)} ${unsafe === 1 ? 'setzt seine Anlage' : 'setzen ihre Anlage'} außer Betrieb`

  return `${counted}${overdue}${shut}.`
}

/** Whether a defect of the list puts the asset it is at out of service (`shutsDownItsAsset`). */
export function entryShutsDown(
  defect: DefectEntry,
  catalogue: Pick<Catalogue, 'defectClass'>,
): boolean {
  return shutsDownItsAsset(
    {
      assetId: (defect.place.asset?.id ?? null) as Defect['assetId'],
      status: defect.status,
      defectClass: defect.defectClass,
    },
    catalogue,
  )
}
