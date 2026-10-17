import { roleKeys, shippedRoles } from '@opengewerk/haustechnik-domain'
import type { RoleKey } from '@opengewerk/haustechnik-domain'
import { createRootRoute, createRoute, Outlet } from '@tanstack/react-router'
import { screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { offered } from '../app/places.js'
import { memberIn, mounted, signedInAs, tenantName } from '../app/test-entry.js'
import { officeApplication } from './application.js'
import { officeFoot, officeNavigation } from './navigation.js'
import { officeRoutes } from './router.js'
import { OfficeShell } from './shell.js'

/**
 * The navigation of the office (#83): the places of the board "Navigation mit
 * dem Pfad", each from the moment its screen is built and for whoever holds
 * its right. One test per role, as the issue asks, against the rights the
 * roles are shipped with.
 */

const everyPlace = [...officeNavigation.flatMap((group) => group.entries), ...officeFoot]

/** What a role is offered once every screen of the board is built. */
function offeredTo(role: RoleKey): string[] {
  const rights = shippedRoles.find((shipped) => shipped.key === role)?.rights ?? []

  return offered(everyPlace, rights, () => true).map((place) => place.label)
}

const whole = [
  'Übersicht',
  'Auswertungen',
  'Liegenschaften',
  'Anlagen',
  'Zähler',
  'Dokumente',
  'Pflichtenverzeichnis',
  'Fristen',
  'Prüfungen',
  'Rundgänge',
  'Störungen',
  'Mängel',
  'Aufträge',
  'Aufgaben',
  'Lager',
  'Fremdfirmen',
  'Verträge',
  'Katalog',
]

describe('the navigation of the board', () => {
  it('has the overview first, the three groups in their order and the catalogue at the foot', () => {
    expect(officeNavigation.map((group) => group.title)).toEqual([
      undefined,
      'Bestand',
      'Pflichten',
      'Arbeit',
    ])
    expect(officeNavigation.map((group) => group.entries.map((place) => place.label))).toEqual([
      ['Übersicht', 'Auswertungen'],
      ['Liegenschaften', 'Anlagen', 'Zähler', 'Dokumente'],
      ['Pflichtenverzeichnis', 'Fristen', 'Prüfungen'],
      [
        'Rundgänge',
        'Störungen',
        'Mängel',
        'Aufträge',
        'Aufgaben',
        'Lager',
        'Fremdfirmen',
        'Verträge',
      ],
    ])
    expect(officeFoot.map((place) => place.label)).toEqual(['Katalog'])
  })

  it('leads every place to an address of its own', () => {
    const addresses = everyPlace.map((place) => place.to)

    expect(new Set(addresses).size).toBe(addresses.length)
    expect(addresses.every((address) => address.startsWith('/'))).toBe(true)
  })
})

describe('what a role is offered once every screen is built', () => {
  it('is everything for the Leitung', () => {
    expect(offeredTo('management')).toEqual(whole)
  })

  it('is everything for the Technische Leitung', () => {
    expect(offeredTo('technical_management')).toEqual(whole)
  })

  // The figures over time are for the Leitung and the Technische Leitung (#334).
  it('is everything but the deadlines and the figures for the Objektleitung', () => {
    expect(offeredTo('site_management')).toEqual(
      whole.filter((label) => !['Fristen', 'Auswertungen'].includes(label)),
    )
  })

  // As the board says it: "der Rolle Haustechnik fehlen Fristen und
  // Einstellungen". The settings are the frame's and stand in the tests below.
  it('is everything but the deadlines, the faults, the contracts and the figures for the Haustechnik', () => {
    expect(offeredTo('technician')).toEqual(
      whole.filter(
        (label) => !['Fristen', 'Störungen', 'Verträge', 'Auswertungen'].includes(label),
      ),
    )
  })

  // The Melder works on site, and the office offers it nothing (#331).
  it('is the catalogue alone for the Melder', () => {
    expect(offeredTo('reporter')).toEqual(['Katalog'])
  })

  it('is nothing that takes a right for somebody who holds none', () => {
    // The overview counts duties, and asks for the right to read them (#122).
    expect(offered(everyPlace, [], () => true).map((place) => place.label)).toEqual(['Katalog'])
  })

  it('is nothing at all before a screen is built', () => {
    for (const role of roleKeys) {
      const rights = shippedRoles.find((shipped) => shipped.key === role)?.rights ?? []

      expect(offered(everyPlace, rights, () => false)).toEqual([])
    }
  })
})

/** The links of the navigation beside the screen, as a reader meets them. */
function links(): (string | null)[] {
  const navigation = screen.getByRole('navigation', { name: 'Hauptbereiche' })

  return within(navigation)
    .getAllByRole('link')
    .map((link) => link.getAttribute('aria-label') ?? link.textContent)
}

/** What stands over the places in small capitals. */
function titles(): (string | null)[] {
  const navigation = screen.getByRole('navigation', { name: 'Hauptbereiche' })

  return [...navigation.querySelectorAll('div')]
    .filter((element) => element.className.split(' ').includes('uppercase'))
    .map((element) => element.textContent)
}

/** The rights have arrived once the tenant stands in the header: both come with the same answer. */
async function untilTheRightsAreKnown(): Promise<void> {
  await within(screen.getByRole('banner')).findByText(tenantName)
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the navigation of the office as it is built today', () => {
  /**
   * The properties are the first screen of the board that is built (#85) and
   * the register of assets the second (#87), so the navigation is their two
   * places under "Bestand" over the foot of the frame, and the catalogue
   * stands at the foot since its screen is built (#90). The register of
   * duties is the first place under "Pflichten" (#101), and the documents
   * stand under "Bestand" since their screen is built (#97). Every role reads
   * places, assets, documents and duties, and the catalogue is the same for
   * everybody. The deadlines follow the register of duties for whoever looks
   * after them (#104), and with their settings so does "Einstellungen". The
   * defects stand under "Arbeit" for every role (#116), the work orders
   * after them (#117), the tasks (#124), and the stores last (#325), which is
   * every place of the board.
   */
  const built = [
    // The overview of the operator's responsibility, for every role (#122).
    'Übersicht',
    'Liegenschaften',
    'Anlagen',
    'Zähler',
    'Dokumente',
    'Pflichtenverzeichnis',
    // The inspections and the maintenance, for every role (#105).
    'Prüfungen',
    // The templates of the rounds, for every role (#112).
    'Rundgänge',
    // The defects, for every role (#116).
    'Mängel',
    // The work orders, for every role (#117).
    'Aufträge',
    // The tasks, for every role (#124).
    'Aufgaben',
    // The stores, for every role to look at (#325).
    'Lager',
    'Fremdfirmen',
    'Katalog',
    'Abgleich',
  ]
  // The deadlines and their settings for whoever looks after them (#104).
  const withDeadlines = [
    'Übersicht',
    // The figures over time, for whoever may look at them (#334).
    'Auswertungen',
    'Liegenschaften',
    'Anlagen',
    'Zähler',
    'Dokumente',
    'Pflichtenverzeichnis',
    'Fristen',
    'Prüfungen',
    'Rundgänge',
    // The inbox of the faults, for whoever accepts them (#331).
    'Störungen',
    'Mängel',
    'Aufträge',
    'Aufgaben',
    'Lager',
    'Fremdfirmen',
    // The contracts, from the Objektleitung on (#329).
    'Verträge',
    'Katalog',
    'Abgleich',
    'Einstellungen',
  ]
  const today: readonly (readonly [RoleKey, readonly string[]])[] = [
    ['management', withDeadlines],
    ['technical_management', withDeadlines],
    [
      'site_management',
      [
        ...built.slice(0, built.indexOf('Rundgänge') + 1),
        'Störungen',
        ...built.slice(built.indexOf('Rundgänge') + 1, built.indexOf('Fremdfirmen') + 1),
        'Verträge',
        ...built.slice(built.indexOf('Fremdfirmen') + 1),
      ],
    ],
    ['technician', built],
  ]

  it.each(today)('offers %s the properties over the foot: %j', async (role, expected) => {
    signedInAs(memberIn(role))
    await mounted({ routeTree: officeRoutes(), at: '/konflikte', application: officeApplication })
    await untilTheRightsAreKnown()
    await screen.findByRole('link', { name: 'Liegenschaften' })

    if (expected.includes('Einstellungen')) {
      await screen.findByRole('link', { name: 'Einstellungen' })
    }

    expect(links()).toEqual(expected)
    expect(titles()).toEqual(['Bestand', 'Pflichten', 'Arbeit'])
  })
})

/**
 * The office with four of its places built: the overview, the properties, the
 * deadlines and the catalogue, around the shell of this application.
 */
function officeWithFourPlaces() {
  const root = createRootRoute({ component: Outlet })
  const office = createRoute({ getParentRoute: () => root, id: 'office', component: OfficeShell })
  const screens = {
    '/': 'Übersicht',
    '/liegenschaften': 'Liegenschaften',
    '/fristen': 'Fristen',
    '/katalog': 'Katalog',
    '/konflikte': 'Abgleich',
    '/einstellungen': 'Einstellungen',
  }

  return root.addChildren([
    office.addChildren(
      Object.entries(screens).map(([path, title]) =>
        createRoute({ getParentRoute: () => office, path, component: () => <h1>{title}</h1> }),
      ),
    ),
  ])
}

describe('a place whose screen is built', () => {
  const withFourBuilt: readonly (readonly [RoleKey, readonly string[], readonly string[]])[] = [
    [
      'management',
      ['Übersicht', 'Liegenschaften', 'Fristen', 'Katalog', 'Abgleich', 'Einstellungen'],
      ['Bestand', 'Pflichten'],
    ],
    [
      'technical_management',
      ['Übersicht', 'Liegenschaften', 'Fristen', 'Katalog', 'Abgleich', 'Einstellungen'],
      ['Bestand', 'Pflichten'],
    ],
    // Without the right to the deadlines their place is not there, and the
    // group goes with it, since nothing else of it is built.
    ['site_management', ['Übersicht', 'Liegenschaften', 'Katalog', 'Abgleich'], ['Bestand']],
    ['technician', ['Übersicht', 'Liegenschaften', 'Katalog', 'Abgleich'], ['Bestand']],
  ]

  it.each(withFourBuilt)(
    'stands for %s where its right is held: %j',
    async (role, expected, groups) => {
      signedInAs(memberIn(role))
      await mounted({
        routeTree: officeWithFourPlaces(),
        at: '/konflikte',
        application: officeApplication,
      })
      await untilTheRightsAreKnown()
      await screen.findByRole('link', { name: 'Liegenschaften' })

      expect(links()).toEqual(expected)
      expect(titles()).toEqual(groups)
    },
  )

  it('stands before the groups without a title where it is the overview, and quietly at the foot where it is the catalogue', async () => {
    signedInAs(memberIn('technician'))
    await mounted({
      routeTree: officeWithFourPlaces(),
      at: '/konflikte',
      application: officeApplication,
    })
    await untilTheRightsAreKnown()
    await screen.findByRole('link', { name: 'Liegenschaften' })

    const navigation = screen.getByRole('navigation', { name: 'Hauptbereiche' })
    const classes = (name: string) =>
      within(navigation).getByRole('link', { name }).className.split(' ')

    expect(navigation.firstElementChild).toBe(
      within(navigation).getByRole('link', { name: 'Übersicht' }),
    )
    expect(classes('Katalog')).toContain('text-ink-muted')
    expect(classes('Liegenschaften')).not.toContain('text-ink-muted')
  })

  it('is lit on its own screen', async () => {
    signedInAs(memberIn('technical_management'))
    await mounted({
      routeTree: officeWithFourPlaces(),
      at: '/fristen',
      application: officeApplication,
    })
    await untilTheRightsAreKnown()

    expect(
      (await screen.findByRole('link', { name: 'Fristen' })).getAttribute('aria-current'),
    ).toBe('page')
    expect(screen.getByRole('link', { name: 'Übersicht' }).getAttribute('aria-current')).toBeNull()
  })
})
