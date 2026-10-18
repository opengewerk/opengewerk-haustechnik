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
import { asc, isNull } from 'drizzle-orm'

import { ownAssetFields, ownAssetKinds } from '../database/schema/index.js'
import { dayInGermany } from '../today.js'

/**
 * The catalogue of one operator (#62): the one this build ships, with the
 * asset kinds and fields the operator keeps of its own. Whatever asks about
 * an asset kind of an operator asks this, inside the transaction of the
 * tenant: a route that takes an asset in, the sync, an import, a list that
 * names a kind. What asks about duty kinds, forms and rules asks the
 * catalogue of the build, which the operator adds nothing to.
 */

/** The own kinds and fields an operator keeps, without those it removed. */
export async function ownOf(
  tx: TenantTransaction,
): Promise<{ readonly kinds: OwnAssetKind[]; readonly fields: OwnAssetField[] }> {
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
