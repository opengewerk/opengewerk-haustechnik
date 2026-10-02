import { missingRight, type Right } from '@opengewerk/haustechnik-domain'
import {
  type Authorization,
  RequiresPermission as requiresPermission,
} from '@opengewerk/platform-server'

// The guard is the foundation's (ADR 0010 in the repository opengewerk): who
// is asking, for which tenant, which rights their identity carries, who runs
// the instance, and that a route without a declared right is refused. What a
// refusal says is this application's, and this is where the two are bound.

export {
  AuthorizationGuard,
  OPERATOR_METADATA,
  PERMISSION_METADATA,
  PUBLIC_METADATA,
  PublicRoute,
  RequiresOperator,
  RequiresSession,
  SESSION_METADATA,
} from '@opengewerk/platform-server'

/**
 * The right a handler needs, as one of the rights of this application: a typo
 * in one is found by the compiler and not by a refused request.
 */
export const RequiresPermission = (right: Right) => requiresPermission(right)

/** What the guard is told about this application. */
export const authorization: Authorization<Right> = {
  missingPermission: missingRight,
  sentences: {
    operatorsOnly: 'Diesen Bereich erreicht nur die Verwaltung der Instanz.',
    workingInAnotherTenant:
      'Diese Seite arbeitet noch für einen anderen Betreiber als die Anmeldung und lädt neu.',
  },
}
