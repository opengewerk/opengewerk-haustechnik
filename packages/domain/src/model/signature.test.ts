import { describe, expect, it } from 'vitest'

import {
  type SignedPage,
  signatureProblems,
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
