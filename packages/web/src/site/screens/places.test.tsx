import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { afterEachSiteTest, heater, mountSite, queued, rod, schoolServer } from '../test-site.js'

/**
 * The plain pages of the places on site and of an asset (#99, 4.1 and 4.2 of
 * the concept): each with what lies below it, under the path that leads up,
 * read from the device. And what they offer to whom: taking stock to whoever
 * holds its right, and the label of an asset once.
 */

afterEach(afterEachSiteTest)

const texts = (elements: readonly HTMLElement[]) => elements.map((each) => each.textContent)
const rowsOf = (name: string) =>
  texts(within(screen.getByRole('list', { name })).getAllByRole('listitem'))

describe('the start of taking stock', () => {
  it('lists the buildings the device holds by property, each leading to its page', async () => {
    await mountSite('/aufnehmen')

    expect(screen.getByRole('heading', { level: 1, name: 'Aufnehmen' })).toBeTruthy()

    const ofTheSchool = screen.getByRole('region', { name: 'Schulzentrum Am Lindenhain' })

    expect(
      within(ofTheSchool)
        .getByRole('link', { name: /Schulhaus/ })
        .getAttribute('href'),
    ).toBe('/m/gebaeude/b-house')
    expect(
      within(screen.getByRole('region', { name: 'Sporthalle Süd' }))
        .getByRole('link', { name: /Sporthalle/ })
        .getAttribute('href'),
    ).toBe('/m/gebaeude/b-gym')
  })
})

describe('a property on site', () => {
  it('says what to know before the way there, lists its buildings and names whom to call', async () => {
    await mountSite('/liegenschaften/p-school')

    expect(
      screen.getByRole('heading', { level: 1, name: 'Schulzentrum Am Lindenhain' }),
    ).toBeTruthy()
    expect(screen.getByText('Am Lindenhain 7, 00003 Musterhausen')).toBeTruthy()
    expect(
      within(screen.getByRole('region', { name: 'Vor dem Weg' })).getByText(
        'Zufahrt über den Lehrerparkplatz.',
      ),
    ).toBeTruthy()
    expect(rowsOf('Gebäude')).toEqual([expect.stringMatching(/^SchulhausSH/)])
    expect(
      within(screen.getByRole('region', { name: 'Ansprechpartner' })).getByText(/Klaus Becker/),
    ).toBeTruthy()
  })
})

describe('a building on site', () => {
  it('lists its floors from the ground up with their rooms, and the assets that stand in no room', async () => {
    await mountSite('/gebaeude/b-house')

    expect(screen.getByRole('heading', { level: 1, name: 'Schulhaus' })).toBeTruthy()
    expect(
      screen.getByRole('link', { name: 'Schulzentrum Am Lindenhain' }).getAttribute('href'),
    ).toBe('/m/liegenschaften/p-school')
    expect(rowsOf('Geschosse')).toEqual(['Erdgeschoss2 Räume', '1. ObergeschossNoch kein Raum'])
    // The kind comes from the catalogue, which the device fetches after it starts.
    await waitFor(() => {
      expect(rowsOf('Anlagen ohne Raum')).toEqual(['AN-00046 BlitzschutzanlageAufzugsanlage'])
    })
  })

  it.each([
    [['asset.read', 'asset.record'], true],
    [['asset.read'], false],
  ] as const)(
    'offers "Anlage aufnehmen" to whoever takes assets into the register (%j: %s)',
    async (rights, offered) => {
      const { router } = await mountSite('/gebaeude/b-house', { rights })
      const button = screen.queryByRole('button', { name: 'Anlage aufnehmen' })

      expect(button !== null).toBe(offered)

      if (button) {
        fireEvent.click(button)
        await waitFor(() => {
          expect(router.state.location.pathname).toBe('/aufnehmen/gebaeude/b-house')
        })
      }
    },
  )
})

describe('a floor on site', () => {
  it('lists its rooms by number with what they are used as and how many assets stand there', async () => {
    await mountSite('/geschosse/f-ground')

    expect(screen.getByRole('heading', { level: 1, name: 'Erdgeschoss' })).toBeTruthy()
    expect(rowsOf('Räume')).toEqual(['E.14 HeizraumHaustechnik · 2 Anlagen', 'E.15 Lager1 Anlage'])
    expect(screen.getByRole('link', { name: 'Schulhaus' }).getAttribute('href')).toBe(
      '/m/gebaeude/b-house',
    )
  })

  it.each([
    [['room.record'], true],
    [['asset.read'], false],
  ] as const)(
    'offers "Raum aufnehmen" to whoever takes rooms into the register (%j: %s)',
    async (rights, offered) => {
      await mountSite('/geschosse/f-ground', { rights })

      expect(screen.queryByRole('button', { name: 'Raum aufnehmen' }) !== null).toBe(offered)
    },
  )
})

describe('a room on site', () => {
  it('lists what stands there and what supplies it, and of the defects the open ones', async () => {
    await mountSite('/raeume/r-boiler')

    expect(screen.getByRole('heading', { level: 1, name: 'E.14 Heizraum' })).toBeTruthy()
    expect(screen.getByText('Nutzung: Haustechnik')).toBeTruthy()
    await waitFor(() => {
      expect(rowsOf('Steht hier')).toEqual([
        'AN-00057 Aufzug HeizraumAufzugsanlage',
        'AN-00059 ZirkulationspumpeKomponente von AN-00057 Aufzug Heizraum',
      ])
    })
    expect(rowsOf('Versorgt von')).toEqual(['AN-00041 Unterverteilung UV-EGversorgt diesen Raum'])
    expect(rowsOf('Offene Mängel')).toEqual([
      'Warmwasser am Speicheraustritt 55,5 °CAN-00057 Aufzug Heizraum, festgestellt am 01.10.2026, Frist 19.10.2026',
    ])
  })

  it('says so where the device does not hold the room', async () => {
    await mountSite('/raeume/r-nowhere')

    expect(screen.getByRole('heading', { level: 1, name: 'Nicht auf diesem Gerät' })).toBeTruthy()
  })
})

describe('an asset on site', () => {
  const reading = ['asset.read', 'duty.read', 'document.read']

  it('says what is known about it, with the fields of its kind, under the path to its room', async () => {
    await mountSite('/anlagen/a-heater', { rights: reading })

    expect(screen.getByRole('heading', { level: 1, name: 'Aufzug Heizraum' })).toBeTruthy()
    expect(screen.getByText('AN-00057')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'E.14 Heizraum' }).getAttribute('href')).toBe(
      '/m/raeume/r-boiler',
    )

    const facts = screen.getByRole('region', { name: 'Angaben' })

    await waitFor(() => {
      expect(texts(within(facts).getAllByRole('term'))).toEqual([
        'Anlagenart',
        'Hersteller und Typ',
        'Seriennummer',
        'Baujahr',
        'Feuerwehraufzug',
        'Haltestellen',
      ])
    })
    expect(texts(within(facts).getAllByRole('definition'))).toEqual([
      'Aufzugsanlage',
      'Beispielhub SW 750',
      'BT-750-22-0193',
      '2019',
      'Ja',
      '4',
    ])
  })

  it('reads how its duties stand from the server, and lists its open defects from the device', async () => {
    await mountSite('/anlagen/a-heater', {
      rights: reading,
      answers: {
        '/assets/a-heater/duties': [
          {
            id: 'du-main',
            title: 'Hauptprüfung',
            state: 'overdue',
            appointment: { dueOn: '2026-10-01', onTimeUntil: '2026-10-01' },
            lastMetOn: null,
          },
        ],
      },
    })

    const duties = await screen.findByRole('list', { name: 'Pflichten' })

    expect(within(duties).getByText('Hauptprüfung')).toBeTruthy()
    expect(within(duties).getByText('Termin 01.10.2026')).toBeTruthy()
    expect(within(duties).getByText('Überfällig')).toBeTruthy()
    expect(rowsOf('Offene Mängel')).toEqual([
      'Warmwasser am Speicheraustritt 55,5 °Cfestgestellt am 01.10.2026, Frist 19.10.2026',
    ])
  })

  it('names the duties the device holds without how they stand where the server gives no answer', async () => {
    const server = schoolServer()

    server.put('duties', {
      id: 'du-held',
      propertyId: 'p-school',
      areaId: 'a-sued',
      assetId: heater.id,
      kind: null,
      kindVersion: null,
      label: 'Sichtprüfung',
    })

    await mountSite('/anlagen/a-heater', { rights: reading, server })

    expect(rowsOf('Pflichten')).toEqual(['Sichtprüfung'])
    expect(screen.getByText(/Wie eine Pflicht steht, sagt der Server/)).toBeTruthy()
    expect(screen.queryByText('Überfällig')).toBeNull()
  })

  it('names its last evidence from the server, three of them, with the mark of one that counts no more', async () => {
    const entry = (id: string, performedOn: string, further: object = {}) => ({
      id,
      dutyId: 'du-main',
      dutyTitle: 'Hauptprüfung',
      number: `NW-2026-${id}`,
      performedOn,
      result: 'without_defects',
      origin: 'report',
      standing: 'counts',
      ...further,
    })

    await mountSite('/anlagen/a-heater', {
      rights: [...reading, 'evidence.read'],
      answers: {
        '/assets/a-heater/evidence': [
          entry('00131', '2026-10-01', { result: 'with_defects' }),
          entry('00127', '2026-09-24', { standing: 'voided' }),
          entry('00098', '2026-09-17', { standing: 'replaced' }),
          entry('00041', '2026-03-12'),
        ],
      },
    })

    await screen.findByRole('list', { name: 'Letzte Nachweise' })

    expect(rowsOf('Letzte Nachweise')).toEqual([
      'NW-2026-00131, 01.10.2026Hauptprüfung, Mit Mängeln',
      'NW-2026-00127, 24.09.2026Hauptprüfung, Ohne Mangel, für ungültig erklärt',
      'NW-2026-00098, 17.09.2026Hauptprüfung, Ohne Mangel, ersetzt',
    ])
  })

  it('says that the server keeps the evidence where it gives no answer', async () => {
    await mountSite('/anlagen/a-heater', { rights: [...reading, 'evidence.read'] })

    expect(screen.getByRole('region', { name: 'Letzte Nachweise' }).textContent).toContain(
      'Die Nachweise einer Anlage liegen auf dem Server.',
    )
  })

  it('shows no last evidence to whoever does not see evidence', async () => {
    await mountSite('/anlagen/a-heater', { rights: reading })

    expect(screen.queryByRole('region', { name: 'Letzte Nachweise' })).toBeNull()
  })

  it('shows its valid label, and offers no second one', async () => {
    await mountSite('/anlagen/a-heater', { rights: [...reading, 'asset.record'] })

    const label = screen.getByRole('region', { name: 'Etikett' })

    expect(within(label).getByText('3XQ7-M2K9-PDH4-TA6W')).toBeTruthy()
    expect(within(label).getByText('gültig')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Etikett zuordnen' })).toBeNull()
  })

  it.each([
    [[...reading, 'asset.record'], true],
    [reading, false],
  ] as const)(
    'offers "Etikett zuordnen" for an asset without one to whoever takes assets into the register (%j: %s)',
    async (rights, offered) => {
      const { router } = await mountSite(`/anlagen/${rod.id}`, { rights })
      const button = screen.queryByRole('button', { name: 'Etikett zuordnen' })

      expect(screen.getByText('Diese Anlage hat noch kein Etikett.')).toBeTruthy()
      expect(button !== null).toBe(offered)

      if (button) {
        fireEvent.click(button)
        await waitFor(() => {
          expect(router.state.location.pathname).toBe('/anlagen/a-rod/etikett')
        })
      }
    },
  )

  it('files a photo at the asset, with its property, for whoever may file documents', async () => {
    const { server } = await mountSite(`/anlagen/${rod.id}`, {
      rights: [...reading, 'document.record'],
    })

    fireEvent.change(screen.getByLabelText('Foto für die Dokumente'), {
      target: { files: [new File(['%PDF-1.7'], 'typenschild.pdf', { type: 'application/pdf' })] },
    })

    await waitFor(() => {
      expect(queued(server).map(({ entity, kind }) => `${entity} ${kind}`)).toEqual([
        'attachments create',
        'attachment_versions create',
      ])
    })
    expect(queued(server)[0]?.values).toMatchObject({
      propertyId: 'p-school',
      assetId: 'a-rod',
      title: 'typenschild',
    })
  })

  it('offers no photo to whoever may only read documents', async () => {
    await mountSite(`/anlagen/${rod.id}`, { rights: reading })

    expect(screen.getByRole('region', { name: 'Dokumente' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Foto aufnehmen' })).toBeNull()
    expect(screen.queryByLabelText('Foto für die Dokumente')).toBeNull()
  })
})
