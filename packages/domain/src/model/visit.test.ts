import { describe, expect, it } from 'vitest'

import type { FormDefinition } from './forms.js'
import {
  briefingProblems,
  briefsAtWorkOrder,
  permitAnswersProblems,
  permitSignerName,
} from './visit.js'

const permit: FormDefinition = {
  key: 'brandschutz.hot_work_permit',
  version: 1,
  title: 'Erlaubnisschein für feuergefährliche Arbeiten',
  sections: [
    {
      key: 'work',
      title: 'Arbeiten',
      fields: [
        { kind: 'text', key: 'place', label: 'Arbeitsort', required: true },
        {
          kind: 'choice',
          key: 'combustibles',
          label: 'Brennbares entfernt',
          required: true,
          options: [
            { value: 'done', label: 'Erledigt' },
            { value: 'not_needed', label: 'Entfällt' },
          ],
        },
      ],
    },
    {
      key: 'end',
      title: 'Ausführende Person',
      fields: [
        {
          kind: 'signature',
          key: 'contractor_signature',
          label: 'Unterschrift der ausführenden Person',
          required: true,
        },
      ],
    },
  ],
}

const signed = { name: 'Marco Petri', path: 'M10,10L200,300', signedAt: '2026-10-16T06:00:00Z' }

describe('a briefing', () => {
  it('names whom and in what, with the drawing', () => {
    expect(
      briefingProblems({ personName: 'Marco Petri', subject: 'Fluchtwege', path: 'M1,1L2,2' }),
    ).toEqual({})
    expect(briefingProblems({ personName: ' ', subject: '', path: null })).toEqual({
      personName: 'Der Name der eingewiesenen Person in Druckschrift fehlt.',
      subject: 'Worin die Person eingewiesen wurde, fehlt.',
      path: 'Es fehlt die Unterschrift der eingewiesenen Person im Feld.',
    })
    expect(briefingProblems({ subject: 'x'.repeat(2001) })['subject']).toBe(
      'Worin die Person eingewiesen wurde, hat höchstens 2000 Zeichen.',
    )
  })

  it('is taken by whoever leads the order or plans and hands out work', () => {
    const order = { responsibleUserId: 'u-tech' }

    expect(briefsAtWorkOrder(order, 'u-tech', ['activity.perform'])).toBe(true)
    expect(briefsAtWorkOrder(order, 'u-site', ['activity.perform', 'activity.write'])).toBe(true)
    expect(briefsAtWorkOrder(order, 'u-other', ['activity.perform'])).toBe(false)
    expect(briefsAtWorkOrder({ responsibleUserId: null }, 'u-tech', ['activity.perform'])).toBe(
      false,
    )
  })
})

describe('a permit for hot work', () => {
  it('is issued with every field its form asks for, the signature of whoever carries the work out among them', () => {
    const answers = { place: 'Heizraum', combustibles: 'done', contractor_signature: signed }

    expect(permitAnswersProblems(permit, answers)).toEqual([])
    expect(permitAnswersProblems(permit, { place: 'Heizraum', combustibles: 'done' })).toEqual([
      'Unterschrift der ausführenden Person fehlt.',
    ])
    expect(permitAnswersProblems(permit, { ...answers, combustibles: 'maybe' })).toEqual([
      'Brennbares entfernt: eine der angebotenen Möglichkeiten.',
    ])
    expect(permitAnswersProblems(permit, 'kein Formular')).toHaveLength(1)
    expect(permitSignerName(permit, answers)).toBe('Marco Petri')
  })
})
