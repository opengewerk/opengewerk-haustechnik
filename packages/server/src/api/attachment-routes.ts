import { documentGone, type Right } from '@opengewerk/haustechnik-domain'
import type { AttachmentRights, AttachmentRoutes } from '@opengewerk/platform-server'

import type { DocumentPlaceColumns } from '../database/schema/attachments.js'
import { attachments, attachmentVersions } from '../database/schema/index.js'

/** The right of the routes that hand out a document: looking at documents. */
export const attachmentRights: AttachmentRights<Right> = {
  read: 'document.read',
}

/**
 * The documents of an operator, handed out by version (#97, section 4.10 of
 * the concept), on the routes of the foundation (ADR 0010 of the repository
 * opengewerk).
 *
 * Asked by the id of a version and never by hash. The route of the foundation
 * finds the version together with its document, in the tenant of whoever
 * asks and under the policies of both tables: a document outside the areas of
 * the person is not there, and neither is a version of it. A document that is
 * marked is not handed out any more, and a record that is marked takes its
 * documents along (`mark_documents_below`), so nothing is left to look at
 * here before a file goes out. An older version is handed out like the
 * newest.
 */
export const attachmentRoutes: AttachmentRoutes<DocumentPlaceColumns> = {
  tables: { attachments, attachmentVersions },
  gone: documentGone,
}
