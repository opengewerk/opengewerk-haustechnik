import { secretPurposes } from '@opengewerk/haustechnik-domain'
import { secretsSchema } from '@opengewerk/platform-server'

/**
 * What a tenant hands the instance to keep sealed: one row per tenant and
 * purpose, or per record for a purpose with one secret per record.
 *
 * The table is the foundation's (`secretsSchema`), and so is the one place it
 * is read and written, the store. What this application says is which
 * purposes there are, and that list lives in `domain`.
 */
export const { secretPurpose, secrets } = secretsSchema(secretPurposes)
