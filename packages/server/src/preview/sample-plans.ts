import {
  addDays,
  type Catalogue,
  type Identity,
  type IsoDate,
  type TemplateDefinition,
  weekOf,
} from '@opengewerk/haustechnik-domain'
import type { Database, TenantTransaction } from '@opengewerk/platform-server'
import { and, asc, eq, isNull } from 'drizzle-orm'

import { pageFingerprint, pageOf, takeSignature } from '../activities/signing.js'
import {
  activities,
  activityAnswers,
  buildings,
  roundPlans,
  roundTemplates,
  roundTemplateVersions,
} from '../database/schema/index.js'
import { fillAhead } from '../rounds/plans.js'
import { dayInGermany } from '../today.js'
import { previewColleagues, previewPeople } from './preview-database.js'

/**
 * The plans of the rounds in the preview (#113): a daily round for
 * everybody in the area, a weekly one for a person, a monthly one and one
 * that rests, at the first buildings of the sample operator, with their
 * rounds made as the routes make them. One round of today is begun and one
 * is handed to somebody else, so that the overview of the week shows more
 * than one state. A daily round of the person the preview answers as stands
 * on the start on site every day (#114). A weekly round of this week is
 * signed and waits for its countersignature, and two daily rounds of the
 * week before are still open, one of them begun (#115). In the database, as
 * a test does, and after the templates (`giveSampleTemplates`).
 */
export async function giveSamplePlans(
  database: Database,
  planter: Identity,
  catalogue: Catalogue,
): Promise<void> {
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
        {
          ...at(third),
          templateId: kept.id,
          rhythm: 'daily',
          weekdays: [1, 2, 3, 4, 5, 6, 7],
          leadDays: 2,
          performerUserId: previewPeople.viewer.id,
        },
      ])
      .returning()

    for (const plan of plans) {
      await fillAhead(tx, plan, today, catalogue)
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

    const [, weekly] = plans

    if (weekly === undefined) {
      return
    }

    // Open from the week before: Thursday begun, Friday untouched.
    const monday = weekOf(today)

    await passOf(tx, daily1, addDays(monday, -4), {
      status: 'started',
      performerUserId: 'preview-vogt',
    })
    await passOf(tx, daily1, addDays(monday, -3), {})

    // The Wednesday of this week, or of the week before while it is still ahead.
    const wednesday = addDays(monday, 2) < today ? addDays(monday, 2) : addDays(monday, -5)
    const signed = await passOf(tx, weekly, wednesday, {
      status: 'started',
      performedOn: wednesday,
    })

    if (signed === undefined) {
      return
    }

    const answer = (
      fieldKey: string,
      given: { value?: string; result?: string; remark?: string },
    ) => ({
      tenantId: planter.tenantId,
      propertyId: weekly.propertyId,
      areaId: weekly.areaId,
      activityId: signed,
      fieldKey,
      value: given.value ?? null,
      result: (given.result ?? null) as 'ok' | 'not_ok' | null,
      remark: given.remark ?? null,
    })

    await tx.insert(activityAnswers).values([
      answer('p1', { value: '61000' }),
      answer('p2', { value: '56500' }),
      answer('p3', { result: 'ok' }),
      answer('p4', {
        result: 'not_ok',
        remark: 'Türschließer ohne Funktion, die Tür bleibt offen stehen.',
      }),
    ])

    const [row] = await tx.select().from(activities).where(eq(activities.id, signed))

    if (row === undefined) {
      return
    }

    const signedAt = new Date(`${wednesday}T05:38:00.000Z`)

    await takeSignature(
      tx,
      {
        tenantId: planter.tenantId,
        writtenBy: 'preview-yilmaz',
        at: signedAt,
        catalogue,
        nameOf: (userId) =>
          previewColleagues.find((colleague) => colleague.id === userId)?.name ??
          'Unbekanntes Konto',
      },
      {
        activityId: signed,
        role: 'signer',
        signedAt,
        deviceInfo: 'Telefon',
        path: 'M90,250L180,140L250,280L340,130L430,270L520,150L610,250L720,170L840,220L930,190',
        pageFingerprint: pageFingerprint(await pageOf(tx, row)),
      },
    )
  })
}

/**
 * A round of a plan for a day its rounds were not made for, as the plan makes
 * one, in a state: the preview starts today, and its rounds with it.
 */
async function passOf(
  tx: TenantTransaction,
  plan: typeof roundPlans.$inferSelect,
  dueOn: IsoDate,
  state: Partial<
    Pick<typeof activities.$inferInsert, 'status' | 'performedOn' | 'performerUserId'>
  >,
): Promise<(typeof activities.$inferSelect)['id'] | undefined> {
  const [model] = await tx
    .select()
    .from(activities)
    .where(and(eq(activities.roundPlanId, plan.id), isNull(activities.deletedAt)))
    .limit(1)

  if (model === undefined) {
    return undefined
  }

  const [made] = await tx
    .insert(activities)
    .values({
      tenantId: model.tenantId,
      propertyId: model.propertyId,
      areaId: model.areaId,
      buildingId: model.buildingId,
      kind: 'round',
      title: model.title,
      status: 'open',
      dueOn,
      performer: 'own_staff',
      performerUserId: plan.performerUserId,
      countersignatureRequired: model.countersignatureRequired,
      formKey: model.formKey,
      formVersion: model.formVersion,
      roundPlanId: plan.id,
      ...state,
    })
    .onConflictDoNothing()
    .returning({ id: activities.id })

  return made?.id
}
