import { BadRequestException, Controller, Get, Header, Query, StreamableFile } from '@nestjs/common'
import {
  type DocumentHome,
  documentHomeLabel,
  documentKinds,
  documentTargetFields,
} from '@opengewerk/haustechnik-domain'
import { CurrentIdentity, Database, tableAnswer, tableFormatOf } from '@opengewerk/platform-server'

import { dayInGermany } from '../today.js'
import { RequiresPermission } from './authorization.js'
import { documentTable } from './office-tables.js'
import type { Asking } from './places.js'
import { said } from './register-question.js'

const homes: readonly string[] = ['propertyId', ...documentTargetFields]

/**
 * The list "Dokumente" of the office as a table (#236, section 4.10 of the
 * concept). The documents themselves, their versions and their files are
 * the foundation's, and the list on the screen is read from the device; a
 * table is written by the server, so this route reads what a device of the
 * person holds: the documents of the places in their areas.
 */
@Controller('attachments')
export class DocumentsController {
  constructor(private readonly database: Database) {}

  /**
   * The documents as a table, as a workbook or as text (`?format=xlsx` or
   * `csv`): each with its newest file, its kind, what it hangs on, how many
   * versions it has and the day the newest was filed, the one changed last
   * first, narrowed to a kind (`kind`) and to what it hangs on (`home`) as
   * the list is. Whoever looks at documents reads it; what a document hangs
   * on is named for whoever reads that record.
   */
  @Get('table')
  @RequiresPermission('document.read')
  @Header('Cache-Control', 'no-store')
  table(
    @CurrentIdentity() identity: Asking,
    @Query() query: Readonly<Record<string, unknown>>,
  ): Promise<StreamableFile> {
    const format = tableFormatOf(query)
    const kind = said(query, 'kind') ?? null
    const home = said(query, 'home') ?? null

    if (kind !== null && !(documentKinds as readonly string[]).includes(kind)) {
      throw new BadRequestException('Diese Art von Dokument gibt es nicht.')
    }

    if (home !== null && !homes.includes(home)) {
      throw new BadRequestException(
        `Ein Dokument hängt an einem von: ${Object.values(documentHomeLabel).join(', ')}.`,
      )
    }

    return this.database.forTenant(identity, async (tx) =>
      tableAnswer(
        await documentTable(tx, identity, { kind, home: home as DocumentHome | null }),
        format,
        dayInGermany(),
      ),
    )
  }
}
