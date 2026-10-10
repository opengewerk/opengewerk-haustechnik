import type { AttachmentId, AttachmentVersionId } from '@opengewerk/platform-domain'
import { describe, expect, it } from 'vitest'

import {
  bearsTheIntervalOf,
  type DocumentHanging,
  type DutyPlaceChain,
  intervalDocumentElsewhere,
  intervalDocumentProblem,
  intervalDocumentReading,
  intervalToCheck,
} from './duty-document.js'

/** An asset in a room of a building, on a property, and the chain of a duty at it. */
const atTheAsset: DutyPlaceChain = {
  propertyId: 'p-1',
  buildingId: 'b-1',
  roomId: 'r-1',
  assetId: 'a-1',
}

/** A document of the property itself; each case names what else it hangs on. */
function documentAt(
  hanging: Readonly<Record<string, string>> = {},
): Record<keyof DocumentHanging, unknown> {
  return {
    propertyId: 'p-1',
    buildingId: null,
    roomId: null,
    assetId: null,
    activityId: null,
    defectId: null,
    ...hanging,
  }
}

describe('the documents that may bear the interval of a duty', () => {
  it('are those at its place and at every place above it on its property', () => {
    expect(bearsTheIntervalOf(documentAt(), atTheAsset)).toBe(true)
    expect(bearsTheIntervalOf(documentAt({ buildingId: 'b-1' }), atTheAsset)).toBe(true)
    expect(bearsTheIntervalOf(documentAt({ roomId: 'r-1' }), atTheAsset)).toBe(true)
    expect(bearsTheIntervalOf(documentAt({ assetId: 'a-1' }), atTheAsset)).toBe(true)
    expect(intervalDocumentProblem(documentAt({ assetId: 'a-1' }), atTheAsset)).toBeNull()
  })

  it('are none of another property, nor of another record on the same one', () => {
    expect(intervalDocumentProblem(documentAt({ propertyId: 'p-2' }), atTheAsset)).toBe(
      intervalDocumentElsewhere,
    )
    expect(bearsTheIntervalOf(documentAt({ buildingId: 'b-2' }), atTheAsset)).toBe(false)
    expect(bearsTheIntervalOf(documentAt({ roomId: 'r-2' }), atTheAsset)).toBe(false)
    expect(bearsTheIntervalOf(documentAt({ assetId: 'a-2' }), atTheAsset)).toBe(false)
  })

  it('are none below the place of the duty', () => {
    const atTheBuilding: DutyPlaceChain = {
      propertyId: 'p-1',
      buildingId: 'b-1',
      roomId: null,
      assetId: null,
    }

    expect(bearsTheIntervalOf(documentAt({ buildingId: 'b-1' }), atTheBuilding)).toBe(true)
    expect(bearsTheIntervalOf(documentAt({ roomId: 'r-1' }), atTheBuilding)).toBe(false)
    expect(bearsTheIntervalOf(documentAt({ assetId: 'a-1' }), atTheBuilding)).toBe(false)
  })

  it('are none of an activity or a defect: a record of work or of a finding bears no interval', () => {
    expect(bearsTheIntervalOf(documentAt({ activityId: 'v-1' }), atTheAsset)).toBe(false)
    expect(bearsTheIntervalOf(documentAt({ defectId: 'd-1' }), atTheAsset)).toBe(false)
  })
})

const first = '00000000-0000-7000-8000-000000000001' as AttachmentVersionId
const second = '00000000-0000-7000-8000-000000000002' as AttachmentVersionId
const third = '00000000-0000-7000-8000-000000000003' as AttachmentVersionId
const document = {
  id: '00000000-0000-7000-8000-0000000000aa' as AttachmentId,
  title: 'Gefährdungsbeurteilung Werkstatt',
  removed: false,
}

function versions(...ids: AttachmentVersionId[]) {
  return ids.map((id, index) => ({
    id,
    filedOn: `2026-0${String(index + 1)}-01`,
    fileName: 'gb-werkstatt.pdf',
  }))
}

describe('the document a duty points at', () => {
  it('names the version the duty keeps, counted from the first, and nothing newer while it is the newest', () => {
    const reading = intervalDocumentReading(document, versions(first, second), second)

    expect(reading).toMatchObject({ version: { id: second, number: 2 }, newer: null })
    expect(intervalToCheck(reading, false)).toBe(false)
  })

  it('names the newest version where one lies over the one the duty keeps, and the duty says "Frist prüfen"', () => {
    // Handed over in any order, the versions go by their ids.
    const reading = intervalDocumentReading(document, versions(third, first, second), first)

    expect(reading).toMatchObject({
      version: { id: first, number: 1 },
      newer: { id: third, number: 3 },
    })
    expect(intervalToCheck(reading, false)).toBe(true)
  })

  it('says "Frist prüfen" where the document was taken out of the records', () => {
    const reading = intervalDocumentReading({ ...document, removed: true }, versions(first), first)

    expect(intervalToCheck(reading, false)).toBe(true)
  })

  it('says nothing once the duty has ended, and nothing where there is no document', () => {
    const reading = intervalDocumentReading(document, versions(first, second), first)

    expect(intervalToCheck(reading, true)).toBe(false)
    expect(intervalToCheck(null, false)).toBe(false)
  })

  it('is nothing where the version is none of the document', () => {
    expect(intervalDocumentReading(document, versions(first), second)).toBeNull()
  })
})
