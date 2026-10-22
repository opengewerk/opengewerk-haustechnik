import { createHash } from 'node:crypto'

import {
  type Catalogue,
  type OwnAssetField,
  type OwnAssetKind,
  ownCatalogueOf,
  ownIsEmpty,
  withOwn,
} from '@opengewerk/haustechnik-domain'
import type { TenantTransaction } from '@opengewerk/platform-server'
import { asc, isNull, sql } from 'drizzle-orm'

import { assets, ownAssetFields, ownAssetKinds } from '../database/schema/index.js'
import { dayInGermany } from '../today.js'

/**
 * The catalogue of one operator (#62): the one this build ships, with the
 * asset kinds and fields the operator keeps of its own. Whatever asks about
 * an asset kind of an operator asks this, inside the transaction of the
 * tenant: a route that takes an asset in, the sync, an import, a list that
 * names a kind. What asks about duty kinds, forms and rules asks the
 * catalogue of the build, which the operator adds nothing to.
 */

/**
 * The lock of the own kinds of an operator (#529), held until the transaction
 * ends. Whoever reads them shares it, and a change that first counts what
 * assets hold (the sort of a field, a choice, a field or a kind removed) takes
 * it alone. An asset written against a field is then either counted by that
 * change, or written against the field as changed: without it, a change
 * counted nothing while an asset in another transaction took a value of the
 * sort it was leaving.
 */
const ownKindsLock = sql`hashtext('opengewerk.own_asset_kinds'), hashtext(current_setting('app.tenant_id', true))`

/** Waits for a change of the own kinds under way, and holds the next one back. */
export async function readingOwnKinds(tx: TenantTransaction): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock_shared(${ownKindsLock})`)
}

/** Waits for every transaction that read the own kinds, and holds each next one back. */
export async function changingOwnKinds(tx: TenantTransaction): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${ownKindsLock})`)
}

/** The own kinds and fields an operator keeps, without those it removed. */
export async function ownOf(
  tx: TenantTransaction,
): Promise<{ readonly kinds: OwnAssetKind[]; readonly fields: OwnAssetField[] }> {
  await readingOwnKinds(tx)

  const kinds = await tx
    .select()
    .from(ownAssetKinds)
    .where(isNull(ownAssetKinds.deletedAt))
    .orderBy(asc(ownAssetKinds.key))
  const fields = await tx
    .select()
    .from(ownAssetFields)
    .where(isNull(ownAssetFields.deletedAt))
    .orderBy(asc(ownAssetFields.assetKind), asc(ownAssetFields.position), asc(ownAssetFields.key))

  return {
    kinds: kinds.map((row) => ({
      id: String(row.id),
      key: row.key,
      label: row.label,
      costGroup: row.costGroup,
      expectedDocuments: row.expectedDocuments,
      version: row.revision,
      changedOn: dayInGermany(row.updatedAt),
    })),
    fields: fields.map((row) => ({
      id: String(row.id),
      assetKind: row.assetKind,
      key: row.key,
      label: row.label,
      sort: row.sort,
      unit: row.unit,
      options: row.options,
      position: row.position,
    })),
  }
}

/**
 * The catalogue of the build with what an operator added, under a checksum
 * over both, so that a device fetches it again when the operator changes a
 * kind or a field. An operator that added nothing gets the catalogue of the
 * build as it is, with its checksum.
 */
export function catalogueWithOwn(
  base: Catalogue,
  kinds: readonly OwnAssetKind[],
  fields: readonly OwnAssetField[],
): Catalogue {
  const own = ownCatalogueOf(kinds, fields)

  if (ownIsEmpty(own)) {
    return base
  }

  const sha256 = createHash('sha256')
    .update(base.sha256)
    .update('\n')
    .update(JSON.stringify(own))
    .digest('hex')

  return withOwn(base, own, sha256)
}

/**
 * The catalogue of the operator of the transaction. One that holds what an
 * operator added already is that catalogue, so that a function asked with it
 * can ask again without adding it twice.
 */
export async function tenantCatalogue(tx: TenantTransaction, base: Catalogue): Promise<Catalogue> {
  if (base.bundle.own !== undefined) {
    return base
  }

  const { kinds, fields } = await ownOf(tx)

  return catalogueWithOwn(base, kinds, fields)
}

/**
 * The catalogue as it goes to the device of one person (section 7 of the
 * concept): the kinds and fields an operator keeps of its own describe its
 * assets, so only whoever sees the assets gets them. An auditor from outside
 * (#339) gets those of the kinds its assets carry, which the database keeps
 * to the limits of the access; whoever sees no asset, a Melder (#331) for
 * one, gets the catalogue of the build and nothing of the operator.
 */
export async function catalogueOfThePerson(
  tx: TenantTransaction,
  base: Catalogue,
  person: { readonly seesAssets: boolean; readonly onlyWhatDutiesHangOn: boolean },
): Promise<Catalogue> {
  if (person.onlyWhatDutiesHangOn) {
    const { kinds, fields } = await ownOf(tx)
    const carried = new Set(
      (await tx.selectDistinct({ kind: assets.kind }).from(assets)).map((row) => row.kind),
    )

    return catalogueWithOwn(
      base,
      kinds.filter((kind) => carried.has(kind.key)),
      fields.filter((field) => carried.has(field.assetKind)),
    )
  }

  return person.seesAssets ? tenantCatalogue(tx, base) : base
}
