import type {
  FaultCategory,
  FaultPlaceChoice,
  OwnFaultReport,
} from '@opengewerk/haustechnik-domain'
import { createHash } from 'node:crypto'

import { fromTheGallery } from '@opengewerk/platform-web/forms'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { afterEachSiteTest, mountSite } from './test-site.js'
import { reportingWords } from './reporting.js'

/**
 * Reporting a fault with an account on site (#331, section 4.7 of the
 * concept): the Melder starts at its own reports, reports at a room chosen
 * from the list or by its label, and sends the report straight to the
 * server, with a network.
 */

afterEach(afterEachSiteTest)

const categories: FaultCategory[] = [
  { id: 'c-heat' as FaultCategory['id'], name: 'Heizung und Lüftung' },
  { id: 'c-water' as FaultCategory['id'], name: 'Sanitär' },
]

const places: FaultPlaceChoice[] = [
  {
    buildingId: 'b-school' as FaultPlaceChoice['buildingId'],
    property: 'Schulzentrum Am Lindenhain',
    building: 'Schulhaus',
    rooms: [
      {
        id: 'r-205' as FaultPlaceChoice['rooms'][number]['id'],
        name: '2.05 Lehrerzimmer',
        floor: '2. OG',
      },
      {
        id: 'r-210' as FaultPlaceChoice['rooms'][number]['id'],
        name: '2.10 Sekretariat',
        floor: '2. OG',
      },
    ],
  },
]

const own: OwnFaultReport[] = [
  {
    id: 'f-cold' as OwnFaultReport['id'],
    category: 'Heizung und Lüftung',
    description: 'Heizkörper im Lehrerzimmer bleibt kalt.',
    words: {
      property: 'Schulzentrum Am Lindenhain',
      building: 'Schulhaus',
      room: '2.05 Lehrerzimmer',
    },
    receivedAt: '2026-10-16T05:52:00.000Z',
    state: 'received',
    acceptedAt: null,
    doneAt: null,
    rejectionReason: null,
    hasPhoto: false,
  },
  {
    id: 'f-window' as OwnFaultReport['id'],
    category: 'Sonstiges',
    description: 'Fenster im Klassenzimmer 3a klemmt.',
    words: { property: 'Schulzentrum Am Lindenhain', building: 'Schulhaus', room: null },
    receivedAt: '2026-10-13T07:30:00.000Z',
    state: 'rejected',
    acceptedAt: null,
    doneAt: null,
    rejectionReason: 'Fenster gehören zum Bauunterhalt der Stadt.',
    hasPhoto: false,
  },
]

describe('the start of a Melder', () => {
  it('is its own reports with their state and the reason of a rejection, under the way to report', async () => {
    await mountSite('/', { role: 'reporter', answers: { '/fault-reports/mine': own } })

    expect(await screen.findByRole('heading', { name: reportingWords.title })).toBeTruthy()
    expect(screen.getByRole('button', { name: reportingWords.report })).toBeTruthy()

    const list = await screen.findByRole('region', { name: reportingWords.own })

    expect(await within(list).findByText('Heizkörper im Lehrerzimmer bleibt kalt.')).toBeTruthy()
    expect(within(list).getByText('Liegt bei der Objektleitung')).toBeTruthy()
    expect(
      within(list).getByText('Grund: Fenster gehören zum Bauunterhalt der Stadt.'),
    ).toBeTruthy()
  })
})

describe('reporting a fault', () => {
  const answers = {
    '/fault-reports/categories': categories,
    '/fault-reports/places': places,
    '/fault-reports/mine': [],
    'POST /fault-reports': { id: 'f-new' },
  }

  it('sends the category, the description and the room chosen, and nothing of the person', async () => {
    const { asked } = await mountSite('/stoerung?raum=r-205', { role: 'reporter', answers })

    expect(await screen.findByText('2.05 Lehrerzimmer')).toBeTruthy()
    fireEvent.change(await screen.findByLabelText(/Kategorie/), { target: { value: 'c-heat' } })
    fireEvent.change(screen.getByLabelText(/Beschreibung/), {
      target: { value: 'Heizkörper bleibt kalt.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Melden' }))

    await waitFor(() => {
      expect(asked.filter((each) => each.method === 'POST')).toEqual([
        {
          method: 'POST',
          path: '/fault-reports',
          body: {
            categoryId: 'c-heat',
            description: 'Heizkörper bleibt kalt.',
            roomId: 'r-205',
            photoSha256: null,
          },
        },
      ])
    })
    expect(await screen.findByText(reportingWords.reported)).toBeTruthy()
  })

  it('sends a photo from the gallery ahead of the report, which names it by its hash', async () => {
    const sha256 = createHash('sha256').update('bild').digest('hex')
    const { asked } = await mountSite('/stoerung?raum=r-205', {
      role: 'reporter',
      answers: { ...answers, [`PUT /fault-reports/photos/${sha256}`]: {} },
    })

    expect(await screen.findByText('2.05 Lehrerzimmer')).toBeTruthy()
    fireEvent.change(await screen.findByLabelText(/Kategorie/), { target: { value: 'c-heat' } })
    fireEvent.change(screen.getByLabelText(/Beschreibung/), {
      target: { value: 'Heizkörper bleibt kalt.' },
    })
    fireEvent.change(screen.getByLabelText(fromTheGallery(reportingWords.photoField)), {
      target: { files: [new File(['bild'], 'heizung.jpg', { type: 'image/jpeg' })] },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Melden' }))

    await waitFor(() => {
      expect(asked.find((each) => each.method === 'POST')?.body).toMatchObject({
        photoSha256: sha256,
      })
    })
    expect(asked.find((each) => each.method === 'PUT')?.path).toBe(
      `/fault-reports/photos/${sha256}`,
    )
  })

  it('sends nothing without a place and says how to choose one', async () => {
    const { asked } = await mountSite('/stoerung', { role: 'reporter', answers })

    fireEvent.change(await screen.findByLabelText(/Kategorie/), { target: { value: 'c-heat' } })
    fireEvent.change(screen.getByLabelText(/Beschreibung/), {
      target: { value: 'Heizkörper bleibt kalt.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Melden' }))

    expect((await screen.findAllByText(reportingWords.noPlace)).length).toBeGreaterThan(0)
    expect(asked.filter((each) => each.method === 'POST')).toEqual([])
  })

  it('is not offered to somebody who may not report', async () => {
    await mountSite('/stoerung', { role: 'reporter', rights: ['sync.read'], answers })

    expect(await screen.findByText(reportingWords.mayNot)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Melden' })).toBeNull()
  })
})
