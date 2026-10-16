import {
  briefingLimits,
  type Catalogue,
  type FormDefinition,
  formOfActivity,
  type FormValues,
  hotWorkPermitForm,
  type IsoDate,
  workPermitLimits,
} from '@opengewerk/haustechnik-domain'
import { refusalFor } from '@opengewerk/platform-web/sync'

import type { SyncClient } from '../sync/client.js'

// A contractor at work at a work order (section 4.11 of the concept, #330):
// the briefing of one of its people and the permit for hot work, written on
// the device of whoever leads the order or plans and hands out work, also
// without a network, and never changed afterwards. Who held the device is
// the person signed in, which the server writes.

/** What a device writes for the moment and the device of a record. */
function stamped(longest: number) {
  return {
    signedAt: new Date().toISOString(),
    deviceInfo: globalThis.navigator.userAgent.slice(0, longest),
  }
}

/**
 * Writes a briefing to the outbox: whom of the firm the order names, in
 * what, and the drawing. Null once it is queued, otherwise the sentence why
 * it was not taken.
 */
export async function takeBriefing(
  client: SyncClient,
  briefing: {
    readonly activityId: string
    readonly contractorId: string
    readonly personName: string
    readonly subject: string
    readonly path: string
  },
): Promise<string | null> {
  const made = await client.create('briefings', {
    activityId: briefing.activityId,
    contractorId: briefing.contractorId,
    personName: briefing.personName.trim(),
    subject: briefing.subject.trim(),
    path: briefing.path,
    ...stamped(briefingLimits.deviceInfo),
  })

  return made.outcome === 'refused' ? refusalFor(made) : null
}

/**
 * Writes a permit for hot work to the outbox, in the form and the version
 * it was filled in. Null once it is queued, otherwise the sentence why it
 * was not taken.
 */
export async function issueWorkPermit(
  client: SyncClient,
  permit: {
    readonly activityId: string
    readonly contractorId: string
    readonly form: FormDefinition
    readonly answers: FormValues
  },
): Promise<string | null> {
  const made = await client.create('work_permits', {
    activityId: permit.activityId,
    contractorId: permit.contractorId,
    formKey: permit.form.key,
    formVersion: permit.form.version,
    // A value of JSON travels as its text.
    answers: JSON.stringify(permit.answers),
    ...stamped(workPermitLimits.deviceInfo),
  })

  return made.outcome === 'refused' ? refusalFor(made) : null
}

/**
 * The form a new permit is filled in on a day: the permit for hot work of
 * the package Brandschutz in the version in force, or null where the
 * catalogue of the device holds none.
 */
export function permitFormOn(catalogue: Catalogue | null, day: IsoDate): FormDefinition | null {
  const entry = catalogue?.form(hotWorkPermitForm, day) ?? null

  return entry === null || catalogue === null
    ? null
    : (formOfActivity(catalogue, { formKey: entry.key, formVersion: entry.version }) ?? null)
}
