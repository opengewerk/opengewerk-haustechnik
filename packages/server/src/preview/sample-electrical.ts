import { type Catalogue, type Identity } from '@opengewerk/haustechnik-domain'
import type { Database } from '@opengewerk/platform-server'
import { and, eq, inArray, isNull } from 'drizzle-orm'

import { chartOfAsset } from '../activities/circuits.js'
import { makeActivityForDuty } from '../activities/for-duty.js'
import {
  activities,
  activityAnswers,
  activityDuties,
  assets,
  boardSections,
  circuits,
  distributionBoards,
  duties,
  equipment,
} from '../database/schema/index.js'
import { dayInGermany } from '../today.js'

/** The low-voltage installation of the sample operator the structure hangs on. */
export const sampleInstallation = 'Elektrische Anlage Halle 1'

/** A circuit as the sample writes it, with the figures in thousandths. */
interface SampleCircuit {
  readonly designation: string
  readonly consumer: string
  readonly overcurrentDevice: 'circuit_breaker' | 'rcbo' | 'fuse_nh'
  readonly tripCharacteristic: 'b' | 'c' | 'gg'
  readonly ratedCurrentMilli: number
  readonly rcd?: boolean
  readonly cableType: string
  readonly cableCores: number
  readonly cableCrossSectionMilli: number
  readonly cableLengthMilli: number
  readonly cableInstallationMethod: 'b2' | 'c'
  readonly equipment?: readonly {
    readonly designation: string
    readonly kind: string
    readonly manufacturer: string
    readonly model: string
    readonly serialNumber?: string
  }[]
}

/**
 * The electrical structure below the low-voltage installation of the sample
 * operator (#349), written behind the routes as an electrician would have
 * taken it down in front of the boards: the main distribution of the hall
 * with two sections, the feed of the sub distribution of the workshop in the
 * first and the lights, sockets and the gate of the hall behind RCDs in the
 * second, and the sub distribution with three circuits of its own. Some
 * circuits carry what hangs on them. Made-up figures and names, as in every
 * sample.
 */
export async function giveSampleElectrical(database: Database, planter: Identity): Promise<void> {
  await database.forTenant(planter, async (tx) => {
    const [installation] = await tx
      .select()
      .from(assets)
      .where(and(eq(assets.name, sampleInstallation), isNull(assets.deletedAt)))

    if (installation === undefined) {
      throw new Error(`Die Anlage „${sampleInstallation}“ der Beispieldaten gibt es nicht.`)
    }

    const place = {
      tenantId: planter.tenantId,
      assetId: installation.id,
      propertyId: installation.propertyId,
      areaId: installation.areaId,
    }
    const boardOf = async (
      kind: 'main_distribution' | 'sub_distribution',
      designation: string,
      location: string,
      position: number,
    ) =>
      (
        await tx
          .insert(distributionBoards)
          .values({ ...place, kind, designation, location, position })
          .returning({ id: distributionBoards.id })
      )[0]?.id
    const sectionOf = async (board: string, designation: string, position: number) =>
      (
        await tx
          .insert(boardSections)
          .values({ ...place, distributionBoardId: board as never, designation, position })
          .returning({ id: boardSections.id })
      )[0]?.id
    const circuitsOf = async (
      board: string,
      section: string | null,
      list: readonly SampleCircuit[],
    ) => {
      for (const [index, { rcd, equipment: devices, ...circuit }] of list.entries()) {
        const [made] = await tx
          .insert(circuits)
          .values({
            ...place,
            ...circuit,
            distributionBoardId: board as never,
            boardSectionId: section as never,
            rcdType: rcd === true ? 'a' : null,
            ratedResidualCurrentMilli: rcd === true ? 30 : null,
            position: index + 1,
          })
          .returning({ id: circuits.id })

        for (const [at, device] of (devices ?? []).entries()) {
          await tx.insert(equipment).values({
            ...place,
            ...device,
            circuitId: made?.id as never,
            position: at + 1,
          })
        }
      }
    }

    const main = await boardOf('main_distribution', 'HV Halle 1', 'Technikraum E.01', 0)
    const sub = await boardOf('sub_distribution', 'UV Werkstatt', 'Werkstatt E.03', 1)

    if (main === undefined || sub === undefined) {
      return
    }

    const feed = await sectionOf(main, 'Feld 1: Einspeisung', 1)
    const hall = await sectionOf(main, 'Feld 2: Halle', 2)

    await circuitsOf(main, feed ?? null, [
      {
        designation: 'Q1',
        consumer: 'Zuleitung UV Werkstatt',
        overcurrentDevice: 'fuse_nh',
        tripCharacteristic: 'gg',
        ratedCurrentMilli: 63_000,
        cableType: 'NYY-J',
        cableCores: 5,
        cableCrossSectionMilli: 16_000,
        cableLengthMilli: 28_000,
        cableInstallationMethod: 'c',
      },
    ])
    await circuitsOf(main, hall ?? null, [
      {
        designation: 'F1',
        consumer: 'Beleuchtung Halle 1',
        overcurrentDevice: 'circuit_breaker',
        tripCharacteristic: 'b',
        ratedCurrentMilli: 16_000,
        rcd: true,
        cableType: 'NYM-J',
        cableCores: 3,
        cableCrossSectionMilli: 1_500,
        cableLengthMilli: 42_000,
        cableInstallationMethod: 'c',
        equipment: [
          {
            designation: 'Hallenleuchten 1 bis 12',
            kind: 'Leuchte',
            manufacturer: 'Muster Licht',
            model: 'HB-150',
          },
        ],
      },
      {
        designation: 'F2',
        consumer: 'Steckdosen Nordwand',
        overcurrentDevice: 'circuit_breaker',
        tripCharacteristic: 'b',
        ratedCurrentMilli: 16_000,
        rcd: true,
        cableType: 'NYM-J',
        cableCores: 3,
        cableCrossSectionMilli: 2_500,
        cableLengthMilli: 35_000,
        cableInstallationMethod: 'b2',
      },
      {
        designation: 'F3',
        consumer: 'Steckdosen Meisterbüro',
        overcurrentDevice: 'rcbo',
        tripCharacteristic: 'b',
        ratedCurrentMilli: 16_000,
        rcd: true,
        cableType: 'NYM-J',
        cableCores: 3,
        cableCrossSectionMilli: 2_500,
        cableLengthMilli: 18_000,
        cableInstallationMethod: 'c',
      },
      {
        designation: 'F4',
        consumer: 'Rolltor Halle 1',
        overcurrentDevice: 'circuit_breaker',
        tripCharacteristic: 'c',
        ratedCurrentMilli: 16_000,
        cableType: 'NYM-J',
        cableCores: 5,
        cableCrossSectionMilli: 2_500,
        cableLengthMilli: 12_000,
        cableInstallationMethod: 'c',
        equipment: [
          {
            designation: 'Antrieb Rolltor',
            kind: 'Motor',
            manufacturer: 'Torbau Probe',
            model: 'RT 400',
            serialNumber: 'RT-2019-0815',
          },
        ],
      },
    ])
    await circuitsOf(sub, null, [
      {
        designation: 'F1',
        consumer: 'Beleuchtung Werkstatt',
        overcurrentDevice: 'circuit_breaker',
        tripCharacteristic: 'b',
        ratedCurrentMilli: 10_000,
        rcd: true,
        cableType: 'NYM-J',
        cableCores: 3,
        cableCrossSectionMilli: 1_500,
        cableLengthMilli: 15_000,
        cableInstallationMethod: 'c',
      },
      {
        designation: 'F2',
        consumer: 'Steckdosen Werkbank',
        overcurrentDevice: 'circuit_breaker',
        tripCharacteristic: 'b',
        ratedCurrentMilli: 16_000,
        rcd: true,
        cableType: 'NYM-J',
        cableCores: 3,
        cableCrossSectionMilli: 2_500,
        cableLengthMilli: 9_000,
        cableInstallationMethod: 'c',
      },
      {
        designation: 'F3',
        consumer: 'CEE-Steckdose 400 V',
        overcurrentDevice: 'circuit_breaker',
        tripCharacteristic: 'c',
        ratedCurrentMilli: 16_000,
        rcd: true,
        cableType: 'NYM-J',
        cableCores: 5,
        cableCrossSectionMilli: 2_500,
        cableLengthMilli: 7_000,
        cableInstallationMethod: 'c',
        equipment: [
          {
            designation: 'CEE-Steckdose 16 A',
            kind: 'Steckdose',
            manufacturer: 'Muster Elektro',
            model: 'CEE 16/5',
          },
        ],
      },
    ])
  })
}

/** The form the test of the installation is filled in (#350), and its duty kind. */
export const sampleCircuitTest = {
  form: 'elektro.installation_test',
  dutyKind: 'elektro.installation_test_dguv_v3',
} as const

/**
 * The test of the installation on site, half done (#350): the duty of DGUV
 * Vorschrift 3 at the installation is due, its inspection in the version
 * of the duty kind whose form measures every circuit, performed by the
 * viewer, begun today, with the general points answered and the first three
 * circuits of the chart measured, the loop impedance of the sockets of the
 * north wall outside the limit worked out of the circuit, with its remark.
 * What is left is for the screens on site to show. Called after the boards
 * are there; the inspection the engine made for the due day is taken, and
 * one is made where there is none.
 */
export async function giveSampleCircuitTest(
  database: Database,
  planter: Identity,
  viewer: string,
  catalogue: Catalogue,
): Promise<void> {
  const today = dayInGermany()

  await database.forTenant(planter, async (tx) => {
    const [installation] = await tx
      .select()
      .from(assets)
      .where(and(eq(assets.name, sampleInstallation), isNull(assets.deletedAt)))
    const [duty] =
      installation === undefined
        ? []
        : await tx
            .select({ id: duties.id })
            .from(duties)
            .where(
              and(
                eq(duties.assetId, installation.id),
                eq(duties.kind, sampleCircuitTest.dutyKind),
                isNull(duties.deletedAt),
              ),
            )
    const form = catalogue.form(sampleCircuitTest.form, today)

    if (installation === undefined || duty === undefined || form === null) {
      throw new Error(
        `Die Prüfung der Anlage „${sampleInstallation}“ hat keine Pflicht mit Formular.`,
      )
    }

    const underWay = async () =>
      (
        await tx
          .select({ id: activities.id })
          .from(activities)
          .innerJoin(
            activityDuties,
            and(eq(activityDuties.activityId, activities.id), eq(activityDuties.dutyId, duty.id)),
          )
          .where(and(inArray(activities.status, ['open', 'started']), isNull(activities.deletedAt)))
      )[0]?.id
    const activityId =
      (await underWay()) ??
      (
        await makeActivityForDuty(tx, catalogue, {
          tenantId: planter.tenantId,
          dutyId: duty.id,
          dueOn: today,
          responsible: viewer,
          now: new Date(),
        })
      ).made

    if (activityId === null || activityId === undefined) {
      return
    }

    await tx
      .update(activities)
      .set({
        status: 'started',
        performedOn: today,
        performer: 'own_staff',
        performerUserId: viewer,
        formKey: form.key,
        formVersion: form.version,
      })
      .where(eq(activities.id, activityId))

    const place = {
      tenantId: planter.tenantId,
      propertyId: installation.propertyId,
      areaId: installation.areaId,
      activityId,
    }
    const answer = (
      fieldKey: string,
      given: { value?: string; result?: 'ok'; remark?: string },
      block: string | null = null,
    ) => ({
      ...place,
      fieldKey,
      groupKey: block === null ? null : 'circuits',
      blockKey: block,
      value: given.value ?? null,
      result: given.result ?? null,
      remark: given.remark ?? null,
    })
    const chart = await chartOfAsset(tx, planter.tenantId, installation.id)
    // RPE, Riso, Zs, IΔ and tΔ in thousandths of their units, the circuits
    // in the order of the chart; one without an RCD has neither of the last.
    const measured: readonly (readonly [number, number, number, number, number])[] = [
      [80, 480_000, 180, 0, 0],
      [420, 520_000, 920, 21_000, 24_000],
      [310, 350_000, 3_400, 19_000, 21_000],
    ]
    const fields = [
      'protective_conductor',
      'insulation_resistance',
      'loop_impedance',
      'rcd_trip_current',
      'rcd_trip_time',
    ]
    const circuitAnswers = chart.slice(0, measured.length).flatMap((circuit, index) =>
      (measured[index] ?? []).flatMap((value, at) =>
        at >= 3 && circuit.ratedResidualCurrentMilli === null
          ? []
          : [
              answer(
                fields[at] ?? '',
                {
                  value: String(value),
                  // The loop impedance of the third, outside its limit, with its remark.
                  ...(index === 2 && at === 2
                    ? { remark: 'Zweimal gemessen, gleicher Wert.' }
                    : {}),
                },
                circuit.id,
              ),
            ],
      ),
    )

    await tx
      .insert(activityAnswers)
      .values([
        answer('instrument', { value: JSON.stringify('Installationstester Probe 1664') }),
        answer('earthing_system', { value: JSON.stringify('tn_s') }),
        ...[
          'basic_protection',
          'protective_devices',
          'conductors',
          'identification',
          'fire_protection',
          'documentation',
        ].map((point) => answer(point, { result: 'ok' })),
        ...circuitAnswers,
      ])
  })
}
