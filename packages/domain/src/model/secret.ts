/**
 * What a tenant hands the instance to keep sealed: credentials of somebody
 * else, which the instance needs in order to act for the tenant.
 *
 * - `smtp_password`: the password of the mail server a tenant sends its mail
 *   through. Every tenant brings its own server; the instance has none.
 *
 * How a value is sealed, bound to the tenant and the purpose it was kept for,
 * and opened again is the foundation's (`secretStore`). What this application
 * says is which purposes there are. A further one, the code of a key safe at
 * a property for instance, is a further entry here and a migration that adds
 * it to the list in the database.
 */
export const secretPurposes = ['smtp_password'] as const

export type SecretPurpose = (typeof secretPurposes)[number]
