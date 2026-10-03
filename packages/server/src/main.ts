import 'reflect-metadata'

import {
  completeRoles,
  instanceIsEmpty,
  readConfiguration,
  runInstance,
  startupLine,
  stopOnSignals,
} from '@opengewerk/platform-server'

import { access } from './authentication/access.js'
import { application } from './configuration.js'
import { openInstance } from './instance.js'

/**
 * Starts an instance: puts it together (`openInstance`), gives every tenant
 * the roles it is missing, listens, and says in one line what somebody who
 * opens the address will find.
 *
 * Migrations do not run from here. They run as a different role, before this
 * process starts, which keeps the application from ever connecting with
 * rights it must not have; `migrate.ts` is that step.
 */
async function start(): Promise<void> {
  const configuration = readConfiguration(application)
  const instance = await openInstance(configuration)

  // Stopped in this order when the container runtime asks.
  stopOnSignals(application.name, [
    instance.stopSettings,
    () => instance.application.close(),
    () => instance.database.close(),
  ])

  // A tenant without a single role is one nobody can work in (ADR 0010 in the
  // repository opengewerk). Whatever brought one into being without its rows,
  // it gets the ones a tenant starts with here, before the first request. Not
  // on a closed instance, which writes nothing.
  if (!configuration.closed) {
    await completeRoles(instance.database, access)
      .then((completed) => {
        for (const tenantId of completed) {
          console.info(
            `Der Betreiber ${tenantId} hatte keine Rollen und hat die vier bekommen, mit denen ein Betreiber beginnt.`,
          )
        }
      })
      .catch((error: unknown) => {
        console.error('Die Rollen der Betreiber ließen sich nicht prüfen.', error)
      })
  }

  await instance.application.listen(configuration.port, configuration.host)

  // Asked once at startup, because the answer decides what somebody sees when
  // they open the address for the first time. A database that cannot answer
  // gets no sentence, a sentence in the log is never worth a server that does
  // not start. Where the setup code is, and never the code itself.
  const empty = configuration.closed
    ? false
    : await instanceIsEmpty(instance.database).catch(() => false)

  console.info(
    startupLine({
      name: application.name,
      host: configuration.host,
      port: configuration.port,
      interfaceServed: instance.interfaceDirectory !== null,
      closed: configuration.closed,
      empty,
      setupCode: configuration.setupCode !== null,
      emptyInstance: access.sentences.emptyInstance,
    }),
  )
}

await runInstance(application.name, start)
