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
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common'
import {
  type Asset,
  type Building,
  type Catalogue,
  classNotOffered,
  defaultDueOn,
  type Defect,
  defectChangeRefusal,
  defectCheckProblems,
  defectCheckRefusal,
  type DefectCheckOutcome,
  type DefectClassChoice,
  type DefectClassSetting,
  defectProblems,
  type DefectReading,
  type DefectRegister,
  type DefectSummary,
  defectTermProblem,
  type IsoDate,
  type Property,
  type Room,
  statusAfterCheck,
} from '@opengewerk/haustechnik-domain'
import { CurrentIdentity, Database, type TenantTransaction } from '@opengewerk/platform-server'
import { eq } from 'drizzle-orm'

import { CATALOGUE } from '../catalogue.js'
import {
  assets,
  buildings,
  defectClassTerms,
  defects,
  properties,
  rooms,
} from '../database/schema/index.js'
import {
  classChoicesFor,
  classTermsOf,
  defectReading,
  defectRegister,
  defectRegisterQuestion,
  defectSummary,
} from '../defects/reading.js'
import { dayInGermany } from '../today.js'
import { RequiresPermission } from './authorization.js'
import { type Asking, fieldsOf, placeOf, refuse } from './places.js'

const missing = 'Diesen Mangel gibt es nicht oder nicht mehr.'

/** Whether a field of a body names something: neither left out, nor emptied. */
function given(value: unknown): boolean {
  return value !== undefined && value !== null && value !== ''
}

/** What a defect by hand hangs on: the property, and at most one of an asset, a room and a building there. */
interface Target {
  readonly propertyId: Defect['propertyId']
  readonly areaId: Defect['areaId']
  readonly buildingId: Defect['buildingId']
  readonly roomId: Defect['roomId']
  readonly assetId: Defect['assetId']
}

/**
 * What a defect hangs on (section 4.6: "immer an einer Anlage oder einem
 * Ort"): at most one of an asset, a room or a building, and the property
 * itself where none is named. Each is a row the person asking sees, and a
 * property named beside one of them has to be its property.
 */
async function targetOf(
  tx: TenantTransaction,
  values: Readonly<Record<string, unknown>>,
): Promise<Target> {
  const named = (['assetId', 'roomId', 'buildingId'] as const).filter((field) =>
    given(values[field]),
  )

  if (named.length > 1) {
    throw new BadRequestException(
      'Ein Mangel hängt an genau einem: einer Anlage, einem Raum, einem Gebäude oder der Liegenschaft.',
    )
  }

  let place: { readonly propertyId: Defect['propertyId'] } & Partial<Target>

  if (given(values['assetId'])) {
    const asset = await placeOf<Asset>(
      tx,
      assets,
      String(values['assetId']),
      'Diese Anlage gibt es nicht oder nicht mehr.',
    )

    place = { propertyId: asset.propertyId, assetId: asset.id }
  } else if (given(values['roomId'])) {
    const room = await placeOf<Room>(
      tx,
      rooms,
      String(values['roomId']),
      'Diesen Raum gibt es nicht oder nicht mehr.',
    )

    place = { propertyId: room.propertyId, roomId: room.id }
  } else if (given(values['buildingId'])) {
    const building = await placeOf<Building>(
      tx,
      buildings,
      String(values['buildingId']),
      'Dieses Gebäude gibt es nicht oder nicht mehr.',
    )

    place = { propertyId: building.propertyId, buildingId: building.id }
  } else if (given(values['propertyId'])) {
    place = { propertyId: String(values['propertyId']) as Defect['propertyId'] }
  } else {
    throw new BadRequestException(
      'Ein Mangel hängt an einer Anlage, einem Raum, einem Gebäude oder einer Liegenschaft; keines ist genannt.',
    )
  }

  if (given(values['propertyId']) && values['propertyId'] !== place.propertyId) {
    throw new BadRequestException('Die Liegenschaft ist nicht die, auf der das Genannte steht.')
  }

  const property = await placeOf<Property>(
    tx,
    properties,
    place.propertyId,
    'Diese Liegenschaft gibt es nicht oder nicht mehr.',
  )

  return {
    propertyId: property.id,
    areaId: property.areaId,
    buildingId: place.buildingId ?? null,
    roomId: place.roomId ?? null,
    assetId: place.assetId ?? null,
  }
}

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
      const target = await targetOf(tx, values)
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
    return this.database.forTenant(identity, async (tx) => {
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
    })
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
