import {
  type Identity,
  type IsoDate,
  keyDateFor,
  readingDoubt,
  readingJump,
  validReadings,
} from '@opengewerk/haustechnik-domain'
import type { FoundIdentity, SyncCheck, SyncRefusal } from '@opengewerk/platform-server'

import { heldMeter } from '../database/meter-standing.js'
import { dayInGermany } from '../today.js'

// A reading made on site without a network, on a round of the meters
// (section 4.9 of the concept, #120). The device has asked its measuring
// point what the office asks: whether it is locked, whether its key date has
// a reading, whether the figure lies below the reading before or jumps far
// above it, and the person has confirmed a jump. The server asks again when
// the device exchanges, against what it holds by then: another device may
// have read the same meter for the same key date, or the office locked it.
// What does not fit any more is a conflict about this one reading, which the
// person on the device decides; the outbox behind it goes on.

type Check = SyncCheck<FoundIdentity<Identity>>

function conflict(
  reason: 'changed_elsewhere' | 'record_is_fixed' | 'record_missing',
  field: string,
): SyncRefusal {
  return { kind: 'conflict', reason, fields: [field] }
}

/**
 * A reading a device makes: its place from its measuring point, its key
 * date for the day it was read on, from the key day of the measuring point
 * or the operator, and how it came, a round of the meters. Two readings for
 * one key date are a conflict (section 12 of the concept), as are a locked
 * measuring point, a figure below the one before or above the one after,
 * and a jump nobody confirmed.
 */
export const readOnSite: Check = async ({ tx, operation, values }) => {
  if (operation.entity !== 'meter_readings' || operation.kind !== 'create') {
    return null
  }

  const held = await heldMeter(tx, values['assetId'], true)

  if (held === null) {
    return conflict('record_missing', 'assetId')
  }

  const readOn = values['readOn'] as IsoDate

  if (readOn > dayInGermany()) {
    return conflict('changed_elsewhere', 'readOn')
  }

  const keyDate = keyDateFor(readOn, held.keyDay)

  values['propertyId'] = held.asset.propertyId
  values['areaId'] = held.asset.areaId
  values['keyDate'] = keyDate
  values['source'] = 'reading_round'

  if (held.point?.lockReason !== null && held.point?.lockReason !== undefined) {
    return conflict('record_is_fixed', 'valueMilli')
  }

  const valid = validReadings(held.readings)

  if (valid.some((reading) => reading.keyDate === keyDate)) {
    return conflict('changed_elsewhere', 'valueMilli')
  }

  const figure = { keyDate, readOn, valueMilli: values['valueMilli'] as number }
  const before = {
    readings: valid,
    exchanges: held.exchanges,
    pauses: held.pauses,
    conversionFactor: held.point?.conversionFactor ?? null,
  }

  if (readingDoubt(figure, before, held.asset.meterUnit ?? 'cubic_metres') !== null) {
    return conflict('changed_elsewhere', 'valueMilli')
  }

  const jump = readingJump(figure, before)

  if (jump !== null && values['jumpConfirmed'] !== true) {
    return conflict('changed_elsewhere', 'jumpConfirmed')
  }

  values['jumpConfirmed'] = jump !== null

  return null
}
