import {
  canonicalForm,
  type DelegationPage,
  defaultWorkOrderSettings,
  heldPageOf,
  type ServiceReportPage,
  serviceReportLimits,
  serviceReportPageOf,
  type SignedPage,
  signatureLimits,
} from '@opengewerk/haustechnik-domain'
import { refusalFor } from '@opengewerk/platform-web/sync'

import { catalogueKeep, keptCatalogue } from '../sync/catalogue.js'
import type { SyncClient } from '../sync/client.js'
import type { GivenSignature } from './signature-ways.js'
import { materialsOnDevice } from './materials.js'

/**
 * Signing an activity on the device (#108, ADR 0004, points 7 and 10): the
 * page as this device holds it, its fingerprint, and the signature for
 * exactly that page, through the outbox and so also without a network. The
 * server works the page out again from what it holds and takes the
 * signature only where both are the same.
 */

/**
 * The page of an activity as this device holds it, with what waits in its
 * outbox. The catalogue it holds says whether the form of the activity asks
 * for the circuits of its asset (#350), as the server's does.
 */
export function pageOnDevice(client: SyncClient, activityId: string): SignedPage | null {
  return heldPageOf(
    {
      find: (entity, id) => client.list(entity).find((record) => record['id'] === id) ?? null,
      related: (entity, field, id) => client.list(entity).filter((record) => record[field] === id),
    },
    activityId,
    keptCatalogue(client.kept(catalogueKeep)),
  )
}

/** SHA-256 over the canonical form of a page, as the server takes it: 64 hexadecimal digits. */
export async function fingerprintOf(
  page: SignedPage | ServiceReportPage | DelegationPage,
): Promise<string> {
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

/**
 * Whether the service report names the people who did the work and the times
 * of their notes (#324), as this device holds the setting of the operator.
 */
export function namesAndTimesOnDevice(client: SyncClient): boolean {
  const [setting] = client.list('work_order_settings')
  const value = setting?.['namesAndTimes']

  return typeof value === 'boolean' ? value : defaultWorkOrderSettings.namesAndTimes
}

/** The page of the service report of a work order as this device holds it, for a name. */
export function reportPageOnDevice(
  client: SyncClient,
  activityId: string,
  clientName: string,
): ServiceReportPage | null {
  const page = pageOnDevice(client, activityId)

  return page === null
    ? null
    : serviceReportPageOf(
        page,
        clientName,
        namesAndTimesOnDevice(client),
        // The material taken for the order stands on the page (#326).
        materialsOnDevice(client, activityId),
      )
}

/**
 * The client's signature under the service report of a work order (#324):
 * the name in block letters and the drawing, for the page as this device
 * holds it now, through the outbox and so also without a network. The
 * sentence to show when the device turns it down, or null when it is queued.
 */
export async function takeServiceReport(
  client: SyncClient,
  activityId: string,
  clientName: string,
  path: string,
): Promise<string | null> {
  const page = reportPageOnDevice(client, activityId, clientName)

  if (page === null) {
    return signingWords.notHeld
  }

  const made = await client.create('service_reports', {
    activityId,
    clientName: clientName.trim(),
    path,
    signedAt: new Date().toISOString(),
    deviceInfo: globalThis.navigator.userAgent.slice(0, serviceReportLimits.deviceInfo),
    pageFingerprint: await fingerprintOf(page),
  })

  return made.outcome === 'refused' ? refusalFor(made) : null
}
