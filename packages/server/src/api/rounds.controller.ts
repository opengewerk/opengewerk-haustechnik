import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Header,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  StreamableFile,
} from '@nestjs/common'
import {
  type Activity,
  type ActivityId,
  type ActivityStatus,
  activityProblems,
  addDays,
  byNameIn,
  type Catalogue,
  type DutyPerson,
  type IsoDate,
  type RoundDetails,
  roundStateOf,
  type RoundWeek,
  signatureLimits,
  type WeekRound,
  weekNamed,
} from '@opengewerk/haustechnik-domain'
import {
  accountsOf,
  CurrentIdentity,
  Database,
  isUuid,
  tableAnswer,
  tableFormatOf,
  type TenantTransaction,
} from '@opengewerk/platform-server'
import { and, asc, between, desc, eq, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm'

import { closeAsNotPerformed } from '../activities/closing.js'
import { reopeningOf, ReopeningRefusal, reopenRound } from '../activities/reopening.js'
import {
  pageOf,
  SigningRefusal,
  signaturesWithTheirStanding,
  takeSignature,
} from '../activities/signing.js'
import { CATALOGUE } from '../catalogue.js'
import { activities, defects, evidence, roundPlans } from '../database/schema/index.js'
import { EvidenceRefusal } from '../evidence/write.js'
import { type Handed, tellHandedOut } from '../notifications/tell.js'
import { pointAssetNames } from '../rounds/point-assets.js'
import { dayInGermany } from '../today.js'
import { candidatesIn, inSight } from './activities.controller.js'
import { RequiresPermission } from './authorization.js'
import { roundWeekTable } from './office-tables.js'
import { roundTable } from './round-tables.js'
import { type Asking, fieldsOf, refuse } from './places.js'
import { said } from './register-question.js'

/** The rounds the plans made: the rounds the overview of the week is about. */
const ofAPlan = and(
  eq(activities.kind, 'round'),
  isNotNull(activities.roundPlanId),
  isNull(activities.deletedAt),
)

/** The Monday of the week a body or an address names, refused when it names no day. */
function mondayOf(value: unknown): IsoDate {
  const monday = weekNamed(value)

  if (monday === null) {
    throw new BadRequestException('Die Woche ist ein Tag darin, geschrieben 2026-10-03.')
  }

  return monday
}

/** People by their names, in the order of the names. */
async function named(
  database: Database,
  userIds: readonly string[],
  asking: string,
): Promise<DutyPerson[]> {
  const accounts = await accountsOf(database, [...new Set(userIds)], asking)

  return [...new Set(userIds)]
    .map((userId) => ({ userId, name: accounts.get(userId)?.name ?? 'Unbekanntes Konto' }))
    .sort((left, right) => byNameIn(left.name, right.name))
}

/** How many rounds a person hands out at once: those of a plan in a week, with room to spare. */
const mostAtOnce = 50

/** The states in which a round goes to a person, or to nobody: until it is handed in (#559). */
const handedOnWhile: readonly ActivityStatus[] = ['open', 'started']

/**
 * The rounds of the plans in the office (#113, section 4.5 of the concept):
 * the overview of a week by building, who walks each round, and the
 * handing out of a week like the week before.
 *
 * Reading is `activity.read`, and whoever only performs is shown what is
 * given to them or to nobody, as their device holds it (`inSight`). Handing
 * out is `activity.write` and goes to one of the own people who perform in
 * the area of the round, or to nobody, which puts the round on the devices
 * of everybody there. A round that somebody has begun keeps its person.
 */
@Controller('rounds')
export class RoundsController {
  constructor(
    private readonly database: Database,
    @Inject(CATALOGUE) private readonly catalogue: Catalogue,
  ) {}

  /**
   * The rounds of a week, Monday to Sunday, with their state, and the rounds
   * of earlier weeks that are still open or begun: those are not quietly gone
   * (section 4.5) until somebody closes them with a reason. Waiting for the
   * countersignature is a round signed whose template asks for one that has
   * not been given.
   */
  @Get('week')
  @RequiresPermission('activity.read')
  week(@CurrentIdentity() identity: Asking, @Query('of') of: unknown): Promise<RoundWeek> {
    return this.readWeek(identity, mondayOf(of ?? dayInGermany(new Date())))
  }

  /**
   * The overview of a week as a table (#236), as a workbook or as text
   * (`?format=xlsx` or `csv`): a row for each round of the week and for each
   * one left open from earlier weeks, narrowed to an area (`area`) as the
   * screen narrows them. Whoever reads activities reads it, with the rounds
   * they are shown; who walks a round is named only for whoever may see the
   * staff.
   */
  @Get('week/table')
  @RequiresPermission('activity.read')
  @Header('Cache-Control', 'no-store')
  async weekTable(
    @CurrentIdentity() identity: Asking,
    @Query() query: Readonly<Record<string, unknown>>,
  ): Promise<StreamableFile> {
    const format = tableFormatOf(query)
    const today = dayInGermany(new Date())
    const area = said(query, 'area') ?? null

    if (area !== null && !isUuid(area)) {
      throw new BadRequestException('Diesen Bereich gibt es bei diesem Betreiber nicht.')
    }

    const week = await this.readWeek(identity, mondayOf(said(query, 'of') ?? today))

    return this.database.forTenant(identity, async (tx) =>
      tableAnswer(await roundWeekTable(this.database, tx, identity, week, area), format, today),
    )
  }

  /**
   * A round written down as a table (#344), after the routes of the week,
   * whose word would otherwise be taken for the id of a round.
   */
  @Get(':id/table')
  @RequiresPermission('activity.read')
  @Header('Cache-Control', 'no-store')
  table(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Query() query: Readonly<Record<string, unknown>>,
  ): Promise<StreamableFile> {
    return roundTable(this.database, identity, id, query)
  }

  /** The rounds of the week of a Monday and those left open before it, as the person is shown them. */
  private readWeek(identity: Asking, monday: IsoDate): Promise<RoundWeek> {
    return this.database.forTenant(identity, async (tx) => {
      const shown = inSight(identity)
      const rows = await tx
        .select({
          id: activities.id,
          planId: activities.roundPlanId,
          dueOn: activities.dueOn,
          status: activities.status,
          performerUserId: activities.performerUserId,
          // Named in full: in a subquery a bare column would be the signature's own.
          awaitsCountersignature: sql<boolean>`"activities"."countersignature_required" and not exists (
            select 1 from "activity_signatures"
             where "activity_signatures"."activity_id" = "activities"."id"
               and "activity_signatures"."role" = 'countersigner'
               and "activity_signatures"."deleted_at" is null)`,
        })
        .from(activities)
        .where(and(ofAPlan, between(activities.dueOn, monday, addDays(monday, 6)), shown))
        .orderBy(activities.dueOn, activities.id)
      const before = await tx
        .select({
          id: activities.id,
          planId: activities.roundPlanId,
          dueOn: activities.dueOn,
          status: activities.status,
          performerUserId: activities.performerUserId,
        })
        .from(activities)
        .where(
          and(
            ofAPlan,
            lt(activities.dueOn, monday),
            inArray(activities.status, ['open', 'started']),
            shown,
          ),
        )
        .orderBy(desc(activities.dueOn), activities.id)

      return {
        weekOf: monday,
        rounds: rows.flatMap((row) => weekRoundOf(row, row.awaitsCountersignature)),
        before: before.flatMap((row) => weekRoundOf(row, false)),
      }
    })
  }

  /**
   * The people the plans and their rounds name, by their names and nothing
   * else, as far as the person asking sees them: whoever only performs, the
   * rounds given to them or to nobody (`inSight`), and no plan, which names
   * whoever walks the rounds of others.
   */
  @Get('people')
  @RequiresPermission('activity.read')
  async people(@CurrentIdentity() identity: Asking): Promise<DutyPerson[]> {
    const shown = inSight(identity)
    const userIds = await this.database.forTenant(identity, async (tx) => {
      const ofRounds = await tx
        .selectDistinct({ userId: activities.performerUserId })
        .from(activities)
        .where(and(ofAPlan, isNotNull(activities.performerUserId), shown))
      const ofPlans =
        shown === undefined
          ? await tx
              .selectDistinct({ userId: roundPlans.performerUserId })
              .from(roundPlans)
              .where(and(isNull(roundPlans.deletedAt), isNotNull(roundPlans.performerUserId)))
          : []

      return [...ofRounds, ...ofPlans].flatMap((row) => (row.userId === null ? [] : [row.userId]))
    })

    return named(this.database, userIds, identity.userId)
  }

  /**
   * Who may walk the rounds of an area: the own people who perform
   * activities, see the area and are not shut out (`candidatesIn`). For
   * whoever plans in that area, and the name and nothing else of each person.
   */
  @Get('performers')
  @RequiresPermission('activity.write')
  async performers(
    @CurrentIdentity() identity: Asking,
    @Query('area') area: unknown,
  ): Promise<DutyPerson[]> {
    if (typeof area !== 'string' || !isUuid(area)) {
      throw new BadRequestException('Es fehlt der Bereich, für den ausgewählt wird.')
    }

    const performers = await this.database.forTenant(identity, async (tx) => {
      const { rows } = await tx.execute<{ sees: boolean }>(
        sql`select (session_sees_all_areas() or ${area}::uuid = any(session_areas())) as sees`,
      )

      // An area the person does not see names nobody to them.
      return rows[0]?.sees === true ? (await candidatesIn(tx, area)).performers : []
    })

    return named(this.database, performers, identity.userId)
  }

  /**
   * Hands rounds out, each to a person or to nobody: those of a plan in a
   * week, as the office hands them out together. Every round named is one of
   * a plan that nobody has begun; otherwise none of them changes.
   */
  @Put('assignment')
  @RequiresPermission('activity.write')
  async assign(
    @CurrentIdentity() identity: Asking,
    @Body() body: unknown,
  ): Promise<{ ids: string[] }> {
    const asked = (body as { readonly rounds?: unknown } | null)?.rounds

    if (
      !Array.isArray(asked) ||
      asked.length === 0 ||
      asked.length > mostAtOnce ||
      !asked.every(
        (entry: unknown) =>
          typeof entry === 'object' &&
          entry !== null &&
          isUuid((entry as { id?: unknown }).id) &&
          ((entry as { performerUserId?: unknown }).performerUserId === null ||
            typeof (entry as { performerUserId?: unknown }).performerUserId === 'string'),
      )
    ) {
      throw new BadRequestException(
        `Zugeteilt werden bis zu ${String(mostAtOnce)} Rundgänge, jeder an eine Person oder an niemanden.`,
      )
    }

    const wanted = new Map(
      (asked as { id: string; performerUserId: string | null }[]).map((entry) => [
        entry.id,
        entry.performerUserId,
      ]),
    )

    const handed: Handed[] = []
    const answer = await this.database.forTenant(identity, async (tx) => {
      const rounds = await tx
        .select({
          id: activities.id,
          areaId: activities.areaId,
          status: activities.status,
          dueOn: activities.dueOn,
          performerUserId: activities.performerUserId,
        })
        .from(activities)
        .where(
          and(
            ofAPlan,
            inArray(activities.id, [...wanted.keys()] as (typeof activities.$inferSelect)['id'][]),
          ),
        )
        .for('no key update')

      if (rounds.length !== wanted.size) {
        throw new NotFoundException('Diesen Rundgang gibt es nicht oder nicht mehr.')
      }

      // A round that was begun goes to another person as well, when the one
      // walking it falls ill in the middle of the week (#559); one handed in
      // or closed stays with its person.
      const fixed = rounds.find((round) => !handedOnWhile.includes(round.status))

      if (fixed !== undefined) {
        throw new ConflictException(
          'Zugeteilt wird ein Rundgang, solange er offen oder begonnen ist. Einer davon ist schon abgegeben oder geschlossen.',
        )
      }

      const performersOf = new Map<string, readonly string[]>()

      for (const round of rounds) {
        const person = wanted.get(round.id) ?? null

        if (person === null || person === round.performerUserId) {
          continue
        }

        const performers =
          performersOf.get(round.areaId) ?? (await candidatesIn(tx, round.areaId)).performers

        performersOf.set(round.areaId, performers)

        if (!performers.includes(person)) {
          throw new BadRequestException(
            'Zuständig ist jemand, der Vorgänge ausführt und den Bereich sieht.',
          )
        }
      }

      const now = new Date()

      for (const round of rounds) {
        const person = wanted.get(round.id) ?? null

        if (person !== round.performerUserId) {
          await tx
            .update(activities)
            .set({ performerUserId: person, updatedAt: now })
            .where(and(eq(activities.id, round.id), inArray(activities.status, [...handedOnWhile])))
          handed.push({ activityId: round.id, userId: person, dueOn: round.dueOn })
        }
      }

      return { ids: rounds.map((round) => round.id) }
    })

    // Whoever a round went to is told, once for all that went to them (#126).
    await tellHandedOut(this.database, identity.tenantId, identity.userId, handed)

    return answer
  }

  /**
   * Hands out the rounds of a week like the week before (section 4.5): every
   * round of a plan that nobody has begun goes to whoever had the round of
   * the same plan seven days earlier, or to nobody if that one went to
   * nobody. A round without one a week earlier keeps its person, and so does
   * one whose person of last week no longer performs in its area.
   */
  @Post('like-last-week')
  @RequiresPermission('activity.write')
  async likeLastWeek(
    @CurrentIdentity() identity: Asking,
    @Body() body: unknown,
  ): Promise<{ handedOut: number; kept: number }> {
    const monday = mondayOf((body as { readonly weekOf?: unknown } | null)?.weekOf)
    const handed: Handed[] = []

    const answer = await this.database.forTenant(identity, async (tx) => {
      const rounds = await tx
        .select({
          id: activities.id,
          planId: activities.roundPlanId,
          areaId: activities.areaId,
          dueOn: activities.dueOn,
          performerUserId: activities.performerUserId,
        })
        .from(activities)
        .where(
          and(
            ofAPlan,
            eq(activities.status, 'open'),
            between(activities.dueOn, monday, addDays(monday, 6)),
          ),
        )
        .for('no key update')
      const lastWeek = await tx
        .select({
          planId: activities.roundPlanId,
          dueOn: activities.dueOn,
          performerUserId: activities.performerUserId,
        })
        .from(activities)
        .where(and(ofAPlan, between(activities.dueOn, addDays(monday, -7), addDays(monday, -1))))
      const before = new Map(
        lastWeek.map((round) => [
          `${String(round.planId)}|${String(round.dueOn)}`,
          round.performerUserId,
        ]),
      )
      const performersOf = new Map<string, readonly string[]>()
      const now = new Date()
      let handedOut = 0
      let kept = 0

      for (const round of rounds) {
        if (round.dueOn === null) {
          continue
        }

        const key = `${String(round.planId)}|${addDays(round.dueOn, -7)}`

        if (!before.has(key)) {
          kept += 1
          continue
        }

        const person = before.get(key) ?? null

        if (person === round.performerUserId) {
          continue
        }

        if (person !== null) {
          const performers =
            performersOf.get(round.areaId) ?? (await candidatesIn(tx, round.areaId)).performers

          performersOf.set(round.areaId, performers)

          if (!performers.includes(person)) {
            kept += 1
            continue
          }
        }

        await tx
          .update(activities)
          .set({ performerUserId: person, updatedAt: now })
          .where(and(eq(activities.id, round.id), eq(activities.status, 'open')))
        handed.push({ activityId: round.id, userId: person, dueOn: round.dueOn })
        handedOut += 1
      }

      return { handedOut, kept }
    })

    await tellHandedOut(this.database, identity.tenantId, identity.userId, handed)

    return answer
  }

  /**
   * The page of a round in the office (#115, section 4.5 of the concept):
   * where and when, who walks it, and once somebody signed it the page that
   * was signed, with every signature and whether it counts, the defects that
   * came of its answers and the evidence it was written down as. The answers
   * of a round nobody signed are not on it: until the signature they are the
   * work of whoever walks it.
   */
  @Get(':id')
  @RequiresPermission('activity.read')
  async read(@CurrentIdentity() identity: Asking, @Param('id') id: string): Promise<RoundDetails> {
    const read = await this.database.forTenant(identity, async (tx) => {
      const round = await roundOf(tx, identity, id)
      // A signature from before the round was opened again stands only in
      // the change log (#510).
      const standing = (await signaturesWithTheirStanding(tx, round)).filter(
        ({ signature }) =>
          round.reopenedAt === null || signature.createdAt.getTime() > round.reopenedAt.getTime(),
      )
      const signed = standing.some(({ signature }) => signature.role === 'signer')
      const found = signed
        ? await tx
            .select({
              id: defects.id,
              description: defects.description,
              defectClass: defects.defectClass,
              status: defects.status,
              roomId: defects.roomId,
              assetId: defects.assetId,
            })
            .from(defects)
            .where(and(eq(defects.foundInActivityId, round.id), isNull(defects.deletedAt)))
            .orderBy(asc(defects.createdAt), asc(defects.id))
        : []
      const written = await tx
        .select({ id: evidence.id, dutyId: evidence.dutyId, number: evidence.number })
        .from(evidence)
        .where(eq(evidence.activityId, round.id))
        .orderBy(asc(evidence.number))

      // The assets of its points for every asset, named (#343).
      const names = await pointAssetNames(tx, round.pointAssets)

      const reopening = await reopeningOf(tx, round, identity)

      return {
        round,
        standing,
        page: signed ? await pageOf(tx, round, this.catalogue) : null,
        found,
        written,
        names,
        reopening: typeof reopening === 'string' ? null : reopening,
      }
    })
    const { round, standing, reopening } = read
    const accounts = await accountsOf(
      this.database,
      [
        ...new Set([
          ...standing.map(({ signature }) => signature.signedBy),
          ...(round.performerUserId === null ? [] : [round.performerUserId]),
          ...(reopening === null ? [] : [reopening.signedBy]),
        ]),
      ],
      identity.userId,
    )
    const nameOf = (userId: string) => accounts.get(userId)?.name ?? unknownAccount
    const countersigned = standing.some(({ signature }) => signature.role === 'countersigner')

    return {
      id: round.id,
      planId: round.roundPlanId,
      title: round.title,
      status: round.status,
      state: roundStateOf(round.status, round.countersignatureRequired && !countersigned),
      dueOn: round.dueOn,
      performedOn: round.performedOn,
      propertyId: round.propertyId,
      buildingId: round.buildingId,
      areaId: round.areaId,
      performer:
        round.performerUserId === null
          ? null
          : { userId: round.performerUserId, name: nameOf(round.performerUserId) },
      countersignatureRequired: round.countersignatureRequired,
      formKey: round.formKey,
      formVersion: round.formVersion,
      closingReason: round.closingReason,
      page: read.page,
      signatures: standing.map(({ signature, valid }) => ({
        id: signature.id,
        role: signature.role,
        name: nameOf(signature.signedBy),
        signedAt: signature.signedAt.toISOString(),
        deviceInfo: signature.deviceInfo,
        path: signature.path,
        typedName: signature.typedName,
        valid,
      })),
      defects: read.found,
      evidence: read.written,
      ...(round.emptiedAt === null ? {} : { emptied: true as const }),
      pointAssets: round.pointAssets,
      assets: [...read.names].map(([id, asset]) => ({ id, ...asset })),
      reopenedAt: round.reopenedAt?.toISOString() ?? null,
      reopening:
        reopening === null
          ? null
          : {
              signer: nameOf(reopening.signedBy),
              signedAt: reopening.signedAt.toISOString(),
              defects: reopening.defects,
              readings: reopening.readings,
              evidence: reopening.evidence.map((each) => each.number),
            },
    }
  }

  /**
   * A handed-in round opened again (section 4.5 of the concept, #510,
   * decided on 21.10.2026): until its countersignature and while no defect
   * from its answers has a work order, by whoever gave its signature and by
   * whoever countersigns rounds, with a connection, in the office and on
   * site. Its answers stay; its signature counts no more, what it made is
   * removed, and an evidence written from it is declared invalid.
   */
  // Seeing the round is enough for the route: who may open it, the one who
  // signed or whoever countersigns, `reopeningOf` decides (S6).
  @Post(':id/reopening')
  @RequiresPermission('activity.read')
  async reopen(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
  ): Promise<RoundDetails> {
    await this.database.forTenant(identity, async (tx) => {
      const round = await roundOf(tx, identity, id)

      try {
        await reopenRound(
          tx,
          { tenantId: identity.tenantId, writtenBy: identity.userId, at: new Date() },
          identity,
          round.id,
        )
      } catch (error) {
        if (error instanceof ReopeningRefusal || error instanceof EvidenceRefusal) {
          throw new ConflictException(error.message)
        }

        throw error
      }
    })

    return this.read(identity, id)
  }

  /**
   * A round of a past day closed as not performed, with the reason (section
   * 4.5 of the concept, #115): while it is open or begun, by whoever plans
   * and hands out work. It stays readable with the reason and fulfils no
   * duty: what its points were to fulfil stays due. A device that still
   * holds it changes nothing of it afterwards, and its start no longer shows
   * it.
   */
  @Post(':id/close')
  @RequiresPermission('activity.write')
  async close(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<RoundDetails> {
    const { closingReason } = fieldsOf(body, ['closingReason'] as const)

    refuse(activityProblems({ status: 'not_performed', closingReason: closingReason ?? null }))

    await this.database.forTenant(identity, async (tx) => {
      const round = await roundOf(tx, identity, id)
      const today = dayInGermany()

      if (round.dueOn === null || round.dueOn >= today) {
        throw new ConflictException(
          'Mit Grund geschlossen wird ein Rundgang eines vergangenen Tages. Dieser ist noch zu gehen.',
        )
      }

      // Whoever signed it meanwhile waits for the evidence of the signature.
      if (!(await closeAsNotPerformed(tx, round.id, closingReason as string))) {
        throw new ConflictException(
          'Geschlossen wird ein Rundgang, solange er offen oder begonnen ist. Dieser ist schon unterschrieben oder abgeschlossen.',
        )
      }
    })

    return this.read(identity, id)
  }

  /**
   * The countersignature of the Objektleitung on a signed round whose
   * template asks for it (section 4.5 of the concept, #115, ADR 0004, points
   * 7 and 8): given in the office, with a connection, for the page as it was
   * shown, whose fingerprint has to be the one the server works out. With it
   * the round is written down, one evidence per duty a point of it fulfils;
   * without it there is none.
   */
  @Post(':id/countersignature')
  @RequiresPermission('activity.accept')
  async countersign(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<RoundDetails> {
    const values = fieldsOf(body, ['path', 'typedName', 'pageFingerprint', 'deviceInfo'] as const, [
      'path',
      'typedName',
      'deviceInfo',
    ])

    // The drawing or the typed name (#209), one of the two: `takeSignature` says which is wrong.
    if (
      (typeof values.path !== 'string' && typeof values.typedName !== 'string') ||
      typeof values.pageFingerprint !== 'string'
    ) {
      throw new BadRequestException('Es fehlen die Unterschrift und die Seite, für die sie gilt.')
    }

    const deviceInfo =
      typeof values.deviceInfo === 'string'
        ? values.deviceInfo.slice(0, signatureLimits.deviceInfo)
        : null
    // The names the evidence states are asked of the instance, outside a
    // tenant: of the people who signed, who walked it and who countersigns.
    const people = await this.database.forTenant(identity, async (tx) => {
      const round = await roundOf(tx, identity, id)
      const standing = await signaturesWithTheirStanding(tx, round)

      return [
        ...standing.map(({ signature }) => signature.signedBy),
        ...(round.performerUserId === null ? [] : [round.performerUserId]),
      ]
    })
    const accounts = await accountsOf(
      this.database,
      [...new Set([identity.userId, ...people])],
      identity.userId,
    )

    await this.database.forTenant(identity, async (tx) => {
      try {
        await takeSignature(
          tx,
          {
            tenantId: identity.tenantId,
            writtenBy: identity.userId,
            at: new Date(),
            catalogue: this.catalogue,
            nameOf: (userId) => accounts.get(userId)?.name ?? unknownAccount,
          },
          {
            activityId: id as ActivityId,
            role: 'countersigner',
            signedAt: new Date(),
            deviceInfo,
            path: typeof values.path === 'string' ? values.path : null,
            typedName: typeof values.typedName === 'string' ? values.typedName : null,
            pageFingerprint: values.pageFingerprint as string,
          },
        )
      } catch (error) {
        if (error instanceof SigningRefusal) {
          throw error.about === 'signature'
            ? new BadRequestException(error.message)
            : new ConflictException(error.message)
        }

        if (error instanceof EvidenceRefusal) {
          throw new ConflictException(error.message)
        }

        throw error
      }
    })

    return this.read(identity, id)
  }
}

const unknownAccount = 'Unbekanntes Konto'

const missingRound = 'Diesen Rundgang gibt es nicht oder nicht mehr.'

/** A round of a plan as the overview of a week shows it, none for one that names no plan or day. */
function weekRoundOf(
  row: {
    readonly id: string
    readonly planId: WeekRound['planId'] | null
    readonly dueOn: IsoDate | null
    readonly status: Activity['status']
    readonly performerUserId: string | null
  },
  awaitsCountersignature: boolean,
): WeekRound[] {
  return row.planId === null || row.dueOn === null
    ? []
    : [
        {
          id: row.id,
          planId: row.planId,
          dueOn: row.dueOn,
          state: roundStateOf(row.status, awaitsCountersignature),
          performerUserId: row.performerUserId,
        },
      ]
}

/**
 * The round behind an id, if the person asking is shown it: in their areas,
 * not marked deleted, and for whoever only performs, given to them or to
 * nobody. Every other gets the same answer as one that is not there.
 */
async function roundOf(tx: TenantTransaction, identity: Asking, id: string): Promise<Activity> {
  if (!isUuid(id)) {
    throw new NotFoundException(missingRound)
  }

  const [row] = await tx
    .select()
    .from(activities)
    .where(
      and(
        eq(activities.id, id as Activity['id']),
        eq(activities.kind, 'round'),
        isNull(activities.deletedAt),
        inSight(identity),
      ),
    )

  if (row === undefined) {
    throw new NotFoundException(missingRound)
  }

  return row as Activity
}
