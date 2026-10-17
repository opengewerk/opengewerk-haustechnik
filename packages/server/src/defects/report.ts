import {
  type Catalogue,
  type DefectEntry,
  type DefectRegisterFilter,
  defectRegisterStateLabel,
  isAllowed,
  withoutClass,
} from '@opengewerk/haustechnik-domain'
import type { TenantTransaction } from '@opengewerk/platform-server'
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm'

import type { Asking } from '../api/places.js'
import { placeNamesFor } from '../api/office-tables.js'
import { areas, assets, attachments, attachmentVersions } from '../database/schema/index.js'

/**
 * The largest photo the report of the defects puts in as it is, where its
 * version has no preview: one taken at its full size stays at the defect,
 * and the report says so instead of growing by megabytes for each row.
 */
export const largestPhotoInReport = 2 * 1024 * 1024

/** Which file of the store a row of the report shows, or that its photo stays at the defect. */
export type ReportPhotoFile = { readonly sha256: string; readonly mediaType: string } | 'elsewhere'

/**
 * The first photo of each of these defects, as the report of the defects
 * shows it (#345): of the documents at a defect the one filed first whose
 * newest version is a picture, read in its preview, which the device made
 * small (`previewLongEdge`), or as it is up to `largestPhotoInReport`. Read
 * as the person, so that nothing beyond their areas is shown either. A
 * defect without a picture is not in the map.
 */
export async function firstPhotosOf(
  tx: TenantTransaction,
  defectIds: readonly string[],
): Promise<ReadonlyMap<string, ReportPhotoFile>> {
  if (defectIds.length === 0) {
    return new Map()
  }

  const filed = await tx
    .select({ id: attachments.id, defectId: attachments.defectId })
    .from(attachments)
    .where(and(inArray(attachments.defectId, defectIds as never[]), isNull(attachments.deletedAt)))
    .orderBy(asc(attachments.createdAt), asc(attachments.id))
  const versions =
    filed.length === 0
      ? []
      : await tx
          .select({
            attachmentId: attachmentVersions.attachmentId,
            sha256: attachmentVersions.sha256,
            mediaType: attachmentVersions.mediaType,
            sizeBytes: attachmentVersions.sizeBytes,
            previewSha256: attachmentVersions.previewSha256,
          })
          .from(attachmentVersions)
          .where(
            and(
              inArray(
                attachmentVersions.attachmentId,
                filed.map((row) => row.id),
              ),
              isNull(attachmentVersions.deletedAt),
            ),
          )
          .orderBy(desc(attachmentVersions.createdAt), desc(attachmentVersions.id))
  const newest = new Map<string, (typeof versions)[number]>()

  for (const version of versions) {
    if (!newest.has(version.attachmentId)) {
      newest.set(version.attachmentId, version)
    }
  }

  const photos = new Map<string, ReportPhotoFile>()

  for (const document of filed) {
    const version = newest.get(document.id)

    if (
      document.defectId === null ||
      photos.has(document.defectId) ||
      version === undefined ||
      !version.mediaType.startsWith('image/')
    ) {
      continue
    }

    photos.set(
      document.defectId,
      version.previewSha256 !== null
        ? // A preview the device made is a JPEG (`previewQuality`).
          { sha256: version.previewSha256, mediaType: 'image/jpeg' }
        : version.sizeBytes <= largestPhotoInReport
          ? { sha256: version.sha256, mediaType: version.mediaType }
          : 'elsewhere',
    )
  }

  return photos
}

/**
 * What the report was asked for, in words, as its head says it: the list,
 * the place by its name, and the class. "Offen, Schulzentrum Am Lindenhain,
 * Gebäude Schulhaus, alle Klassen." A place is named for whoever reads the
 * places, an asset for whoever reads the assets; anybody else is told which
 * kind of place it was.
 */
export async function defectReportChoice(
  tx: TenantTransaction,
  identity: Asking,
  catalogue: Catalogue,
  filter: DefectRegisterFilter,
): Promise<string> {
  const names = await placeNamesFor(tx, identity)
  const parts = [defectRegisterStateLabel[filter.state ?? 'open']]

  const narrower = [filter.areaId, filter.buildingId, filter.roomId, filter.assetId].some(
    (id) => id !== undefined,
  )

  // A building, a room or an asset names the place well enough without its property.
  if (filter.propertyId !== undefined) {
    parts.push(names?.property(filter.propertyId) ?? 'eine Liegenschaft')
  } else if (!narrower) {
    parts.push('alle Liegenschaften')
  }

  if (filter.areaId !== undefined) {
    const [area] = await tx
      .select({ name: areas.name })
      .from(areas)
      .where(eq(areas.id, filter.areaId as never))

    parts.push(`Bereich ${area?.name ?? ''}`.trim())
  }

  if (filter.buildingId !== undefined) {
    parts.push(`Gebäude ${names?.building(filter.buildingId) ?? ''}`.trim())
  }

  if (filter.roomId !== undefined) {
    const room = names?.room(filter.roomId) ?? null
    const label =
      room === null
        ? ''
        : room.number !== null && room.number !== ''
          ? `${room.number} ${room.name}`
          : room.name

    parts.push(`Raum ${label}`.trim())
  }

  if (filter.assetId !== undefined) {
    const [asset] = isAllowed(identity, 'asset.read')
      ? await tx
          .select({ number: assets.number, name: assets.name })
          .from(assets)
          .where(eq(assets.id, filter.assetId as never))
      : []

    parts.push(
      ['Anlage', asset?.number, asset?.name]
        .filter((part) => part !== null && part !== undefined && part !== '')
        .join(' '),
    )
  }

  parts.push(
    filter.defectClass === undefined
      ? 'alle Klassen'
      : filter.defectClass === withoutClass
        ? 'ohne Klasse'
        : `Klasse ${catalogue.defectClass(filter.defectClass)?.defectClass.label ?? filter.defectClass}`,
  )

  return `${parts.join(', ')}.`
}

/** The work order of a defect in a row of the report: its number, or its title where it has none. */
export function orderWords(defect: DefectEntry): string | null {
  return defect.workOrder === null ? null : (defect.workOrder.number ?? defect.workOrder.title)
}
