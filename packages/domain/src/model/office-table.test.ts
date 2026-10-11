import type { IsoDate } from '@opengewerk/platform-domain'
import { describe, expect, it } from 'vitest'

import type { AssetEntry } from './asset-condition.js'
import type { DutyProposal } from './duty-proposal.js'
import type { DutyEntry } from './duty-register.js'
import type { MeterEntry } from './meter-register.js'
import {
  addressWords,
  assetTableRow,
  byUrgency,
  conditionWords,
  dayInWords,
  dismissedTableRows,
  dutyTableHeads,
  dutyTableRow,
  meterTableRows,
  type PlaceNames,
  placeWords,
  propertySearchText,
  proposalTableRows,
  searchedFor,
} from './office-table.js'
import type { PlaceToDo } from './overview.js'

// The ids are plain text here: nothing in these words reads them.
const entry = {
  id: 'a-1',
  propertyId: 'p-1',
  buildingId: 'b-1',
  roomId: null,
  parentAssetId: null,
  kind: 'fire_extinguisher',
  number: 'AN-00031',
  name: 'Feuerlöscher EG, Flur',
  condition: 'in_order',
  until: '2028-09-24',
  lifecycleState: 'in_service',
} as AssetEntry

describe('the words of a list of the office', () => {
  it('write a day as the office does', () => {
    expect(dayInWords('2028-09-24')).toBe('24.09.2028')
  })

  it('say the condition of an asset, and for one in order until when', () => {
    expect(conditionWords({ condition: 'in_order', until: '2028-09-24' })).toBe(
      'In Ordnung bis 24.09.2028',
    )
    expect(conditionWords({ condition: 'in_order', until: null })).toBe('In Ordnung')
    expect(conditionWords({ condition: 'never_checked', until: null })).toBe('Nie geprüft')
  })

  it('name a place by the parts it has', () => {
    expect(placeWords(['Werkhof Nord', 'Halle 1', null, ''])).toBe('Werkhof Nord, Halle 1')
  })
})

describe('an asset as a row of the table of the register', () => {
  it('holds what the columns of the list show', () => {
    expect(assetTableRow(entry, 'Feuerlöscher', 'Verwaltung, Haus A')).toEqual([
      'AN-00031',
      'Feuerlöscher EG, Flur',
      'Feuerlöscher',
      'Verwaltung, Haus A',
      'In Ordnung bis 24.09.2028',
      'In Betrieb',
    ])
  })

  it('leaves the life cycle empty for an asset without an entry in it', () => {
    expect(assetTableRow({ ...entry, lifecycleState: null }, 'Feuerlöscher', '')[5]).toBeNull()
  })
})

describe('the properties as a list', () => {
  const quiet: PlaceToDo = {
    overdue: 0,
    due: 0,
    neverRecorded: 0,
    openDefects: 0,
    missingReadings: 0,
  }

  it('come in the order of urgency: more overdue first, then more never recorded', () => {
    expect(byUrgency({ ...quiet, overdue: 1 }, { ...quiet, overdue: 2 })).toBeGreaterThan(0)
    expect(byUrgency({ ...quiet, neverRecorded: 3 }, { ...quiet, due: 9 })).toBeLessThan(0)
    expect(byUrgency(undefined, quiet)).toBe(0)
  })

  it('are found by their name, their address and the names of their buildings', () => {
    const property = { name: 'Rathaus', street: 'Marktplatz 1', postalCode: '00001', city: 'Süd' }

    expect(addressWords(property)).toBe('Marktplatz 1, 00001 Süd')
    expect(propertySearchText(property, ['Altbau']).includes(searchedFor(' ALTBAU '))).toBe(true)
    expect(propertySearchText(property, []).includes(searchedFor('süd'))).toBe(true)
  })
})

describe('a duty as a row of the table of the register (#236)', () => {
  const duty = {
    id: 'd-1',
    propertyId: 'p-1',
    buildingId: null,
    roomId: null,
    assetId: 'a-1',
    kind: null,
    kindVersion: null,
    label: 'Türen im Fluchtweg prüfen',
    basis: 'own_decision',
    sourceNote: 'Hausordnung',
    task: 'inspection',
    counting: 'from_performance',
    intervalDays: null,
    intervalMonths: 6,
    intervalReason: null,
    endsOn: null,
    title: 'Türen im Fluchtweg prüfen',
    state: 'met',
    appointment: { dueOn: '2027-03-12', onTimeUntil: '2027-03-12' },
    lastMetOn: '2026-09-12',
    lastEvidence: { id: 'e-1', number: 'NW-2026-00041', performedOn: '2026-09-12', origin: 'own' },
    responsibleUserId: 'u-1',
    responsible: { userId: 'u-1', name: 'Dennis Roth' },
    performer: 'contractor',
    performerNote: 'Türendienst Beispiel GmbH',
    ended: false,
    intervalToCheck: false,
    asset: null,
  } as unknown as DutyEntry

  it('heads its columns with who answers only where it names people', () => {
    expect(dutyTableHeads(true)).toEqual([
      'Anlage oder Ort',
      'Pflicht',
      'Grundlage',
      'Frist',
      'Art der Frist',
      'Frist prüfen',
      'Zuständig',
      'Ausführung',
      'Letzter Nachweis',
      'Nachweis vom',
      'Nächster Termin',
      'Zustand',
    ])
    expect(dutyTableHeads(false)).toEqual(
      dutyTableHeads(true).filter((head) => head !== 'Zuständig'),
    )
  })

  it('holds what the register shows, a day as a day, and the person only where it names people', () => {
    const named = dutyTableRow(duty, 'AN-00031 Tür, Schule', null, true)

    expect(named).toEqual([
      'AN-00031 Tür, Schule',
      'Türen im Fluchtweg prüfen',
      'Eigene Festlegung, Hausordnung',
      '6 Monate',
      'Eigene Pflicht',
      null,
      'Dennis Roth',
      'Türendienst Beispiel GmbH',
      'NW-2026-00041',
      { day: '2026-09-12' },
      { day: '2027-03-12' },
      'Erfüllt bis 12.03.2027',
    ])
    expect(dutyTableRow(duty, 'Ort', null, false)).toEqual(
      named.filter((cell) => cell !== 'Dennis Roth').map((cell, at) => (at === 0 ? 'Ort' : cell)),
    )
  })

  it('says "Frist prüfen" in a column of its own where the duty says it (#74)', () => {
    const column = dutyTableHeads(false).indexOf('Frist prüfen')

    expect(dutyTableRow({ ...duty, intervalToCheck: true }, 'Ort', null, false)[column]).toBe(
      'Frist prüfen',
    )
    expect(dutyTableRow(duty, 'Ort', null, false)[column]).toBeNull()
  })

  it('names nobody where nobody answers, an evidence taken over by its day alone, and no day for one that has ended', () => {
    const row = dutyTableRow(
      {
        ...duty,
        responsible: null,
        ended: true,
        endsOn: '2026-09-05' as IsoDate,
        lastEvidence: { ...duty.lastEvidence, origin: 'legacy' } as DutyEntry['lastEvidence'],
      },
      'Ort',
      null,
      true,
    )

    expect(row.slice(6)).toEqual([
      'Niemand benannt',
      'Türendienst Beispiel GmbH',
      'Altbestand',
      { day: '2026-09-12' },
      null,
      'Beendet seit 05.09.2026',
    ])
  })
})

describe('the meters as the rows of their table (#236)', () => {
  const meter = (assetId: string, name: string, mainMeterId: string | null): MeterEntry =>
    ({
      assetId,
      propertyId: 'p-1',
      buildingId: 'b-1',
      roomId: 'r-1',
      number: null,
      mark: null,
      name,
      medium: 'water',
      unit: 'cubic_metres',
      meterNumber: `Z-${assetId}`,
      mainMeterId,
      lastReading: null,
      state: 'missing',
    }) as unknown as MeterEntry
  const names: PlaceNames = {
    property: () => 'Schule',
    building: () => 'Haus A',
    room: () => ({ number: 'K.03', name: 'Keller', buildingId: 'b-1' }),
  }

  it('put a sub meter under its main meter and name the main meter beside it', () => {
    const rows = meterTableRows(
      [meter('m-2', 'Küche', 'm-1'), meter('m-3', 'Halle', null), meter('m-1', 'Haupt', null)],
      names,
    )

    expect(rows.map((row) => [row[0], row[1]])).toEqual([
      ['Halle', null],
      ['Haupt', null],
      ['Küche', 'Haupt'],
    ])
    expect(rows[0]?.[2]).toBe('Schule, Haus A, K.03')
  })

  it('leave the place empty for whoever does not read places, and write a reading as a number', () => {
    const read = {
      ...meter('m-1', 'Haupt', null),
      lastReading: { keyDate: '2026-10-01', readOn: '2026-10-02', valueMilli: 4_812_500 },
      state: 'present',
    } as MeterEntry

    expect(meterTableRows([read], null)[0]).toEqual([
      'Haupt',
      null,
      null,
      'Wasser',
      'm³',
      'Z-m-1',
      4812.5,
      { day: '2026-10-02' },
      'liegt vor',
    ])
  })
})

describe('the proposals as the rows of their table (#236)', () => {
  const asset = (id: string, name: string) =>
    ({
      id,
      number: `AN-${id}`,
      name,
      kind: 'probe.elevator',
      propertyId: 'p-1',
      buildingId: 'b-1',
      roomId: null,
      enteredOn: '2026-08-01',
    }) as unknown as DutyProposal['asset']
  const catalogue = {
    dutyKinds: () => [{ key: 'probe.second' }, { key: 'probe.first' }],
    dutyKind: (kind: string) =>
      kind === 'probe.first' ? { definition: { label: 'Erste Prüfung' } } : null,
    packages: [{ name: 'probe', title: 'Probepaket', version: '1' }],
  } as unknown as Parameters<typeof proposalTableRows>[1]
  const names: PlaceNames = {
    property: () => 'Schule',
    building: () => 'Haus A',
    room: () => null,
  }

  it('come by duty kind in the order of the catalogue, a kind it does not know last', () => {
    const rows = proposalTableRows(
      [
        { kind: 'fremd.check', asset: asset('1', 'Aufzug') },
        { kind: 'probe.first', asset: asset('1', 'Aufzug') },
        { kind: 'probe.second', asset: asset('2', 'Tor') },
        { kind: 'probe.first', asset: asset('2', 'Tor') },
      ],
      catalogue,
      '2026-10-11' as IsoDate,
      { assets: true, names },
    )

    expect(rows).toEqual([
      ['probe.second', 'Probepaket', 'AN-2 Tor', 'Schule, Haus A', { day: '2026-08-01' }],
      ['Erste Prüfung', 'Probepaket', 'AN-1 Aufzug', 'Schule, Haus A', { day: '2026-08-01' }],
      ['Erste Prüfung', 'Probepaket', 'AN-2 Tor', 'Schule, Haus A', { day: '2026-08-01' }],
      ['fremd.check', null, 'AN-1 Aufzug', 'Schule, Haus A', { day: '2026-08-01' }],
    ])
  })

  it('name an asset by its kind and no place for whoever reads neither', () => {
    expect(
      dismissedTableRows(
        [
          {
            id: 'x-1',
            kind: 'probe.first',
            kindVersion: 1,
            reason: 'Entfällt.',
            dismissedOn: '2026-09-30',
            asset: asset('1', 'Aufzug'),
          } as unknown as Parameters<typeof dismissedTableRows>[0][number],
        ],
        catalogue,
        '2026-10-11' as IsoDate,
        { assets: false, names: null },
      ),
    ).toEqual([['Anlage', null, 'Erste Prüfung', 'Probepaket', 'Entfällt.', { day: '2026-09-30' }]])
  })
})
