import {
  type Draft,
  type EditResult,
  isUnauthenticated,
  request,
  RequestRefused,
} from '@opengewerk/platform-web/sync'

import type { SyncClient } from './client.js'

/**
 * Makes a record at the route that owns its kind, with a connection, now.
 *
 * What only the office keeps is made this way (ADR 0006, point 6): a
 * property, a building, a floor, a duty. The outbox takes no such record,
 * and the sync client changes and removes one at its route as well. The
 * answer has the shape of every other edit, so that a form shows a refusal
 * of the server as it shows one of the outbox.
 *
 * The exchange that follows brings the new row down, with whatever the server
 * set on it, so the screen that opens next shows what the server holds.
 */
export async function makeAt(
  client: Pick<SyncClient, 'synchronise'>,
  path: string,
  values: Draft,
): Promise<EditResult> {
  let made: { readonly id?: unknown }

  try {
    made = await request<{ readonly id?: unknown }>(path, {
      method: 'POST',
      body: JSON.stringify(values),
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

  return { outcome: 'queued', id: String(made.id) }
}
