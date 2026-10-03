import { describe, expect, it } from 'vitest'

import {
  activityDutyProblems,
  activityKindLabel,
  activityKinds,
  activityLimits,
  activityProblems,
  activityStatusLabel,
  activityStatuses,
  workOrderKindLabel,
  workOrderKinds,
  workOrderProblems,
} from './activity.js'

describe('an activity', () => {
  it('is one of four kinds, each with its name', () => {
    expect(activityKinds).toEqual(['round', 'inspection', 'maintenance', 'work_order'])
    expect(activityKinds.map((kind) => activityKindLabel[kind])).toEqual([
      'Rundgang',
      'Prüfung',
      'Wartung',
      'Arbeitsauftrag',
    ])
    expect(activityProblems({ kind: 'repair' })).toEqual({
      kind: 'Ein Vorgang ist einer von: Rundgang, Prüfung, Wartung, Arbeitsauftrag.',
    })
  })

  it('stands open, begun, signed, done or not performed', () => {
    expect(activityStatuses.map((status) => activityStatusLabel[status])).toEqual([
      'Offen',
      'Begonnen',
      'Unterschrieben',
      'Erledigt',
      'Nicht durchgeführt',
    ])
    expect(activityProblems({ status: 'cancelled' })).toEqual({
      status:
        'Der Stand ist einer von: Offen, Begonnen, Unterschrieben, Erledigt, Nicht durchgeführt.',
    })
  })

  it('has its name, and the texts it may leave empty stay within their bounds', () => {
    expect(activityProblems({ title: '  ' })).toEqual({ title: 'Die Bezeichnung fehlt.' })
    expect(activityProblems({ title: 'x'.repeat(activityLimits.title + 1) })).toEqual({
      title: 'Die Bezeichnung hat höchstens 200 Zeichen.',
    })
    expect(
      activityProblems({ contractorNote: 'x'.repeat(activityLimits.contractorNote + 1) }),
    ).toEqual({ contractorNote: 'Die Angabe zur Fremdfirma hat höchstens 200 Zeichen.' })
    expect(activityProblems({ title: 'Hauptprüfung Aufzug Haus A', contractorNote: null })).toEqual(
      {},
    )
  })

  it('is due on a day of the calendar', () => {
    expect(activityProblems({ dueOn: '2026-02-30' })).toEqual({
      dueOn: 'Die Fälligkeit ist ein Tag, geschrieben 2026-10-03.',
    })
    expect(activityProblems({ dueOn: '2026-10-03' })).toEqual({})
    expect(activityProblems({ dueOn: null })).toEqual({})
  })

  it('names the reason it was not performed, and only then a reason', () => {
    expect(activityProblems({ status: 'not_performed' })).toEqual({
      closingReason: 'Ein Vorgang, der nicht durchgeführt wurde, nennt den Grund.',
    })
    expect(activityProblems({ status: 'not_performed', closingReason: ' ' })).toEqual({
      closingReason: 'Ein Vorgang, der nicht durchgeführt wurde, nennt den Grund.',
    })
    expect(
      activityProblems({ status: 'not_performed', closingReason: 'Anlage war abgeschaltet.' }),
    ).toEqual({})
    expect(activityProblems({ status: 'done', closingReason: 'Anlage war abgeschaltet.' })).toEqual(
      { closingReason: 'Einen Grund nennt nur ein Vorgang, der nicht durchgeführt wurde.' },
    )
    // A change of the reason alone is asked about together with the row.
    expect(activityProblems({ closingReason: 'Anlage war abgeschaltet.' })).toEqual({})
    // A reason that is too long says so, and not that it is missing.
    expect(
      activityProblems({
        status: 'not_performed',
        closingReason: 'x'.repeat(activityLimits.closingReason + 1),
      }),
    ).toEqual({ closingReason: 'Der Grund hat höchstens 500 Zeichen.' })
  })
})

describe('the result of a duty of an activity', () => {
  it('is one of four, and names the reason of "not performed" and only then', () => {
    expect(activityDutyProblems({ result: 'passed' })).toEqual({
      result:
        'Das Ergebnis ist eines von: Ohne Mangel, Mit Mängeln, Nicht bestanden, Nicht durchgeführt.',
    })
    expect(activityDutyProblems({ result: 'not_performed' })).toEqual({
      resultReason: 'Was nicht durchgeführt wurde, nennt den Grund.',
    })
    expect(activityDutyProblems({ result: 'failed', resultReason: 'Anlage war aus.' })).toEqual({
      resultReason: 'Einen Grund nennt nur, was nicht durchgeführt wurde.',
    })
    expect(
      activityDutyProblems({ result: 'not_performed', resultReason: 'Anlage war aus.' }),
    ).toEqual({})
    expect(activityDutyProblems({ result: null, resultReason: null })).toEqual({})
  })

  it('belongs to an activity performed on a day of the calendar', () => {
    expect(activityProblems({ performedOn: '2026-13-01' })).toEqual({
      performedOn: 'Der Tag der Durchführung ist ein Tag, geschrieben 2026-10-03.',
    })
    expect(activityProblems({ performedOn: '2026-10-01' })).toEqual({})
  })
})

describe('a work order', () => {
  it('is one of the kinds of section 4.8', () => {
    expect(workOrderKinds.map((kind) => workOrderKindLabel[kind])).toEqual([
      'Störung',
      'Mangelbeseitigung',
      'Wartung',
      'Prüfung',
      'Sonstiger Auftrag',
    ])
    expect(workOrderProblems({ kind: 'defect_remedy' })).toEqual({})
    expect(workOrderProblems({ kind: 'repair' })).toEqual({
      kind: 'Ein Auftrag ist einer von: Störung, Mangelbeseitigung, Wartung, Prüfung, Sonstiger Auftrag.',
    })
  })
})
