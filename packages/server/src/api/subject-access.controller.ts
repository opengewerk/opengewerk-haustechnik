import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common'
import {
  byNameIn,
  missingRight,
  type SubjectAccess,
  type SubjectAccessChoice,
  subjectAccessFormat,
  type SubjectAccessFormat,
  subjectAccessFormats,
  type SubjectAccessMatch,
  subjectAccessNeedsEveryArea,
  type SubjectAccessPart,
  subjectAccessTermProblem,
  withoutDrawings,
} from '@opengewerk/haustechnik-domain'
import {
  accountsOf,
  CurrentIdentity,
  Database,
  dispositionFor,
  type TenantTransaction,
} from '@opengewerk/platform-server'
import { eq } from 'drizzle-orm'

import { memberAllAreas, memberships } from '../database/schema/index.js'
import { keeperOf } from '../labels/faces.js'
import { subjectAccessPrintJob, subjectAccessTitle } from '../subject-access/page.js'
import { accountParts, matchesOf, searchParts } from '../subject-access/read.js'
import { RequiresPermission } from './authorization.js'
import type { Asking } from './places.js'
import { pdf, Printer } from './prints.controller.js'

/** What a route needs of the answer: one header. */
interface Response {
  setHeader(name: string, value: string): void
}

/** Why there is no information: the person has no access at this operator. */
const noSuchPerson = 'Diese Person hat keinen Zugang bei diesem Betreiber.'

/** Why a file is not one of the two. */
const noSuchFormat = 'Die Auskunft gibt es als PDF oder als JSON.'

/** Whether the asking person sees every area, which a whole information needs. */
async function seesEveryArea(tx: TenantTransaction, userId: string): Promise<boolean> {
  const found = await tx
    .select({ userId: memberAllAreas.userId })
    .from(memberAllAreas)
    .where(eq(memberAllAreas.userId, userId))
    .limit(1)

  return found.length > 0
}

/** The asked file, or a refusal in words. */
function formatOf(format: unknown): SubjectAccessFormat {
  if (typeof format !== 'string' || !(subjectAccessFormats as readonly string[]).includes(format)) {
    throw new BadRequestException(noSuchFormat)
  }

  return format as SubjectAccessFormat
}

/**
 * The information about a person (#355, section 3 of the concept): what the
 * application holds about one person, from every module, as a PDF to read and
 * as JSON to take along. Only the Leitung makes it (decided on 15.10.2026,
 * "Auskunft, Verfahrensbeschreibung und Verzeichnis erzeugen"), and only a
 * Leitung that sees every area, since the information is whole or nothing.
 * For a person with an access by the access, for one without by a search
 * for a name or an address (decided on 19.10.2026); that the person asking is
 * the one it is about, the Leitung checks herself. Nothing of it is kept.
 *
 * The route that names a person in its path asks for the right of the
 * accesses, as every such route does, and for the right of the information
 * beside it.
 */
@Controller('settings/subject-access')
export class SubjectAccessController {
  constructor(
    private readonly database: Database,
    private readonly printer: Printer,
  ) {}

  /** Whom the information can be about, and whether the asking person sees every area. */
  @Get()
  @RequiresPermission('privacy.generate')
  async choice(@CurrentIdentity() identity: Asking): Promise<SubjectAccessChoice> {
    const here = await this.database.forTenant(identity, async (tx) => ({
      userIds: (await tx.select({ userId: memberships.userId }).from(memberships)).map(
        (row) => row.userId,
      ),
      everyArea: await seesEveryArea(tx, identity.userId),
    }))
    const accounts = await accountsOf(this.database, here.userIds, identity.userId)

    return {
      people: here.userIds
        .map((userId) => ({
          userId,
          name: accounts.get(userId)?.name ?? '',
          email: accounts.get(userId)?.email ?? '',
        }))
        .sort((one, other) => byNameIn(one.name, other.name)),
      everyArea: here.everyArea,
    }
  }

  /** The information about a person with an access here, as a PDF or as JSON. */
  @Get('people/:userId')
  @RequiresPermission('membership.read')
  async person(
    @CurrentIdentity() identity: Asking,
    @Param('userId') userId: string,
    @Query('format') format: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    if (!identity.rights.includes('privacy.generate')) {
      throw new ForbiddenException(missingRight('privacy.generate'))
    }

    const chosen = formatOf(format)
    const operator = await this.database.forTenant(identity, async (tx) => {
      if (!(await seesEveryArea(tx, identity.userId))) {
        throw new ForbiddenException(subjectAccessNeedsEveryArea)
      }

      const [member] = await tx
        .select({ userId: memberships.userId })
        .from(memberships)
        .where(eq(memberships.userId, userId))

      if (member === undefined) {
        throw new NotFoundException(noSuchPerson)
      }

      return keeperOf(tx)
    })
    const parts = await accountParts(this.database, identity, userId)
    const account = parts.find((each) => each.key === 'account')?.rows[0]

    return this.file(response, chosen, {
      format: subjectAccessFormat,
      version: 1,
      operator,
      madeAt: new Date().toISOString(),
      about: {
        kind: 'account',
        name: String(account?.['name'] ?? ''),
        email: String(account?.['email'] ?? ''),
      },
      parts,
    })
  }

  /** What a search for a name or an address finds, before the file is made. */
  @Get('matches')
  @RequiresPermission('privacy.generate')
  async matches(
    @CurrentIdentity() identity: Asking,
    @Query('term') term: unknown,
  ): Promise<SubjectAccessMatch[]> {
    return matchesOf((await this.searched(identity, term)).parts)
  }

  /** The information about what a search for a name or an address finds, as a PDF or as JSON. */
  @Get('matches/file')
  @RequiresPermission('privacy.generate')
  async search(
    @CurrentIdentity() identity: Asking,
    @Query('term') term: unknown,
    @Query('format') format: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const chosen = formatOf(format)
    const found = await this.searched(identity, term)

    return this.file(response, chosen, {
      format: subjectAccessFormat,
      version: 1,
      operator: found.operator,
      madeAt: new Date().toISOString(),
      about: { kind: 'search', term: String(term).trim() },
      parts: found.parts,
    })
  }

  /** The parts a search finds, for a Leitung that sees every area. */
  private searched(
    identity: Asking,
    term: unknown,
  ): Promise<{ readonly operator: string; readonly parts: SubjectAccessPart[] }> {
    const problem = subjectAccessTermProblem(term)

    if (problem !== null) {
      throw new BadRequestException(problem)
    }

    return this.database.forTenant(identity, async (tx) => {
      if (!(await seesEveryArea(tx, identity.userId))) {
        throw new ForbiddenException(subjectAccessNeedsEveryArea)
      }

      return { operator: await keeperOf(tx), parts: await searchParts(tx, String(term)) }
    })
  }

  /** The file, as it was asked for; kept nowhere, and not in a cache either. */
  private async file(
    response: Response,
    format: SubjectAccessFormat,
    access: SubjectAccess,
  ): Promise<StreamableFile> {
    const name = `${subjectAccessTitle(access)} ${access.madeAt.slice(0, 10)}`

    if (format === 'pdf') {
      return pdf(response, await this.printer.fresh(subjectAccessPrintJob(access)), name)
    }

    // Without the drawings of the signatures (#457): a file any editor
    // changes holds none, the PDF draws them.
    const bytes = Buffer.from(JSON.stringify(withoutDrawings(access), null, 2), 'utf-8')

    response.setHeader('Cache-Control', 'no-store')

    return new StreamableFile(bytes, {
      type: 'application/json; charset=utf-8',
      disposition: dispositionFor('application/json', `${name}.json`),
      length: bytes.byteLength,
    })
  }
}
