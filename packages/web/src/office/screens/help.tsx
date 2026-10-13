import { cardLink, Markdown, markdownTitle, Panel } from '@opengewerk/platform-web'
import { Empty, NoteBox, PageHead, Screen } from '@opengewerk/platform-web/office'
import { Link, useParams } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'

import { firstParagraph, guideOrder, inOrder } from '../../help/texts.js'
import { useHelpTexts } from '../../help/use-texts.js'
import { helpPlace } from '../help.js'

/** What the pages of the help say around their texts. */
export const helpWords = {
  title: 'Hilfe',
  sub: 'Kurzanleitungen zu den wichtigsten Abläufen, Schritt für Schritt',
  guides: 'Kurzanleitungen',
  perPage:
    'Zu jeder Seite gibt es einen eigenen Text. Das Fragezeichen in der Kopfleiste öffnet ihn neben der Seite, auf einem schmalen Bildschirm steht „Hilfe zu dieser Seite“ im Menü.',
  loading: 'Wird geladen.',
  unknownTitle: 'Nicht gefunden',
  unknown: 'Diese Kurzanleitung gibt es nicht.',
} as const

const list = { to: helpPlace, label: helpWords.title } as const

/**
 * "Hilfe" in the office (#131): the quick guides to the core flows of
 * section 1 of the concept, each a row that opens its text. The help of a
 * single page stands beside that page, behind the question mark of the
 * header, and this screen says so.
 */
export function HelpScreen() {
  const texts = useHelpTexts('guides')

  return (
    <Screen>
      <PageHead title={helpWords.title} sub={helpWords.sub} />
      <Panel title={helpWords.guides}>
        {texts === undefined ? (
          <Empty>{helpWords.loading}</Empty>
        ) : (
          <ul className="flex flex-col">
            {inOrder(texts, guideOrder).map(({ key, text }) => (
              <li
                key={key}
                className="relative flex items-center gap-3 border-b border-row py-2.5 last:border-b-0"
              >
                <span className="min-w-0 grow">
                  <Link
                    to="/hilfe/$guide"
                    params={{ guide: key }}
                    className={`${cardLink} block text-[14px] font-semibold`}
                  >
                    {markdownTitle(text) ?? key}
                  </Link>
                  <span className="mt-0.5 block text-[13px] leading-[1.45] text-ink-muted">
                    {firstParagraph(text)}
                  </span>
                </span>
                <ChevronRight
                  size={18}
                  strokeWidth={2}
                  aria-hidden="true"
                  className="shrink-0 text-ink-faint"
                />
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <NoteBox>{helpWords.perPage}</NoteBox>
    </Screen>
  )
}

/** A quick guide: its text under its own title, with the way back to the list. */
export function GuideScreen() {
  const { guide } = useParams({ strict: false }) as { guide?: string }
  const texts = useHelpTexts('guides')
  const text = guide === undefined ? undefined : texts?.get(guide)

  if (texts !== undefined && text === undefined) {
    return (
      <Screen>
        <PageHead title={helpWords.unknownTitle} crumbs={[list]} phoneBack={list} />
        <Empty>{helpWords.unknown}</Empty>
      </Screen>
    )
  }

  return (
    <Screen>
      <PageHead
        title={text === undefined ? helpWords.guides : (markdownTitle(text) ?? helpWords.guides)}
        crumbs={[list]}
        phoneBack={list}
      />
      <Panel roomy className="max-w-[760px]">
        {text === undefined ? (
          <Empty>{helpWords.loading}</Empty>
        ) : (
          // The head of the screen is the first heading, the sections of
          // the text follow it as the second.
          <Markdown source={text} withoutTitle level={1} />
        )}
      </Panel>
    </Screen>
  )
}
