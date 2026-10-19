import { describe, expect, it } from 'vitest'

import {
  changedInWords,
  changedSections,
  defaultProcessingFacts,
  describeProcessing,
  plainInMarkdown,
  processingFactLines,
  processingHoldsFor,
  ProcessingTemplateError,
} from './processing-description.js'

const template = [
  '# Verfahrensbeschreibung{{for}}',
  '',
  '- **Gilt für:** Fassung 0.1.7, mit dem Stand von Phase 1',
  '- **Erzeugt:** {{made}}',
  '',
  '## 1. Was dieses Dokument ist',
  '',
  '{{how-made}}',
  '',
  '## 2. Das Wichtigste in Kürze',
  '',
  '{{at-this-operator}}',
  '',
  '## 3. Welche Daten über Beschäftigte wo stehen',
  '',
  '- Gleich für jeden Betreiber. [K9]',
].join('\n')

const made = {
  operator: 'Wohnbau *Nord* | eG',
  at: '19.10.2026 um 09:12',
  facts: {
    ...defaultProcessingFacts,
    roles: [
      ...defaultProcessingFacts.roles.map((role) => ({ ...role, holders: 2 })),
      {
        label: 'Hausmeisterei',
        shipped: false,
        holders: 1,
        rights: ['store.read', 'store.write'] as const,
        secondFactor: true,
      },
    ],
    namesAndTimes: true,
  },
}

describe('the description of the processing from its template (#357)', () => {
  it('fills the four places with the defaults, and with an operator its name, moment and settings', () => {
    const plain = describeProcessing(template, null)

    expect(plain).toContain('# Verfahrensbeschreibung\n')
    expect(plain).toContain(
      '- **Erzeugt:** mit den Vorgaben, für einen Betreiber vor der Installation',
    )
    expect(plain).toContain('**Mit den Vorgaben.**')
    expect(plain).toContain(
      '| Rollen | mitgeliefert: Leitung, Technische Leitung, Objektleitung, Haustechnik, Melder und Prüfer; keine eigene |',
    )
    expect(plain).not.toContain('{{')

    const operator = describeProcessing(template, made)

    expect(operator).toContain('# Verfahrensbeschreibung für Wohnbau \\*Nord\\* \\| eG\n')
    expect(operator).toContain(
      '- **Erzeugt:** am 19.10.2026 um 09:12 für Wohnbau \\*Nord\\* \\| eG',
    )
    expect(operator).toContain('eigene: Hausmeisterei (1 Zugang)')
    expect(operator).toContain('Leitung (2 Zugänge)')
    expect(operator).toContain(
      '- **Hausmeisterei**, mit zweitem Faktor: Lager ansehen; Lager führen.',
    )
    expect(operator).toContain(
      '| Namen und Uhrzeiten der Ausführenden auf dem Leistungsnachweis | eingeschaltet |',
    )
  })

  it('refuses a template that misses a place, names one twice or names one there is not', () => {
    expect(() => describeProcessing(template.replace('{{made}}', ''), null)).toThrow(
      ProcessingTemplateError,
    )
    expect(() => describeProcessing(`${template}\n{{for}}`, null)).toThrow(ProcessingTemplateError)
    expect(() => describeProcessing(`${template}\n{{operator}}`, null)).toThrow(
      ProcessingTemplateError,
    )
  })

  it('takes what the operator wrote as plain text, so that it makes no mark of Markdown', () => {
    expect(plainInMarkdown('A*B_C`D[E](F)|G<H>\\I')).toBe('A\\*B\\_C\\`D\\[E\\](F)\\|G\\<H\\>\\\\I')
    expect(plainInMarkdown('zwei\nZeilen')).toBe('zwei Zeilen')
  })

  it('names the version it holds for from its line "Gilt für"', () => {
    expect(processingHoldsFor(describeProcessing(template, null))).toBe('0.1.7')
    expect(processingHoldsFor('- **Gilt für:** noch keine veröffentlichte Fassung')).toBeNull()
  })

  it('names the sections that changed, and not the head with the moment it was made', () => {
    const before = describeProcessing(template, made)
    const later = describeProcessing(template, { ...made, at: '20.10.2026 um 10:00' })
    const switched = describeProcessing(template, {
      ...made,
      facts: { ...made.facts, namesAndTimes: false },
    })

    expect(changedSections(before, later)).toEqual([])
    expect(changedSections(before, switched)).toEqual(['2'])
    expect(changedSections(before, `${switched}\n\n## Anhang B: Felder\n\n| a |`)).toEqual([
      '2',
      'Anhang B',
    ])
    expect(changedSections(`${before}\n\n## 12. Weg`, before)).toEqual(['12'])
  })

  it('says the changes in words', () => {
    expect(changedInWords(null)).toBe('Die erste Fassung')
    expect(changedInWords([])).toBe('Unverändert')
    expect(changedInWords(['4'])).toBe('Abschnitt 4')
    expect(changedInWords(['2', '4', 'Anhang B'])).toBe('Abschnitte 2 und 4, Anhang B')
  })

  it('names nothing switched on and the standard period with the defaults', () => {
    expect(processingFactLines(defaultProcessingFacts, false)).toEqual([
      {
        label: 'Rollen',
        value:
          'mitgeliefert: Leitung, Technische Leitung, Objektleitung, Haustechnik, Melder und Prüfer; keine eigene',
      },
      { label: 'Namen und Uhrzeiten der Ausführenden auf dem Leistungsnachweis', value: 'aus' },
      { label: 'Störmeldung über das Etikett ohne Konto', value: 'aus' },
      {
        label: 'Nachweise mindestens aufbewahren',
        value: 'keine Zahl von Jahren; es gilt die Regel der Pflichtart',
      },
      {
        label: 'Angaben eines beendeten Zugangs entfernen',
        value: 'nach 90 Tagen, gezählt ab dem Tag nach dem letzten Tag',
      },
      { label: 'Mailserver', value: 'nicht eingerichtet; ohne ihn geht keine E-Mail hinaus' },
    ])
  })
})
