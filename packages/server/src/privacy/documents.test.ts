import { readFileSync } from 'node:fs'

import {
  defaultDeletionFacts,
  deletionRuleNumbers,
  describeMeasures,
  describeRecord,
  instanceMeasureSections,
  measuresPartA,
  processingActivities,
} from '@opengewerk/haustechnik-domain'
import { describe, expect, it } from 'vitest'

import { processingTemplate } from '../processing-description/template.js'
import { measuresTemplate } from './template.js'

/**
 * The record of the processing and the measures against the description of
 * the processing (#358). Every area of data the description names in its
 * section 3 stands in an activity of the record (acceptance 1), and every
 * statement of part A of the measures names its proofs out of annex A of the
 * description, which `processing-description.test.ts` holds against the code:
 * part A is held against the code the same way (decided on 19.10.2026).
 */

const description = processingTemplate()
const measures = measuresTemplate()
const concept = readFileSync(
  new URL('../../../../docs/konzept/Planungskonzept.md', import.meta.url),
  'utf8',
)

/** The numbers of the sections 3.x of the description, "3.1". */
const sections = [...description.matchAll(/^### (3\.\d+) /gm)].map((match) => match[1] ?? '')

/** The numbers of annex A of the description, "B44". */
const proofs = new Set([...description.matchAll(/^\| (B\d+) \|/gm)].map((match) => match[1] ?? ''))

describe('the record of the processing', () => {
  it('has an activity for every area of data the description names, and no section that is not there', () => {
    const named = processingActivities.flatMap((activity) => activity.sections)

    expect(sections.length).toBeGreaterThan(20)
    expect([...new Set(named)].sort()).toEqual([...sections].sort())
    expect(new Set(named).size).toBe(named.length)
  })

  it('names who is responsible, the proposals as such, and what the Leitung wrote as written', () => {
    const made = describeRecord({
      operator: 'Probe Nord',
      at: '19.10.2026 um 09:30',
      holdsFor: '0.2.0',
      inputs: {
        controller: 'Probe Nord GmbH\nAm Probehang 4',
        officer: null,
        activities: {
          accounts: {
            purpose: 'Anmeldung',
            legalBasis: 'Art. 6 Abs. 1 lit. b DSGVO',
            recipients: null,
          },
          'third-parties': { purpose: null, legalBasis: null, recipients: 'Fremdfirmen' },
        },
      },
      ruleNumbers: deletionRuleNumbers(),
    })

    expect(made).toContain('- **Verantwortlicher:** Probe Nord GmbH, Am Probehang 4')
    expect(made).toContain('- **Datenschutzbeauftragter:** keiner angegeben')
    expect(made).toContain('- **Zweck:** Anmeldung\n')
    expect(made).toContain(
      `- **Zweck:** ${processingActivities[6].purpose} (Vorschlag der Anwendung, nicht bestätigt)`,
    )
    expect(made).toContain('- **Empfänger:** Fremdfirmen')
    expect(made.match(/^### 3\.\d+ /gm)).toHaveLength(processingActivities.length)
  })
})

describe('part A of the measures', () => {
  const partA = measuresPartA(measures)
  const statements = partA.split('\n').filter((line) => line.startsWith('- '))

  it('is A.1 to A.9', () => {
    expect([...partA.matchAll(/^### (A\.\d) /gm)].map((match) => match[1])).toEqual([
      'A.1',
      'A.2',
      'A.3',
      'A.4',
      'A.5',
      'A.6',
      'A.7',
      'A.8',
      'A.9',
    ])
  })

  it('names a proof of annex A for every statement of what the application brings, and only proofs that are there', () => {
    const bringing = partA.slice(0, partA.indexOf('### A.9'))

    for (const statement of bringing.split('\n').filter((line) => line.startsWith('- '))) {
      const cited = [...statement.matchAll(/\bB\d+\b/g)].map((match) => match[0])

      expect(cited.length, statement).toBeGreaterThan(0)

      for (const proof of cited) {
        expect(proofs.has(proof), `${proof} in "${statement.slice(0, 60)}"`).toBe(true)
      }
    }
  })

  it('names for what it cannot do yet a section of the concept that is there', () => {
    const missing = partA.slice(partA.indexOf('### A.9'))

    for (const statement of missing.split('\n').filter((line) => line.startsWith('- '))) {
      const sections = [...statement.matchAll(/\bK(\d+(?:\.\d+)*)\b/g)].map(
        (match) => match[1] ?? '',
      )

      expect(sections.length, statement).toBeGreaterThan(0)

      for (const section of sections) {
        // As `processing-description.test.ts` reads a citation: 9 a chapter, 2.7 a part of one.
        const there = section.includes('.')
          ? concept.includes(`\n### ${section} `)
          : concept.includes(`\n## ${section}. `)

        expect(there, `K${section}`).toBe(true)
      }
    }

    expect(statements.length).toBeGreaterThan(30)
  })

  it('is made with part B and annex 2 as the instance keeps them', () => {
    const made = describeMeasures(measures, {
      operator: 'Probe Nord',
      at: '19.10.2026 um 09:31',
      holdsFor: '0.2.0',
      measures: { serverPlace: 'Nürnberg', accessFirewall: true },
      subprocessors: [{ name: 'Rechenbetrieb Nord GmbH', service: 'Server', place: 'Deutschland' }],
      changedAt: '18.10.2026 um 16:00',
    })

    expect(made).toContain(partA)
    expect(made).toContain('- Land und Ort des Servers: Nürnberg')
    expect(made).toContain('- Ja: eine Firewall lässt nur die nötigen Ports durch')
    expect(made).toContain('- Nein: die Datenträger des Servers sind verschlüsselt')
    expect(made).toContain('| Rechenbetrieb Nord GmbH | Server | Deutschland |')
    expect(made.match(/^### B\.\d /gm)).toHaveLength(instanceMeasureSections.length)
    expect(made).not.toContain('{{')
    expect(defaultDeletionFacts.removalDays).toBeGreaterThan(0)
  })
})
