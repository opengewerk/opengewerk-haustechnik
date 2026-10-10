import { describe, expect, it } from 'vitest'

import {
  type HeldRecord,
  heldPageOf,
  type SignedPage,
  signatureProblems,
  typedNameIsOf,
  signatureRoleLabel,
  signatureRoles,
  signaturesComplete,
  signedPageOf,
  validSignatures,
  workOrderDecisionKinds,
  workOrderDecisionLabel,
} from './signature.js'

const page = 'a'.repeat(64)
const otherPage = 'b'.repeat(64)

/** A signature as the server took it in, at a minute of a day. */
function signature(role: 'signer' | 'countersigner', minute: number, fingerprint = page) {
  return {
    role,
    pageFingerprint: fingerprint,
    createdAt: new Date(Date.UTC(2026, 9, 1, 9, minute)),
  }
}

function decision(kind: 'accepted' | 'rejected', minute: number) {
  return { decision: kind, createdAt: new Date(Date.UTC(2026, 9, 1, 9, minute)) }
}

describe('a signature', () => {
  it('is given as signature or countersignature, and a work order is accepted or rejected', () => {
    expect(signatureRoles.map((role) => signatureRoleLabel[role])).toEqual([
      'Unterschrift',
      'Gegenzeichnung',
    ])
    expect(workOrderDecisionKinds.map((kind) => workOrderDecisionLabel[kind])).toEqual([
      'Abgenommen',
      'Zurückgewiesen',
    ])
  })

  it('counts for the page as it is now, and not after a rejection that came later', () => {
    const first = signature('signer', 0)
    const stale = signature('signer', 1, otherPage)
    const again = signature('signer', 10)

    expect(validSignatures([first, stale], [], page)).toEqual([first])
    // A rejection makes the signature before it invalid, and one after it counts.
    expect(validSignatures([first, again], [decision('rejected', 5)], page)).toEqual([again])
    // An acceptance takes nothing away.
    expect(validSignatures([first], [decision('accepted', 5)], page)).toEqual([first])
    // The latest rejection decides.
    expect(
      validSignatures([again], [decision('rejected', 5), decision('rejected', 15)], page),
    ).toEqual([])
  })

  it('makes an activity complete with the signature, and the countersignature where asked', () => {
    const signer = { role: 'signer' as const }
    const countersigner = { role: 'countersigner' as const }

    expect(signaturesComplete({ countersignatureRequired: false }, [signer])).toBe(true)
    expect(signaturesComplete({ countersignatureRequired: false }, [])).toBe(false)
    expect(signaturesComplete({ countersignatureRequired: true }, [signer])).toBe(false)
    expect(signaturesComplete({ countersignatureRequired: true }, [countersigner])).toBe(false)
    expect(signaturesComplete({ countersignatureRequired: true }, [signer, countersigner])).toBe(
      true,
    )
  })

  it('is refused with a drawing outside the box, a fingerprint of another shape or another role', () => {
    expect(
      signatureProblems({
        role: 'witness',
        path: 'M1,1L1001,2',
        pageFingerprint: 'abc',
        deviceInfo: 'x'.repeat(501),
      }),
    ).toEqual({
      role: 'Unterschrieben wird oder gegengezeichnet.',
      path: 'Die Unterschrift ist ein Linienzug im Feld, höchstens 40000 Zeichen.',
      pageFingerprint: 'Der Fingerabdruck der Seite sind 64 hexadezimale Ziffern.',
      deviceInfo: 'Die Angabe zum Gerät hat höchstens 500 Zeichen.',
    })
    expect(
      signatureProblems({
        role: 'signer',
        path: 'M10,10L200,300M400,20L410,30',
        pageFingerprint: page,
        deviceInfo: null,
      }),
    ).toEqual({})
  })

  it('is given with the drawing or with the typed name, one of the two (#209)', () => {
    expect(
      signatureProblems({
        role: 'signer',
        path: null,
        typedName: 'Hanna Probe',
        pageFingerprint: page,
      }),
    ).toEqual({})
    expect(
      signatureProblems({
        role: 'signer',
        path: 'M10,10L200,300',
        typedName: 'Hanna Probe',
        pageFingerprint: page,
      }),
    ).toEqual({
      path: 'Unterschrieben wird mit dem Schriftzug oder mit dem getippten Namen, nicht mit beidem.',
    })
    expect(
      signatureProblems({ role: 'signer', path: null, typedName: null, pageFingerprint: page }),
    ).toEqual({ path: 'Es fehlt die Unterschrift: der Schriftzug im Feld oder der getippte Name.' })
    expect(
      signatureProblems({ role: 'signer', path: null, typedName: '   ', pageFingerprint: page }),
    ).toEqual({ typedName: 'Der getippte Name hat mindestens ein Zeichen und höchstens 200.' })
  })

  it('is confirmed with the name of the account that signs, whatever the case and the spaces', () => {
    expect(typedNameIsOf('  hanna   PROBE ', 'Hanna Probe')).toBe(true)
    expect(typedNameIsOf('Hanna', 'Hanna Probe')).toBe(false)
    expect(typedNameIsOf('', '')).toBe(false)
  })
})

describe('the page that is signed', () => {
  it('orders its lists by their keys, whatever order device or server read them in', () => {
    const parts: SignedPage = {
      activity: { id: 'a', kind: 'round', title: 'Rundgang', performedOn: '2026-10-01' },
      place: {
        property: { name: 'Campus', address: 'Hauptstraße 1, 68535 Edingen-Neckarhausen' },
        building: null,
        room: null,
        asset: null,
      },
      duties: [
        { dutyId: 'z', kind: null, label: 'B', result: 'without_defects', resultReason: null },
        { dutyId: 'b', kind: 'probe.x', label: null, result: 'failed', resultReason: null },
      ],
      defects: [
        { id: '2', description: 'Zweiter', defectClass: null },
        { id: '1', description: 'Erster', defectClass: null },
      ],
    }
    const turned = {
      ...parts,
      duties: [...parts.duties].reverse(),
      defects: [...parts.defects].reverse(),
    }

    expect(signedPageOf(parts)).toEqual(signedPageOf(turned))
    expect(signedPageOf(parts).duties.map((line) => line.dutyId)).toEqual(['b', 'z'])
    expect(signedPageOf(parts).defects.map((defect) => defect.id)).toEqual(['1', '2'])
  })
})

describe('the page a device works out from what it holds', () => {
  const held: Readonly<Record<string, readonly HeldRecord[]>> = {
    activities: [
      {
        id: 'ac-1',
        kind: 'inspection',
        title: 'Prüfung Trinkwasser',
        performedOn: '2026-10-09',
        propertyId: 'p-1',
        buildingId: null,
        roomId: null,
        assetId: 'as-1',
        formKey: 'probe.drinking_water_protocol',
        formVersion: 2,
      },
    ],
    properties: [
      {
        id: 'p-1',
        name: 'Campus',
        street: 'Hauptstraße 1',
        postalCode: '68535',
        city: 'Edingen-Neckarhausen',
      },
    ],
    assets: [
      {
        id: 'as-1',
        name: 'Speicher',
        kind: 'probe.water_heater',
        serialNumber: null,
        roomId: 'r-1',
        buildingId: 'b-1',
      },
    ],
    rooms: [{ id: 'r-1', number: 'E.14', name: 'Heizraum', buildingId: 'b-1' }],
    buildings: [{ id: 'b-1', name: 'Haus A', shortCode: null }],
    duties: [{ id: 'du-1', kind: 'probe.drinking_water_check', label: null }],
    activity_duties: [
      {
        id: 'ad-1',
        activityId: 'ac-1',
        dutyId: 'du-1',
        result: 'with_defects',
        resultReason: null,
        remark: 'Speicher nachgeheizt.',
      },
      // Taken off the activity: not on the page.
      {
        id: 'ad-2',
        activityId: 'ac-1',
        dutyId: 'du-2',
        result: null,
        resultReason: null,
        remark: null,
        deletedAt: '2026-10-08T10:00:00.000Z',
      },
    ],
    defects: [
      // Reported on this device a moment ago: it says nothing of an answer.
      { id: 'd-1', foundInActivityId: 'ac-1', description: 'Ventil tropft', defectClass: null },
      // Made of an answer by the server: the answer stands on the page.
      {
        id: 'd-2',
        foundInActivityId: 'ac-1',
        foundInAnswerId: 'an-1',
        description: 'Dämmung lose',
        defectClass: null,
      },
    ],
    activity_answers: [
      {
        id: 'an-1',
        activityId: 'ac-1',
        groupKey: null,
        blockKey: null,
        fieldKey: 'insulation',
        value: null,
        result: 'not_ok',
        remark: 'Dämmung lose',
        attachmentId: null,
      },
    ],
  }
  const records = {
    find: (entity: string, id: string) => held[entity]?.find((each) => each['id'] === id) ?? null,
    related: (entity: string, field: string, id: string) =>
      (held[entity] ?? []).filter((each) => each[field] === id),
  }

  it('is the page the server works out from the same rows', () => {
    expect(heldPageOf(records, 'ac-1')).toEqual(
      signedPageOf({
        activity: {
          id: 'ac-1',
          kind: 'inspection',
          title: 'Prüfung Trinkwasser',
          performedOn: '2026-10-09',
        },
        place: {
          property: { name: 'Campus', address: 'Hauptstraße 1, 68535 Edingen-Neckarhausen' },
          building: { name: 'Haus A', shortCode: null },
          room: { number: 'E.14', name: 'Heizraum' },
          asset: { id: 'as-1', name: 'Speicher', kind: 'probe.water_heater', serialNumber: null },
        },
        duties: [
          {
            dutyId: 'du-1',
            kind: 'probe.drinking_water_check',
            label: null,
            result: 'with_defects',
            resultReason: null,
            remark: 'Speicher nachgeheizt.',
          },
        ],
        defects: [{ id: 'd-1', description: 'Ventil tropft', defectClass: null }],
        form: { key: 'probe.drinking_water_protocol', version: 2 },
        answers: [
          {
            groupKey: null,
            blockKey: null,
            fieldKey: 'insulation',
            value: null,
            result: 'not_ok',
            remark: 'Dämmung lose',
            attachmentId: null,
          },
        ],
      }),
    )
  })

  it('says what was said with a result only where something was, so that a page signed before keeps its fingerprint', () => {
    const line = {
      dutyId: 'du-1',
      kind: null,
      label: 'Sichtkontrolle',
      result: 'without_defects' as const,
      resultReason: null,
    }
    const parts = {
      activity: { id: 'ac-1', kind: 'maintenance' as const, title: 'Wartung', performedOn: null },
      place: {
        property: { name: 'Campus', address: 'Hauptstraße 1, 68535 Edingen-Neckarhausen' },
        building: null,
        room: null,
        asset: null,
      },
      defects: [],
    }

    expect(signedPageOf({ ...parts, duties: [{ ...line, remark: null }] }).duties).toEqual([line])
    expect(signedPageOf({ ...parts, duties: [{ ...line, remark: 'Sauber.' }] }).duties).toEqual([
      { ...line, remark: 'Sauber.' },
    ])
  })

  it('is none for an activity the device does not hold', () => {
    expect(heldPageOf(records, 'ac-2')).toBeNull()
  })

  it('shows the time spent on a work order and its notes by their keys, without who wrote them', () => {
    const order: Readonly<Record<string, readonly HeldRecord[]>> = {
      activities: [
        {
          id: 'ac-9',
          kind: 'work_order',
          title: 'Notleuchte instand setzen',
          performedOn: '2026-10-05',
          propertyId: 'p-1',
          buildingId: null,
          roomId: null,
          assetId: null,
          formKey: null,
          formVersion: null,
        },
      ],
      properties: held['properties'] ?? [],
      work_orders: [{ id: 'wo-9', activityId: 'ac-9', durationMinutes: 45 }],
      work_order_notes: [
        { id: 'n-2', activityId: 'ac-9', text: 'Batterietest angestoßen.', writtenBy: 'u-2' },
        { id: 'n-1', activityId: 'ac-9', text: 'Akku getauscht.', writtenBy: null },
      ],
    }
    const page = heldPageOf(
      {
        find: (entity, id) => order[entity]?.find((each) => each['id'] === id) ?? null,
        related: (entity, field, id) => (order[entity] ?? []).filter((each) => each[field] === id),
      },
      'ac-9',
    )

    expect(page?.durationMinutes).toBe(45)
    expect(page?.notes).toEqual([
      { id: 'n-1', text: 'Akku getauscht.' },
      { id: 'n-2', text: 'Batterietest angestoßen.' },
    ])
  })

  it('leaves the time spent and the notes off a page that has none, so that a page signed before keeps its fingerprint', () => {
    const parts = {
      activity: { id: 'ac-9', kind: 'work_order' as const, title: 'Tür', performedOn: null },
      place: {
        property: { name: 'Campus', address: 'Hauptstraße 1, 68535 Edingen-Neckarhausen' },
        building: null,
        room: null,
        asset: null,
      },
      duties: [],
      defects: [],
    }
    const page = signedPageOf({ ...parts, durationMinutes: null, notes: [] })

    expect(Object.keys(page)).toEqual(['activity', 'place', 'duties', 'defects'])
    expect(page).toEqual(signedPageOf(parts))
  })
})
