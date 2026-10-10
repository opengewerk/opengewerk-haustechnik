import type {
  DefectEntry,
  DefectReading,
  DefectRegister,
  RoleKey,
  WorkOrderCandidates,
  WorkOrderDetails,
  WorkOrderEntry,
  WorkOrderList,
} from '@opengewerk/haustechnik-domain'
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
 * "Aufträge" in the office (#117, 4.8 of the concept): the list asked of the
 * server a page at a time, the page of an order with its signature and its
 * acceptance, its change, and a new order from a defect or by hand. Making
 * and changing an order is for whoever plans and hands out work, accepting
 * it for whoever accepts work orders.
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
const door = {
  id: 'as-door',
  propertyId: school.id,
  areaId: sued.id,
  buildingId: house.id,
  roomId: null,
  parentAssetId: null,
  kind: 'probe.elevator',
  number: 'AN-00044',
  name: 'Notausgangstür Saal',
}

const everything = ['properties', 'buildings', 'floors', 'rooms', 'assets'] as const

/** The first page of what is open, narrowed by nothing, as the list asks for it. */
const firstPage = '/work-orders?offset=0&limit=50'

function order(id: string, further: Partial<WorkOrderEntry> = {}): WorkOrderEntry {
  return {
    id: id as WorkOrderEntry['id'],
    workOrderId: `wo-${id}` as WorkOrderEntry['workOrderId'],
    number: 'AU-2026-0029',
    title: 'Notausgangstür Saal gängig machen',
    kind: 'defect_remedy',
    urgency: 'urgent',
    status: 'open',
    rejected: false,
    dueOn: '2099-10-12',
    propertyId: school.id as WorkOrderEntry['propertyId'],
    areaId: sued.id as WorkOrderEntry['areaId'],
    buildingId: null,
    roomId: null,
    assetId: door.id as WorkOrderEntry['assetId'],
    responsible: { userId: 'u-vogt', name: 'Lena Vogt' },
    ...further,
  }
}

const remedy = order('ac-remedy')
const turned = order('ac-turned', {
  number: 'AU-2026-0030',
  title: 'Fensterflügel Gruppenraum 2 einstellen',
  kind: 'other',
  urgency: 'normal',
  status: 'started',
  rejected: true,
  dueOn: '2020-09-28',
  assetId: null,
  buildingId: house.id as WorkOrderEntry['buildingId'],
})
const waiting = order('ac-waiting', {
  number: 'AU-2026-0031',
  title: 'Heizkessel Mensa entlüften',
  kind: 'other',
  urgency: 'immediate',
  status: 'signed',
  assetId: null,
})

function page(orders: readonly WorkOrderEntry[], total = orders.length, waits = 0): WorkOrderList {
  return { orders, total, waiting: waits, more: false }
}

function details(entry: WorkOrderEntry, further: Partial<WorkOrderDetails> = {}): WorkOrderDetails {
  return {
    ...entry,
    createdAt: '2026-09-28T06:00:00.000Z',
    performedOn: null,
    closingReason: null,
    origin: {
      kind: 'defect',
      defectId: 'df-door' as never,
      description: 'Notausgangstür Saal klemmt',
      foundOn: '2026-09-28',
    },
    participants: [{ userId: 'u-yilmaz', name: 'Murat Yilmaz' }],
    durationMinutes: null,
    notes: [],
    signatures: [],
    decisions: [],
    ...further,
  }
}

const signedPage = details(waiting, {
  performedOn: '2026-10-05',
  signatures: [
    {
      name: 'Lena Vogt',
      role: 'signer',
      signedAt: '2026-10-05T07:52:00.000Z',
      deviceInfo: 'Telefon',
      path: 'M10,10L200,300',
      typedName: null,
      valid: true,
    },
  ],
})

const candidates: WorkOrderCandidates = {
  people: [
    { userId: 'u-vogt', name: 'Lena Vogt' },
    { userId: 'u-wendt', name: 'Tobias Wendt' },
    { userId: 'u-yilmaz', name: 'Murat Yilmaz' },
  ],
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

beforeEach(() => {
  localStorage.clear()
  onA('desktop')
  server = new TestServer()
  server.put('properties', school)
  server.put('buildings', house)
  server.put('assets', door)
})

afterEach(() => {
  vi.unstubAllGlobals()
  onlineManager.setOnline(true)
})

const caption =
  'Aufträge mit Nummer, Ort oder Anlage, Dringlichkeit, Frist, Verantwortlichem und Stand'

describe('the list "Aufträge"', () => {
  it('names the number, the order, where, how urgent, the day, who leads it and how far it is', async () => {
    const { mounted } = mount('/auftraege', { [firstPage]: page([remedy, turned, waiting], 7, 1) })

    await mounted
    await waitFor(() => {
      expect(rowsOf(caption)).toHaveLength(3)
    })
    expect(rowsOf(caption)).toEqual([
      [
        'AU-2026-0029',
        'Notausgangstür Saal gängig machenMangelbeseitigung',
        'AN-00044 Notausgangstür SaalSchulzentrum Am Lindenhain, Schulhaus',
        'dringend',
        '12.10.2099',
        'Lena Vogt',
        'Offen',
      ],
      [
        'AU-2026-0030',
        'Fensterflügel Gruppenraum 2 einstellenSonstiger Auftrag',
        'SchulhausSchulzentrum Am Lindenhain',
        'normal',
        '28.09.2020überschritten',
        'Lena Vogt',
        'Zurückgewiesen',
      ],
      [
        'AU-2026-0031',
        'Heizkessel Mensa entlüftenSonstiger Auftrag',
        'Schulzentrum Am LindenhainLiegenschaft',
        'sofort',
        '12.10.2099',
        'Lena Vogt',
        'Wartet auf Abnahme',
      ],
    ])
    expect(
      screen.getByRole('link', { name: 'Notausgangstür Saal gängig machen' }).getAttribute('href'),
    ).toBe('/auftraege/ac-remedy')
    expect(screen.getByText('7 offen, davon 1 wartet auf Abnahme')).toBeTruthy()
  })

  it('asks the server for what waits and for a kind, and narrows to no person', async () => {
    const { mounted } = mount('/auftraege', {
      [firstPage]: page([remedy]),
      '/work-orders?state=waiting&offset=0&limit=50': page([waiting]),
      '/work-orders?state=waiting&kind=other&offset=0&limit=50': page([]),
    })

    await mounted
    await screen.findByRole('link', { name: 'Notausgangstür Saal gängig machen' })
    fireEvent.click(screen.getByRole('button', { name: 'Wartet auf Abnahme' }))
    await screen.findByRole('link', { name: 'Heizkessel Mensa entlüften' })
    fireEvent.change(screen.getByRole('combobox', { name: 'Art' }), { target: { value: 'other' } })
    await screen.findByText('Kein Auftrag passt zu dem, wonach die Liste eingegrenzt ist.')
    expect(screen.queryByRole('combobox', { name: 'Verantwortlich' })).toBeNull()
  })

  it('offers a new order to whoever plans and hands out work, and to nobody else', async () => {
    const planning = mount('/auftraege', { [firstPage]: page([remedy]) })

    await planning.mounted
    await untilTheRightsAreKnown()
    expect(await screen.findByRole('button', { name: 'Neuer Auftrag' })).toBeTruthy()
  })

  it('offers no new order to whoever only performs', async () => {
    const performing = mount('/auftraege', { [firstPage]: page([remedy]) }, 'technician')

    await performing.mounted
    await untilTheRightsAreKnown()
    await screen.findByRole('link', { name: 'Notausgangstür Saal gängig machen' })
    expect(screen.queryByRole('button', { name: 'Neuer Auftrag' })).toBeNull()
  })
})

describe('the page of a work order', () => {
  it('names where it came from, who leads it, who works on it, and the signature', async () => {
    const { mounted } = mount('/auftraege/ac-waiting', { '/work-orders/ac-waiting': signedPage })

    await mounted
    await screen.findByRole('heading', { name: 'Heizkessel Mensa entlüften' })
    expect(
      screen
        .getByRole('link', { name: 'Mangel „Notausgangstür Saal klemmt“' })
        .getAttribute('href'),
    ).toBe('/maengel/df-door')
    expect(screen.getByText('Murat Yilmaz')).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Unterschrift von Lena Vogt' })).toBeTruthy()
    expect(screen.queryByText('gilt nicht mehr')).toBeNull()
  })

  it('names the time spent and the notes from the site, each with who wrote it and when', async () => {
    const { mounted } = mount('/auftraege/ac-waiting', {
      '/work-orders/ac-waiting': details(waiting, {
        durationMinutes: 45,
        notes: [
          {
            id: 'n-1' as never,
            text: 'Kessel entlüftet, Druck steht bei 1,6 bar.',
            writtenAt: '2026-10-05T06:55:00.000Z',
            name: 'Murat Yilmaz',
          },
        ],
      }),
    })

    await mounted
    await screen.findByRole('heading', { name: 'Heizkessel Mensa entlüften' })
    expect(screen.getByText('0:45 Std.')).toBeTruthy()

    const notes = screen.getByRole('list', { name: 'Notizen von vor Ort' })

    expect(within(notes).getByText('Kessel entlüftet, Druck steht bei 1,6 bar.')).toBeTruthy()
    expect(within(notes).getByText(/Murat Yilmaz$/)).toBeTruthy()
  })

  it('says when no time spent and no note came from the site yet', async () => {
    const { mounted } = mount('/auftraege/ac-waiting', { '/work-orders/ac-waiting': signedPage })

    await mounted
    await screen.findByRole('heading', { name: 'Heizkessel Mensa entlüften' })
    expect(screen.getByText('Noch nicht angegeben')).toBeTruthy()
    expect(screen.getByText('Noch keine Notiz von vor Ort.')).toBeTruthy()
  })

  it('accepts a signed order for whoever accepts work orders', async () => {
    const { mounted, written } = mount(
      '/auftraege/ac-waiting',
      { '/work-orders/ac-waiting': signedPage },
      'site_management',
      () => ({ status: 201, body: { id: 'ac-waiting' } }),
    )

    await mounted
    fireEvent.click(await screen.findByRole('button', { name: 'Abnehmen' }))
    await waitFor(() => {
      expect(written).toEqual([
        {
          method: 'POST',
          path: '/work-orders/ac-waiting/decision',
          body: { decision: 'accepted' },
        },
      ])
    })
  })

  it('turns it back only with the reason', async () => {
    const { mounted, written } = mount(
      '/auftraege/ac-waiting',
      { '/work-orders/ac-waiting': signedPage },
      'site_management',
      () => ({ status: 201, body: { id: 'ac-waiting' } }),
    )

    await mounted
    fireEvent.click(await screen.findByRole('button', { name: 'Zurückweisen' }))
    await screen.findByText('Eine Zurückweisung nennt ihren Grund.')
    expect(written).toEqual([])

    fireEvent.change(screen.getByRole('textbox', { name: 'Begründung' }), {
      target: { value: 'Die Tür schleift noch.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Zurückweisen' }))
    await waitFor(() => {
      expect(written).toEqual([
        {
          method: 'POST',
          path: '/work-orders/ac-waiting/decision',
          body: { decision: 'rejected', reason: 'Die Tür schleift noch.' },
        },
      ])
    })
  })

  it('offers neither the acceptance nor a change to whoever only performs', async () => {
    const { mounted } = mount(
      '/auftraege/ac-waiting',
      { '/work-orders/ac-waiting': signedPage },
      'technician',
    )

    await mounted
    await untilTheRightsAreKnown()
    await screen.findByRole('img', { name: 'Unterschrift von Lena Vogt' })
    expect(screen.queryByRole('button', { name: 'Abnehmen' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Zurückweisen' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).toBeNull()
  })

  it('is changed by whoever plans until it is signed, with the people it names', async () => {
    const { mounted, written } = mount(
      '/auftraege/ac-remedy',
      {
        '/work-orders/ac-remedy': details(remedy),
        '/work-orders/candidates?property=p-school': candidates,
      },
      'site_management',
      () => ({ status: 200, body: { id: 'ac-remedy' } }),
    )

    await mounted
    fireEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }))

    const dialog = await screen.findByRole('dialog')

    await within(within(dialog).getByRole('combobox', { name: 'Verantwortlich' })).findByRole(
      'option',
      { name: 'Tobias Wendt' },
    )
    fireEvent.click(within(dialog).getByRole('radio', { name: 'sofort' }))
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Person hinzufügen' }), {
      target: { value: 'u-wendt' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Murat Yilmaz entfernen' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(written).toEqual([
        {
          method: 'PUT',
          path: '/work-orders/ac-remedy',
          body: {
            title: 'Notausgangstür Saal gängig machen',
            kind: 'defect_remedy',
            urgency: 'immediate',
            dueOn: '2099-10-12',
            responsibleUserId: 'u-vogt',
            participantUserIds: ['u-wendt'],
          },
        },
      ])
    })
  })

  it('offers no change to whoever only performs, also while it is open', async () => {
    const { mounted } = mount(
      '/auftraege/ac-remedy',
      { '/work-orders/ac-remedy': details(remedy) },
      'technician',
    )

    await mounted
    await untilTheRightsAreKnown()
    await screen.findByRole('heading', { name: 'Notausgangstür Saal gängig machen' })
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).toBeNull()
  })

  it('is closed with the reason by whoever plans, and only with one', async () => {
    const { mounted, written } = mount(
      '/auftraege/ac-remedy',
      { '/work-orders/ac-remedy': details(remedy) },
      'site_management',
      () => ({ status: 201, body: { id: 'ac-remedy' } }),
    )

    await mounted
    fireEvent.click(await screen.findByRole('button', { name: 'Nicht durchgeführt' }))

    const dialog = await screen.findByRole('dialog')

    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Als nicht durchgeführt schließen' }),
    )
    await within(dialog).findByText('Ein Vorgang, der nicht durchgeführt wurde, nennt den Grund.')
    expect(written).toEqual([])

    fireEvent.change(within(dialog).getByRole('textbox', { name: /Grund/ }), {
      target: { value: 'Doppelt angelegt.' },
    })
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Als nicht durchgeführt schließen' }),
    )
    await waitFor(() => {
      expect(written).toEqual([
        {
          method: 'POST',
          path: '/work-orders/ac-remedy/close',
          body: { closingReason: 'Doppelt angelegt.' },
        },
      ])
    })
  })

  it('is not closed by whoever only performs', async () => {
    const performing = mount(
      '/auftraege/ac-remedy',
      { '/work-orders/ac-remedy': details(remedy) },
      'technician',
    )

    await performing.mounted
    await untilTheRightsAreKnown()
    await screen.findByRole('heading', { name: 'Notausgangstür Saal gängig machen' })
    expect(screen.queryByRole('button', { name: 'Nicht durchgeführt' })).toBeNull()
  })

  it('offers no closing once it is signed', async () => {
    const { mounted } = mount('/auftraege/ac-waiting', { '/work-orders/ac-waiting': signedPage })

    await mounted
    await untilTheRightsAreKnown()
    await screen.findByRole('button', { name: 'Abnehmen' })
    expect(screen.queryByRole('button', { name: 'Nicht durchgeführt' })).toBeNull()
  })

  it('names the reason of an order that was not performed', async () => {
    const { mounted } = mount('/auftraege/ac-remedy', {
      '/work-orders/ac-remedy': details(
        { ...remedy, status: 'not_performed' },
        { closingReason: 'Doppelt angelegt.' },
      ),
    })

    await mounted
    await screen.findByText('Doppelt angelegt.')
    expect(screen.getByText('Nicht durchgeführt')).toBeTruthy()
  })

  it('offers no change once it is signed', async () => {
    const { mounted } = mount('/auftraege/ac-waiting', { '/work-orders/ac-waiting': signedPage })

    await mounted
    await untilTheRightsAreKnown()
    await screen.findByRole('button', { name: 'Abnehmen' })
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).toBeNull()
  })
})

const foundDefect: DefectEntry = {
  id: 'df-door' as DefectEntry['id'],
  description: 'Notausgangstür Saal klemmt',
  defectClass: null,
  foundOn: '2026-09-28',
  dueOn: '2099-10-19',
  status: 'found',
  overdue: false,
  origin: { kind: 'hand' } as DefectEntry['origin'],
  place: {
    propertyId: school.id,
    propertyName: school.name,
    buildingId: house.id,
    buildingName: house.name,
    roomId: null,
    roomLabel: null,
    asset: { id: door.id, number: door.number, name: door.name },
  },
  workOrder: null,
}

const register: DefectRegister = {
  total: 1,
  counts: { open: 1, overdue: 0, verified: 0 },
  more: false,
  defects: [foundDefect],
}

describe('a new work order', () => {
  it('from a defect takes its description and its day, and sends where it came from', async () => {
    const { mounted, written } = mount(
      '/auftraege/neu?mangel=df-door',
      {
        '/defects?state=open&limit=200': register,
        '/work-orders/candidates?property=p-school': candidates,
      },
      'site_management',
      () => ({ status: 201, body: { id: 'ac-new' } }),
    )

    await mounted
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: /Titel/ })).toHaveProperty(
        'value',
        'Notausgangstür Saal klemmt',
      )
    })
    await within(screen.getByRole('combobox', { name: 'Verantwortlich' })).findByRole('option', {
      name: 'Lena Vogt',
    })
    fireEvent.change(screen.getByRole('textbox', { name: /Titel/ }), {
      target: { value: 'Notausgangstür Saal gängig machen' },
    })
    fireEvent.change(screen.getByRole('combobox', { name: 'Verantwortlich' }), {
      target: { value: 'u-vogt' },
    })
    fireEvent.click(screen.getByRole('radio', { name: 'dringend' }))
    fireEvent.click(screen.getByRole('button', { name: 'Auftrag anlegen' }))

    await waitFor(() => {
      expect(written).toEqual([
        {
          method: 'POST',
          path: '/work-orders',
          body: {
            title: 'Notausgangstür Saal gängig machen',
            kind: 'defect_remedy',
            urgency: 'urgent',
            dueOn: '2099-10-19',
            responsibleUserId: 'u-vogt',
            participantUserIds: [],
            origin: 'defect',
            defectId: 'df-door',
          },
        },
      ])
    })
  })

  it('by hand at an asset sends the asset, and nothing without the person who leads it', async () => {
    const { mounted, written } = mount(
      '/auftraege/neu?anlage=as-door',
      { '/work-orders/candidates?property=p-school': candidates },
      'site_management',
      () => ({ status: 201, body: { id: 'ac-new' } }),
    )

    await mounted
    await within(screen.getByRole('combobox', { name: 'Verantwortlich' })).findByRole('option', {
      name: 'Lena Vogt',
    })
    fireEvent.change(screen.getByRole('textbox', { name: /Titel/ }), {
      target: { value: 'Türschließer tauschen' },
    })
    fireEvent.change(screen.getByLabelText('Frist'), { target: { value: '2099-11-02' } })
    fireEvent.click(screen.getByRole('button', { name: 'Auftrag anlegen' }))
    await screen.findByText('Ein Auftrag nennt die Person, die ihn führt.')
    expect(written).toEqual([])

    fireEvent.change(screen.getByRole('combobox', { name: 'Verantwortlich' }), {
      target: { value: 'u-wendt' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Auftrag anlegen' }))

    await waitFor(() => {
      expect(written).toEqual([
        {
          method: 'POST',
          path: '/work-orders',
          body: {
            title: 'Türschließer tauschen',
            kind: 'other',
            urgency: 'normal',
            dueOn: '2099-11-02',
            responsibleUserId: 'u-wendt',
            participantUserIds: [],
            origin: 'hand',
            assetId: 'as-door',
          },
        },
      ])
    })
  })
})

/** The page of the found defect, as the server reads it. */
const foundReading: DefectReading = {
  ...foundDefect,
  areaId: sued.id as DefectReading['areaId'],
  checkedOn: null,
  checkNote: null,
  classChoices: [],
}

describe('the way from a defect to its order', () => {
  it('a found defect offers a new order to whoever plans and hands out work', async () => {
    const { mounted } = mount('/maengel/df-door', { '/defects/df-door': foundReading })

    await mounted
    await untilTheRightsAreKnown()

    const button = await screen.findByRole('button', { name: 'Auftrag anlegen' })

    fireEvent.click(button)
    await screen.findByRole('heading', { name: 'Neuer Auftrag' })
  })

  it('a found defect offers no order to whoever only performs, and an ordered one to nobody', async () => {
    const performing = mount('/maengel/df-door', { '/defects/df-door': foundReading }, 'technician')

    await performing.mounted
    await untilTheRightsAreKnown()
    await screen.findByRole('heading', { name: 'Notausgangstür Saal klemmt' })
    expect(screen.queryByRole('button', { name: 'Auftrag anlegen' })).toBeNull()
  })

  it('names the order of an ordered defect with the way to it, and offers no second', async () => {
    const ordered: DefectReading = {
      ...foundReading,
      status: 'ordered',
      workOrder: {
        activityId: 'ac-remedy',
        number: 'AU-2026-0029',
        title: 'Notausgangstür Saal gängig machen',
        status: 'open',
        performedOn: null,
      },
    }
    const { mounted } = mount('/maengel/df-door', { '/defects/df-door': ordered })

    await mounted
    await untilTheRightsAreKnown()
    expect(
      (
        await screen.findByRole('link', { name: 'AU-2026-0029 Notausgangstür Saal gängig machen' })
      ).getAttribute('href'),
    ).toBe('/auftraege/ac-remedy')
    expect(screen.queryByRole('button', { name: 'Auftrag anlegen' })).toBeNull()
  })
})
