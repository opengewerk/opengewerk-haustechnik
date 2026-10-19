import { describeProcessing } from '@opengewerk/haustechnik-domain'
import { describe, expect, it } from 'vitest'

import { inlineHtml, markdownHtml, processingPrintJob } from './page.js'
import { processingTemplate } from './template.js'

describe('the description of the processing as a page for the renderer (#357)', () => {
  it('reads the marks of a line and escapes every character of text', () => {
    expect(inlineHtml('**Zusage:** `deadlines.member_user_id` und <b>&')).toBe(
      '<strong>Zusage:</strong> <code>deadlines.member_user_id</code> und &lt;b&gt;&amp;',
    )
    expect(inlineHtml('[Vorlage](https://opengewerk.de/haustechnik/auftragsverarbeitung/)')).toBe(
      '<a href="https://opengewerk.de/haustechnik/auftragsverarbeitung/">Vorlage</a>',
    )
    // A link anywhere else stays text, and an escaped mark is the character.
    expect(inlineHtml('[hier](javascript:alert(1))')).toBe('[hier](javascript:alert(1))')
    expect(inlineHtml('Wohnbau \\*Nord\\* \\| eG \\<script\\>')).toBe(
      'Wohnbau *Nord* | eG &lt;script&gt;',
    )
  })

  it('reads headings, paragraphs, lists and tables, with an escaped bar inside a cell', () => {
    expect(
      markdownHtml(
        [
          '# Titel',
          '',
          'Ein Absatz',
          '',
          '---',
          '',
          '- eins',
          '- zwei',
          '',
          '1. erst',
          '2. dann',
          '',
          '| Was | Stand |',
          '| --- | --- |',
          '| A \\| B | aus |',
        ].join('\n'),
      ),
    ).toBe(
      [
        '<h1>Titel</h1>',
        '<p>Ein Absatz</p>',
        '<hr>',
        '<ul><li>eins</li><li>zwei</li></ul>',
        '<ol><li>erst</li><li>dann</li></ol>',
        '<table><thead><tr><th>Was</th><th>Stand</th></tr></thead><tbody><tr><td>A | B</td><td>aus</td></tr></tbody></table>',
      ].join('\n'),
    )
  })

  it('reads the whole description without a mark left over', () => {
    const html = markdownHtml(describeProcessing(processingTemplate(), null))

    expect(html).not.toMatch(/\*\*|`|\{\{/)
    expect(html.match(/<h2>/g)?.length).toBe(14)
    expect(processingPrintJob(processingTemplate(), 'Fuß <b>').footerHtml).toContain(
      'Fuß &lt;b&gt;',
    )
  })
})
