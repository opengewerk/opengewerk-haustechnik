import type { CatalogueBundle, CatalogueRule } from '@opengewerk/haustechnik-domain'
import { updatesHeld } from '@opengewerk/platform-web/shell'
import { TestServer } from '@opengewerk/platform-web/testing'
import { onlineManager } from '@tanstack/react-query'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  acceptedReview,
  mainTest,
  servingCatalogue,
  testCatalogue,
} from '../../app/test-catalogue.js'
import {
  mountOffice,
  type NamedArea,
  rowsOf,
  servingTables,
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

const someRule = testCatalogue.packages.flatMap((pack) => pack.rules)[0]!

/** A rule a point in degrees can be measured by, to choose in the dialog. */
const hotWaterMaximum: CatalogueRule = {
  ...someRule,
  record: {
    ...someRule.record,
    key: 'probe.hot_water_maximum',
    validFrom: '2015-06-01',
    validUntil: null,
    unit: 'decidegrees_celsius',
    value: 700,
    source: 'DVGW W 551',
  },
}

/** A look at every elevator on a round, which a point of a round takes as its evidence (#343). */
const elevatorLook = {
  key: 'probe.elevator_look',
  version: 1,
  validFrom: '2015-06-01',
  definition: {
    ...mainTest,
    label: 'Sichtkontrolle des Aufzugs',
    evidence: { kinds: ['round_point' as const] },
    scope: { assetKinds: ['probe.elevator'], conditions: [], buildingKinds: [], states: [] },
  },
  review: acceptedReview,
}

/** The test catalogue with a template of a round that has points, to take over. */
const catalogue: CatalogueBundle = {
  ...testCatalogue,
  packages: testCatalogue.packages.map((pack, index) =>
    index === 0
      ? {
          ...pack,
          dutyKinds: [...pack.dutyKinds, elevatorLook],
          rules: [...pack.rules, hotWaterMaximum],
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
    await mountOffice('/rundgaenge/vorlagen', server, everything)
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
    expect(screen.queryByRole('button', { name: 'Importieren' })).toBeNull()
  })

  it('leads whoever keeps the templates to their import (#130)', async () => {
    const { router } = await mountOffice('/rundgaenge/vorlagen', server, everything)

    fireEvent.click(await screen.findByRole('button', { name: 'Importieren' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/rundgaenge/vorlagen/importieren')
    })
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

  it('holds a new version of the application while a point moved is not saved, and lets it go once it is (#465)', async () => {
    answerToWrite = (write) => {
      const { definition: saved } = write.body as { readonly definition: object }

      server.put('round_template_versions', versionOf(3, saved))

      return { status: 201, body: { id: template.id, formVersion: 3 } }
    }
    await opened()

    const user = userEvent.setup()

    expect(updatesHeld()).toBe(false)

    // Pressed, not typed: the hold of the foundation for what was typed does not see it.
    screen.getByRole('button', { name: 'Tür schließt selbsttätig verschieben' }).focus()
    await user.keyboard(' {ArrowUp} ')

    expect(updatesHeld()).toBe(true)

    await user.click(screen.getByRole('button', { name: 'Als neue Fassung speichern' }))

    await waitFor(() => {
      expect(updatesHeld()).toBe(false)
    })
    expect(written).toHaveLength(1)
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

  /** Opens the dialog of the point that measures the temperature. */
  async function editTemperature(user: ReturnType<typeof userEvent.setup>) {
    const row = document.querySelector('[data-point="p1"]') as HTMLElement

    await user.click(within(row).getByRole('button', { name: 'Bearbeiten' }))

    return screen.findByRole('dialog', { name: 'Punkt bearbeiten' })
  }

  /** Saves the draft and hands back the limit the point that measures the temperature was sent with. */
  async function savedLimit(user: ReturnType<typeof userEvent.setup>) {
    answerToWrite = () => ({ status: 201, body: { id: template.id, formVersion: 3 } })
    await user.click(screen.getByRole('button', { name: 'Als neue Fassung speichern' }))
    await waitFor(() => {
      expect(written).toHaveLength(1)
    })

    const sent = (written[0]?.body as { definition: typeof definition }).definition

    return (sent.sections[0]?.fields[0] as { limit?: unknown }).limit
  }

  it('asks a point about every asset of a kind, fulfils a duty kind at each of them, and sends both (#343)', async () => {
    await opened()

    const user = userEvent.setup()
    const row = document.querySelector('[data-point="p3"]') as HTMLElement

    await user.click(within(row).getByRole('button', { name: 'Bearbeiten' }))

    const dialog = await screen.findByRole('dialog', { name: 'Punkt bearbeiten' })

    await user.click(within(dialog).getByRole('radio', { name: 'Jede Anlage einer Art' }))

    const kind = within(dialog).getByRole('combobox', { name: /^Anlagenart/ }) as HTMLSelectElement

    expect(kind.value).toBe('probe.elevator')
    expect([...kind.options].map((option) => option.text)).toEqual(
      expect.arrayContaining(['Aufzugsanlage, Probepaket', 'Druckerhöhungsanlage, Probepaket']),
    )

    const duty = within(dialog).getByRole('combobox', {
      name: /^Erfüllt die Pflicht/,
    }) as HTMLSelectElement

    // Only the duty kinds of the kind that take a point of a round.
    expect([...duty.options].map((option) => option.text)).toEqual([
      'Keine',
      'Sichtkontrolle des Aufzugs',
    ])

    await user.selectOptions(duty, 'probe.elevator_look')
    await user.click(within(dialog).getByRole('button', { name: 'Übernehmen' }))

    const changed = document.querySelector('[data-point="p3"]') as HTMLElement

    expect(within(changed).getByText(/Jede Anlage: Aufzugsanlage$/)).toBeTruthy()
    expect(within(changed).getByText(/erfüllt Sichtkontrolle des Aufzugs, je Anlage/)).toBeTruthy()
    expect(within(changed).getByText(/je Anlage eine Antwort/)).toBeTruthy()

    answerToWrite = () => ({ status: 201, body: { id: template.id, formVersion: 3 } })
    await user.click(screen.getByRole('button', { name: 'Als neue Fassung speichern' }))
    await waitFor(() => {
      expect(written).toHaveLength(1)
    })

    const sent = (written[0]?.body as { definition: typeof definition }).definition

    expect(sent.sections[0]?.fields[1]).toEqual({
      kind: 'check_point',
      key: 'p3',
      label: 'Tür schließt selbsttätig',
      everyAssetOf: 'probe.elevator',
      fulfilsKind: 'probe.elevator_look',
    })
  })

  it('sends a value of its own a value has to stay under, and says it so in the list (#299)', async () => {
    await opened()

    const user = userEvent.setup()
    const dialog = await editTemperature(user)

    await user.selectOptions(within(dialog).getByRole('combobox', { name: /^Grenze/ }), 'unter')
    await user.click(within(dialog).getByRole('button', { name: 'Übernehmen' }))

    expect(await screen.findByText(/Grenzwert unter 60,0 °C, DVGW W 551/)).toBeTruthy()
    expect(await savedLimit(user)).toEqual({
      kind: 'stated',
      bound: 'below',
      milli: 60_000,
      source: 'DVGW W 551',
    })
  })

  it('keeps the bound of a limit from a rule when its point is opened again (#299)', async () => {
    await opened()

    const user = userEvent.setup()
    const first = await editTemperature(user)

    await user.click(within(first).getByRole('radio', { name: 'Regel eines Pakets' }))
    await user.selectOptions(
      within(first).getByRole('combobox', { name: /^Regel/ }),
      'probe.hot_water_maximum, DVGW W 551',
    )
    await user.selectOptions(within(first).getByRole('combobox', { name: /^Grenze/ }), 'unter')
    await user.click(within(first).getByRole('button', { name: 'Übernehmen' }))

    // Opened again and taken as it stands, the point still has to stay under the rule.
    const again = await editTemperature(user)

    expect(
      (within(again).getByRole('combobox', { name: /^Grenze/ }) as HTMLSelectElement).value,
    ).toBe('below')
    await user.click(within(again).getByRole('button', { name: 'Übernehmen' }))

    expect(await savedLimit(user)).toEqual({ kind: 'below', rule: 'probe.hot_water_maximum' })
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

describe('the templates as a table (#236)', () => {
  it('are asked for as the list shows them', async () => {
    await mountOffice('/rundgaenge/vorlagen', server, everything)

    const button = await screen.findByRole('button', { name: 'Als Tabelle' })
    // After the answers of the test, which it hands every other request to.
    const tables = servingTables()

    fireEvent.click(button)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Excel (.xlsx)' }))

    await waitFor(() => {
      expect(tables.asked).toEqual(['/round-templates/table?format=xlsx'])
    })
  })
})
