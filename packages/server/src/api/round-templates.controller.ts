import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common'
import {
  type Catalogue,
  canonicalForm,
  dutyHasEnded,
  type DutyId,
  isTemplateDefinition,
  type RoundTemplateId,
  storedTemplate,
  type TemplateDefinition,
  templateLimits,
  templateOfFormKey,
  templatePointers,
  templateProblemLines,
  templateProblems,
  type TemplateRecords,
} from '@opengewerk/haustechnik-domain'
import {
  CurrentIdentity,
  Database,
  isUuid,
  type TenantTransaction,
} from '@opengewerk/platform-server'
import { and, count, desc, eq, inArray, isNull, like } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'

import { CATALOGUE } from '../catalogue.js'
import {
  activities,
  assets,
  duties,
  rooms,
  roundTemplates,
  roundTemplateVersions,
} from '../database/schema/index.js'
import { dayInGermany } from '../today.js'
import { RequiresPermission } from './authorization.js'
import type { Asking } from './places.js'

const missing = 'Diese Vorlage gibt es nicht.'

/** How many rounds stand on a version of a template, as far as the person sees them. */
export interface TemplateRounds {
  readonly templateId: RoundTemplateId
  readonly formVersion: number
  readonly rounds: number
}

/** What the editor sends: a version, and for a new template where it was taken from. */
interface Draft {
  readonly definition: TemplateDefinition
  readonly asksCountersignature: boolean
}

function draftOf(body: unknown): Draft {
  const values = (typeof body === 'object' && body !== null ? body : {}) as Readonly<
    Record<string, unknown>
  >
  const { definition, asksCountersignature } = values

  if (!isTemplateDefinition(definition)) {
    throw new BadRequestException('Eine Vorlage hat eine Bezeichnung und Kapitel mit Punkten.')
  }

  if (JSON.stringify(definition).length > templateLimits.definition) {
    throw new BadRequestException('Diese Vorlage ist zu groß, um sie zu speichern.')
  }

  if (typeof asksCountersignature !== 'boolean') {
    throw new BadRequestException('Ob die Vorlage eine Gegenzeichnung verlangt, ist ja oder nein.')
  }

  return { definition: storedTemplate(definition), asksCountersignature }
}

/** The ids among `ids` that a table holds for the person asking, live ones only where asked. */
async function present(
  tx: TenantTransaction,
  table: PgTable & { id: PgColumn; deletedAt: PgColumn },
  ids: readonly string[],
  live: boolean,
): Promise<Set<string>> {
  const asked = ids.filter((id) => isUuid(id))

  if (asked.length === 0) {
    return new Set()
  }

  const rows = (await tx
    .select({ id: table.id })
    .from(table)
    .where(
      live ? and(inArray(table.id, asked), isNull(table.deletedAt)) : inArray(table.id, asked),
    )) as { id: string }[]

  return new Set(rows.map((row) => row.id))
}

/**
 * The templates of the rounds (#112, sections 2.5 and 4.5 of the concept).
 * The office reads them where every device does, out of the sync; here a new
 * one is made, empty or taken over from a package, a new version of one is
 * saved, and the rounds on each version are counted.
 *
 * A version is checked by the same function as in the editor and by the form
 * engine of the foundation, against the assets, rooms and duties the person
 * sees and against the catalogue; a version refused says each problem with
 * the point it is about. Who changes a template sees everything it names,
 * in the version that stands as in the new one (decided on 04.10.2026).
 */
@Controller('round-templates')
export class RoundTemplatesController {
  constructor(
    private readonly database: Database,
    @Inject(CATALOGUE) private readonly catalogue: Catalogue,
  ) {}

  /** The rounds on each version of each template, in the areas of the person asking. */
  @Get('rounds')
  @RequiresPermission('activity.read')
  rounds(@CurrentIdentity() identity: Asking): Promise<TemplateRounds[]> {
    return this.database.forTenant(identity, async (tx) => {
      const rows = await tx
        .select({
          formKey: activities.formKey,
          formVersion: activities.formVersion,
          rounds: count(),
        })
        .from(activities)
        .where(
          and(
            eq(activities.kind, 'round'),
            like(activities.formKey, 'template-%'),
            isNull(activities.deletedAt),
          ),
        )
        .groupBy(activities.formKey, activities.formVersion)

      return rows.flatMap(({ formKey, formVersion, rounds }) => {
        const templateId = formKey === null ? null : templateOfFormKey(formKey)

        return templateId === null || formVersion === null
          ? []
          : [{ templateId, formVersion, rounds }]
      })
    })
  }

  /**
   * A new template with its first version. Taken over from a package, it
   * names the template of the package and the version in force today; what
   * the person changed before saving is theirs.
   */
  @Post()
  @RequiresPermission('template.write')
  create(
    @CurrentIdentity() identity: Asking,
    @Body() body: unknown,
  ): Promise<{ id: RoundTemplateId; formVersion: number }> {
    const draft = draftOf(body)
    const sourceKey = (body as { readonly sourceKey?: unknown }).sourceKey ?? null
    const source =
      typeof sourceKey === 'string'
        ? this.catalogue.roundTemplate(sourceKey, dayInGermany(new Date()))
        : null

    if (sourceKey !== null && source === null) {
      throw new BadRequestException('Diese Vorlage bringt kein Paket dieses Servers mit.')
    }

    return this.database.forTenant(identity, async (tx) => {
      await this.check(tx, draft.definition)

      const [template] = await tx
        .insert(roundTemplates)
        .values({
          tenantId: identity.tenantId,
          title: draft.definition.title,
          sourceKey: source?.key ?? null,
          sourceVersion: source?.version ?? null,
        })
        .returning()

      if (!template) {
        throw new Error('The template was not written.')
      }

      await tx.insert(roundTemplateVersions).values({
        tenantId: identity.tenantId,
        templateId: template.id,
        formVersion: 1,
        definition: draft.definition,
        asksCountersignature: draft.asksCountersignature,
      })

      return { id: template.id, formVersion: 1 }
    })
  }

  /**
   * The next version of a template. The editor names the version it began
   * from: one saved by somebody else meanwhile is the version that stands,
   * and the change is refused rather than laid over it unseen. The template
   * is held until the version is written, so two saving at once take turns.
   */
  @Post(':id/versions')
  @RequiresPermission('template.write')
  addVersion(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<{ id: RoundTemplateId; formVersion: number }> {
    const draft = draftOf(body)
    const basedOn = (body as { readonly basedOn?: unknown }).basedOn

    if (!isUuid(id)) {
      throw new NotFoundException(missing)
    }

    return this.database.forTenant(identity, async (tx) => {
      const [template] = await tx
        .select()
        .from(roundTemplates)
        .where(and(eq(roundTemplates.id, id as RoundTemplateId), isNull(roundTemplates.deletedAt)))
        .for('no key update')

      if (!template) {
        throw new NotFoundException(missing)
      }

      const [newest] = await tx
        .select()
        .from(roundTemplateVersions)
        .where(eq(roundTemplateVersions.templateId, template.id))
        .orderBy(desc(roundTemplateVersions.formVersion))
        .limit(1)

      if (!newest) {
        throw new NotFoundException(missing)
      }

      if (basedOn !== newest.formVersion) {
        throw new ConflictException(
          `Inzwischen ist die Fassung ${String(newest.formVersion)} gespeichert. Sie steht jetzt im Editor; ändern Sie dort weiter.`,
        )
      }

      if (
        canonicalForm(newest.definition) === canonicalForm(draft.definition) &&
        newest.asksCountersignature === draft.asksCountersignature
      ) {
        throw new BadRequestException(
          'Die Vorlage ist unverändert. Eine neue Fassung entsteht mit einer Änderung.',
        )
      }

      await this.seesEverything(tx, newest.definition)
      await this.check(tx, draft.definition)

      const formVersion = newest.formVersion + 1

      await tx.insert(roundTemplateVersions).values({
        tenantId: identity.tenantId,
        templateId: template.id,
        formVersion,
        definition: draft.definition,
        asksCountersignature: draft.asksCountersignature,
      })
      await tx
        .update(roundTemplates)
        .set({ title: draft.definition.title })
        .where(eq(roundTemplates.id, template.id))

      return { id: template.id, formVersion }
    })
  }

  /**
   * Whether the person sees every asset, room and duty a version names,
   * those that are gone among them: a template that points into an area is
   * changed only by somebody who sees it (section 4.5).
   */
  private async seesEverything(tx: TenantTransaction, definition: TemplateDefinition) {
    const named = templatePointers(definition)
    const seen = await Promise.all([
      present(tx, assets, named.assets, false),
      present(tx, rooms, named.rooms, false),
      present(tx, duties, named.duties, false),
    ])
    const all = [named.assets, named.rooms, named.duties].every((ids, index) =>
      ids.every((each) => seen[index]?.has(each) === true),
    )

    if (!all) {
      throw new ForbiddenException(
        'Diese Vorlage zeigt auf Anlagen, Räume oder Pflichten in Bereichen, die Sie nicht sehen. Ändern kann sie, wer diese Bereiche sieht.',
      )
    }
  }

  /** Refuses a version with a problem, each named with its point. */
  private async check(tx: TenantTransaction, definition: TemplateDefinition) {
    const problems = templateProblems(definition, await this.recordsFor(tx, definition))
    const lines = templateProblemLines(definition, problems)

    if (lines.length > 0) {
      throw new BadRequestException(lines.join(' '))
    }
  }

  /** What a version names, as the person asking sees it today, and the rules of the catalogue. */
  private async recordsFor(
    tx: TenantTransaction,
    definition: TemplateDefinition,
  ): Promise<TemplateRecords> {
    const named = templatePointers(definition)
    const today = dayInGermany(new Date())
    const [liveAssets, liveRooms] = await Promise.all([
      present(tx, assets, named.assets, true),
      present(tx, rooms, named.rooms, true),
    ])
    const askedDuties = named.duties.filter((id) => isUuid(id))
    const dutyRows =
      askedDuties.length === 0
        ? []
        : await tx
            .select()
            .from(duties)
            .where(and(inArray(duties.id, askedDuties as DutyId[]), isNull(duties.deletedAt)))
    const dutyById = new Map(dutyRows.map((row) => [row.id as string, row]))

    return {
      record: (kind, id) => (kind === 'asset' ? liveAssets : liveRooms).has(id),
      duty: (id) => {
        const row = dutyById.get(id)

        if (row === undefined || dutyHasEnded(row, today)) {
          return null
        }

        const kind =
          row.kind === null || row.kindVersion === null
            ? null
            : this.catalogue.dutyKindVersion(row.kind, row.kindVersion)

        return {
          assetId: row.assetId,
          roomId: row.roomId,
          // An own duty names no kind and takes any evidence (section 4.3).
          takesRoundPoint:
            row.kind === null ||
            (kind !== null && kind.definition.evidence.kinds.includes('round_point')),
        }
      },
      ruleUnits: (key) => {
        const records = this.catalogue.ruleRecords(key)

        return records.length === 0 ? null : records.map((rule) => rule.record.unit)
      },
    }
  }
}
