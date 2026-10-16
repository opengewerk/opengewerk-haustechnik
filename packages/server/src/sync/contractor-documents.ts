import { type Identity, isAllowed, missingRight, type Right } from '@opengewerk/haustechnik-domain'
import { type FoundIdentity, isUuid, type SyncCheck } from '@opengewerk/platform-server'
import { eq } from 'drizzle-orm'

import { attachments } from '../database/schema/index.js'

type Check = SyncCheck<FoundIdentity<Identity>>

/**
 * The certificates and the insurance of a contractor (#328) are kept by
 * whoever keeps the firms, whatever else is done to them: a new version,
 * a change of name or kind, and taking one out of the records ask for
 * "Fremdfirmen pflegen" on top of the right of the operation. That right
 * (`operationRights`) is read from what an operation says, and only making a
 * document says whether it hangs on a firm; everything after that is asked of
 * the document as the server holds it. Such a document lies in no area, so
 * the policies let it through for everybody in the operator, and this right
 * is all that holds it.
 *
 * Without the right the transmission is refused over this operation with the
 * right it lacks, as for any operation a person may not send. A version of a
 * document that is not there is left to its place (`versionPlace`).
 */
export const contractorDocumentKept: Check = keptBy('contractor.write', 'contractorId')

/**
 * The documents of a contract (#329) are kept by whoever keeps the contracts,
 * in the same way and for the same reason: they lie in no area, and nothing
 * but this right holds them.
 */
export const contractDocumentKept: Check = keptBy('contract.write', 'contractId')

/** The check that a document hanging on `column` is kept only with `right`. */
function keptBy(right: Right, column: 'contractorId' | 'contractId'): Check {
  return async ({ tx, operation, values, current, sender }) => {
    if (isAllowed(sender, right)) {
      return null
    }

    const refused = { kind: 'client', message: missingRight(right) } as const

    if (operation.entity === 'attachments') {
      // Making one says it itself, and its right asks for this one already.
      return operation.kind !== 'create' && isUuid(current?.[column]) ? refused : null
    }

    if (operation.entity !== 'attachment_versions') {
      return null
    }

    const documentId =
      operation.kind === 'create' ? values['attachmentId'] : current?.['attachmentId']

    if (!isUuid(documentId)) {
      return null
    }

    const [document] = await tx
      .select({ held: attachments[column] })
      .from(attachments)
      .where(eq(attachments.id, documentId as typeof attachments.$inferSelect.id))

    return document?.held === null || document === undefined ? null : refused
  }
}
