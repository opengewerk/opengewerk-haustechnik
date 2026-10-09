import type { Identity, TemplateDefinition } from '@opengewerk/haustechnik-domain'
import type { Database } from '@opengewerk/platform-server'
import { and, asc, eq, isNull } from 'drizzle-orm'

import {
  activities,
  buildings,
  roundPlans,
  roundTemplates,
  roundTemplateVersions,
} from '../database/schema/index.js'
import { fillAhead } from '../rounds/plans.js'
import { dayInGermany } from '../today.js'

/**
 * The plans of the rounds in the preview (#113): a daily round for
 * everybody in the area, a weekly one for a person, a monthly one and one
 * that rests, at the first buildings of the sample operator, with their
 * rounds made as the routes make them. One round of today is begun and one
 * is handed to somebody else, so that the overview of the week shows more
 * than one state. In the database, as a test does, and after the templates
 * (`giveSampleTemplates`).
 */
export async function giveSamplePlans(database: Database, planter: Identity): Promise<void> {
  await database.forTenant(planter, async (tx) => {
    const today = dayInGermany(new Date())
    const places = await tx
      .select({ id: buildings.id, propertyId: buildings.propertyId, areaId: buildings.areaId })
      .from(buildings)
      .where(isNull(buildings.deletedAt))
      .orderBy(asc(buildings.name))
      .limit(3)
    const [kept] = await tx
      .select({ id: roundTemplates.id })
      .from(roundTemplates)
      .orderBy(asc(roundTemplates.createdAt))
      .limit(1)

    if (places.length < 3 || kept === undefined) {
      return
    }

    const daily: TemplateDefinition = {
      title: 'Wache, täglicher Rundgang',
      sections: [
        {
          key: 'k1',
          title: 'Fahrzeughalle',
          fields: [
            { kind: 'check_point', key: 'p1', label: 'Tore schließen vollständig' },
            { kind: 'check_point', key: 'p2', label: 'Abgasabsaugung ohne Störung' },
            { kind: 'text', key: 'p3', label: 'Sonst aufgefallen', multiline: true },
          ],
        },
      ],
    }
    const [walked] = await tx
      .insert(roundTemplates)
      .values({ tenantId: planter.tenantId, title: daily.title })
      .returning({ id: roundTemplates.id })

    if (walked === undefined) {
      return
    }

    await tx.insert(roundTemplateVersions).values({
      tenantId: planter.tenantId,
      templateId: walked.id,
      formVersion: 1,
      definition: daily,
      asksCountersignature: false,
    })

    const [first, second, third] = places as [
      (typeof places)[number],
      (typeof places)[number],
      (typeof places)[number],
    ]
    const at = (place: (typeof places)[number]) => ({
      tenantId: planter.tenantId,
      propertyId: place.propertyId,
      buildingId: place.id,
      areaId: place.areaId,
      startsOn: today,
    })
    const plans = await tx
      .insert(roundPlans)
      .values([
        { ...at(first), templateId: walked.id, rhythm: 'daily', weekdays: [1, 2, 3, 4, 5] },
        {
          ...at(second),
          templateId: kept.id,
          rhythm: 'weekly',
          weekdays: [3],
          leadDays: 1,
          performerUserId: 'preview-yilmaz',
        },
        { ...at(third), templateId: walked.id, rhythm: 'monthly', dayOfMonth: 5, leadDays: 3 },
        { ...at(first), templateId: kept.id, rhythm: 'weekly', weekdays: [4], resting: true },
      ])
      .returning()

    for (const plan of plans) {
      await fillAhead(tx, plan, today)
    }

    const [daily1] = plans

    if (daily1 === undefined) {
      return
    }

    const rounds = await tx
      .select({ id: activities.id })
      .from(activities)
      .where(and(eq(activities.roundPlanId, daily1.id), isNull(activities.deletedAt)))
      .orderBy(asc(activities.dueOn))
      .limit(2)
    const [begun, given] = rounds

    if (begun !== undefined) {
      await tx
        .update(activities)
        .set({ status: 'started', performedOn: today, performerUserId: 'preview-vogt' })
        .where(eq(activities.id, begun.id))
    }

    if (given !== undefined) {
      await tx
        .update(activities)
        .set({ performerUserId: 'preview-yilmaz' })
        .where(eq(activities.id, given.id))
    }
  })
}
