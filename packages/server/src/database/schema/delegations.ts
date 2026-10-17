import {
  delegationLimits,
  delegationRoles,
  delegationScopes,
  longestSignaturePath,
  longestSignerName,
} from '@opengewerk/haustechnik-domain'
import { primaryId, reference, tenantIsolation, timestamps } from '@opengewerk/platform-server'
import { memberships, tenantColumn } from '@opengewerk/platform-server/schema'
import { sql } from 'drizzle-orm'
import {
  check,
  date,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core'

import { areas } from './areas.js'
import { optionalTrimmed, trimmed } from './locations.js'

/** What a delegation covers in its areas, from the list in `domain`. */
export const delegationScope = pgEnum('delegation_scope', delegationScopes)

/** Who signs a delegation, from the list in `domain`. */
export const delegationRole = pgEnum('delegation_role', delegationRoles)

/**
 * The delegations of the operator's duties (#336, section 4.3 of the
 * concept): the person, the scope, tasks and powers, start and end. The
 * areas stand in rows of their own. Tenant-wide like a contract: the policy
 * `tenant_isolation` alone, and the routes ask for the right to delegate, or
 * that the person asking is the one it goes to. Nothing travels to a device.
 *
 * A delegation is written and changed only while nobody has signed it; a
 * trigger refuses every change and its removal from the first signature on,
 * for every role. What happens after that is a row of its own: a signature
 * or a revocation.
 */
export const dutyDelegations = pgTable(
  'duty_delegations',
  {
    id: primaryId<'duty-delegation'>(),
    ...tenantColumn,
    delegateUserId: text('delegate_user_id').notNull(),
    /** The name of the person as the delegation was written, which the signed text and its copy keep. */
    delegateName: text('delegate_name').notNull(),
    scope: delegationScope('scope').notNull(),
    packages: text('packages')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    costGroups: text('cost_groups')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    tasks: text('tasks').notNull(),
    powers: text('powers').notNull(),
    startsOn: date('starts_on', { mode: 'string' }).notNull(),
    endsOn: date('ends_on', { mode: 'string' }).notNull(),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    unique('duty_delegations_tenant_id_key').on(table.tenantId, table.id),
    // What a duty points at, so that the person who answers for it is the one of its delegation.
    unique('duty_delegations_of_their_person').on(table.tenantId, table.id, table.delegateUserId),
    foreignKey({
      columns: [table.tenantId, table.delegateUserId],
      foreignColumns: [memberships.tenantId, memberships.userId],
      name: 'duty_delegations_to_somebody_here',
    }),
    index('duty_delegations_delegate_idx').on(table.tenantId, table.delegateUserId),
    check('duty_delegations_delegate_name_shaped', trimmed(table.delegateName, longestSignerName)),
    check('duty_delegations_tasks_shaped', trimmed(table.tasks, delegationLimits.tasks)),
    check('duty_delegations_powers_shaped', trimmed(table.powers, delegationLimits.powers)),
    check('duty_delegations_in_order', sql`${table.startsOn} <= ${table.endsOn}`),
    // The scope names what it says it names, and nothing else (`delegationProblems` in `domain`).
    check(
      'duty_delegations_scope_shaped',
      sql`(${table.scope} = 'packages') = (cardinality(${table.packages}) > 0)
        and (${table.scope} = 'cost_groups') = (cardinality(${table.costGroups}) > 0)
        and cardinality(${table.packages}) <= ${sql.raw(String(delegationLimits.packages))}
        and cardinality(${table.costGroups}) <= ${sql.raw(String(delegationLimits.costGroups))}
        and array_to_string(${table.packages}, ',') ~ '^([a-z][a-z0-9_-]{0,63}(,[a-z][a-z0-9_-]{0,63})*)?$'
        and array_to_string(${table.costGroups}, ',') ~ '^([1-9][0-9]{2}(,[1-9][0-9]{2})*)?$'`,
    ),
  ],
)

/** The areas a delegation names, one row each. */
export const dutyDelegationAreas = pgTable(
  'duty_delegation_areas',
  {
    id: primaryId<'duty-delegation-area'>(),
    ...tenantColumn,
    delegationId: reference<'duty-delegation'>('delegation_id').notNull(),
    areaId: reference<'area'>('area_id').notNull(),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    unique('duty_delegation_areas_once').on(table.tenantId, table.delegationId, table.areaId),
    foreignKey({
      columns: [table.tenantId, table.delegationId],
      foreignColumns: [dutyDelegations.tenantId, dutyDelegations.id],
      name: 'duty_delegation_areas_of_a_delegation',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.tenantId, table.areaId],
      foreignColumns: [areas.tenantId, areas.id],
      name: 'duty_delegation_areas_of_an_area_here',
    }),
  ],
)

/**
 * A signature under a delegation (section 2.6 of the concept): the Leitung
 * for the operator, the person it goes to for themself, each at a moment of
 * the server's and for the fingerprint of the page that was shown. Written
 * once, as every signature.
 */
export const dutyDelegationSignatures = pgTable(
  'duty_delegation_signatures',
  {
    id: primaryId<'duty-delegation-signature'>(),
    ...tenantColumn,
    delegationId: reference<'duty-delegation'>('delegation_id').notNull(),
    role: delegationRole('role').notNull(),
    signedBy: text('signed_by').notNull(),
    signedAt: timestamp('signed_at', { withTimezone: true }).notNull(),
    /** The drawing; none where the person confirmed with their typed name. */
    path: text('path'),
    typedName: text('typed_name'),
    pageFingerprint: text('page_fingerprint').notNull(),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    // Once for the operator and once by the person.
    unique('duty_delegation_signatures_once').on(table.tenantId, table.delegationId, table.role),
    foreignKey({
      columns: [table.tenantId, table.delegationId],
      foreignColumns: [dutyDelegations.tenantId, dutyDelegations.id],
      name: 'duty_delegation_signatures_under_a_delegation',
    }),
    foreignKey({
      columns: [table.tenantId, table.signedBy],
      foreignColumns: [memberships.tenantId, memberships.userId],
      name: 'duty_delegation_signatures_by_somebody_here',
    }),
    check(
      'duty_delegation_signatures_path_shaped',
      sql`${table.path} ~ '^(M[0-9]{1,4},[0-9]{1,4}(L[0-9]{1,4},[0-9]{1,4})*)+$'
        and char_length(${table.path}) <= ${sql.raw(String(longestSignaturePath))}`,
    ),
    check(
      'duty_delegation_signatures_one_way',
      sql`num_nonnulls(${table.path}, ${table.typedName}) = 1`,
    ),
    check(
      'duty_delegation_signatures_typed_name_shaped',
      optionalTrimmed(table.typedName, longestSignerName),
    ),
    check(
      'duty_delegation_signatures_page_fingerprint_shaped',
      sql`${table.pageFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
)

/** A revocation of a delegation: the day it ends on now, the reason, who and when. Written once. */
export const dutyDelegationRevocations = pgTable(
  'duty_delegation_revocations',
  {
    id: primaryId<'duty-delegation-revocation'>(),
    ...tenantColumn,
    delegationId: reference<'duty-delegation'>('delegation_id').notNull(),
    effectiveOn: date('effective_on', { mode: 'string' }).notNull(),
    reason: text('reason').notNull(),
    revokedBy: text('revoked_by').notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    unique('duty_delegation_revocations_once').on(table.tenantId, table.delegationId),
    foreignKey({
      columns: [table.tenantId, table.delegationId],
      foreignColumns: [dutyDelegations.tenantId, dutyDelegations.id],
      name: 'duty_delegation_revocations_of_a_delegation',
    }),
    foreignKey({
      columns: [table.tenantId, table.revokedBy],
      foreignColumns: [memberships.tenantId, memberships.userId],
      name: 'duty_delegation_revocations_by_somebody_here',
    }),
    check(
      'duty_delegation_revocations_reason_shaped',
      trimmed(table.reason, delegationLimits.reason),
    ),
  ],
)
