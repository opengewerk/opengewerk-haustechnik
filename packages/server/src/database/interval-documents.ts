import {
  type AttachmentId,
  type AttachmentVersionId,
  type Duty,
  type DutyIntervalDocument,
  type IsoDate,
  intervalDocumentReading,
} from '@opengewerk/haustechnik-domain'
import type { TenantTransaction } from '@opengewerk/platform-server'
import { asc, inArray } from 'drizzle-orm'

import { dayInGermany } from '../today.js'
import { attachments, attachmentVersions } from './schema/index.js'

/**
 * From how many documents on their rows are read whole rather than by a list
 * of ids, as `dutiesOnADay` reads the evidence.
 */
const readWholeFrom = 500

/**
 * The documents that bear the intervals of these duties (#74), each as its
 * duty reads it (`intervalDocumentReading`): the version the duty keeps,
 * which one that is, and the newest where a newer one lies over it. A
 * document taken out of the records is read as well, and says so.
 *
 * The transaction is the person's. A document lies on the property of its
 * duty, which the key of the database holds, so whoever sees the duty sees
 * the document and its versions.
 */
export async function intervalDocumentsOf(
  tx: TenantTransaction,
  rows: readonly Pick<Duty, 'id' | 'intervalDocumentId' | 'intervalDocumentVersionId'>[],
): Promise<ReadonlyMap<string, DutyIntervalDocument>> {
  const pointing = rows.filter(
    (duty) => duty.intervalDocumentId !== null && duty.intervalDocumentVersionId !== null,
  )
  const read = new Map<string, DutyIntervalDocument>()

  if (pointing.length === 0) {
    return read
  }

  const ids = [...new Set(pointing.map((duty) => duty.intervalDocumentId as AttachmentId))]
  const whole = ids.length >= readWholeFrom
  const documents = await tx
    .select({
      id: attachments.id,
      title: attachments.title,
      kind: attachments.kind,
      deletedAt: attachments.deletedAt,
    })
    .from(attachments)
    .where(whole ? undefined : inArray(attachments.id, ids))
  const versions = await tx
    .select({
      id: attachmentVersions.id,
      attachmentId: attachmentVersions.attachmentId,
      fileName: attachmentVersions.fileName,
      createdAt: attachmentVersions.createdAt,
      validUntil: attachmentVersions.validUntil,
    })
    .from(attachmentVersions)
    .where(whole ? undefined : inArray(attachmentVersions.attachmentId, ids))
    .orderBy(asc(attachmentVersions.id))
  const documentOf = new Map(documents.map((document) => [document.id as string, document]))
  const versionsOf = new Map<
    string,
    { id: AttachmentVersionId; filedOn: string; fileName: string; validUntil: IsoDate | null }[]
  >()

  for (const version of versions) {
    versionsOf.set(version.attachmentId, [
      ...(versionsOf.get(version.attachmentId) ?? []),
      {
        id: version.id,
        filedOn: dayInGermany(version.createdAt),
        fileName: version.fileName,
        validUntil: version.validUntil,
      },
    ])
  }

  for (const duty of pointing) {
    const document = documentOf.get(duty.intervalDocumentId as string)
    const reading =
      document === undefined
        ? null
        : intervalDocumentReading(
            {
              id: document.id,
              title: document.title,
              kind: document.kind,
              removed: document.deletedAt !== null,
            },
            versionsOf.get(document.id) ?? [],
            duty.intervalDocumentVersionId as AttachmentVersionId,
          )

    if (reading !== null) {
      read.set(duty.id, reading)
    }
  }

  return read
}
