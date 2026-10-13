import { Markdown, markdownTitle, Panel } from '@opengewerk/platform-web'
import {
  SiteHeader,
  SiteRow,
  SiteRows,
  SiteScreen,
  SiteText,
  TopTitle,
} from '@opengewerk/platform-web/site'
import { Link, useParams } from '@tanstack/react-router'
import { CircleQuestionMark } from 'lucide-react'

import { applicationName } from '../app/name.js'
import { firstParagraph, guideOrder, inOrder, siteHelpOrder } from '../help/texts.js'
import { useHelpTexts } from '../help/use-texts.js'

/** What the help on site says around its texts. */
export const siteHelpWords = {
  title: 'Hilfe',
  screens: 'Zu den Bildschirmen',
  guides: 'Kurzanleitungen',
  offline: 'Die Hilfe liegt auf dem Gerät und ist ohne Netz lesbar.',
  loading: 'Wird geladen.',
  unknown: 'Diesen Text gibt es nicht.',
} as const

/** Where the help stands on site. */
export const siteHelpPlace = '/hilfe'

const back = { to: siteHelpPlace, label: siteHelpWords.title } as const

/** The row of the menu that leads to the help, for everybody who holds a device. */
export function HelpMenuRow() {
  return (
    <Link
      to={siteHelpPlace}
      className="flex min-h-14 items-center gap-3 rounded-[6px] px-3.5 text-[17px] text-ink no-underline"
    >
      <CircleQuestionMark size={22} strokeWidth={1.9} aria-hidden="true" className="shrink-0" />
      <span className="grow">{siteHelpWords.title}</span>
    </Link>
  )
}

/**
 * "Hilfe" on site (#131): a text for each screen of the tabs and the menu,
 * and the quick guides to the core flows. The texts are part of the build
 * and are read without a network, which is where somebody stands who looks
 * for them in a cellar.
 */
export function SiteHelpScreen() {
  const screens = useHelpTexts('site')
  const guides = useHelpTexts('guides')

  return (
    <SiteScreen>
      <TopTitle over={applicationName} title={siteHelpWords.title} />
      {screens === undefined || guides === undefined ? (
        <SiteText muted>{siteHelpWords.loading}</SiteText>
      ) : (
        <>
          <Panel title={siteHelpWords.screens}>
            <SiteRows label={siteHelpWords.screens}>
              {inOrder(screens, siteHelpOrder).map(({ key, text }) => (
                <SiteRow
                  key={key}
                  to={`/hilfe/bildschirm/${key}`}
                  title={markdownTitle(text) ?? key}
                />
              ))}
            </SiteRows>
          </Panel>
          <Panel title={siteHelpWords.guides}>
            <SiteRows label={siteHelpWords.guides}>
              {inOrder(guides, guideOrder).map(({ key, text }) => (
                <SiteRow
                  key={key}
                  to={`/hilfe/${key}`}
                  title={markdownTitle(text) ?? key}
                  meta={firstParagraph(text)}
                />
              ))}
            </SiteRows>
          </Panel>
          <SiteText muted size={15}>
            {siteHelpWords.offline}
          </SiteText>
        </>
      )}
    </SiteScreen>
  )
}

/** A text of the help in the type of the site, under the header with the way back to the list. */
function HelpText({ texts, name }: { readonly texts: 'site' | 'guides'; readonly name?: string }) {
  const found = useHelpTexts(texts)
  const text = name === undefined ? undefined : found?.get(name)

  return (
    <>
      <SiteHeader
        title={
          text === undefined ? siteHelpWords.title : (markdownTitle(text) ?? siteHelpWords.title)
        }
        back={back}
      />
      <SiteScreen>
        {found === undefined ? (
          <SiteText muted>{siteHelpWords.loading}</SiteText>
        ) : text === undefined ? (
          <SiteText muted>{siteHelpWords.unknown}</SiteText>
        ) : (
          <Panel>
            <Markdown source={text} withoutTitle large level={1} />
          </Panel>
        )}
      </SiteScreen>
    </>
  )
}

/** The text of a screen on site. */
export function SiteScreenHelpScreen() {
  const { screen } = useParams({ strict: false }) as { screen?: string }

  return <HelpText texts="site" {...(screen === undefined ? {} : { name: screen })} />
}

/** A quick guide on site. */
export function SiteGuideScreen() {
  const { guide } = useParams({ strict: false }) as { guide?: string }

  return <HelpText texts="guides" {...(guide === undefined ? {} : { name: guide })} />
}
