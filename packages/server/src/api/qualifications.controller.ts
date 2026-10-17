import { createHash } from 'node:crypto'

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  Inject,
  NotFoundException,
  Param,
  Patch,
  PayloadTooLargeException,
  Post,
  Put,
  Req,
  StreamableFile,
  UnprocessableEntityException,
} from '@nestjs/common'
import {
  byNameIn,
  type Catalogue,
  fileHashProblem,
  fileSizeProblem,
  type IsoDate,
  largestFileBytes,
  ownKindIdOf,
  ownKindPrefix,
  type QualificationEntry,
  qualificationExpires,
  type QualificationId,
  type QualificationKindChoice,
  type QualificationKindId,
  qualificationKindProblems,
  type QualificationList,
  qualificationProblems,
  qualificationStanding,
} from '@opengewerk/haustechnik-domain'
import {
  AcceptsBody,
  accountsOf,
  bodyBytesOf,
  CurrentIdentity,
  Database,
  FILE_STORE,
  type FileStorage,
  fileRowFor,
  fileUploadType,
  isUuid,
  storedMediaType,
  type TenantTransaction,
} from '@opengewerk/platform-server'
import { deadlineSettings, files, memberships } from '@opengewerk/platform-server/schema'
import { and, eq, isNull, sql } from 'drizzle-orm'

import { CATALOGUE } from '../catalogue.js'
import { qualificationKinds, qualifications } from '../database/schema/index.js'
import { dayInGermany } from '../today.js'
import { RequiresPermission } from './authorization.js'
import { type Asking, refuse } from './places.js'

/** The request a body is read from, as the foundation reads it. */
type BodyRequest = Parameters<typeof bodyBytesOf>[0]

const missing = 'Diese Qualifikation gibt es nicht.'
const missingKind = 'Diese Art der Qualifikation gibt es nicht oder nicht mehr.'

/** What a certificate may be: a PDF or a picture of the paper. */
const certificateTypes = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
] as const

type Row = typeof qualifications.$inferSelect

/**
 * The qualifications of the people who work for the operator (#337, section
 * 4.3 of the concept), on the building block of the foundation (ADR 0012):
 * the list and the kinds for whoever may look at them (the Leitung, the
 * Technische Leitung and the Objektleitung), entering, changing and taking
 * one out for whoever keeps them (the Leitung and the Technische Leitung),
 * and the own ones under "Konto" for everybody who works on activities.
 *
 * The certificate is a file of the store at the qualification and not a
 * document of the records: it is read through the qualification, by whoever
 * may look at qualifications and by the person it belongs to.
 */
@Controller('qualifications')
export class QualificationsController {
  constructor(
    private readonly database: Database,
    @Inject(CATALOGUE) private readonly catalogue: Catalogue,
    @Inject(FILE_STORE) private readonly store: FileStorage,
  ) {}

  /** Every qualification, by person and kind, with how each stands today. */
  @Get()
  @RequiresPermission('qualification.read')
  list(@CurrentIdentity() identity: Asking): Promise<QualificationList> {
    return this.listed(identity, null)
  }

  /** The qualifications of the person asking, under "Konto". */
  @Get('mine')
  @RequiresPermission('activity.read')
  mine(@CurrentIdentity() identity: Asking): Promise<QualificationList> {
    return this.listed(identity, identity.userId)
  }

  /** The kinds to choose from: those of the packages, then the operator's own. */
  @Get('kinds')
  @RequiresPermission('qualification.read')
  kinds(@CurrentIdentity() identity: Asking): Promise<readonly QualificationKindChoice[]> {
    return this.database.forTenant(identity, (tx) => this.kindChoices(tx))
  }

  /** A kind of the operator's own, with its label and level. */
  @Post('kinds')
  @RequiresPermission('qualification.write')
  async addKind(
    @CurrentIdentity() identity: Asking,
    @Body() body: unknown,
  ): Promise<QualificationKindChoice> {
    const given = (body ?? {}) as Readonly<Record<string, unknown>>

    refuse(qualificationKindProblems(given))

    const label = String(given['label']).trim()

    return this.database.forTenant(identity, async (tx) => {
      const [taken] = await tx
        .select({ id: qualificationKinds.id })
        .from(qualificationKinds)
        .where(
          and(
            isNull(qualificationKinds.deletedAt),
            sql`lower(${qualificationKinds.label}) = lower(${label})`,
          ),
        )
      const ofPackage = this.catalogue.qualifications.some(
        (each) =>
          each.qualification.label.toLocaleLowerCase('de') === label.toLocaleLowerCase('de'),
      )

      if (taken !== undefined || ofPackage) {
        throw new ConflictException('Eine Art dieses Namens gibt es schon.')
      }

      const [made] = await tx
        .insert(qualificationKinds)
        .values({ tenantId: identity.tenantId, label, level: given['level'] as string })
        .returning()

      if (made === undefined) {
        throw new Error('Die Art wurde nicht angelegt.')
      }

      return {
        key: `${ownKindPrefix}${made.id}`,
        label: made.label,
        level: made.level as QualificationKindChoice['level'],
        origin: 'Eigene Art',
        requiredFor: 0,
        unaccepted: false,
      }
    })
  }

  /** A kind of the operator's own taken out, while no qualification names it. */
  @Delete('kinds/:id')
  @RequiresPermission('qualification.write')
  async removeKind(@CurrentIdentity() identity: Asking, @Param('id') id: string): Promise<void> {
    await this.database.forTenant(identity, async (tx) => {
      const [kind] = isUuid(id)
        ? await tx
            .select({ id: qualificationKinds.id })
            .from(qualificationKinds)
            .where(
              and(
                eq(qualificationKinds.id, id as QualificationKindId),
                isNull(qualificationKinds.deletedAt),
              ),
            )
        : []

      if (kind === undefined) {
        throw new NotFoundException(missingKind)
      }

      const [named] = await tx
        .select({ id: qualifications.id })
        .from(qualifications)
        .where(and(eq(qualifications.ownKindId, kind.id), isNull(qualifications.deletedAt)))
        .limit(1)

      if (named !== undefined) {
        throw new ConflictException(
          'Eine Art, die eine Qualifikation nennt, bleibt. Nehmen Sie zuerst die Qualifikationen heraus.',
        )
      }

      await tx
        .update(qualificationKinds)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(qualificationKinds.id, kind.id))
    })
  }

  /**
   * The bytes of a certificate, sent ahead of the qualification as the file
   * store of the foundation takes them: a PDF or a picture.
   */
  @Put('certificates/:sha256')
  @RequiresPermission('qualification.write')
  @AcceptsBody(
    [fileUploadType],
    'Ein Nachweis wird als application/octet-stream geschickt, mit seinem Typ im Kopf X-Media-Type.',
  )
  async certificate(
    @CurrentIdentity() identity: Asking,
    @Param('sha256') sha256: string,
    @Req() request: BodyRequest,
  ): Promise<{ readonly sha256: string; readonly mediaType: string }> {
    const malformed = fileHashProblem(sha256)

    if (malformed) {
      throw new BadRequestException(malformed)
    }

    const body = await bodyBytesOf(request, largestFileBytes)

    if (body === null) {
      throw new PayloadTooLargeException(fileSizeProblem(largestFileBytes + 1) ?? undefined)
    }

    const empty = fileSizeProblem(body.byteLength)

    if (empty) {
      throw new BadRequestException(empty)
    }

    const bytes = new Uint8Array(body.buffer, body.byteOffset, body.byteLength)

    if (createHash('sha256').update(bytes).digest('hex') !== sha256) {
      throw new UnprocessableEntityException(
        'Der Inhalt passt nicht zu seiner Prüfsumme. Der Nachweis ist unterwegs beschädigt worden; schicken Sie ihn noch einmal.',
      )
    }

    const mediaType = storedMediaType(bytes, request.header('x-media-type') ?? '')

    if (!(certificateTypes as readonly string[]).includes(mediaType)) {
      throw new BadRequestException(
        'Ein Nachweis ist ein PDF oder ein Bild als JPEG, PNG, WebP oder HEIC.',
      )
    }

    const blob = await this.store.put(bytes)

    return this.database.forTenant(identity, async (tx) => {
      await fileRowFor(tx, identity.tenantId, blob, mediaType)

      return { sha256: blob.sha256, mediaType }
    })
  }

  /**
   * A qualification of a person who works for the operator: one kind of the
   * packages or of the operator's own, until a day or without one, a note
   * and a certificate stored before.
   */
  @Post()
  @RequiresPermission('qualification.write')
  async create(
    @CurrentIdentity() identity: Asking,
    @Body() body: unknown,
  ): Promise<QualificationEntry> {
    const given = (body ?? {}) as Readonly<Record<string, unknown>>
    const kind = typeof given['kind'] === 'string' ? given['kind'] : ''
    const ownKindId = ownKindIdOf(kind)
    const values = {
      userId: given['userId'],
      kindKey: kind === '' || ownKindId !== null ? null : kind,
      ownKindId,
      validUntil: given['validUntil'] ?? null,
      note: typeof given['note'] === 'string' && given['note'].trim() !== '' ? given['note'] : null,
    }

    refuse(qualificationProblems(values))
    const certificate = certificateOf(given)

    const id = await this.database.forTenant(identity, async (tx) => {
      await this.checkPerson(tx, values.userId as string)
      await this.checkKind(tx, values.kindKey, values.ownKindId)
      await this.checkCertificate(tx, certificate)

      const [made] = await tx
        .insert(qualifications)
        .values({
          tenantId: identity.tenantId,
          userId: values.userId as string,
          kindKey: values.kindKey,
          ownKindId: values.ownKindId as QualificationKindId | null,
          validUntil: values.validUntil as IsoDate | null,
          note: values.note === null ? null : values.note.trim(),
          certificateSha256: certificate ?? null,
        })
        .returning({ id: qualifications.id })

      if (made === undefined) {
        throw new Error('Die Qualifikation wurde nicht angelegt.')
      }

      return made.id
    })

    return this.entryOf(identity, id)
  }

  /** The last day, the note and the certificate of a qualification; its person and kind stay. */
  @Patch(':id')
  @RequiresPermission('qualification.write')
  async change(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<QualificationEntry> {
    const given = (body ?? {}) as Readonly<Record<string, unknown>>
    const certificate = certificateOf(given)

    await this.database.forTenant(identity, async (tx) => {
      const held = await this.heldOf(tx, id)
      const values = {
        userId: held.userId,
        kindKey: held.kindKey,
        ownKindId: held.ownKindId,
        validUntil: 'validUntil' in given ? (given['validUntil'] ?? null) : held.validUntil,
        note:
          'note' in given
            ? typeof given['note'] === 'string' && given['note'].trim() !== ''
              ? given['note']
              : null
            : held.note,
      }

      refuse(qualificationProblems(values))
      await this.checkCertificate(tx, certificate)

      await tx
        .update(qualifications)
        .set({
          validUntil: values.validUntil as IsoDate | null,
          note: values.note === null ? null : values.note.trim(),
          ...(certificate === undefined ? {} : { certificateSha256: certificate }),
          updatedAt: new Date(),
        })
        .where(eq(qualifications.id, held.id))
    })

    return this.entryOf(identity, id)
  }

  /** A qualification taken out of the records: marked, never removed, and its deadline drops. */
  @Delete(':id')
  @RequiresPermission('qualification.write')
  async remove(@CurrentIdentity() identity: Asking, @Param('id') id: string): Promise<void> {
    await this.database.forTenant(identity, async (tx) => {
      const held = await this.heldOf(tx, id)

      await tx
        .update(qualifications)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(qualifications.id, held.id))
    })
  }

  /** The certificate, for whoever may look at qualifications and for the person it belongs to. */
  @Get(':id/certificate')
  @RequiresPermission('activity.read')
  @Header('Cache-Control', 'private, no-store')
  async certificateFile(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
  ): Promise<StreamableFile> {
    const file = await this.database.forTenant(identity, async (tx) => {
      const held = await this.heldOf(tx, id)

      if (!identity.rights.includes('qualification.read') && held.userId !== identity.userId) {
        throw new ForbiddenException(
          'Den Nachweis sieht, wer Qualifikationen ansieht, und die Person selbst.',
        )
      }

      if (held.certificateSha256 === null) {
        throw new NotFoundException('Zu dieser Qualifikation gibt es keinen Nachweis.')
      }

      const [stored] = await tx
        .select({ sha256: files.sha256, mediaType: files.mediaType })
        .from(files)
        .where(eq(files.sha256, held.certificateSha256))

      if (stored === undefined) {
        throw new NotFoundException('Zu dieser Qualifikation gibt es keinen Nachweis.')
      }

      return stored
    })
    const bytes = await this.store.get(file.sha256)

    return new StreamableFile(Buffer.from(bytes), {
      type: file.mediaType,
      disposition: 'inline',
      length: bytes.byteLength,
    })
  }

  /** A qualification not taken out, or a 404. */
  private async heldOf(tx: TenantTransaction, id: string): Promise<Row> {
    const [held] = isUuid(id)
      ? await tx
          .select()
          .from(qualifications)
          .where(
            and(eq(qualifications.id, id as QualificationId), isNull(qualifications.deletedAt)),
          )
      : []

    if (held === undefined) {
      throw new NotFoundException(missing)
    }

    return held
  }

  /** Somebody who works for the operator and is not shut out. */
  private async checkPerson(tx: TenantTransaction, userId: string): Promise<void> {
    const [member] = await tx
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.userId, userId), isNull(memberships.blockedAt)))

    if (member === undefined) {
      throw new BadRequestException('Eine Qualifikation hat, wer für diesen Betreiber arbeitet.')
    }
  }

  /** A kind of the packages, or one of the operator's own not taken out. */
  private async checkCertificate(
    tx: TenantTransaction,
    sha256: string | null | undefined,
  ): Promise<void> {
    const problem = await certificateProblem(tx, sha256)

    if (problem !== null) {
      throw new BadRequestException(problem)
    }
  }

  private async checkKind(
    tx: TenantTransaction,
    kindKey: string | null,
    ownKindId: string | null,
  ): Promise<void> {
    if (kindKey !== null) {
      if (this.catalogue.qualification(kindKey) === null) {
        throw new BadRequestException(missingKind)
      }

      return
    }

    const [own] =
      ownKindId !== null && isUuid(ownKindId)
        ? await tx
            .select({ id: qualificationKinds.id })
            .from(qualificationKinds)
            .where(
              and(
                eq(qualificationKinds.id, ownKindId as QualificationKindId),
                isNull(qualificationKinds.deletedAt),
              ),
            )
        : []

    if (own === undefined) {
      throw new BadRequestException(missingKind)
    }
  }

  /** The kinds of the packages, then the operator's own, each with where it comes from. */
  private async kindChoices(tx: TenantTransaction): Promise<QualificationKindChoice[]> {
    const own = await tx
      .select()
      .from(qualificationKinds)
      .where(isNull(qualificationKinds.deletedAt))

    return [
      ...this.catalogue.qualifications.map((each) => ({
        key: each.qualification.key,
        label: each.qualification.label,
        level: each.qualification.level,
        origin: `Paket ${
          this.catalogue.packages.find((pack) => pack.name === each.qualification.key.split('.')[0])
            ?.title ?? each.qualification.key.split('.')[0]
        }`,
        requiredFor: each.qualification.requiredFor.length,
        unaccepted: each.review.accepted === null,
      })),
      ...own
        .map((kind) => ({
          key: `${ownKindPrefix}${kind.id}`,
          label: kind.label,
          level: kind.level as QualificationKindChoice['level'],
          origin: 'Eigene Art',
          requiredFor: 0,
          unaccepted: false,
        }))
        .sort((left, right) => byNameIn(left.label, right.label)),
    ]
  }

  /** The list, of everybody or of one person, with names and how each stands today. */
  private async listed(identity: Asking, onlyOf: string | null): Promise<QualificationList> {
    const today = dayInGermany()
    const read = await this.database.forTenant(identity, async (tx) => {
      const rows = await tx
        .select()
        .from(qualifications)
        .where(
          and(
            isNull(qualifications.deletedAt),
            onlyOf === null ? undefined : eq(qualifications.userId, onlyOf),
          ),
        )
      const [setting] = await tx
        .select({ leadDays: deadlineSettings.leadDays })
        .from(deadlineSettings)
        .where(eq(deadlineSettings.kind, qualificationExpires.key))

      return {
        rows,
        kinds: await this.kindChoices(tx),
        leadDays: setting?.leadDays ?? qualificationExpires.leadDays,
      }
    })
    const accounts = await accountsOf(
      this.database,
      [...new Set(read.rows.map((row) => row.userId))],
      identity.userId,
    )
    const entries = read.rows
      .map((row) => entryFrom(row, read.kinds, accounts, today, read.leadDays))
      .sort(
        (left, right) =>
          byNameIn(left.personName, right.personName) ||
          byNameIn(left.kind.label, right.kind.label),
      )

    return {
      qualifications: entries,
      expired: entries.filter((entry) => entry.standing === 'expired').length,
      expiring: entries.filter((entry) => entry.standing === 'expiring').length,
      leadDays: read.leadDays,
    }
  }

  /** One qualification as the list names it. */
  private async entryOf(identity: Asking, id: string): Promise<QualificationEntry> {
    const found = (await this.listed(identity, null)).qualifications.find(
      (entry) => entry.id === id,
    )

    if (found === undefined) {
      throw new NotFoundException(missing)
    }

    return found
  }
}

/**
 * The file a certificate names is one this operator keeps, and a PDF or an
 * image, as the upload of a certificate takes them: whoever keeps
 * qualifications cannot hang another kind of file of the operator on one and
 * read it through the certificate (hardening after the security review of
 * #407).
 */
async function certificateProblem(
  tx: TenantTransaction,
  sha256: string | null | undefined,
): Promise<string | null> {
  if (sha256 === null || sha256 === undefined) {
    return null
  }

  const [file] = await tx
    .select({ mediaType: files.mediaType })
    .from(files)
    .where(eq(files.sha256, sha256))
    .limit(1)

  if (file === undefined) {
    return 'Der Nachweis wird zuerst hochgeladen und dann mit seiner Prüfsumme genannt.'
  }

  return (certificateTypes as readonly string[]).includes(file.mediaType)
    ? null
    : 'Ein Nachweis ist ein PDF oder ein Bild.'
}

/** The certificate a body names: a hash, null to take it away, or nothing where it says none. */
function certificateOf(given: Readonly<Record<string, unknown>>): string | null | undefined {
  if (!('certificateSha256' in given)) {
    return undefined
  }

  const value = given['certificateSha256']

  if (value === null) {
    return null
  }

  if (typeof value !== 'string' || fileHashProblem(value) !== null) {
    throw new BadRequestException(
      'Der Nachweis wird zuerst hochgeladen und dann mit seiner Prüfsumme genannt.',
    )
  }

  return value
}

function entryFrom(
  row: Row,
  kinds: readonly QualificationKindChoice[],
  accounts: ReadonlyMap<string, { readonly name: string }>,
  today: IsoDate,
  leadDays: number,
): QualificationEntry {
  const key = row.kindKey ?? `${ownKindPrefix}${String(row.ownKindId)}`
  const kind = kinds.find((each) => each.key === key)

  return {
    id: row.id as QualificationId,
    userId: row.userId,
    personName: accounts.get(row.userId)?.name ?? 'Unbekanntes Konto',
    kind: {
      key,
      label: kind?.label ?? row.kindKey ?? 'Eigene Art',
      origin: kind?.origin ?? (row.kindKey === null ? 'Eigene Art' : 'Paket'),
    },
    validUntil: row.validUntil,
    note: row.note,
    hasCertificate: row.certificateSha256 !== null,
    standing: qualificationStanding(row, today, leadDays),
    version: row.version,
  }
}
