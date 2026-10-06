import {
  duplicateFields,
  duplicateKey,
  type Identity,
  possibleDuplicates,
} from '@opengewerk/haustechnik-domain'
import type { FoundIdentity, SyncCheck } from '@opengewerk/platform-server'
import { sql } from 'drizzle-orm'

// The possible duplicate of an asset taken stock of on a device (sections 2.7
// and 4.2 of the concept). The device has asked the assets it holds and shown
// what it found; the server asks again when the device exchanges, against
// every asset of the operator. One the person has not seen makes the
// operation a conflict: the asset is not entered until somebody on the device
// says whether it is the one that is there.
//
// Asked past the areas, through the one function that may
// (`asset_duplicate_candidates`, ADR 0003, addendum on #99): two people who
// take stock in two areas enter the same asset as easily as two in one. The
// function hands over the few assets whose digits fit, and what a duplicate
// is stays the rule of `domain`, asked here as on the device.

type Check = SyncCheck<FoundIdentity<Identity>>

/** A list as an operation brings it: as the text of one, or as the column holds it. */
function listed(value: unknown): readonly unknown[] {
  if (typeof value !== 'string') {
    return Array.isArray(value) ? (value as readonly unknown[]) : []
  }

  try {
    const read = JSON.parse(value) as unknown

    return Array.isArray(read) ? (read as readonly unknown[]) : []
  } catch {
    return []
  }
}

/**
 * An asset a device enters, held against every asset of the operator: a
 * conflict over the fields it shares with one the person has not passed
 * (`distinctFrom`). `changed_elsewhere` is the reason the foundation has for
 * it, somebody else got there first; the device knows the case by the record
 * that is on neither side and the fields named.
 *
 * Only for an asset that is made. A serial number corrected afterwards is
 * read off the plate of an asset that is there.
 */
export const unseenDuplicate: Check = async ({ tx, operation, values }) => {
  if (operation.entity !== 'assets' || operation.kind !== 'create') {
    return null
  }

  const candidate = { serialNumber: values['serialNumber'], mark: values['mark'] }

  if (duplicateFields.every((field) => duplicateKey(candidate[field]) === null)) {
    return null
  }

  const said = (field: (typeof duplicateFields)[number]) =>
    duplicateKey(candidate[field]) === null ? null : String(candidate[field])
  const { rows } = await tx.execute<{
    id: string
    serial_number: string | null
    mark: string | null
  }>(
    sql`select id, serial_number, mark
          from asset_duplicate_candidates(${said('serialNumber')}::text, ${said('mark')}::text)`,
  )
  const passed = new Set(listed(values['distinctFrom']).map(String))
  const unseen = possibleDuplicates(
    candidate,
    rows.map((row) => ({ id: row.id, serialNumber: row.serial_number, mark: row.mark })),
  ).filter(({ asset }) => !passed.has(asset.id))

  return unseen.length === 0
    ? null
    : {
        kind: 'conflict',
        reason: 'changed_elsewhere',
        fields: duplicateFields.filter((field) => unseen.some(({ same }) => same.includes(field))),
      }
}
