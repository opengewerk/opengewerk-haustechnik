import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Res,
  StreamableFile,
} from '@nestjs/common'
import {
  byNameIn,
  type Catalogue,
  delegationCovers,
  type DelegationDutyLine,
  type DelegationEntry,
  delegationProblems,
  type DelegationReading,
  type DelegationRole,
  delegationRoleLabel,
  delegationScopeWords,
  delegationState,
  delegationTermsOf,
  type DutyDelegationId,
  isLimited,
  type IsoDate,
  lastDayOf,
  packageOfKind,
  revocationProblems,
  signatureProblems,
  signedByBoth,
  typedNameIsOf,
} from '@opengewerk/haustechnik-domain'
import {
  accountsOf,
  beforeItsEnd,
  CurrentIdentity,
  Database,
  isUuid,
  type TenantTransaction,
} from '@opengewerk/platform-server'
import { memberships, tenantRoles } from '@opengewerk/platform-server/schema'
import { and, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm'

import { CATALOGUE } from '../catalogue.js'
import {
  areas,
  assets,
  buildings,
  duties,
  dutyDelegationAreas,
  dutyDelegationRevocations,
  dutyDelegations,
  dutyDelegationSignatures,
  memberAllAreas,
  memberAreas,
  properties,
  rooms,
} from '../database/schema/index.js'
import { dutyTitle } from '../database/duty-standing.js'
import { applyDelegations } from '../delegations/apply.js'
import {
  type HeldDelegation,
  heldDelegations,
  pageOf,
  standingOf,
  termsOf,
} from '../delegations/reading.js'
import { stateFingerprint } from '../evidence/fingerprint.js'
import { keeperOf } from '../labels/faces.js'
import { delegationPrintJob } from '../prints/record-page.js'
import { dayInGermany } from '../today.js'
import { RequiresPermission } from './authorization.js'
import { type Asking, refuse } from './places.js'
import { pdf, Printer } from './prints.controller.js'

const missing = 'Diese Pflichtenübertragung gibt es nicht, oder sie ist nicht für Sie.'
const signedAlready =
  'Eine Pflichtenübertragung mit Unterschrift wird nicht geändert und nicht entfernt. Sie bleibt, wie sie unterschrieben wurde; beenden lässt sie sich mit einem Widerruf.'

/** How many duties the page of a delegation lists by name. */
const dutiesShown = 50

/** The list "Pflichtenübertragungen", with how many duties in the areas of the person have nobody, or somebody without a delegation. */
export interface DelegationList {
  readonly delegations: readonly DelegationEntry[]
  readonly duties: { readonly withoutResponsible: number; readonly withoutDelegation: number }
}

/** The fields a body may send for a delegation. */
function termsFrom(body: unknown): Readonly<Record<string, unknown>> {
  const given = (body ?? {}) as Readonly<Record<string, unknown>>

  return {
    delegateUserId: given['delegateUserId'],
    areaIds: given['areaIds'],
    scope: given['scope'],
    packages: given['packages'] ?? [],
    costGroups: given['costGroups'] ?? [],
    tasks: given['tasks'],
    powers: given['powers'],
    startsOn: given['startsOn'],
    endsOn: given['endsOn'],
  }
}

/**
 * The delegations of the operator's duties (#336, section 4.3 of the
 * concept): written, signed for the operator and revoked by whoever may
 * delegate, which is the Leitung; read and signed by the person a
 * delegation goes to once the Leitung signed it, who also keeps its PDF as
 * the copy. Once somebody signed, nothing of it changes; the database holds
 * that too. A delegation that comes into force, or is revoked, is applied to
 * the duties at once, in every area of the operator.
 */
@Controller('delegations')
export class DelegationsController {
  constructor(
    private readonly database: Database,
    @Inject(CATALOGUE) private readonly catalogue: Catalogue,
    private readonly printer: Printer,
  ) {}

  @Get()
  @RequiresPermission('duty.delegate')
  async list(@CurrentIdentity() identity: Asking): Promise<DelegationList> {
    const today = dayInGermany()

    return this.database.forTenant(identity, async (tx) => {
      const held = await heldDelegations(tx)
      const names = await areaNames(tx)
      const [counted] = await tx
        .select({
          withoutResponsible: sql<number>`count(*) filter (where ${duties.responsibleUserId} is null)::int`,
          withoutDelegation: sql<number>`count(*) filter (where ${duties.responsibleUserId} is not null and ${duties.responsibleDelegationId} is null)::int`,
        })
        .from(duties)
        .where(and(isNull(duties.deletedAt), or(isNull(duties.endsOn), gt(duties.endsOn, today))))

      return {
        delegations: held
          .map((each) => entryOf(each, names, today))
          .sort((left, right) =>
            left.startsOn === right.startsOn
              ? byNameIn(left.delegateName, right.delegateName)
              : left.startsOn < right.startsOn
                ? 1
                : -1,
          ),
        duties: {
          withoutResponsible: counted?.withoutResponsible ?? 0,
          withoutDelegation: counted?.withoutDelegation ?? 0,
        },
      }
    })
  }

  /** The delegations to the person asking, from the signature of the Leitung on: what waits for them, and the copies. */
  @Get('mine')
  @RequiresPermission('duty.read')
  async mine(@CurrentIdentity() identity: Asking): Promise<readonly DelegationEntry[]> {
    const today = dayInGermany()

    return this.database.forTenant(identity, async (tx) => {
      const held = (
        await heldDelegations(tx, eq(dutyDelegations.delegateUserId, identity.userId))
      ).filter((each) => each.signatures.some((signature) => signature.role === 'operator'))
      const names = await areaNames(tx)

      return held
        .map((each) => entryOf(each, names, today))
        .sort((left, right) => (left.startsOn < right.startsOn ? 1 : -1))
    })
  }

  @Get(':id')
  @RequiresPermission('duty.read')
  page(@CurrentIdentity() identity: Asking, @Param('id') id: string): Promise<DelegationReading> {
    return this.reading(identity, id)
  }

  /** The PDF of a delegation: the copy of the person, and the page of the Leitung. */
  @Get(':id/pdf')
  @RequiresPermission('duty.read')
  async print(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Res({ passthrough: true }) response: { setHeader(name: string, value: string): void },
  ): Promise<StreamableFile> {
    const reading = await this.reading(identity, id)
    const operator = await this.database.forTenant(identity, (tx) => keeperOf(tx))
    const bytes = await this.printer.fresh(
      delegationPrintJob(
        {
          operator,
          delegateName: reading.delegateName,
          areas: reading.areas.map((area) => area.name),
          scope: delegationScopeWords(
            reading,
            (name) => this.catalogue.packages.find((pack) => pack.name === name)?.title ?? name,
          ),
          tasks: reading.tasks,
          powers: reading.powers,
          startsOn: reading.startsOn,
          endsOn: reading.endsOn,
          signatures: reading.signatures.map((signature) => ({
            label: delegationRoleLabel[signature.role],
            name: signature.name,
            signedAt: signature.signedAt,
            path: signature.path,
            typedName: signature.typedName,
          })),
          revocation: reading.revocation,
          signedByBoth: reading.signatures.length === 2,
        },
        stateFingerprint(reading.page),
      ),
    )

    return pdf(response, bytes, `Pflichtenübertragung ${reading.delegateName}`)
  }

  @Post()
  @RequiresPermission('duty.delegate')
  async create(
    @CurrentIdentity() identity: Asking,
    @Body() body: unknown,
  ): Promise<DelegationReading> {
    const given = termsFrom(body)

    refuse(delegationProblems(given))

    const terms = delegationTermsOf(given)
    const id = await this.database.forTenant(identity, async (tx) => {
      await checkAreas(tx, terms.areaIds)

      const delegateName = await this.delegateNamed(
        tx,
        identity,
        terms.delegateUserId,
        terms.areaIds,
      )

      const [made] = await tx
        .insert(dutyDelegations)
        .values({
          tenantId: identity.tenantId,
          delegateUserId: terms.delegateUserId,
          delegateName,
          scope: terms.scope,
          packages: [...terms.packages],
          costGroups: [...terms.costGroups],
          tasks: terms.tasks,
          powers: terms.powers,
          startsOn: terms.startsOn,
          endsOn: terms.endsOn,
        })
        .returning({ id: dutyDelegations.id })

      if (made === undefined) {
        throw new Error('Die Pflichtenübertragung wurde nicht angelegt.')
      }

      await tx.insert(dutyDelegationAreas).values(
        terms.areaIds.map((areaId) => ({
          tenantId: identity.tenantId,
          delegationId: made.id,
          areaId: areaId as never,
        })),
      )

      return made.id
    })

    return this.reading(identity, id)
  }

  /** A delegation nobody has signed yet, changed as a whole. */
  @Patch(':id')
  @RequiresPermission('duty.delegate')
  async change(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<DelegationReading> {
    const given = termsFrom(body)

    refuse(delegationProblems(given))

    const terms = delegationTermsOf(given)

    await this.database.forTenant(identity, async (tx) => {
      const held = await this.draftOf(tx, id)
      await checkAreas(tx, terms.areaIds)

      const delegateName = await this.delegateNamed(
        tx,
        identity,
        terms.delegateUserId,
        terms.areaIds,
      )
      await tx
        .update(dutyDelegations)
        .set({
          delegateUserId: terms.delegateUserId,
          delegateName,
          scope: terms.scope,
          packages: [...terms.packages],
          costGroups: [...terms.costGroups],
          tasks: terms.tasks,
          powers: terms.powers,
          startsOn: terms.startsOn,
          endsOn: terms.endsOn,
          updatedAt: new Date(),
        })
        .where(eq(dutyDelegations.id, held.delegation.id))

      const gone = held.areaIds.filter((areaId) => !terms.areaIds.includes(areaId))
      const added = terms.areaIds.filter((areaId) => !held.areaIds.includes(areaId))

      if (gone.length > 0) {
        await tx
          .delete(dutyDelegationAreas)
          .where(
            and(
              eq(dutyDelegationAreas.delegationId, held.delegation.id),
              inArray(dutyDelegationAreas.areaId, gone as never[]),
            ),
          )
      }

      if (added.length > 0) {
        await tx.insert(dutyDelegationAreas).values(
          added.map((areaId) => ({
            tenantId: identity.tenantId,
            delegationId: held.delegation.id,
            areaId: areaId as never,
          })),
        )
      }
    })

    return this.reading(identity, id)
  }

  /** A delegation nobody has signed, removed; its areas go with it. */
  @Delete(':id')
  @RequiresPermission('duty.delegate')
  async remove(@CurrentIdentity() identity: Asking, @Param('id') id: string): Promise<void> {
    await this.database.forTenant(identity, async (tx) => {
      const held = await this.draftOf(tx, id)

      await tx.delete(dutyDelegations).where(eq(dutyDelegations.id, held.delegation.id))
    })
  }

  /**
   * A signature under a delegation, for exactly the page that was shown: the
   * Leitung for the operator first, then the person it goes to. With the
   * second the delegation holds, from its start, and is applied to the duties.
   */
  @Post(':id/sign')
  @RequiresPermission('duty.read')
  async sign(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<DelegationReading> {
    const given = (body ?? {}) as Readonly<Record<string, unknown>>
    const path = typeof given['path'] === 'string' ? given['path'] : null
    const typedName = typeof given['typedName'] === 'string' ? given['typedName'] : null

    refuse(
      signatureProblems({
        role: 'signer',
        path,
        typedName,
        pageFingerprint: given['pageFingerprint'],
      }),
    )

    if (typeof given['pageFingerprint'] !== 'string') {
      throw new BadRequestException('Der Fingerabdruck der Seite fehlt.')
    }

    const accounts = await accountsOf(this.database, [identity.userId], identity.userId)
    const accountName = accounts.get(identity.userId)?.name ?? ''

    if (typedName !== null && !typedNameIsOf(typedName, accountName)) {
      throw new BadRequestException(
        `Bestätigt wird mit dem eigenen Namen, wie er im Konto steht: ${accountName}.`,
      )
    }

    const today = dayInGermany()
    const complete = await this.database.forTenant(identity, async (tx) => {
      const held = await this.heldFor(tx, identity, id, true)
      const role = signerOf(held, identity)

      if (role === null) {
        throw new ConflictException(
          'Diese Pflichtenübertragung wartet nicht auf Ihre Unterschrift.',
        )
      }

      if (stateFingerprint(pageOf(held)) !== given['pageFingerprint']) {
        throw new ConflictException(
          'Die Pflichtenübertragung ist nicht mehr die, die Sie gelesen haben. Laden Sie die Seite neu und lesen Sie sie noch einmal.',
        )
      }

      await tx.insert(dutyDelegationSignatures).values({
        tenantId: identity.tenantId,
        delegationId: held.delegation.id,
        role,
        signedBy: identity.userId,
        signedAt: new Date(),
        path,
        typedName: typedName === null ? null : typedName.trim().replace(/\s+/g, ' '),
        pageFingerprint: given['pageFingerprint'],
      })

      return held.signatures.length === 1
    })

    if (complete) {
      await this.apply(identity, today)
    }

    return this.reading(identity, id)
  }

  /** A revocation: the end brought forward, with a reason. Applied to the duties at once. */
  @Post(':id/revoke')
  @RequiresPermission('duty.delegate')
  async revoke(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<DelegationReading> {
    const given = (body ?? {}) as Readonly<Record<string, unknown>>
    const today = dayInGermany()

    await this.database.forTenant(identity, async (tx) => {
      const held = await this.heldFor(tx, identity, id, true)

      if (held.signatures.length === 0) {
        throw new ConflictException(
          'Widerrufen wird eine unterschriebene Übertragung. Einen Entwurf entfernen Sie.',
        )
      }

      if (held.revocation !== null) {
        throw new ConflictException('Diese Pflichtenübertragung ist schon widerrufen.')
      }

      refuse(revocationProblems(given, standingOf(held), today))

      await tx.insert(dutyDelegationRevocations).values({
        tenantId: identity.tenantId,
        delegationId: held.delegation.id,
        effectiveOn: given['effectiveOn'] as IsoDate,
        reason: String(given['reason']).trim(),
        revokedBy: identity.userId,
        revokedAt: new Date(),
      })
    })

    await this.apply(identity, today)

    return this.reading(identity, id)
  }

  /**
   * The delegations applied to the duties, in the areas of whoever asked. A
   * delegation comes into force with the signature of the person it goes to,
   * who sees every area it names (`delegateNamed`); the pass of the deadlines
   * applies them in every area each day, when one begins or ends.
   */
  private async apply(identity: Asking, today: IsoDate): Promise<void> {
    await this.database.forTenant(identity, (tx) => applyDelegations(tx, this.catalogue, today))
  }

  /**
   * A delegation the person may read: every one for whoever may delegate,
   * else one that goes to them and that the Leitung signed.
   */
  private async heldFor(
    tx: TenantTransaction,
    identity: Asking,
    id: string,
    lock = false,
  ): Promise<HeldDelegation> {
    if (!isUuid(id)) {
      throw new NotFoundException(missing)
    }

    if (lock) {
      // Two signatures or a signature and a revocation at the same moment wait for each other here.
      await tx
        .select({ id: dutyDelegations.id })
        .from(dutyDelegations)
        .where(eq(dutyDelegations.id, id as DutyDelegationId))
        .for('no key update')
    }

    const [held] = await heldDelegations(tx, eq(dutyDelegations.id, id as DutyDelegationId))
    const delegates = identity.rights.includes('duty.delegate')
    const theirs =
      held?.delegation.delegateUserId === identity.userId &&
      held.signatures.some((signature) => signature.role === 'operator')

    if (held === undefined || !(delegates || theirs)) {
      throw new NotFoundException(missing)
    }

    return held
  }

  /** A delegation nobody signed yet, for whoever may delegate. */
  private async draftOf(tx: TenantTransaction, id: string): Promise<HeldDelegation> {
    if (!isUuid(id)) {
      throw new NotFoundException(missing)
    }

    const [held] = await heldDelegations(tx, eq(dutyDelegations.id, id as DutyDelegationId))

    if (held === undefined) {
      throw new NotFoundException(missing)
    }

    if (held.signatures.length > 0) {
      throw new ConflictException(signedAlready)
    }

    return held
  }

  /**
   * The person a delegation goes to, by the name of their account: somebody
   * who works for the operator, is not blocked, may read the duties, sees
   * every area it names, and is not the one who writes it.
   */
  private async delegateNamed(
    tx: TenantTransaction,
    identity: Asking,
    userId: string,
    areaIds: readonly string[],
  ): Promise<string> {
    const [member] = await tx
      .select({ userId: memberships.userId, roles: memberships.roles })
      .from(memberships)
      .where(and(eq(memberships.userId, userId), isNull(memberships.blockedAt), beforeItsEnd()))
    const rights =
      member === undefined
        ? []
        : (
            await tx
              .select({ rights: tenantRoles.rights })
              .from(tenantRoles)
              .where(inArray(tenantRoles.key, [...member.roles]))
          ).flatMap((role) => role.rights)

    if (member === undefined || !rights.includes('duty.read')) {
      throw new BadRequestException(
        'Beauftragt wird jemand, der für diesen Betreiber arbeitet und die Pflichten ansehen darf.',
      )
    }

    // An auditor from outside reads and carries no duty (#339): so nobody of
    // whom a delegation asks a signature reads only.
    if (isLimited(member.roles)) {
      throw new BadRequestException('Pflichten werden keinem Prüfer übertragen.')
    }

    if (userId === identity.userId) {
      throw new BadRequestException(
        'Sich selbst überträgt niemand Pflichten: für den Betreiber unterschreibt eine andere Person.',
      )
    }

    // Responsible for duties the person cannot open is nobody: as for an
    // activity, whoever is named sees the areas (section 7 of the concept).
    const [everywhere] = await tx
      .select({ userId: memberAllAreas.userId })
      .from(memberAllAreas)
      .where(eq(memberAllAreas.userId, userId))
    const seen = new Set(
      (
        await tx
          .select({ areaId: memberAreas.areaId })
          .from(memberAreas)
          .where(eq(memberAreas.userId, userId))
      ).map((row) => row.areaId as string),
    )

    if (everywhere === undefined && !areaIds.every((areaId) => seen.has(areaId))) {
      throw new BadRequestException(
        'Beauftragt wird jemand, der jeden Bereich der Übertragung sieht. Geben Sie der Person die Bereiche unter „Zugänge“, oder wählen Sie andere.',
      )
    }

    const accounts = await accountsOf(this.database, [userId], identity.userId)

    return accounts.get(userId)?.name ?? 'Unbekanntes Konto'
  }

  /** The page of a delegation, with the names of who signed and revoked it and the duties in its scope. */
  private async reading(identity: Asking, id: string): Promise<DelegationReading> {
    const today = dayInGermany()
    const read = await this.database.forTenant(identity, async (tx) => {
      const held = await this.heldFor(tx, identity, id)
      const names = await areaNames(tx)

      return { held, names, duties: await this.dutiesInScope(tx, held, today) }
    })
    const { held } = read
    const people = [
      ...held.signatures.map((signature) => signature.signedBy),
      ...(held.revocation === null ? [] : [held.revocation.revokedBy]),
      ...read.duties.people,
    ]
    const accounts = await accountsOf(this.database, [...new Set(people)], identity.userId)
    const nameOf = (userId: string) => accounts.get(userId)?.name ?? 'Unbekanntes Konto'
    const entry = entryOf(held, read.names, today)

    return {
      ...entry,
      tasks: held.delegation.tasks,
      powers: held.delegation.powers,
      page: pageOf(held),
      signatures: [...held.signatures]
        .sort((left, right) => (left.role === 'operator' ? -1 : right.role === 'operator' ? 1 : 0))
        .map((signature) => ({
          role: signature.role,
          name: nameOf(signature.signedBy),
          signedAt: signature.signedAt.toISOString(),
          path: signature.path,
          typedName: signature.typedName,
        })),
      revocation:
        held.revocation === null
          ? null
          : {
              effectiveOn: held.revocation.effectiveOn as IsoDate,
              reason: held.revocation.reason,
              name: nameOf(held.revocation.revokedBy),
              at: held.revocation.revokedAt.toISOString(),
            },
      duties: {
        total: read.duties.lines.length,
        shown: read.duties.lines.slice(0, dutiesShown).map((line) => ({
          ...line,
          responsible: line.responsible === null ? null : nameOf(line.responsible),
        })),
      },
      signs: signerOf(held, identity),
    }
  }

  /** The duties in the scope of a delegation today that the person sees, with who answers for them and from where. */
  private async dutiesInScope(
    tx: TenantTransaction,
    held: HeldDelegation,
    today: IsoDate,
  ): Promise<{ readonly lines: DelegationDutyLine[]; readonly people: string[] }> {
    const terms = termsOf(held)
    const rows = await tx
      .select({
        id: duties.id,
        kind: duties.kind,
        kindVersion: duties.kindVersion,
        label: duties.label,
        areaId: duties.areaId,
        responsibleUserId: duties.responsibleUserId,
        responsibleDelegationId: duties.responsibleDelegationId,
        assetKind: assets.kind,
        assetNumber: assets.number,
        assetName: assets.name,
        roomNumber: rooms.number,
        roomName: rooms.name,
        building: buildings.name,
        property: properties.name,
      })
      .from(duties)
      .innerJoin(properties, eq(properties.id, duties.propertyId))
      .leftJoin(assets, eq(assets.id, duties.assetId))
      .leftJoin(rooms, eq(rooms.id, duties.roomId))
      .leftJoin(
        buildings,
        or(eq(buildings.id, duties.buildingId), eq(buildings.id, assets.buildingId)),
      )
      .where(
        and(
          isNull(duties.deletedAt),
          or(isNull(duties.endsOn), gt(duties.endsOn, today)),
          inArray(duties.areaId, terms.areaIds as never[]),
        ),
      )
    const lines = rows
      .filter((row) =>
        delegationCovers(terms, {
          areaId: row.areaId,
          packageName: packageOfKind(row.kind),
          costGroup:
            row.assetKind === null
              ? null
              : (this.catalogue.assetKind(row.assetKind, today)?.definition.costGroup ?? null),
        }),
      )
      .map((row): DelegationDutyLine => {
        const asset =
          row.assetName === null
            ? null
            : [row.assetNumber, row.assetName].filter((part) => part !== null).join(' ')
        const room =
          row.roomNumber === null && row.roomName === null
            ? null
            : [row.roomNumber, row.roomName].filter((part) => part !== null).join(' ')

        return {
          dutyId: row.id,
          title: dutyTitle(row, this.catalogue),
          place: [asset ?? room, row.property, row.building]
            .filter((part) => part !== null && part !== '')
            .join(', '),
          responsible: row.responsibleUserId,
          from:
            row.responsibleUserId === null
              ? 'nobody'
              : row.responsibleDelegationId === null
                ? 'none'
                : row.responsibleDelegationId === held.delegation.id
                  ? 'this'
                  : 'other',
        }
      })
      .sort((left, right) => byNameIn(left.place, right.place) || byNameIn(left.title, right.title))

    return {
      lines,
      people: lines.flatMap((line) => (line.responsible === null ? [] : [line.responsible])),
    }
  }
}

/** The names of the areas of the operator, by their ids. */
async function areaNames(tx: TenantTransaction): Promise<ReadonlyMap<string, string>> {
  const rows = await tx.select({ id: areas.id, name: areas.name }).from(areas)

  return new Map(rows.map((row) => [row.id as string, row.name]))
}

/** Refuses an area the operator does not have. */
async function checkAreas(tx: TenantTransaction, areaIds: readonly string[]): Promise<void> {
  if (!areaIds.every((areaId) => isUuid(areaId))) {
    throw new BadRequestException('Diesen Bereich gibt es bei diesem Betreiber nicht.')
  }

  const found = await tx
    .select({ id: areas.id })
    .from(areas)
    .where(inArray(areas.id, areaIds as never[]))

  if (found.length !== areaIds.length) {
    throw new BadRequestException('Diesen Bereich gibt es bei diesem Betreiber nicht.')
  }
}

/** A delegation as the lists show it. */
function entryOf(
  held: HeldDelegation,
  names: ReadonlyMap<string, string>,
  today: IsoDate,
): DelegationEntry {
  const standing = standingOf(held)

  return {
    id: held.delegation.id,
    delegateUserId: held.delegation.delegateUserId,
    delegateName: held.delegation.delegateName,
    areas: held.areaIds
      .map((areaId) => ({ id: areaId, name: names.get(areaId) ?? 'Bereich' }))
      .sort((left, right) => byNameIn(left.name, right.name)),
    scope: held.delegation.scope,
    packages: [...held.delegation.packages].sort(),
    costGroups: [...held.delegation.costGroups].sort(),
    startsOn: standing.startsOn,
    endsOn: standing.endsOn,
    lastDay: lastDayOf(standing),
    state: delegationState(standing, today),
  }
}

/** Who may sign now: the Leitung for the operator first, then the person it goes to; nobody once it is revoked. */
function signerOf(held: HeldDelegation, identity: Asking): DelegationRole | null {
  const signed = held.signatures.map((signature) => signature.role)

  if (held.revocation !== null || signedByBoth({ signedBy: signed })) {
    return null
  }

  if (!signed.includes('operator')) {
    return identity.rights.includes('duty.delegate') &&
      identity.userId !== held.delegation.delegateUserId
      ? 'operator'
      : null
  }

  return identity.userId === held.delegation.delegateUserId ? 'delegate' : null
}
