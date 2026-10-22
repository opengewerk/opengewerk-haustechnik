import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common'
import {
  type Catalogue,
  classNotOffered,
  defaultDueOn,
  type Defect,
  defectChangeRefusal,
  type DefectCheckOutcome,
  defectCheckProblems,
  defectCheckRefusal,
  type DefectClassChoice,
  type DefectClassSetting,
  defectClassTableColumns,
  defectClassTableRow,
  defectProblems,
  type DefectReading,
  type DefectRegister,
  defectReportBlocks,
  defectReportCount,
  defectReportWhere,
  defectReportWords,
  type DefectSummary,
  defectOriginWord,
  defectTermProblem,
  entryShutsDown,
  isAllowed,
  type IsoDate,
  statusAfterCheck,
} from '@opengewerk/haustechnik-domain'
import {
  CurrentIdentity,
  Database,
  FILE_STORE,
  type FileStorage,
  tableAnswer,
  tableFormatOf,
  type TenantTransaction,
} from '@opengewerk/platform-server'
import { eq } from 'drizzle-orm'

import { CATALOGUE } from '../catalogue.js'
import { defectClassTerms, defects } from '../database/schema/index.js'
import {
  classChoicesFor,
  classTermsOf,
  defectReading,
  defectRegister,
  defectRegisterQuestion,
  defectSummary,
} from '../defects/reading.js'
import { defectReportChoice, firstPhotosOf, orderWords } from '../defects/report.js'
import { keeperOf } from '../labels/faces.js'
import {
  type DefectReportLine,
  type DefectReportPhoto,
  defectReportPrintJob,
} from '../prints/defect-report-page.js'
import { dayInGermany, timeInGermany } from '../today.js'
import { RequiresPermission } from './authorization.js'
import { defectTable, wholeList } from './office-tables.js'
import {
  type Asking,
  changedInEveryArea,
  fieldsOf,
  given,
  placeOf,
  refuse,
  targetOf,
} from './places.js'
import { pdf, Printer } from './prints.controller.js'

const missing = 'Diesen Mangel gibt es nicht oder nicht mehr.'

/** A defect the person asking sees, held until the transaction ends, so that two changes of it come one after the other. */
async function heldDefect(tx: TenantTransaction, id: string): Promise<Defect> {
  const seen = await placeOf<Defect>(tx, defects, id, missing)
  const [held] = await tx.select().from(defects).where(eq(defects.id, seen.id)).for('update')

  if (held === undefined) {
    throw new NotFoundException(missing)
  }

  return held as Defect
}

/**
 * The class a body gives a defect, held against the classes it may take; and
 * the day it is to be set right by, which a class without one takes from the
 * default the operator set for it.
 */
function classAndDay(
  values: Readonly<Record<string, unknown>>,
  choices: readonly DefectClassChoice[],
  foundOn: IsoDate,
): { readonly defectClass?: string | null; readonly dueOn?: IsoDate | null } {
  const decided: { defectClass?: string | null; dueOn?: IsoDate | null } = {}

  if ('defectClass' in values) {
    const key = values['defectClass']

    if (key === null || key === undefined) {
      decided.defectClass = null
    } else {
      const choice = choices.find((each) => each.key === key)

      if (choice === undefined) {
        throw new BadRequestException(classNotOffered)
      }

      decided.defectClass = choice.key

      if (!('dueOn' in values)) {
        decided.dueOn = defaultDueOn(foundOn, choice.dueDays)
      }
    }
  }

  if ('dueOn' in values) {
    decided.dueOn = (values['dueOn'] ?? null) as IsoDate | null
  }

  return decided
}

/**
 * The defects of an operator (section 4.6 of the concept, #116). Seeing them
 * is everybody's; reporting one, with what was found and where, is everybody's
 * too ("Mängel melden"); its further way, the class, the day to set it right
 * by and checking it again, belongs to whoever keeps defects ("Mängel
 * führen"), which section 7 gives to Leitung, Technische Leitung and
 * Objektleitung and not to the Haustechnik. "Beauftragt" and "behoben" come
 * from the work order (#117) and from no route here.
 */
@Controller('defects')
export class DefectsController {
  constructor(
    private readonly database: Database,
    @Inject(CATALOGUE) private readonly catalogue: Catalogue,
    private readonly printer: Printer,
    @Inject(FILE_STORE) private readonly store: FileStorage,
  ) {}

  /** A page of the register, narrowed by what the address names. */
  @Get()
  @RequiresPermission('defect.read')
  register(
    @CurrentIdentity() identity: Asking,
    @Query() query: Readonly<Record<string, unknown>>,
  ): Promise<DefectRegister> {
    const question = defectRegisterQuestion(query)

    return this.database.forTenant(identity, (tx) => defectRegister(tx, question, dayInGermany()))
  }

  /**
   * The register as a table (#236): every defect the filter of the list passes, and
   * not a page, in the order of the list, as a workbook or as text
   * (`?format=xlsx` or `csv`). Whoever reads the list reads its table, with
   * what the list shows the person; the places and the assets only for whoever
   * reads them, the people only for the Leitung.
   *
   * Before a defect, or its address would be read as an id.
   */
  @Get('table')
  @RequiresPermission('defect.read')
  @Header('Cache-Control', 'no-store')
  table(
    @CurrentIdentity() identity: Asking,
    @Query() query: Readonly<Record<string, unknown>>,
  ): Promise<StreamableFile> {
    const format = tableFormatOf(query)
    const question = { ...defectRegisterQuestion(query), ...wholeList }
    const today = dayInGermany()

    return this.database.forTenant(identity, async (tx) => {
      const { defects: rows } = await defectRegister(tx, question, today)

      return tableAnswer(defectTable(this.catalogue, identity, rows), format, today)
    })
  }

  /**
   * The report of the defects as a PDF on A4 across (#345, section 4.6):
   * every defect the filter of the list passes, and not a page, in a block
   * for each building, each with where it is, its class, its days, its status
   * and its first photo (`firstPhotosOf`). A defect that puts its asset out
   * of service says so. Made for the moment it is asked for and not kept,
   * which its head and its foot say with the day and the hour (decided by
   * Moritz on 15.10.2026). Read in the areas of the person, like the list,
   * with the places and the assets named as the list names them, and the
   * work order for whoever reads work orders.
   *
   * Before a defect, or its address would be read as an id.
   */
  @Get('report/pdf')
  @RequiresPermission('defect.read')
  async report(
    @CurrentIdentity() identity: Asking,
    @Query() query: Readonly<Record<string, unknown>>,
    @Res({ passthrough: true }) response: { setHeader(name: string, value: string): void },
  ): Promise<StreamableFile> {
    const question = { ...defectRegisterQuestion(query), ...wholeList }
    const now = new Date()
    const day = dayInGermany(now)
    const reads = {
      places: isAllowed(identity, 'location.read'),
      assets: isAllowed(identity, 'asset.read'),
    }
    const orders = isAllowed(identity, 'activity.read')
    const made = await this.database.forTenant(identity, async (tx) => {
      const { defects: rows } = await defectRegister(tx, question, day)

      return {
        rows,
        operator: await keeperOf(tx),
        choice: await defectReportChoice(tx, identity, this.catalogue, question.filter),
        photos: await firstPhotosOf(
          tx,
          rows.map((row) => row.id),
        ),
      }
    })
    const photoOf = async (defectId: string): Promise<DefectReportPhoto> => {
      const file = made.photos.get(defectId)

      if (file === undefined || file === 'elsewhere') {
        return file ?? null
      }

      try {
        return { mediaType: file.mediaType, bytes: await this.store.get(file.sha256) }
      } catch {
        // A file the store no longer holds stays a word, and the report is made all the same.
        return 'elsewhere'
      }
    }
    const shutsDown = (row: (typeof made.rows)[number]) => entryShutsDown(row, this.catalogue)
    const parts = []

    for (const block of defectReportBlocks(made.rows, reads)) {
      const lines: DefectReportLine[] = []

      for (const defect of block.defects) {
        lines.push({
          defect,
          where: defectReportWhere(defect, reads),
          origin: defectOriginWord(defect.origin),
          defectClass:
            defect.defectClass === null
              ? null
              : (this.catalogue.defectClass(defect.defectClass)?.defectClass.label ??
                defect.defectClass),
          unsafe: shutsDown(defect),
          order: orders ? orderWords(defect) : null,
          photo: await photoOf(defect.id),
        })
      }

      parts.push({ title: block.title, sub: block.sub, lines })
    }

    const bytes = await this.printer.fresh(
      defectReportPrintJob(
        {
          day,
          time: timeInGermany(now),
          operator: made.operator,
          choice: made.choice,
          count: defectReportCount(made.rows, shutsDown),
        },
        parts,
      ),
    )

    return pdf(response, bytes, `${defectReportWords.title} ${day}`)
  }

  /** How many are open and over their deadline, for the navigation. */
  @Get('summary')
  @RequiresPermission('defect.read')
  summary(@CurrentIdentity() identity: Asking): Promise<DefectSummary> {
    return this.database.forTenant(identity, (tx) => defectSummary(tx, dayInGermany()))
  }

  /** The classes a defect by hand may take, with their defaults, for the form. */
  @Get('classes')
  @RequiresPermission('defect.read')
  classes(@CurrentIdentity() identity: Asking): Promise<readonly DefectClassChoice[]> {
    return this.database.forTenant(identity, (tx) =>
      classChoicesFor(tx, this.catalogue, { foundInActivityId: null, foundInEvidenceId: null }),
    )
  }

  @Get(':id')
  @RequiresPermission('defect.read')
  async read(@CurrentIdentity() identity: Asking, @Param('id') id: string): Promise<DefectReading> {
    const read = await this.database.forTenant(identity, (tx) =>
      defectReading(tx, this.catalogue, id, dayInGermany()),
    )

    if (read === null) {
      throw new NotFoundException(missing)
    }

    return read
  }

  /**
   * A defect by hand in the office: where it is, what was found and on which
   * day. A class and a day to set it right by come along only from whoever
   * keeps defects; anybody else reports it without, and it stands as "ohne
   * Klasse" until somebody gives it one.
   */
  @Post()
  @RequiresPermission('defect.report')
  create(@CurrentIdentity() identity: Asking, @Body() body: unknown): Promise<Defect> {
    const values = fieldsOf(
      body,
      [
        'propertyId',
        'buildingId',
        'roomId',
        'assetId',
        'description',
        'foundOn',
        'defectClass',
        'dueOn',
      ],
      ['propertyId', 'buildingId', 'roomId', 'assetId', 'defectClass', 'dueOn'],
    )
    const today = dayInGermany()
    const foundOn = (values.foundOn ?? today) as IsoDate

    if (
      (given(values.defectClass) || given(values.dueOn)) &&
      !identity.rights.includes('defect.write')
    ) {
      throw new ForbiddenException('Klasse und Frist vergibt, wer Mängel führt.')
    }

    refuse(
      defectProblems(
        {
          description: values.description ?? null,
          foundOn,
          defectClass: values.defectClass,
          dueOn: values.dueOn,
        },
        today,
      ),
    )

    return this.database.forTenant(identity, async (tx) => {
      const target = await targetOf(tx, values, 'Ein Mangel')
      const decided = classAndDay(
        {
          ...(given(values.defectClass) ? { defectClass: values.defectClass } : {}),
          ...(given(values.dueOn) ? { dueOn: values.dueOn } : {}),
        },
        await classChoicesFor(tx, this.catalogue, {
          foundInActivityId: null,
          foundInEvidenceId: null,
        }),
        foundOn,
      )
      const [created] = await tx
        .insert(defects)
        .values({
          tenantId: identity.tenantId,
          ...target,
          description: String(values.description),
          foundOn,
          defectClass: decided.defectClass ?? null,
          dueOn: decided.dueOn ?? null,
        })
        .returning()

      return created as Defect
    })
  }

  /**
   * What whoever keeps defects says of one: its description, its class and
   * the day it is to be set right by. A class given without a day takes the
   * default of the class. A defect checked again changes no more.
   */
  @Patch(':id')
  @RequiresPermission('defect.write')
  change(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<Defect> {
    const values = fieldsOf(body, ['description', 'defectClass', 'dueOn'], ['defectClass', 'dueOn'])

    return this.database.forTenant(identity, async (tx) => {
      const defect = await heldDefect(tx, id)
      const refusal = defectChangeRefusal(defect.status)

      if (refusal !== null) {
        throw new ConflictException(refusal)
      }

      refuse(defectProblems({ ...values, foundOn: defect.foundOn }))

      const decided = classAndDay(
        values,
        await classChoicesFor(tx, this.catalogue, defect),
        defect.foundOn,
      )
      const [changed] = await tx
        .update(defects)
        .set({
          ...(values.description === undefined ? {} : { description: String(values.description) }),
          ...decided,
        })
        .where(eq(defects.id, defect.id))
        .returning()

      return changed as Defect
    })
  }

  /**
   * Checking a remedied defect again (section 4.6: "nachgeprüft ist ein
   * eigener Schritt"): set right, it is done; not set right, it is found once
   * more and waits for a work order of its own. Only from "behoben".
   */
  @Post(':id/check')
  @RequiresPermission('defect.write')
  check(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<Defect> {
    const values = fieldsOf(body, ['outcome', 'checkedOn', 'note'], ['note'])

    return this.database.forTenant(identity, async (tx) => {
      const defect = await heldDefect(tx, id)
      const refusal = defectCheckRefusal(defect.status)

      if (refusal !== null) {
        throw new ConflictException(refusal)
      }

      refuse(defectCheckProblems(values, defect.foundOn, dayInGermany()))

      const [checked] = await tx
        .update(defects)
        .set({
          status: statusAfterCheck[values.outcome as DefectCheckOutcome],
          checkedOn: values.checkedOn as IsoDate,
          checkNote: (values.note ?? null) as string | null,
        })
        .where(eq(defects.id, defect.id))
        .returning()

      return checked as Defect
    })
  }
}

/**
 * The defaults of the classes of defects under "Einstellungen" (section 4.6:
 * "die Vorgabe je Klasse stellt der Betreiber ein"): every class the packages
 * name, with the days the operator set for it. Seeing and changing them is
 * what the settings take, which section 7 gives to the Leitung.
 */
@Controller('settings/defect-classes')
export class DefectClassSettingsController {
  constructor(
    private readonly database: Database,
    @Inject(CATALOGUE) private readonly catalogue: Catalogue,
  ) {}

  @Get()
  @RequiresPermission('settings.read')
  list(@CurrentIdentity() identity: Asking): Promise<readonly DefectClassSetting[]> {
    return this.database.forTenant(identity, (tx) => this.settings(tx))
  }

  /**
   * The classes as a table (#236), as the list shows them, as a workbook or
   * as text (`?format=xlsx` or `csv`). For whoever sees the settings.
   *
   * Before a class, or its address would be read as a key.
   */
  @Get('table')
  @RequiresPermission('settings.read')
  @Header('Cache-Control', 'no-store')
  table(
    @CurrentIdentity() identity: Asking,
    @Query() query: Readonly<Record<string, unknown>>,
  ): Promise<StreamableFile> {
    const format = tableFormatOf(query)

    return this.database.forTenant(identity, async (tx) =>
      tableAnswer(
        {
          name: 'Mängelklassen',
          columns: Object.values(defectClassTableColumns),
          rows: (await this.settings(tx)).map(defectClassTableRow),
        },
        format,
        dayInGermany(),
      ),
    )
  }

  /** Every class the packages name, with the days the operator set for it. */
  private async settings(tx: TenantTransaction): Promise<DefectClassSetting[]> {
    const terms = await classTermsOf(tx)

    return this.catalogue.packages.flatMap((pack) =>
      this.catalogue.defectClasses(pack.name).map(({ defectClass }) => ({
        key: defectClass.key,
        label: defectClass.label,
        unsafe: defectClass.unsafe,
        packageName: pack.name,
        packageTitle: pack.title,
        dueDays: terms.get(defectClass.key) ?? null,
      })),
    )
  }

  /** The default of one class: whole days, or none, which takes it away. */
  @Put(':key')
  @RequiresPermission('settings.write')
  set(
    @CurrentIdentity() identity: Asking,
    @Param('key') key: string,
    @Body() body: unknown,
  ): Promise<{ readonly dueDays: number | null }> {
    if (this.catalogue.defectClass(key) === null) {
      throw new NotFoundException('Diese Mängelklasse gibt es nicht.')
    }

    const { dueDays } = fieldsOf(body, ['dueDays'], ['dueDays'])
    const days = dueDays ?? null

    if (days !== null) {
      const problem = defectTermProblem(days)

      if (problem !== null) {
        throw new BadRequestException(problem)
      }
    }

    return this.database.forTenant(identity, async (tx) => {
      await changedInEveryArea(tx)

      if (days === null) {
        await tx.delete(defectClassTerms).where(eq(defectClassTerms.defectClass, key))
      } else {
        await tx
          .insert(defectClassTerms)
          .values({ tenantId: identity.tenantId, defectClass: key, dueDays: days as number })
          .onConflictDoUpdate({
            target: [defectClassTerms.tenantId, defectClassTerms.defectClass],
            set: { dueDays: days as number, updatedAt: new Date() },
          })
      }

      return { dueDays: days as number | null }
    })
  }
}
