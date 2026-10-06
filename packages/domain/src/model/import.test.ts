import { describe, expect, it } from 'vitest'

import {
  correctTheFile,
  counted,
  importKindLabel,
  importKinds,
  ImportProblems,
  listed,
  nameKey,
  planChanged,
  planHasProblems,
  planMakesNothing,
  sameCounts,
} from './import.js'

describe('the problems of a table', () => {
  it('are none for a table nothing is wrong with', () => {
    const problems = new ImportProblems()

    expect(problems.list()).toEqual([])
    expect(problems.added).toBe(0)
  })

  it('are one entry for the same thing wrong in many lines', () => {
    const problems = new ImportProblems()

    problems.add(4, 'Die Liegenschaft fehlt')
    problems.add(2, 'Die Liegenschaft fehlt')
    problems.add(9, 'Die Liegenschaft fehlt')

    expect(problems.list()).toEqual([
      { lines: [2, 4, 9], what: 'Die Liegenschaft fehlt', next: correctTheFile },
    ])
  })

  it('name every line once and in the order of the file, however they were found', () => {
    const problems = new ImportProblems()

    problems.add([12, 3], 'Das Gebäude „Mensa“ steht zweimal in der Datei')
    problems.add([3, 7], 'Das Gebäude „Mensa“ steht zweimal in der Datei')
    problems.add(10, 'Das Gebäude „Mensa“ steht zweimal in der Datei')

    expect(problems.list().map((problem) => problem.lines)).toEqual([[3, 7, 10, 12]])
  })

  it('stand in the order of the lines they were first found in', () => {
    const problems = new ImportProblems()

    problems.add(8, 'Das Geschoss fehlt')
    problems.add(5, 'Das Gebäude fehlt')
    problems.add(11, 'Die Liegenschaft fehlt')
    problems.add(2, 'Die Liegenschaft fehlt')

    // Found last and standing first: the property is missing in line 2 already.
    expect(problems.list().map(({ lines, what }) => [what, lines])).toEqual([
      ['Die Liegenschaft fehlt', [2, 11]],
      ['Das Gebäude fehlt', [5]],
      ['Das Geschoss fehlt', [8]],
    ])
  })

  it('are two entries where the same thing has two ways out', () => {
    const problems = new ImportProblems()

    problems.add(2, 'Das Bundesland fehlt', 'Im ersten Schritt ein Bundesland wählen')
    problems.add(3, 'Das Bundesland fehlt')
    problems.add(4, 'Das Bundesland fehlt', 'Im ersten Schritt ein Bundesland wählen')

    expect(problems.list()).toEqual([
      {
        lines: [2, 4],
        what: 'Das Bundesland fehlt',
        next: 'Im ersten Schritt ein Bundesland wählen',
      },
      { lines: [3], what: 'Das Bundesland fehlt', next: correctTheFile },
    ])
  })

  it('count every finding, merged or not, for a caller that asks whether a line added one', () => {
    const problems = new ImportProblems()

    problems.add(2, 'Die Liegenschaft fehlt')

    const before = problems.added

    problems.add(3, 'Die Liegenschaft fehlt')
    problems.addSentence(3, 'Anlage „Kessel“', 'Die Bezeichnung fehlt.')

    expect(before).toBe(1)
    expect(problems.added).toBe(3)
    expect(problems.list()).toHaveLength(2)
  })

  it('take a sentence of the model behind what it is about, without its full stop', () => {
    const problems = new ImportProblems()

    problems.addSentence(3, 'Anlage „Kessel“', 'Die Bezeichnung fehlt.')
    problems.addSentence(
      4,
      'Geschoss „Dach“ im Gebäude „Schulhaus“',
      'Die Ebene ist eine ganze Zahl von -20 bis 200: 0 ist das Erdgeschoss, darunter liegen die Untergeschosse.',
      'Eine Spalte „Ebene“ zuordnen',
    )
    // Only the full stop at the end goes, one inside the sentence stays.
    problems.addSentence(5, 'Anlage „Nr. 5“', 'Die Inbetriebnahme ist ein Tag, z. B. 2026-10-03.')
    problems.addSentence(6, 'Anlage „Pumpe“', 'Ohne Punkt am Ende')

    expect(problems.list()).toEqual([
      { lines: [3], what: 'Anlage „Kessel“: Die Bezeichnung fehlt', next: correctTheFile },
      {
        lines: [4],
        what: 'Geschoss „Dach“ im Gebäude „Schulhaus“: Die Ebene ist eine ganze Zahl von -20 bis 200: 0 ist das Erdgeschoss, darunter liegen die Untergeschosse',
        next: 'Eine Spalte „Ebene“ zuordnen',
      },
      {
        lines: [5],
        what: 'Anlage „Nr. 5“: Die Inbetriebnahme ist ein Tag, z. B. 2026-10-03',
        next: correctTheFile,
      },
      { lines: [6], what: 'Anlage „Pumpe“: Ohne Punkt am Ende', next: correctTheFile },
    ])
  })

  it('merge the same sentence about the same record like any other problem', () => {
    const problems = new ImportProblems()

    problems.addSentence(7, 'Anlage „Kessel“', 'Die Bezeichnung fehlt.')
    problems.addSentence(5, 'Anlage „Kessel“', 'Die Bezeichnung fehlt.')

    expect(problems.list()).toEqual([
      { lines: [5, 7], what: 'Anlage „Kessel“: Die Bezeichnung fehlt', next: correctTheFile },
    ])
  })
})

describe('how a name of a table is compared', () => {
  it('leaves out its spaces and its capitals', () => {
    expect(nameKey(' Schul Zentrum ')).toBe('schulzentrum')
    expect(nameKey('SCHULZENTRUM')).toBe('schulzentrum')
    expect(nameKey('ÄÖÜ 1')).toBe('äöü1')
    // A tab, a line break and a space that does not break are spaces too.
    expect(nameKey(`Haus\tA\n${String.fromCharCode(160)}1`)).toBe('hausa1')
  })

  it('keeps its punctuation, which may tell two rooms apart', () => {
    expect(nameKey('E.14')).toBe('e.14')
    expect(nameKey('E14')).not.toBe(nameKey('E.14'))
    expect(nameKey('Haus-A')).not.toBe(nameKey('Haus A'))
  })

  it('is empty for a name of nothing but spaces', () => {
    expect(nameKey('   ')).toBe('')
  })
})

describe('a count with its noun', () => {
  it('takes the word for one only for one', () => {
    expect(counted(1, 'Raum', 'Räume')).toBe('1 Raum')
    expect(counted(0, 'Raum', 'Räume')).toBe('0 Räume')
    expect(counted(2, 'Raum', 'Räume')).toBe('2 Räume')
    expect(counted(396, 'Raum', 'Räume')).toBe('396 Räume')
  })

  it('writes a large count as it is written in German', () => {
    expect(counted(1200, 'Anlage', 'Anlagen')).toBe('1.200 Anlagen')
  })
})

describe('parts as a sentence lists them', () => {
  it('are joined by commas, the last by "und"', () => {
    expect(listed([])).toBe('')
    expect(listed(['1 Raum'])).toBe('1 Raum')
    expect(listed(['1 Gebäude', '4 Räume'])).toBe('1 Gebäude und 4 Räume')
    expect(listed(['1 Liegenschaft', '2 Gebäude', '4 Räume'])).toBe(
      '1 Liegenschaft, 2 Gebäude und 4 Räume',
    )
    expect(listed(['a', 'b', 'c', 'd'])).toBe('a, b, c und d')
  })
})

describe('whether the plan is still the one that was shown', () => {
  const counts = { properties: 1, buildings: 2, known: 0 }

  it('is so when every count is what the page saw', () => {
    expect(sameCounts({ properties: 1, buildings: 2, known: 0 }, counts)).toBe(true)
  })

  it('is not so when one count is another', () => {
    expect(sameCounts({ properties: 1, buildings: 3, known: 0 }, counts)).toBe(false)
    expect(sameCounts({ properties: 1, buildings: 2, known: 1 }, counts)).toBe(false)
  })

  it('is not so when the page leaves a count out', () => {
    expect(sameCounts({ properties: 1, buildings: 2 }, counts)).toBe(false)
    expect(sameCounts({}, counts)).toBe(false)
  })

  it('takes a count only as the number it is', () => {
    expect(sameCounts({ properties: '1', buildings: '2', known: '0' }, counts)).toBe(false)
    expect(sameCounts({ properties: 1, buildings: 2, known: null }, counts)).toBe(false)
  })

  it('is not so for anything that is no record of counts', () => {
    expect(sameCounts(null, counts)).toBe(false)
    expect(sameCounts(undefined, counts)).toBe(false)
    expect(sameCounts('1,2,0', counts)).toBe(false)
    expect(sameCounts(3, counts)).toBe(false)
    expect(sameCounts([1, 2, 0], counts)).toBe(false)
  })
})

describe('what an import takes over', () => {
  it('has words for each of its kinds', () => {
    expect(Object.keys(importKindLabel).sort()).toEqual([...importKinds].sort())
  })

  it('answers a plan that cannot be taken over with a sentence of its own for each reason', () => {
    const sentences = [planChanged, planHasProblems, planMakesNothing]

    expect(new Set(sentences).size).toBe(3)
    expect(sentences.every((sentence) => sentence.endsWith('.'))).toBe(true)
  })
})
