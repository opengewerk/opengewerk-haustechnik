import { BadRequestException, ConflictException } from '@nestjs/common'
import type { AssetId } from '@opengewerk/haustechnik-domain'
import type { TenantTransaction } from '@opengewerk/platform-server'
import { eq } from 'drizzle-orm'

import { assets } from '../database/schema/index.js'

/**
 * The work of a batch at one of its assets. A refusal names the asset, so
 * that whoever sent many knows which one it was; the transaction is left as
 * it is, and nothing of the batch is written.
 */
export async function atTheAsset<Result>(
  tx: TenantTransaction,
  assetId: string,
  work: () => Promise<Result>,
): Promise<Result> {
  try {
    return await work()
  } catch (error) {
    if (!(error instanceof BadRequestException || error instanceof ConflictException)) {
      throw error
    }

    const [asset] = await tx
      .select({ number: assets.number, name: assets.name })
      .from(assets)
      .where(eq(assets.id, assetId as AssetId))
    const named = asset ? [asset.number, asset.name].filter(Boolean).join(' ') : 'Eine Anlage'

    throw error instanceof ConflictException
      ? new ConflictException(`${named}: ${error.message}`)
      : new BadRequestException(`${named}: ${error.message}`)
  }
}
