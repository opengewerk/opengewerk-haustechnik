import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Post,
  Put,
  Req,
  UnprocessableEntityException,
} from '@nestjs/common'
import {
  assetImportFields,
  assetImportSummary,
  type AssetKindName,
  type Catalogue,
  chosenPlaceOf,
  deadlineImportFields,
  deadlineImportLimits,
  deadlineImportSummary,
  deadlineImportTotal,
  decisionsOf,
  documentTitleOf,
  type DutyId,
  fieldsWithChoice,
  fileNameKey,
  importLimits,
  type KindCells,
  type KindColumns,
  kindColumnsProblem,
  kindNameKey,
  kindNamesProblem,
  meterImportFields,
  meterImportSummary,
  meterImportTotal,
  missingRight,
  planAssets,
  planChanged,
  planDeadlines,
  planHasProblems,
  planMakesNothing,
  planMeters,
  planStructure,
  planTemplates,
  sameCounts,
  storedTemplate,
  structureDefaultsOf,
  structureFields,
  structureSummary,
  structureTotal,
  cellText,
  type ColumnMapping,
  columnMappingProblem,
  type TableField,
  type TableFile,
  type TableRecord,
  tableRecords,
  type TableSheet,
  tableSheetProblem,
  templateImportFields,
  templateImportSummary,
} from '@opengewerk/haustechnik-domain'
import {
  AcceptsTable,
  AcceptsTableFile,
  accountsOf,
  CurrentIdentity,
  Database,
  newId,
  tableBodyOf,
  uploadedTable,
} from '@opengewerk/platform-server'
import { files } from '@opengewerk/platform-server/schema'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'

import { areasInSight } from '../areas/areas.js'
import { CATALOGUE } from '../catalogue.js'
import { assignNumbers } from '../database/number-ranges.js'
import {
  assetKindNames,
  assets,
  attachments,
  attachmentVersions,
  buildings,
  duties,
  dutyDismissals,
  floors,
  meterExchanges,
  meterPauses,
  meterReadings,
  properties,
  rooms,
  roundTemplates,
  roundTemplateVersions,
} from '../database/schema/index.js'
import {
  EvidenceRefusal,
  holdTheDuty,
  writeEvidence,
  type WritingContext,
} from '../evidence/write.js'
import {
  assetImportStock,
  beginImport,
  deadlineImportStock,
  inParts,
  meterImportStock,
  structureStock,
  templateImportStock,
} from '../imports/stock.js'
import { dayInGermany } from '../today.js'
import { RequiresPermission } from './authorization.js'
import type { Asking } from './places.js'

/** A request as the helpers of the foundation read it: the body is theirs to read, not a parser's. */
type Request = Parameters<typeof uploadedTable>[0]

/** The most problems and known lines one answer lists; how many there are beyond that it says. */
const listed = 200

/** What a preview answers with: a list cut to what a page shows, and how many more there are. */
function cut<Item>(items: readonly Item[]): { shown: readonly Item[]; more: number } {
  return { shown: items.slice(0, listed), more: Math.max(0, items.length - listed) }
}

/** What a request about a table carries beside the sheet and its columns. */
type Given = Readonly<Record<string, unknown>>

/**
 * The sheet a request carries as the records of its lines, or the sentence
 * about what is wrong with the sheet or with the choice of its columns.
 */
function recordsOf(
  body: unknown,
  fields: readonly TableField[] | ((given: Given) => readonly TableField[]),
): { given: Given; records: readonly TableRecord[] } {
  const given = (typeof body === 'object' && body !== null ? body : {}) as Given
  const problem =
    tableSheetProblem(given['sheet']) ??
    columnMappingProblem(
      given['mapping'],
      typeof fields === 'function' ? fields(given) : fields,
      given['sheet'] as TableSheet,
    )

  if (problem) {
    throw new BadRequestException(problem)
  }

  return {
    given,
    records: tableRecords(given['sheet'] as TableSheet, given['mapping'] as ColumnMapping),
  }
}

/**
 * The fields of a table of places or of assets, with no column needed for
 * the property and the building chosen for all lines (#173).
 */
const structureFieldsFor = (given: Given) =>
  fieldsWithChoice(structureFields, chosenPlaceOf(given['defaults']))
const assetFieldsFor = (given: Given) =>
  fieldsWithChoice(assetImportFields, chosenPlaceOf(given['place']))

/** The name of the file as the log keeps it; a request that names none is a table without a name. */
function fileNameOf(given: Given): string {
  const name = typeof given['fileName'] === 'string' ? cellText(given['fileName']) : ''

  // Cut where a space stands, the name would end in one, and the table takes no such name.
  return name === '' ? 'Tabelle ohne Namen' : name.slice(0, importLimits.fileName).trimEnd()
}

/** The most files one list of running deadlines may come with. */
const mostFiles = 2_000

/** A file that went up ahead of a list: the hash and the size of its bytes, and of its preview. */
interface SentFile {
  readonly name: string
  readonly sha256: string
  readonly sizeBytes: number
  readonly previewSha256: string | null
}

/** A file chosen beside a list: its name, and its bytes where they went up ahead. */
type ChosenFile = SentFile | { readonly name: string; readonly sha256: null }

const isHash = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)

/**
 * The files a request names beside its list. The preview needs their names
 * and nothing else; the take-over names each file a line rests on by the hash
 * of its bytes, which went up ahead of it. Two files of one name are refused:
 * a line names its file by that name.
 */
function chosenFilesOf(value: unknown): ChosenFile[] {
  if (value === undefined || value === null) {
    return []
  }

  if (!Array.isArray(value) || value.length > mostFiles) {
    throw new BadRequestException(
      `Zu einer Liste gehören höchstens ${mostFiles.toLocaleString('de-DE')} Dateien; wer mehr hat, teilt die Liste.`,
    )
  }

  const seen = new Set<string>()

  return value.map((entry: unknown) => {
    const said = (typeof entry === 'object' && entry !== null ? entry : {}) as Given
    const name = typeof said['name'] === 'string' ? cellText(said['name']) : ''

    if (name === '' || name.length > deadlineImportLimits.fileName) {
      throw new BadRequestException(
        `Jede Datei hat einen Namen mit höchstens ${String(deadlineImportLimits.fileName)} Zeichen.`,
      )
    }

    if (seen.has(fileNameKey(name))) {
      throw new BadRequestException(
        `Die Datei „${name}“ ist zweimal gewählt. Eine Zeile nennt ihre Datei beim Namen, also hat jede ihren eigenen.`,
      )
    }

    seen.add(fileNameKey(name))

    const sha256 = said['sha256'] ?? null
    const sizeBytes = said['sizeBytes']
    const previewSha256 = said['previewSha256'] ?? null

    if (sha256 === null) {
      return { name, sha256: null }
    }

    if (
      !isHash(sha256) ||
      typeof sizeBytes !== 'number' ||
      !Number.isSafeInteger(sizeBytes) ||
      sizeBytes < 1 ||
      (previewSha256 !== null && !isHash(previewSha256))
    ) {
      throw new BadRequestException(
        `Zur Datei „${name}“ gehören ihre Prüfsumme und ihre Größe: sie geht dem Import voraus.`,
      )
    }

    return { name, sha256, sizeBytes, previewSha256 }
  })
}

/** A name for an account the instance does not know any more. */
const unknownAccount = 'Unbekanntes Konto'

/**
 * The import of places and assets from tables (#100, sections 3 and 11 of
 * the concept): the file read into a table, the preview of what its lines
 * would make, and the take-over, whole or not at all.
 *
 * Reading a file and the preview write nothing. Both work a plan out
 * (`planStructure`, `planAssets` in `domain`) from the table and from what
 * the person asking can see. Taking over works the same plan out once more
 * inside the transaction that writes, refuses one with a problem and one
 * that is no longer what the page was shown, and writes the rest behind one
 * row in `imports`, which is the one entry of the change log.
 *
 * Places are imported by whoever keeps them (`location.write`), assets by
 * whoever keeps assets (`asset.write`), and both only into what they see: the
 * policy of the areas refuses a row beyond it, and the plan finds no place
 * there to put one into (ADR 0003).
 *
 * A possible duplicate of an asset is asked about past the areas all the
 * same (#255, ADR 0003, addendum on #255), as the form in the office asks:
 * the preview and the take-over name the line and the field it shares with
 * an asset the person does not see, and nothing of that asset.
 */
@Controller('imports')
export class ImportsController {
  constructor(
    private readonly database: Database,
    @Inject(CATALOGUE) private readonly catalogue: Catalogue,
  ) {}

  @Post('structure/table')
  @HttpCode(200)
  @RequiresPermission('location.write')
  @AcceptsTableFile()
  structureTable(@Req() request: Request): Promise<TableFile> {
    return uploadedTable(request)
  }

  @Post('structure/preview')
  @HttpCode(200)
  @RequiresPermission('location.write')
  @AcceptsTable()
  async structurePreview(@CurrentIdentity() identity: Asking, @Req() request: Request) {
    const { given, records } = recordsOf(await tableBodyOf(request), structureFieldsFor)
    const defaults = structureDefaultsOf(given['defaults'])

    return this.database.readingTenant(identity, async (tx) => {
      const plan = planStructure(records, defaults, await structureStock(tx), newId)

      await this.areaInSight(tx, defaults.areaId, plan.counts.properties)

      const problems = cut(plan.problems)
      const known = cut(plan.known)

      return {
        lines: plan.lines,
        counts: plan.counts,
        problems: problems.shown,
        moreProblems: problems.more,
        known: known.shown,
        moreKnown: known.more,
      }
    })
  }

  @Post('structure')
  @RequiresPermission('location.write')
  @AcceptsTable()
  async takeStructure(@CurrentIdentity() identity: Asking, @Req() request: Request) {
    const { given, records } = recordsOf(await tableBodyOf(request), structureFieldsFor)
    const defaults = structureDefaultsOf(given['defaults'])

    return this.database.forTenant(identity, async (tx) => {
      const plan = planStructure(records, defaults, await structureStock(tx), newId)

      if (plan.problems.length > 0) {
        throw new UnprocessableEntityException(planHasProblems)
      }

      if (structureTotal(plan.counts) === 0) {
        throw new UnprocessableEntityException(planMakesNothing)
      }

      if (!sameCounts(given['expected'], { ...plan.counts })) {
        throw new ConflictException(planChanged)
      }

      await this.areaInSight(tx, defaults.areaId, plan.counts.properties)

      const summary = structureSummary(plan.counts)
      const id = await beginImport(tx, identity.tenantId, {
        kind: 'structure',
        fileName: fileNameOf(given),
        lines: plan.lines,
        summary,
      })
      const tenantId = identity.tenantId

      // Parents before their children: every row names the rows above it.
      for (const part of inParts(plan.create.properties)) {
        await tx.insert(properties).values(part.map((row) => ({ tenantId, ...row })))
      }

      for (const part of inParts(plan.create.buildings)) {
        await tx.insert(buildings).values(part.map((row) => ({ tenantId, ...row })))
      }

      for (const part of inParts(plan.create.floors)) {
        await tx.insert(floors).values(part.map((row) => ({ tenantId, ...row })))
      }

      for (const part of inParts(plan.create.rooms)) {
        await tx.insert(rooms).values(part.map((row) => ({ tenantId, ...row })))
      }

      return { id, counts: plan.counts, summary }
    })
  }

  @Post('assets/table')
  @HttpCode(200)
  @RequiresPermission('asset.write')
  @AcceptsTableFile()
  assetsTable(@Req() request: Request): Promise<TableFile> {
    return uploadedTable(request)
  }

  @Post('assets/preview')
  @HttpCode(200)
  @RequiresPermission('asset.write')
  @AcceptsTable()
  async assetsPreview(@CurrentIdentity() identity: Asking, @Req() request: Request) {
    const { given, records } = recordsOf(await tableBodyOf(request), assetFieldsFor)
    const cells = this.kindCellsOf(given)
    const chosen = chosenPlaceOf(given['place'])

    return this.database.readingTenant(identity, async (tx) => {
      const plan = planAssets(
        records,
        decisionsOf(given['decisions']),
        await assetImportStock(tx, this.catalogue, records),
        cells,
        chosen,
      )
      const problems = cut(plan.problems)
      const notes = cut(plan.notes)

      return {
        lines: plan.lines,
        counts: plan.counts,
        problems: problems.shown,
        moreProblems: problems.more,
        notes: notes.shown,
        moreNotes: notes.more,
        // Every one of them, however many: each waits for an answer.
        duplicates: plan.duplicates,
      }
    })
  }

  @Post('assets')
  @RequiresPermission('asset.write')
  @AcceptsTable()
  async takeAssets(@CurrentIdentity() identity: Asking, @Req() request: Request) {
    const { given, records } = recordsOf(await tableBodyOf(request), assetFieldsFor)
    const cells = this.kindCellsOf(given)
    const chosen = chosenPlaceOf(given['place'])

    return this.database.forTenant(identity, async (tx) => {
      const plan = planAssets(
        records,
        decisionsOf(given['decisions']),
        await assetImportStock(tx, this.catalogue, records),
        cells,
        chosen,
      )

      if (plan.problems.length > 0) {
        throw new UnprocessableEntityException(planHasProblems)
      }

      if (plan.counts.undecided > 0) {
        throw new UnprocessableEntityException(
          'Zu einer möglichen Dublette fehlt die Entscheidung. Es wurde nichts übernommen.',
        )
      }

      if (plan.create.length === 0) {
        throw new UnprocessableEntityException(planMakesNothing)
      }

      if (!sameCounts(given['expected'], { ...plan.counts })) {
        throw new ConflictException(planChanged)
      }

      const summary = assetImportSummary(plan.counts)
      const id = await beginImport(tx, identity.tenantId, {
        kind: 'assets',
        fileName: fileNameOf(given),
        lines: plan.lines,
        summary,
      })
      // The numbers in the order of the lines, drawn in one step from the
      // sequence of the tenant inside this transaction. The counter moves
      // once, which is one change in the log beside the import and not one
      // per asset, and an import that is refused takes them back with it.
      const numbers = await assignNumbers(
        tx,
        identity.tenantId,
        'asset',
        new Date(),
        plan.create.length,
      )
      const rows = plan.create.map(({ line: _line, ...asset }, index) => {
        const number = numbers[index]

        if (number === undefined) {
          throw new Error('Fewer numbers were drawn than the import makes assets')
        }

        // With what only its kind has (#172), as the plan read it from the columns of the kind.
        return { tenantId: identity.tenantId, ...asset, parentAssetId: null, number }
      })

      for (const part of inParts(rows)) {
        await tx.insert(assets).values(part)
      }

      return { id, counts: plan.counts, summary }
    })
  }

  @Post('deadlines/table')
  @HttpCode(200)
  @RequiresPermission('duty.write')
  @AcceptsTableFile()
  deadlinesTable(@CurrentIdentity() identity: Asking, @Req() request: Request): Promise<TableFile> {
    this.entersEvidence(identity)

    return uploadedTable(request)
  }

  @Post('deadlines/preview')
  @HttpCode(200)
  @RequiresPermission('duty.write')
  @AcceptsTable()
  async deadlinesPreview(@CurrentIdentity() identity: Asking, @Req() request: Request) {
    this.entersEvidence(identity)

    const { given, records } = recordsOf(await tableBodyOf(request), deadlineImportFields)
    const chosen = chosenFilesOf(given['files'])
    const named = new Set(records.map(({ values }) => fileNameKey(values['file'] ?? '')))

    return this.database.readingTenant(identity, async (tx) => {
      const { stock } = await deadlineImportStock(
        tx,
        this.catalogue,
        chosen.map((file) => file.name),
        dayInGermany(),
      )
      const plan = planDeadlines(records, stock)
      const problems = cut(plan.problems)
      const notes = cut(plan.notes)
      const rows = cut(plan.rows)

      return {
        lines: plan.lines,
        counts: plan.counts,
        problems: problems.shown,
        moreProblems: problems.more,
        notes: notes.shown,
        moreNotes: notes.more,
        rows: rows.shown,
        moreRows: rows.more,
        // What goes up before the take-over, and how many of the chosen files no line names.
        files: [
          ...new Set(
            [...plan.create.evidence, ...plan.create.documents].flatMap((each) =>
              each.file === null ? [] : [each.file],
            ),
          ),
        ],
        unusedFiles: chosen.filter((file) => !named.has(fileNameKey(file.name))).length,
      }
    })
  }

  /**
   * Takes the running deadlines of a predecessor application over (#130,
   * section 11 of the concept), whole or not at all: the duties that do not
   * stand yet are confirmed, the latest line of each duty is written down as
   * an evidence of the origin "Altbestand" with the next due day its list
   * names, and what lies before it is filed as a document, marked as taken
   * over. The files went up ahead and are named by their hash, like the file
   * of a report.
   *
   * Confirming a duty is keeping the register of duties, and writing an
   * evidence down is entering evidence: the route asks for both rights. Every
   * duty, evidence and document it writes makes its own entry in the change
   * log beside the one of the import, because an evidence has the weight of
   * proof and section 8 of the processing description promises its entry.
   */
  @Post('deadlines')
  @RequiresPermission('duty.write')
  @AcceptsTable()
  async takeDeadlines(@CurrentIdentity() identity: Asking, @Req() request: Request) {
    this.entersEvidence(identity)

    const { given, records } = recordsOf(await tableBodyOf(request), deadlineImportFields)
    const chosen = chosenFilesOf(given['files'])
    // Accounts are read on the instance and never inside a tenant.
    const accounts = await accountsOf(this.database, [identity.userId], identity.userId)
    const tenantId = identity.tenantId

    return this.database.forTenant(identity, async (tx) => {
      const { stock, places } = await deadlineImportStock(
        tx,
        this.catalogue,
        chosen.map((file) => file.name),
        dayInGermany(),
      )
      const plan = planDeadlines(records, stock)

      if (plan.problems.length > 0) {
        throw new UnprocessableEntityException(planHasProblems)
      }

      if (deadlineImportTotal(plan.counts) === 0) {
        throw new UnprocessableEntityException(planMakesNothing)
      }

      if (!sameCounts(given['expected'], { ...plan.counts })) {
        throw new ConflictException(planChanged)
      }

      // What a line names lies on the server, with the size the page saw.
      const sent = new Map(chosen.map((file) => [file.name, file]))
      const stored = new Map<string, SentFile & { readonly mediaType: string }>()
      const held = async (sha256: string) => {
        const [row] = await tx
          .select({ sizeBytes: files.sizeBytes, mediaType: files.mediaType })
          .from(files)
          .where(and(eq(files.tenantId, tenantId), eq(files.sha256, sha256)))

        return row ?? null
      }

      for (const name of new Set(
        [...plan.create.evidence, ...plan.create.documents].flatMap((each) =>
          each.file === null ? [] : [each.file],
        ),
      )) {
        const file = sent.get(name)
        const found = file === undefined || file.sha256 === null ? null : await held(file.sha256)

        if (
          file === undefined ||
          file.sha256 === null ||
          found === null ||
          found.sizeBytes !== file.sizeBytes ||
          (file.previewSha256 !== null && (await held(file.previewSha256)) === null)
        ) {
          throw new ConflictException(
            `Die Datei „${name}“ ist nicht auf dem Server. Wählen Sie die Dateien noch einmal.`,
          )
        }

        stored.set(name, { ...file, mediaType: found.mediaType })
      }

      const summary = deadlineImportSummary(plan.counts)
      const id = await beginImport(tx, tenantId, {
        kind: 'deadlines',
        fileName: fileNameOf(given),
        lines: plan.lines,
        summary,
      })
      const placeOf = (assetId: string) => {
        const place = places.get(assetId)

        if (place === undefined) {
          throw new Error('The plan names an asset the stock does not hold')
        }

        return { tenantId, ...place, assetId: assetId as (typeof assets.$inferSelect)['id'] }
      }
      const confirmed = plan.create.duties.map((duty) => ({ id: newId<'duty'>(), duty }))

      for (const part of inParts(confirmed)) {
        await tx.insert(duties).values(
          part.map(({ id: dutyId, duty }) => ({
            id: dutyId,
            ...placeOf(duty.assetId),
            kind: duty.kind,
            kindVersion: duty.kindVersion,
            label: duty.label,
            basis: duty.basis,
            sourceNote: duty.sourceNote,
            task: duty.task,
            counting: duty.counting,
            intervalDays: 'days' in duty.interval ? duty.interval.days : null,
            intervalMonths: 'months' in duty.interval ? duty.interval.months : null,
            intervalReason: duty.intervalReason,
            maximumDays: duty.maximum !== null && 'days' in duty.maximum ? duty.maximum.days : null,
            maximumMonths:
              duty.maximum !== null && 'months' in duty.maximum ? duty.maximum.months : null,
            guideDays: duty.guide !== null && 'days' in duty.guide ? duty.guide.days : null,
            guideMonths: duty.guide !== null && 'months' in duty.guide ? duty.guide.months : null,
            confirmedBy: identity.userId,
          })),
        )
      }

      // Confirming a duty of the catalogue takes a dismissal of it back, as in the register.
      for (const { duty } of confirmed) {
        if (duty.kind !== null) {
          await tx
            .update(dutyDismissals)
            .set({ deletedAt: new Date() })
            .where(
              and(
                eq(dutyDismissals.assetId, placeOf(duty.assetId).assetId),
                eq(dutyDismissals.kind, duty.kind),
                isNull(dutyDismissals.deletedAt),
              ),
            )
        }
      }

      // Every file a line rests on becomes a document at the asset, marked
      // as taken over: that is where it is found among its documents.
      const filed = [
        ...plan.create.evidence.flatMap((each) =>
          each.file === null
            ? []
            : [{ assetId: each.assetId, title: documentTitleOf(each.file), file: each.file }],
        ),
        ...plan.create.documents,
      ].map((each) => ({ id: newId<'attachment'>(), ...each }))

      for (const part of inParts(filed)) {
        await tx.insert(attachments).values(
          part.map((each) => ({
            id: each.id,
            ...placeOf(each.assetId),
            title: each.title,
            kind: 'test_certificate' as const,
            legacy: true,
          })),
        )
        await tx.insert(attachmentVersions).values(
          part.map((each) => {
            const file = stored.get(each.file) as SentFile & { readonly mediaType: string }

            return {
              tenantId,
              attachmentId: each.id,
              sha256: file.sha256,
              fileName: file.name,
              mediaType: file.mediaType,
              sizeBytes: file.sizeBytes,
              previewSha256: file.previewSha256,
            }
          }),
        )
      }

      const context: WritingContext = {
        tenantId,
        writtenBy: identity.userId,
        at: new Date(),
        catalogue: this.catalogue,
        nameOf: (userId) => accounts.get(userId)?.name ?? unknownAccount,
      }
      // The numbers in the order of the lines, drawn in one step: the counter
      // moves once, and an import that is refused takes them back with it.
      const numbers = await assignNumbers(
        tx,
        tenantId,
        'evidence',
        context.at,
        plan.create.evidence.length,
      )

      try {
        for (const [index, each] of plan.create.evidence.entries()) {
          const dutyId = (
            'id' in each.duty ? each.duty.id : confirmed[each.duty.planned]?.id
          ) as DutyId
          const number = numbers[index]
          const file = each.file === null ? undefined : stored.get(each.file)

          if (number === undefined) {
            throw new Error('Fewer numbers were drawn than the import writes evidence')
          }

          // A report or a correction of the same duty stands in line.
          await holdTheDuty(tx, tenantId, dutyId)
          await writeEvidence(tx, context, {
            dutyId,
            activityId: null,
            origin: 'legacy',
            performedOn: each.performedOn,
            result: each.result,
            resultReason: null,
            remark: each.remark,
            // It names nobody who did it and no signature: it claims none it cannot show.
            performedBy: null,
            examiner: null,
            signatures: [],
            files:
              file === undefined
                ? []
                : [{ sha256: file.sha256, name: file.name, mediaType: file.mediaType }],
            defects: [],
            nextDueOn: each.nextDueOn,
            number,
          })
        }
      } catch (error) {
        throw error instanceof EvidenceRefusal ? new ConflictException(error.message) : error
      }

      return { id, counts: plan.counts, summary }
    })
  }

  /** Writing an evidence down is entering evidence, whatever else a route asks for. */
  private entersEvidence(identity: Asking): void {
    if (!identity.rights.includes('evidence.write')) {
      throw new ForbiddenException(missingRight('evidence.write'))
    }
  }

  @Post('meters/table')
  @HttpCode(200)
  @RequiresPermission('asset.write')
  @AcceptsTableFile()
  metersTable(@CurrentIdentity() identity: Asking, @Req() request: Request): Promise<TableFile> {
    this.entersReadings(identity)

    return uploadedTable(request)
  }

  @Post('meters/preview')
  @HttpCode(200)
  @RequiresPermission('asset.write')
  @AcceptsTable()
  async metersPreview(@CurrentIdentity() identity: Asking, @Req() request: Request) {
    this.entersReadings(identity)

    const { records } = recordsOf(await tableBodyOf(request), meterImportFields)

    return this.database.readingTenant(identity, async (tx) => {
      const { stock } = await meterImportStock(tx, dayInGermany())
      const plan = planMeters(records, stock)
      const problems = cut(plan.problems)
      const notes = cut(plan.notes)
      const jumps = cut(plan.jumps)
      const rows = cut(plan.rows)

      return {
        lines: plan.lines,
        counts: plan.counts,
        problems: problems.shown,
        moreProblems: problems.more,
        notes: notes.shown,
        moreNotes: notes.more,
        jumps: jumps.shown,
        moreJumps: jumps.more,
        rows: rows.shown,
        moreRows: rows.more,
      }
    })
  }

  /**
   * Takes the history of the meters of a predecessor application over (#130,
   * section 11 of the concept), whole or not at all: the readings, each for
   * the key date of its day and marked as taken over, the replacements of
   * meters and the periods a measuring point rested.
   *
   * A replacement and a period of rest are the care of the assets, a reading
   * is reading meters: the route asks for both rights. The number of the
   * meter at the asset is not touched: a list whose last replacement does
   * not end in it is a line to clear up. Every reading, replacement and
   * period makes its own entry in the change log beside the one of the
   * import, as section 8 of the processing description promises.
   */
  @Post('meters')
  @RequiresPermission('asset.write')
  @AcceptsTable()
  async takeMeters(@CurrentIdentity() identity: Asking, @Req() request: Request) {
    this.entersReadings(identity)

    const { given, records } = recordsOf(await tableBodyOf(request), meterImportFields)
    const tenantId = identity.tenantId

    return this.database.forTenant(identity, async (tx) => {
      const { stock, places } = await meterImportStock(tx, dayInGermany())
      const plan = planMeters(records, stock)

      if (plan.problems.length > 0) {
        throw new UnprocessableEntityException(planHasProblems)
      }

      if (meterImportTotal(plan.counts) === 0) {
        throw new UnprocessableEntityException(planMakesNothing)
      }

      if (!sameCounts(given['expected'], { ...plan.counts })) {
        throw new ConflictException(planChanged)
      }

      const summary = meterImportSummary(plan.counts)
      const id = await beginImport(tx, tenantId, {
        kind: 'meters',
        fileName: fileNameOf(given),
        lines: plan.lines,
        summary,
      })
      const placeOf = (assetId: string) => {
        const place = places.get(assetId)

        if (place === undefined) {
          throw new Error('The plan names an asset the stock does not hold')
        }

        return { tenantId, ...place, assetId: assetId as (typeof assets.$inferSelect)['id'] }
      }

      for (const part of inParts(plan.create.exchanges)) {
        await tx
          .insert(meterExchanges)
          .values(
            part.map(({ line: _, assetId, ...exchange }) => ({ ...placeOf(assetId), ...exchange })),
          )
      }

      for (const part of inParts(plan.create.pauses)) {
        await tx
          .insert(meterPauses)
          .values(part.map(({ line: _, assetId, ...pause }) => ({ ...placeOf(assetId), ...pause })))
      }

      for (const part of inParts(plan.create.readings)) {
        await tx.insert(meterReadings).values(
          part.map(({ line: _, assetId, ...reading }) => ({
            ...placeOf(assetId),
            ...reading,
            // Nobody here read it: it says where it comes from, beside who took the list over.
            source: 'taken_over' as const,
            recordedBy: identity.userId,
          })),
        )
      }

      return { id, counts: plan.counts, summary }
    })
  }

  /** Taking readings over is entering readings, whatever else a route asks for. */
  private entersReadings(identity: Asking): void {
    if (!identity.rights.includes('reading.write')) {
      throw new ForbiddenException(missingRight('reading.write'))
    }
  }

  @Post('templates/table')
  @HttpCode(200)
  @RequiresPermission('template.write')
  @AcceptsTableFile()
  templatesTable(@Req() request: Request): Promise<TableFile> {
    return uploadedTable(request)
  }

  @Post('templates/preview')
  @HttpCode(200)
  @RequiresPermission('template.write')
  @AcceptsTable()
  async templatesPreview(@CurrentIdentity() identity: Asking, @Req() request: Request) {
    const { records } = recordsOf(await tableBodyOf(request), templateImportFields)

    return this.database.readingTenant(identity, async (tx) => {
      const plan = planTemplates(records, await templateImportStock(tx))
      const problems = cut(plan.problems)
      const notes = cut(plan.notes)
      const rows = cut(plan.rows)

      return {
        lines: plan.lines,
        counts: plan.counts,
        problems: problems.shown,
        moreProblems: problems.more,
        notes: notes.shown,
        moreNotes: notes.more,
        rows: rows.shown,
        moreRows: rows.more,
      }
    })
  }

  /**
   * Takes the templates of the rounds of a predecessor application over
   * (#130, section 11 of the concept), whole or not at all: each as a
   * template of the operator with its first version, as if it had been begun
   * in the office. A point of a list is about no asset and fulfils no duty;
   * both are said afterwards in the editor, as the next version.
   */
  @Post('templates')
  @RequiresPermission('template.write')
  @AcceptsTable()
  async takeTemplates(@CurrentIdentity() identity: Asking, @Req() request: Request) {
    const { given, records } = recordsOf(await tableBodyOf(request), templateImportFields)
    const tenantId = identity.tenantId

    return this.database.forTenant(identity, async (tx) => {
      const plan = planTemplates(records, await templateImportStock(tx))

      if (plan.problems.length > 0) {
        throw new UnprocessableEntityException(planHasProblems)
      }

      if (plan.counts.templates === 0) {
        throw new UnprocessableEntityException(planMakesNothing)
      }

      if (!sameCounts(given['expected'], { ...plan.counts })) {
        throw new ConflictException(planChanged)
      }

      const summary = templateImportSummary(plan.counts)
      const id = await beginImport(tx, tenantId, {
        kind: 'templates',
        fileName: fileNameOf(given),
        lines: plan.lines,
        summary,
      })
      const made = plan.create.templates.map((template) => ({
        id: newId<'round_template'>(),
        ...template,
      }))

      for (const part of inParts(made)) {
        await tx.insert(roundTemplates).values(
          part.map((template) => ({
            id: template.id,
            tenantId,
            title: template.definition.title,
          })),
        )
        await tx.insert(roundTemplateVersions).values(
          part.map((template) => ({
            tenantId,
            templateId: template.id,
            formVersion: 1,
            definition: storedTemplate(template.definition),
            asksCountersignature: template.asksCountersignature,
          })),
        )
      }

      return { id, counts: plan.counts, summary }
    })
  }

  /** What the lists of this tenant call the asset kinds, for the step that gives words a kind. */
  @Get('asset-kinds')
  @RequiresPermission('asset.write')
  kindNames(@CurrentIdentity() identity: Asking): Promise<{ names: AssetKindName[] }> {
    return this.database.forTenant(identity, async (tx) => ({
      names: await tx
        .select({ name: assetKindNames.name, kind: assetKindNames.kind })
        .from(assetKindNames)
        .orderBy(asc(assetKindNames.name)),
    }))
  }

  /**
   * Keeps which asset kind a word means. A word that is kept already is
   * corrected, compared as the import compares; one the request does not
   * name stays as it is.
   */
  @Put('asset-kinds')
  @RequiresPermission('asset.write')
  keepKindNames(
    @CurrentIdentity() identity: Asking,
    @Body() body: unknown,
  ): Promise<{ names: AssetKindName[] }> {
    const today = dayInGermany()
    const problem = kindNamesProblem(body, (key) => this.catalogue.assetKind(key, today) !== null)

    if (problem) {
      throw new BadRequestException(problem)
    }

    const names = new Map(
      (body as { names: AssetKindName[] }).names.map((entry) => [kindNameKey(entry.name), entry]),
    )

    return this.database.forTenant(identity, async (tx) => {
      for (const [nameKey, entry] of names) {
        await tx
          .insert(assetKindNames)
          .values({
            tenantId: identity.tenantId,
            name: cellText(entry.name),
            nameKey,
            kind: entry.kind,
          })
          .onConflictDoUpdate({
            target: [assetKindNames.tenantId, assetKindNames.nameKey],
            set: { kind: entry.kind, updatedAt: sql`now()` },
            setWhere: sql`${assetKindNames.kind} is distinct from ${entry.kind}`,
          })
      }

      return {
        names: await tx
          .select({ name: assetKindNames.name, kind: assetKindNames.kind })
          .from(assetKindNames)
          .orderBy(asc(assetKindNames.name)),
      }
    })
  }

  /**
   * The columns a request gives to the fields of asset kinds (#172), with
   * the sheet they are read from, or the sentence about what is wrong with
   * them. Held against the catalogue of today, which is the one the plan
   * reads the kinds of its lines from.
   */
  private kindCellsOf(given: Given): KindCells {
    const today = dayInGermany()
    const sheet = given['sheet'] as TableSheet
    const problem = kindColumnsProblem(
      given['kindColumns'],
      (key) => this.catalogue.assetKind(key, today)?.definition ?? null,
      given['mapping'] as ColumnMapping,
      sheet,
    )

    if (problem) {
      throw new BadRequestException(problem)
    }

    return { sheet, columns: (given['kindColumns'] ?? {}) as KindColumns }
  }

  /**
   * The area new properties are put into has to be one the person holds in.
   * The policy of the areas would refuse the row all the same; asked here,
   * the preview says so before anybody presses the button.
   */
  private async areaInSight(
    tx: Parameters<typeof areasInSight>[0],
    areaId: string | null,
    newProperties: number,
  ): Promise<void> {
    if (newProperties === 0 || areaId === null) {
      return
    }

    if (!(await areasInSight(tx)).some((area) => area.id === areaId)) {
      throw new BadRequestException(
        'Den Bereich für neue Liegenschaften gibt es bei diesem Betreiber nicht, oder Sie sehen ihn nicht.',
      )
    }
  }
}
