import { describe, expect, it } from 'vitest'

import {
  serviceReportLimits,
  serviceReportPageOf,
  serviceReportProblems,
  serviceReportValid,
  serviceReportVoidedBy,
} from './service-report.js'
import { signedPageOf } from './signature.js'

/**
 * The rules of the service report of a work order (#324, section 4.8 of the
 * concept): what a report has to carry, what the client signs, and that a
 * rejection after it makes it invalid.
 */

const page = signedPageOf({
  activity: { id: 'ac-1', kind: 'work_order', title: 'Speicher entkalken', performedOn: null },
  place: {
    property: { name: 'Schule', address: 'Am Lindenhain 7, 00003 Musterhausen' },
    building: null,
    room: null,
    asset: null,
  },
  duties: [],
  defects: [],
  durationMinutes: 45,
  notes: [{ id: 'wn-1', text: 'Speicher gespült.' }],
})

describe('the page of a service report', () => {
  it('holds what the client sees: the order, the place, the work, the name and the setting', () => {
    expect(serviceReportPageOf(page, '  Petra Lang ', false)).toEqual({
      activity: { id: 'ac-1', title: 'Speicher entkalken' },
      place: page.place,
      durationMinutes: 45,
      notes: [{ id: 'wn-1', text: 'Speicher gespült.' }],
      clientName: 'Petra Lang',
      namesAndTimes: false,
    })
    // Whether names and times stand on it is part of what is signed.
    expect(serviceReportPageOf(page, 'Petra Lang', true)).not.toEqual(
      serviceReportPageOf(page, 'Petra Lang', false),
    )
  })
})

describe('what a service report carries', () => {
  const report = {
    clientName: 'Petra Lang',
    path: 'M10,10L200,300',
    pageFingerprint: 'a'.repeat(64),
    deviceInfo: null,
  }

  it('is the name in block letters, the drawing and the fingerprint of the page', () => {
    expect(serviceReportProblems(report)).toEqual({})
    expect(serviceReportProblems({ ...report, clientName: '   ' })).toHaveProperty('clientName')
    expect(
      serviceReportProblems({
        ...report,
        clientName: 'x'.repeat(serviceReportLimits.clientName + 1),
      }),
    ).toHaveProperty('clientName')
    // The client has no account to confirm a typed name with: the drawing is required.
    expect(serviceReportProblems({ ...report, path: null })).toHaveProperty('path')
    expect(serviceReportProblems({ ...report, path: 'Kringel' })).toHaveProperty('path')
    expect(serviceReportProblems({ ...report, pageFingerprint: 'abc' })).toHaveProperty(
      'pageFingerprint',
    )
  })
})

describe('whether a service report counts', () => {
  const report = { createdAt: new Date('2026-10-05T08:00:00Z') }
  const rejected = (at: string) => ({ decision: 'rejected' as const, createdAt: new Date(at) })
  const accepted = (at: string) => ({ decision: 'accepted' as const, createdAt: new Date(at) })

  it('is told by the rejections the server took after it', () => {
    expect(serviceReportValid(report, [])).toBe(true)
    expect(serviceReportValid(report, [rejected('2026-10-04T08:00:00Z')])).toBe(true)
    expect(serviceReportValid(report, [accepted('2026-10-06T08:00:00Z')])).toBe(true)
    expect(serviceReportValid(report, [rejected('2026-10-05T09:00:00Z')])).toBe(false)
    expect(
      serviceReportVoidedBy(report, [
        rejected('2026-10-07T08:00:00Z'),
        rejected('2026-10-06T08:00:00Z'),
      ])?.createdAt,
    ).toEqual(new Date('2026-10-06T08:00:00Z'))
    expect(serviceReportVoidedBy(report, [rejected('2026-10-04T08:00:00Z')])).toBeNull()
  })
})
