import { shippedRoles, type TenantId } from '@opengewerk/haustechnik-domain'
import { Database, newId } from '@opengewerk/platform-server'
import type { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { applicationDatabaseUrl, connect, resetToMigrated } from '../database/test-database.js'
import { dueDeadlines, dueTasks, rejectedOrders, waitingActivities } from './notify.js'
import { notify, notifyPush, occasions } from './occasions.js'
import { tellHandedOut } from './tell.js'

/**
 * Who is told what, and when not at all (#126, section 3 of the concept).
 *
 * An operator with two areas. The Leitung sees both; an Objektleitung and
 * somebody of the Haustechnik work in the north, and one of each in the
 * south. Everybody has a device that takes push unless a test says
 * otherwise. Next door is a second operator, whose people must never hear of
 * anything here.
 *
 * Every test asks the rows what was written: a message is a row in an
 * outbox, and what it says is on the row.
 */

const operator = newId<'tenant'>() as TenantId
const neighbour = newId<'tenant'>() as TenantId

const people = {
  'u-lead': 'management',
  'u-site': 'site_management',
  'u-tech': 'technician',
  'u-site-south': 'site_management',
  'u-tech-south': 'technician',
} as const

type Person = keyof typeof people

let admin: Pool
let database: Database
let north = ''
let south = ''
let northern = ''
let southern = ''

/** A morning in October, after six in Germany. */
const morning = new Date('2026-10-13T08:00:00Z')
const today = '2026-10-13'

async function one<Row>(text: string, values: readonly unknown[]): Promise<Row> {
  const { rows } = await admin.query(text, [...values])

  return rows[0] as Row
}

/** A device of this person that takes push, signed in. */
async function aDevice(
  person: Person | 'u-next',
  tenantId: TenantId = operator,
  entry: 'office' | 'site' = 'office',
): Promise<string> {
  const session = newId()

  await admin.query(
    `insert into auth_sessions (id, token, user_id, expires_at, active_tenant_id, created_at, updated_at)
     values ($1, $1, $2, '2038-01-01', $3, now(), now())`,
    [session, person, tenantId],
  )

  return (
    await one<{ id: string }>(
      `insert into push_subscriptions (tenant_id, user_id, session_id, entry, label, endpoint, p256dh, auth)
       values ($1, $2, $3, $4, 'Firefox auf Windows', $5, 'BPublic', 'Secret')
       returning id`,
      [tenantId, person, session, entry, `https://push.example.com/${person}/${newId()}`],
    )
  ).id
}

async function switchedOff(person: Person, occasion: string): Promise<void> {
  await admin.query(
    'insert into push_opt_outs (tenant_id, user_id, occasion) values ($1, $2, $3)',
    [operator, person, occasion],
  )
}

/** The push messages written, with whom each went to. */
async function pushed(): Promise<
  { user: string; kind: string; title: string; body: string; url: string; cause: string }[]
> {
  const { rows } = await admin.query(
    `select s.user_id as user, o.kind::text as kind, o.title, o.body, o.url, o.cause
       from push_outbox o join push_subscriptions s on s.id = o.subscription_id
      order by s.user_id, o.cause`,
  )

  return rows as never
}

async function mailed(): Promise<
  { kind: string; to: string; subject: string; body: string; sender: string }[]
> {
  const { rows } = await admin.query(
    `select kind::text as kind, recipient_address as to, subject, body, sender_name as sender
       from mail_outbox order by created_at`,
  )

  return rows as never
}

interface ActivityFacts {
  readonly kind?: 'round' | 'inspection' | 'work_order'
  readonly property?: string
  readonly area?: string
  readonly status?: string
  readonly dueOn?: string | null
  readonly responsible?: Person | null
  readonly performer?: Person | null
  readonly countersignature?: boolean
  readonly urgency?: 'normal' | 'urgent' | 'immediate'
}

let numbers = 0

/** An activity in the north unless it says otherwise; a work order comes with its order. */
async function anActivity(facts: ActivityFacts = {}): Promise<{ id: string; order: string }> {
  const kind = facts.kind ?? 'inspection'
  const { id } = await one<{ id: string }>(
    `insert into activities (tenant_id, property_id, area_id, kind, title, status, due_on,
                             responsible_user_id, performer_user_id, countersignature_required)
     values ($1, $2, $3, $4, 'Technikzentrale Schulhaus', $5, $6, $7, $8, $9)
     returning id`,
    [
      operator,
      facts.property ?? northern,
      facts.area ?? north,
      kind,
      facts.status ?? 'open',
      facts.dueOn === undefined ? '2026-10-20' : facts.dueOn,
      facts.responsible ?? null,
      facts.performer ?? null,
      facts.countersignature ?? false,
    ],
  )

  if (kind !== 'work_order') {
    return { id, order: '' }
  }

  numbers += 1

  const order = await one<{ id: string }>(
    `insert into work_orders (tenant_id, property_id, area_id, activity_id, number, kind, urgency)
     values ($1, $2, $3, $4, $5, 'fault', $6)
     returning id`,
    [
      operator,
      facts.property ?? northern,
      facts.area ?? north,
      id,
      `AU-2026-${String(numbers).padStart(4, '0')}`,
      facts.urgency ?? 'normal',
    ],
  )

  return { id, order: order.id }
}

/** The signature of whoever did the work, a moment ago unless it says when. */
async function signedBy(
  activity: string,
  person: Person,
  at: string | null = null,
  area = north,
  property = northern,
): Promise<string> {
  const { id } = await one<{ id: string }>(
    `insert into activity_signatures (tenant_id, property_id, area_id, activity_id, signed_by, role,
                                      signed_at, path, page_fingerprint)
     values ($1, $2, $3, $4, $5, 'signer', coalesce($6::timestamptz, now()), 'M10,10L200,300', $7)
     returning id`,
    [operator, property, area, activity, person, at, 'b'.repeat(64)],
  )

  await admin.query("update activities set status = 'signed' where id = $1", [activity])

  return id
}

async function rejectedBy(order: string, activity: string, person: Person): Promise<string> {
  const { id } = await one<{ id: string }>(
    `insert into work_order_decisions (tenant_id, property_id, area_id, work_order_id, decision,
                                       reason, decided_by)
     values ($1, $2, $3, $4, 'rejected', 'Der Notruf geht noch nicht.', $5)
     returning id`,
    [operator, northern, north, order, person],
  )

  await admin.query("update activities set status = 'started' where id = $1", [activity])

  return id
}

/** A task for somebody, due today unless it says otherwise. */
async function aTask(person: Person, dueOn = today): Promise<string> {
  return (
    await one<{ id: string }>(
      `insert into tasks (tenant_id, property_id, area_id, title, due_on, assignee_user_id)
       values ($1, $2, $3, 'Schlüssel bei Herrn Albrecht abholen', $4, $5)
       returning id`,
      [operator, northern, north, dueOn, person],
    )
  ).id
}

/** The reading of the meters of the property in the north, reminded for its day a moment ago. */
async function aDeadline(over: { task?: string; remindedAt?: string } = {}): Promise<string> {
  return (
    await one<{ id: string }>(
      `insert into deadlines (tenant_id, kind, source_id, source_label, anchor_on, due_on, lead_days,
                              meter_property_id, property_id, area_id, task_id,
                              reminded_for, reminded_at)
       values ($1, 'meter.due', $2, 'Zähler, Schulzentrum Am Neckar', '2026-10-16', '2026-10-16', 3,
               $2, $2, $3, $4, '2026-10-16', coalesce($5::timestamptz, now()))
       returning id`,
      [operator, northern, north, over.task ?? null, over.remindedAt ?? null],
    )
  ).id
}

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()

  await admin.query('insert into tenants (id, name) values ($1, $2), ($3, $4)', [
    operator,
    'Liegenschaften Beispielstadt',
    neighbour,
    'Wohnbau Nord eG',
  ])

  for (const tenantId of [operator, neighbour]) {
    for (const role of shippedRoles) {
      await admin.query(
        `insert into tenant_roles (tenant_id, key, label, rights, leads, second_factor)
         values ($1, $2, $3, $4, $5, $6)`,
        [tenantId, role.key, role.label, [...role.rights], role.leads, role.secondFactor],
      )
    }
  }

  const { rows } = await admin.query<{ id: string; name: string }>(
    `insert into areas (tenant_id, name) values ($1, 'Nord'), ($1, 'Süd') returning id, name`,
    [operator],
  )

  north = rows.find((each) => each.name === 'Nord')?.id ?? ''
  south = rows.find((each) => each.name === 'Süd')?.id ?? ''

  for (const [userId, role] of Object.entries(people)) {
    await admin.query('insert into auth_users (id, name, email) values ($1, $2, $3)', [
      userId,
      userId === 'u-lead' ? 'Sabine Krämer' : userId,
      `${userId}@beispielstadt.example`,
    ])
    await admin.query('insert into memberships (tenant_id, user_id, roles) values ($1, $2, $3)', [
      operator,
      userId,
      [role],
    ])
  }

  // Whoever leads sees every area from the moment the membership is written;
  // the others work in the north or in the south.
  for (const [userId, area] of [
    ['u-site', north],
    ['u-tech', north],
    ['u-site-south', south],
    ['u-tech-south', south],
  ] as const) {
    await admin.query(
      'insert into member_areas (tenant_id, user_id, area_id) values ($1, $2, $3)',
      [operator, userId, area],
    )
  }

  // Somebody who leads next door and works nowhere here.
  await admin.query(
    "insert into auth_users (id, name, email) values ('u-next', 'Nina Nachbar', 'n@x.example')",
  )
  await admin.query(
    "insert into memberships (tenant_id, user_id, roles) values ($1, 'u-next', '{management}')",
    [neighbour],
  )

  const property = (area: string, name: string) =>
    one<{ id: string }>(
      `insert into properties (tenant_id, area_id, name, street, postal_code, city, federal_state)
       values ($1, $2, $3, 'Hauptstraße 1', '00001', 'Beispielstadt', 'DE-BW')
       returning id`,
      [operator, area, name],
    )

  northern = (await property(north, 'Schulzentrum Am Neckar')).id
  southern = (await property(south, 'Werkhof Süd')).id

  database = Database.connect(applicationDatabaseUrl())
})

beforeEach(async () => {
  await admin.query('delete from push_outbox')
  await admin.query('delete from push_opt_outs')
  await admin.query('delete from push_subscriptions')
  await admin.query('delete from mail_outbox')
  await admin.query('update deadlines set task_id = null')
  await admin.query('delete from deadlines')
  await admin.query('delete from tasks')
  // A signature is never deleted, the database sees to that. What a test
  // before this one left is marked as removed instead, which is how an
  // activity leaves the application as well.
  await admin.query('update activities set deleted_at = now() where deleted_at is null')
  await admin.query('update memberships set blocked_at = null')

  for (const person of Object.keys(people) as Person[]) {
    await aDevice(person)
  }

  await aDevice('u-next', neighbour)
})

afterAll(async () => {
  await database.close()
  await admin.end()
})

describe('a deadline that reminds', () => {
  it('goes by mail to whoever answers for it, once, and names the kind and the day and nothing of the place', async () => {
    const deadline = await aDeadline()
    const [raised] = await dueDeadlines(database, operator, new Date())

    expect(raised).toMatchObject({
      kind: 'deadline_due',
      deadlineId: deadline,
      dueOn: '2026-10-16',
    })

    const context = { origin: 'https://haustechnik.example.de' }

    expect(await notify(database, operator, raised!, context)).toHaveLength(1)
    // Asked again for the same cause, it finds the row and writes nothing.
    expect(await notify(database, operator, raised!, context)).toEqual([])
    expect(await dueDeadlines(database, operator, new Date())).toEqual([])

    const [mail] = await mailed()

    expect(mail).toMatchObject({
      kind: 'deadline_due',
      // The reading of the meters reminds whoever leads the operator.
      to: 'u-lead@beispielstadt.example',
      sender: 'Liegenschaften Beispielstadt',
      subject: 'Frist am 16.10.2026: Zählerablesung zum Stichtag',
    })
    expect(mail?.body).toBe(
      [
        'Guten Tag Sabine Krämer,',
        '',
        'am 16.10.2026 ist diese Frist fällig:',
        '',
        'Zählerablesung zum Stichtag',
        '',
        'Was dahinter steht, zeigt die Liste der Fristen: https://haustechnik.example.de/fristen',
        '',
        '-- ',
        'Liegenschaften Beispielstadt',
      ].join('\n'),
    )
    // What the deadline follows is named by a property: it stays out.
    expect(mail?.body).not.toContain('Schulzentrum')
  })

  it('goes by push to the same person, with the kind and the day', async () => {
    await aDeadline()

    const [raised] = await dueDeadlines(database, operator, new Date(), undefined, 'push')

    await notifyPush(database, operator, raised!, { now: new Date() })

    expect(await pushed()).toEqual([
      {
        user: 'u-lead',
        kind: 'deadline_due',
        title: 'Frist am 16.10.2026',
        body: 'Zählerablesung zum Stichtag',
        url: '/fristen',
        cause: raised && occasions.causeOf(raised),
      },
    ])
  })

  it('is told to nobody once it is done, and not at all when it was reminded long ago', async () => {
    const closed = await aDeadline()
    const [raised] = await dueDeadlines(database, operator, new Date())

    await admin.query("update deadlines set status = 'done', closed_at = now() where id = $1", [
      closed,
    ])

    expect(
      await notify(database, operator, raised!, { origin: 'https://haustechnik.example.de' }),
    ).toEqual([])
    expect(await notifyPush(database, operator, raised!, { now: new Date() })).toEqual([])

    await admin.query('delete from deadlines')
    await aDeadline({ remindedAt: '2026-01-01T08:00:00Z' })

    // Switching mail on does not send a pile of old reminders.
    expect(await dueDeadlines(database, operator, new Date())).toEqual([])
  })

  it('goes to nobody who switched it off as push, and still by mail', async () => {
    await aDeadline()
    await switchedOff('u-lead', 'deadline_due')

    const [raised] = await dueDeadlines(database, operator, new Date(), undefined, 'push')

    expect(await notifyPush(database, operator, raised!, { now: new Date() })).toEqual([])
    expect(
      await notify(database, operator, raised!, { origin: 'https://haustechnik.example.de' }),
    ).toHaveLength(1)
  })
})

describe('a task that falls due', () => {
  it('is told on the morning of its day to the person it is for, and names nothing of it', async () => {
    const task = await aTask('u-tech')

    await aTask('u-tech', '2026-10-14')

    expect(await dueTasks(database, operator, new Date('2026-10-13T03:00:00Z'))).toEqual([])

    const raised = await dueTasks(database, operator, morning)

    expect(raised).toEqual([{ kind: 'task_due', taskId: task, dueOn: today }])

    await notifyPush(database, operator, raised[0]!, { now: morning })

    expect(await pushed()).toEqual([
      {
        user: 'u-tech',
        kind: 'task_due',
        title: 'Heute fällig',
        // The title of a task is whatever somebody typed, a name included.
        body: 'Eine Aufgabe ist heute für Sie fällig.',
        url: '/aufgaben',
        cause: `task_due:${task}:${today}`,
      },
    ])
    // Told, it is not raised again.
    expect(await dueTasks(database, operator, morning)).toEqual([])
  })

  it('is not raised for somebody without a device, for somebody who switched it off, or for a task a deadline made', async () => {
    await admin.query("delete from push_subscriptions where user_id = 'u-site'")
    await switchedOff('u-tech-south', 'task_due')
    await aTask('u-site')
    await aTask('u-tech-south')
    await aDeadline({ task: await aTask('u-lead') })

    // The reading of the meters reminded when its lead began, for the same thing.
    expect(await dueTasks(database, operator, morning)).toEqual([])
  })

  it('is told to nobody once it is done, or once its person no longer works here', async () => {
    const done = await aTask('u-tech')
    const left = await aTask('u-site')
    const raised = await dueTasks(database, operator, morning)

    await admin.query("update tasks set status = 'done' where id = $1", [done])
    await admin.query("update memberships set blocked_at = now() where user_id = 'u-site'")

    expect(raised.map((each) => each.taskId).sort()).toEqual([done, left].sort())

    for (const each of raised) {
      expect(await notifyPush(database, operator, each, { now: morning })).toEqual([])
    }
  })
})

describe('a round that waits for its countersignature', () => {
  it('is told to everybody who may countersign in its area, and not to whoever signed it', async () => {
    const round = await anActivity({ kind: 'round', countersignature: true })
    const signature = await signedBy(round.id, 'u-tech')
    const raised = await waitingActivities(database, operator, new Date())

    // The Objektleitung of the north and the Leitung, who sees every area.
    expect(raised.map((each) => each.userId).sort()).toEqual(['u-lead', 'u-site'])
    expect(raised.every((each) => each.signatureId === signature)).toBe(true)

    for (const each of raised) {
      await notifyPush(database, operator, each, { now: new Date() })
    }

    expect(await pushed()).toEqual(
      ['u-lead', 'u-site'].map((user) => ({
        user,
        kind: 'waiting',
        title: 'Wartet auf Gegenzeichnung',
        body: 'Ein Rundgang wartet auf Ihre Gegenzeichnung.',
        url: `/rundgaenge/${round.id}`,
        cause: `waiting:${signature}:${user}`,
      })),
    )
    expect(await waitingActivities(database, operator, new Date())).toEqual([])
  })

  it('waits for nobody when it asks for no second signature, was signed long ago or is in another area', async () => {
    const plain = await anActivity({ kind: 'round' })
    const old = await anActivity({ kind: 'round', countersignature: true })
    const inTheSouth = await anActivity({
      kind: 'round',
      countersignature: true,
      property: southern,
      area: south,
    })

    await signedBy(plain.id, 'u-tech')
    await signedBy(old.id, 'u-tech', '2026-01-01T08:00:00Z')
    await signedBy(inTheSouth.id, 'u-tech-south', null, south, southern)

    const raised = await waitingActivities(database, operator, new Date())

    // The round in the south waits for the Objektleitung there and the Leitung, and for nobody of the north.
    expect(raised.map((each) => [each.activityId, each.userId]).sort()).toEqual(
      [
        [inTheSouth.id, 'u-lead'],
        [inTheSouth.id, 'u-site-south'],
      ].sort(),
    )
  })

  it('is told to nobody once somebody has countersigned it', async () => {
    const round = await anActivity({ kind: 'round', countersignature: true })

    await signedBy(round.id, 'u-tech')

    const raised = await waitingActivities(database, operator, new Date())

    await admin.query("update activities set status = 'done' where id = $1", [round.id])

    for (const each of raised) {
      expect(await notifyPush(database, operator, each, { now: new Date() })).toEqual([])
    }
  })
})

describe('a work order that waits for its acceptance', () => {
  it('is told to whoever leads it, and to nobody else', async () => {
    const order = await anActivity({ kind: 'work_order', responsible: 'u-site' })
    const signature = await signedBy(order.id, 'u-tech')
    const raised = await waitingActivities(database, operator, new Date())

    expect(raised).toEqual([
      { kind: 'waiting', activityId: order.id, signatureId: signature, userId: 'u-site' },
    ])

    await notifyPush(database, operator, raised[0]!, { now: new Date() })

    expect(await pushed()).toMatchObject([
      {
        user: 'u-site',
        title: 'Wartet auf Abnahme',
        body: 'Ein Arbeitsauftrag wartet auf Ihre Abnahme.',
        url: `/auftraege/${order.id}`,
      },
    ])
  })

  it('is told to everybody who may accept in its area where whoever leads it signed it themselves', async () => {
    const order = await anActivity({ kind: 'work_order', responsible: 'u-site' })

    await signedBy(order.id, 'u-site')

    expect(
      (await waitingActivities(database, operator, new Date())).map((each) => each.userId),
    ).toEqual(['u-lead'])
  })
})

describe('a work order that was sent back', () => {
  it('is told to whoever signed it, by its kind and nothing else', async () => {
    const order = await anActivity({ kind: 'work_order', responsible: 'u-site' })

    await signedBy(order.id, 'u-tech')

    const decision = await rejectedBy(order.order, order.id, 'u-site')
    const raised = await rejectedOrders(database, operator, new Date())

    expect(raised).toEqual([{ kind: 'work_order_rejected', decisionId: decision }])

    await notifyPush(database, operator, raised[0]!, { now: new Date() })

    expect(await pushed()).toEqual([
      {
        user: 'u-tech',
        kind: 'work_order_rejected',
        title: 'Auftrag zurückgewiesen',
        // The reason somebody typed stays in the application.
        body: 'Ein Arbeitsauftrag, den Sie unterschrieben haben, wurde zurückgewiesen.',
        url: `/auftraege/${order.id}`,
        cause: `work_order_rejected:${decision}`,
      },
    ])
    expect(await rejectedOrders(database, operator, new Date())).toEqual([])
  })

  it('is told to nobody once it is signed again, and not to whoever sent their own order back', async () => {
    const again = await anActivity({ kind: 'work_order' })

    await signedBy(again.id, 'u-tech')
    await rejectedBy(again.order, again.id, 'u-site')

    const own = await anActivity({ kind: 'work_order' })

    await signedBy(own.id, 'u-site')
    await rejectedBy(own.order, own.id, 'u-site')

    const raised = await rejectedOrders(database, operator, new Date())

    await admin.query("update activities set status = 'signed' where id = $1", [again.id])

    for (const each of raised) {
      expect(await notifyPush(database, operator, each, { now: new Date() })).toEqual([])
    }
  })
})

describe('an activity that goes to somebody', () => {
  it('is told to them by its kind and its day, and not to whoever handed it out', async () => {
    const inspection = await anActivity({ performer: 'u-tech', responsible: 'u-site' })

    await tellHandedOut(database, operator, 'u-site', [
      { activityId: inspection.id as never, userId: 'u-tech', dueOn: '2026-10-20' },
      { activityId: inspection.id as never, userId: 'u-site', dueOn: '2026-10-20' },
    ])

    expect(await pushed()).toEqual([
      {
        user: 'u-tech',
        kind: 'assigned',
        title: 'Neu zugeteilt',
        body: 'Ihnen wurde eine Prüfung zugeteilt, fällig am 20.10.2026.',
        url: `/pruefungen/${inspection.id}`,
        cause: `assigned:${inspection.id}:u-tech`,
      },
    ])
  })

  it('is told once where several go to one person at once, about the one that is due first', async () => {
    const later = await anActivity({ kind: 'round', performer: 'u-tech', dueOn: '2026-10-22' })
    const first = await anActivity({ kind: 'round', performer: 'u-tech', dueOn: '2026-10-19' })

    await tellHandedOut(database, operator, 'u-site', [
      { activityId: later.id as never, userId: 'u-tech', dueOn: '2026-10-22' },
      { activityId: first.id as never, userId: 'u-tech', dueOn: '2026-10-19' },
    ])

    expect(await pushed()).toMatchObject([
      {
        user: 'u-tech',
        body: 'Ihnen wurde ein Rundgang zugeteilt, fällig am 19.10.2026.',
        url: `/rundgaenge/${first.id}`,
      },
    ])
  })

  it('is told to nobody the activity no longer names, and to nobody once the work is signed', async () => {
    const moved = await anActivity({ performer: 'u-site' })
    const signed = await anActivity({ performer: 'u-tech', status: 'signed' })

    // One at a time: of several handed to one person at once only the first is asked.
    await tellHandedOut(database, operator, 'u-lead', [
      { activityId: moved.id as never, userId: 'u-tech' },
    ])
    await tellHandedOut(database, operator, 'u-lead', [
      { activityId: signed.id as never, userId: 'u-tech' },
    ])

    expect(await pushed()).toEqual([])
  })

  it('goes to nobody who switched it off, unless it is a work order of the urgency "sofort"', async () => {
    const ordinary = await anActivity({ kind: 'work_order', responsible: 'u-site' })
    const immediate = await anActivity({
      kind: 'work_order',
      responsible: 'u-site',
      urgency: 'immediate',
    })

    await switchedOff('u-site', 'assigned')
    await tellHandedOut(database, operator, 'u-lead', [
      { activityId: ordinary.id as never, userId: 'u-site' },
    ])

    expect(await pushed()).toEqual([])

    await tellHandedOut(
      database,
      operator,
      'u-lead',
      [{ activityId: immediate.id as never, userId: 'u-site' }],
      { activityId: immediate.id as never, userId: 'u-site' },
    )

    // One message, the one nobody switches off, in place of the ordinary one.
    expect(await pushed()).toEqual([
      {
        user: 'u-site',
        kind: 'assigned',
        title: 'Auftrag: sofort',
        body: 'Sie führen einen Arbeitsauftrag der Dringlichkeit „sofort“.',
        url: `/auftraege/${immediate.id}`,
        cause: `immediate:${immediate.id}:u-site`,
      },
    ])
  })

  it('says "sofort" to nobody who does not lead the order, or whose order is not that urgent', async () => {
    const urgent = await anActivity({
      kind: 'work_order',
      responsible: 'u-site',
      urgency: 'urgent',
    })
    const others = await anActivity({
      kind: 'work_order',
      responsible: 'u-lead',
      urgency: 'immediate',
    })

    await tellHandedOut(database, operator, 'u-tech', [], {
      activityId: urgent.id as never,
      userId: 'u-site',
    })
    await tellHandedOut(database, operator, 'u-tech', [], {
      activityId: others.id as never,
      userId: 'u-site',
    })

    expect(await pushed()).toEqual([])
  })
})

describe('what is told here', () => {
  it('reaches no device next door', async () => {
    const round = await anActivity({ kind: 'round', countersignature: true })

    await signedBy(round.id, 'u-tech')
    await aDeadline()
    await aTask('u-tech')

    for (const raise of [waitingActivities, rejectedOrders, dueTasks] as const) {
      for (const each of await raise(database, operator, morning)) {
        await notifyPush(database, operator, each, { now: new Date() })
      }

      expect(await raise(database, neighbour, morning)).toEqual([])
    }

    expect(await dueDeadlines(database, neighbour, new Date(), undefined, 'push')).toEqual([])
    expect((await pushed()).map((each) => each.user)).not.toContain('u-next')
  })
})
