import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common'
import {
  type ActivityId,
  byNameIn,
  type Catalogue,
  type CollectiveCandidates,
  type CollectivePlan,
  type CollectiveReport,
  collectivePlanProblems,
  collectiveReportProblems,
  type ContractorId,
  defectClassChoices,
  type DutyPerson,
  type EvidenceLink,
  type EvidenceResult,
  type IsoDate,
} from '@opengewerk/haustechnik-domain'
import { accountsOf, CurrentIdentity, Database, isUuid } from '@opengewerk/platform-server'
import { and, eq, isNull } from 'drizzle-orm'

import {
  collectiveCandidates,
  collectivePlace,
  CollectiveRefusal,
  composeCollective,
} from '../activities/collectives.js'
import { CATALOGUE } from '../catalogue.js'
import { activities } from '../database/schema/index.js'
import { writeCollectiveReport } from '../evidence/report.js'
import { EvidenceRefusal } from '../evidence/write.js'
import { tellHandedOut } from '../notifications/tell.js'
import { qualificationHints } from '../qualifications/hints.js'
import { dayInGermany } from '../today.js'
import { candidatesIn } from './activities.controller.js'
import { RequiresPermission } from './authorization.js'
import { checkContractor } from './contractor-checks.js'
import { type Asking, refuseOutsideItsArea, refuse } from './places.js'
import { said } from './register-question.js'

const missing = 'Diesen Sammelvorgang gibt es nicht oder nicht mehr.'

/** What stands for a person whose account is not there any more. */
const unknownAccount = 'Unbekanntes Konto'

/** A refusal of the composing as the answer it is. */
function answerOf(error: unknown): unknown {
  if (!(error instanceof CollectiveRefusal)) {
    return error
  }

  return error.about === 'missing'
    ? new NotFoundException(error.message)
    : error.about === 'invalid'
      ? new BadRequestException(error.message)
      : new ConflictException(error.message)
}

/** A text as it is kept: trimmed, and nothing where nothing was said. */
function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/** A day the address names, or the one given where it names none. */
function dayOf(value: string | undefined, otherwise: IsoDate): IsoDate {
  if (value === undefined) {
    return otherwise
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException('Ein Tag ist geschrieben 2026-10-03.')
  }

  return value as IsoDate
}

/**
 * Collective activities (section 4.4 of the concept, #342): composing one
 * from a duty kind and a place, and the report of a contractor for all of
 * its assets in one go.
 *
 * Composing is planning and handing out work (`activity.write`), and no right
 * of its own (decision of 15.10.2026). A collective activity takes only
 * duties in the area of its place, which the person sees: a property, a
 * building or a room of it. At the property itself only whoever holds its
 * area composes one. The report is entering evidence (`evidence.write`), as
 * the report of one duty is.
 */
@Controller('collectives')
export class CollectivesController {
  constructor(
    private readonly database: Database,
    @Inject(CATALOGUE) private readonly catalogue: Catalogue,
  ) {}

  /**
   * The duty kinds at a place, and for the one asked about its duties with
   * the day each is due on and the activity under way for it: what may be
   * taken, and what falls due between the two days asked, which the office
   * chooses at first.
   */
  @Get('candidates')
  @RequiresPermission('activity.write')
  async candidates(
    @CurrentIdentity() identity: Asking,
    @Query() query: Record<string, unknown>,
  ): Promise<CollectiveCandidates> {
    const propertyId = said(query, 'property')

    if (propertyId === undefined) {
      throw new BadRequestException('Ein Sammelvorgang steht auf einer Liegenschaft.')
    }

    const today = dayInGermany()

    // The days are asked so that a page can be read again with the same
    // question; what falls due between them is chosen in the office.
    dayOf(said(query, 'from'), today)
    dayOf(said(query, 'to'), today)

    const read = await this.database
      .forTenant(identity, async (tx) => {
        const place = await collectivePlace(tx, {
          propertyId,
          buildingId: said(query, 'building') ?? null,
          roomId: said(query, 'room') ?? null,
        })

        const kind = said(query, 'kind') ?? null
        const people = await candidatesIn(tx, place.areaId)

        return {
          ...(await collectiveCandidates(tx, this.catalogue, place, kind, today)),
          people,
          // The kind the parts are of asks the qualification of the whole (#515).
          hints:
            kind === null || !identity.rights.includes('qualification.read')
              ? {}
              : await qualificationHints(tx, this.catalogue, [kind], people.performers, today),
        }
      })
      .catch((error: unknown) => {
        throw answerOf(error)
      })
    const accounts = await accountsOf(
      this.database,
      [
        ...new Set([
          ...read.candidates.flatMap(({ activity }) =>
            activity?.performerUserId ? [activity.performerUserId] : [],
          ),
          ...read.people.responsible,
          ...read.people.performers,
        ]),
      ],
      identity.userId,
    )
    const people = (userIds: readonly string[]): DutyPerson[] =>
      userIds
        .map((userId) => ({ userId, name: accounts.get(userId)?.name ?? unknownAccount }))
        .sort((left, right) => byNameIn(left.name, right.name))

    return {
      kinds: read.kinds,
      elsewhere: read.elsewhere,
      people: {
        responsible: people(read.people.responsible),
        performers: people(read.people.performers),
      },
      hints: read.hints,
      candidates: read.candidates.map(({ activity, ...candidate }) => ({
        ...candidate,
        activity:
          activity === null
            ? null
            : {
                id: activity.id,
                kind: activity.kind,
                status: activity.status,
                partOfOne: activity.partOfOne,
                performer:
                  activity.performerUserId === null
                    ? null
                    : (accounts.get(activity.performerUserId)?.name ?? unknownAccount),
              },
      })),
    }
  }

  /**
   * Composes a collective activity: at the place, of the duty kind, with the
   * duties chosen, the title and the plan, which every part takes over. The
   * people named are candidates of the area of the place, as for any
   * activity, and the firm is one of the list. Whoever is named is told
   * once, of the collective activity.
   */
  @Post()
  @RequiresPermission('activity.write')
  async compose(
    @CurrentIdentity() identity: Asking,
    @Body() body: unknown,
  ): Promise<{ id: ActivityId }> {
    const values = (typeof body === 'object' && body !== null ? body : {}) as Record<
      string,
      unknown
    >
    const plan: CollectivePlan = {
      dutyKind: text(values['dutyKind']) ?? '',
      propertyId: text(values['propertyId']) ?? '',
      buildingId: text(values['buildingId']),
      roomId: text(values['roomId']),
      title: typeof values['title'] === 'string' ? values['title'] : '',
      dutyIds: Array.isArray(values['dutyIds']) ? (values['dutyIds'] as string[]) : [],
      responsibleUserId: text(values['responsibleUserId']),
      performer: values['performer'] as CollectivePlan['performer'],
      performerUserId: text(values['performerUserId']),
      contractorNote: text(values['contractorNote']),
      contractorId: text(values['contractorId']) as ContractorId | null,
      dueOn: values['dueOn'] as IsoDate,
    }

    refuse(collectivePlanProblems({ ...plan, dutyIds: values['dutyIds'] }))

    if (plan.dutyIds.some((id) => !isUuid(id))) {
      throw new BadRequestException(
        'Ein Sammelvorgang nimmt laufende Pflichten seiner Pflichtart an seinem Ort.',
      )
    }

    const today = dayInGermany()
    const made = await this.database
      .forTenant(identity, async (tx) => {
        const place = await collectivePlace(tx, plan)

        // At the property itself, only whoever holds its area (ADR 0003, addendum of #306).
        if (place.buildingId === null && place.roomId === null) {
          await refuseOutsideItsArea(tx, { areaId: place.propertyAreaId })
        }

        const { responsible, performers } = await candidatesIn(tx, place.areaId)

        if (plan.responsibleUserId !== null && !responsible.includes(plan.responsibleUserId)) {
          throw new BadRequestException(
            'Verantwortlich ist jemand, der Vorgänge plant und verteilt und den Bereich sieht.',
          )
        }

        if (plan.performerUserId !== null && !performers.includes(plan.performerUserId)) {
          throw new BadRequestException(
            'Ausführen kann, wer Vorgänge ausführt und den Bereich sieht.',
          )
        }

        if (plan.contractorId !== null) {
          await checkContractor(tx, plan.contractorId)
        }

        return composeCollective(
          tx,
          this.catalogue,
          identity.tenantId,
          place,
          plan,
          today,
          new Date(),
        )
      })
      .catch((error: unknown) => {
        throw answerOf(error)
      })

    await tellHandedOut(
      this.database,
      identity.tenantId,
      identity.userId,
      [plan.performerUserId, plan.responsibleUserId]
        .filter((userId): userId is string => userId !== null && userId !== identity.userId)
        .filter((userId, index, all) => all.indexOf(userId) === index)
        .map((userId) => ({ activityId: made, userId, dueOn: plan.dueOn })),
    )

    return { id: made }
  }

  /**
   * The report of a contractor for a collective activity: the file once, a
   * result for each asset with the defects at it, one evidence per duty.
   * While nobody has begun one of its assets on site.
   */
  @Post(':id/report')
  @RequiresPermission('evidence.write')
  async report(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<readonly EvidenceLink[]> {
    if (!isUuid(id)) {
      throw new NotFoundException(missing)
    }

    const values = (typeof body === 'object' && body !== null ? body : {}) as Record<
      string,
      unknown
    >
    // Accounts are read on the instance and never inside a tenant.
    const accounts = await accountsOf(this.database, [identity.userId], identity.userId)

    return this.database.forTenant(identity, async (tx) => {
      const [collective] = await tx
        .select()
        .from(activities)
        .where(and(eq(activities.id, id as ActivityId), isNull(activities.deletedAt)))

      if (collective === undefined || collective.collectiveKind === null) {
        throw new NotFoundException(missing)
      }

      // A defect named in the report takes the classes of the package of the
      // duty kind, or the general ones (section 4.6 of the concept, #116).
      const offered = new Set(
        defectClassChoices(this.catalogue, [collective.collectiveKind]).map(
          (choice) => choice.defectClass.key,
        ),
      )

      refuse(collectiveReportProblems(values, dayInGermany(), (key) => offered.has(key)))
      await checkContractor(tx, values['contractorId'] ?? null)

      try {
        const written = await writeCollectiveReport(
          tx,
          {
            tenantId: identity.tenantId,
            writtenBy: identity.userId,
            at: new Date(),
            catalogue: this.catalogue,
            nameOf: (userId) => accounts.get(userId)?.name ?? unknownAccount,
          },
          collective.id as ActivityId,
          reportOf(values),
        )

        return written.map((each) => ({ id: each.id, number: each.number }))
      } catch (error) {
        throw error instanceof EvidenceRefusal ? new ConflictException(error.message) : error
      }
    })
  }
}

/** The report as the body says it, once nothing is wrong with it. */
function reportOf(values: Readonly<Record<string, unknown>>): CollectiveReport {
  const file = values['file'] as Readonly<Record<string, unknown>>
  const parts = values['parts'] as readonly Readonly<Record<string, unknown>>[]

  return {
    performedOn: values['performedOn'] as IsoDate,
    examiner: text(values['examiner']) ?? '',
    examinerOrganisation: text(values['examinerOrganisation']) ?? '',
    contractorId: text(values['contractorId']) as ContractorId | null,
    file: {
      sha256: file['sha256'] as string,
      fileName: text(file['fileName']) ?? '',
      sizeBytes: file['sizeBytes'] as number,
      previewSha256: text(file['previewSha256']),
    },
    parts: parts.map((part) => ({
      activityId: part['activityId'] as string,
      result: part['result'] as EvidenceResult,
      resultReason: text(part['resultReason']),
      defects: ((part['defects'] ?? []) as readonly Readonly<Record<string, unknown>>[]).map(
        (defect) => ({
          description: text(defect['description']) ?? '',
          defectClass: text(defect['defectClass']),
          dueOn: text(defect['dueOn']),
        }),
      ),
    })),
  }
}
