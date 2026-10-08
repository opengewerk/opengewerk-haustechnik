import type {
  ActivityCandidates,
  ActivityDetails,
  ActivityEntry,
  ActivityList,
  RoleKey,
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
 * "Prüfungen" in the office (#105, 4.4 of the concept): the inspections and
 * the maintenance that came of the due days, asked of the server a page at a
 * time and narrowed there; the page of one with the duties it is to meet;
 * and its plan, which whoever plans and hands out work changes while it is
 * open and nobody else.
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
const light = {
  id: 'as-light',
  propertyId: school.id,
  areaId: sued.id,
  buildingId: house.id,
  roomId: null,
  parentAssetId: null,
  kind: 'probe.elevator',
  number: 'AN-00044',
  name: 'Sicherheitsbeleuchtung Schulhaus',
}

const everything = ['properties', 'buildings', 'floors', 'rooms', 'assets'] as const

/** The first page of what is still to be done, narrowed by nothing, as the list asks for it. */
const firstPage = '/activities?offset=0&limit=50'

function activity(id: string, further: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    id: id as ActivityEntry['id'],
    kind: 'inspection',
    title: 'Prüfung der Sicherheitsbeleuchtung',
    status: 'open',
    dueOn: '2099-10-12',
    propertyId: school.id as ActivityEntry['propertyId'],
    areaId: sued.id as ActivityEntry['areaId'],
    buildingId: null,
    roomId: null,
    assetId: light.id as ActivityEntry['assetId'],
    responsible: { userId: 'u-roth', name: 'Dennis Roth' },
    performer: 'own_staff',
    performerPerson: { userId: 'u-wendt', name: 'Tobias Wendt' },
    contractorNote: null,
    ...further,
  }
}

const own = activity('ac-own')
const late = activity('ac-late', {
  title: 'Prüfung der Feuerlöscher',
  dueOn: '2020-09-30',
  assetId: null,
  buildingId: house.id as ActivityEntry['buildingId'],
  performer: 'contractor',
  performerPerson: null,
  contractorNote: 'Brandschutz Beispiel GmbH',
})
const nobodys = activity('ac-nobody', {
  kind: 'maintenance',
  title: 'Wartung der Brandmeldeanlage',
  dueOn: '2099-10-20',
  assetId: null,
  performer: null,
  performerPerson: null,
  responsible: null,
})

function page(activities: readonly ActivityEntry[], total = activities.length): ActivityList {
  return { activities, total, more: false }
}

function details(entry: ActivityEntry, further: Partial<ActivityDetails> = {}): ActivityDetails {
  return {
    ...entry,
    createdAt: '2026-09-12T06:00:00.000Z',
    performedOn: null,
    closingReason: null,
    duties: [
      {
        id: 'ad-1' as ActivityDetails['duties'][number]['id'],
        dutyId: 'd-light' as ActivityDetails['duties'][number]['dutyId'],
        title: 'Prüfung der Sicherheitsbeleuchtung',
        source: 'DIN EN 50172',
        interval: { months: 12 },
        state: 'due',
        appointment: '2099-10-12',
        lastMetOn: '2025-10-12',
        qualification: 'skilled_person',
        result: null,
        resultReason: null,
      },
    ],
    ...further,
  }
}

const candidates: ActivityCandidates = {
  responsible: [
    { userId: 'u-roth', name: 'Dennis Roth' },
    { userId: 'u-lindner', name: 'Petra Lindner' },
  ],
  performers: [
    { userId: 'u-roth', name: 'Dennis Roth' },
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
  server.put('assets', light)
})

afterEach(() => {
  vi.unstubAllGlobals()
  onlineManager.setOnline(true)
})

describe('the list "Prüfungen"', () => {
  it('names the due day, the activity, where it is, who answers, who performs and how far it is', async () => {
    const { mounted } = mount('/pruefungen', { [firstPage]: page([late, own, nobodys], 14) })

    await mounted
    await waitFor(() => {
      expect(
        rowsOf('Prüfungen und Wartungen mit Fälligkeit, Anlage oder Ort, Zuständigkeit und Stand'),
      ).toHaveLength(3)
    })
    expect(
      rowsOf('Prüfungen und Wartungen mit Fälligkeit, Anlage oder Ort, Zuständigkeit und Stand'),
    ).toEqual([
      [
        '30.09.2020überfällig',
        'Prüfung der FeuerlöscherPrüfung',
        'SchulhausSchulzentrum Am Lindenhain',
        'Dennis Roth',
        'Brandschutz Beispiel GmbHFremdfirma',
        'Offen',
      ],
      [
        '12.10.2099',
        'Prüfung der SicherheitsbeleuchtungPrüfung',
        'AN-00044 Sicherheitsbeleuchtung SchulhausSchulzentrum Am Lindenhain, Schulhaus',
        'Dennis Roth',
        'Tobias Wendt',
        'Offen',
      ],
      [
        '20.10.2099',
        'Wartung der BrandmeldeanlageWartung',
        'Schulzentrum Am LindenhainLiegenschaft',
        'noch niemand',
        'noch niemand',
        'Offen',
      ],
    ])
    expect(
      screen.getByRole('link', { name: 'Prüfung der Sicherheitsbeleuchtung' }).getAttribute('href'),
    ).toBe('/pruefungen/ac-own')
    expect(screen.getByText('14 offen')).toBeTruthy()
    expect(screen.getByText('3 von 14')).toBeTruthy()
  })

  it('asks the server for what is done, for a kind and for a property', async () => {
    const { mounted } = mount('/pruefungen', {
      [firstPage]: page([own]),
      '/activities?state=done&offset=0&limit=50': page([nobodys]),
      '/activities?state=done&kind=maintenance&offset=0&limit=50': page([]),
      '/activities?state=done&kind=maintenance&property=p-school&offset=0&limit=50': page([]),
    })

    await mounted
    await screen.findByRole('link', { name: 'Prüfung der Sicherheitsbeleuchtung' })
    fireEvent.click(screen.getByRole('button', { name: 'Erledigt' }))
    await screen.findByRole('link', { name: 'Wartung der Brandmeldeanlage' })
    fireEvent.change(screen.getByRole('combobox', { name: 'Art' }), {
      target: { value: 'maintenance' },
    })
    await screen.findByText(
      'Keine Prüfung und keine Wartung passt zu dem, wonach die Liste eingegrenzt ist.',
    )
    fireEvent.change(screen.getByRole('combobox', { name: 'Liegenschaft' }), {
      target: { value: 'p-school' },
    })

    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'Liegenschaft' })).toHaveProperty(
        'value',
        'p-school',
      )
    })
  })
})

describe('the page of an activity', () => {
  it('shows the duties it is to meet with their state, and where it came from', async () => {
    const { mounted } = mount('/pruefungen/ac-own', {
      '/activities/ac-own': details(own),
      '/activities/ac-own/candidates': candidates,
    })

    await mounted
    await screen.findByRole('heading', { level: 1, name: 'Prüfung der Sicherheitsbeleuchtung' })

    expect(rowsOf('Pflichten dieses Vorgangs')).toEqual([
      [
        'Prüfung der SicherheitsbeleuchtungDIN EN 50172 · 12 Monate',
        'AN-00044 Sicherheitsbeleuchtung SchulhausSchulzentrum Am Lindenhain, Schulhaus',
        '12.10.2099',
        'Fällig',
        'noch keines',
      ],
    ])
    expect(screen.getByText('am 12.09.2026')).toBeTruthy()
    expect(screen.getByText('Fachkraft')).toBeTruthy()
    expect(screen.getByText('12.10.2025')).toBeTruthy()
  })

  it('says when the activity is not there for this access', async () => {
    const { mounted } = mount('/pruefungen/ac-gone')

    await mounted
    await screen.findByText(
      'Diesen Vorgang gibt es nicht, oder er liegt außerhalb dessen, was dieser Zugang sieht.',
    )
  })
})

describe('the plan of an activity', () => {
  it('sends who answers for it, who performs it and the day, for whoever plans', async () => {
    const { mounted, written } = mount(
      '/pruefungen/ac-own',
      { '/activities/ac-own': details(own), '/activities/ac-own/candidates': candidates },
      'site_management',
      () => ({ status: 200, body: details(own) }),
    )

    await mounted
    await untilTheRightsAreKnown()
    await screen.findByRole('option', { name: 'Murat Yilmaz' })

    fireEvent.change(screen.getByRole('combobox', { name: 'Verantwortlich' }), {
      target: { value: 'u-lindner' },
    })
    fireEvent.change(screen.getByRole('combobox', { name: 'Ausführend' }), {
      target: { value: 'u-yilmaz' },
    })
    fireEvent.change(screen.getByLabelText('Fällig am'), { target: { value: '2099-11-02' } })
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(written).toEqual([
        {
          method: 'PUT',
          path: '/activities/ac-own/plan',
          body: {
            responsibleUserId: 'u-lindner',
            performer: 'own_staff',
            performerUserId: 'u-yilmaz',
            contractorNote: null,
            dueOn: '2099-11-02',
          },
        },
      ])
    })
  })

  it('names a contractor instead of a person when a contractor performs it', async () => {
    const { mounted, written } = mount(
      '/pruefungen/ac-own',
      { '/activities/ac-own': details(own), '/activities/ac-own/candidates': candidates },
      'site_management',
      () => ({ status: 200, body: details(own) }),
    )

    await mounted
    await screen.findByRole('option', { name: 'Murat Yilmaz' })
    fireEvent.click(screen.getByRole('radio', { name: 'Fremde Durchführung' }))
    fireEvent.change(screen.getByLabelText('Fremdfirma'), {
      target: { value: 'Licht Beispiel GmbH' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(written.map((write) => write.body)).toEqual([
        {
          responsibleUserId: 'u-roth',
          performer: 'contractor',
          performerUserId: null,
          contractorNote: 'Licht Beispiel GmbH',
          dueOn: '2099-10-12',
        },
      ])
    })
  })

  it.each([
    ['technician', 'open'],
    ['site_management', 'started'],
  ] as const)('is not offered to "%s" for an activity that is %s', async (role, status) => {
    const { mounted } = mount(
      '/pruefungen/ac-own',
      {
        '/activities/ac-own': details({ ...own, status }),
        '/activities/ac-own/candidates': candidates,
      },
      role,
    )

    await mounted
    await untilTheRightsAreKnown()
    await screen.findByRole('heading', { level: 1, name: 'Prüfung der Sicherheitsbeleuchtung' })

    const facts = screen.getByRole('region', { name: 'Durchführung' })

    expect(within(facts).getByText('Tobias Wendt')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Speichern' })).toBeNull()
    expect(screen.queryByRole('combobox', { name: 'Ausführend' })).toBeNull()
    expect(screen.queryByRole('radio', { name: 'Fremde Durchführung' })).toBeNull()
  })
})
