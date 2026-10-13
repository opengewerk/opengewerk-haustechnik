import { describe, expect, it } from 'vitest'

import {
  renderSignature,
  signatureMaxLength,
  signatureProblem,
  unknownPlaceholders,
} from './mail-signature.js'

/**
 * The signature under a message of an operator (#126): one placeholder, the
 * person a message is sent by, and everything else as the operator wrote it.
 */

describe('a signature as it is typed', () => {
  it('knows the one placeholder and names every other as it was written', () => {
    expect(unknownPlaceholders('Viele Grüße\n{benutzer}')).toEqual([])
    expect(unknownPlaceholders('{Benutzer}\n{name} und noch einmal {name}')).toEqual([
      '{Benutzer}',
      '{name}',
    ])
  })

  it('is refused with what stands in it, and when it is too long', () => {
    expect(signatureProblem('Viele Grüße\n{benutzer}')).toBeNull()
    expect(signatureProblem('{briefkopf}')).toBe(
      'In der Signatur steht {briefkopf}. Möglich ist {benutzer} für den Namen dessen, der die E-Mail verschickt.',
    )
    expect(signatureProblem('x'.repeat(signatureMaxLength))).toBeNull()
    expect(signatureProblem('x'.repeat(signatureMaxLength + 1))).toBe(
      'Die Signatur ist länger als 2000 Zeichen.',
    )
  })
})

describe('a signature under a message', () => {
  const template = 'Viele Grüße\n{benutzer}\n\nLiegenschaften Beispielstadt\nHaustechnik'

  it('names who sent the message where somebody did', () => {
    expect(
      renderSignature(template, { operator: 'Liegenschaften Beispielstadt', sender: 'S. Krämer' }),
    ).toBe('Viele Grüße\nS. Krämer\n\nLiegenschaften Beispielstadt\nHaustechnik')
  })

  it('leaves the line out where nobody did, and closes the gap', () => {
    expect(
      renderSignature('Viele Grüße\n\n{benutzer}\n\nHaustechnik', {
        operator: 'Liegenschaften Beispielstadt',
        sender: null,
      }),
    ).toBe('Viele Grüße\n\nHaustechnik')
  })

  it('is the name of the operator where it wrote none', () => {
    for (const empty of [null, '', '  \n ']) {
      expect(
        renderSignature(empty, { operator: 'Liegenschaften Beispielstadt', sender: 'S. Krämer' }),
      ).toBe('Liegenschaften Beispielstadt')
    }
  })
})
