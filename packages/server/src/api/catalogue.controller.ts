import { Controller, Get, Inject } from '@nestjs/common'
import type { Catalogue, CatalogueBundle } from '@opengewerk/haustechnik-domain'

import { CATALOGUE } from '../catalogue.js'
import { RequiresPermission } from './authorization.js'

/**
 * The catalogue of this server, for the devices that work with it (section 5
 * of the concept, ADR 0005 with its addendum on #90).
 *
 * A device computes with the entries its server computes with: it fetches the
 * catalogue here, keeps it, and asks for the checksum to learn whether the
 * server has another one since. The catalogue is built into the server, from
 * the packages under pakete/, and nothing a tenant wrote is in it; the same
 * answer goes to everybody.
 *
 * The right is the one of syncing and not the one of reading duties: an asset
 * is recorded with the fields of its kind and a protocol is filled in with
 * its form, by people a tenant may not let read the register of duties.
 * Everybody who works on a device has it.
 */
@Controller('catalogue')
export class CatalogueController {
  constructor(@Inject(CATALOGUE) private readonly catalogue: Catalogue) {}

  /** The whole of it: every version of every entry, each with its review. */
  @Get()
  @RequiresPermission('sync.read')
  whole(): CatalogueBundle {
    return this.catalogue.bundle
  }

  /** The checksum alone, so that a device that holds the same one fetches nothing. */
  @Get('checksum')
  @RequiresPermission('sync.read')
  checksum(): { readonly sha256: string } {
    return { sha256: this.catalogue.sha256 }
  }
}
