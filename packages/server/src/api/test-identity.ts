import {
  type Identity,
  rightsOfRoles,
  type RoleKey,
  type TenantId,
} from '@opengewerk/haustechnik-domain'
import type { IdentitySource } from '@opengewerk/platform-server'
import { headerIdentities } from '@opengewerk/platform-server/testing'

// The stand in for the authentication is the foundation's (ADR 0010 in the
// repository opengewerk): it reads an identity out of a header, which is
// exactly what a real one must never do. Here is the one thing this
// application adds, the header for somebody with its roles.

export { noIdentities } from '@opengewerk/platform-server/testing'

/**
 * Somebody as a test names them: who, for which tenant, with which of the
 * four roles a tenant starts with. The rights follow from the roles.
 */
export type Somebody = Omit<Identity, 'rights' | 'roles'> & { readonly roles: readonly RoleKey[] }

const believed = headerIdentities<Identity>()

/**
 * Believes the header `x-test-identity`, with the roles of this application
 * in it.
 *
 * A header names roles and no rights. A real session reads the rights from
 * the rows of the tenant; here they are what those of the four shipped roles
 * add up to as the code defines them, which is the same for a tenant that has
 * the roles it started with. `roles.test.ts` holds the rows against that
 * definition. A header that carries rights of its own is taken at its word.
 */
export const testIdentities: IdentitySource = {
  identify: async (request) => {
    const identity = await believed.identify(request)

    if (identity === null || Array.isArray(identity.rights)) {
      return identity
    }

    return { ...identity, rights: [...rightsOfRoles(identity.roles as readonly RoleKey[])] }
  },
  authenticate: (request) => believed.authenticate(request),
}

/** The header value for somebody with these roles, for one tenant. */
export function as(tenantId: TenantId, userId: string, ...roles: RoleKey[]): string {
  return JSON.stringify({ userId, tenantId, roles } satisfies Somebody)
}

/**
 * The same somebody in a session opened on one device. What belongs to a
 * device and to nobody else, as its list of conflicts, is asked for like this;
 * a header from `as` alone is a session that is no device and has none.
 */
export function onDevice(somebody: string, deviceId: string): string {
  return JSON.stringify({ ...(JSON.parse(somebody) as Somebody), deviceId })
}
