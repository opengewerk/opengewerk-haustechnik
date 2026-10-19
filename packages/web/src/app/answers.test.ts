import {
  type BlockField,
  type FilledAnswer,
  type GroupField,
  ruleSet,
} from '@opengewerk/haustechnik-domain'
import { today } from '@opengewerk/platform-web/format'
import { describe, expect, it } from 'vitest'

import { technicalRoom } from '../site/test-form.js'
import type { SyncClient } from '../sync/client.js'
import {
  beginActivity,
  isDemanded,
  openedBy,
  pointKey,
  pointsOf,
  pointState,
  saveAnswer,
} from './answers.js'

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

describe('beginning an activity with its first input', () => {
  /** What a device writes to begin an activity in a state, with or without its day. */
  async function begun(status: string, performedOn: string | null = null) {
    const written: unknown[] = []
    const client = {
      list: () => [{ id: 'ac-1', status, performedOn }],
      update: (entity: string, id: string, change: unknown) => {
        written.push([entity, id, change])

        return Promise.resolve({ outcome: 'applied' })
      },
    } as unknown as SyncClient

    expect(await beginActivity(client, 'ac-1')).toBeNull()

    return written
  }

  it('begins an open one on the day of the device, or keeps the day it names', async () => {
    expect(await begun('open')).toEqual([
      ['activities', 'ac-1', { status: 'started', performedOn: today() }],
    ])
    expect(await begun('open', '2026-10-08')).toEqual([
      ['activities', 'ac-1', { status: 'started' }],
    ])
  })

  it('writes nothing for one that is begun, signed or closed', async () => {
    for (const status of ['started', 'signed', 'done', 'not_performed']) {
      expect(await begun(status)).toEqual([])
    }
  })
})

describe('an answer in the block of a circuit (#350)', () => {
  const group: GroupField = {
    kind: 'group',
    key: 'circuits',
    label: 'Messen je Stromkreis',
    repeat: 'circuits',
    fields: [{ kind: 'check_point', key: 'circuit_ok', label: 'Stromkreis in Ordnung' }],
  }
  const field = group.fields[0] as BlockField
  const held: Readonly<Record<string, readonly Record<string, unknown>[]>> = {
    activities: [{ id: 'ac-1', assetId: 'as-1' }],
    distribution_boards: [
      { id: 'b-1', assetId: 'as-1', deletedAt: null },
      { id: 'b-gone', assetId: 'as-1', deletedAt: '2026-10-18T10:00:00.000Z' },
      { id: 'b-other', assetId: 'as-2', deletedAt: null },
    ],
    circuits: [
      { id: 'c-own', distributionBoardId: 'b-1', deletedAt: null },
      { id: 'c-marked', distributionBoardId: 'b-1', deletedAt: '2026-10-18T10:00:00.000Z' },
      { id: 'c-on-gone', distributionBoardId: 'b-gone', deletedAt: null },
      { id: 'c-other', distributionBoardId: 'b-other', deletedAt: null },
    ],
    activity_answers: [],
  }

  /** What saving an answer for a circuit says, and what it queued. */
  async function saved(blockKey: string) {
    const made: unknown[] = []
    const client = {
      list: (entity: string) => held[entity] ?? [],
      create: (entity: string, values: unknown) => {
        made.push([entity, values])

        return Promise.resolve({ outcome: 'applied' })
      },
    } as unknown as SyncClient
    const point = {
      key: pointKey(group.key, blockKey, field.key),
      section: { key: 'measurements', title: 'Messen', fields: [group] },
      group,
      blockKey,
      block: 1,
      field,
      assetId: null,
    }

    return { said: await saveAnswer(client, 'ac-1', point, { result: 'ok' }), made }
  }

  it('is queued for a circuit on a board of the asset of the activity', async () => {
    expect(await saved('c-own')).toEqual({
      said: null,
      made: [
        [
          'activity_answers',
          {
            activityId: 'ac-1',
            fieldKey: 'circuit_ok',
            groupKey: 'circuits',
            blockKey: 'c-own',
            result: 'ok',
          },
        ],
      ],
    })
  })

  it('is refused for a circuit of another asset, a marked one and one on a marked board', async () => {
    for (const circuit of ['c-other', 'c-marked', 'c-on-gone', 'c-unknown']) {
      expect(await saved(circuit)).toEqual({
        said: '„Messen je Stromkreis“ fragt nur nach den Stromkreisen der Anlage des Vorgangs.',
        made: [],
      })
    }
  })
})
