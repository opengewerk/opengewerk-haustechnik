import {
  boardAssetKind,
  type CatalogueBundle,
  type CatalogueRule,
  type PackagedForm,
} from '@opengewerk/haustechnik-domain'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { acceptedReview, servingCatalogue, testCatalogue } from '../../app/test-catalogue.js'
import { memberIn } from '../../app/test-entry.js'
import {
  afterEachSiteTest,
  house,
  mountSite,
  school,
  schoolServer,
  storeRoom,
} from '../test-site.js'

/**
 * The measurements per circuit of an electrical installation on site (#350):
 * the protocol lists the circuits of the installation board by board in the
 * order of the chart, each with how far its block is; a circuit opens its
 * block, a point of it its own screen, where a value is judged with the facts
 * of the circuit and given with the circuit as the key of its block; and an
 * installation without a circuit says so and leads to its boards, for
 * whoever takes stock of assets.
 */

afterEach(afterEachSiteTest)

const installationTest: PackagedForm = {
  title: 'Prüfung der elektrischen Anlage',
  sections: [
    {
      key: 'inspection',
      title: 'Besichtigen',
      fields: [{ kind: 'check_point', key: 'documentation', label: 'Stromkreisverzeichnis' }],
    },
    {
      key: 'measurements',
      title: 'Messen',
      fields: [
        {
          kind: 'group',
          key: 'circuits',
          label: 'Messen je Stromkreis',
          repeat: 'circuits',
          fields: [
            {
              kind: 'measurement',
              key: 'protective_conductor',
              label: 'Durchgängigkeit des Schutzleiters RPE',
              unit: 'ohms',
              decimals: 2,
            },
            {
              kind: 'measurement',
              key: 'loop_impedance',
              label: 'Schleifenimpedanz Zs',
              unit: 'ohms',
              decimals: 2,
              limit: { kind: 'loop_impedance' },
            },
            {
              kind: 'measurement',
              key: 'rcd_trip_current',
              label: 'Auslösestrom IΔ',
              unit: 'milliamperes',
              decimals: 1,
              limit: { kind: 'rcd_trip_current' },
            },
            { kind: 'check_point', key: 'circuit_ok', label: 'Stromkreis in Ordnung' },
            { kind: 'text', key: 'remark', label: 'Bemerkung' },
          ],
        },
      ],
    },
  ],
}

function vde(key: string, unit: CatalogueRule['record']['unit'], value: number, source: string) {
  return {
    record: {
      key: `elektro.${key}`,
      validFrom: '2017-06-01',
      validUntil: null,
      unit,
      value,
      source,
      origin: 'private_standard',
    },
    review: acceptedReview,
  } satisfies CatalogueRule
}

/** The probe catalogue with a package Elektro that measures every circuit. */
const circuitCatalogue: CatalogueBundle = {
  ...testCatalogue,
  sha256: '3'.repeat(64),
  packages: [
    ...testCatalogue.packages,
    {
      name: 'elektro',
      title: 'Elektro',
      version: '1.3.0',
      minimumCore: '0.1.0',
      assetKinds: [],
      dutyKinds: [],
      forms: [
        {
          key: 'elektro.installation_test',
          version: 1,
          validFrom: '2018-03-01',
          definition: installationTest,
          review: acceptedReview,
        },
      ],
      roundTemplates: [],
      rules: [
        vde('loop_factor_b', 'factor', 5, 'DIN EN 60898-1'),
        vde('loop_factor_c', 'factor', 10, 'DIN EN 60898-1'),
        vde('loop_factor_d', 'factor', 20, 'DIN EN 60898-1'),
        vde('loop_nominal_voltage', 'volts', 230, 'DIN VDE 0100-410'),
        vde('rcd_trip_current_maximum', 'basis_points', 10_000, 'DIN EN 61008-1'),
      ],
      defectClasses: [],
      qualifications: [],
    },
  ],
}

const withTheForm = { answers: servingCatalogue(circuitCatalogue) }

const place = { propertyId: school.id, areaId: school.areaId }
const installation = {
  id: 'a-install',
  ...place,
  buildingId: house.id,
  roomId: storeRoom.id,
  parentAssetId: null,
  kind: boardAssetKind,
  number: 'AN-00012',
  name: 'Elektrische Anlage Schulhaus',
  mark: null,
  manufacturer: null,
  model: null,
  serialNumber: null,
  yearBuilt: null,
  values: '{}',
}
const onAsset = { ...place, assetId: installation.id }
const hv = {
  id: 'b-hv',
  ...onAsset,
  kind: 'main_distribution',
  designation: 'HV 1',
  location: null,
  position: 0,
}
const uv = { ...hv, id: 'b-uv', kind: 'sub_distribution', designation: 'UV 1', position: 1 }
const field1 = {
  id: 's-1',
  ...onAsset,
  distributionBoardId: uv.id,
  designation: 'Feld 1',
  position: 1,
}

function circuit(
  id: string,
  board: string,
  section: string | null,
  position: number,
  more: object,
) {
  return {
    id,
    ...onAsset,
    distributionBoardId: board,
    boardSectionId: section,
    consumer: null,
    overcurrentDevice: null,
    tripCharacteristic: null,
    ratedCurrentMilli: null,
    rcdType: null,
    ratedResidualCurrentMilli: null,
    cableType: null,
    cableCores: null,
    cableCrossSectionMilli: null,
    cableLengthMilli: null,
    cableInstallationMethod: null,
    position,
    ...more,
  }
}

const q1 = circuit('c-q1', hv.id, null, 0, { designation: 'Q1', consumer: 'Zuleitung UV 1' })
const f2 = circuit('c-f2', hv.id, null, 1, {
  designation: 'F2',
  consumer: 'Steckdosen Nordwand',
  tripCharacteristic: 'b',
  ratedCurrentMilli: 16_000,
  rcdType: 'a',
  ratedResidualCurrentMilli: 30,
})
const f1 = circuit('c-f1', uv.id, field1.id, 0, {
  designation: 'F1',
  consumer: 'Licht Werkstatt',
  tripCharacteristic: 'b',
  ratedCurrentMilli: 10_000,
  rcdType: 'a',
  ratedResidualCurrentMilli: 30,
})

/** The test of the installation, open, performed by the own people. */
const test = {
  id: 'ac-install',
  ...place,
  assetId: installation.id,
  buildingId: null,
  roomId: null,
  kind: 'inspection',
  status: 'open',
  title: 'Prüfung der elektrischen Anlage',
  formKey: 'elektro.installation_test',
  formVersion: 1,
  templateOn: null,
  performer: 'own_staff',
  performedOn: null,
  dueOn: '2026-10-20',
  closingReason: null,
}

/** An answer in the block of a circuit, as the device is sent it. */
function measured(circuitId: string, fieldKey: string, said: { value?: string; result?: string }) {
  return {
    id: `an-${circuitId}-${fieldKey}`,
    ...place,
    activityId: test.id,
    groupKey: 'circuits',
    blockKey: circuitId,
    fieldKey,
    value: said.value ?? null,
    result: said.result ?? null,
    remark: null,
    attachmentId: null,
  }
}

/**
 * The school with the installation and its test: Q1 measured and in order,
 * the loop impedance of F2 outside the limit worked out of its breaker, F1
 * not yet begun. Without `boards`, the installation has none.
 */
function installationServer({ boards = true } = {}) {
  const server = schoolServer()

  server.put('assets', installation)
  server.put('activities', test)

  if (boards) {
    for (const [entity, rows] of Object.entries({
      distribution_boards: [hv, uv],
      board_sections: [field1],
      circuits: [q1, f2, f1],
    })) {
      for (const row of rows) {
        server.put(entity, row)
      }
    }

    server.put('activity_answers', measured(q1.id, 'protective_conductor', { value: '80' }))
    server.put('activity_answers', measured(q1.id, 'circuit_ok', { result: 'ok' }))
    server.put('activity_answers', measured(f2.id, 'loop_impedance', { value: '3400' }))
  }

  return server
}

describe('the measurements per circuit in the protocol (#350)', () => {
  it('lists the circuits board by board in the order of the chart, each with how far its block is', async () => {
    await mountSite(`/vorgaenge/${test.id}`, { server: installationServer(), ...withTheForm })

    const first = await screen.findByRole('list', { name: 'Messen je Stromkreis, HV 1' })
    const [q1Card, f2Card] = within(first).getAllByRole('link')
    const [f1Card] = within(
      screen.getByRole('list', { name: 'Messen je Stromkreis, UV 1' }),
    ).getAllByRole('link')

    expect(within(q1Card as HTMLElement).getByText('Zuleitung UV 1')).toBeDefined()
    expect(within(q1Card as HTMLElement).getByText('fertig')).toBeDefined()
    expect(within(f2Card as HTMLElement).getByText('B 16 A, RCD 30 mA')).toBeDefined()
    expect(within(f2Card as HTMLElement).getByText('1 von 4')).toBeDefined()
    expect(within(f2Card as HTMLElement).getByText('außerhalb des Grenzwerts')).toBeDefined()
    expect(within(f1Card as HTMLElement).getByText('Licht Werkstatt')).toBeDefined()
    expect(within(f1Card as HTMLElement).getByText('noch offen')).toBeDefined()
    expect(screen.getByText('1 von 3 fertig')).toBeDefined()
    expect(screen.getByText('1 von 2 fertig')).toBeDefined()
    // Every circuit has its block; none is added, and no point of a block stands in the list.
    expect(screen.queryByRole('button', { name: 'Messen je Stromkreis hinzufügen' })).toBeNull()
    expect(screen.queryByText('Stromkreis in Ordnung')).toBeNull()
  })

  it('opens the block of a circuit with its values judged against the limits worked out of the circuit', async () => {
    await mountSite(`/vorgaenge/${test.id}/stromkreise/${f2.id}`, {
      server: installationServer(),
      ...withTheForm,
    })

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Steckdosen Nordwand' }),
    ).toBeDefined()
    expect(screen.getByText('B 16 A, RCD 30 mA · HV 1')).toBeDefined()
    expect(screen.getByText(/^Außerhalb des Grenzwerts, höchstens 2,8\d Ω\.$/)).toBeDefined()
    // The tripping current is limited by the RCD of the circuit, before a value is given.
    expect(screen.getByText('Grenzwert: höchstens 30,0 mA.')).toBeDefined()
    expect(
      screen.getByText(
        'Mit der Unterschrift wird aus „Schleifenimpedanz Zs“ ein Mangel an AN-00012, mit dem Stromkreis F2 im Bezug.',
      ),
    ).toBeDefined()
    expect(screen.getByRole('button', { name: 'Zu Q1' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Weiter zu F1' })).toBeDefined()
  })

  it('gives a value of a circuit on the screen of its point, with the circuit as the key of its block', async () => {
    const { client } = await mountSite(`/vorgaenge/${test.id}`, {
      server: installationServer(),
      ...withTheForm,
    })

    fireEvent.click(await screen.findByRole('link', { name: /Licht Werkstatt/ }))
    fireEvent.click(await screen.findByRole('link', { name: /Schleifenimpedanz Zs/ }))

    const box = await screen.findByRole('textbox', { name: 'Schleifenimpedanz Zs in Ω' })

    expect(screen.getByText('F1 Licht Werkstatt')).toBeDefined()
    expect(screen.getByText('Messen, UV 1, Feld 1 · Punkt 2 von 5')).toBeDefined()
    expect(screen.getByText('≤ 4,60 Ω')).toBeDefined()

    fireEvent.change(box, { target: { value: '5,10' } })
    fireEvent.blur(box)

    await waitFor(() => {
      expect(
        client.list('activity_answers').filter((answer) => answer['blockKey'] === f1.id),
      ).toMatchObject([
        {
          activityId: test.id,
          groupKey: 'circuits',
          blockKey: f1.id,
          fieldKey: 'loop_impedance',
          value: '5100',
        },
      ])
    })
    expect(
      await screen.findByText(
        'Außerhalb des Grenzwerts, höchstens 4,60 Ω. Quelle: DIN VDE 0100-410; DIN EN 60898-1.',
      ),
    ).toBeDefined()
    expect(
      screen.getByText(
        'Mit der Unterschrift wird daraus ein Mangel an AN-00012 Elektrische Anlage Schulhaus, mit dem Stromkreis F1 Licht Werkstatt, UV 1, Feld 1 im Bezug.',
      ),
    ).toBeDefined()
  })

  it('names the circuit of a finding and of a point still open before the signature', async () => {
    await mountSite(`/vorgaenge/${test.id}/ergebnis`, {
      server: installationServer(),
      ...withTheForm,
    })

    // The value outside its limit lacks its remark, and the signature makes a defect of it.
    expect(await screen.findAllByText('F2 Steckdosen Nordwand: Schleifenimpedanz Zs')).toHaveLength(
      2,
    )
    expect(
      screen.getByText('Außerhalb des Grenzwerts, wird mit der Unterschrift ein Mangel'),
    ).toBeDefined()
    expect(screen.getByText('F1 Licht Werkstatt: Stromkreis in Ordnung')).toBeDefined()
  })
})

describe('an installation without a circuit (#350)', () => {
  it('says what the measurements need and leads to taking down a board', async () => {
    const { router } = await mountSite(`/vorgaenge/${test.id}`, {
      server: installationServer({ boards: false }),
      ...withTheForm,
    })

    fireEvent.click(await screen.findByRole('button', { name: 'Verteiler aufnehmen' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/anlagen/${installation.id}/verteiler/neu`)
    })
  })

  it('offers no way to the boards to whoever does not take stock of assets', async () => {
    await mountSite(`/vorgaenge/${test.id}`, {
      server: installationServer({ boards: false }),
      rights: memberIn('technician').rights.filter((right) => right !== 'asset.record'),
      ...withTheForm,
    })

    expect(
      await screen.findByText(
        'Die Messungen je Stromkreis brauchen die Stromkreise aus den Verteilern der Anlage. Sie hat noch keinen.',
      ),
    ).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Verteiler aufnehmen' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Zu den Verteilern' })).toBeNull()
  })
})
