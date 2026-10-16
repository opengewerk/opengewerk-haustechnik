import type {
  ContractorVisits,
  DefectEntry,
  DefectReading,
  DefectRegister,
  RoleKey,
  ServiceReportId,
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
  servingTables,
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
    measure: 'repair',
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
  measure: 'improvement',
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
  measure: 'maintenance',
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
    warrantyEndsOn: null,
    contractorId: null,
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
    serviceReports: [],
    materials: [],
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
    // The basic measure after DIN 31051 another kind chose (#333).
    expect(screen.getByText('Wartung nach DIN 31051')).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Unterschrift von Lena Vogt' })).toBeTruthy()
    expect(screen.queryByText('gilt nicht mehr')).toBeNull()
  })

  it('names the service report the client signed, with its PDF, and one a rejection made invalid (#324)', async () => {
    const { mounted } = mount('/auftraege/ac-waiting', {
      '/work-orders/ac-waiting': details(waiting, {
        serviceReports: [
          {
            id: 'sr-old' as ServiceReportId,
            clientName: 'Jonas Albrecht',
            signedAt: '2026-10-02T08:00:00.000Z',
            holder: 'Lena Vogt',
            valid: false,
            voidedAt: '2026-10-03T09:00:00.000Z',
          },
          {
            id: 'sr-new' as ServiceReportId,
            clientName: 'Petra Lang',
            signedAt: '2026-10-05T07:50:00.000Z',
            holder: 'Lena Vogt',
            valid: true,
            voidedAt: null,
          },
        ],
      }),
    })

    await mounted

    const card = await screen.findByRole('region', { name: 'Leistungsnachweis' })

    expect(within(card).getByText('Gilt')).toBeTruthy()
    expect(within(card).getByText('Petra Lang')).toBeTruthy()
    expect(within(card).getByText('am 05.10.2026, mit Schriftzug')).toBeTruthy()
    expect(within(card).getAllByText('auf dem Gerät von Lena Vogt')).toHaveLength(2)
    expect(
      within(card).getByText('gilt nicht mehr, Auftrag am 03.10.2026 zurückgewiesen'),
    ).toBeTruthy()
    expect(within(card).getAllByRole('button', { name: 'PDF öffnen' })).toHaveLength(2)
  })

  it('says that no service report was signed yet', async () => {
    const { mounted } = mount('/auftraege/ac-waiting', {
      '/work-orders/ac-waiting': details(waiting),
    })

    await mounted

    const card = await screen.findByRole('region', { name: 'Leistungsnachweis' })

    expect(within(card).queryByText('Gilt')).toBeNull()
    expect(within(card).queryByRole('button', { name: 'PDF öffnen' })).toBeNull()
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

  it('names the material taken on site, without a person or a price (#326)', async () => {
    const { mounted } = mount('/auftraege/ac-waiting', {
      '/work-orders/ac-waiting': details(waiting, {
        materials: [
          {
            id: 'wm-1' as never,
            quantityMilli: 500,
            unit: 'litre',
            articleId: 'a-oil' as never,
            number: 'A-1072',
            designation: 'Kriechöl',
            storeId: 's-main' as never,
            store: 'Hauptlager Betriebshof',
            takenOn: '2026-10-05',
          },
        ],
      }),
    })

    await mounted
    await screen.findByRole('heading', { name: 'Heizkessel Mensa entlüften' })
    expect(rowsOf('Material mit Menge, Artikel, Lager und Tag')).toEqual([
      ['0,5 l', 'Kriechöl A-1072', 'Hauptlager Betriebshof', '05.10.2026'],
    ])
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

  it('takes the warranty of an accepted order from whoever accepts work orders, and from nobody before (#329)', async () => {
    const acceptedPage = {
      ...signedPage,
      status: 'done' as const,
      decisions: [
        {
          decision: 'accepted' as const,
          decidedAt: '2026-10-06T08:00:00.000Z',
          name: 'Sabine Krämer',
          reason: null,
        },
      ],
    }
    const { mounted, written } = mount(
      '/auftraege/ac-waiting',
      { '/work-orders/ac-waiting': acceptedPage },
      'site_management',
      () => ({ status: 200, body: { ...acceptedPage, warrantyEndsOn: '2028-10-06' } }),
    )

    await mounted
    await screen.findByText('keine eigene')
    fireEvent.click(await screen.findByRole('button', { name: 'Eintragen' }))

    const dialog = within(await screen.findByRole('dialog', { name: 'Gewährleistung eintragen' }))

    fireEvent.change(dialog.getByLabelText('Gewährleistung bis'), {
      target: { value: '2028-10-06' },
    })
    fireEvent.click(dialog.getByRole('button', { name: 'Speichern' }))
    await waitFor(() => {
      expect(written).toEqual([
        {
          method: 'PUT',
          path: '/work-orders/ac-waiting/warranty',
          body: { warrantyEndsOn: '2028-10-06' },
        },
      ])
    })
  })

  it('offers the warranty neither before the acceptance nor to whoever does not accept', async () => {
    for (const [page, role] of [
      [signedPage, 'site_management'],
      [
        {
          ...signedPage,
          status: 'done' as const,
          decisions: [
            {
              decision: 'accepted' as const,
              decidedAt: '2026-10-06T08:00:00.000Z',
              name: 'Sabine Krämer',
              reason: null,
            },
          ],
        },
        'technician',
      ],
    ] as const) {
      const { mounted } = mount('/auftraege/ac-waiting', { '/work-orders/ac-waiting': page }, role)

      await mounted
      await screen.findByRole('heading', { name: signedPage.title })
      // Accepted, the panel says the warranty, and offers nothing to change it.
      if (role === 'technician') {
        await screen.findByText('keine eigene')
      }

      expect(screen.queryByRole('button', { name: 'Eintragen' })).toBeNull()
      document.body.innerHTML = ''
    }
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
        // Asked with the place the order hangs on, whose area it is (#306).
        '/work-orders/candidates?property=p-school&asset=as-door': candidates,
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
            measure: null,
            urgency: 'immediate',
            dueOn: '2099-10-12',
            responsibleUserId: 'u-vogt',
            participantUserIds: ['u-wendt'],
            contractorId: null,
          },
        },
      ])
    })
  })

  it('names the firm of the list that carries it out, and what was taken on site: the briefings and the permit in the version of its form (#330)', async () => {
    const visits: ContractorVisits = {
      briefings: [
        {
          id: 'br-1' as ContractorVisits['briefings'][number]['id'],
          activityId: 'ac-remedy' as ContractorVisits['briefings'][number]['activityId'],
          orderNumber: 'AU-2026-0029',
          orderTitle: 'Notausgangstür Saal gängig machen',
          contractorId: 'c-heat' as ContractorVisits['briefings'][number]['contractorId'],
          contractorName: 'Heizungsbau Beispiel GmbH',
          personName: 'Marco Petri',
          subject: 'Fluchtwege und Brandmeldeanlage',
          path: 'M10,10L200,300',
          signedByName: 'Tobias Wendt',
          signedAt: '2026-10-07T05:40:00.000Z',
        },
      ],
      permits: [
        {
          id: 'wp-1' as ContractorVisits['permits'][number]['id'],
          activityId: 'ac-remedy' as ContractorVisits['permits'][number]['activityId'],
          orderNumber: 'AU-2026-0029',
          orderTitle: 'Notausgangstür Saal gängig machen',
          contractorId: 'c-heat' as ContractorVisits['permits'][number]['contractorId'],
          contractorName: 'Heizungsbau Beispiel GmbH',
          formKey: 'brandschutz.hot_work_permit',
          formVersion: 1,
          form: {
            key: 'brandschutz.hot_work_permit',
            version: 1,
            title: 'Erlaubnisschein für feuergefährliche Arbeiten',
            sections: [
              {
                key: 'work',
                title: 'Arbeiten',
                fields: [
                  { kind: 'text', key: 'place', label: 'Arbeitsort in der Fassung 1' },
                  {
                    kind: 'choice',
                    key: 'combustibles',
                    label: 'Brennbares entfernt',
                    options: [
                      { value: 'done', label: 'Erledigt' },
                      { value: 'not_needed', label: 'Entfällt' },
                    ],
                  },
                  {
                    kind: 'signature',
                    key: 'signer',
                    label: 'Unterschrift der ausführenden Person',
                  },
                ],
              },
            ],
          },
          answers: {
            place: 'Heizraum',
            combustibles: 'not_needed',
            signer: {
              name: 'Marco Petri',
              path: 'M10,10L200,300',
              signedAt: '2026-10-07T05:55:00.000Z',
            },
          },
          signerName: 'Marco Petri',
          signedByName: 'Tobias Wendt',
          signedAt: '2026-10-07T05:55:00.000Z',
        },
      ],
    }
    const { mounted } = mount('/auftraege/ac-remedy', {
      '/work-orders/ac-remedy': details(remedy, {
        contractorId: 'c-heat' as WorkOrderDetails['contractorId'],
      }),
      '/work-orders/ac-remedy/visits': visits,
      '/contractors': [{ id: 'c-heat', name: 'Heizungsbau Beispiel GmbH' }],
    })

    await mounted
    expect(
      (await screen.findByRole('link', { name: 'Heizungsbau Beispiel GmbH' })).getAttribute('href'),
    ).toBe('/fremdfirmen/c-heat')
    expect(await screen.findByText('eingewiesen von Tobias Wendt')).toBeTruthy()

    fireEvent.click(
      screen.getByRole('button', { name: 'Erlaubnisschein für feuergefährliche Arbeiten ansehen' }),
    )

    const dialog = await screen.findByRole('dialog', {
      name: 'Erlaubnisschein für feuergefährliche Arbeiten',
    })

    // In the version it was made in, whatever the catalogue holds today.
    expect(within(dialog).getByText('Arbeitsort in der Fassung 1')).toBeTruthy()
    expect(within(dialog).getByText('Entfällt')).toBeTruthy()
    expect(within(dialog).getByRole('img', { name: 'Unterschrift von Marco Petri' })).toBeTruthy()
  })

  it('gives an order to a firm of the list and back to the own people, by whoever plans (#330)', async () => {
    const { mounted, written } = mount(
      '/auftraege/ac-remedy',
      {
        '/work-orders/ac-remedy': details(remedy),
        '/work-orders/candidates?property=p-school&asset=as-door': candidates,
        '/contractors': [{ id: 'c-heat', name: 'Heizungsbau Beispiel GmbH' }],
      },
      'site_management',
      () => ({ status: 200, body: { id: 'ac-remedy' } }),
    )

    await mounted
    fireEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }))

    const dialog = await screen.findByRole('dialog')
    const firm = within(dialog).getByRole('combobox', { name: 'Fremdfirma' })

    await within(firm).findByRole('option', { name: 'Heizungsbau Beispiel GmbH' })
    expect(within(firm).getByRole('option', { name: 'Eigene Leute' })).toBeTruthy()
    fireEvent.change(firm, { target: { value: 'c-heat' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(
        written.map((write) => (write.body as { contractorId?: unknown }).contractorId),
      ).toEqual(['c-heat'])
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
        '/work-orders/candidates?property=p-school&building=b-house': candidates,
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
            measure: null,
            urgency: 'urgent',
            dueOn: '2099-10-19',
            responsibleUserId: 'u-vogt',
            participantUserIds: [],
            contractorId: null,
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
      { '/work-orders/candidates?property=p-school&asset=as-door': candidates },
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
    // A work order of another kind chooses its basic measure after DIN 31051 (#333).
    await screen.findByText(/Ein sonstiger Auftrag nennt seine Einordnung/)
    expect(written).toEqual([])
    fireEvent.change(screen.getByRole('combobox', { name: /Einordnung/ }), {
      target: { value: 'repair' },
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
            measure: 'repair',
            urgency: 'normal',
            dueOn: '2099-11-02',
            responsibleUserId: 'u-wendt',
            participantUserIds: [],
            contractorId: null,
            origin: 'hand',
            assetId: 'as-door',
          },
        },
      ])
    })
  })

  it('by hand offers as its place only a property whose area the person holds, and the buildings of the others all the same (#310)', async () => {
    const nord: NamedArea = { id: 'a-nord', name: 'Nord' }

    server.put('properties', { ...school, id: 'p-yard', areaId: nord.id, name: 'Werkhof Nord' })

    const { mounted } = mount('/auftraege/neu?anlage=as-door', { '/areas': [nord] })
    const offered = (name: string) =>
      within(screen.getByRole('combobox', { name }))
        .getAllByRole('option')
        .map((option) => option.textContent)

    await mounted
    fireEvent.change(await screen.findByRole('combobox', { name: 'Woran' }), {
      target: { value: 'buildingId' },
    })
    await waitFor(() => {
      expect(offered('Gebäude')).toContain('Schulhaus, Schulzentrum Am Lindenhain')
    })

    fireEvent.change(screen.getByRole('combobox', { name: 'Woran' }), {
      target: { value: 'propertyId' },
    })
    await waitFor(() => {
      expect(offered('Liegenschaft')).toEqual(['Bitte wählen', 'Werkhof Nord'])
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

describe('the list "Aufträge" as a table (#236)', () => {
  it('is asked for with what the list is narrowed by, whole and not a page', async () => {
    const { mounted } = mount('/auftraege', {
      [firstPage]: page([remedy]),
      '/work-orders?state=waiting&offset=0&limit=50': page([waiting]),
      '/work-orders?state=waiting&kind=other&offset=0&limit=50': page([waiting]),
    })

    await mounted
    await screen.findByRole('link', { name: 'Notausgangstür Saal gängig machen' })
    fireEvent.click(screen.getByRole('button', { name: 'Wartet auf Abnahme' }))
    await screen.findByRole('link', { name: 'Heizkessel Mensa entlüften' })
    fireEvent.change(screen.getByRole('combobox', { name: 'Art' }), { target: { value: 'other' } })
    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'Art' })).toHaveProperty('value', 'other')
    })

    // After the answers of the test, which it hands every other request to.
    const tables = servingTables()

    fireEvent.click(screen.getByRole('button', { name: 'Als Tabelle' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'CSV (.csv)' }))

    await waitFor(() => {
      expect(tables.asked).toEqual(['/work-orders/table?state=waiting&kind=other&format=csv'])
    })
  })
})
