import { applicationRole } from '@opengewerk/platform-server'
import { type SQL, sql } from 'drizzle-orm'
import { pgPolicy, type PgColumn } from 'drizzle-orm/pg-core'

// The policy of the limits of an access from outside (#339, `limits.ts`), in
// a file of its own: the tables it stands on import it, and it imports none
// of them, it names `assets` and `activities` by their names.

// The two functions are called inside a sub-select, as in `within_areas`: so
// they run once per statement and not once per row. Null is no limit.
const limitProperties = sql.raw('(SELECT session_limit_properties())')
const limitKinds = sql.raw('(SELECT session_limit_asset_kinds())')

/** A kind of asset that is one of the limit, for the row of an asset itself. */
export function kindOfItself(kind: PgColumn): SQL {
  return sql`(${limitKinds} IS NULL OR ${kind} = ANY (${limitKinds}::text[]))`
}

/** The kind of the asset a row hangs on; a row on no asset is outside a limit to kinds. */
export function kindOfItsAsset(asset: PgColumn): SQL {
  return sql`(${limitKinds} IS NULL OR (${asset} IS NOT NULL AND EXISTS (SELECT 1 FROM public.assets a WHERE a.id = ${asset} AND a.kind = ANY (${limitKinds}::text[]))))`
}

/** The activity a row is a part of, which is itself limited: what is outside it is outside. */
export function kindOfItsActivity(activity: PgColumn): SQL {
  return sql`(${limitKinds} IS NULL OR EXISTS (SELECT 1 FROM public.activities a WHERE a.id = ${activity}))`
}

/** The duty a row is about, which is itself limited: the evidence of a duty outside it is outside. */
export function kindOfItsDuty(duty: PgColumn): SQL {
  return sql`(${limitKinds} IS NULL OR EXISTS (SELECT 1 FROM public.duties d WHERE d.id = ${duty}))`
}

/** The evidence a row is about, which is itself limited. */
export function kindOfItsEvidence(evidence: PgColumn): SQL {
  return sql`(${limitKinds} IS NULL OR EXISTS (SELECT 1 FROM public.evidence e WHERE e.id = ${evidence}))`
}

/**
 * A document: at an asset of the kinds, or a part of an activity that is
 * within the limit, the report of a contractor for one.
 */
export function kindOfItsAssetOrActivity(asset: PgColumn, activity: PgColumn): SQL {
  return sql`(${limitKinds} IS NULL OR (${asset} IS NOT NULL AND EXISTS (SELECT 1 FROM public.assets a WHERE a.id = ${asset} AND a.kind = ANY (${limitKinds}::text[]))) OR (${activity} IS NOT NULL AND EXISTS (SELECT 1 FROM public.activities a WHERE a.id = ${activity})))`
}

/**
 * The policy beside `within_areas` on the tables an auditor reads (#339):
 * restrictive, so no other policy widens it, for reading and writing alike.
 * The property of the row is one of the limit, and so is its kind, as the
 * table says it.
 */
export function withinLimits(property: PgColumn, kind?: SQL) {
  const inProperties = sql`(${limitProperties} IS NULL OR ${property} = ANY (${limitProperties}::uuid[]))`
  const inReach = kind === undefined ? inProperties : sql`${inProperties} AND ${kind}`

  return pgPolicy('within_limits', {
    as: 'restrictive',
    for: 'all',
    to: applicationRole,
    using: inReach,
    withCheck: inReach,
  })
}
