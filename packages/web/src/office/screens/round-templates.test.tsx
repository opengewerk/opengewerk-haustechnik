import type { CatalogueBundle } from '@opengewerk/haustechnik-domain'
import { TestServer } from '@opengewerk/platform-web/testing'
import { onlineManager } from '@tanstack/react-query'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { servingCatalogue, testCatalogue } from '../../app/test-catalogue.js'
import {
  mountOffice,
  type NamedArea,
  rowsOf,
  signedInOffice,
  untilTheRightsAreKnown,
  type WriteAnswer,
  type Written,
} from '../test-office.js'

/**
 * The templates of the rounds in the office (#112, sections 2.5, 4.5 and 5 of
 * the concept): the list with the templates of the packages, and the editor
 * with its versions. A version is checked before it is sent, against the
 * records of this device, and a running round stays on the version it began
 * in, which is the server's to keep.
 */

const nord: NamedArea = { id: 'a-nord', name: 'Nord' }
const place = { propertyId: 'p-school', areaId: nord.id }

const heater = {
  id: 'as-heater',
  ...place,
  buildingId: 'b-house',
  kind: 'probe.pump',
  number: 'AN-00057',
  name: 'Trinkwassererwärmer',
}
const duty = {
  id: 'd-temperature',
  ...place,
  assetId: heater.id,
  roomId: null,
  kind: null,
  kindVersion: null,
  label: 'Temperatur am Speicheraustritt',
  endsOn: null,
}

const temperature = {
  kind: 'measurement',
  key: 'p1',
  label: 'Temperatur am Speicheraustritt',
  unit: 'degrees_celsius',
  decimals: 1,
  required: true,
  limit: { kind: 'stated', bound: 'at_least', milli: 60_000, source: 'DVGW W 551' },
  about: { kind: 'asset', id: heater.id },
  fulfils: duty.id,
}
const circulation = {
  kind: 'measurement',
  key: 'p2',
  label: 'Rücklauftemperatur der Zirkulation',
  unit: 'degrees_celsius',
  decimals: 1,
  about: { kind: 'asset', id: 'as-gone' },
}
const door = { kind: 'check_point', key: 'p3', label: 'Tür schließt selbsttätig' }

const definition = {
  title: 'Technikzentrale Schulhaus',
  sections: [
    { key: 'k1', title: 'Heizraum E.14', fields: [temperature, door] },
    { key: 'k2', title: 'Unterverteilung', fields: [{ kind: 'photo', key: 'p4', label: 'Foto' }] },
  ],
}

const template = {
  id: 't-school',
  title: 'Technikzentrale Schulhaus',
  sourceKey: null,
  sourceVersion: null,
}

function versionOf(formVersion: number, of: object, asks = true) {
  return {
    id: `v-${String(formVersion)}`,
    templateId: template.id,
    formVersion,
    definition: JSON.stringify(of),
    asksCountersignature: asks,
    createdAt: `2026-0${String(formVersion + 5)}-14T08:00:00.000Z`,
  }
}

/** The test catalogue with a template of a round that has points, to take over. */
const catalogue: CatalogueBundle = {
  ...testCatalogue,
  packages: testCatalogue.packages.map((pack, index) =>
    index === 0
      ? {
          ...pack,
          roundTemplates: pack.roundTemplates.map((entry) => ({
            ...entry,
            definition: {
              title: 'Rundgang durch die Technikzentrale',
              sections: [
                {
                  key: 'look',
                  title: 'Sichtprüfung',
                  fields: [{ kind: 'check_point', key: 'leak', label: 'Keine Tropfen' }],
                },
              ],
            },
          })),
        }
      : pack,
  ),
}

const everything = [
  'assets',
  'rooms',
  'duties',
  'activities',
  'round_templates',
  'round_template_versions',
]

let server: TestServer
let answerToWrite: (write: Written) => WriteAnswer
let written: Written[]

function signedIn(role: Parameters<typeof signedInOffice>[0]) {
  written = signedInOffice(
    role,
    [nord],
    {
      ...servingCatalogue(catalogue),
      '/round-templates/rounds': [{ templateId: template.id, formVersion: 2, rounds: 4 }],
    },
    (write) => answerToWrite(write),
  )
}

beforeEach(() => {
  localStorage.clear()
  server = new TestServer()
  answerToWrite = () => ({ status: 500, body: { message: 'Nicht erwartet.' } })
  server.put('assets', heater)
  server.put('duties', duty)
  server.put('round_templates', template)
  server.put(
    'round_template_versions',
    versionOf(1, { ...definition, title: 'Erste Fassung' }, false),
  )
  server.put('round_template_versions', versionOf(2, definition))
  signedIn('site_management')
})

afterEach(() => {
  vi.unstubAllGlobals()
  onlineManager.setOnline(true)
})

describe('the list of the templates', () => {
  it('lists the templates with their version and what they ask, and those of the packages to take over', async () => {
    await mountOffice('/rundgaenge', server, everything)
    await screen.findByRole('heading', { name: 'Vorlagen', level: 1 })

    await waitFor(() => {
      expect(
        rowsOf('Vorlagen der Rundgänge mit Fassung, Gegenzeichnung und Zahl der Rundgänge'),
      ).toEqual([
        [
          'Technikzentrale Schulhaus2 Kapitel, 3 Punkte',
          'Fassung 2seit 14.07.2026',
          'verlangt',
          '4',
        ],
      ])
    })
    expect(await screen.findByRole('button', { name: 'Übernehmen und anpassen' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Neue Vorlage' })).toBeTruthy()
  })

  it('offers nothing to make or take over to whoever only performs', async () => {
    signedIn('technician')
    await mountOffice('/rundgaenge/vorlagen', server, everything)
    await untilTheRightsAreKnown()
    await screen.findByText('Rundgang durch die Technikzentrale')

    expect(screen.queryByRole('button', { name: 'Neue Vorlage' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Übernehmen und anpassen' })).toBeNull()
  })
})

describe('the editor of a template', () => {
  async function opened() {
    await mountOffice(`/rundgaenge/vorlagen/${template.id}`, server, everything)
    await screen.findByRole('heading', { name: 'Technikzentrale Schulhaus', level: 1 })
    await untilTheRightsAreKnown()
  }

  it('makes a point at an asset that is gone stand out before anybody saves', async () => {
    server.put(
      'round_template_versions',
      versionOf(3, {
        ...definition,
        sections: [{ ...definition.sections[0], fields: [circulation] }],
      }),
    )
    await opened()

    expect(await screen.findByText('Anlage nicht gefunden')).toBeTruthy()
    expect(
      screen.getByText('Die Anlage gibt es nicht mehr oder nicht in Ihren Bereichen.'),
    ).toBeTruthy()
  })

  it('names the point and the reason of a version the form engine refuses, and sends nothing', async () => {
    server.put(
      'round_template_versions',
      versionOf(3, {
        ...definition,
        sections: [
          {
            ...definition.sections[0],
            fields: [{ ...temperature, decimals: 4, fulfils: undefined }],
          },
        ],
      }),
    )
    await opened()

    const user = userEvent.setup()
    const title = await screen.findByRole('textbox', { name: /Bezeichnung/ })

    await user.type(title, ' neu')
    await user.click(screen.getByRole('button', { name: 'Als neue Fassung speichern' }))

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Die Vorlage ist nicht gespeichert. „Temperatur am Speicheraustritt“ zeigt null bis drei Nachkommastellen.',
    )
    expect(written).toEqual([])
  })

  it('saves the next version on the one it began from, with what it asks', async () => {
    answerToWrite = () => ({ status: 201, body: { id: template.id, formVersion: 3 } })
    await opened()

    const user = userEvent.setup()

    expect(
      (screen.getByRole('button', { name: 'Als neue Fassung speichern' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)

    await user.click(screen.getByRole('checkbox', { name: /Gegenzeichnung der Objektleitung/ }))
    await user.click(screen.getByRole('button', { name: 'Als neue Fassung speichern' }))

    await waitFor(() => {
      expect(written).toHaveLength(1)
    })
    expect(written[0]).toMatchObject({
      method: 'POST',
      path: `/round-templates/${template.id}/versions`,
      body: { basedOn: 2, asksCountersignature: false, definition },
    })
  })

  it('moves a point with the keyboard, across the edge of its chapter, and gives it back with Escape', async () => {
    await opened()

    const user = userEvent.setup()
    const points = () =>
      [...document.querySelectorAll('[data-point]')].map((row) => row.getAttribute('data-point'))
    const handle = screen.getByRole('button', { name: 'Tür schließt selbsttätig verschieben' })

    expect(points()).toEqual(['p1', 'p3', 'p4'])

    handle.focus()
    await user.keyboard(' ')
    await user.keyboard('{ArrowUp}')
    expect(points()).toEqual(['p3', 'p1', 'p4'])

    await user.keyboard('{Escape}')
    expect(points()).toEqual(['p1', 'p3', 'p4'])

    // At the end of its chapter it goes on into the next one, at its start.
    screen.getByRole('button', { name: 'Tür schließt selbsttätig verschieben' }).focus()
    await user.keyboard(' {ArrowDown} ')

    const next = screen.getByRole('heading', { name: 'Unterverteilung' }).closest('section')

    expect(within(next as HTMLElement).getByText('Tür schließt selbsttätig')).toBeTruthy()
    expect(
      screen.getByText(
        /Tür schließt selbsttätig abgelegt\. Stelle 1 von 2 im Kapitel „Unterverteilung“\./,
      ),
    ).toBeTruthy()
  })

  it('adds a point through its dialog', async () => {
    await opened()

    const user = userEvent.setup()
    const chapter = screen.getByRole('heading', { name: 'Unterverteilung' }).closest('section')

    await user.click(
      within(chapter as HTMLElement).getByRole('button', { name: 'Punkt hinzufügen' }),
    )

    const dialog = await screen.findByRole('dialog', { name: 'Punkt hinzufügen' })

    await user.type(
      within(dialog).getByRole('textbox', { name: /^Bezeichnung/ }),
      'Schaltschrank zu',
    )
    await user.click(within(dialog).getByRole('button', { name: 'Übernehmen' }))

    expect(await screen.findByText('Schaltschrank zu')).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: 'Als neue Fassung speichern' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false)
  })

  it('shows a template to read to whoever only performs, without a handle or a way to change it', async () => {
    signedIn('technician')
    await opened()

    expect(screen.getByText('Tür schließt selbsttätig')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /verschieben$/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Als neue Fassung speichern' })).toBeNull()
  })
})

describe('a template taken over from a package', () => {
  it('begins with the points of the package and names it when it is saved', async () => {
    answerToWrite = () => ({ status: 201, body: { id: 't-new', formVersion: 1 } })
    await mountOffice('/rundgaenge/vorlagen/neu?aus=probe.weekly_round', server, everything)
    await untilTheRightsAreKnown()

    expect(await screen.findByText('Keine Tropfen')).toBeTruthy()

    const user = userEvent.setup()

    // It begins with the title of the package, which the operator gives a name of their own.
    const title = screen.getByRole('textbox', { name: /Bezeichnung/ })

    expect((title as HTMLInputElement).value).toBe('Rundgang durch die Technikzentrale')
    await user.clear(title)
    await user.type(title, 'Technik, wöchentlich')
    await user.click(screen.getByRole('button', { name: 'Als Fassung 1 speichern' }))

    await waitFor(() => {
      expect(written).toHaveLength(1)
    })
    expect(written[0]).toMatchObject({
      method: 'POST',
      path: '/round-templates',
      body: {
        sourceKey: 'probe.weekly_round',
        asksCountersignature: false,
        definition: { title: 'Technik, wöchentlich' },
      },
    })
  })
})
