import { Controller, Get, Inject } from '@nestjs/common'
import {
  type Catalogue,
  type CatalogueBundle,
  isAllowed,
  isLimited,
} from '@opengewerk/haustechnik-domain'
import { CurrentIdentity, Database, type TenantTransaction } from '@opengewerk/platform-server'

import { CATALOGUE } from '../catalogue.js'
import { catalogueOfThePerson } from '../own-kinds/catalogue.js'
import { RequiresPermission } from './authorization.js'
import type { Asking } from './places.js'

/**
 * The catalogue of this server, for the devices that work with it (section 5
 * of the concept, ADR 0005 with its addendum on #90).
 *
 * A device computes with the entries its server computes with: it fetches the
 * catalogue here, keeps it, and asks for the checksum to learn whether the
 * server has another one since. The catalogue is built into the server, from
 * the packages under pakete/, and the one thing a tenant writes into it are
 * the asset kinds and fields of its own (#62): beside the packages, under a
 * checksum over both. A tenant that added nothing gets the catalogue of the
 * build with its checksum.
 *
 * The right is the one of syncing and not the one of reading duties: an asset
 * is recorded with the fields of its kind and a protocol is filled in with
 * its form, by people a tenant may not let read the register of duties.
 * Everybody who works on a device has it. What the operator added goes only
 * to whoever sees its assets (`catalogueOfThePerson`): a Melder gets the
 * catalogue of the build and nothing of the operator, also not on the device
 * (section 7), and an auditor from outside the kinds of its assets.
 */
@Controller('catalogue')
export class CatalogueController {
  constructor(
    private readonly database: Database,
    @Inject(CATALOGUE) private readonly catalogue: Catalogue,
  ) {}

  /** The whole of it: every version of every entry, each with its review. */
  @Get()
  @RequiresPermission('sync.read')
  whole(@CurrentIdentity() identity: Asking): Promise<CatalogueBundle> {
    return this.database.forTenant(
      identity,
      async (tx) => (await this.ofThePerson(tx, identity)).bundle,
    )
  }

  /** The checksum alone, so that a device that holds the same one fetches nothing. */
  @Get('checksum')
  @RequiresPermission('sync.read')
  checksum(@CurrentIdentity() identity: Asking): Promise<{ readonly sha256: string }> {
    return this.database.forTenant(identity, async (tx) => ({
      sha256: (await this.ofThePerson(tx, identity)).sha256,
    }))
  }

  private ofThePerson(tx: TenantTransaction, identity: Asking): Promise<Catalogue> {
    return catalogueOfThePerson(tx, this.catalogue, {
      seesAssets: isAllowed(identity, 'asset.read'),
      onlyWhatDutiesHangOn: isLimited(identity.roles),
    })
  }
}
