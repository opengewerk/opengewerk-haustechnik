import {
  auditLanguage,
  auditVocabulary,
  type SubjectAccessMatch,
  type SubjectAccessPart,
  type SubjectAccessPartKey,
  subjectAccessParts,
  subjectAccessSearchParts,
  type SubjectAccessValue,
  type TenantId,
} from '@opengewerk/haustechnik-domain'
import type { Database, TenantTransaction } from '@opengewerk/platform-server'
import { sql, type SQL } from 'drizzle-orm'

import type { Asking } from '../api/places.js'

/**
 * The rows of the information about a person (#355): one query per part,
 * read in the transaction of the operator for whoever asks, who sees every
 * area, and the tables of the accounts outside it, where they live. A query
 * selects only what the part shows, and never a column that names another
 * person: no identifier, name or address of another account leaves here.
 */

type Row = Record<string, SubjectAccessValue>

const language = auditLanguage(auditVocabulary)

/** A moment as ISO 8601, a day as it is; whatever else the driver hands back, as it is. */
function plain(value: unknown): SubjectAccessValue {
  if (value instanceof Date) {
    return value.toISOString()
  }

  if (value === null || value === undefined) {
    return null
  }

  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? value
    : String(value)
}

async function rowsOf(tx: { execute: TenantTransaction['execute'] }, query: SQL): Promise<Row[]> {
  const result = await tx.execute<Record<string, unknown>>(query)

  return result.rows.map((row) =>
    Object.fromEntries(Object.entries(row).map(([key, value]) => [key, plain(value)])),
  )
}

/** The name of a property, by its key; null for a row without one. */
const propertyOf = (column: SQL) => sql`(select p.name from properties p where p.id = ${column})`

/** The number of the work order of an activity. */
const orderOf = (column: SQL) =>
  sql`(select w.number from work_orders w where w.activity_id = ${column} limit 1)`

/** A part with its rows, as the file holds it. */
function part(key: SubjectAccessPartKey, rows: readonly Row[]): SubjectAccessPart {
  const definition =
    key in subjectAccessParts
      ? subjectAccessParts[key as keyof typeof subjectAccessParts]
      : subjectAccessSearchParts[key as keyof typeof subjectAccessSearchParts]

  return {
    key,
    title: definition.title,
    note: definition.note,
    columns: definition.columns,
    rows,
  }
}

/** What the operator holds about an account of its own, in the transaction of the operator. */
async function tenantRows(tx: TenantTransaction, userId: string) {
  const u = userId

  const membership = await rowsOf(
    tx,
    sql`select
          (select string_agg(coalesce(r.label, k), ', ' order by k)
             from unnest(m.roles) k left join tenant_roles r on r.key = k) as roles,
          m.created_at as since,
          m.last_day::text as "lastDay",
          m.blocked_at as "blockedAt",
          case when exists (select 1 from member_all_areas a where a.user_id = m.user_id) then 'alle'
               else (select string_agg(ar.name, ', ' order by ar.name)
                       from member_areas ma join areas ar on ar.id = ma.area_id where ma.user_id = m.user_id) end as areas,
          nullif(concat_ws(', ',
            (select string_agg(p.name, ', ' order by p.name)
               from member_limit_properties l join properties p on p.id = l.property_id where l.user_id = m.user_id),
            (select string_agg(k.asset_kind, ', ' order by k.asset_kind)
               from member_limit_asset_kinds k where k.user_id = m.user_id)), '') as limits,
          (select max(x.removed_at) from membership_removals x where x.user_id = m.user_id) as "removedAt"
        from memberships m where m.user_id = ${u}`,
  )

  const corrections = await rowsOf(
    tx,
    sql`select created_at as at, name_before as "nameBefore", name_after as "nameAfter",
               email_before as "emailBefore", email_after as "emailAfter"
          from account_corrections where user_id = ${u} order by created_at`,
  )

  const substitutions = await rowsOf(
    tx,
    sql`select 'wird vertreten' as what, starts_on::text as "startsOn", ends_on::text as "endsOn"
          from substitutions where absent_user_id = ${u}
        union all
        select 'vertritt', starts_on::text, ends_on::text from substitutions where substitute_user_id = ${u}
        order by 2`,
  )

  // The passkeys this operator knows of the person (#474), live or removed:
  // those recorded here, and none another operator alone knows.
  const passkeys = await rowsOf(
    tx,
    sql`select passkey_id as "passkeyId", name, created_at as "createdAt", removed_at as "removedAt"
          from member_passkeys where user_id = ${u} order by created_at`,
  )

  const signIns = await rowsOf(
    tx,
    sql`select 'Anmeldung bei diesem Betreiber' as what, started_at as at, ended_at as until, null as device,
               null as address, sign_in_method as method, null::boolean as "secondFactor"
          from tenant_sessions where user_id = ${u} order by started_at`,
  )

  const push = await rowsOf(
    tx,
    sql`select 'Gerät mit Push' as what, label from push_subscriptions where user_id = ${u}
        union all
        select 'Anlass als Push abgeschaltet', occasion::text from push_opt_outs where user_id = ${u}`,
  )

  const duties = await rowsOf(
    tx,
    sql`select d.label as duty, ${propertyOf(sql`d.property_id`)} as place, 'verantwortlich' as what, null::timestamptz as "on"
          from duties d where d.responsible_user_id = ${u}
        union all
        select d.label, ${propertyOf(sql`d.property_id`)}, 'bestätigt', d.confirmed_at
          from duties d where d.confirmed_by = ${u}
        union all
        select x.kind, ${propertyOf(sql`x.property_id`)}, 'Vorschlag verworfen', x.created_at
          from duty_dismissals x where x.dismissed_by = ${u}`,
  )

  const deadlines = await rowsOf(
    tx,
    sql`select f.source_label as deadline, f.due_on::text as "dueOn", w.what, f.status::text as status
          from deadlines f
          cross join lateral (values
            (case when f.responsible_user_id = ${u} then 'verantwortlich' end),
            (case when f.natural_user_id = ${u} then 'verantwortlich nach der Quelle' end),
            (case when f.closed_by = ${u} then 'geschlossen' end),
            (case when f.member_user_id = ${u} then 'betrifft den eigenen Zugang' end)) as w(what)
         where w.what is not null
        union all
        select s.kind::text, null, 'erinnert bei dieser Art von Frist', null
          from deadline_settings s where s.responsible_user_id = ${u}`,
  )

  const tasks = await rowsOf(
    tx,
    sql`select t.title as task, t.due_on::text as "dueOn", w.what, t.status::text as status
          from tasks t
          cross join lateral (values
            (case when t.assignee_user_id = ${u} then 'verantwortlich' end),
            (case when t.created_by = ${u} then 'angelegt' end)) as w(what)
         where w.what is not null`,
  )

  const activities = await rowsOf(
    tx,
    sql`select a.title as activity, ${propertyOf(sql`a.property_id`)} as place,
               coalesce(a.performed_on, a.due_on)::text as "on", w.what
          from activities a
          cross join lateral (values
            (case when a.responsible_user_id = ${u} then 'verantwortlich' end),
            (case when a.performer_user_id = ${u} then 'führt aus' end)) as w(what)
         where w.what is not null
        union all
        select t.title, ${propertyOf(sql`r.property_id`)}, r.starts_on::text, 'geht die Rundgänge dieses Plans'
          from round_plans r join round_templates t on t.id = r.template_id
         where r.performer_user_id = ${u}`,
  )

  const evidenceOf = (alias: string) =>
    sql.raw(
      `${alias}.number, ${alias}.performed_on::text, (select d.label from duties d where d.id = ${alias}.duty_id), (select p.name from properties p where p.id = ${alias}.property_id)`,
    )
  const evidence = await rowsOf(
    tx,
    sql`select e.number, e.performed_on::text as day, (select d.label from duties d where d.id = e.duty_id) as duty,
               ${propertyOf(sql`e.property_id`)} as place, 'ausgeführt' as what, null as drawing
          from evidence e where e.performed_by = ${u}
        union all
        select ${evidenceOf('e')}, 'eingetragen', null from evidence e where e.written_by = ${u}
        union all
        select e.number, coalesce(e.performed_on::text, (s.signed_at at time zone 'Europe/Berlin')::date::text),
               (select d.label from duties d where d.id = e.duty_id), ${propertyOf(sql`s.property_id`)},
               case s.role when 'countersigner' then 'gegengezeichnet' else 'unterschrieben' end,
               s.path
          from activity_signatures s left join evidence e on e.activity_id = s.activity_id
         where s.signed_by = ${u}
        union all
        select ${evidenceOf('e')}, 'für ungültig erklärt', null
          from evidence_voidings v join evidence e on e.id = v.evidence_id where v.voided_by = ${u}
        union all
        select ${evidenceOf('e')}, 'Löschung nach der Aufbewahrung bestätigt', null
          from evidence_emptyings x join evidence e on e.id = x.evidence_id where x.confirmed_by = ${u}
        union all
        select ${evidenceOf('e')}, 'signiertes PDF abgelegt', null
          from evidence_signed_prints x join evidence e on e.id = x.evidence_id where x.filed_by = ${u}`,
  )

  const delegations = await rowsOf(
    tx,
    sql`select 'Pflichten übertragen an die Person' as what, starts_on::text as "startsOn", ends_on::text as "endsOn",
               null::timestamptz as at, null as drawing
          from duty_delegations where delegate_user_id = ${u}
        union all
        select 'unterschrieben', d.starts_on::text, d.ends_on::text, s.signed_at, s.path
          from duty_delegation_signatures s join duty_delegations d on d.id = s.delegation_id where s.signed_by = ${u}
        union all
        select 'widerrufen', d.starts_on::text, d.ends_on::text, r.revoked_at, null
          from duty_delegation_revocations r join duty_delegations d on d.id = r.delegation_id where r.revoked_by = ${u}`,
  )

  const workOrders = await rowsOf(
    tx,
    sql`select ${orderOf(sql`x.activity_id`)} as "order", 'beteiligt' as what, null::timestamptz as at, null as text
          from work_order_participants x where x.user_id = ${u}
        union all
        select w.number, case x.decision::text when 'accepted' then 'abgenommen' else 'zurückgewiesen' end,
               x.decided_at, x.reason
          from work_order_decisions x join work_orders w on w.id = x.work_order_id where x.decided_by = ${u}
        union all
        select ${orderOf(sql`x.activity_id`)}, 'Material entnommen', x.taken_at, null
          from work_order_materials x where x.taken_by = ${u}
        union all
        select ${orderOf(sql`x.activity_id`)}, 'Notiz geschrieben', x.written_at, x.text
          from work_order_notes x where x.written_by = ${u}
        union all
        select ${orderOf(sql`x.activity_id`)}, 'Leistungsnachweis auf dem eigenen Gerät aufgenommen', x.signed_at, null
          from service_reports x where x.signed_by = ${u}
        union all
        select ${orderOf(sql`x.activity_id`)}, 'Einweisung auf dem eigenen Gerät aufgenommen', x.signed_at, null
          from briefings x where x.signed_by = ${u}
        union all
        select ${orderOf(sql`x.activity_id`)}, 'Erlaubnisschein auf dem eigenen Gerät ausgestellt', x.signed_at, null
          from work_permits x where x.signed_by = ${u}`,
  )

  const meters = await rowsOf(
    tx,
    sql`select concat_ws(' ', a.number, a.name) as meter, 'Stand eingetragen' as what, r.read_on::text as "on", null as text
          from meter_readings r join assets a on a.id = r.asset_id where r.recorded_by = ${u}
        union all
        select concat_ws(' ', a.number, a.name), 'Notiz geschrieben', p.noted_on::text, p.note
          from meter_points p join assets a on a.id = p.asset_id where p.note_by = ${u}`,
  )

  const stock = await rowsOf(
    tx,
    sql`select a.designation as article, m.kind::text as what, m.booked_at as at
          from stock_movements m join articles a on a.id = m.article_id where m.booked_by = ${u}`,
  )

  const faults = await rowsOf(
    tx,
    sql`select f.received_at as at, ${propertyOf(sql`f.property_id`)} as place, f.description as text,
               case when f.rejected_at is not null then 'abgelehnt' when f.accepted_at is not null then 'angenommen'
                    else 'neu' end as status
          from fault_reports f where f.reported_by = ${u}`,
  )

  const qualifications = await rowsOf(
    tx,
    sql`select coalesce((select k.label from qualification_kinds k where k.id = q.own_kind_id), q.kind_key) as qualification,
               q.valid_until::text as "validUntil", q.note as text
          from qualifications q where q.user_id = ${u}`,
  )

  const documents = await rowsOf(
    tx,
    sql`select a.title as document, v.file_name as file, v.created_at as at
          from attachment_versions v join attachments a on a.id = v.attachment_id where v.created_by = ${u}`,
  )

  const auditorReads = await rowsOf(
    tx,
    sql`select read_at as at, route from auditor_reads where user_id = ${u} order by read_at`,
  )

  const invitations = await rowsOf(
    tx,
    sql`select 'jemanden eingeladen' as what, created_at as at from invitations where invited_by = ${u}
        union all
        select 'E-Mail angestoßen', created_at from mail_outbox where requested_by = ${u}`,
  )

  const processingDescriptions = await rowsOf(
    tx,
    sql`select created_at as at from processing_descriptions where made_by = ${u} order by created_at`,
  )

  const privacyDocuments = await rowsOf(
    tx,
    sql`select case kind when 'record' then 'Verzeichnis der Verarbeitungstätigkeiten'
                         when 'measures' then 'Technische und organisatorische Maßnahmen'
                         else 'Löschkonzept' end as what,
               created_at as at
          from privacy_documents where made_by = ${u} order by created_at`,
  )

  const changes = await rowsOf(
    tx,
    sql`select changed_at as at, table_name as record, record_id::text as "recordId", field, operation::text as what
          from audit_entries where user_id = ${u}
        union all
        select created_at, 'audit_redactions', entry_id::text, null,
               case side when 'old' then 'Wert davor geschwärzt: ' else 'Wert danach geschwärzt: ' end || reason
          from audit_redactions where redacted_by = ${u}
        order by 1`,
  )
  const operations: Readonly<Record<string, string>> = {
    insert: 'angelegt',
    update: 'geändert',
    delete: 'entfernt',
  }
  const log = changes.map((row): Row => {
    const table = String(row['record'])

    return {
      ...row,
      record: language.tableLabel(table),
      field: row['field'] === null ? null : language.fieldLabel(table, String(row['field'])),
      what: operations[String(row['what'])] ?? row['what'] ?? null,
    }
  })

  const byRecord = new Map<string, { count: number; first: string; last: string }>()

  for (const row of log) {
    const record = String(row['record'])
    const at = String(row['at'])
    const seen = byRecord.get(record)

    byRecord.set(
      record,
      seen === undefined
        ? { count: 1, first: at, last: at }
        : {
            count: seen.count + 1,
            first: seen.first < at ? seen.first : at,
            last: seen.last > at ? seen.last : at,
          },
    )
  }

  // Every table with the stamp of the sync says who changed a row last.
  const stamped = await rowsOf(
    tx,
    sql`select table_name as name from information_schema.columns
         where table_schema = 'public' and column_name = 'updated_by' order by table_name`,
  )
  const lastChanges: Row[] = []

  for (const { name } of stamped) {
    const table = String(name)
    const [counted] = await rowsOf(
      tx,
      sql`select count(*)::int as count from ${sql.identifier(table)} where updated_by = ${u}`,
    )

    if (counted !== undefined && Number(counted['count']) > 0) {
      lastChanges.push({ record: language.tableLabel(table), count: counted['count'] ?? 0 })
    }
  }

  return {
    membership,
    corrections,
    passkeys,
    substitutions,
    signIns,
    push,
    duties,
    deadlines,
    tasks,
    activities,
    evidence,
    delegations,
    workOrders,
    meters,
    stock,
    faults,
    qualifications,
    documents,
    auditorReads,
    invitations,
    processingDescriptions,
    privacyDocuments,
    log,
    logSummary: [...byRecord].map(([record, seen]) => ({ record, ...seen })),
    lastChanges,
  }
}

/**
 * What the instance holds about the account: its sign-in, its passkeys, its
 * sessions here with whether each carries a second factor (#482), and its
 * part in running the instance. Of the passkeys the
 * part names only those the operator knows (`passkeysHere`).
 */
async function instanceRows(
  database: Database,
  tenantId: TenantId,
  userId: string,
  asUser: string,
) {
  return database.forInstance(async (tx) => {
    const account = await rowsOf(
      tx,
      sql`select u.name, u.email,
                 exists (select 1 from auth_accounts a where a.user_id = u.id and a.password is not null) as password,
                 (coalesce(u.two_factor_enabled, false)
                   or exists (select 1 from auth_two_factors t where t.user_id = u.id)) as "secondFactor"
            from auth_users u where u.id = ${userId}`,
    )
    const passkeys = await rowsOf(
      tx,
      sql`select k.id, k.created_at as "createdAt", k.last_used_at as "lastUsedAt"
            from auth_passkeys k where k.user_id = ${userId} order by k.created_at`,
    )
    const sessions = await rowsOf(
      tx,
      sql`select 'Sitzung' as what, created_at as at, expires_at as until, user_agent as device,
                 ip_address as address, sign_in_method as method, second_factor as "secondFactor"
            from auth_sessions where user_id = ${userId} and active_tenant_id = ${tenantId} order by created_at`,
    )
    const instance = await rowsOf(
      tx,
      sql`select 'verwaltet die Instanz' as what, null::timestamptz as at, null as record, null as field
            from instance_operators where user_id = ${userId}
          union all
          select 'Änderung an der Instanz', changed_at, table_name, field
            from instance_changes where user_id = ${userId}
          order by 2 nulls first`,
    )

    return { account, passkeys, sessions, instance }
  }, asUser)
}

/**
 * The passkeys of the account as far as this operator knows them (#474): each
 * it has on record, with when it was made and last used while the key is
 * there, and whether it still holds here. A passkey only another operator
 * knows is not named, nor when it was used there.
 */
function passkeysHere(known: readonly Row[], keys: readonly Row[]): Row[] {
  return known.map((record) => {
    const key = keys.find((each) => each['id'] === record['passkeyId'])

    return {
      name: record['name'] ?? null,
      createdAt: key?.['createdAt'] ?? record['createdAt'] ?? null,
      lastUsedAt: key?.['lastUsedAt'] ?? null,
      here: record['removedAt'] === null && key !== undefined,
    }
  })
}

/** The information about an account of this operator, every part in the order of the file. */
export async function accountParts(
  database: Database,
  identity: Asking,
  userId: string,
): Promise<SubjectAccessPart[]> {
  const here = await database.forTenant(identity, (tx) => tenantRows(tx, userId))
  const there = await instanceRows(database, identity.tenantId, userId, identity.userId)

  return [
    part('account', there.account),
    part('passkeys', passkeysHere(here.passkeys, there.passkeys)),
    part('corrections', here.corrections),
    part('membership', here.membership),
    part('substitutions', here.substitutions),
    part('sessions', [...there.sessions, ...here.signIns]),
    part('push', here.push),
    part('duties', here.duties),
    part('deadlines', here.deadlines),
    part('tasks', here.tasks),
    part('activities', here.activities),
    part('evidence', here.evidence),
    part('delegations', here.delegations),
    part('workOrders', here.workOrders),
    part('meters', here.meters),
    part('stock', here.stock),
    part('faults', here.faults),
    part('qualifications', here.qualifications),
    part('documents', here.documents),
    part('auditorReads', here.auditorReads),
    part('invitations', here.invitations),
    part('instance', there.instance),
    part('processingDescriptions', here.processingDescriptions),
    part('privacyDocuments', here.privacyDocuments),
    part('log', here.log),
    part('logSummary', here.logSummary),
    part('lastChanges', here.lastChanges),
  ]
}

/** A search as a pattern: what it says, anywhere, whatever the case, with its own `%` and `_` taken as they are. */
function patternOf(term: string): string {
  return `%${term.trim().replace(/[\\%_]/g, (mark) => `\\${mark}`)}%`
}

/** What a search for a name or an address finds about a person without an access, a part each. */
export async function searchParts(
  tx: TenantTransaction,
  term: string,
): Promise<SubjectAccessPart[]> {
  const like = patternOf(term)

  const contacts = await rowsOf(
    tx,
    sql`select concat_ws(' ', c.given_name, c.family_name) as name, c.role, c.email, c.phone, c.mobile,
               coalesce('Liegenschaft ' || (select p.name from properties p where p.id = c.property_id),
                        'Fremdfirma ' || (select f.name from contractors f where f.id = c.contractor_id)) as "where"
          from contacts c
         where concat_ws(' ', c.given_name, c.family_name) ilike ${like} or c.email ilike ${like}`,
  )
  const clients = await rowsOf(
    tx,
    sql`select x.client_name as name, ${orderOf(sql`x.activity_id`)} as "order", x.signed_at as at, x.path as drawing
          from service_reports x where x.client_name ilike ${like}`,
  )
  const briefings = await rowsOf(
    tx,
    sql`select x.person_name as name, x.subject, ${orderOf(sql`x.activity_id`)} as "order", x.signed_at as at,
               x.path as drawing
          from briefings x where x.person_name ilike ${like}`,
  )
  const permits = await rowsOf(
    tx,
    sql`select ${orderOf(sql`x.activity_id`)} as "order", x.signed_at as at, found.text
          from work_permits x
          cross join lateral (select string_agg(v.value, ', ') as text
                                from jsonb_each_text(x.answers) as v(key, value) where v.value ilike ${like}) as found
         where found.text is not null`,
  )
  const faultAddresses = await rowsOf(
    tx,
    sql`select c.address as email, f.received_at as at, f.description as text
          from fault_report_contacts c join fault_reports f on f.id = c.fault_report_id
         where c.address ilike ${like}`,
  )
  const examiners = await rowsOf(
    tx,
    sql`select e.examiner as name, e.examiner_organisation as organisation, e.number, e.performed_on::text as day
          from evidence e where e.examiner ilike ${like}`,
  )

  return [
    part('contacts', contacts),
    part('clients', clients),
    part('briefings', briefings),
    part('permits', permits),
    part('faultAddresses', faultAddresses),
    part('examiners', examiners),
  ]
}

/** What the screen lists for a search before the file is made: where each hit is, and its name or address. */
export function matchesOf(parts: readonly SubjectAccessPart[]): SubjectAccessMatch[] {
  const text = (value: SubjectAccessValue | undefined) =>
    typeof value === 'string' && value !== '' ? value : null

  return parts.flatMap((found) =>
    found.rows.map((row): SubjectAccessMatch => ({
      part: found.key as SubjectAccessMatch['part'],
      where: [found.title, text(row['where']) ?? text(row['order']) ?? text(row['number'])]
        .filter((each): each is string => each !== null)
        .join(', '),
      name: text(row['name']),
      email: text(row['email']),
    })),
  )
}
