import type {
  DefectClassChoice,
  DefectEntry,
  DefectReading,
  DefectRegister,
  RoleKey,
} from '@opengewerk/haustechnik-domain'
import { today } from '@opengewerk/platform-web/format'
import { TestServer } from '@opengewerk/platform-web/testing'
import { onlineManager } from '@tanstack/react-query'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { servingCatalogue } from '../../app/test-catalogue.js'
import {
  mountOffice,
  type NamedArea,
  onA,
  rowsOf,
  signedInOffice,
  untilTheRightsAreKnown,
  type Written,
} from '../test-office.js'

/**
 * "Mängel" in the office (#116, 4.6 of the concept): the list asked of the
 * server a page at a time, the page of a defect with how far it is, keeping
 * it and checking it again for whoever keeps defects and nobody else, and
 * reporting one by hand, with class and deadline only from whoever keeps
 * defects.
 */

const sued: NamedArea = { id: 'a-sued', name: 'Süd' }

const school = {
  id: 'p-school',
  areaId: sued.id,
  name: 'Schulzentrum Am Lindenhain',
  street: 'Am Lindenhain 7',
  postalCode: '00003',
  city: 'Musterhausen',
  federalState: 'DE-BW',
  note: null,
}
const house = {
  id: 'b-house',
  propertyId: school.id,
  areaId: sued.id,
  name: 'Schulhaus',
  kinds: '["school"]',
  yearBuilt: 1975,
}
const lift = {
  id: 'as-lift',
  propertyId: school.id,
  areaId: sued.id,
  buildingId: house.id,
  roomId: null,
  parentAssetId: null,
  kind: 'probe.elevator',
  number: 'AN-00044',
  name: 'Aufzug Schulhaus',
}

const everything = ['properties', 'buildings', 'floors', 'rooms', 'assets', 'attachments'] as const

const place: DefectEntry['place'] = {
  propertyId: school.id,
  propertyName: school.name,
  buildingId: house.id,
  buildingName: house.name,
  roomId: null,
  roomLabel: null,
  asset: { id: lift.id, number: lift.number, name: lift.name },
}

function defect(id: string, further: Partial<DefectEntry> = {}): DefectEntry {
  return {
    id: id as DefectEntry['id'],
    description: 'Notruf im Fahrkorb ohne Verbindung',
    defectClass: 'probe.severe',
    foundOn: '2026-10-04',
    dueOn: '2026-10-05',
    status: 'found',
    overdue: true,
    origin: { kind: 'hand' },
    place,
    workOrder: null,
    ...further,
  }
}

const late = defect('df-late')
const unclassed = defect('df-new', {
  description: 'Kratzgeräusch an der Schachttür',
  defectClass: null,
  dueOn: null,
  overdue: false,
  origin: { kind: 'activity', activityId: 'ac-1', activityKind: 'round', title: 'Rundgang' },
})
const remedied = defect('df-remedied', {
  description: 'Beleuchtung im Fahrkorb flackert',
  defectClass: 'probe.slight',
  dueOn: '2099-10-12',
  status: 'remedied',
  overdue: false,
  workOrder: {
    activityId: 'ac-order',
    number: 'AU-2026-0029',
    title: 'Beleuchtung tauschen',
    status: 'signed',
    performedOn: '2026-10-06',
  },
})

const choices: readonly DefectClassChoice[] = [
  { key: 'probe.slight', label: 'leicht', dueDays: 14 },
  { key: 'probe.severe', label: 'schwer', dueDays: null },
]

function register(defects: readonly DefectEntry[]): DefectRegister {
  return {
    total: defects.length,
    counts: { open: 4, overdue: 1, verified: 2 },
    more: false,
    defects,
  }
}

function reading(entry: DefectEntry, further: Partial<DefectReading> = {}): DefectReading {
  return {
    ...entry,
    areaId: sued.id as DefectReading['areaId'],
    checkedOn: null,
    checkNote: null,
    classChoices: choices,
    ...further,
  }
}

let server: TestServer

function mount(
  at: string,
  answers: Readonly<Record<string, unknown>> = {},
  role: RoleKey = 'site_management',
  answerToWrite?: (write: Written) => { status: number; body: unknown },
) {
  const written = signedInOffice(role, [sued], { ...servingCatalogue(), ...answers }, answerToWrite)

  return { written, mounted: mountOffice(at, server, everything) }
}

const caption = 'Mängel mit Anlage oder Ort, Klasse, Frist, Stand, Herkunft und Auftrag'

/** The four statuses of the page, each as it reads: reached or not, and its line. */
async function steps(): Promise<(string | null)[]> {
  const list = await screen.findByRole('list', { name: 'Stand des Mangels' })

  return within(list)
    .getAllByRole('listitem')
    .map((step) => step.textContent)
}

beforeEach(() => {
  localStorage.clear()
  onA('desktop')
  server = new TestServer()
  server.put('properties', school)
  server.put('buildings', house)
  server.put('assets', lift)
})

afterEach(() => {
  vi.unstubAllGlobals()
  onlineManager.setOnline(true)
})

describe('the list "Mängel"', () => {
  it('names each defect, where it is, its class, its deadline, how far it is, where it comes from and its work order', async () => {
    const { mounted } = mount('/maengel', { '/defects': register([remedied, late, unclassed]) })

    await mounted
    // The words of the classes come with the catalogue of the device.
    await waitFor(() => {
      expect(rowsOf(caption)[0]?.[2]).toBe('leicht')
    })
    expect(rowsOf(caption)).toEqual([
      [
        'Beleuchtung im Fahrkorb flackert',
        'AN-00044 Aufzug SchulhausSchulzentrum Am Lindenhain, Schulhaus',
        'leicht',
        '12.10.2099',
        'Behoben',
        'von Hand, 04.10.2026',
        'AU-2026-0029',
      ],
      [
        'Notruf im Fahrkorb ohne Verbindung',
        'AN-00044 Aufzug SchulhausSchulzentrum Am Lindenhain, Schulhaus',
        'schwer',
        '05.10.2026über der Frist',
        'Festgestellt',
        'von Hand, 04.10.2026',
        'keiner',
      ],
      [
        'Kratzgeräusch an der Schachttür',
        'AN-00044 Aufzug SchulhausSchulzentrum Am Lindenhain, Schulhaus',
        'ohne Klasse',
        'keine',
        'Festgestellt',
        'Rundgang, 04.10.2026',
        'keiner',
      ],
    ])
    expect(screen.getByText('4 offen, 1 über ihrer Frist')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Über der Frist 1' })).toBeDefined()
  })

  it('asks the server for the list a chip and a filter name, and for the defects without a class', async () => {
    const { mounted } = mount('/maengel', {
      '/defects': register([remedied, late, unclassed]),
      '/defects?state=overdue': register([late]),
      '/defects?state=overdue&defectClass=none': register([]),
    })

    await mounted
    await waitFor(() => {
      expect(rowsOf(caption)).toHaveLength(3)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Über der Frist 1' }))
    await waitFor(() => {
      expect(rowsOf(caption)).toHaveLength(1)
    })
    fireEvent.change(screen.getByLabelText('Klasse'), { target: { value: 'none' } })

    expect(
      await screen.findByText('Kein Mangel passt zu dem, wonach die Liste eingegrenzt ist.'),
    ).toBeDefined()
  })

  it('narrows the list to an area once the person has more than one', async () => {
    const nord: NamedArea = { id: 'a-nord', name: 'Nord' }

    signedInOffice('management', [nord, sued], {
      ...servingCatalogue(),
      '/defects': register([remedied, late, unclassed]),
      [`/defects?areaId=${nord.id}`]: register([late]),
    })
    await mountOffice('/maengel', server, everything)
    await waitFor(() => {
      expect(rowsOf(caption)).toHaveLength(3)
    })
    fireEvent.change(screen.getByLabelText('Bereich'), { target: { value: nord.id } })
    await waitFor(() => {
      expect(rowsOf(caption)).toHaveLength(1)
    })
  })

  it('offers reporting one to every role, the Haustechnik included', async () => {
    const { mounted } = mount('/maengel', { '/defects': register([late]) }, 'technician')

    await mounted
    await untilTheRightsAreKnown()

    expect(await screen.findByRole('button', { name: 'Mangel melden' })).toBeDefined()
  })
})

describe('the page of a defect', () => {
  it('shows how far it is, what was found, where, its class, its deadline and its work order', async () => {
    const { mounted } = mount('/maengel/df-remedied', {
      '/defects/df-remedied': reading(remedied),
    })

    await mounted

    expect(await steps()).toEqual([
      'Festgestellt, erreicht04.10.2026, von Hand',
      'Beauftragt, erreichtAU-2026-0029',
      'Behoben, erreicht06.10.2026, aus dem Auftrag',
      'Nachgeprüft, noch nichtein eigener Schritt',
    ])
    expect(screen.getByText('12.10.2099, Vorgabe der Klasse: 14 Tage')).toBeDefined()
    expect(screen.getByText('AU-2026-0029 Beleuchtung tauschen')).toBeDefined()
  })

  it('lets whoever keeps defects check a remedied one again, and sends how it came out', async () => {
    const { written, mounted } = mount(
      '/maengel/df-remedied',
      { '/defects/df-remedied': reading(remedied) },
      'site_management',
      () => ({ status: 201, body: { id: 'df-remedied' } }),
    )

    await mounted
    fireEvent.change(await screen.findByLabelText('Bemerkung zur Nachprüfung'), {
      target: { value: 'Leuchte getauscht, brennt ruhig.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Nachgeprüft' }))

    await waitFor(() => {
      expect(written).toEqual([
        {
          method: 'POST',
          path: '/defects/df-remedied/check',
          body: {
            outcome: 'verified',
            checkedOn: today(),
            note: 'Leuchte getauscht, brennt ruhig.',
          },
        },
      ])
    })
  })

  it('asks what was found before it sends that a defect is not set right', async () => {
    const { written, mounted } = mount(
      '/maengel/df-remedied',
      { '/defects/df-remedied': reading(remedied) },
      'site_management',
      () => ({ status: 201, body: { id: 'df-remedied' } }),
    )

    await mounted
    fireEvent.click(await screen.findByRole('button', { name: 'Nicht behoben' }))

    expect(await screen.findByText('Sagen Sie, was Sie vorgefunden haben.')).toBeDefined()
    expect(written).toEqual([])
  })

  it('offers checking again only for a remedied defect, and keeping it to nobody in the Haustechnik', async () => {
    const technician = mount(
      '/maengel/df-remedied',
      { '/defects/df-remedied': reading(remedied) },
      'technician',
    )

    await technician.mounted
    await untilTheRightsAreKnown()
    await steps()

    expect(screen.queryByRole('button', { name: 'Nachgeprüft' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).toBeNull()
  })

  it('does not offer checking again before the defect is remedied', async () => {
    const { mounted } = mount('/maengel/df-late', { '/defects/df-late': reading(late) })

    await mounted
    await untilTheRightsAreKnown()
    await steps()

    expect(screen.queryByRole('button', { name: 'Nachgeprüft' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Bearbeiten' })).toBeDefined()
  })

  it('proposes the deadline of a class chosen while keeping it, and sends class and day', async () => {
    const { written, mounted } = mount(
      '/maengel/df-new',
      { '/defects/df-new': reading(unclassed) },
      'site_management',
      () => ({ status: 200, body: { id: 'df-new' } }),
    )

    await mounted
    fireEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }))
    fireEvent.change(screen.getByLabelText('Klasse'), {
      target: { value: 'probe.slight' },
    })

    expect((screen.getByLabelText('Frist zur Beseitigung') as HTMLInputElement).value).toBe(
      '2026-10-18',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(written).toEqual([
        {
          method: 'PATCH',
          path: '/defects/df-new',
          body: {
            description: 'Kratzgeräusch an der Schachttür',
            defectClass: 'probe.slight',
            dueOn: '2026-10-18',
          },
        },
      ])
    })
  })
})

describe('reporting a defect by hand', () => {
  it('sends what was found at the asset the way here came from, without class and deadline from the Haustechnik', async () => {
    const { written, mounted } = mount('/maengel/neu?anlage=as-lift', {}, 'technician', () => ({
      status: 201,
      body: { id: 'df-made' },
    }))

    await mounted
    await untilTheRightsAreKnown()
    fireEvent.change(await screen.findByLabelText(/Beschreibung/), {
      target: { value: 'Schachttür schließt nicht ganz' },
    })

    expect(screen.queryByLabelText('Klasse')).toBeNull()
    expect(screen.queryByLabelText('Frist zur Beseitigung')).toBeNull()
    expect(screen.getByText('Klasse und Frist vergibt, wer Mängel führt.')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Mangel melden' }))

    await waitFor(() => {
      expect(written).toEqual([
        {
          method: 'POST',
          path: '/defects',
          body: {
            assetId: 'as-lift',
            description: 'Schachttür schließt nicht ganz',
            foundOn: today(),
          },
        },
      ])
    })
  })

  it('takes class and deadline from whoever keeps defects, the deadline proposed by the class', async () => {
    const { written, mounted } = mount(
      '/maengel/neu?anlage=as-lift',
      { '/defects/classes': choices },
      'site_management',
      () => ({ status: 201, body: { id: 'df-made' } }),
    )

    await mounted
    fireEvent.change(await screen.findByLabelText(/Beschreibung/), {
      target: { value: 'Notrufknopf ohne Funktion' },
    })
    await screen.findByRole('option', { name: 'leicht' })
    fireEvent.change(screen.getByLabelText('Klasse'), { target: { value: 'probe.slight' } })
    fireEvent.click(screen.getByRole('button', { name: 'Mangel melden' }))

    await waitFor(() => {
      expect(written[0]?.body).toEqual({
        assetId: 'as-lift',
        description: 'Notrufknopf ohne Funktion',
        foundOn: today(),
        defectClass: 'probe.slight',
        dueOn: (written[0]?.body as { dueOn: string }).dueOn,
      })
    })
    expect((written[0]?.body as { dueOn: string }).dueOn > today()).toBe(true)
  })

  it('sends nothing without a description', async () => {
    const { written, mounted } = mount('/maengel/neu?anlage=as-lift', {}, 'technician')

    await mounted
    await untilTheRightsAreKnown()
    fireEvent.click(await screen.findByRole('button', { name: 'Mangel melden' }))

    expect(await screen.findByText('Die Beschreibung fehlt.')).toBeDefined()
    expect(written).toEqual([])
  })
})

describe('the defaults of the classes', () => {
  it('are set by the Leitung, a class at a time', async () => {
    const { written, mounted } = mount(
      '/einstellungen/maengelklassen',
      {
        '/settings/defect-classes': [
          {
            key: 'allgemein.minor',
            label: 'gering',
            unsafe: false,
            packageName: 'allgemein',
            packageTitle: 'Allgemein',
            dueDays: null,
          },
        ],
      },
      'management',
      () => ({ status: 200, body: { dueDays: 30 } }),
    )

    await mounted

    const field = await screen.findByLabelText('Vorgabe der Frist für gering in Tagen')

    fireEvent.change(field, { target: { value: '30' } })
    fireEvent.click(within(field.closest('form') as HTMLElement).getByRole('button'))

    await waitFor(() => {
      expect(written).toEqual([
        {
          method: 'PUT',
          path: '/settings/defect-classes/allgemein.minor',
          body: { dueDays: 30 },
        },
      ])
    })
  })
})

describe('the navigation', () => {
  it('counts the defects over their deadline beside "Mängel"', async () => {
    const { mounted } = mount('/maengel', {
      '/defects': register([late]),
      '/defects/summary': { open: 4, overdue: 2 },
    })

    await mounted

    expect(
      await within(screen.getByRole('navigation', { name: 'Hauptbereiche' })).findByText('2'),
    ).toBeDefined()
  })
})
