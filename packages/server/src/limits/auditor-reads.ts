import {
  type ArgumentsHost,
  type CallHandler,
  Catch,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common'
import {
  Database,
  IDENTITY_SOURCE,
  type IdentitySource,
  identityProperty,
  type RequestWithIdentity,
} from '@opengewerk/platform-server'
import type { TenantId } from '@opengewerk/haustechnik-domain'
import { from, type Observable, switchMap } from 'rxjs'

import { DatabaseExceptionFilter } from '../api/database-errors.js'
import { auditorReads } from '../database/schema/index.js'

/** The role whose every request is written down (#339). */
export const auditorRole = 'auditor'

interface Asked extends RequestWithIdentity {
  readonly originalUrl: string
  readonly route?: { readonly path?: string }
}

/** The line of `auditor_reads` for a request, served or refused, in a transaction of its own. */
function written(
  database: Database,
  identity: { readonly tenantId: TenantId; readonly userId: string },
  request: Asked,
  refused: boolean,
): Promise<unknown> {
  const [path = '', query] = request.originalUrl.split('?')

  return database.forTenant(identity, (tx) =>
    tx.insert(auditorReads).values({
      tenantId: identity.tenantId,
      userId: identity.userId,
      route: request.route?.path ?? path,
      path,
      query: query === undefined || query === '' ? null : query,
      refused,
    }),
  )
}

/**
 * "Jeder Zugriff festgehalten" (#339, section 4.3 of the concept): every
 * request of an auditor becomes a line of `auditor_reads` before it is
 * served, in a transaction of its own. Should the line not be written, the
 * request is not served either: nothing is read that is not written down. A
 * request the guard refuses never gets here, the guard runs before this; the
 * filter below writes that one down.
 */
@Injectable()
export class AuditorReadsInterceptor implements NestInterceptor {
  constructor(private readonly database: Database) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle()
    }

    const request = context.switchToHttp().getRequest<Asked>()
    const identity = request[identityProperty]

    if (identity === undefined || !identity.roles.includes(auditorRole)) {
      return next.handle()
    }

    return from(written(this.database, identity, request, false)).pipe(
      switchMap(() => next.handle()),
    )
  }
}

/**
 * The filter of the application, the foundation's answer to an error (#694)
 * with one thing before it (#537, section 7 of the concept: "jede seiner
 * Anfragen"): a request of an auditor the guard refused, for a right he does
 * not hold, becomes a line of the log as well, marked as refused. The guard
 * refuses before any handler and before the interceptor above, and leaves the
 * request without an identity, so that is how the refusal is told from a
 * refusal of a handler, whose request the interceptor wrote down already.
 * The answer is the same as without the line; a line that cannot be written
 * reads nothing, as the request read nothing.
 */
@Catch()
@Injectable()
export class AuditedExceptionFilter extends DatabaseExceptionFilter {
  constructor(
    private readonly database: Database,
    @Inject(IDENTITY_SOURCE) private readonly identities: IdentitySource,
  ) {
    super()
  }

  override catch(error: unknown, host: ArgumentsHost): void {
    void this.refusedAuditor(error, host).finally(() => {
      super.catch(error, host)
    })
  }

  private async refusedAuditor(error: unknown, host: ArgumentsHost): Promise<void> {
    if (!(error instanceof ForbiddenException) || host.getType() !== 'http') {
      return
    }

    const request = host.switchToHttp().getRequest<Asked>()

    if (request[identityProperty] !== undefined) {
      return
    }

    const identity = await this.identities.identify(request).catch(() => null)

    if (identity === null || !identity.roles.includes(auditorRole)) {
      return
    }

    await written(this.database, identity, request, true).catch(() => undefined)
  }
}
