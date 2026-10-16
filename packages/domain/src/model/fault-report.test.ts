import { describe, expect, it } from 'vitest'

import {
  faultCategoryProblems,
  faultPlaceLine,
  faultRejectionProblems,
  faultReportProblems,
  faultReportState,
  mergeProblem,
  proposedFaultCategories,
} from './fault-report.js'

/** The parts of a report its state is read from: none of the three ways on taken. */
const received = { workOrderId: null, rejectedAt: null, mergedIntoId: null }

describe('the state of a fault report', () => {
  it('is received until somebody decides, and again once its order is not performed', () => {
    expect(faultReportState(received, null)).toBe('received')
    expect(faultReportState({ ...received, workOrderId: 'o' as never }, 'not_performed')).toBe(
      'received',
    )
  })

  it('is accepted while its order goes on and done with the signature under it (decided 15.10.2026)', () => {
    const accepted = { ...received, workOrderId: 'o' as never }

    expect(faultReportState(accepted, 'open')).toBe('accepted')
    expect(faultReportState(accepted, 'started')).toBe('accepted')
    expect(faultReportState(accepted, 'signed')).toBe('done')
    expect(faultReportState(accepted, 'done')).toBe('done')
  })

  it('is rejected or merged by itself, whatever an order says', () => {
    expect(faultReportState({ ...received, rejectedAt: '2026-10-16T08:00:00Z' }, null)).toBe(
      'rejected',
    )
    expect(faultReportState({ ...received, mergedIntoId: 'r' as never }, 'signed')).toBe('merged')
  })
})

describe('a new fault report', () => {
  it('needs a category, a description and exactly one of a building, a room or an asset', () => {
    expect(faultReportProblems({ categoryId: 'c', description: 'Kalt.', roomId: 'r' })).toEqual({})
    expect(faultReportProblems({ categoryId: 'c', description: ' ', buildingId: 'b' })).toEqual({
      description: 'Die Beschreibung fehlt.',
    })
    expect(faultReportProblems({ description: 'Kalt.', assetId: 'a' })).toEqual({
      categoryId: 'Die Kategorie fehlt.',
    })

    const place = 'Eine Störung hängt an genau einem: einem Gebäude, einem Raum oder einer Anlage.'

    expect(faultReportProblems({ categoryId: 'c', description: 'Kalt.' })).toEqual({ place })
    expect(
      faultReportProblems({ categoryId: 'c', description: 'Kalt.', roomId: 'r', assetId: 'a' }),
    ).toEqual({ place })
  })

  it('is rejected only with a reason, and a category only with a name', () => {
    expect(faultRejectionProblems({})).toEqual({ reason: 'Der Grund fehlt.' })
    expect(faultRejectionProblems({ reason: 'Bauunterhalt der Stadt.' })).toEqual({})
    expect(faultCategoryProblems({ name: '' })).toEqual({ name: 'Der Name fehlt.' })
    expect(faultCategoryProblems({ name: 'x'.repeat(81) })).toEqual({
      name: 'Der Name hat höchstens 80 Zeichen.',
    })
  })
})

describe('merging a report into another', () => {
  const at = (
    id: string,
    state: Parameters<typeof mergeProblem>[0]['state'],
    buildingOf = 'b',
  ) => ({
    id,
    state,
    buildingOf,
  })

  it('takes a report from the inbox into one of the same building that is received or accepted', () => {
    expect(mergeProblem(at('one', 'received'), at('two', 'received'))).toBeNull()
    expect(mergeProblem(at('one', 'received'), at('two', 'accepted'))).toBeNull()
  })

  it('refuses everything else with its sentence', () => {
    expect(mergeProblem(at('one', 'accepted'), at('two', 'received'))).toBe(
      'Zusammenführen lässt sich nur eine Meldung, die noch im Eingang steht.',
    )
    expect(mergeProblem(at('one', 'received'), at('one', 'received'))).toBe(
      'Eine Meldung lässt sich nicht mit sich selbst zusammenführen.',
    )

    for (const state of ['done', 'rejected', 'merged'] as const) {
      expect(mergeProblem(at('one', 'received'), at('two', state))).toBe(
        'Zusammengeführt wird mit einer Meldung, die weder erledigt noch abgelehnt ist.',
      )
    }

    expect(mergeProblem(at('one', 'received'), at('two', 'received', 'c'))).toBe(
      'Zusammengeführt wird nur mit einer Meldung aus demselben Gebäude.',
    )
  })
})

describe('the words of a fault report', () => {
  it('proposes the six categories decided on 15.10.2026', () => {
    expect(proposedFaultCategories).toEqual([
      'Elektro',
      'Heizung und Lüftung',
      'Sanitär',
      'Aufzug',
      'Türen und Schlösser',
      'Sonstiges',
    ])
  })

  it('says a place as its building and its room', () => {
    expect(
      faultPlaceLine({ property: 'P', building: 'Schulhaus', room: '2.05 Lehrerzimmer' }),
    ).toBe('Schulhaus, 2.05 Lehrerzimmer')
    expect(faultPlaceLine({ property: 'P', building: 'Schulhaus', room: null })).toBe('Schulhaus')
  })
})
