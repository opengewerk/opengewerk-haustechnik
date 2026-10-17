import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common'
import { Database, identityProperty, type RequestWithIdentity } from '@opengewerk/platform-server'
import { from, type Observable, switchMap } from 'rxjs'

import { auditorReads } from '../database/schema/index.js'

/** The role whose every request is written down (#339). */
export const auditorRole = 'auditor'

interface Asked extends RequestWithIdentity {
  readonly originalUrl: string
  readonly route?: { readonly path?: string }
}

/**
 * "Jeder Zugriff festgehalten" (#339, section 4.3 of the concept): every
 * request of an auditor becomes a line of `auditor_reads` before it is
 * served, in a transaction of its own. Should the line not be written, the
 * request is not served either: nothing is read that is not written down. A
 * request the guard refuses, for a right the auditor does not hold, reads
 * nothing and is not written down: the guard runs before this.
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

    const [path = '', query] = request.originalUrl.split('?')

    return from(
      this.database.forTenant(identity, (tx) =>
        tx.insert(auditorReads).values({
          tenantId: identity.tenantId,
          userId: identity.userId,
          route: request.route?.path ?? path,
          path,
          query: query === undefined || query === '' ? null : query,
        }),
      ),
    ).pipe(switchMap(() => next.handle()))
  }
}
