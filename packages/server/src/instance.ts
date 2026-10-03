import { serverPaths } from '@opengewerk/haustechnik-domain'
import {
  authenticationHandler,
  ClosedIdentitySource,
  type Configuration,
  ConfigurationError,
  createServer,
  Database,
  InstanceSettingsCache,
  type Server,
} from '@opengewerk/platform-server'

import { ApiModule } from './api/api.module.js'
import { createAuthentication, SessionIdentitySource } from './authentication/access.js'

/** A running instance, before it listens, and what stops it again. */
export interface OpenInstance extends Server {
  readonly database: Database
  /** Stops reading the settings of the instance again, before the database closes. */
  readonly stopSettings: () => void
}

/**
 * Puts an instance together from its configuration: the database, the
 * authentication, the module of this application and what stands in front of
 * its routes, the interface included (ADR 0010 in the repository opengewerk).
 *
 * Apart from `main.ts` so that a test can open an instance the way a start
 * does and ask it what a browser asks, without a port and without a process
 * of its own. Listening, the line in the log and stopping on a signal are the
 * start's.
 *
 * The identity source is better-auth's, unless `CLOSED` is set: then it is the
 * one that recognises nobody, and the instance runs, reports its health and
 * hands out nothing, the sign in and the first run included. Migrations do not
 * run from here; they run as another role, before this process starts.
 *
 * `interfaceDirectory` is where the built interface lies. Left out, it is
 * looked for where an image and a checkout keep it; null serves the API alone.
 */
export async function openInstance(
  configuration: Configuration,
  options: { readonly interfaceDirectory?: string | null } = {},
): Promise<OpenInstance> {
  const database = Database.connect(configuration.databaseUrl)

  if (!(await database.isReachable())) {
    await database.close()

    throw new ConfigurationError(
      'Keine Verbindung zur Datenbank. Läuft PostgreSQL, und stimmen Adresse und ' +
        'Zugangsdaten in DATABASE_URL?',
    )
  }

  // The settings of the instance, kept in memory and read again every half
  // minute, so that a change made in the area of the instance reaches whatever
  // asks them without a restart.
  const instanceSettings = await InstanceSettingsCache.load(database)
  const stopSettings = instanceSettings.every(30_000)

  const authentication = createAuthentication({
    database,
    secret: configuration.sessionSecret,
    trustedOrigins: configuration.trustedOrigins,
  })

  const identities = configuration.closed
    ? new ClosedIdentitySource()
    : new SessionIdentitySource(authentication, database)

  // The trusted origins and the version go in whether the instance is open or
  // closed: they open nothing. The authentication goes in only when it is
  // open, and that is what puts the first run and the one time link on the
  // routing table at all.
  const output = {
    trustedOrigins: configuration.trustedOrigins,
    version: configuration.version,
  }

  const server = await createServer(
    ApiModule.create(
      database,
      identities,
      configuration.closed
        ? output
        : {
            ...output,
            authentication,
            setupCode: configuration.setupCode,
            instance: { settings: instanceSettings },
          },
    ),
    {
      authenticationHandler: configuration.closed ? null : authenticationHandler(authentication),
      serverPaths,
      ...(options.interfaceDirectory === undefined
        ? {}
        : { interfaceDirectory: options.interfaceDirectory }),
    },
  )

  return { ...server, database, stopSettings }
}
