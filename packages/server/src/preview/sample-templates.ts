import type { Identity, TemplateDefinition } from '@opengewerk/haustechnik-domain'
import type { Database } from '@opengewerk/platform-server'
import { and, asc, isNotNull, isNull } from 'drizzle-orm'

import { assets, rooms, roundTemplates, roundTemplateVersions } from '../database/schema/index.js'

/**
 * A template of a round in the preview (#112), with two versions, so that the
 * editor shows what it is for: chapters, a measured value with a limit of its
 * own and one against a rule, check points at an asset and a room, and one
 * point at an asset that is gone, which stands out before anybody saves. In
 * the database, as a test does: the route asks for what the editor checks,
 * and the point that is gone is one it would refuse.
 */
export async function giveSampleTemplates(database: Database, planter: Identity): Promise<void> {
  await database.forTenant(planter, async (tx) => {
    const [asset] = await tx
      .select()
      .from(assets)
      .where(isNull(assets.deletedAt))
      .orderBy(asc(assets.number))
      .limit(1)
    const [room] = await tx
      .select({ id: rooms.id })
      .from(rooms)
      .where(and(isNull(rooms.deletedAt), isNotNull(rooms.number)))
      .orderBy(asc(rooms.id))
      .limit(1)

    if (asset === undefined || room === undefined) {
      return
    }

    // The circulation pump, taken out since the second version was saved.
    const [gone] = await tx
      .insert(assets)
      .values({
        tenantId: planter.tenantId,
        propertyId: asset.propertyId,
        areaId: asset.areaId,
        buildingId: asset.buildingId,
        kind: asset.kind,
        number: 'AN-09999',
        name: 'Zirkulationspumpe',
        deletedAt: new Date(),
      })
      .returning({ id: assets.id })

    if (gone === undefined) {
      return
    }

    const first: TemplateDefinition = {
      title: 'Technikzentrale Schulhaus',
      sections: [
        {
          key: 'k1',
          title: 'Heizraum',
          fields: [
            {
              kind: 'measurement',
              key: 'p1',
              label: 'Temperatur am Speicheraustritt',
              unit: 'degrees_celsius',
              decimals: 1,
              required: true,
              limit: { kind: 'stated', bound: 'at_least', milli: 60_000, source: 'DVGW W 551' },
              about: { kind: 'asset', id: asset.id },
            },
            {
              kind: 'check_point',
              key: 'p3',
              label: 'Heizkessel ohne Störungsanzeige',
              about: { kind: 'asset', id: asset.id },
            },
            {
              kind: 'check_point',
              key: 'p4',
              label: 'Tür schließt selbsttätig',
              about: { kind: 'room', id: room.id },
            },
            { kind: 'photo', key: 'p5', label: 'Foto der Anzeigen am Kessel' },
          ],
        },
        {
          key: 'k2',
          title: 'Kaltwasser',
          fields: [
            {
              kind: 'measurement',
              key: 'p6',
              label: 'Temperatur Kaltwasser',
              unit: 'degrees_celsius',
              decimals: 1,
              limit: { kind: 'at_most', rule: 'vorschau.cold_water_maximum' },
            },
            { kind: 'text', key: 'p7', label: 'Sonst aufgefallen', multiline: true },
          ],
        },
      ],
    }
    // The second version adds the circulation, at the pump that is gone.
    const second: TemplateDefinition = {
      ...first,
      sections: first.sections.map((section) =>
        section.key === 'k1'
          ? {
              ...section,
              fields: [
                ...section.fields.slice(0, 1),
                {
                  kind: 'measurement',
                  key: 'p2',
                  label: 'Rücklauftemperatur der Zirkulation',
                  unit: 'degrees_celsius',
                  decimals: 1,
                  limit: { kind: 'stated', bound: 'at_least', milli: 55_000, source: 'DVGW W 551' },
                  about: { kind: 'asset', id: gone.id },
                },
                ...section.fields.slice(1),
              ],
            }
          : section,
      ),
    }
    const [template] = await tx
      .insert(roundTemplates)
      .values({ tenantId: planter.tenantId, title: second.title })
      .returning({ id: roundTemplates.id })

    if (template === undefined) {
      return
    }

    for (const [index, definition] of [first, second].entries()) {
      await tx.insert(roundTemplateVersions).values({
        tenantId: planter.tenantId,
        templateId: template.id,
        formVersion: index + 1,
        definition,
        asksCountersignature: true,
      })
    }
  })
}
