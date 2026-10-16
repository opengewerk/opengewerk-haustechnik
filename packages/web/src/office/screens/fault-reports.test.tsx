import type {
  FaultCategory,
  FaultReportEntry,
  FaultReportPage,
} from '@opengewerk/haustechnik-domain'
import { TestServer } from '@opengewerk/platform-web/testing'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { memberIn } from '../../app/test-entry.js'
import {
  mountOffice,
  type NamedArea,
  rowsOf,
  signedInOffice,
  untilTheRightsAreKnown,
  type Written,
} from '../test-office.js'
import { faultWords } from './fault-reports.js'

/**
 * The faults in the office (#331, section 4.7 of the concept): the inbox of
 * the own areas, the page of a report with its three ways on, and the
 * categories under "Einstellungen". A report names nobody.
 */

const nord: NamedArea = { id: 'a-nord', name: 'Nord' }

const cold: FaultReportEntry = {
  id: 'f-cold' as FaultReportEntry['id'],
  category: 'Heizung und Lüftung',
  description: 'Heizkörper im Lehrerzimmer bleibt kalt.',
  words: {
    property: 'Schulzentrum Am Lindenhain',
    building: 'Schulhaus',
    room: '2.05 Lehrerzimmer',
  },
  propertyId: 'p-school' as FaultReportEntry['propertyId'],
  buildingId: 'b-school' as FaultReportEntry['buildingId'],
  roomId: 'r-205' as FaultReportEntry['roomId'],
  areaId: 'a-nord' as FaultReportEntry['areaId'],
  assetId: null,
  assetName: null,
  receivedAt: '2026-10-16T05:52:00.000Z',
  state: 'received',
  workOrder: null,
  outside: false,
}

const again: FaultReportEntry = {
  ...cold,
  id: 'f-again' as FaultReportEntry['id'],
  description: 'Lehrerzimmer kalt, Heizung aus?',
  receivedAt: '2026-10-16T06:10:00.000Z',
}

const page: FaultReportPage = {
  ...cold,
  hasPhoto: false,
  acceptedAt: null,
  rejectedAt: null,
  rejectionReason: null,
  mergedInto: null,
  merged: [],
  similar: [again],
  workOrderTitle: null,
  defectId: null,
  answersByMail: false,
}

const categories: FaultCategory[] = [
  { id: 'c-heat' as FaultCategory['id'], name: 'Heizung und Lüftung' },
]

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the inbox', () => {
  it('lists what came in with its category, its place, the moment and its state', async () => {
    signedInOffice('site_management', [nord], {
      '/fault-reports/categories': categories,
      '/fault-reports?state=received': [cold],
    })
    await mountOffice('/stoerungen', new TestServer(), ['properties'])
    await untilTheRightsAreKnown()

    await screen.findByText('Heizkörper im Lehrerzimmer bleibt kalt.')

    const [row] = rowsOf('Störmeldungen mit Kategorie, Ort, Eingang, Stand und Auftrag')

    expect(row?.[0]).toContain('Heizung und Lüftung')
    expect(row?.[1]).toBe('Schulhaus, 2.05 LehrerzimmerSchulzentrum Am Lindenhain')
    expect(row?.[3]).toBe('Eingegangen')
    expect(row?.[4]).toBe('keiner')
  })
})

describe('the page of a report', () => {
  async function opened(
    shown: FaultReportPage,
    answer?: (write: Written) => { status: number; body: unknown },
  ) {
    const written = signedInOffice(
      'site_management',
      [nord],
      { '/fault-reports/f-cold': shown },
      answer,
    )

    await mountOffice('/stoerungen/f-cold', new TestServer(), ['properties'])
    await untilTheRightsAreKnown()
    await screen.findByRole('heading', {
      name: 'Heizung und Lüftung, Schulhaus, 2.05 Lehrerzimmer',
    })

    return written
  }

  it('offers accepting, merging and rejecting while the report is in the inbox, and none of them after', async () => {
    await opened(page)

    for (const name of ['Annehmen', 'Zusammenführen', 'Ablehnen']) {
      expect(screen.getAllByRole('button', { name }).length).toBeGreaterThan(0)
    }

    vi.unstubAllGlobals()
    document.body.innerHTML = ''

    await opened({
      ...page,
      state: 'accepted',
      acceptedAt: '2026-10-16T07:00:00.000Z',
      workOrder: { activityId: 'ac-order', number: 'AU-2026-0035' },
      workOrderTitle: 'Heizung und Lüftung, 2.05 Lehrerzimmer',
      similar: [],
    })

    for (const name of ['Annehmen', 'Zusammenführen', 'Ablehnen']) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }

    expect(
      screen.getByRole('link', { name: 'AU-2026-0035 Heizung und Lüftung, 2.05 Lehrerzimmer' }),
    ).toBeTruthy()
  })

  it('sends a rejection with its reason, and a merge with the report chosen', async () => {
    const written = await opened(page, () => ({ status: 201, body: page }))

    fireEvent.click(screen.getAllByRole('button', { name: 'Ablehnen' })[0] as HTMLElement)

    const reject = await screen.findByRole('dialog', { name: 'Meldung ablehnen?' })

    fireEvent.change(within(reject).getByLabelText(/Grund/), {
      target: { value: 'Gehört zum Bauunterhalt der Stadt.' },
    })
    fireEvent.click(within(reject).getByRole('button', { name: 'Ablehnen' }))

    await waitFor(() => {
      expect(written).toContainEqual({
        method: 'POST',
        path: '/fault-reports/f-cold/reject',
        body: { reason: 'Gehört zum Bauunterhalt der Stadt.' },
      })
    })

    fireEvent.click(screen.getAllByRole('button', { name: 'Zusammenführen' })[0] as HTMLElement)

    const merge = await screen.findByRole('dialog', { name: 'Meldungen zusammenführen' })

    fireEvent.click(within(merge).getByRole('button', { name: 'Zusammenführen' }))

    await waitFor(() => {
      expect(written).toContainEqual({
        method: 'POST',
        path: '/fault-reports/f-cold/merge',
        body: { intoId: 'f-again' },
      })
    })
  })

  it('says that a report came in without an account, and whether an answer goes out by mail, never to whom', async () => {
    await opened({ ...page, outside: true, answersByMail: true })

    expect(await screen.findByText(/über das Etikett, ohne Anmeldung/)).toBeTruthy()
    expect(screen.getByText(faultWords.byMail)).toBeTruthy()
    expect(screen.getByText(faultWords.feedbackOutside)).toBeTruthy()
    expect(screen.queryByText(faultWords.feedback)).toBeNull()
  })

  it('says of a report without an account and without an address that nobody hears more', async () => {
    await opened({ ...page, outside: true, answersByMail: false })

    expect(await screen.findByText(faultWords.feedbackOutsideNone)).toBeTruthy()
    expect(screen.queryByText(faultWords.byMail)).toBeNull()
  })

  it('sends no rejection without a reason', async () => {
    const written = await opened(page, () => ({ status: 201, body: page }))

    fireEvent.click(screen.getAllByRole('button', { name: 'Ablehnen' })[0] as HTMLElement)

    const reject = await screen.findByRole('dialog', { name: 'Meldung ablehnen?' })

    fireEvent.click(within(reject).getByRole('button', { name: 'Ablehnen' }))

    expect(await within(reject).findByText('Der Grund fehlt.')).toBeTruthy()
    expect(written).toEqual([])
  })
})

describe('reporting without an account under "Einstellungen"', () => {
  it('is shipped off and switched on by whoever changes the settings', async () => {
    const written = signedInOffice(
      'management',
      [nord],
      {
        '/settings/fault-categories': categories,
        '/settings/fault-reports': { openByLabel: false },
      },
      () => ({ status: 200, body: { openByLabel: true } }),
    )

    await mountOffice('/einstellungen/stoerungen', new TestServer(), [])
    await untilTheRightsAreKnown()

    const card = (await screen.findByRole('checkbox', { name: /ohne Anmeldung annehmen/ })).closest(
      'form',
    ) as HTMLElement
    const box = within(card).getByRole('checkbox') as HTMLInputElement

    expect(box.checked).toBe(false)
    fireEvent.click(box)
    fireEvent.click(within(card).getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(written).toContainEqual({
        method: 'PUT',
        path: '/settings/fault-reports',
        body: { openByLabel: true },
      })
    })
  })

  it('is shown to whoever reads the settings, and not to be changed', async () => {
    signedInOffice('management', [nord], {
      '/auth/tenants': [{ ...memberIn('management'), rights: ['settings.read'] }],
      '/settings/fault-categories': categories,
      '/settings/fault-reports': { openByLabel: true },
    })
    await mountOffice('/einstellungen/stoerungen', new TestServer(), [])
    await untilTheRightsAreKnown()

    const box = (await screen.findByRole('checkbox', {
      name: /ohne Anmeldung annehmen/,
    })) as HTMLInputElement

    expect(box.checked).toBe(true)
    expect(box.disabled).toBe(true)
  })
})

describe('the categories under "Einstellungen"', () => {
  it('are kept by whoever changes the settings, and only shown to whoever reads them', async () => {
    signedInOffice('management', [nord], {
      '/settings/fault-categories': [{ ...categories[0], reports: 12 }],
    })
    await mountOffice('/einstellungen/stoerungen', new TestServer(), [])
    await untilTheRightsAreKnown()

    expect(await screen.findByRole('button', { name: 'Hinzufügen' })).toBeTruthy()
    expect(
      screen.getAllByRole('button', { name: 'Heizung und Lüftung entfernen' }).length,
    ).toBeGreaterThan(0)

    vi.unstubAllGlobals()
    document.body.innerHTML = ''

    signedInOffice('management', [nord], {
      '/auth/tenants': [{ ...memberIn('management'), rights: ['settings.read'] }],
      '/settings/fault-categories': [{ ...categories[0], reports: 12 }],
    })
    await mountOffice('/einstellungen/stoerungen', new TestServer(), [])
    await untilTheRightsAreKnown()

    expect((await screen.findAllByText('12 Meldungen')).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Hinzufügen' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Heizung und Lüftung entfernen' })).toBeNull()
  })
})
