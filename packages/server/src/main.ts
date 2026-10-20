import 'reflect-metadata'

import {
  completeRoles,
  instanceIsEmpty,
  invitationLinks,
  readConfiguration,
  runInstance,
  startFileSweep,
  startupLine,
  stopOnSignals,
} from '@opengewerk/platform-server'

import { access } from './authentication/access.js'
import { shippedCatalogue } from './catalogue.js'
import { application } from './configuration.js'
import { startDeadlineWorker } from './deadlines/engine.js'
import { openInstance } from './instance.js'
import { startMailWorker } from './mail/worker.js'
import { startPushWorker } from './push/worker.js'

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

  // Stopped in this order when the container runtime asks. The mail job
  // first: a pass that is running finishes, so that a message is not sent
  // and then forgotten because the pool closed before the row could say so.
  // The deadlines likewise: a reminder that has its mark is not cut off
  // before its transaction ends; and push, whose pass writes down what
  // became of each message.
  let mailWorker: { readonly stop: () => Promise<void> } | null = null
  let deadlineWorker: { readonly stop: () => Promise<void> } | null = null
  let pushWorker: { readonly stop: () => Promise<void> } | null = null
  let fileSweep: { readonly stop: () => Promise<void> } | null = null

  stopOnSignals(application.name, [
    () => mailWorker?.stop(),
    () => deadlineWorker?.stop(),
    () => pushWorker?.stop(),
    () => fileSweep?.stop(),
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

  // The deadline engine runs on every instance that is open: it keeps the
  // appointments of the duties whether or not anybody gets a message about
  // them (opengewerk-haustechnik#25). Not on a closed instance, which writes
  // nothing.
  if (!configuration.closed) {
    deadlineWorker = startDeadlineWorker({
      database: instance.database,
      catalogue: shippedCatalogue(),
    })
    // The bytes of a file no operator holds any more go out of the store,
    // once a day (#657 in the repository opengewerk).
    fileSweep = startFileSweep(instance.database, instance.files)
  }

  // The jobs that tell people what is due (#126). Neither runs on a closed
  // instance, and push only where the environment holds a key to sign with.
  // An operator without a mail server gets no mail written for it: the
  // deadline reminds all the same, as an activity and in the list.
  if (instance.push) {
    pushWorker = startPushWorker({
      database: instance.database,
      vapid: instance.push.vapid,
      post: instance.push.post,
    })
  }

  if (instance.mail) {
    mailWorker = startMailWorker({
      database: instance.database,
      connect: instance.mail.connect,
      key: instance.mail.key,
      origin: instance.mail.origin,
      invitationLinks: invitationLinks(instance.database, instance.mail.origin),
    })
  }

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
