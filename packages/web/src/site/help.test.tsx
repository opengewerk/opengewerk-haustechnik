import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { siteHelpWords } from './help.js'
import { afterEachSiteTest, goOffline, mountSite, schoolServer } from './test-site.js'

/**
 * The help on site (#131): the last row of the menu, a text for each screen
 * of the tabs and the menu, and the quick guides. The texts are part of the
 * build and are read without a network.
 */

async function theMenu(): Promise<HTMLElement> {
  await userEvent.click((await screen.findAllByRole('button', { name: /Menü/ }))[0] as HTMLElement)

  return screen.findByRole('dialog', { name: 'Menü' })
}

afterEach(() => {
  afterEachSiteTest()
})

describe('the help in the menu on site', () => {
  it('is a row of the menu that leads to the help', async () => {
    const site = await mountSite('/')
    const menu = await theMenu()

    await userEvent.click(within(menu).getByRole('link', { name: siteHelpWords.title }))

    expect(await screen.findByRole('heading', { name: siteHelpWords.title })).toBeTruthy()
    expect(site.router.state.location.pathname).toBe('/hilfe')
  })
})

describe('"Hilfe" on site', () => {
  it('lists a text for each screen and the quick guides', async () => {
    await mountSite('/hilfe')

    const screens = await screen.findByRole('list', { name: siteHelpWords.screens })
    const guides = screen.getByRole('list', { name: siteHelpWords.guides })
    const rows = (list: HTMLElement) =>
      within(list)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href'))

    expect(rows(screens)).toEqual([
      '/m/hilfe/bildschirm/index',
      '/m/hilfe/bildschirm/scannen',
      '/m/hilfe/bildschirm/aufnehmen',
      '/m/hilfe/bildschirm/konflikte',
      '/m/hilfe/bildschirm/aufgaben',
      '/m/hilfe/bildschirm/meldungen',
    ])
    expect(within(screens).getByRole('link', { name: /Start/ })).toBeTruthy()
    expect(rows(guides)).toEqual([
      '/m/hilfe/rundgang',
      '/m/hilfe/bestandsaufnahme',
      '/m/hilfe/pruefung-mit-bericht',
      '/m/hilfe/vom-mangel-zum-auftrag',
      '/m/hilfe/ablesung',
    ])
    expect(screen.getByText(siteHelpWords.offline)).toBeTruthy()
  })

  it('shows the text of a screen under its title, with the way back', async () => {
    await mountSite('/hilfe/bildschirm/scannen')

    expect(await screen.findByRole('heading', { name: 'Scannen' })).toBeTruthy()
    expect(screen.getByText(/Halten Sie die Kamera auf das Etikett/)).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Scannen' }).tagName).toBe('H1')
    expect(screen.getAllByRole('listitem')).toHaveLength(4)
    expect(screen.getByRole('link', { name: siteHelpWords.title }).getAttribute('href')).toBe(
      '/m/hilfe',
    )
  })

  it('shows a quick guide without a network', async () => {
    const server = schoolServer()

    await mountSite('/', { server })
    goOffline(server)

    const menu = await theMenu()

    await userEvent.click(within(menu).getByRole('link', { name: siteHelpWords.title }))
    await userEvent.click(
      within(await screen.findByRole('list', { name: siteHelpWords.guides })).getByRole('link', {
        name: /^Ablesung/,
      }),
    )

    expect(await screen.findByRole('heading', { name: 'Ablesung' })).toBeTruthy()
    expect(screen.getByText(/„So übernehmen“ bestätigt ihn/)).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: 'Schritt für Schritt' })).toBeTruthy()
  })

  it('says so at an address no text has', async () => {
    await mountSite('/hilfe/gibt-es-nicht')

    expect(await screen.findByText(siteHelpWords.unknown)).toBeTruthy()
  })
})
