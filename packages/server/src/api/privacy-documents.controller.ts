import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Res,
  StreamableFile,
} from '@nestjs/common'
import {
  changedSections,
  isPrivacyDocumentKind,
  type PrivacyDocumentKind,
  privacyDocumentKinds,
  type PrivacyDocuments,
  type PrivacyDocumentVersion,
  privacyDocumentWords,
} from '@opengewerk/haustechnik-domain'
import {
  accountsOf,
  CurrentIdentity,
  Database,
  type TenantTransaction,
} from '@opengewerk/platform-server'
import { and, desc, eq } from 'drizzle-orm'

import { privacyDocuments } from '../database/schema/index.js'
import { keeperOf } from '../labels/faces.js'
import {
  documentFacts,
  holdsFor as versionOfTheDocuments,
  madePrivacyDocument,
} from '../privacy/documents.js'
import { processingPrintJob } from '../processing-description/page.js'
import { RequiresPermission } from './authorization.js'
import type { Asking } from './places.js'
import { madeAtInWords } from './processing-descriptions.controller.js'
import { pdf, Printer } from './prints.controller.js'

/** What a route needs of the answer: one header. */
interface Response {
  setHeader(name: string, value: string): void
}

const noSuchDocument = 'Dieses Dokument gibt es bei diesem Betreiber nicht.'

function kindOf(value: string): PrivacyDocumentKind {
  if (!isPrivacyDocumentKind(value)) {
    throw new BadRequestException(`Ein Dokument „${value}“ gibt es nicht.`)
  }

  return value
}

/** The newest document of a kind, or none. */
async function newestOf(tx: TenantTransaction, kind: PrivacyDocumentKind) {
  const [row] = await tx
    .select({ text: privacyDocuments.text })
    .from(privacyDocuments)
    .where(eq(privacyDocuments.kind, kind))
    .orderBy(desc(privacyDocuments.createdAt), desc(privacyDocuments.id))
    .limit(1)

  return row ?? null
}

/**
 * The record of the processing, the technical and organisational measures and
 * the deletion concept (#358, section 9 of the concept): made by the Leitung
 * from what is set at the operator and, for the measures, at the instance;
 * kept with their day and printed as they were made, like the description of
 * the processing (#357). "Auskunft, Verfahrensbeschreibung und Verzeichnis
 * erzeugen" for every route, which only the Leitung holds.
 *
 * Held by `privacy-documents.test.ts` against the database: the other shipped
 * roles are refused at every route, the application role can neither change
 * nor remove a document, and another operator sees none of them, not by the
 * address of its PDF either.
 */
@Controller('settings/privacy-documents')
export class PrivacyDocumentsController {
  constructor(
    private readonly database: Database,
    private readonly printer: Printer,
  ) {}

  /** What each document says of the operator now, what one made now would change, and every one made, newest first. */
  @Get()
  @RequiresPermission('privacy.generate')
  async list(@CurrentIdentity() identity: Asking): Promise<PrivacyDocuments> {
    const read = await this.database.forTenant(identity, async (tx) => {
      const kinds = await Promise.all(
        privacyDocumentKinds.map(async (kind) => {
          const newest = await newestOf(tx, kind)
          const now =
            newest === null
              ? null
              : await madePrivacyDocument(this.database, tx, kind, madeAtInWords(new Date()))

          return {
            kind,
            facts: await documentFacts(this.database, tx, kind),
            changedSinceNewest:
              newest === null || now === null ? null : changedSections(newest.text, now),
          }
        }),
      )
      const rows = await tx
        .select({
          id: privacyDocuments.id,
          kind: privacyDocuments.kind,
          madeAt: privacyDocuments.createdAt,
          madeBy: privacyDocuments.madeBy,
          holdsFor: privacyDocuments.holdsFor,
          changed: privacyDocuments.changed,
        })
        .from(privacyDocuments)
        .orderBy(desc(privacyDocuments.createdAt), desc(privacyDocuments.id))

      return { kinds, rows }
    })
    const names = await accountsOf(
      this.database,
      [...new Set(read.rows.map((row) => row.madeBy))],
      identity.userId,
    )

    return {
      kinds: read.kinds,
      versions: read.rows.map((row): PrivacyDocumentVersion => ({
        id: row.id,
        kind: row.kind as PrivacyDocumentKind,
        madeAt: row.madeAt.toISOString(),
        madeBy: names.get(row.madeBy)?.name ?? null,
        holdsFor: row.holdsFor,
        changed: row.changed,
      })),
    }
  }

  /** A document of the kind made now and kept, with the sections that differ from the newest of its kind before it. */
  @Post(':kind')
  @RequiresPermission('privacy.generate')
  make(
    @CurrentIdentity() identity: Asking,
    @Param('kind') asked: string,
  ): Promise<PrivacyDocumentVersion> {
    const kind = kindOf(asked)

    return this.database.forTenant(identity, async (tx) => {
      const madeAt = new Date()
      const text = await madePrivacyDocument(this.database, tx, kind, madeAtInWords(madeAt))
      const newest = await newestOf(tx, kind)
      const changed = newest === null ? null : [...changedSections(newest.text, text)]
      const holdsFor = versionOfTheDocuments()
      const [row] = await tx
        .insert(privacyDocuments)
        .values({
          tenantId: identity.tenantId,
          kind,
          madeBy: identity.userId,
          holdsFor,
          text,
          changed,
          createdAt: madeAt,
          updatedAt: madeAt,
        })
        .returning({ id: privacyDocuments.id, madeAt: privacyDocuments.createdAt })

      return {
        id: row?.id ?? '',
        kind,
        madeAt: (row?.madeAt ?? madeAt).toISOString(),
        madeBy: null,
        holdsFor,
        changed,
      }
    })
  }

  /** A document as it was made, as a PDF. */
  @Get(':id/pdf')
  @RequiresPermission('privacy.generate')
  async print(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const found = await this.database.forTenant(identity, async (tx) => {
      const [row] = /^[0-9a-f-]{36}$/.test(id)
        ? await tx
            .select({
              kind: privacyDocuments.kind,
              text: privacyDocuments.text,
              madeAt: privacyDocuments.createdAt,
            })
            .from(privacyDocuments)
            .where(and(eq(privacyDocuments.id, id as typeof privacyDocuments.$inferSelect.id)))
        : []

      return row === undefined ? null : { ...row, operator: await keeperOf(tx) }
    })

    if (found === null) {
      throw new NotFoundException(noSuchDocument)
    }

    const title = privacyDocumentWords[found.kind as PrivacyDocumentKind].title
    const bytes = await this.printer.fresh(
      processingPrintJob(
        found.text,
        `${title} für ${found.operator}, erzeugt am ${madeAtInWords(found.madeAt)}.`,
      ),
    )

    return pdf(response, bytes, `${title} ${madeAtInWords(found.madeAt).slice(0, 10)}`)
  }
}
