import type { CataloguePackage, Identity, PackagedForm } from '@opengewerk/haustechnik-domain'
import type { Database } from '@opengewerk/platform-server'
import { and, eq, isNotNull, isNull } from 'drizzle-orm'

import { activities } from '../database/schema/index.js'

/**
 * A package for the preview alone (#107): one form with a field of every
 * kind the forms of this application have, a measured value against a rule
 * among them and a repeating group, for the visual check of a meter, so that the form on site can be seen
 * before the packages with forms (#91, #93) are there. Nothing of it is
 * shipped, and nobody has checked it against a source; the rule names its
 * source as a package would.
 */

const meterCheck: PackagedForm = {
  title: 'Sichtprüfung der Zähleranlage',
  sections: [
    {
      key: 'meter',
      title: 'Zähler',
      fields: [
        { kind: 'check_point', key: 'seal_intact', label: 'Plombe unversehrt' },
        { kind: 'check_point', key: 'no_leak', label: 'Zähler dicht' },
        {
          kind: 'meter_reading',
          key: 'reading',
          label: 'Zählerstand',
          unit: 'cubic_metres',
          decimals: 3,
          required: true,
        },
        { kind: 'photo', key: 'dial', label: 'Foto des Zählwerks' },
      ],
    },
    {
      key: 'cold_water',
      title: 'Kaltwasser',
      fields: [
        {
          kind: 'measurement',
          key: 'temperature',
          label: 'Temperatur des Kaltwassers',
          unit: 'degrees_celsius',
          decimals: 1,
          required: true,
          limit: { kind: 'at_most', rule: 'vorschau.cold_water_maximum' },
        },
        {
          kind: 'number',
          key: 'flushed',
          label: 'Beim Spülen abgelassen',
          unit: 'cubic_metres',
          decimals: 3,
        },
      ],
    },
    {
      key: 'surroundings',
      title: 'Umgebung',
      fields: [
        { kind: 'yes_no', key: 'accessible', label: 'Zähler frei zugänglich' },
        {
          kind: 'choice',
          key: 'valves',
          label: 'Zustand der Absperrarmaturen',
          options: [
            { value: 'smooth', label: 'gängig' },
            { value: 'stiff', label: 'schwergängig' },
            { value: 'stuck', label: 'fest' },
          ],
        },
        {
          kind: 'group',
          key: 'valve_checks',
          label: 'Absperrventil',
          repeat: 'free',
          fields: [{ kind: 'check_point', key: 'closes', label: 'Schließt ganz' }],
        },
        { kind: 'text', key: 'noticed', label: 'Sonst aufgefallen', multiline: true },
      ],
    },
    {
      key: 'end',
      title: 'Abschluss',
      fields: [{ kind: 'signature', key: 'signature', label: 'Unterschrift', seals: true }],
    },
  ],
}

/** The key the activities of the preview name the form by. */
export const sampleFormKey = 'vorschau.meter_check'

const unchecked = { checkedOn: '2026-10-09', accepted: null } as const

export const samplePackage: CataloguePackage = {
  name: 'vorschau',
  title: 'Vorschaupaket',
  version: '1.0.0',
  minimumCore: '0.0.0',
  assetKinds: [],
  dutyKinds: [],
  forms: [
    {
      key: sampleFormKey,
      version: 1,
      validFrom: '2015-06-01',
      definition: meterCheck,
      review: unchecked,
    },
  ],
  // A template of a round to take over and adapt (#112, section 5).
  roundTemplates: [
    {
      key: 'vorschau.drinking_water_round',
      version: 1,
      validFrom: '2015-06-01',
      definition: {
        title: 'Monatsrundgang Trinkwasser',
        sections: [
          {
            key: 'heating',
            title: 'Trinkwassererwärmung',
            fields: [
              {
                kind: 'measurement',
                key: 'outlet',
                label: 'Temperatur am Speicheraustritt',
                unit: 'degrees_celsius',
                decimals: 1,
                required: true,
              },
              { kind: 'check_point', key: 'valve', label: 'Sicherheitsventil ohne Tropfen' },
            ],
          },
          {
            key: 'taps',
            title: 'Entnahmestellen',
            fields: [
              {
                kind: 'check_point',
                key: 'flushed',
                label: 'Selten genutzte Entnahmestellen gespült',
              },
              { kind: 'text', key: 'noticed', label: 'Sonst aufgefallen', multiline: true },
            ],
          },
        ],
      },
      review: unchecked,
    },
  ],
  rules: [
    {
      record: {
        key: 'vorschau.cold_water_maximum',
        validFrom: '2012-05-01',
        validUntil: null,
        unit: 'decidegrees_celsius',
        value: 250,
        source: 'DIN 1988-200',
        origin: 'private_standard',
      },
      review: unchecked,
    },
  ],
  defectClasses: [],
}

/**
 * Gives the form to an open inspection at an asset that the own people
 * perform and nobody is named for yet,
 * and the person looking at the preview performs it, so that their device
 * holds it: in the database, as a test does, because the form of an
 * activity comes from its duty kind, and no duty kind of the preview names
 * one yet. Called after the inspections of the due days are there and two of
 * them planned; an area without such an inspection keeps none.
 */
export async function giveSampleForm(
  database: Database,
  planter: Identity,
  viewer: string,
): Promise<void> {
  await database.forTenant(planter, async (tx) => {
    const [chosen] = await tx
      .select({ id: activities.id })
      .from(activities)
      .where(
        and(
          eq(activities.status, 'open'),
          eq(activities.kind, 'inspection'),
          eq(activities.performer, 'own_staff'),
          isNull(activities.performerUserId),
          isNotNull(activities.assetId),
          isNull(activities.deletedAt),
        ),
      )
      .orderBy(activities.id)
      .limit(1)

    if (chosen !== undefined) {
      await tx
        .update(activities)
        .set({
          formKey: sampleFormKey,
          formVersion: 1,
          performerUserId: viewer,
        })
        .where(eq(activities.id, chosen.id))
    }
  })
}
