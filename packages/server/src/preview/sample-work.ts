import type { ActivityId, Identity } from '@opengewerk/haustechnik-domain'
import type { Database } from '@opengewerk/platform-server'
import { and, eq, isNull } from 'drizzle-orm'

import {
  activities,
  workOrderNotes,
  workOrderParticipants,
  workOrders,
} from '../database/schema/index.js'
import { dayInGermany } from '../today.js'

/** The order the viewer leads, begun on site, and the one the viewer works on beside its lead. */
export const sampleWork = {
  leads: 'Haltegenauigkeit der Kabine nachstellen',
  worksOn: 'Heizkessel Mensa entlüften',
} as const

/**
 * The work on site for the viewer (#118), written behind the routes as a
 * device would send it: the viewer leads one order of the planting, begun
 * today, with a note of a colleague who works on it, a note of the viewer's
 * own and the time spent; and works on a second order beside the person who
 * leads it, so that the page of an order shows "Abschließen" once and once
 * not. Who wrote a note is the server's to write, as the sync does it.
 */
export async function giveSampleWork(
  database: Database,
  planter: Identity,
  viewer: string,
): Promise<void> {
  const now = Date.now()
  const minutesAgo = (minutes: number) => new Date(now - minutes * 60_000)

  await database.forTenant(planter, async (tx) => {
    const orderOf = async (title: string) => {
      const [found] = await tx
        .select({ activity: activities, order: workOrders })
        .from(activities)
        .innerJoin(workOrders, eq(workOrders.activityId, activities.id))
        .where(
          and(
            eq(activities.title, title),
            eq(activities.kind, 'work_order'),
            isNull(activities.deletedAt),
          ),
        )

      if (found === undefined) {
        throw new Error(`Den Auftrag „${title}“ der Beispieldaten gibt es nicht.`)
      }

      return found
    }

    const led = await orderOf(sampleWork.leads)
    const place = {
      tenantId: planter.tenantId,
      propertyId: led.activity.propertyId,
      areaId: led.activity.areaId,
      activityId: led.activity.id,
    }

    await tx
      .update(activities)
      .set({ responsibleUserId: viewer, status: 'started', performedOn: dayInGermany() })
      .where(eq(activities.id, led.activity.id as ActivityId))
    await tx.insert(workOrderParticipants).values({ ...place, userId: 'preview-yilmaz' })
    await tx.insert(workOrderNotes).values([
      {
        ...place,
        text: 'Kabine im Erdgeschoss vermessen: sie hält 2 cm unter der Schwelle, im 1. OG bündig.',
        writtenAt: minutesAgo(95),
        writtenBy: 'preview-yilmaz',
      },
      {
        ...place,
        text: 'Bremse und Geber geprüft, Nachstellung der Steuerung angefragt.',
        writtenAt: minutesAgo(40),
        writtenBy: viewer,
      },
    ])
    await tx.update(workOrders).set({ durationMinutes: 45 }).where(eq(workOrders.id, led.order.id))

    const helped = await orderOf(sampleWork.worksOn)

    await tx.insert(workOrderParticipants).values({
      tenantId: planter.tenantId,
      propertyId: helped.activity.propertyId,
      areaId: helped.activity.areaId,
      activityId: helped.activity.id,
      userId: viewer,
    })
  })
}
