import {
  canonicalForm,
  heldPageOf,
  type SignedPage,
  signatureLimits,
} from '@opengewerk/haustechnik-domain'
import { refusalFor } from '@opengewerk/platform-web/sync'

import type { SyncClient } from '../sync/client.js'
import type { GivenSignature } from './signature-ways.js'

/**
 * Signing an activity on the device (#108, ADR 0004, points 7 and 10): the
 * page as this device holds it, its fingerprint, and the signature for
 * exactly that page, through the outbox and so also without a network. The
 * server works the page out again from what it holds and takes the
 * signature only where both are the same.
 */

/** The page of an activity as this device holds it, with what waits in its outbox. */
export function pageOnDevice(client: SyncClient, activityId: string): SignedPage | null {
  return heldPageOf(
    {
      find: (entity, id) => client.list(entity).find((record) => record['id'] === id) ?? null,
      related: (entity, field, id) => client.list(entity).filter((record) => record[field] === id),
    },
    activityId,
  )
}

/** SHA-256 over the canonical form of a page, as the server takes it: 64 hexadecimal digits. */
export async function fingerprintOf(page: SignedPage): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonicalForm(page)),
  )

  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export const signingWords = {
  notHeld: 'Diesen Vorgang hält dieses Gerät nicht.',
} as const

/**
 * Signs an activity as the person who did the work, with the drawing or the
 * typed name (#209), for the page as it stands now. The sentence to show
 * when the device turns it down, or null when it is queued.
 */
export async function signActivity(
  client: SyncClient,
  activityId: string,
  given: GivenSignature,
): Promise<string | null> {
  const page = pageOnDevice(client, activityId)

  if (page === null) {
    return signingWords.notHeld
  }

  const made = await client.create('activity_signatures', {
    activityId,
    role: 'signer',
    signedAt: new Date().toISOString(),
    deviceInfo: globalThis.navigator.userAgent.slice(0, signatureLimits.deviceInfo),
    path: given.path,
    typedName: given.typedName,
    pageFingerprint: await fingerprintOf(page),
  })

  return made.outcome === 'refused' ? refusalFor(made) : null
}
