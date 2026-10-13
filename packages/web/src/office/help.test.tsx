import { TestServer } from '@opengewerk/platform-web/testing'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { manualWords } from './instance/manual.js'
import { helpWords } from './screens/help.js'
import {
  mountOffice,
  type NamedArea,
  signedInOffice,
  untilTheRightsAreKnown,
} from './test-office.js'

/**
 * The help in the office (#131, the board "Hilfe zu dieser Seite"): the
 * question mark of the header opens the text of the page that stands, the
 * drawer leads on to the quick guides, and whoever runs the instance finds
 * the manual in its area.
 *
 * That every page of the navigation has a text is held where the texts are
 * (`help/texts.test.ts`); these go through the screens.
 */

const nord: NamedArea = { id: 'a-nord', name: 'Nord' }

function office(at: string, further: Readonly<Record<string, unknown>> = {}) {
  signedInOffice('management', [nord], further)

  return mountOffice(at, new TestServer(), [])
}

const runsTheInstance = { '/instance/access': { operator: true, secondFactor: true } }

async function openHelp(): Promise<HTMLElement> {
  await untilTheRightsAreKnown()
  await userEvent.click(
    within(screen.getByRole('banner')).getByRole('button', { name: 'Hilfe zu dieser Seite' }),
  )

  return screen.getByRole('complementary', { name: 'Hilfe' })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the help of a page of the office', () => {
  it('opens beside the page with its own text and the steps of its main flow', async () => {
    await office('/rundgaenge')

    const drawer = await openHelp()

    expect(await within(drawer).findByRole('heading', { level: 2, name: 'Rundgänge' })).toBeTruthy()
    expect(within(drawer).getByRole('heading', { level: 3, name: 'Kurzanleitung' })).toBeTruthy()
    expect(within(drawer).getAllByRole('listitem')).toHaveLength(5)
    expect(
      within(drawer).getByText(/Jeder fällige Durchgang ist ein eigener Rundgang/),
    ).toBeTruthy()
  })

  it('reads the text of the list on what lies below it', async () => {
    await office('/rundgaenge/plaene')

    expect(
      await within(await openHelp()).findByRole('heading', { level: 2, name: 'Rundgänge' }),
    ).toBeTruthy()
  })

  it('leads on to the quick guides, and to the manual for nobody who does not run the instance', async () => {
    await office('/aufgaben')

    const drawer = await openHelp()

    await within(drawer).findByRole('heading', { level: 2, name: 'Aufgaben' })

    expect(
      within(drawer)
        .getAllByRole('link')
        .map((link) => [link.textContent, link.getAttribute('href')]),
    ).toEqual([['Kurzanleitungen', '/hilfe']])
  })

  it('leads whoever runs the instance to the manual as well, as the board has it', async () => {
    await office('/aufgaben', runsTheInstance)

    const drawer = await openHelp()

    await waitFor(() => {
      expect(
        within(drawer)
          .getAllByRole('link')
          .map((link) => [link.textContent, link.getAttribute('href')]),
      ).toEqual([
        ['Handbuch öffnen', '/instanz/handbuch'],
        ['Kurzanleitungen', '/hilfe'],
      ])
    })
  })
})

describe('"Hilfe" in the office', () => {
  it('lists the quick guides to the core flows, each with what it is about', async () => {
    await office('/hilfe')

    expect(await screen.findByRole('heading', { level: 1, name: helpWords.title })).toBeTruthy()

    const guides = await screen.findAllByRole('listitem')

    expect(guides.map((guide) => within(guide).getByRole('link').textContent)).toEqual([
      'Rundgang',
      'Bestandsaufnahme',
      'Prüfung mit Bericht',
      'Vom Mangel zum Auftrag',
      'Ablesung',
    ])
    expect(guides.map((guide) => within(guide).getByRole('link').getAttribute('href'))).toEqual([
      '/hilfe/rundgang',
      '/hilfe/bestandsaufnahme',
      '/hilfe/pruefung-mit-bericht',
      '/hilfe/vom-mangel-zum-auftrag',
      '/hilfe/ablesung',
    ])
    expect(within(guides[0] as HTMLElement).getByText(/wiederkehrende Kontrolle/)).toBeTruthy()
    expect(screen.getByText(helpWords.perPage)).toBeTruthy()
  })

  it('shows a guide under its own title, with the way back to the list', async () => {
    await office('/hilfe/vom-mangel-zum-auftrag')

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Vom Mangel zum Auftrag' }),
    ).toBeTruthy()
    // The title stands once: the text is drawn without its own.
    expect(screen.getAllByRole('heading', { name: 'Vom Mangel zum Auftrag' })).toHaveLength(1)
    // No level is left out between the head of the screen and a section
    // of the text, for a reader who goes through a screen by its headings.
    expect(screen.getByRole('heading', { level: 2, name: 'Schritt für Schritt' })).toBeTruthy()
    expect(screen.getByText(/„Nachgeprüft“ schließt ihn/)).toBeTruthy()
    expect(
      screen
        .getAllByRole('link', { name: helpWords.title })
        .every((link) => link.getAttribute('href') === '/hilfe'),
    ).toBe(true)
  })

  it('says so at an address no guide has', async () => {
    await office('/hilfe/gibt-es-nicht')

    expect(await screen.findByText(helpWords.unknown)).toBeTruthy()
  })
})

describe('the manual in the area of the instance', () => {
  it('stands in its navigation and lists the four chapters', async () => {
    await office('/instanz/handbuch', runsTheInstance)

    expect(await screen.findByRole('heading', { level: 1, name: manualWords.title })).toBeTruthy()
    expect(
      screen
        .getAllByRole('link', { name: 'Handbuch' })
        .some((link) => link.getAttribute('href') === '/instanz/handbuch'),
    ).toBe(true)

    const chapters = await screen.findAllByRole('listitem')

    expect(chapters.map((chapter) => within(chapter).getByRole('link').textContent)).toEqual([
      'Installation',
      'Update',
      'Sicherung und Rückspielen',
      'Betreiber anlegen',
    ])
    expect(
      within(chapters[2] as HTMLElement)
        .getByRole('link')
        .getAttribute('href'),
    ).toBe('/instanz/handbuch/sicherung')
  })

  it('shows a chapter with its commands as they are typed', async () => {
    await office('/instanz/handbuch/update', runsTheInstance)

    expect(await screen.findByRole('heading', { level: 1, name: 'Update' })).toBeTruthy()
    expect(screen.getByText('sh docker/start.sh', { selector: 'code' })).toBeTruthy()
    expect(
      screen.getAllByRole('heading').map((heading) => `${heading.tagName} ${heading.textContent}`),
    ).toEqual(['H1 Update', 'H2 Schritt für Schritt', 'H2 Auf den Geräten'])
    expect(screen.getByRole('link', { name: manualWords.back }).getAttribute('href')).toBe(
      '/instanz/handbuch',
    )
  })

  it('says so at an address no chapter has', async () => {
    await office('/instanz/handbuch/gibt-es-nicht', runsTheInstance)

    expect(await screen.findByText(manualWords.unknown)).toBeTruthy()
  })
})
