import type {
  ActivityDetails,
  ActivityEntry,
  ActivityList,
  CollectiveCandidates,
  CollectivePart,
  IsoDate,
  RoleKey,
} from '@opengewerk/haustechnik-domain'
import { today } from '@opengewerk/platform-web/format'
import { TestServer } from '@opengewerk/platform-web/testing'
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
  type WriteAnswer,
  type Written,
} from '../test-office.js'
import { monthsAround } from './collectives.js'

/**
 * Collective activities in the office (#342, 4.4 of the concept): the row of
 * one in the list, composing one from the place and the duty kind with what
 * falls due chosen, its page with an asset to a row, a part that names it,
 * and the report of a contractor for all its assets.
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

const everything = ['properties', 'buildings', 'floors', 'rooms', 'assets'] as const
const firstPage = '/activities?offset=0&limit=50'

function entry(id: string, further: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    id: id as ActivityEntry['id'],
    kind: 'inspection',
    title: 'Prüfung der Feuerlöscher, Schulhaus',
    status: 'open',
    dueOn: '2099-10-12',
    propertyId: school.id as ActivityEntry['propertyId'],
    areaId: sued.id as ActivityEntry['areaId'],
    buildingId: house.id as ActivityEntry['buildingId'],
    roomId: null,
    assetId: null,
    responsible: { userId: 'u-roth', name: 'Dennis Roth' },
    performer: 'own_staff',
    performerPerson: { userId: 'u-wendt', name: 'Tobias Wendt' },
    contractorNote: null,
    contractorId: null,
    collective: {
      kind: 'probe.elevator_main_test',
      label: 'Prüfung der Feuerlöscher',
      source: 'ASR A2.2',
      parts: 5,
      withResult: 2,
    },
    ...further,
  }
}

function part(id: string, number: string, further: Partial<CollectivePart> = {}): CollectivePart {
  return {
    id: id as CollectivePart['id'],
    status: 'open',
    asset: { id: `as-${id}`, number, name: 'Feuerlöscher' },
    where: 'Erdgeschoss, Flur',
    dutyId: `d-${id}` as CollectivePart['dutyId'],
    dutyTitle: 'Prüfung der Feuerlöscher',
    appointment: '2099-10-12',
    performedOn: null,
    result: null,
    resultReason: null,
    evidence: null,
    ...further,
  }
}

function details(of: ActivityEntry, further: Partial<ActivityDetails> = {}): ActivityDetails {
  return {
    ...of,
    createdAt: '2026-09-12T06:00:00.000Z',
    performedOn: null,
    closingReason: null,
    duties: [],
    shell: null,
    ...further,
  }
}

let server: TestServer
let written: Written[]
let answerToWrite: (write: Written) => WriteAnswer

function mount(
  at: string,
  answers: Readonly<Record<string, unknown>> = {},
  role: RoleKey = 'site_management',
) {
  written = signedInOffice(role, [sued], { ...servingCatalogue(), ...answers }, (write) =>
    answerToWrite(write),
  )

  return mountOffice(at, server, everything)
}

// A select takes a value only once it has the option for it; before that the
// browser, and happy-dom with it, quietly takes nothing, and the screen goes on
// without the choice (#478). The places and kinds come with the answers of the
// server, often after the select itself, on a busy runner long after. So the
// test waits for the option and not only for the select.
async function choose(name: RegExp | string, value: string) {
  const select = await screen.findByRole<HTMLSelectElement>('combobox', { name })

  await waitFor(() => {
    expect(Array.from(select.options).map((option) => option.value)).toContain(value)
  })
  fireEvent.change(select, { target: { value } })
}

beforeEach(() => {
  localStorage.clear()
  onA('desktop')
  server = new TestServer()
  server.put('properties', school)
  server.put('buildings', house)
  answerToWrite = () => ({ status: 201, body: { id: 'ac-new' } })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the list "Prüfungen"', () => {
  it('names a collective activity by how many assets it holds, and whoever plans finds the way to compose one', async () => {
    await mount('/pruefungen', {
      [firstPage]: { activities: [entry('ac-col')], total: 1, more: false } satisfies ActivityList,
    })

    await waitFor(() => {
      expect(
        rowsOf('Prüfungen und Wartungen mit Fälligkeit, Anlage oder Ort, Zuständigkeit und Stand'),
      ).toHaveLength(1)
    })
    expect(
      rowsOf('Prüfungen und Wartungen mit Fälligkeit, Anlage oder Ort, Zuständigkeit und Stand')[0],
    ).toEqual([
      '12.10.2099',
      'Prüfung der Feuerlöscher, SchulhausSammelvorgang, Prüfung',
      '5 AnlagenSchulzentrum Am Lindenhain, Schulhaus',
      'Dennis Roth',
      'Tobias Wendt',
      'Offen',
    ])
    await untilTheRightsAreKnown()
    expect(screen.getByRole('button', { name: 'Sammelvorgang zusammenstellen' })).toBeTruthy()
  })

  it('offers no way to compose one to whoever only performs', async () => {
    await mount(
      '/pruefungen',
      { [firstPage]: { activities: [entry('ac-col')], total: 1, more: false } },
      'technician',
    )

    await screen.findByRole('link', { name: 'Prüfung der Feuerlöscher, Schulhaus' })
    await untilTheRightsAreKnown()
    expect(screen.queryByRole('button', { name: 'Sammelvorgang zusammenstellen' })).toBeNull()
  })
})

describe('composing a collective activity', () => {
  const days = monthsAround(today() as IsoDate)
  const asked = (kind?: string) =>
    `/collectives/candidates?property=p-school${kind === undefined ? '' : `&kind=${encodeURIComponent(kind)}`}&from=${days.from}&to=${days.to}`
  const kinds: CollectiveCandidates['kinds'] = [
    { key: 'probe.elevator_main_test', label: 'Prüfung der Feuerlöscher', duties: 4 },
  ]
  const people: CollectiveCandidates['people'] = {
    responsible: [{ userId: 'u-roth', name: 'Dennis Roth' }],
    performers: [{ userId: 'u-wendt', name: 'Tobias Wendt' }],
  }
  const candidate = (
    id: string,
    appointment: string | null,
    activity: CollectiveCandidates['candidates'][number]['activity'] = null,
  ): CollectiveCandidates['candidates'][number] => ({
    dutyId: id as CollectiveCandidates['candidates'][number]['dutyId'],
    title: 'Prüfung der Feuerlöscher',
    asset: { id: `as-${id}`, number: `AN-${id}`, name: 'Feuerlöscher' },
    where: 'Schulhaus, Erdgeschoss',
    appointment: appointment as IsoDate | null,
    state: 'due',
    activity,
  })
  const answers = {
    [asked()]: { kinds, candidates: [], elsewhere: 0, people } satisfies CollectiveCandidates,
    [asked('probe.elevator_main_test')]: {
      kinds,
      elsewhere: 1,
      people,
      candidates: [
        candidate('d1', days.to),
        // Overdue long ago: chosen as well.
        candidate('d2', '2020-01-01'),
        // Due after the days asked: not chosen at first.
        candidate('d3', '2099-01-01'),
        // Begun by somebody: stays on its own.
        candidate('d4', days.from, {
          id: 'ac-begun' as ActivityEntry['id'],
          kind: 'inspection',
          status: 'started',
          partOfOne: false,
          performer: 'Murat Yilmaz',
        }),
      ],
    } satisfies CollectiveCandidates,
  }
  const box = (id: string) =>
    screen.getByRole<HTMLInputElement>('checkbox', { name: `AN-${id} Feuerlöscher wählen` })

  it('chooses what falls due between the days and what is overdue, and leaves one somebody began on its own', async () => {
    await mount('/pruefungen/sammelvorgang', answers)
    await untilTheRightsAreKnown()

    await choose(/^Liegenschaft/, 'p-school')
    await choose(/^Pflichtart/, 'probe.elevator_main_test')
    await screen.findByRole('checkbox', { name: 'AN-d1 Feuerlöscher wählen' })

    expect(
      ['d1', 'd2', 'd3', 'd4'].map((id) => box(id)).map((each) => [each.checked, each.disabled]),
    ).toEqual([
      [true, false],
      [true, false],
      [false, false],
      [false, true],
    ])
    expect(screen.getByText('von Murat Yilmaz, läuft für sich weiter')).toBeTruthy()
    expect(screen.getByText(/Eine Anlage liegt in einem Gebäude mit eigenem Bereich/)).toBeTruthy()
  })

  it('sends the place, the kind, the duties chosen and the plan, and opens the collective activity it became', async () => {
    const { router } = await mount('/pruefungen/sammelvorgang', answers)

    await untilTheRightsAreKnown()
    await choose(/^Liegenschaft/, 'p-school')
    await choose(/^Pflichtart/, 'probe.elevator_main_test')
    await screen.findByRole('checkbox', { name: 'AN-d1 Feuerlöscher wählen' })
    fireEvent.click(box('d2'))
    fireEvent.click(box('d3'))
    await choose('Ausführend', 'u-wendt')
    fireEvent.click(screen.getByRole('button', { name: 'Sammelvorgang anlegen' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/pruefungen/ac-new')
    })
    expect(written).toEqual([
      {
        method: 'POST',
        path: '/collectives',
        body: {
          dutyKind: 'probe.elevator_main_test',
          propertyId: 'p-school',
          buildingId: null,
          roomId: null,
          title: 'Prüfung der Feuerlöscher, Schulzentrum Am Lindenhain',
          dutyIds: ['d1', 'd3'],
          responsibleUserId: null,
          performer: 'own_staff',
          performerUserId: 'u-wendt',
          contractorNote: null,
          contractorId: null,
          dueOn: days.to,
        },
      },
    ])
  })
})

describe('the page of a collective activity', () => {
  const parts = [
    part('ac-p1', 'AN-00031', { result: 'without_defects' }),
    part('ac-p2', 'AN-00033', { result: 'not_performed', resultReason: 'Archiv verschlossen' }),
    part('ac-p3', 'AN-00034'),
  ]

  it('names each asset with the day it is due on and its result, and the report of a contractor is entered for all', async () => {
    const firm = entry('ac-col', {
      performer: 'contractor',
      performerPerson: null,
      contractorNote: 'Brandschutz Beispiel GmbH',
    })

    await mount('/pruefungen/ac-col', { '/activities/ac-col': details(firm, { parts }) })
    await screen.findByRole('heading', { level: 1, name: 'Prüfung der Feuerlöscher, Schulhaus' })

    expect(rowsOf('Anlagen dieses Sammelvorgangs')).toEqual([
      ['AN-00031 FeuerlöscherErdgeschoss, Flur', '12.10.2099', 'Ohne Mangel'],
      [
        'AN-00033 FeuerlöscherErdgeschoss, Flur',
        '12.10.2099',
        'Nicht durchgeführtArchiv verschlossen',
      ],
      ['AN-00034 FeuerlöscherErdgeschoss, Flur', '12.10.2099', 'noch keines'],
    ])
    expect(screen.getByRole('link', { name: 'AN-00031 Feuerlöscher' }).getAttribute('href')).toBe(
      '/pruefungen/ac-p1',
    )
    await untilTheRightsAreKnown()
    expect(screen.getByRole('button', { name: 'Bericht eintragen' })).toBeTruthy()
  })

  it('offers no report while the own people perform it', async () => {
    await mount('/pruefungen/ac-col', { '/activities/ac-col': details(entry('ac-col'), { parts }) })
    await screen.findByRole('heading', { level: 1, name: 'Prüfung der Feuerlöscher, Schulhaus' })
    await untilTheRightsAreKnown()

    expect(screen.queryByRole('button', { name: 'Bericht eintragen' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Nicht durchgeführt' })).toBeTruthy()
  })

  it('leads from a part to its collective activity, where it is planned and closed', async () => {
    const single = entry('ac-p1', {
      title: 'Prüfung der Feuerlöscher',
      buildingId: null,
      collective: undefined,
      partOf: {
        id: 'ac-col' as ActivityEntry['id'],
        title: 'Prüfung der Feuerlöscher, Schulhaus',
        underWay: true,
      },
    })

    await mount('/pruefungen/ac-p1', { '/activities/ac-p1': details(single) })
    await screen.findByRole('heading', { level: 1, name: 'Prüfung der Feuerlöscher' })
    await untilTheRightsAreKnown()

    expect(
      screen
        .getByRole('link', { name: 'Prüfung der Feuerlöscher, Schulhaus' })
        .getAttribute('href'),
    ).toBe('/pruefungen/ac-col')
    expect(screen.queryByRole('button', { name: 'Speichern' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Nicht durchgeführt' })).toBeNull()
  })
})

describe('the report for many assets', () => {
  const firm = entry('ac-col', {
    performer: 'contractor',
    performerPerson: null,
    contractorNote: 'Brandschutz Beispiel GmbH',
  })
  const parts = [part('ac-p1', 'AN-00031'), part('ac-p2', 'AN-00032'), part('ac-p3', 'AN-00033')]

  it('sends the file ahead, a result for each asset, and each defect at the asset it names', async () => {
    const { router } = await mount('/pruefungen/ac-col/bericht', {
      '/activities/ac-col': details(firm, { parts }),
    })

    answerToWrite = () => ({ status: 201, body: [] })
    await screen.findByRole('heading', { level: 1, name: 'Bericht für viele Anlagen eintragen' })
    await untilTheRightsAreKnown()

    fireEvent.change(screen.getByLabelText('Datei wählen'), {
      target: {
        files: [
          new File(['%PDF-1.7 Prüfbericht'], 'bericht-schulhaus.pdf', { type: 'application/pdf' }),
        ],
      },
    })
    fireEvent.change(screen.getByRole('textbox', { name: /^Prüfer/ }), {
      target: { value: 'Klaus Berger' },
    })
    fireEvent.change(screen.getByLabelText(/^Tag der Durchführung/), {
      target: { value: '2026-10-02' },
    })
    fireEvent.change(screen.getByRole('combobox', { name: 'Ergebnis für AN-00032 Feuerlöscher' }), {
      target: { value: 'with_defects' },
    })
    fireEvent.change(screen.getByRole('combobox', { name: 'Ergebnis für AN-00033 Feuerlöscher' }), {
      target: { value: 'not_performed' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Grund für AN-00033 Feuerlöscher' }), {
      target: { value: 'Raum verschlossen' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Mangel hinzufügen' }))

    const defect = screen.getByRole('group', { name: 'Mangel 1' })

    // The first asset with defects is named at first.
    expect(within(defect).getByRole('combobox', { name: /^Anlage/ })).toHaveProperty(
      'value',
      'ac-p2',
    )
    fireEvent.change(within(defect).getByRole('textbox', { name: /^Beschreibung/ }), {
      target: { value: 'Plombe fehlt' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Nachweise festschreiben' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/pruefungen/ac-col')
    })
    expect(written).toEqual([
      {
        method: 'POST',
        path: '/collectives/ac-col/report',
        body: {
          performedOn: '2026-10-02',
          examiner: 'Klaus Berger',
          examinerOrganisation: 'Brandschutz Beispiel GmbH',
          contractorId: null,
          parts: [
            { activityId: 'ac-p1', result: 'without_defects', resultReason: null, defects: [] },
            {
              activityId: 'ac-p2',
              result: 'with_defects',
              resultReason: null,
              defects: [{ description: 'Plombe fehlt', defectClass: null, dueOn: null }],
            },
            {
              activityId: 'ac-p3',
              result: 'not_performed',
              resultReason: 'Raum verschlossen',
              defects: [],
            },
          ],
          file: {
            sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
            fileName: 'bericht-schulhaus.pdf',
            sizeBytes: new Blob(['%PDF-1.7 Prüfbericht']).size,
            previewSha256: null,
          },
        },
      },
    ])
  })
})
