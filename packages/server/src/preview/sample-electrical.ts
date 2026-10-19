import { type Identity } from '@opengewerk/haustechnik-domain'
import type { Database } from '@opengewerk/platform-server'
import { and, eq, isNull } from 'drizzle-orm'

import {
  assets,
  boardSections,
  circuits,
  distributionBoards,
  equipment,
} from '../database/schema/index.js'

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
