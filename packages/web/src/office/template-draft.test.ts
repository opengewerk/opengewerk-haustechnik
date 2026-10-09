import type { TemplateDefinition, TemplateField } from '@opengewerk/haustechnik-domain'
import { describe, expect, it } from 'vitest'

import {
  moveChapter,
  movePoint,
  newPoint,
  nextKey,
  placeChapter,
  placePoint,
  pointDetail,
  withoutChapter,
  withPoint,
} from './template-draft.js'

/**
 * The draft of a template in the editor (#112): where a point goes when it
 * is moved, by the keyboard a place at a time and by the pointer to a place,
 * and what a point says under its label.
 */

const point = (key: string): TemplateField => ({ kind: 'check_point', key, label: key })

const draft: TemplateDefinition = {
  title: 'Technikzentrale',
  sections: [
    { key: 'k1', title: 'Heizraum', fields: [point('p1'), point('p2'), point('p3')] },
    { key: 'k2', title: 'Unterverteilung', fields: [point('p4')] },
  ],
}

/** The keys of the points, chapter by chapter. */
function order(definition: TemplateDefinition): string[][] {
  return definition.sections.map((section) => section.fields.map((field) => field.key))
}

describe('moving a point a place at a time', () => {
  it('moves it within its chapter', () => {
    expect(order(movePoint(draft, 'p2', -1))).toEqual([['p2', 'p1', 'p3'], ['p4']])
    expect(order(movePoint(draft, 'p2', 1))).toEqual([['p1', 'p3', 'p2'], ['p4']])
  })

  it('crosses into the chapter next to it at the edge of its own', () => {
    expect(order(movePoint(draft, 'p3', 1))).toEqual([
      ['p1', 'p2'],
      ['p3', 'p4'],
    ])
    expect(order(movePoint(draft, 'p4', -1))).toEqual([['p1', 'p2', 'p3', 'p4'], []])
  })

  it('stays at the edge of the template', () => {
    expect(movePoint(draft, 'p1', -1)).toBe(draft)
    expect(movePoint(draft, 'p4', 1)).toBe(draft)
  })
})

describe('dropping a point at a place', () => {
  it('takes it from where it stood and puts it there, in another chapter as well', () => {
    expect(order(placePoint(draft, point('p1'), { chapter: 'k2', index: 0 }))).toEqual([
      ['p2', 'p3'],
      ['p1', 'p4'],
    ])
    expect(order(placePoint(draft, point('p3'), { chapter: 'k1', index: 0 }))).toEqual([
      ['p3', 'p1', 'p2'],
      ['p4'],
    ])
  })

  it('changes a point in place, and puts it at the end of the chapter it was given', () => {
    const renamed = { ...point('p2'), label: 'Tür' }

    expect(withPoint(draft, renamed, 'k1').sections[0]?.fields[1]).toEqual(renamed)
    expect(order(withPoint(draft, renamed, 'k2'))).toEqual([
      ['p1', 'p3'],
      ['p4', 'p2'],
    ])
  })
})

describe('moving a chapter', () => {
  it('moves it among the chapters, with its points', () => {
    expect(order(moveChapter(draft, 'k2', -1))).toEqual([['p4'], ['p1', 'p2', 'p3']])
    expect(order(placeChapter(draft, 'k1', 1))).toEqual([['p4'], ['p1', 'p2', 'p3']])
    expect(moveChapter(draft, 'k1', -1).sections.map((section) => section.key)).toEqual([
      'k1',
      'k2',
    ])
  })

  it('takes its points along when it is removed', () => {
    expect(order(withoutChapter(draft, 'k1'))).toEqual([['p4']])
  })
})

describe('a new point and a new chapter', () => {
  it('takes a key no point and no chapter has', () => {
    expect(nextKey(draft, 'p')).toBe('p5')
    expect(nextKey(draft, 'k')).toBe('k3')
  })

  it('starts a remark as a text of several lines, and a measured value as required', () => {
    expect(newPoint('remark', 'p9', 'Sonst')).toEqual({
      kind: 'text',
      key: 'p9',
      label: 'Sonst',
      multiline: true,
    })
    expect(newPoint('measurement', 'p9')).toMatchObject({ required: true, decimals: 1 })
  })
})

describe('what a point says under its label', () => {
  it('names the unit and a limit the operator states, with its source', () => {
    expect(
      pointDetail(
        {
          kind: 'measurement',
          key: 'p1',
          label: 'Temperatur',
          unit: 'degrees_celsius',
          decimals: 1,
          limit: { kind: 'stated', bound: 'at_least', milli: 60_000, source: 'DVGW W 551' },
        } as TemplateField,
        null,
        '2026-10-09',
      ),
    ).toBe('in °C, Grenzwert mindestens 60,0 °C, DVGW W 551')
  })
})
