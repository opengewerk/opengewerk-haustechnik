import {
  type Draft,
  type EditResult,
  isUnauthenticated,
  request,
  RequestRefused,
} from '@opengewerk/platform-web/sync'

import type { SyncClient } from './client.js'

/**
 * What the route that owns a record is asked with a connection, now, where
 * neither the outbox nor the sync client has a way.
 *
 * The answer has the shape of every other edit, so that a form shows a
 * refusal of the server as it shows one of the outbox. The exchange that
 * follows brings down what the server wrote, with whatever it set, so the
 * screen that opens next shows what the server holds.
 */
async function atRoute(
  client: Pick<SyncClient, 'synchronise'>,
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  values: Draft | undefined,
  idOf: (answer: { readonly id?: unknown }) => string,
): Promise<EditResult> {
  let answer: { readonly id?: unknown }

  try {
    answer = await request<{ readonly id?: unknown }>(path, {
      method,
      ...(values === undefined ? {} : { body: JSON.stringify(values) }),
    })
  } catch (error) {
    if (isUnauthenticated(error)) {
      // The exchange is where a session that has run out is noticed and the
      // sign in asked for again.
      void client.synchronise()
    }

    // A refusal is an answer and brings its own sentence. Anything else is
    // no answer at all: nobody was reached.
    return error instanceof RequestRefused
      ? { outcome: 'refused', reason: 'online_only', fields: [], message: error.message }
      : { outcome: 'refused', reason: 'online_only', fields: [] }
  }

  await client.synchronise()

  return { outcome: 'queued', id: idOf(answer) }
}

/**
 * Makes a record at the route that owns its kind, with a connection, now.
 *
 * What only the office keeps is made this way (ADR 0006, point 6): a
 * property, a building, a floor, a duty. The outbox takes no such record,
 * and the sync client changes and removes one at its route as well. The
 * answer names the record the server made.
 */
export function makeAt(
  client: Pick<SyncClient, 'synchronise'>,
  path: string,
  values: Draft,
): Promise<EditResult> {
  return atRoute(client, 'POST', path, values, (made) => String(made.id))
}

/**
 * Asks a route for what it does to a record that is there: moving a room to
 * another floor, removing it, removing a time a building is closed, changing
 * an asset in the office, which reads it from the server and not from the
 * device.
 *
 * A room is changed through the outbox, so the sync client would put its
 * removal there as well, where the server refuses it (ADR 0006: moving and
 * removing a room is for whoever keeps the places, with a connection). And a
 * record below another one is removed at an address the sync client does not
 * know. The answer names the record that was asked about.
 */
export function askAt(
  client: Pick<SyncClient, 'synchronise'>,
  method: 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  id: string,
  values?: Draft,
): Promise<EditResult> {
  return atRoute(client, method, path, values, () => id)
}
