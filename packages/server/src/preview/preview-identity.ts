import type { Identity } from '@opengewerk/haustechnik-domain'
import type { createServer, IdentitySource, SignedInUser } from '@opengewerk/platform-server'

import type { PreviewPerson } from './preview-database.js'

/**
 * What stands under the path of the authentication, as the foundation's
 * server takes it, so that this package names no web framework of its own.
 */
type AuthenticationHandler = NonNullable<
  Parameters<typeof createServer>[1]['authenticationHandler']
>

/** The session every request of the preview is said to carry. */
export const previewSessionId = 'preview-session'

/**
 * An identity source that answers every request with the same person, for
 * the same operator, with the same role, whatever the request carries.
 *
 * The API tests work this way, through a header; the preview does without
 * even that, because a browser sends no header of its own. That is the whole
 * of what makes the preview a preview, and the reason for the fences around
 * it: this folder is left out of `dist` and with it out of the image, the
 * entry point refuses `NODE_ENV=production` and a database that is not local,
 * and it listens on 127.0.0.1 and nowhere else.
 *
 * What stays real is everything behind the guard. Rights are checked against
 * the role exactly as against a membership, row level security isolates the
 * operator and keeps the person to the areas of their membership, and the
 * audit log writes down who did what.
 */
export class PreviewIdentitySource implements IdentitySource {
  private readonly identity: Identity

  constructor(identity: Identity) {
    this.identity = identity
  }

  identify(): Promise<Identity> {
    return Promise.resolve(this.identity)
  }

  authenticate(): Promise<SignedInUser> {
    return Promise.resolve({ userId: this.identity.userId, sessionId: previewSessionId })
  }
}

/**
 * What stands where better-auth's routes stand on an instance, under
 * `/api/auth`.
 *
 * One of them is answered: the question the interface asks first, who is
 * signed in and for which operator. The answer names the preview's person
 * with the operator already chosen, so the interface goes straight to work.
 * Every other route of the sign in says that there is none, because signing
 * in, signing out and setting up a second factor have nothing to act on here.
 */
export function previewSession(identity: Identity, person: PreviewPerson): AuthenticationHandler {
  return (request, response) => {
    if (request.method === 'GET' && request.path === '/get-session') {
      response.json({
        user: {
          id: identity.userId,
          name: person.name,
          email: person.email,
          twoFactorEnabled: true,
        },
        session: {
          id: previewSessionId,
          userId: identity.userId,
          activeTenantId: identity.tenantId,
        },
      })

      return
    }

    response.status(404).json({
      statusCode: 404,
      message:
        'In der Vorschau gibt es keine Anmeldung. Jede Anfrage läuft als die Person, mit der ' +
        'die Vorschau gestartet ist.',
    })
  }
}
