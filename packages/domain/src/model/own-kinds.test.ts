import { describe, expect, it } from 'vitest'

import { assetValueProblems } from './asset.js'
import { type AssetKind, type CatalogueBundle, catalogueFormat, catalogueOf } from './catalogue.js'
import {
  expectedDocumentsProblem,
  freeKey,
  type OwnAssetField,
  type OwnAssetKind,
  ownCatalogueOf,
  ownFieldProblems,
  ownIsEmpty,
  ownKeyStem,
  ownKindProblems,
  withOwn,
} from './own-kinds.js'

/**
 * The asset kinds and fields of an operator's own (#62): how they stand in
 * the catalogue beside the packages, and what each of them may say.
 */

const elevator: AssetKind = {
  label: 'Aufzugsanlage',
  costGroup: '461',
  characteristics: [],
  fields: [{ key: 'stops', label: 'Haltestellen', kind: 'number' }],
  expectedDocuments: [],
  meter: null,
}

const bundle: CatalogueBundle = {
  format: catalogueFormat,
  sha256: 'a'.repeat(64),
  packages: [
    {
      name: 'probe',
      title: 'Probepaket',
      version: '1.0.0',
      minimumCore: '0.0.0',
      assetKinds: [
        {
          key: 'probe.elevator',
          version: 1,
          validFrom: '2015-06-01',
          definition: elevator,
          review: { checkedOn: '2026-10-03', accepted: null },
        },
      ],
      dutyKinds: [],
      forms: [],
      roundTemplates: [],
      rules: [],
      defectClasses: [],
      qualifications: [],
    },
  ],
}

const lifting: OwnAssetKind = {
  id: 'k-1',
  key: 'eigen.hebeanlage_schmutzwasser',
  label: 'Hebeanlage Schmutzwasser',
  costGroup: '411',
  expectedDocuments: [
    {
      key: 'betriebsanleitung',
      label: 'Betriebsanleitung',
      kind: 'operating_manual',
      demand: 'recommended',
      source: null,
    },
  ],
  version: 2,
  changedOn: '2026-10-18',
}

function field(
  assetKind: string,
  key: string,
  sort: OwnAssetField['sort'],
  more: Partial<OwnAssetField> = {},
): OwnAssetField {
  return {
    id: `f-${key}`,
    assetKind,
    key,
    label: key,
    sort,
    unit: null,
    options: [],
    position: 0,
    ...more,
  }
}

const own = ownCatalogueOf(
  [lifting],
  [
    field('eigen.hebeanlage_schmutzwasser', 'eigen_foerdermenge', 'number', { unit: 'm³/h' }),
    field('probe.elevator', 'eigen_notruf', 'text', { position: 1 }),
    field('probe.elevator', 'eigen_tableau', 'choice', {
      position: 0,
      options: [
        { value: 'o1', label: 'innen' },
        { value: 'o2', label: 'außen' },
      ],
    }),
  ],
)

describe('the catalogue of an operator with kinds and fields of its own', () => {
  const catalogue = withOwn(catalogueOf(bundle), own, 'b'.repeat(64))

  it('answers an own kind like a kind of a package, on every day, and lists it after them', () => {
    expect(catalogue.assetKind('eigen.hebeanlage_schmutzwasser', '2001-01-01')?.definition).toEqual(
      {
        label: 'Hebeanlage Schmutzwasser',
        costGroup: '411',
        characteristics: [],
        fields: [
          { key: 'eigen_foerdermenge', label: 'eigen_foerdermenge', kind: 'number', unit: 'm³/h' },
        ],
        expectedDocuments: lifting.expectedDocuments,
        meter: null,
      },
    )
    expect(catalogue.assetKinds('2026-10-18').map((entry) => entry.key)).toEqual([
      'probe.elevator',
      'eigen.hebeanlage_schmutzwasser',
    ])
    expect(catalogue.assetKind('eigen.unbekannt', '2026-10-18')).toBeNull()
  })

  it('gives a kind of a package its own fields after those of the package, in their order', () => {
    expect(
      catalogue
        .assetKind('probe.elevator', '2026-10-18')
        ?.definition.fields.map((each) => each.key),
    ).toEqual(['stops', 'eigen_tableau', 'eigen_notruf'])
    expect(
      catalogue.assetKinds('2026-10-18')[0]?.definition.fields.map((each) => each.key),
    ).toEqual(['stops', 'eigen_tableau', 'eigen_notruf'])
    // Before the kind of the package begins there is none, own fields or not.
    expect(catalogue.assetKind('probe.elevator', '2015-05-31')).toBeNull()
  })

  it('holds the values of an own field to its sort, beside those of the package', () => {
    const kind = catalogue.assetKind('probe.elevator', '2026-10-18')?.definition ?? elevator

    expect(
      assetValueProblems(kind, { stops: 4, eigen_notruf: '0621 123', eigen_tableau: 'o2' }),
    ).toEqual({})
    expect(assetValueProblems(kind, { eigen_tableau: 'oben' })).toEqual({
      'values.eigen_tableau': 'eigen_tableau ist eine von innen, außen.',
    })
    // Without what the operator added, the package knows no such field.
    expect(assetValueProblems(elevator, { eigen_notruf: '0621 123' })).toEqual({
      'values.eigen_notruf': 'Das Feld eigen_notruf hat die Anlagenart Aufzugsanlage nicht.',
    })
  })

  it('comes to a device in the bundle, under the checksum the server took over both', () => {
    const kept = catalogueOf(catalogue.bundle)

    expect(kept.sha256).toBe('b'.repeat(64))
    expect(kept.bundle.own).toEqual(own)
    expect(kept.assetKind('eigen.hebeanlage_schmutzwasser', '2026-10-18')?.definition.label).toBe(
      'Hebeanlage Schmutzwasser',
    )
    // The packages themselves are what they were.
    expect(kept.contents('2026-10-18').map((entry) => entry.name)).toEqual(['probe'])
    expect(catalogueOf(bundle).bundle.own).toBeUndefined()
  })

  it('is nothing where the operator added nothing', () => {
    expect(ownIsEmpty(ownCatalogueOf([], []))).toBe(true)
    expect(ownIsEmpty(own)).toBe(false)
  })
})

describe('the key of an own kind or field', () => {
  it('is made of the label, the letters of German spelled out', () => {
    expect(ownKeyStem('Hebeanlage Schmutzwasser')).toBe('hebeanlage_schmutzwasser')
    expect(ownKeyStem('Türantrieb (Größe 2)')).toBe('tuerantrieb_groesse_2')
    expect(ownKeyStem('Café-Kühlung')).toBe('cafe_kuehlung')
    expect(ownKeyStem('!!!')).toBe('art')
    expect(ownKeyStem('Sehr lange Bezeichnung einer Anlage, die niemand ganz liest')).toBe(
      'sehr_lange_bezeichnung_einer_anlage_die',
    )
  })

  it('is never one that is taken', () => {
    const taken = new Set(['eigen.pumpe', 'eigen.pumpe_2'])

    expect(freeKey('eigen.', 'pumpe', taken)).toBe('eigen.pumpe_3')
    expect(freeKey('eigen.', 'filter', taken)).toBe('eigen.filter')
  })
})

describe('what an own kind may say', () => {
  it('has a label and a cost group the catalogue knows', () => {
    expect(ownKindProblems({ label: 'Hebeanlage', costGroup: '411' }, ['411', '461'])).toEqual({})
    expect(ownKindProblems({ label: ' ', costGroup: '999' }, ['411', '461'])).toEqual({
      label: 'Die Bezeichnung fehlt.',
      costGroup: 'Die Kostengruppe ist keine, die der Katalog kennt.',
    })
    // A change of the label alone asks nothing of the cost group.
    expect(ownKindProblems({ label: 'Neu' }, ['411'])).toEqual({})
  })

  it('expects documents of a kind, required with their source or recommended', () => {
    const manual = { label: 'Betriebsanleitung', kind: 'operating_manual', demand: 'recommended' }

    expect(expectedDocumentsProblem([manual])).toBeNull()
    expect(
      expectedDocumentsProblem([{ ...manual, demand: 'required', source: 'DIN EN 12056-4' }]),
    ).toBeNull()
    expect(expectedDocumentsProblem([{ ...manual, demand: 'required', source: ' ' }])).toBe(
      'Eine verlangte Unterlage nennt ihre Fundstelle, „Betriebsanleitung“ nicht.',
    )
    expect(expectedDocumentsProblem([{ ...manual, kind: 'invoice' }])).toBe(
      'Zur Unterlage „Betriebsanleitung“ fehlt die Art des Dokuments.',
    )
    expect(expectedDocumentsProblem([{ ...manual, demand: 'maybe' }])).toBe(
      'Die Unterlage „Betriebsanleitung“ ist verlangt oder empfohlen.',
    )
    expect(expectedDocumentsProblem(Array.from({ length: 21 }, () => manual))).toBe(
      'Eine Anlagenart erwartet höchstens 20 Unterlagen.',
    )
  })
})

describe('what an own field may say', () => {
  it('has a label and a sort', () => {
    expect(ownFieldProblems({ label: 'Notruf', sort: 'text' })).toEqual({})
    expect(ownFieldProblems({ label: '', sort: 'colour' })).toEqual({
      label: 'Die Bezeichnung fehlt.',
      sort: 'Die Sorte ist Text, Zahl, Datum, Ja oder nein oder Auswahl.',
    })
  })

  it('has a unit only as a number, and choices only as a choice, at least two and each once', () => {
    expect(ownFieldProblems({ label: 'Menge', sort: 'number', unit: 'm³/h' })).toEqual({})
    expect(ownFieldProblems({ label: 'Notruf', sort: 'text', unit: 'm' })).toEqual({
      unit: 'Eine Einheit hat nur eine Zahl.',
    })
    expect(
      ownFieldProblems({ label: 'Lage', sort: 'choice', options: ['innen', 'außen'] }),
    ).toEqual({})
    expect(ownFieldProblems({ label: 'Lage', sort: 'choice', options: ['innen'] })).toEqual({
      options: 'Eine Auswahl hat 2 bis 30 Möglichkeiten mit höchstens 80 Zeichen, jede einmal.',
    })
    expect(
      ownFieldProblems({ label: 'Lage', sort: 'choice', options: ['innen', 'Innen'] }),
    ).toEqual({
      options: 'Eine Auswahl hat 2 bis 30 Möglichkeiten mit höchstens 80 Zeichen, jede einmal.',
    })
    expect(ownFieldProblems({ label: 'Lage', sort: 'text', options: ['innen', 'außen'] })).toEqual({
      options: 'Auswahlen hat nur eine Auswahl.',
    })
  })
})
