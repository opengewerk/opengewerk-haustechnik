import { fileURLToPath } from 'node:url'

import { catalogueOf, reviewMarks } from '@opengewerk/haustechnik-domain'
import { describe, expect, it } from 'vitest'

import { entryChecksum, ruleChecksum, sha256 } from './checksum.js'
import { readPackageFiles } from './files.js'
import { loadCatalogue } from './load.js'

// The probe package is the material: a complete package that loads, and every
// test below changes one thing about it and expects the one finding that
// thing deserves.
const probe = readPackageFiles(fileURLToPath(new URL('../test/pakete/', import.meta.url)))
const options = { applicationVersion: '0.0.0', today: '2026-10-03' }

const assetKindFile = 'probe/anlagenarten/elevator.v1.json'
const dutyKindFile = 'probe/pflichten/elevator_main_test.v1.json'
const rulesFile = 'probe/regeln/elevator.json'
const acceptancesFile = 'probe/abnahmen.json'
const manifestFile = 'probe/manifest.json'

type Json = Readonly<Record<string, unknown>>

function contentOf(path: string): Json {
  const bytes = probe.get(path)

  if (!bytes) {
    throw new Error(`Das Probepaket hat ${path} nicht.`)
  }

  return JSON.parse(new TextDecoder().decode(bytes)) as Json
}

const assetKind = contentOf(assetKindFile)
const dutyKind = contentOf(dutyKindFile)
const rules = contentOf(rulesFile)
const acceptances = contentOf(acceptancesFile)
const [rule] = rules['records'] as readonly Json[]

function bytesOf(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`)
}

/** The probe package with some files changed: null takes one out, bytes stand as they are. */
function withFiles(changes: Readonly<Record<string, unknown>>): Map<string, Uint8Array> {
  const files = new Map(probe)

  for (const [path, value] of Object.entries(changes)) {
    if (value === null) {
      files.delete(path)
    } else {
      files.set(path, value instanceof Uint8Array ? value : bytesOf(value))
    }
  }

  return files
}

function problems(changes: Readonly<Record<string, unknown>>): readonly string[] {
  return loadCatalogue(withFiles(changes), options).problems
}

/** The reviews with one more entry or rule, everything else as it was. */
function reviewsWith(more: { entries?: readonly Json[]; rules?: readonly Json[] }): Json {
  return {
    entries: [...(acceptances['entries'] as readonly Json[]), ...(more.entries ?? [])],
    rules: [...(acceptances['rules'] as readonly Json[]), ...(more.rules ?? [])],
  }
}

describe('the probe package', () => {
  it('loads into a bundle with every key named the way it is outside its package', () => {
    const { bundle, problems: found } = loadCatalogue(probe, options)

    expect(found).toEqual([])
    expect(bundle?.packages.map((entry) => entry.name)).toEqual(['probe'])
    expect(bundle?.packages[0]?.assetKinds.map((entry) => [entry.key, entry.version])).toEqual([
      ['probe.elevator', 1],
      ['probe.water_meter', 1],
    ])
    expect(bundle?.packages[0]?.assetKinds[1]?.definition.meter).toEqual({
      medium: 'water',
      units: ['cubic_metres'],
    })
    expect(bundle?.packages[0]?.dutyKinds[0]?.definition).toMatchObject({
      interval: { kind: 'maximum', rule: 'probe.elevator_main_test_interval' },
      scope: { assetKinds: ['probe.elevator'], conditions: [], buildingKinds: [], states: [] },
    })
    expect(bundle?.packages[0]?.rules.map((entry) => entry.record.key)).toEqual([
      'probe.elevator_main_test_interval',
    ])
  })

  it('carries a checksum over its content, the same on every load', () => {
    const first = loadCatalogue(probe, options).bundle
    const second = loadCatalogue(new Map([...probe].reverse()), options).bundle

    expect(first?.sha256).toBe(
      sha256(JSON.stringify({ format: first?.format, packages: first?.packages })),
    )
    expect(second).toEqual(first)
  })

  it('has no answer for a day before its rule begins', () => {
    const { bundle } = loadCatalogue(probe, options)
    const catalogue = catalogueOf(bundle as NonNullable<typeof bundle>)
    const mainTest = catalogue.dutyKind('probe.elevator_main_test', '2026-10-03')

    expect(mainTest).not.toBeNull()
    expect(catalogue.interval(mainTest!.definition, '2026-10-03')?.record.value).toBe(24)
    expect(catalogue.interval(mainTest!.definition, '2015-05-31')).toBeNull()
    expect(catalogue.dutyKind('probe.elevator_main_test', '2015-05-31')).toBeNull()
  })

  it('marks every entry nobody has accepted, wherever it is read', () => {
    const { bundle } = loadCatalogue(probe, options)
    const catalogue = catalogueOf(bundle as NonNullable<typeof bundle>)
    const read = [
      catalogue.assetKind('probe.elevator', '2026-10-03')?.review,
      catalogue.dutyKind('probe.elevator_main_test', '2026-10-03')?.review,
      catalogue.rule('probe.elevator_main_test_interval', '2026-10-03')?.review,
    ]

    expect(read).toEqual([
      { checkedOn: '2026-10-03', accepted: null },
      { checkedOn: '2026-10-03', accepted: null },
      { checkedOn: '2026-10-03', accepted: null },
    ])
    expect(read.map((review) => reviewMarks(review!, '2026-10-03').unaccepted)).toEqual([
      true,
      true,
      true,
    ])
  })
})

describe('a duty kind', () => {
  it('without its source is not taken in', () => {
    expect(problems({ [dutyKindFile]: { ...dutyKind, source: undefined } })).toEqual([
      expect.stringMatching(
        /^probe\/pflichten\/elevator_main_test\.v1\.json, source: Die Fundstelle fehlt\./,
      ),
    ])
    expect(problems({ [dutyKindFile]: { ...dutyKind, source: '  ' } })).toEqual([
      `${dutyKindFile}, source: Hier gehört ein Text hin, der nicht leer ist.`,
    ])
  })

  it('with an interval naming a rule that does not exist is not taken in', () => {
    expect(
      problems({
        [dutyKindFile]: {
          ...dutyKind,
          interval: { kind: 'maximum', rule: 'elevator_test_interval' },
        },
      }),
    ).toEqual([
      `${dutyKindFile}: Die Frist nennt die Regel elevator_test_interval, die es nicht gibt. Eine Regel steht unter regeln/ mit Gültigkeitszeitraum und Fundstelle.`,
    ])
  })

  it('names its interval as a rule and never as a number', () => {
    expect(problems({ [dutyKindFile]: { ...dutyKind, interval: { kind: 'maximum' } } })).toEqual([
      expect.stringMatching(
        /^probe\/pflichten\/elevator_main_test\.v1\.json, interval\.rule: Die Regel fehlt\./,
      ),
    ])
    expect(
      problems({
        [dutyKindFile]: {
          ...dutyKind,
          interval: { kind: 'none', rule: 'elevator_main_test_interval' },
        },
      }),
    ).toEqual([`${dutyKindFile}, interval.rule: Eine Frist ohne Vorgabe nennt keine Regel.`])
  })

  it('counts its interval in days, months or years, and its retention in years', () => {
    expect(
      problems({
        [rulesFile]: { ...rules, records: [{ ...rule, unit: 'kilowatts' }] },
      }),
    ).toEqual([
      `${dutyKindFile}: Die Frist nennt die Regel elevator_main_test_interval, die ab 2015-06-01 in Kilowatt zählt; gezählt wird hier in Tagen, Monaten oder Jahren.`,
    ])
    expect(
      problems({
        [dutyKindFile]: {
          ...dutyKind,
          retention: { kind: 'years', rule: 'elevator_main_test_interval' },
        },
      }),
    ).toEqual([
      `${dutyKindFile}: Die Aufbewahrung nennt die Regel elevator_main_test_interval, die ab 2015-06-01 in Monaten zählt; gezählt wird hier in Jahren.`,
    ])
  })

  it('from a private standard names an interval only with the note of the legal review', () => {
    const fromAStandard = { ...dutyKind, origin: 'private_standard', bindingness: 'technical_rule' }

    expect(problems({ [dutyKindFile]: fromAStandard })).toEqual([
      expect.stringMatching(
        /interval\.legalClearance: Eine Pflichtart aus einer privaten Norm nennt eine Frist nur mit dem Vermerk/,
      ),
    ])
    expect(
      problems({
        [dutyKindFile]: { ...fromAStandard, interval: { kind: 'none' } },
      }),
    ).toEqual([])
    expect(
      problems({
        [dutyKindFile]: {
          ...fromAStandard,
          interval: {
            kind: 'guide',
            rule: 'elevator_main_test_interval',
            legalClearance: 'Rechtliche Prüfung vom 01.12.2026',
          },
        },
      }),
    ).toEqual([])
    expect(
      problems({
        [dutyKindFile]: {
          ...dutyKind,
          interval: {
            kind: 'maximum',
            rule: 'elevator_main_test_interval',
            legalClearance: 'Vermerk',
          },
        },
      }),
    ).toEqual([
      `${dutyKindFile}, interval.legalClearance: Der Vermerk der rechtlichen Prüfung gehört nur zu einer Pflichtart aus einer privaten Norm.`,
    ])
  })

  it('refers to asset kinds that exist, in its own package or by the name of another', () => {
    expect(
      problems({ [dutyKindFile]: { ...dutyKind, scope: { assetKinds: ['escalator'] } } }),
    ).toEqual([
      `${dutyKindFile}: Der Geltungsbereich nennt die Anlagenart probe.escalator, die es nicht gibt.`,
    ])
    expect(
      problems({ [dutyKindFile]: { ...dutyKind, scope: { assetKinds: ['elektro.elevator'] } } }),
    ).toEqual([
      `${dutyKindFile}: Der Geltungsbereich nennt die Anlagenart elektro.elevator aus dem Paket elektro, das es nicht gibt.`,
    ])
    expect(
      problems({ [dutyKindFile]: { ...dutyKind, scope: { assetKinds: ['probe.elevator'] } } }),
    ).toEqual([])
  })

  it('has its interval wherever it applies', () => {
    const onlyInBadenWuerttemberg = { ...rules, records: [{ ...rule, scope: 'DE-BW' }] }
    const reviewedThere = {
      entries: acceptances['entries'],
      rules: [{ ...(acceptances['rules'] as readonly Json[])[0], scope: 'DE-BW' }],
    }

    expect(
      problems({ [rulesFile]: onlyInBadenWuerttemberg, [acceptancesFile]: reviewedThere }),
    ).toEqual([
      expect.stringMatching(
        /^probe\/pflichten\/elevator_main_test\.v1\.json: Die Pflichtart gilt in Schleswig-Holstein, Hamburg, .*Thüringen, ihre Frist elevator_main_test_interval hat dort keine Regel\.$/,
      ),
    ])
    expect(
      problems({
        [rulesFile]: onlyInBadenWuerttemberg,
        [acceptancesFile]: reviewedThere,
        [dutyKindFile]: { ...dutyKind, scope: { assetKinds: ['elevator'], states: ['DE-BW'] } },
      }),
    ).toEqual([])
  })

  it('asks only about characteristics every asset kind in its scope has, in the way it has them', () => {
    const withCondition = (condition: Json) => ({
      ...dutyKind,
      scope: { assetKinds: ['elevator'], conditions: [condition] },
    })

    expect(
      problems({
        [dutyKindFile]: withCondition({ characteristic: 'firefighters_lift', is: true }),
      }),
    ).toEqual([])
    expect(
      problems({ [dutyKindFile]: withCondition({ characteristic: 'rated_load', is: true }) }),
    ).toEqual([
      expect.stringMatching(
        /Das Merkmal rated_load hat die Anlagenart probe\.elevator in Fassung 1 nicht\./,
      ),
    ])
    expect(
      problems({
        [dutyKindFile]: withCondition({
          characteristic: 'firefighters_lift',
          atLeast: 'elevator_main_test_interval',
        }),
      }),
    ).toEqual([
      `${dutyKindFile}: Das Merkmal firefighters_lift von probe.elevator in Fassung 1 ist keine Zahl.`,
    ])
    expect(
      problems({
        [dutyKindFile]: withCondition({
          characteristic: 'firefighters_lift',
          atLeast: 'x',
          is: true,
        }),
      }),
    ).toEqual([
      expect.stringMatching(/scope\.conditions\[0\]: Eine Bedingung vergleicht auf genau eine Art/),
    ])
  })

  it('compares a characteristic with a threshold that is a rule in the same unit', () => {
    const withLoad = {
      ...assetKind,
      characteristics: [
        ...(assetKind['characteristics'] as readonly Json[]),
        { key: 'rated_output', label: 'Nennleistung', kind: 'number', unit: 'kilowatts' },
      ],
    }
    const threshold = {
      key: 'large_drive',
      validFrom: '2015-06-01',
      validUntil: null,
      unit: 'kilowatts',
      value: 20,
      source: 'Eine erdachte Schwelle für den Test',
      origin: 'state_law',
    }
    const reviewed = reviewsWith({
      rules: [{ key: 'large_drive', validFrom: '2015-06-01', checkedOn: '2026-10-03' }],
    })

    expect(
      problems({
        [assetKindFile]: withLoad,
        [rulesFile]: { ...rules, records: [rule, threshold] },
        [acceptancesFile]: reviewed,
        [dutyKindFile]: {
          ...dutyKind,
          scope: {
            assetKinds: ['elevator'],
            conditions: [{ characteristic: 'rated_output', atLeast: 'large_drive' }],
          },
        },
      }),
    ).toEqual([])
    expect(
      problems({
        [assetKindFile]: withLoad,
        [rulesFile]: { ...rules, records: [rule, { ...threshold, unit: 'volts' }] },
        [acceptancesFile]: reviewed,
        [dutyKindFile]: {
          ...dutyKind,
          scope: {
            assetKinds: ['elevator'],
            conditions: [{ characteristic: 'rated_output', atLeast: 'large_drive' }],
          },
        },
      }),
    ).toEqual([
      `${dutyKindFile}: Die Bedingung nennt die Regel large_drive, die ab 2015-06-01 in Volt zählt; gezählt wird hier in Kilowatt.`,
    ])
  })

  it('names a form for its evidence that exists, and only for a protocol', () => {
    const form = { validFrom: '2015-06-01', title: 'Protokoll der Hauptprüfung', sections: [] }
    const reviewed = reviewsWith({
      entries: [{ file: 'formulare/main_test_protocol.v1.json', checkedOn: '2026-10-03' }],
    })

    expect(
      problems({
        'probe/formulare/main_test_protocol.v1.json': form,
        [acceptancesFile]: reviewed,
        [dutyKindFile]: {
          ...dutyKind,
          evidence: { kinds: ['protocol'], form: 'main_test_protocol' },
        },
      }),
    ).toEqual([])
    expect(
      problems({
        [dutyKindFile]: {
          ...dutyKind,
          evidence: { kinds: ['protocol'], form: 'main_test_protocol' },
        },
      }),
    ).toEqual([
      `${dutyKindFile}: Der Nachweis nennt das Formular probe.main_test_protocol, das es nicht gibt.`,
    ])
    expect(
      problems({
        'probe/formulare/main_test_protocol.v1.json': form,
        [acceptancesFile]: reviewed,
        [dutyKindFile]: {
          ...dutyKind,
          evidence: { kinds: ['report'], form: 'main_test_protocol' },
        },
      }),
    ).toEqual([
      `${dutyKindFile}, evidence.form: Ein Formular gehört zu einem Nachweis durch ein Protokoll; "protocol" fehlt unter den Arten.`,
    ])
  })

  it('says which field the schema does not know', () => {
    expect(problems({ [dutyKindFile]: { ...dutyKind, sorce: 'BetrSichV' } })).toEqual([
      `${dutyKindFile}, sorce: Dieses Feld gibt es hier nicht. Ein Tippfehler?`,
    ])
  })
})

describe('an asset kind', () => {
  it('is no measuring point unless it names the medium and the units of a meter', () => {
    const { bundle } = loadCatalogue(probe, options)

    expect(bundle?.packages[0]?.assetKinds[0]?.definition.meter).toBeNull()
  })

  it('that is a measuring point names its medium and the units a meter of it counts in', () => {
    const meter = { medium: 'electricity', units: ['kilowatt_hours', 'megawatt_hours'] }
    const { bundle, problems: found } = loadCatalogue(
      withFiles({ [assetKindFile]: { ...assetKind, meter } }),
      options,
    )

    expect(found).toEqual([])
    expect(bundle?.packages[0]?.assetKinds[0]?.definition.meter).toEqual(meter)
    expect(
      problems({
        [assetKindFile]: {
          ...assetKind,
          meter: { medium: 'steam', units: ['kilowatt_hours', 'kilowatt_hours', 'litres'] },
        },
      }),
    ).toEqual([
      `${assetKindFile}, meter.medium: "steam" ist keiner der Werte electricity, water, heat, district_heating, gas, cooling.`,
      `${assetKindFile}, meter.units[2]: Das ist keine der Einheiten kilowatt_hours, megawatt_hours, cubic_metres.`,
    ])
    expect(
      problems({ [assetKindFile]: { ...assetKind, meter: { medium: 'gas', units: [] } } }),
    ).toEqual([`${assetKindFile}, meter.units: Ein Zähler zählt in mindestens einer Einheit.`])
    expect(
      problems({
        [assetKindFile]: {
          ...assetKind,
          meter: { medium: 'gas', units: ['cubic_metres', 'cubic_metres'] },
        },
      }),
    ).toEqual([`${assetKindFile}, meter.units: Die Einheit cubic_metres steht zweimal da.`])
  })
})

describe('the rules', () => {
  const later = (validFrom: string, validUntil: string | null, value: number) => ({
    ...rule,
    validFrom,
    validUntil,
    value,
  })
  const reviewedFrom = (...days: readonly string[]) => ({
    entries: acceptances['entries'],
    rules: days.map((validFrom) => ({
      key: 'elevator_main_test_interval',
      validFrom,
      checkedOn: '2026-10-03',
    })),
  })

  it('leave no hole inside a run, and may end where knowledge ends', () => {
    expect(
      problems({
        [rulesFile]: {
          ...rules,
          records: [later('2015-06-01', '2026-12-31', 24), later('2027-02-01', null, 12)],
        },
        [acceptancesFile]: reviewedFrom('2015-06-01', '2027-02-01'),
      }),
    ).toEqual([
      expect.stringMatching(
        /^probe\/regeln\/elevator\.json: Zwischen 2026-12-31 und 2027-02-01 gilt keine Regel probe\.elevator_main_test_interval\./,
      ),
    ])
    expect(
      problems({
        [rulesFile]: { ...rules, records: [later('2015-06-01', '2026-12-31', 24)] },
      }),
    ).toEqual([])
  })

  it('are never in force twice on one day', () => {
    expect(
      problems({
        [rulesFile]: {
          ...rules,
          records: [later('2015-06-01', null, 24), later('2020-01-01', null, 12)],
        },
        [acceptancesFile]: reviewedFrom('2015-06-01', '2020-01-01'),
      }),
    ).toEqual([
      'regeln: Zwei Regeln zu probe.elevator_main_test_interval gelten gleichzeitig: ab 2015-06-01 und ab 2020-01-01.',
    ])
  })

  it('are whole numbers with a source, and end no sooner than they begin', () => {
    expect(
      problems({
        [rulesFile]: {
          ...rules,
          records: [{ ...rule, value: 2.5, source: undefined, validUntil: '2014-01-01' }],
        },
      }),
    ).toEqual([
      expect.stringMatching(/records\[0\]\.source: Die Fundstelle fehlt\./),
      expect.stringMatching(/records\[0\]\.value: Der Wert einer Regel ist eine ganze Zahl/),
      `${rulesFile}, records[0].validUntil: Die Regel endet vor ihrem Beginn.`,
    ])
  })
})

describe('the versions of an entry', () => {
  const second = 'probe/pflichten/elevator_main_test.v2.json'
  const third = 'probe/pflichten/elevator_main_test.v3.json'
  const reviewed = (...files: readonly string[]) =>
    reviewsWith({ entries: files.map((file) => ({ file, checkedOn: '2026-10-03' })) })

  it('count from one without a gap', () => {
    expect(
      problems({
        [third]: dutyKind,
        [acceptancesFile]: reviewed('pflichten/elevator_main_test.v3.json'),
      }),
    ).toEqual([
      'probe/pflichten/elevator_main_test: Fassung 2 fehlt. Die Fassungen zählen von 1 an ohne Lücke, und eine gemergte bleibt stehen.',
    ])
  })

  it('begin no sooner than the version before them, and a correction may begin on the same day', () => {
    expect(
      problems({
        [second]: { ...dutyKind, validFrom: '2015-01-01' },
        [acceptancesFile]: reviewed('pflichten/elevator_main_test.v2.json'),
      }),
    ).toEqual([
      `${second}: Die Fassung beginnt am 2015-01-01, vor der Fassung davor (2015-06-01). Eine spätere Fassung beginnt nie vor einer früheren.`,
    ])
    expect(
      problems({
        [second]: dutyKind,
        [acceptancesFile]: reviewed('pflichten/elevator_main_test.v2.json'),
      }),
    ).toEqual([])
  })

  it('carry a key that names one thing in the package', () => {
    expect(
      problems({
        'probe/pflichten/elevator.v1.json': dutyKind,
        [acceptancesFile]: reviewed('pflichten/elevator.v1.json'),
      }),
    ).toEqual([
      'probe/pflichten/elevator.v1.json: Den Schlüssel elevator trägt im Paket schon die Anlagenart gleichen Namens. Ein Schlüssel nennt in seinem Paket genau ein Ding.',
    ])
  })
})

describe('the reviews', () => {
  it('name for every entry and every rule when it was last checked against its source', () => {
    expect(problems({ [acceptancesFile]: { entries: [], rules: [] } })).toEqual([
      expect.stringMatching(/Für anlagenarten\/elevator\.v1\.json fehlt ein Eintrag/),
      expect.stringMatching(/Für anlagenarten\/water_meter\.v1\.json fehlt ein Eintrag/),
      expect.stringMatching(/Für pflichten\/elevator_main_test\.v1\.json fehlt ein Eintrag/),
      expect.stringMatching(
        /Für die Regel elevator_main_test_interval \(DE\) ab 2015-06-01 fehlt ein Eintrag/,
      ),
    ])
  })

  it('name nothing that is not there, and no day that has not come', () => {
    expect(
      problems({
        [acceptancesFile]: reviewsWith({
          entries: [{ file: 'pflichten/escalator.v1.json', checkedOn: '2026-10-03' }],
        }),
      }),
    ).toEqual([
      `${acceptancesFile}: Der Eintrag für pflichten/escalator.v1.json nennt keine Fassung, die es im Paket gibt.`,
    ])
    expect(
      problems({
        [acceptancesFile]: {
          entries: [
            { file: 'anlagenarten/elevator.v1.json', checkedOn: '2026-10-04' },
            ...(acceptances['entries'] as readonly Json[]).slice(1),
          ],
          rules: acceptances['rules'],
        },
      }),
    ).toEqual([
      `${acceptancesFile}: anlagenarten/elevator.v1.json ist am 2026-10-04 geprüft, einem Tag, der noch nicht war.`,
    ])
    expect(
      problems({
        [acceptancesFile]: {
          entries: [
            {
              file: 'anlagenarten/elevator.v1.json',
              checkedOn: '2026-10-03',
              accepted: {
                by: 'Eine Fachkraft',
                on: '2026-10-04',
                sha256: entryChecksum(probe.get(assetKindFile) as Uint8Array),
              },
            },
            ...(acceptances['entries'] as readonly Json[]).slice(1),
          ],
          rules: acceptances['rules'],
        },
      }),
    ).toEqual([
      `${acceptancesFile}, anlagenarten/elevator.v1.json: Die Abnahme ist auf den 2026-10-04 datiert, einen Tag, der noch nicht war.`,
    ])
  })

  it('accept an entry with the checksum of what was accepted, and no other', () => {
    const accepted = (sha: string) => ({
      entries: [
        ...(acceptances['entries'] as readonly Json[]).filter(
          (entry) => entry['file'] !== 'pflichten/elevator_main_test.v1.json',
        ),
        {
          file: 'pflichten/elevator_main_test.v1.json',
          checkedOn: '2026-10-03',
          accepted: { by: 'Eine Fachkraft', on: '2026-10-03', sha256: sha },
        },
      ],
      rules: acceptances['rules'],
    })
    const right = entryChecksum(probe.get(dutyKindFile) as Uint8Array)
    const { bundle } = loadCatalogue(withFiles({ [acceptancesFile]: accepted(right) }), options)

    expect(bundle?.packages[0]?.dutyKinds[0]?.review).toEqual({
      checkedOn: '2026-10-03',
      accepted: { by: 'Eine Fachkraft', on: '2026-10-03' },
    })
    expect(problems({ [acceptancesFile]: accepted('0'.repeat(64)) })).toEqual([
      expect.stringMatching(
        new RegExp(
          `^probe/abnahmen\\.json, pflichten/elevator_main_test\\.v1\\.json: Die Abnahme nennt die Prüfsumme 0{64}, der Eintrag hat ${right}\\.`,
        ),
      ),
    ])
  })

  it('lose the acceptance of a rule that is corrected after it was accepted', () => {
    const acceptedRule = (record: Json) => ({
      entries: acceptances['entries'],
      rules: [
        {
          key: 'elevator_main_test_interval',
          validFrom: '2015-06-01',
          checkedOn: '2026-10-03',
          accepted: {
            by: 'Eine Fachkraft',
            on: '2026-10-03',
            sha256: ruleChecksum(record as unknown as Parameters<typeof ruleChecksum>[0]),
          },
        },
      ],
    })

    expect(problems({ [acceptancesFile]: acceptedRule(rule as Json) })).toEqual([])
    expect(
      problems({
        [acceptancesFile]: acceptedRule(rule as Json),
        [rulesFile]: { ...rules, records: [{ ...rule, value: 12 }] },
      }),
    ).toEqual([
      expect.stringMatching(
        /elevator_main_test_interval \(DE\) ab 2015-06-01: Die Abnahme nennt die Prüfsumme/,
      ),
    ])
  })
})

describe('a package', () => {
  it('has a manifest naming it like its folder, and asks for no newer application than there is', () => {
    expect(problems({ [manifestFile]: null })).toEqual(['probe/manifest.json: Das Manifest fehlt.'])
    expect(
      problems({
        [manifestFile]: {
          name: 'probepaket',
          title: 'Probepaket',
          version: '1.0.0',
          minimumCore: '0.1.0',
        },
      }),
    ).toEqual([
      `${manifestFile}, name: Ein Paket heißt wie sein Ordner, hier "probe".`,
      `${manifestFile}, minimumCore: Das Paket verlangt die Anwendung ab 0.1.0, sie steht bei 0.0.0.`,
    ])
  })

  it('holds nothing but its parts, each under the name the format gives it', () => {
    expect(
      problems({
        'probe/notizen.txt': new TextEncoder().encode('Notiz'),
        'probe/pflichten/Hauptprüfung.json': dutyKind,
        'Probe/manifest.json': contentOf(manifestFile),
        'liesmich.txt': new TextEncoder().encode('Notiz'),
      }),
    ).toEqual([
      'Probe/manifest.json: Ein Paket heißt wie sein Ordner, mit kleinen Buchstaben, Ziffern und Bindestrichen.',
      'liesmich.txt: Im Ordner pakete stehen nur Pakete und die README.md.',
      'probe/notizen.txt: Die Datei gehört zu keinem Teil eines Pakets.',
      expect.stringMatching(
        /^probe\/pflichten\/Hauptprüfung\.json: Eine Fassung heißt <schlüssel>\.v<fassung>\.json/,
      ),
    ])
  })

  it('is read as UTF-8 without a BOM, and as JSON', () => {
    const text = new TextDecoder().decode(probe.get(manifestFile))

    expect(problems({ [manifestFile]: new TextEncoder().encode(`\uFEFF${text}`) })).toEqual([
      `${manifestFile}: Die Datei beginnt mit einer BOM; gespeichert wird UTF-8 ohne BOM.`,
    ])
    expect(problems({ [manifestFile]: new Uint8Array([0x7b, 0xff, 0x7d]) })).toEqual([
      `${manifestFile}: Die Datei ist kein gültiges UTF-8.`,
    ])
    expect(problems({ [manifestFile]: new TextEncoder().encode('{ "name": "probe", }') })).toEqual([
      expect.stringMatching(/^probe\/manifest\.json: Die Datei ist kein gültiges JSON: /),
    ])
  })

  it('may stand beside other packages and use their asset kinds by name', () => {
    const files = withFiles({
      'zweites/manifest.json': {
        name: 'zweites',
        title: 'Zweites Paket',
        version: '1.0.0',
        minimumCore: '0.0.0',
      },
      'zweites/pflichten/elevator_check.v1.json': {
        ...dutyKind,
        interval: { kind: 'maximum', rule: 'probe.elevator_main_test_interval' },
        scope: { assetKinds: ['probe.elevator'] },
      },
      'zweites/abnahmen.json': {
        entries: [{ file: 'pflichten/elevator_check.v1.json', checkedOn: '2026-10-03' }],
        rules: [],
      },
    })
    const { bundle, problems: found } = loadCatalogue(files, options)

    expect(found).toEqual([])
    expect(bundle?.packages.map((entry) => entry.name)).toEqual(['probe', 'zweites'])
    expect(bundle?.packages[1]?.dutyKinds[0]?.definition.scope.assetKinds).toEqual([
      'probe.elevator',
    ])
  })
})
