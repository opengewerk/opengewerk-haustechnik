import { describe, expect, it } from 'vitest'

import {
  type CollectiveCandidate,
  collectiveLimits,
  collectivePlanProblems,
  collectiveReportProblems,
  collectiveTitle,
  dueWithin,
  mayBecomeAPart,
  partAsksForAnswers,
  partHasItsResult,
} from './collective.js'
import type { ActivityId } from './activity.js'

/** A plan for a collective activity with nothing wrong. */
const plan = {
  dutyKind: 'brandschutz.fire_extinguisher_test',
  propertyId: 'p-1',
  buildingId: 'b-1',
  roomId: null,
  title: 'Prüfung der Feuerlöscher, Haus A',
  dutyIds: ['d-1', 'd-2'],
  responsibleUserId: 'u-lead',
  performer: 'own_staff',
  performerUserId: 'u-tech',
  contractorNote: null,
  contractorId: null,
  dueOn: '2026-10-30',
}

/** An activity under way for a duty, in whatever state the test asks for. */
function under(
  activity: Partial<NonNullable<CollectiveCandidate['activity']>> | null,
): Pick<CollectiveCandidate, 'activity'> {
  return {
    activity:
      activity === null
        ? null
        : {
            id: 'a-1' as ActivityId,
            kind: 'inspection',
            status: 'open',
            partOfOne: false,
            performer: null,
            ...activity,
          },
  }
}

describe('the plan of a collective activity', () => {
  it('has nothing wrong when it names the kind, the place, a title, its duties once and the day', () => {
    expect(collectivePlanProblems(plan)).toEqual({})
  })

  it('names a duty kind, a property, a title and at least one duty, each once and not too many', () => {
    expect(collectivePlanProblems({ ...plan, dutyKind: '' })['dutyKind']).toBe(
      'Ein Sammelvorgang hat eine Pflichtart.',
    )
    expect(collectivePlanProblems({ ...plan, propertyId: '' })['propertyId']).toBe(
      'Ein Sammelvorgang steht auf einer Liegenschaft.',
    )
    expect(collectivePlanProblems({ ...plan, title: '  ' })['title']).toBe('Der Titel fehlt.')
    expect(collectivePlanProblems({ ...plan, dutyIds: [] })['dutyIds']).toBe(
      'Ein Sammelvorgang nimmt mindestens eine Pflicht.',
    )
    expect(collectivePlanProblems({ ...plan, dutyIds: ['d-1', 'd-1'] })['dutyIds']).toBe(
      'Jede Pflicht steht einmal im Sammelvorgang.',
    )
    expect(
      collectivePlanProblems({
        ...plan,
        dutyIds: Array.from(
          { length: collectiveLimits.parts + 1 },
          (_, index) => `d-${String(index)}`,
        ),
      })['dutyIds'],
    ).toBe(`Ein Sammelvorgang nimmt höchstens ${String(collectiveLimits.parts)} Pflichten.`)
  })

  it('stands at a building or a room and not at both, and asks what any plan asks', () => {
    expect(collectivePlanProblems({ ...plan, roomId: 'r-1' })['roomId']).toBe(
      'Ein Sammelvorgang steht an einem Gebäude oder einem Raum, nicht an beidem.',
    )
    expect(collectivePlanProblems({ ...plan, dueOn: '30.10.2026' })['dueOn']).toBe(
      'Die Fälligkeit ist ein Tag, geschrieben 2026-10-03.',
    )
    expect(collectivePlanProblems({ ...plan, performer: 'contractor' })['performerUserId']).toBe(
      'Eine Person führt aus, wenn die eigenen Leute es tun.',
    )
  })

  it('is offered a title of the duty kind and the place', () => {
    expect(collectiveTitle('Prüfung von Feuerlöschern', 'Haus A')).toBe(
      'Prüfung von Feuerlöschern, Haus A',
    )
  })
})

describe('what is chosen at first', () => {
  const days = { from: '2026-10-01', to: '2026-10-31' } as const
  const today = '2026-10-17'

  it('is what falls due between the two days, what is overdue already, and what was never recorded', () => {
    expect(dueWithin('2026-10-20', days, today)).toBe(true)
    expect(dueWithin('2026-10-01', days, today)).toBe(true)
    expect(dueWithin('2026-10-31', days, today)).toBe(true)
    // Overdue before the first day, and still to be met.
    expect(dueWithin('2026-09-15', days, today)).toBe(true)
    expect(dueWithin(null, days, today)).toBe(true)
  })

  it('is not what falls due after the last day, nor before the first day while that is still to come', () => {
    expect(dueWithin('2026-11-01', days, today)).toBe(false)
    expect(dueWithin('2026-10-20', { from: '2026-10-25', to: '2026-10-31' }, today)).toBe(false)
  })
})

describe('a duty that may become a part', () => {
  it('has no activity, or an open inspection or maintenance that is no part yet', () => {
    expect(mayBecomeAPart(under(null))).toBe(true)
    expect(mayBecomeAPart(under({}))).toBe(true)
    expect(mayBecomeAPart(under({ kind: 'maintenance' }))).toBe(true)
  })

  it('stays on its own once somebody began it, once it is signed, as a work order and as a part of another', () => {
    expect(mayBecomeAPart(under({ status: 'started' }))).toBe(false)
    expect(mayBecomeAPart(under({ status: 'signed' }))).toBe(false)
    expect(mayBecomeAPart(under({ kind: 'work_order' }))).toBe(false)
    expect(mayBecomeAPart(under({ partOfOne: true }))).toBe(false)
  })
})

describe('the result of a part', () => {
  it('is there when every duty has one, and "not performed" with its reason', () => {
    expect(partHasItsResult([{ result: 'without_defects', resultReason: null }])).toBe(true)
    expect(partHasItsResult([{ result: 'not_performed', resultReason: 'Raum verschlossen' }])).toBe(
      true,
    )
    expect(partHasItsResult([{ result: 'not_performed', resultReason: '  ' }])).toBe(false)
    expect(
      partHasItsResult([
        { result: 'with_defects', resultReason: null },
        { result: null, resultReason: null },
      ]),
    ).toBe(false)
    expect(partHasItsResult([])).toBe(false)
  })

  it('asks for the answers of its protocol unless the asset could not be reached at all', () => {
    expect(partAsksForAnswers([{ result: 'without_defects', resultReason: null }])).toBe(true)
    expect(partAsksForAnswers([{ result: null, resultReason: null }])).toBe(true)
    expect(
      partAsksForAnswers([{ result: 'not_performed', resultReason: 'Raum verschlossen' }]),
    ).toBe(false)
  })
})

describe('the report for a collective activity', () => {
  const file = {
    sha256: 'a'.repeat(64),
    fileName: 'bericht.pdf',
    sizeBytes: 2048,
    previewSha256: null,
  }
  const report = {
    performedOn: '2026-10-02',
    examiner: 'Klaus Berger',
    examinerOrganisation: 'Brandschutz Beispiel GmbH',
    contractorId: null,
    file,
    parts: [
      { activityId: 'a-1', result: 'without_defects', resultReason: null, defects: [] },
      {
        activityId: 'a-2',
        result: 'with_defects',
        resultReason: null,
        defects: [{ description: 'Plombe fehlt', defectClass: null, dueOn: null }],
      },
      {
        activityId: 'a-3',
        result: 'not_performed',
        resultReason: 'Raum verschlossen',
        defects: [],
      },
    ],
  }
  const problems = (said: Readonly<Record<string, unknown>>) =>
    collectiveReportProblems(said, '2026-10-17', () => true)

  it('has nothing wrong when the file, the examiner, the day and a result for each asset are there', () => {
    expect(problems(report)).toEqual({})
  })

  it('says what the whole report lacks once, and what an asset lacks at that asset', () => {
    expect(
      problems({
        ...report,
        examiner: '',
        parts: [
          { activityId: 'a-1', result: 'with_defects', resultReason: null, defects: [] },
          { activityId: 'a-2', result: 'not_performed', resultReason: null, defects: [] },
        ],
      }),
    ).toEqual({
      examiner: 'Ein Bericht nennt den Prüfer.',
      'parts.0.defects': 'Mit Mängeln heißt, der Bericht nennt mindestens einen Mangel.',
      'parts.1.resultReason': expect.any(String),
    })
  })

  it('names each asset once and at least one', () => {
    expect(problems({ ...report, parts: [] })['parts']).toBe(
      'Der Bericht nennt ein Ergebnis für jede Anlage.',
    )
    expect(
      problems({
        ...report,
        parts: [report.parts[0], report.parts[0]],
      })['parts'],
    ).toBe('Der Bericht nennt jede Anlage einmal.')
  })
})
