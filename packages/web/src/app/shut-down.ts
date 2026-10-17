import {
  type Catalogue,
  type DefectAtAsset,
  type DefectStatus,
  type RecordState,
  shutDownBy,
} from '@opengewerk/haustechnik-domain'
import { maybeText, text, useRecords } from '@opengewerk/platform-web/sync'
import { useMemo } from 'react'

import { useCatalogue } from '../sync/catalogue.js'

/** A defect a device holds, with what says whether it puts its asset out of service. */
interface HeldDefect extends DefectAtAsset {
  readonly record: RecordState
}

function held(record: RecordState): HeldDefect {
  return {
    assetId: maybeText(record, 'assetId') as DefectAtAsset['assetId'],
    status: record['status'] as DefectStatus,
    defectClass: maybeText(record, 'defectClass'),
    record,
  }
}

/**
 * The defects a device holds that put an asset out of service (#345, section
 * 4.6 of the concept), by the asset each is at, the one found first first:
 * open and of a class that makes an asset unsafe (`shutsDownItsAsset`). A
 * device holds every defect of the areas of the person that waits to be set
 * right (`deviceScope` of the server), so a room, a building and an asset on
 * site say it without a network. Without a catalogue on the device nothing
 * can be said.
 */
export function shutDownOn(
  defects: readonly RecordState[],
  catalogue: Pick<Catalogue, 'defectClass'> | null,
): ReadonlyMap<string, readonly RecordState[]> {
  if (catalogue === null) {
    return new Map()
  }

  const firstFound = [...defects].sort((left, right) =>
    text(left, 'foundOn').localeCompare(text(right, 'foundOn')),
  )

  return new Map(
    [...shutDownBy(firstFound.map(held), catalogue)].map(([assetId, own]) => [
      assetId,
      own.map((defect) => defect.record),
    ]),
  )
}

/** `shutDownOn` over what the device holds now. */
export function useShutDown(): ReadonlyMap<string, readonly RecordState[]> {
  const defects = useRecords('defects')
  const catalogue = useCatalogue()

  return useMemo(() => shutDownOn(defects, catalogue), [defects, catalogue])
}
