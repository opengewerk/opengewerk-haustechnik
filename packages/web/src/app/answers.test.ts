import { type FilledAnswer, ruleSet } from '@opengewerk/haustechnik-domain'
import { describe, expect, it } from 'vitest'

import { technicalRoom } from '../site/test-form.js'
import { isDemanded, openedBy, pointKey, pointsOf, pointState } from './answers.js'

/**
 * The points of a form as the device lists them, and what each says of its
 * answer (#107).
 */

const definition = { key: 'probe.technical_room', version: 1, ...technicalRoom }

const empty = {
  groupKey: null,
  blockKey: null,
  value: null,
  result: null,
  remark: null,
  attachmentId: null,
}

function answer(fields: Partial<FilledAnswer> & Pick<FilledAnswer, 'fieldKey'>): FilledAnswer {
  return { ...empty, ...fields }
}

const context = {
  rules: ruleSet([
    {
      key: 'probe.hot_water_minimum',
      validFrom: '2015-06-01',
      validUntil: null,
      unit: 'decidegrees_celsius',
      value: 600,
      source: 'DVGW-Arbeitsblatt W 551',
    },
  ]),
  on: '2026-10-09' as const,
}

describe('the points of a form', () => {
  it('stand in the order of the form, without the signature', () => {
    expect(pointsOf(definition, []).map((point) => point.key)).toEqual([
      'outlet',
      'door_closes',
      'heat_meter',
      'refilled',
      'burner',
      'log_book',
      'displays',
      'noticed',
    ])
  })

  it('take the blocks of a group in the order of their keys, one opened here among them', () => {
    const answers = [
      answer({ groupKey: 'lights', blockKey: '0192-b', fieldKey: 'lights_up', result: 'ok' }),
      answer({ groupKey: 'lights', blockKey: '0192-a', fieldKey: 'lights_up', result: 'not_ok' }),
    ]
    const opened = openedBy(pointKey('lights', '0193-c', 'lights_up'))
    const points = pointsOf(definition, answers, opened === null ? [] : [opened])

    expect(points.slice(-3).map((point) => [point.blockKey, point.block])).toEqual([
      ['0192-a', 1],
      ['0192-b', 2],
      ['0193-c', 3],
    ])
    expect(points.at(-1)?.key).toBe('lights.0193-c.lights_up')
  })

  it('demand every check point and the fields the form requires', () => {
    expect(
      pointsOf(definition, [])
        .filter(isDemanded)
        .map((point) => point.key),
    ).toEqual(['outlet', 'door_closes', 'heat_meter'])
  })
})

describe('what a point says of its answer', () => {
  const [outlet, door, meter, , burner, logBook, , noticed] = pointsOf(definition, [])

  it('is open without one, and a remark alone is none', () => {
    expect(pointState(door!, undefined, context)).toEqual({ kind: 'open' })
    expect(
      pointState(door!, answer({ fieldKey: 'door_closes', remark: 'Hängt.' }), context),
    ).toEqual({ kind: 'open' })
  })

  it('names the answer to a check point, and a value with its unit', () => {
    expect(
      pointState(door!, answer({ fieldKey: 'door_closes', result: 'not_possible' }), context),
    ).toEqual({ kind: 'result', result: 'not_possible' })
    expect(
      pointState(meter!, answer({ fieldKey: 'heat_meter', value: '1284360' }), context),
    ).toEqual({
      kind: 'value',
      text: '1.284,36 MWh',
    })
    expect(
      pointState(burner!, answer({ fieldKey: 'burner', value: '"standby"' }), context),
    ).toEqual({
      kind: 'value',
      text: 'Bereitschaft',
    })
    expect(pointState(logBook!, answer({ fieldKey: 'log_book', value: 'false' }), context)).toEqual(
      {
        kind: 'value',
        text: 'nein',
      },
    )
    expect(
      pointState(noticed!, answer({ fieldKey: 'noticed', value: '"Tropft."' }), context),
    ).toEqual({
      kind: 'value',
      text: 'eingetragen',
    })
  })

  it('marks a measured value outside its limit', () => {
    expect(pointState(outlet!, answer({ fieldKey: 'outlet', value: '61000' }), context)).toEqual({
      kind: 'value',
      text: '61,0 °C',
      outside: false,
    })
    expect(pointState(outlet!, answer({ fieldKey: 'outlet', value: '55500' }), context)).toEqual({
      kind: 'value',
      text: '55,5 °C',
      outside: true,
    })
  })
})
